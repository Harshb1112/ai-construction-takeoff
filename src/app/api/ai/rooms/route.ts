import { NextResponse } from "next/server";

const ROOM_PROMPT = `You are a professional quantity surveyor analyzing an architectural floor plan.

Extract EVERY individual room/space from this drawing. For EACH room return EXACT measurements.

Return a JSON array — one object per room:

\`\`\`json
[
  {
    "id": "room_1",
    "name": "Master Bedroom",
    "type": "BEDROOM",
    "floorLevel": "Ground Floor",
    "lengthFt": 14.5,
    "widthFt": 12.0,
    "heightFt": 9.0,
    "areaSqFt": 174.0,
    "perimeterFt": 53.0,
    "wallAreaSqFt": 477.0,
    "ceilingSqFt": 174.0,
    "windowCount": 2,
    "doorCount": 1,
    "confidence": 0.92,
    "notes": "En-suite bathroom attached",
    "materials": {
      "flooring": "Hardwood",
      "walls": "Painted drywall",
      "ceiling": "Flat painted"
    }
  }
]
\`\`\`

RULES:
- Extract EVERY room visible: bedrooms, bathrooms, kitchen, living, dining, corridors, store, balcony, garage
- Calculate wallAreaSqFt = perimeter × height (subtract door/window openings approx 20%)
- If exact dimensions not shown, estimate from scale or proportions
- roomType options: BEDROOM, BATHROOM, KITCHEN, LIVING, DINING, CORRIDOR, STORE, BALCONY, GARAGE, STUDY, UTILITY, HALL, OTHER
- floorLevel: "Basement", "Ground Floor", "1st Floor", "2nd Floor", "3rd Floor", "Roof"
- confidence 0-1: how clearly this room is identified
- Count ALL rooms separately — if 3 bedrooms, list all 3 separately with their individual sizes`;

export async function POST(request: Request) {
  try {
    const { fileBase64, mimeType, provider = "lmstudio", textContent, lmStudioUrl, lmModel } = await request.json();

    // ── LM Studio (local OpenAI-compatible) ──────────────────────
    if (provider === "lmstudio") {
      const rawBase = (lmStudioUrl ?? process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234").replace(/\/+$/, "");
      // Ensure URL ends with /v1
      const baseUrl = rawBase.endsWith("/v1") ? rawBase : `${rawBase}/v1`;

      // Use explicit model from client, or auto-detect first loaded model
      let modelId = lmModel || "local-model";
      if (!lmModel) {
        try {
          const mr = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
          if (mr.ok) { const md = await mr.json(); if (md.data?.length) modelId = md.data[0].id; }
        } catch { /* keep fallback */ }
      }

      const buildMsg = (withImg: boolean) => withImg && fileBase64
        ? [{ role: "user", content: [
            { type: "image_url", image_url: { url: `data:${mimeType ?? "image/jpeg"};base64,${fileBase64}` } },
            { type: "text", text: ROOM_PROMPT },
          ]}]
        : [{ role: "user", content: `${ROOM_PROMPT}\n\nDocument text:\n${textContent ?? ""}` }];

      const callLm = async (withImg: boolean) => {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId, messages: buildMsg(withImg), max_tokens: 6000, temperature: 0.1 }),
          signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) { const t = await res.text(); throw new Error(`LM Studio ${res.status}: ${t}`); }
        return res.json();
      };

      let lmData;
      try {
        lmData = await callLm(true);
      } catch (e) {
        const msg = String(e);
        if (fileBase64 && (msg.includes("image") || msg.includes("400") || msg.includes("vision"))) {
          lmData = await callLm(false); // retry text-only
        } else {
          return NextResponse.json({ error: msg, hint: "Make sure LM Studio Local Server is running and a model is loaded" }, { status: 503 });
        }
      }

      const text = lmData.choices?.[0]?.message?.content ?? "";
      return NextResponse.json({ rooms: parseRooms(text), provider: "lmstudio", model: modelId, rawText: text });
    }

    return NextResponse.json({ error: "LM Studio required. Go to 🤖 LM Studio AI in sidebar to connect." }, { status: 503 });

  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

function parseRooms(text: string): unknown[] {
  const jsonText = extractJson(text);
  if (!jsonText) return [];

  try {
    return normalizeRooms(JSON.parse(jsonText));
  } catch {
    try {
      return normalizeRooms(JSON.parse(cleanJson(jsonText)));
    } catch {}
  }

  return [];
}

function extractJson(text: string): string | null {
  const codeBlock = text.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];
  if (codeBlock) return codeBlock;

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  const objectMatch = text.match(/\{[\s\S]*\}/);
  return objectMatch?.[0] ?? null;
}

function cleanJson(text: string): string {
  return text
    .replace(/,\s*([\]}])/g, "$1")
    .replace(/([\{\[,]\s*)([A-Za-z0-9_]+)\s*:/g, "$1\"$2\":");
}

function normalizeRooms(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { rooms?: unknown[] }).rooms)) {
    return (parsed as { rooms: unknown[] }).rooms;
  }
  return [];
}
