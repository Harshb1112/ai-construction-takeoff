import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TAKEOFF_EXTRACTION_PROMPT } from "@/lib/ai/prompts";

export async function POST(request: Request) {
  try {
    const { fileUrl, fileBase64, mimeType, prompt } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let imageData: string;
    let imageMime: string = mimeType ?? "image/jpeg";

    if (fileBase64) {
      imageData = fileBase64;
    } else if (fileUrl) {
      const res = await fetch(fileUrl.startsWith("http") ? fileUrl : `${process.env.NEXTAUTH_URL}${fileUrl}`);
      const buf = await res.arrayBuffer();
      imageData = Buffer.from(buf).toString("base64");
      imageMime = res.headers.get("content-type") ?? "image/jpeg";
    } else {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageMime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: imageData,
              },
            },
            { type: "text", text: prompt ?? TAKEOFF_EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    // Try to parse JSON items from the response
    let items = [];
    try {
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        items = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
      }
    } catch {
      // Return raw text if JSON parsing fails
    }

    return NextResponse.json({
      provider: "claude",
      items,
      rawText: text,
      model: "claude-sonnet-4-6",
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Claude API error";
    console.error("Claude API error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
