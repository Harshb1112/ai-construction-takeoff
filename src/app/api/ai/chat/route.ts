import OpenAI from "openai";

const DEFAULT_SYSTEM = `You are an expert construction estimator and AI assistant for AI Construction Takeoff platform.
You help with material takeoff, BOQ preparation, cost estimation, scheduling, and analyzing architectural drawings.
Be concise, practical, and specific with quantities and measurements.`;

export async function POST(request: Request) {
  try {
    const {
      message, history = [], provider = "lmstudio",
      systemOverride, fileBase64, mimeType,
      lmModel,
    } = await request.json();

    const system = systemOverride ?? DEFAULT_SYSTEM;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (text: string) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));

        try {
          // ── LM Studio (explicit local provider) ──────────
          if (provider === "lmstudio") {
            const lmBaseUrl = (process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1").replace(/\/+$/, "");

            // Auto-detect first loaded model
            let resolvedModel = (!lmModel || lmModel === "local-model") ? undefined : lmModel;
            try {
              const modelsRes = await fetch(`${lmBaseUrl}/models`, { signal: AbortSignal.timeout(5000) });
              if (modelsRes.ok) {
                const md = await modelsRes.json();
                const first = md?.data?.[0]?.id;
                if (first) resolvedModel = resolvedModel ?? first;
              }
            } catch {
              send("⚠️ **LM Studio is not running.** Open LM Studio → Load a model → Start Local Server.");
              return;
            }
            if (!resolvedModel) {
              send("⚠️ **No model loaded in LM Studio.** Go to the Local Server tab, load a model, then try again.");
              return;
            }

            const lm = new OpenAI({ apiKey: "lm-studio", baseURL: lmBaseUrl, timeout: 120_000 });
            const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [
              { role: "system", content: system },
              ...history.slice(-8).map((h: { role: string; content: string }) => ({
                role: h.role as "user" | "assistant", content: h.content,
              })),
            ];
            if (fileBase64 && mimeType?.startsWith("image/")) {
              msgs.push({ role: "user", content: [
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
                { type: "text", text: message },
              ]});
            } else {
              msgs.push({ role: "user", content: message });
            }
            try {
              const lmStream = await lm.chat.completions.create({
                model: resolvedModel,
                messages: msgs,
                stream: true,
                max_tokens: 4096,
                temperature: 0.7,
              });
              for await (const chunk of lmStream) {
                const delta = chunk.choices[0]?.delta?.content;
                if (delta) send(delta);
              }
            } catch (lmErr) {
              const msg = (lmErr as Error).message;
              if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
                send("⚠️ **LM Studio is offline.** Please:\n1. Open LM Studio app\n2. Load any model\n3. Enable Local Server → Start\n4. Try again");
              } else {
                send(`⚠️ LM Studio error: ${msg}`);
              }
            }

          } else {
            send("⚠️ LM Studio is not connected. Go to **🤖 LM Studio AI** in the sidebar to connect.");
          }

        } catch (err) {
          send(`\n⚠️ Error: ${err instanceof Error ? err.message : "AI unavailable"}`);
        } finally {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch {
    return new Response(`data: ${JSON.stringify({ text: "Error processing request" })}\n\ndata: [DONE]\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
}
