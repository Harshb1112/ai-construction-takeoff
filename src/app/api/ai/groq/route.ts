import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { TAKEOFF_EXTRACTION_PROMPT } from "@/lib/ai/prompts";

export async function POST(request: Request) {
  try {
    const { fileBase64, mimeType, prompt, textContent } = await request.json();

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 503 });
    }

    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

    let messages: Groq.Chat.ChatCompletionMessageParam[];

    if (fileBase64) {
      const mime = mimeType ?? "image/jpeg";
      messages = [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${fileBase64}` } },
            { type: "text", text: prompt ?? TAKEOFF_EXTRACTION_PROMPT },
          ],
        },
      ];
    } else {
      messages = [
        {
          role: "user",
          content: `${prompt ?? TAKEOFF_EXTRACTION_PROMPT}\n\nDocument content:\n${textContent ?? ""}`,
        },
      ];
    }

    const response = await client.chat.completions.create({
      model: "llama-3.2-11b-vision-preview",
      max_tokens: 4096,
      messages,
    });

    const text = response.choices[0]?.message?.content ?? "";
    let items = [];
    try {
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\[[\s\S]*\]/);
      if (jsonMatch) items = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
    } catch {}

    return NextResponse.json({
      provider: "groq",
      items,
      rawText: text,
      model: "llama-3.2-11b-vision-preview",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Groq API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
