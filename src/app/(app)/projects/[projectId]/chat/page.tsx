"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Send, Bot, User, Loader2, Trash2, Zap, Cpu, Wifi, WifiOff, RefreshCw } from "lucide-react";

interface Msg { role: "user"|"assistant"; content: string; id: string }
interface LmModel { id: string }

type Provider = "lmstudio";

const QUICK_PROMPTS = [
  "What materials do I need for a 2,000 sq ft house framing?",
  "Calculate concrete for a 4\" slab on 1,500 sq ft floor",
  "Standard waste factor for drywall installation?",
  "Generate BOQ for a 3-bedroom apartment",
  "Common scheduling risks for foundation work?",
  "How many 2×4 studs for a 20ft × 9ft wall at 16\" OC?",
];

const PROVIDERS: { id: Provider; label: string; desc: string; color: string }[] = [
  { id:"lmstudio", label:"LM Studio", desc:"Local · Private · No internet",  color:"#059669" },
];

export default function AiChatPage() {
  useParams<{ projectId: string; }>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const provider: Provider = "lmstudio";
  const [lmModels, setLmModels] = useState<LmModel[]>([]);
  const [lmModel, setLmModel] = useState("");
  const [lmStatus, setLmStatus] = useState<"checking"|"online"|"offline">("checking");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Get the saved LM Studio URL
  const getLmUrl = () => {
    if (typeof window === "undefined") return "http://localhost:1234/v1";
    return localStorage.getItem("lmstudio_url")
      ?? process.env.NEXT_PUBLIC_LMSTUDIO_BASE_URL
      ?? "http://localhost:1234/v1";
  };

  const checkLmStudio = useCallback(async () => {
    setLmStatus("checking");
    const lmUrl = getLmUrl();
    try {
      const res = await fetch(`/api/lmstudio/models?baseUrl=${encodeURIComponent(lmUrl)}`);
      const data = await res.json();
      if (data.status === "connected" && data.models?.length > 0) {
        setLmModels(data.models);
        setLmModel(data.models[0].id);
        setLmStatus("online");
      } else {
        setLmStatus("offline");
      }
    } catch {
      setLmStatus("offline");
    }
  }, []);

  // Check LM Studio on load
  useEffect(() => {
    checkLmStudio();
  }, [checkLmStudio]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const userText = text ?? input.trim();
    if (!userText || loading) return;

    const userMsg: Msg = { role:"user", content:userText, id:Date.now().toString() };
    const assistantId = (Date.now()+1).toString();
    setMessages(prev => [...prev, userMsg, { role:"assistant", content:"", id:assistantId }]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.slice(-10).map(({ role, content }) => ({ role, content }));

      // Route to correct endpoint
      const endpoint = provider === "lmstudio" ? "/api/lmstudio/chat" : "/api/ai/chat";
      const body: Record<string, unknown> = { message: userText, history, provider };
      if (provider === "lmstudio") {
        body.model   = lmModel || "local-model";
        body.baseUrl = getLmUrl(); // send saved URL to server
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const { text: t } = JSON.parse(data);
            if (t) setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: m.content + t } : m
            ));
          } catch {}
        }
      }
    } catch (e) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content:"Error: " + (e instanceof Error ? e.message : "Unknown") }
          : m
      ));
    } finally {
      setLoading(false);
    }
  };

  const activeProvider = PROVIDERS.find(p => p.id === provider)!;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:"80vh", background:"#f8fafc" }} className="fade-up">

      {/* Header */}
      <div style={{ padding:"16px 22px", background:"#fff", borderBottom:"1px solid #e2e8f0", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:38, height:38, borderRadius:12, background:`${activeProvider.color}18`, display:"flex", alignItems:"center", justifyContent:"center" }}>
            {provider==="lmstudio" ? <Cpu size={18} color={activeProvider.color}/> : <Bot size={18} color={activeProvider.color}/>}
          </div>
          <div>
            <p style={{ fontSize:14, fontWeight:700, color:"#0f172a" }}>AI Construction Assistant</p>
            <p style={{ fontSize:11, color:"#94a3b8" }}>Ask anything about takeoff, materials, BOQ, costs</p>
          </div>
        </div>

        {/* LM Studio status badge */}
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background: lmStatus==="online"?"#16a34a":lmStatus==="checking"?"#d97706":"#dc2626" }} />
          <span style={{ fontSize:11, fontWeight:700, color: lmStatus==="online"?"#059669":lmStatus==="checking"?"#d97706":"#dc2626" }}>
            {lmStatus==="online" ? "LM Studio connected" : lmStatus==="checking" ? "Connecting to LM Studio…" : "LM Studio offline — go to 🤖 LM Studio AI to connect"}
          </span>
        </div>

        {/* LM Studio model selector */}
        {provider==="lmstudio" && (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:"auto" }}>
            {lmStatus==="online" ? (
              <>
                <Wifi size={14} color="#16a34a"/>
                <select aria-label="Select LM Studio model" value={lmModel} onChange={e => setLmModel(e.target.value)} style={{ padding:"5px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12, background:"#fff", maxWidth:200, cursor:"pointer" }}>
                  {lmModels.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              </>
            ) : lmStatus==="checking" ? (
              <><RefreshCw size={14} color="#d97706" className="spin"/><span style={{ fontSize:12, color:"#d97706" }}>Checking LM Studio…</span></>
            ) : (
              <>
                <WifiOff size={14} color="#dc2626"/>
                <span style={{ fontSize:12, color:"#dc2626" }}>LM Studio offline</span>
                <button onClick={checkLmStudio} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #fecaca", background:"#fff", fontSize:11, cursor:"pointer", color:"#dc2626" }}>
                  Retry
                </button>
              </>
            )}
          </div>
        )}

        <button onClick={() => setMessages([])} style={{ marginLeft:"auto", padding:"6px 12px", borderRadius:8, border:"1px solid #e2e8f0", background:"#fff", cursor:"pointer", display:"flex", alignItems:"center", gap:6, fontSize:12, color:"#64748b" }}>
          <Trash2 size={13}/> Clear
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:"auto", padding:"20px 22px", display:"flex", flexDirection:"column", gap:16 }}>
        {messages.length === 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }} className="fade-up">
            {/* Welcome */}
            <div style={{ textAlign:"center", padding:"24px 0 8px" }}>
              <div style={{ width:60, height:60, borderRadius:20, background:`${activeProvider.color}18`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
                {provider==="lmstudio" ? <Cpu size={28} color={activeProvider.color}/> : <Bot size={28} color={activeProvider.color}/>}
              </div>
              <p style={{ fontSize:16, fontWeight:800, color:"#0f172a" }}>
                {provider==="lmstudio" ? `LM Studio — ${lmModel || "Local Model"}` : `${activeProvider.label} Assistant`}
              </p>
              <p style={{ fontSize:13, color:"#64748b", marginTop:4 }}>{activeProvider.desc}</p>
              {provider==="lmstudio" && lmStatus==="offline" && (
                <div style={{ marginTop:12, padding:"10px 16px", borderRadius:10, border:"1px solid #fecaca", background:"#fef2f2", textAlign:"left", maxWidth:400, margin:"12px auto 0" }}>
                  <p style={{ fontSize:12, fontWeight:700, color:"#dc2626", marginBottom:6 }}>LM Studio setup required:</p>
                  <ol style={{ fontSize:12, color:"#7f1d1d", paddingLeft:16, lineHeight:1.8 }}>
                    <li>Open <strong>LM Studio</strong> app</li>
                    <li>Go to <strong>Developer</strong> tab</li>
                    <li>Click <strong>Start Server</strong></li>
                    <li>Load any model from <strong>Models</strong> tab</li>
                    <li>Click <strong>Retry</strong> above ↑</li>
                  </ol>
                </div>
              )}
            </div>

            {/* Quick prompts */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {QUICK_PROMPTS.map(q => (
                <button key={q} onClick={() => sendMessage(q)} style={{
                  background:"#fff", border:"1px solid #e2e8f0", borderRadius:12,
                  padding:"10px 14px", textAlign:"left", fontSize:12, color:"#374151",
                  cursor:"pointer", display:"flex", alignItems:"flex-start", gap:8,
                  transition:"all .15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = activeProvider.color; (e.currentTarget as HTMLElement).style.background = `${activeProvider.color}08`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e2e8f0"; (e.currentTarget as HTMLElement).style.background = "#fff"; }}>
                  <Zap size={12} color={activeProvider.color} style={{ flexShrink:0, marginTop:1 }}/>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map(msg => (
          <div key={msg.id} style={{ display:"flex", gap:10, justifyContent: msg.role==="user" ? "flex-end" : "flex-start" }}>
            {msg.role==="assistant" && (
              <div style={{ width:32, height:32, borderRadius:10, background:`${activeProvider.color}18`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                {provider==="lmstudio" ? <Cpu size={15} color={activeProvider.color}/> : <Bot size={15} color={activeProvider.color}/>}
              </div>
            )}
            <div style={{
              maxWidth:"82%", padding:"11px 15px", borderRadius:16, fontSize:13, lineHeight:1.65,
              whiteSpace:"pre-wrap",
              background: msg.role==="user" ? `linear-gradient(135deg,${activeProvider.color},${activeProvider.color}cc)` : "#fff",
              color: msg.role==="user" ? "#fff" : "#0f172a",
              border: msg.role==="assistant" ? "1px solid #e2e8f0" : "none",
              borderTopLeftRadius: msg.role==="assistant" ? 4 : 16,
              borderTopRightRadius: msg.role==="user" ? 4 : 16,
              boxShadow: msg.role==="user" ? `0 2px 12px ${activeProvider.color}30` : "0 1px 4px rgba(0,0,0,.05)",
            }}>
              {msg.content === "" && loading ? (
                <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                  {[0,150,300].map(d => (
                    <div key={d} style={{ width:7, height:7, borderRadius:"50%", background:activeProvider.color, animationDelay:`${d}ms` }} className="pulse"/>
                  ))}
                </div>
              ) : msg.content}
            </div>
            {msg.role==="user" && (
              <div style={{ width:32, height:32, borderRadius:10, background:"#f1f5f9", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <User size={15} color="#64748b"/>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{ padding:"14px 22px", background:"#fff", borderTop:"1px solid #e2e8f0" }}>
        <div style={{ display:"flex", gap:10 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder={provider==="lmstudio" && lmStatus==="offline" ? "Start LM Studio first…" : "Ask about materials, quantities, costs…"}
            disabled={provider==="lmstudio" && lmStatus==="offline"}
            rows={2}
            style={{
              flex:1, padding:"10px 14px", borderRadius:12, border:"1px solid #e2e8f0",
              fontSize:13, color:"#0f172a", outline:"none", resize:"none",
              fontFamily:"inherit", lineHeight:1.5,
              background: provider==="lmstudio" && lmStatus==="offline" ? "#f8fafc" : "#fff",
            }}
            onFocus={e => (e.target.style.borderColor = activeProvider.color)}
            onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading || (provider==="lmstudio" && lmStatus==="offline")}
            style={{
              width:46, borderRadius:12, border:"none",
              background: !input.trim() || loading ? "#e2e8f0" : `linear-gradient(135deg,${activeProvider.color},${activeProvider.color}cc)`,
              cursor: !input.trim() || loading ? "not-allowed" : "pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              transition:"all .15s",
            }}
          >
            {loading ? <Loader2 size={17} color="#94a3b8" className="spin"/> : <Send size={17} color="#fff"/>}
          </button>
        </div>
        <p style={{ fontSize:11, color:"#94a3b8", textAlign:"center", marginTop:7 }}>
          {provider==="lmstudio" ? `LM Studio · ${lmModel||"local"} · 100% private · no data sent online` : `${activeProvider.label} · Enter to send · Shift+Enter for new line`}
        </p>
      </div>
    </div>
  );
}
