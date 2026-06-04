"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Layers, RefreshCw, ExternalLink, Terminal, CheckCircle2, AlertCircle, Download } from "lucide-react";

// AutoCAD Color Index (ACI) palette
const ACI: Record<number, string> = {
  1:"#ff2020", 2:"#ffff20", 3:"#20ff20", 4:"#20ffff", 5:"#2060ff",
  6:"#ff20ff", 7:"#e0e0e0", 8:"#808080", 9:"#c0c0c0",
  10:"#ff4040", 20:"#ff8020", 30:"#ffbf00", 40:"#dfdf00",
  50:"#80ff20", 60:"#20ff80", 70:"#20ffdf", 80:"#20a0ff",
  90:"#2020ff", 100:"#8020ff", 110:"#df20ff", 120:"#ff20a0",
  250:"#444", 251:"#666", 252:"#888", 253:"#aaa", 254:"#ccc", 255:"#eee",
};
const aci = (n: number) => ACI[Math.abs(n)] ?? "#c8d0d8";

interface DxfLayer { name: string; color: number; visible: boolean }

interface Solution {
  id: string; label: string; desc: string; cmd?: string;
  url?: string; primary?: boolean;
}

interface Props {
  fileUrl: string;
  fileFormat: string;
  onLayersLoaded?: (layers: DxfLayer[]) => void;
}

export function DxfRenderer({ fileUrl, fileFormat, onLayersLoaded }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<
    "loading" | "converting" | "parsing" | "rendering" | "ok" | "no_converter" | "error"
  >("loading");
  const [msg, setMsg]             = useState("");
  const [error, setError]         = useState("");
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [entities, setEntities]   = useState(0);
  const [layers, setLayers]       = useState(0);
  const [source, setSource]       = useState("");
  const [retryIn, setRetryIn]     = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callback in a ref so it never triggers useCallback/useEffect re-runs
  const onLayersLoadedRef = useRef(onLayersLoaded);
  useEffect(() => { onLayersLoadedRef.current = onLayersLoaded; });

  const load = useCallback(async () => {
    setPhase("loading");
    setError("");
    setSolutions([]);
    setMsg("");

    try {
      let dxfText = "";

      // ── DWG: auto-convert ─────────────────────────────────────
      if (fileFormat === "DWG") {
        setPhase("converting");
        setMsg("Connecting to conversion service…");

        const res = await fetch("/api/convert/dwg", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl }),
        });

        const ct = res.headers.get("content-type") ?? "";

        if (res.ok && ct.includes("text")) {
          const text = await res.text();
          if (text.includes("SECTION") || text.includes("ENTITIES") || text.includes("EOF")) {
            dxfText = text;
            setSource(res.headers.get("X-Source") ?? "converted");
            setMsg("Converted successfully!");
          } else {
            throw new Error("Server returned non-DXF content");
          }
        } else {
          const data = await res.json().catch(() => ({}));
          if (data.reason === "no_converter") {
            setPhase("no_converter");
            setSolutions(data.solutions ?? []);
            // Auto-retry every 8 seconds while user starts backend
            startAutoRetry();
            return;
          }
          throw new Error(data.error ?? `Conversion failed (${res.status})`);
        }
      } else {
        // ── DXF: fetch directly ───────────────────────────────────
        setPhase("loading");
        setMsg("Fetching DXF file…");
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`File fetch failed: HTTP ${res.status}`);
        dxfText = await res.text();
      }

      // ── Parse DXF ─────────────────────────────────────────────
      setPhase("parsing");
      setMsg(`Parsing DXF… (${(dxfText.length / 1024).toFixed(0)} KB)`);

      const DxfParser = (await import("dxf-parser")).default;
      const dxf = new DxfParser().parseSync(dxfText);
      if (!dxf) throw new Error("DXF parser returned null — file may be corrupted");

      // Extract layers
      const layerMap = (dxf.tables?.layer?.layers ?? {}) as Record<string, { color?: number }>;
      const parsedLayers: DxfLayer[] = Object.entries(layerMap).map(([name, l]) => ({
        name, color: Math.abs(l.color ?? 7), visible: true,
      }));
      if (!parsedLayers.length) parsedLayers.push({ name: "0", color: 7, visible: true });
      setLayers(parsedLayers.length);
      onLayersLoadedRef.current?.(parsedLayers);

      // Extract entities
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ents: any[] = dxf.entities ?? [];
      setEntities(ents.length);
      setMsg(`Rendering ${ents.length} entities…`);

      // ── Render to canvas ──────────────────────────────────────
      setPhase("rendering");
      renderToCanvas(ents, parsedLayers, layerMap);
      setPhase("ok");
      setMsg("");

    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }, [fileUrl, fileFormat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [fileUrl, fileFormat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-retry while user starts the backend
  const startAutoRetry = useCallback(() => {
    let count = 8;
    setRetryIn(count);
    const tick = () => {
      count -= 1;
      setRetryIn(count);
      if (count <= 0) {
        load();
      } else {
        retryTimer.current = setTimeout(tick, 1000);
      }
    };
    retryTimer.current = setTimeout(tick, 1000);
  }, [load]); // startAutoRetry depends on load, keep as-is

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderToCanvas(ents: any[], layerList: DxfLayer[], layerMap: Record<string, { color?: number }>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 900, H = 700;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    if (!ents.length) {
      ctx.fillStyle = "#334155";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No drawable entities found in this DXF file", W / 2, H / 2);
      return;
    }

    // Compute bounding box
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pts: { x: number; y: number }[] = [];
    for (const e of ents) {
      if (e.startPoint) pts.push(e.startPoint);
      if (e.endPoint)   pts.push(e.endPoint);
      if (e.center)     pts.push(e.center);
      if (e.position)   pts.push(e.position);
      if (e.vertices)   pts.push(...(e.vertices as { x: number; y: number }[]));
      if (e.controlPoints) pts.push(...(e.controlPoints as { x: number; y: number }[]));
    }
    if (!pts.length) return;

    const xs = pts.map(p => p.x).filter(isFinite);
    const ys = pts.map(p => p.y).filter(isFinite);
    if (!xs.length) return;

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rX = (maxX - minX) || 1, rY = (maxY - minY) || 1;
    const pad = 48;
    const sc = Math.min((W - pad * 2) / rX, (H - pad * 2) / rY) * 0.97;
    const ox = pad + (W - pad * 2 - rX * sc) / 2 - minX * sc;
    const oy = H - pad - (H - pad * 2 - rY * sc) / 2 + minY * sc;
    const tx = (x: number) => x * sc + ox;
    const ty = (y: number) => -y * sc + oy;

    const visLayers = new Set(layerList.filter(l => l.visible).map(l => l.name));

    for (const e of ents) {
      const layer = e.layer ?? "0";
      if (!visLayers.has(layer)) continue;

      let colorCode = e.color ?? 256;
      if (colorCode === 0 || colorCode === 256) colorCode = Math.abs(layerMap[layer]?.color ?? 7);
      const stroke = aci(colorCode);

      ctx.strokeStyle = stroke;
      ctx.fillStyle   = stroke;
      ctx.lineWidth   = 0.75;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";

      switch (e.type) {
        case "LINE":
          if (e.startPoint && e.endPoint) {
            ctx.beginPath();
            ctx.moveTo(tx(e.startPoint.x), ty(e.startPoint.y));
            ctx.lineTo(tx(e.endPoint.x),   ty(e.endPoint.y));
            ctx.stroke();
          }
          break;

        case "LWPOLYLINE":
        case "POLYLINE":
          if (e.vertices?.length > 1) {
            ctx.beginPath();
            ctx.moveTo(tx(e.vertices[0].x), ty(e.vertices[0].y));
            for (let i = 1; i < e.vertices.length; i++) {
              ctx.lineTo(tx(e.vertices[i].x), ty(e.vertices[i].y));
            }
            if (e.closed) ctx.closePath();
            ctx.stroke();
          }
          break;

        case "CIRCLE":
          if (e.center && e.radius > 0) {
            ctx.beginPath();
            ctx.arc(tx(e.center.x), ty(e.center.y), e.radius * sc, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;

        case "ARC":
          if (e.center && e.radius > 0) {
            const sa = -(e.startAngle ?? 0) * Math.PI / 180;
            const ea = -(e.endAngle   ?? 360) * Math.PI / 180;
            ctx.beginPath();
            ctx.arc(tx(e.center.x), ty(e.center.y), e.radius * sc, sa, ea, true);
            ctx.stroke();
          }
          break;

        case "ELLIPSE":
          if (e.center) {
            ctx.beginPath();
            ctx.ellipse(tx(e.center.x), ty(e.center.y),
              (e.majorAxisEndPoint?.x ?? 1) * sc,
              (e.majorAxisEndPoint?.y ?? 1) * sc * (e.axisRatio ?? 1),
              0, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;

        case "SPLINE":
          if (e.controlPoints?.length > 1) {
            ctx.beginPath();
            ctx.moveTo(tx(e.controlPoints[0].x), ty(e.controlPoints[0].y));
            for (let i = 1; i < e.controlPoints.length; i++) {
              ctx.lineTo(tx(e.controlPoints[i].x), ty(e.controlPoints[i].y));
            }
            ctx.stroke();
          }
          break;

        case "TEXT":
        case "MTEXT":
          if (e.position && e.text) {
            const fs = Math.max(7, Math.min(16, (e.height ?? 2.5) * sc));
            ctx.font = `${fs}px monospace`;
            ctx.fillStyle = stroke;
            ctx.fillText(
              e.text.replace(/\\P/g, " ").replace(/\\[a-zA-Z][^;]*;/g, "").slice(0, 100),
              tx(e.position.x), ty(e.position.y)
            );
          }
          break;

        case "POINT":
          if (e.position) {
            ctx.beginPath();
            ctx.arc(tx(e.position.x), ty(e.position.y), 2, 0, Math.PI * 2);
            ctx.fill();
          }
          break;

        case "SOLID":
        case "3DFACE":
          if (e.vertices?.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(tx(e.vertices[0].x), ty(e.vertices[0].y));
            for (let i = 1; i < Math.min(4, e.vertices.length); i++) {
              ctx.lineTo(tx(e.vertices[i].x), ty(e.vertices[i].y));
            }
            ctx.closePath();
            ctx.globalAlpha = 0.25;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.stroke();
          }
          break;
      }
    }

    // Watermark
    ctx.fillStyle = "rgba(255,255,255,.1)";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${ents.length} entities · ${Object.keys(layerMap).length} layers`, W - 12, H - 10);
  }

  // ── Loading / Converting ─────────────────────────────────────
  if (phase === "loading" || phase === "converting" || phase === "parsing" || phase === "rendering") {
    const steps = ["Connecting", "Converting", "Parsing", "Rendering"];
    const currentStep = phase === "loading" ? 0 : phase === "converting" ? 1 : phase === "parsing" ? 2 : 3;

    return (
      <div style={{
        width: 900, height: 700, background: "#0d1117",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 20,
      }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "#1e3a5f", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Loader2 size={32} color="#38bdf8" className="spin" />
        </div>

        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#f1f5f9", fontSize: 16, fontWeight: 700 }}>
            {fileFormat === "DWG" ? "Auto-converting DWG → DXF" : "Loading DXF drawing"}
          </p>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>{msg}</p>
        </div>

        {/* Step indicators */}
        {fileFormat === "DWG" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {steps.map((s, i) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", borderRadius: 99,
                  background: i < currentStep ? "#166534" : i === currentStep ? "#1e3a5f" : "#1e293b",
                  border: `1px solid ${i <= currentStep ? "#22c55e30" : "#334155"}`,
                }}>
                  {i < currentStep && <CheckCircle2 size={11} color="#22c55e" />}
                  {i === currentStep && <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#38bdf8" }} className="pulse" />}
                  <span style={{ fontSize: 11, color: i <= currentStep ? "#e2e8f0" : "#475569", fontWeight: 600 }}>{s}</span>
                </div>
                {i < steps.length - 1 && <span style={{ color: "#334155", fontSize: 14 }}>›</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── No converter ──────────────────────────────────────────────
  if (phase === "no_converter") {
    const primary = solutions.find(s => s.primary);
    const others  = solutions.filter(s => !s.primary);

    return (
      <div style={{
        width: 900, height: 700, background: "#0d1117",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 16, padding: "32px 40px", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#1e293b", border: "1px solid #334155", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <Terminal size={26} color="#f59e0b" />
          </div>
          <p style={{ color: "#f1f5f9", fontSize: 18, fontWeight: 800 }}>DWG Auto-Conversion</p>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
            DWG is Autodesk's binary format — needs a converter running on the server.
          </p>
        </div>

        {/* Auto-retry indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 99, background: "#1e293b", border: "1px solid #334155" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b" }} className="pulse" />
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Auto-retrying in <strong style={{ color: "#f1f5f9" }}>{retryIn}s</strong>… Start backend then wait
          </span>
          <button onClick={load} style={{ background: "#2563eb", border: "none", color: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
            Retry now
          </button>
        </div>

        {/* Primary solution */}
        {primary && (
          <div style={{ width: "100%", maxWidth: 500, background: "#0f2d1a", border: "1px solid #166534", borderRadius: 14, padding: "16px 20px" }}>
            <p style={{ color: "#22c55e", fontSize: 13, fontWeight: 800, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 size={14} /> {primary.label}
            </p>
            <p style={{ color: "#86efac", fontSize: 12, marginBottom: 10 }}>{primary.desc}</p>
            <div style={{ background: "#022c22", borderRadius: 8, padding: "10px 14px" }}>
              <p style={{ color: "#4ade80", fontSize: 11, fontFamily: "monospace", userSelect: "all" }}>
                {primary.cmd}
              </p>
            </div>
            <p style={{ color: "#166534", fontSize: 11, marginTop: 8 }}>
              💡 After starting, the DWG will auto-convert when the timer above hits 0
            </p>
          </div>
        )}

        {/* Other solutions */}
        <div style={{ width: "100%", maxWidth: 500, display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ color: "#475569", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
            Or convert manually:
          </p>
          {others.map(s => (
            <div key={s.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>
                {s.id === "libredwg" ? "⚡" : s.id === "oda" ? "🔧" : "🌐"}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{s.label}</p>
                <p style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.desc}</p>
                {s.cmd && (
                  <code style={{ display: "block", marginTop: 6, fontSize: 10, color: "#94a3b8", fontFamily: "monospace", background: "#0f172a", padding: "4px 8px", borderRadius: 4, userSelect: "all" }}>
                    {s.cmd}
                  </code>
                )}
              </div>
              {s.url && (
                <a href={s.url} target="_blank" rel="noopener noreferrer"
                  style={{ color: "#38bdf8", padding: 4, flexShrink: 0 }}>
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────
  if (phase === "error") return (
    <div style={{
      width: 900, height: 700, background: "#0d1117",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 14,
    }}>
      <AlertCircle size={36} color="#ef4444" />
      <p style={{ color: "#fca5a5", fontSize: 14, fontWeight: 700 }}>Failed to load drawing</p>
      <p style={{ color: "#64748b", fontSize: 12, maxWidth: 400, textAlign: "center" }}>{error}</p>
      <button onClick={load} style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "#2563eb", color: "#fff", border: "none",
        borderRadius: 9, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
      }}>
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  );

  // ── Success ───────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: 4, boxShadow: "0 8px 40px rgba(0,0,0,.5)" }} />

      {/* Info badge */}
      <div style={{
        position: "absolute", top: 10, right: 10,
        display: "flex", alignItems: "center", gap: 6,
        background: "rgba(13,17,23,.9)", color: "#64748b",
        fontSize: 11, fontWeight: 600, padding: "5px 12px",
        borderRadius: 99, backdropFilter: "blur(4px)", border: "1px solid #1e293b",
      }}>
        <Layers size={11} />
        {layers} layers · {entities} entities
        {source && <span style={{ color: "#22c55e", marginLeft: 4 }}>● {source}</span>}
      </div>
    </div>
  );
}
