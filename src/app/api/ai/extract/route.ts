import { NextResponse } from "next/server";
import OpenAI from "openai";

const ROOM_EXTRACTION_PROMPT = `You are a construction estimator analyzing an architectural drawing or PDF.

Extract room-by-room material information. Return a JSON array:

\`\`\`json
[
  {
    "floorLevel": "Ground Floor",
    "roomName": "Living Room",
    "areaSqFt": 320,
    "ceilingHeightFt": 9,
    "materials": [
      {
        "category": "Flooring",
        "description": "Hardwood Flooring",
        "quantity": 320,
        "unit": "SF",
        "unitCost": 5.50,
        "materialCode": null,
        "confidence": 0.85
      }
    ]
  }
]
\`\`\`

Rules:
- Extract ALL visible rooms/spaces
- Note area in sq ft (estimate from dimensions if shown)
- Include floor level if visible (Basement, Ground, 1st Floor, 2nd Floor, etc.)
- For each room, list all applicable materials
- Note structural codes if visible (MST48, LVL, HDU2, HSS, LSL)
- For materials without explicit quantities, estimate from area using standard consumption rates
- Set confidence 0-1 based on how clearly the info is visible`;

export async function POST(request: Request) {
  try {
    const { fileBase64, mimeType, provider, textContent, lmStudioUrl, lmModel } = await request.json();

    let result: { rooms: unknown[]; rawText: string; provider: string };

    // ── LM Studio ─────────────────────────────────────────
    if (provider === "lmstudio") {
      const baseUrl = (lmStudioUrl ?? process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1").replace(/\/+$/, "");
      let modelId = lmModel || "local-model";
      if (!lmModel) {
        try {
          const mr = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(4000) });
          if (mr.ok) { const md = await mr.json(); if (md.data?.length) modelId = md.data[0].id; }
        } catch { /* use fallback */ }
      }

      const lm = new OpenAI({ apiKey: "lm-studio", baseURL: baseUrl, timeout: 120_000 });
      const buildMsg = (withImg: boolean): OpenAI.Chat.ChatCompletionMessageParam[] =>
        withImg && fileBase64
          ? [{ role: "user", content: [
              { type: "image_url", image_url: { url: `data:${mimeType ?? "image/jpeg"};base64,${fileBase64}` } },
              { type: "text", text: ROOM_EXTRACTION_PROMPT },
            ]}]
          : [{ role: "user", content: `${ROOM_EXTRACTION_PROMPT}\n\nDocument:\n${textContent ?? ""}` }];

      let resp;
      try {
        resp = await lm.chat.completions.create({ model: modelId, messages: buildMsg(true), max_tokens: 4096, temperature: 0.1 });
      } catch (imgErr: unknown) {
        const m = String(imgErr);
        if (fileBase64 && (m.includes("image") || m.includes("400") || m.includes("vision"))) {
          resp = await lm.chat.completions.create({ model: modelId, messages: buildMsg(false), max_tokens: 4096, temperature: 0.1 });
        } else throw imgErr;
      }
      const text = resp.choices[0]?.message?.content ?? "";
      result = { rooms: parseRooms(text), rawText: text, provider: "lmstudio" };

    } else {
      return NextResponse.json({ error: "LM Studio required. Go to 🤖 LM Studio AI in sidebar to connect." }, { status: 503 });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Extraction failed" }, { status: 500 });
  }
}

function parseRooms(text: string): unknown[] {
  try {
    const match = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[1] ?? match[0]);
  } catch {}
  return [];
}
