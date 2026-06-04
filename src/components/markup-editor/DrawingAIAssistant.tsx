"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, X, Sparkles, Loader2,
  MessageSquare, Zap, Cpu
} from "lucide-react";
import type { Drawing } from "@/types";
import { bufToBase64, getLmStudioUrl } from "@/lib/utils";

interface Msg { role: "user" | "assistant"; content: string; id: string }

const DRAWING_QUESTIONS = [
  "How many rooms are on this floor plan?",
  "What are the overall building dimensions?",
  "List all doors and windows with sizes",
  "Calculate total wall length",
  "What materials are specified?",
  "Identify structural elements",
  "What scale is this drawing?",
  "List all room areas in sq ft",
];

interface Props {
  drawing: Drawing;
  projectId: string;
  onAddToTakeoff?: (items: { description: string; quantity: number; unit: string }[]) => void;
}

export function DrawingAIAssistant({ drawing, projectId, onAddToTakeoff }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState("image/jpeg");
  const provider = "lmstudio" as const;
  const lmUrl = getLmStudioUrl();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Pre-load the drawing image as base64 for AI
  useEffect(() => {
    if (!drawing.fileUrl) return;
    const mime = drawing.fileFormat === "PDF" ? "application/pdf"
      : drawing.fileFormat === "PNG" ? "image/png" : "image/jpeg";
    setImageMime(mime);

    // For images and PDFs, fetch and convert to base64
    fetch(drawing.fileUrl)
      .then(r => r.arrayBuffer())
      .then(buf => {
        const b64 = bufToBase64(buf);
        setImageBase64(b64);
      })
      .catch(() => setImageBase64(null));
  }, [drawing.fileUrl, drawing.fileFormat]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ask = useCallback(async (question: string) => {
    if (!question.trim() || loading) return;
    setInput("");
    setLoading(true);

    const userMsg: Msg = { role: "user", content: question, id: Date.now().toString() };
    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, userMsg, { role: "assistant", content: "", id: assistantId }]);

    try {
      const systemPrompt = `You are an expert construction estimator and architectural analyst.
You are analyzing a drawing file: "${drawing.originalName}" (${drawing.fileFormat} format).

When analyzing:
- Be specific with measurements and quantities
- If you see room labels, list them with estimated areas
- Identify walls, doors, windows, structural elements
- Suggest takeoff quantities where possible
- Format numbers clearly

If the user asks to "add to takeoff" or wants quantities extracted, respond with a JSON block like:
\`\`\`takeoff
[{"description":"2x4 Studs","quantity":45,"unit":"EA"},{"description":"Drywall 1/2\"","quantity":320,"unit":"SF"}]
\`\`\``;

      // Use SSE streaming chat
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          history: messages.slice(-6).map(({ role, content }) => ({ role, content })),
          provider,
          lmModel: provider === "lmstudio" ? (localStorage.getItem("lmstudio_model") || undefined) : undefined,
          systemOverride: systemPrompt,
          fileBase64: imageBase64,
          mimeType: imageMime,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") break;
              try {
                const { text } = JSON.parse(data);
                if (text) {
                  fullText += text;
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, content: fullText } : m
                  ));
                }
              } catch {}
            }
          }
        }
      }

      // Auto-detect takeoff JSON in response
      const takeoffMatch = fullText.match(/```takeoff\n?([\s\S]*?)\n?```/);
      if (takeoffMatch && onAddToTakeoff) {
        try {
          const items = JSON.parse(takeoffMatch[1]);
          onAddToTakeoff(items);
        } catch {}
      }

    } catch (e) {
      const hint = provider === "lmstudio" ? "LM Studio offline — open app, load a model, start Local Server."
        : provider === "groq" ? "Check GROQ_API_KEY in .env.local"
        : "Check ANTHROPIC_API_KEY in .env.local";
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: `Error: Could not connect to AI. ${hint}` } : m
      ));
    } finally {
      setLoading(false);
    }
  }, [loading, messages, drawing, imageBase64, imageMime, onAddToTakeoff]);

  const formatContent = (content: string) => {
    // Hide the raw takeoff JSON block, show a nice button instead
    return content.replace(/```takeoff[\s\S]*?```/g, "✅ Items added to Takeoff!");
  };

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "absolute", bottom: 80, right: 12, zIndex: 50,
            display: "flex", alignItems: "center", gap: 8,
            background: "linear-gradient(135deg,#2563eb,#7c3aed)",
            color: "#fff", padding: "10px 16px", borderRadius: 99,
            border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            boxShadow: "0 4px 20px rgba(37,99,235,.4)",
            transition: "transform .2s, box-shadow .2s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.transform = "scale(1.05)";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 28px rgba(37,99,235,.5)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.transform = "scale(1)";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(37,99,235,.4)";
          }}
        >
          <Sparkles size={15} />
          Ask AI about this drawing
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="slide-in"
          style={{
            position: "absolute", bottom: 0, right: 0, zIndex: 50,
            width: 360, height: "100%", maxHeight: "100%",
            background: "#fff",
            borderLeft: "1px solid #e2e8f0",
            display: "flex", flexDirection: "column",
            boxShadow: "-8px 0 32px rgba(0,0,0,.08)",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "14px 16px", borderBottom: "1px solid #f1f5f9",
            background: "linear-gradient(135deg,#2563eb,#7c3aed)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bot size={16} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1 }}>Drawing AI Assistant</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,.75)", marginTop: 2 }}>
                {imageBase64 ? "✓ Drawing loaded · LM Studio" : "Loading drawing..."}
              </p>
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "rgba(255,255,255,.7)", background: "rgba(255,255,255,.1)", padding: "2px 8px", borderRadius: 99 }}>
              <Cpu size={9} /> LM Studio
            </span>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,.8)", padding: 4 }}>
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 16, background: "linear-gradient(135deg,#eff6ff,#dbeafe)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                    <MessageSquare size={22} color="#2563eb" />
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Ask anything about</p>
                  <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{drawing.originalName}</p>
                </div>

                <p style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em" }}>Quick questions:</p>
                {DRAWING_QUESTIONS.map(q => (
                  <button key={q} onClick={() => ask(q)} style={{
                    background: "#f8fafc", border: "1px solid #e2e8f0",
                    borderRadius: 10, padding: "9px 12px", textAlign: "left",
                    fontSize: 12, color: "#374151", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8,
                    transition: "all .15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#eff6ff"; (e.currentTarget as HTMLElement).style.borderColor = "#bfdbfe"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#f8fafc"; (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; }}
                  >
                    <Zap size={11} color="#2563eb" style={{ flexShrink: 0 }} />
                    {q}
                  </button>
                ))}
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "assistant" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Bot size={11} color="#fff" />
                    </div>
                    <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>AI Assistant</span>
                  </div>
                )}
                <div style={{
                  maxWidth: "90%",
                  padding: "10px 13px",
                  borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
                  background: msg.role === "user"
                    ? "linear-gradient(135deg,#2563eb,#3b82f6)"
                    : "#f8fafc",
                  color: msg.role === "user" ? "#fff" : "#0f172a",
                  border: msg.role === "assistant" ? "1px solid #e2e8f0" : "none",
                  fontSize: 13, lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}>
                  {msg.role === "assistant" && msg.content === "" && loading ? (
                    <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "2px 0" }}>
                      {[0, 150, 300].map(d => (
                        <div key={d} className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#2563eb", animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  ) : (
                    formatContent(msg.content)
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: 12, borderTop: "1px solid #f1f5f9", background: "#fff" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
                placeholder="Ask about this drawing... (Enter to send)"
                style={{
                  flex: 1, padding: "9px 12px",
                  borderRadius: 10, border: "1px solid #e2e8f0",
                  fontSize: 13, color: "#0f172a", outline: "none",
                  resize: "none", maxHeight: 100, minHeight: 40,
                  fontFamily: "inherit", lineHeight: 1.5,
                  background: "#f8fafc",
                }}
                rows={1}
                onFocus={e => (e.target.style.borderColor = "#2563eb")}
                onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
              />
              <button
                onClick={() => ask(input)}
                disabled={!input.trim() || loading}
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: loading || !input.trim() ? "#e2e8f0" : "linear-gradient(135deg,#2563eb,#7c3aed)",
                  border: "none", cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "all .15s",
                }}
              >
                {loading
                  ? <Loader2 size={15} color="#94a3b8" className="spin" />
                  : <Send size={15} color="#fff" />
                }
              </button>
            </div>
            <p style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 6 }}>
              LM Studio · Enter to send
            </p>
          </div>
        </div>
      )}
    </>
  );
}
