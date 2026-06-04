import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * REAL Region Analysis API
 * ========================
 * Receives:
 *   - croppedBase64: base64 JPEG of the cropped PDF region (from browser Canvas crop)
 *   - ocrText: text extracted from that page/region via PDF.js text layer
 *   - userNote: user's instruction ("Calculate concrete for this beam")
 *   - annotationId: annotation to update with result
 *   - annotationType: AREA | MEASUREMENT | COUNT etc.
 *   - measurement: calculated measurement value
 *   - unit: measurement unit
 *   - provider: "groq" | "claude" | "lmstudio"
 *   - lmBaseUrl: LM Studio server URL
 *
 * Returns:
 *   - takeoffItems: array of extracted items with quantities
 *   - summary: AI explanation
 *   - confidence: 0-1
 */

const buildPrompt = (
  userNote: string,
  ocrText: string,
  annotationType: string,
  measurement: number | null,
  unit: string | null
) => `You are an expert construction quantity surveyor analyzing a specific marked region of an architectural drawing.

USER'S INSTRUCTION FOR THIS REGION:
"${userNote || "Extract all materials and quantities visible in this marked area"}"

ANNOTATION TYPE: ${annotationType}
${measurement != null ? `MARKED MEASUREMENT: ${measurement} ${unit ?? ""}` : ""}

OCR TEXT EXTRACTED FROM THIS PAGE:
${ocrText ? ocrText.slice(0, 2000) : "(No text found in this region)"}

TASK:
1. Analyze the visual content of the cropped drawing region (image provided)
2. Combine with the OCR text and the user's specific instruction
3. Generate accurate construction takeoff items for this specific region

Return a JSON object with this exact structure:
\`\`\`json
{
  "summary": "Brief explanation of what was found in this region",
  "confidence": 0.85,
  "takeoffItems": [
    {
      "category": "Concrete",
      "description": "Reinforced Concrete Beam B1 - 300x600mm",
      "quantity": 12.5,
      "unit": "LF",
      "unitCost": 85.00,
      "notes": "Extracted from marked beam area"
    }
  ]
}
\`\`\`

Be precise. Use actual values visible in the drawing. If a dimension is shown, calculate the exact quantity.`;

export async function POST(request: Request) {
  try {
    const {
      croppedBase64,
      ocrText,
      userNote,
      annotationType = "AREA",
      measurement,
      unit,
      provider = "lmstudio",
      lmBaseUrl,
      annotationId,
      projectId,
    } = await request.json();

    if (!croppedBase64) {
      return NextResponse.json({ error: "No image provided — croppedBase64 required" }, { status: 400 });
    }

    const prompt = buildPrompt(userNote, ocrText, annotationType, measurement, unit);
    let rawText = "";
    let result: { summary: string; confidence: number; takeoffItems: unknown[] } = {
      summary: "",
      confidence: 0,
      takeoffItems: [],
    };

    // ── LM Studio Vision ────────────────────────────────────
    const baseURL = (lmBaseUrl ?? process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1").replace(/\/+$/, "");
    const lmUrl   = baseURL.endsWith("/v1") ? baseURL : `${baseURL}/v1`;
    const lm = new OpenAI({ apiKey: "lm-studio", baseURL: lmUrl, timeout: 120_000 });

    const tryCall = async (withImg: boolean) => lm.chat.completions.create({
      model: "local-model",
      max_tokens: 3000,
      temperature: 0.2,
      messages: [{
        role: "user",
        content: withImg
          ? [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${croppedBase64}` } },
              { type: "text", text: prompt },
            ] as OpenAI.Chat.ChatCompletionContentPart[]
          : prompt,
      }],
    });

    try {
      const res = await tryCall(true);
      rawText = res.choices[0]?.message?.content ?? "";
    } catch (e) {
      const msg = String(e);
      if (msg.includes("image") || msg.includes("400") || msg.includes("vision")) {
        const res = await tryCall(false);
        rawText = res.choices[0]?.message?.content ?? "";
      } else {
        return NextResponse.json({ error: "LM Studio error: " + msg, hint: "Go to 🤖 LM Studio AI in sidebar to connect." }, { status: 503 });
      }
    }

    // ── Parse JSON from AI response ──────────────────────────
    try {
      const match = rawText.match(/```json\n?([\s\S]*?)\n?```/) ?? rawText.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[1] ?? match[0]);
        result = {
          summary:      parsed.summary      ?? "Region analyzed",
          confidence:   parsed.confidence   ?? 0.75,
          takeoffItems: parsed.takeoffItems ?? parsed.items ?? [],
        };
      }
    } catch {
      // Return raw text if JSON parse fails
      result = { summary: rawText.slice(0, 500), confidence: 0.5, takeoffItems: [] };
    }

    // ── Save items to DB if projectId provided ───────────────
    let savedCount = 0;
    if (projectId && result.takeoffItems.length > 0) {
      const { prisma } = await import("@/lib/db");
      for (const item of result.takeoffItems as {
        category?: string; description?: string; quantity?: number;
        unit?: string; unitCost?: number; notes?: string;
      }[]) {
        if (!item.description) continue;
        const qty  = parseFloat(String(item.quantity ?? 1));
        const cost = parseFloat(String(item.unitCost ?? 0));
        await prisma.takeoffItem.create({
          data: {
            projectId,
            source:      `AI_${provider.toUpperCase()}` as "AI_GROQ" | "AI_CLAUDE" | "AI_OPENAI" | "AI_LMSTUDIO" | "FASTAPI" | "MARKUP" | "MANUAL",
            aiProvider:  provider,
            category:    item.category    ?? "General",
            description: item.description,
            quantity:    qty,
            unit:        item.unit        ?? unit ?? "EA",
            unitCost:    cost || null,
            totalCost:   cost ? qty * cost : null,
            notes:       item.notes ?? `AI region analysis: ${userNote || "user marked region"}`,
            confidence:  result.confidence,
            annotationId,
          },
        });
        savedCount++;
      }

      // Mark annotation as AI-analyzed
      if (annotationId) {
        await prisma.annotation.update({
          where: { id: annotationId },
          data: {
            aiAnalyzed: true,
            aiResult: JSON.stringify({ summary: result.summary, itemCount: savedCount }),
          },
        });
      }
    }

    return NextResponse.json({
      ...result,
      rawText,
      provider,
      savedCount,
    });

  } catch (error) {
    console.error("/api/ai/region error:", error);
    return NextResponse.json({
      error: (error as Error).message,
    }, { status: 500 });
  }
}
