import { NextResponse } from "next/server";
import OpenAI from "openai";

// LM Studio uses OpenAI-compatible API — full streaming support
export async function POST(request: Request) {
  const body = await request.json();
  const {
    message, history = [], model, system,
    fileBase64, mimeType, stream: doStream = true,
  } = body;

  const baseUrl  = (
    body.baseUrl ??
    process.env.LMSTUDIO_BASE_URL ??
    "http://localhost:1234/v1"
  ).replace(/\/+$/, "");

  // Auto-detect first loaded model if none specified (or "local-model" placeholder)
  let modelId = (!model || model === "local-model") ? undefined : model;
  try {
    const modelsRes = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
    if (modelsRes.ok) {
      const modelsData = await modelsRes.json();
      const first = modelsData?.data?.[0]?.id;
      if (first) modelId = modelId ?? first;
    }
  } catch {
    return NextResponse.json({
      error: "LM Studio is not running. Open LM Studio → load a model → Start Local Server.",
    }, { status: 503 });
  }

  if (!modelId) {
    return NextResponse.json({
      error: "No models loaded in LM Studio. Please load a model in the Local Server tab.",
    }, { status: 400 });
  }

  // OpenAI SDK with LM Studio base URL
  const client = new OpenAI({
    apiKey:  "lm-studio", // LM Studio doesn't need a real key
    baseURL: baseUrl,
    timeout: 120_000,     // LM Studio can be slow on first token
  });

  const DEFAULT_SYSTEM = `You are an expert construction estimator AI assistant running locally via LM Studio.
You help with:
- Material takeoff and quantity estimation from architectural drawings
- BOQ (Bill of Quantities) preparation
- Cost estimation
- Building analysis

Be precise, practical, and cite quantities when relevant.`;

  const isImageError = (msg: string) =>
    msg.includes("image") || msg.includes("400") || msg.includes("vision") || msg.includes("multimodal");

  // Build messages with or without the image attachment
  const buildMessages = (withImage: boolean): OpenAI.Chat.ChatCompletionMessageParam[] => {
    const base: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system ?? DEFAULT_SYSTEM },
      ...history.slice(-10).map((h: { role: string; content: string }) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
    ];
    if (withImage && fileBase64 && mimeType?.startsWith("image/")) {
      base.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
          { type: "text", text: message },
        ],
      });
    } else {
      // Text-only: prepend a note so the model knows an image was provided but not shown
      const prefix = (fileBase64 && withImage === false)
        ? "[Note: an image was provided but this model is text-only — please estimate based on the description]\n"
        : "";
      base.push({ role: "user", content: prefix + message });
    }
    return base;
  };

  // ── Streaming response ────────────────────────────────────────
  if (doStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (text: string) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));

        const tryStream = async (withImage: boolean) => {
          const completion = await client.chat.completions.create({
            model: modelId,
            messages: buildMessages(withImage),
            stream: true,
            temperature: 0.7,
            max_tokens: 4096,
          });
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) send(delta);
          }
        };

        try {
          await tryStream(true);
        } catch (err) {
          const msg = (err as Error).message;
          if (fileBase64 && isImageError(msg)) {
            // Model doesn't support vision — retry text-only with a note
            send("_(Text-only mode — model doesn't support vision images)_\n\n");
            try {
              await tryStream(false);
            } catch (err2) {
              send(`\n\n⚠️ Error: ${(err2 as Error).message}`);
            }
          } else if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("timeout")) {
            send("\n\n⚠️ **LM Studio is not running.**\n1. Open LM Studio\n2. Load a model\n3. Start Local Server (port 1234)\n4. Try again");
          } else {
            send(`\n\n⚠️ Error: ${msg}`);
          }
        } finally {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
      },
    });
  }

  // ── Non-streaming (takeoff extraction) ───────────────────────
  const tryNonStream = async (withImage: boolean) =>
    client.chat.completions.create({
      model: modelId,
      messages: buildMessages(withImage),
      stream: false,
      temperature: 0.3,
      max_tokens: 4096,
    });

  try {
    let completion;
    let usedTextOnly = false;
    try {
      completion = await tryNonStream(true);
    } catch (firstErr: unknown) {
      const msg = (firstErr as Error).message;
      if (fileBase64 && isImageError(msg)) {
        // Text-only fallback
        completion = await tryNonStream(false);
        usedTextOnly = true;
      } else {
        throw firstErr;
      }
    }

    const text = completion.choices[0]?.message?.content ?? "";
    let items: unknown[] = [];
    try {
      const match = text.match(/```json\n?([\s\S]*?)\n?```/) ?? text.match(/\[[\s\S]*?\]/);
      if (match) items = JSON.parse(match[1] ?? match[0]);
    } catch {}

    return NextResponse.json({
      text, items, model: modelId, provider: "lmstudio",
      ...(usedTextOnly && { warning: "Model doesn't support vision — text-only analysis used. For better results, load a multimodal model (LLaVA, Qwen2-VL, MiniCPM-V)." }),
    });

  } catch (err) {
    const msg = (err as Error).message;
    const isVisionErr = isImageError(msg);
    return NextResponse.json({
      error: "LM Studio error: " + msg,
      hint: isVisionErr
        ? "Your model ('" + modelId + "') doesn't support images. Load a multimodal model in LM Studio: LLaVA, Qwen2-VL, MiniCPM-V, Moondream, etc."
        : "Make sure LM Studio is running with a model loaded and Local Server is started (port 1234)",
    }, { status: isVisionErr ? 422 : 503 });
  }
}
