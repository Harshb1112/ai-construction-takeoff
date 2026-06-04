import { NextResponse } from "next/server";
import OpenAI from "openai";
import { TAKEOFF_EXTRACTION_PROMPT } from "@/lib/ai/prompts";

export async function POST(request: Request) {
  const { fileBase64, mimeType, prompt, textContent, model, baseUrl } = await request.json();
  const baseURL = (baseUrl ?? process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1").replace(/\/+$/, "");

  // Test connectivity and auto-detect loaded model
  let autoModel: string | undefined;
  try {
    const modelsRes = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(5000) });
    if (modelsRes.ok) {
      const modelsData = await modelsRes.json();
      const first = modelsData?.data?.[0]?.id;
      if (first) autoModel = first;
    }
  } catch {
    return NextResponse.json({
      error: "LM Studio is not running",
      hint: "Open LM Studio → Load a model → Enable Local Server (port 1234)",
      baseURL,
    }, { status: 503 });
  }

  if (!autoModel && !model) {
    return NextResponse.json({
      error: "LM Studio error: No models loaded. Please load a model in LM Studio's local server.",
      hint: "In LM Studio → Local Server tab → load a model first, then retry.",
    }, { status: 400 });
  }

  const client = new OpenAI({
    apiKey:  "lm-studio",
    baseURL,
    timeout: 120_000,
  });

  // Build messages — with vision fallback
  const buildMessages = (withImage: boolean): OpenAI.Chat.ChatCompletionMessageParam[] => {
    if (fileBase64 && withImage) {
      return [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:${mimeType ?? "image/jpeg"};base64,${fileBase64}` } },
        { type: "text", text: prompt ?? TAKEOFF_EXTRACTION_PROMPT },
      ]}];
    }
    // Text-only: include note about image if one was provided
    const note = fileBase64 ? "(Note: an image was provided but your model doesn't support vision — analyse based on context)\n" : "";
    return [{ role: "user", content: `${note}${prompt ?? TAKEOFF_EXTRACTION_PROMPT}\n\nDocument:\n${textContent ?? ""}` }];
  };

  const callLm = async (withImage: boolean) => client.chat.completions.create({
    model:       model ?? autoModel ?? "local-model",
    max_tokens:  4096,
    temperature: 0.3,
    messages:    buildMessages(withImage),
  });

  try {
    let response;
    try {
      response = await callLm(!!fileBase64);
    } catch (firstErr: unknown) {
      const firstMsg = firstErr instanceof Error ? firstErr.message : "";
      // If LM Studio rejects the image (model is text-only), retry without it
      if (fileBase64 && (firstMsg.includes("image") || firstMsg.includes("400") || firstMsg.includes("vision"))) {
        response = await callLm(false);
      } else {
        throw firstErr;
      }
    }

    const text = response.choices[0]?.message?.content ?? "";
    let items: unknown[] = [];
    try {
      const m = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\[[\s\S]*?\]/);
      if (m) items = JSON.parse(m[1] ?? m[0]);
    } catch {}

    return NextResponse.json({
      provider: "lmstudio",
      model:    model ?? autoModel ?? response.model ?? "local-model",
      items, rawText: text,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const isVision = msg.includes("image") || msg.includes("vision") || msg.includes("400");
    return NextResponse.json({
      error: `LM Studio error: ${msg}`,
      hint: isVision
        ? "Your model doesn't support vision/images. Load a multimodal model in LM Studio (e.g. LLaVA, Qwen2-VL, MiniCPM-V)"
        : "Make sure a model is loaded in LM Studio and Local Server is running",
    }, { status: 500 });
  }
}
