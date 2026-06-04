import { NextResponse } from "next/server";
import OpenAI from "openai";

// ── Try Python ML backend first (real segmentation pipeline) ──────
async function tryPythonBackend(formData: FormData): Promise<Response | null> {
  const backendUrl = process.env.FLOORPLAN_API_URL ?? process.env.FASTAPI_URL?.replace("8000", "8001") ?? "http://localhost:8001";
  try {
    const res = await fetch(`${backendUrl}/api/floorplan/analyze`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return res;
  } catch { /* backend not running */ }
  return null;
}

// ─── Prompt using RELATIVE coords (0-1) — LLMs are far more accurate ──
function buildPrompt(imgW: number, imgH: number): string {
  return `You are an expert architectural quantity surveyor. Analyze this floor plan image carefully.

Image size: ${imgW}×${imgH}px.

Return ONLY a valid JSON object. Use RELATIVE coordinates (0.0–1.0 as fraction of image width/height).
Example: if a room starts 10% from left, 20% from top, and spans 30% width, 25% height → x:0.10, y:0.20, w:0.30, h:0.25

JSON format (no markdown, no extra text):
{
  "scale": "1:100",
  "unit": "m",
  "rooms": [
    {
      "id": "r1",
      "name": "Master Bedroom",
      "type": "BEDROOM",
      "rx": 0.08,
      "ry": 0.12,
      "rw": 0.28,
      "rh": 0.22,
      "areaSqM": 18.5,
      "lengthM": 4.9,
      "widthM": 3.8,
      "heightM": 2.8,
      "wallAreaSqM": 38.0,
      "ceilingSqM": 18.5,
      "perimeterM": 17.4,
      "doorCount": 1,
      "windowCount": 2,
      "floor": "Ground Floor",
      "confidence": 0.92
    }
  ],
  "doors":   [{ "rx": 0.15, "ry": 0.12, "rw": 0.03, "rh": 0.02 }],
  "windows": [{ "rx": 0.08, "ry": 0.13, "rw": 0.05, "rh": 0.02 }],
  "totalAreaSqM": 95.0,
  "buildingRx": 0.04,
  "buildingRy": 0.04,
  "buildingRw": 0.92,
  "buildingRh": 0.92
}

STRICT RULES:
1. rx, ry, rw, rh are RELATIVE (0.0–1.0) — rx=left edge / image width, ry=top edge / image height
2. Find EVERY enclosed space: bedrooms, bathrooms, kitchen, living, dining, corridor, balcony, garage, store, study
3. room type options: BEDROOM BATHROOM KITCHEN LIVING DINING CORRIDOR STORE BALCONY GARAGE STUDY UTILITY HALL OTHER
4. areaSqM — estimate from visible dimension labels. If no labels, estimate from proportions
5. wallAreaSqM = perimeterM × heightM × 0.8
6. doors = door swing arcs. windows = short thick wall lines
7. confidence 0–1: how clearly is this room identifiable?
8. Return JSON ONLY. No explanation, no markdown.`;
}

// Convert relative → pixel coordinates
function relToPixel(data: Record<string, unknown>, imgW: number, imgH: number) {
  const rooms = (data.rooms as Record<string, unknown>[])?.map(r => ({
    ...r,
    x: Math.round(Number(r.rx) * imgW),
    y: Math.round(Number(r.ry) * imgH),
    w: Math.round(Number(r.rw) * imgW),
    h: Math.round(Number(r.rh) * imgH),
  })) ?? [];

  const doors = (data.doors as Record<string, unknown>[])?.map(d => ({
    x: Math.round(Number(d.rx) * imgW),
    y: Math.round(Number(d.ry) * imgH),
    w: Math.max(12, Math.round(Number(d.rw) * imgW)),
    h: Math.max(12, Math.round(Number(d.rh) * imgH)),
  })) ?? [];

  const windows = (data.windows as Record<string, unknown>[])?.map(w => ({
    x: Math.round(Number(w.rx) * imgW),
    y: Math.round(Number(w.ry) * imgH),
    w: Math.max(12, Math.round(Number(w.rw) * imgW)),
    h: Math.max(12, Math.round(Number(w.rh) * imgH)),
  })) ?? [];

  return { ...data, rooms, doors, windows, imageWidth: imgW, imageHeight: imgH };
}

function parseFloorplan(text: string) {
  try {
    // Strip markdown code fences if present
    const clean = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    return JSON.parse(clean);
  } catch {
    // Try to extract JSON object from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      fileBase64, mimeType,
      imageWidth = 1200, imageHeight = 900,
      provider = "claude",
      lmStudioUrl, lmModel,
      scaleHint,
    } = body;

    // ── 1. Try real Python ML backend (OpenCV + CubiCasa5k) ───────
    if (fileBase64) {
      try {
        const imgBuf = Buffer.from(fileBase64, "base64");
        const blob = new Blob([imgBuf], { type: mimeType ?? "image/jpeg" });
        const fd = new FormData();
        fd.append("file", blob, "floorplan.jpg");
        if (scaleHint) fd.append("scale_hint", scaleHint);
        const backendRes = await tryPythonBackend(fd);
        if (backendRes) {
          const data = await backendRes.json();
          if (data.rooms?.length) {
            return NextResponse.json({ ...data, source: "python_ml" });
          }
        }
      } catch { /* fall through to AI */ }
    }

    if (!fileBase64) {
      return NextResponse.json({ error: "fileBase64 required" }, { status: 400 });
    }

    const prompt = buildPrompt(imageWidth, imageHeight);
    const mime = (mimeType ?? "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";

    // ── LM Studio ─────────────────────────────────────────────
    {
      const rawBase = (lmStudioUrl ?? process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234").replace(/\/+$/, "");
      const baseURL = rawBase.endsWith("/v1") ? rawBase : `${rawBase}/v1`;
      const modelId = lmModel || "local-model";

      const lm = new OpenAI({ apiKey: "lm-studio", baseURL, timeout: 180_000 });

      const tryLm = async (withImage: boolean) => lm.chat.completions.create({
        model: modelId,
        max_tokens: 8192,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: withImage
            ? [
                { type: "image_url", image_url: { url: `data:${mime};base64,${fileBase64}` } },
                { type: "text", text: prompt },
              ] as OpenAI.Chat.ChatCompletionContentPart[]
            : `${prompt}\n\n[Image not shown — estimate a typical apartment layout]`,
        }],
      });

      let resp;
      try {
        resp = await tryLm(true);
      } catch (e) {
        const msg = String(e);
        if (msg.includes("image") || msg.includes("400") || msg.includes("vision")) {
          resp = await tryLm(false);
        } else {
          throw e;
        }
      }
      const text = resp.choices[0]?.message?.content ?? "";
      const raw = parseFloorplan(text);
      if (!raw) return NextResponse.json({ error: "LM Studio returned invalid JSON. Use a vision model (LLaVA, Qwen2-VL) for best results.", rawText: text }, { status: 422 });
      const data = relToPixel(raw, imageWidth, imageHeight);
      return NextResponse.json({ ...data, provider: "lmstudio", model: modelId });
    }

  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
