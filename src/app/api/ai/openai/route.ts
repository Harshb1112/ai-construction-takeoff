import { NextResponse } from "next/server";
import OpenAI from "openai";
import { TAKEOFF_EXTRACTION_PROMPT } from "@/lib/ai/prompts";

export async function POST(request: Request) {
  try {
    const { fileUrl, fileBase64, mimeType, prompt } = await request.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 503 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let imageUrl: string;

    if (fileBase64) {
      const mime = mimeType ?? "image/jpeg";
      imageUrl = `data:${mime};base64,${fileBase64}`;
    } else if (fileUrl) {
      imageUrl = fileUrl.startsWith("http")
        ? fileUrl
        : `${process.env.NEXTAUTH_URL}${fileUrl}`;
    } else {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            { type: "text", text: prompt ?? TAKEOFF_EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";
    let items = [];
    try {
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\[[\s\S]*\]/);
      if (jsonMatch) items = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
    } catch {}

    return NextResponse.json({
      provider: "openai",
      items,
      rawText: text,
      model: "gpt-4o",
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "OpenAI API error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
