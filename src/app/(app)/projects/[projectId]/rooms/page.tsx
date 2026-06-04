"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  Upload, Wand2, Loader2, CheckCircle2, Download,
  ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight,
  Layers, Eye, EyeOff, X, Home, Bath, ChefHat,
  Sofa, ArrowLeftRight, Package, AlertCircle
} from "lucide-react";
import { bufToBase64, getLmStudioUrl, formatCurrency } from "@/lib/utils";
import { setupPdfWorker } from "@/lib/pdf-worker";
import { COST_DATABASE } from "@/lib/cost-database";

// Pull live rates from cost DB — no hardcoding
const _r = (id: string) => COST_DATABASE.find(c => c.id === id)?.prices?.us_national?.total ?? 0;
const COST_FLOOR_SF   = _r("09-0140"); // Hardwood Oak flooring   5.50/SF
const COST_DRYWALL_SF = _r("09-0100"); // Gypsum drywall walls     0.55/SF
const COST_CEIL_SF    = _r("09-0110"); // Drywall ceiling          0.65/SF
const COST_DOOR_EA    = _r("08-0100"); // Steel door 3'×7'         600/EA
const COST_WINDOW_EA  = _r("08-0120"); // Aluminum window          400/EA
import dynamic from "next/dynamic";

if (typeof window !== "undefined") setupPdfWorker();

const LmStudioModelPicker = dynamic(
  () => import("@/components/ui/LmStudioModelPicker").then(m => ({ default: m.LmStudioModelPicker })),
  { ssr: false }
);

// ─── Types ───────────────────────────────────────────────────────
interface Room {
  id: string; name: string; type: string;
  // Pixel coords in the ANALYSIS image space
  x: number; y: number; w: number; h: number;
  areaSqM: number; lengthM: number; widthM: number; heightM: number;
  wallAreaSqM: number; ceilingSqM: number; perimeterM: number;
  doorCount: number; windowCount: number;
  floor: string; confidence: number; notes?: string;
}
interface Opening { x: number; y: number; w: number; h: number; roomId?: string }
interface WallLine { x1: number; y1: number; x2: number; y2: number }
interface AnalysisResult {
  rooms: Room[]; doors?: Opening[]; windows?: Opening[];
  buildingOutline?: number[][]; wallLines?: WallLine[]; floorAreaSqM?: number;
  scale?: string; unit?: string;
  imageWidth: number; imageHeight: number;
  totalAreaSqM?: number; processingMs?: number; source?: string; pipeline?: string;
}

// ─── Room palette ─────────────────────────────────────────────────
const PALETTE: Record<string, { fill: string; stroke: string; icon: React.ElementType }> = {
  BEDROOM:  { fill: "#6366f120", stroke: "#6366f1", icon: Home },
  BATHROOM: { fill: "#0ea5e920", stroke: "#0ea5e9", icon: Bath },
  KITCHEN:  { fill: "#f59e0b20", stroke: "#f59e0b", icon: ChefHat },
  LIVING:   { fill: "#10b98120", stroke: "#10b981", icon: Sofa },
  DINING:   { fill: "#ec489920", stroke: "#ec4899", icon: ArrowLeftRight },
  CORRIDOR: { fill: "#94a3b820", stroke: "#94a3b8", icon: ArrowLeftRight },
  STORE:    { fill: "#8b5cf620", stroke: "#8b5cf6", icon: Package },
  BALCONY:  { fill: "#14b8a620", stroke: "#14b8a6", icon: Home },
  GARAGE:   { fill: "#64748b20", stroke: "#64748b", icon: Home },
  OTHER:    { fill: "#64748b15", stroke: "#64748b", icon: Home },
};
const pal = (t: string) => PALETTE[t] ?? PALETTE.OTHER;

type Provider = "lmstudio";

// ─── Render PDF page to base64 image (for AI analysis) ───────────
async function pdfPageToBase64(
  file: File, pageNum = 1
): Promise<{ base64: string; mimeType: string; canvasW: number; canvasH: number }> {
  setupPdfWorker();
  const { getDocument } = await import("pdfjs-dist");
  const buf  = await file.arrayBuffer();
  const pdf  = await getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await pdf.getPage(pageNum);
  const vp0  = page.getViewport({ scale: 1 });
  // Target ~2000px on the long side for good AI quality
  const scale = Math.min(3.0, 2000 / Math.max(vp0.width, vp0.height));
  const vp    = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // @ts-expect-error — pdfjs render params type varies by version
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return { base64: dataUrl.split(",")[1], mimeType: "image/jpeg", canvasW: canvas.width, canvasH: canvas.height };
}

async function imageFileToBase64(
  file: File
): Promise<{ base64: string; mimeType: string; canvasW: number; canvasH: number }> {
  const buf = await file.arrayBuffer();
  const base64 = bufToBase64(buf);
  const mimeType = file.type || "image/jpeg";
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ base64, mimeType, canvasW: img.naturalWidth, canvasH: img.naturalHeight }); };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── Main Component ───────────────────────────────────────────────
export default function FloorPlanPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient   = useQueryClient();

  // File + PDF state
  const [file, setFile]       = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string>("");
  const [isPdf, setIsPdf]     = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);

  // Render tracking — react-pdf tells us the rendered pixel size
  // PDF always renders at 900px CSS width; height is measured after render
  const renderW = 900;
  const [renderH, setRenderH] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);

  // Analysis
  const [loading, setLoading]   = useState(false);
  const [step, setStep]         = useState("");
  const [error, setError]       = useState("");
  const [result, setResult]     = useState<AnalysisResult | null>(null);

  // Overlay UI
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showOpenings, setShowOpenings] = useState(true);
  const [zoom, setZoom]             = useState(1.0);
  const [panelOpen, setPanelOpen]   = useState(true);

  // Click-to-Measure (Bluebeam Dynamic Fill style)
  const [clickMode, setClickMode]     = useState(false);
  const [clickLoading, setClickLoading] = useState(false);

  // AI config
  const provider: Provider = "lmstudio";
  const [lmModel, setLmModel]   = useState(() => typeof window !== "undefined" ? (localStorage.getItem("lmstudio_model") ?? "") : "");
  const [lmUrl]                 = useState(() => getLmStudioUrl());
  const [scaleHint, setScaleHint] = useState("1:100");

  // Takeoff
  const [importing, setImporting] = useState(false);
  const [imported, setImported]   = useState(false);

  // ── File selection ───────────────────────────────────────────────
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const pdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    setFile(f); setFileUrl(url); setIsPdf(pdf);
    setResult(null); setError(""); setStep(""); setPageNum(1); setImported(false);
  };

  // ── Measure rendered height once react-pdf finishes the page ────
  const measureHeight = useCallback(() => {
    if (pageRef.current) {
      const h = pageRef.current.offsetHeight || pageRef.current.clientHeight;
      if (h > 0) setRenderH(h);
    }
  }, []);

  // Also watch for layout changes (e.g. zoom)
  useEffect(() => {
    if (!pageRef.current) return;
    const obs = new ResizeObserver(() => measureHeight());
    obs.observe(pageRef.current);
    return () => obs.disconnect();
  }, [fileUrl, measureHeight]);

  // ── Scale SVG coords from analysis-image space → rendered space ──
  const scaleCoord = useCallback((room: Room) => {
    if (!result || result.imageWidth === 0 || result.imageHeight === 0 || renderH === 0) {
      return { x: room.x, y: room.y, w: room.w, h: room.h };
    }
    const sx = renderW / result.imageWidth;
    const sy = renderH / result.imageHeight;
    return {
      x: Math.round(room.x * sx),
      y: Math.round(room.y * sy),
      w: Math.round(room.w * sx),
      h: Math.round(room.h * sy),
    };
  }, [result, renderH]);

  const scaleOpening = useCallback((o: Opening) => {
    if (!result || result.imageWidth === 0) return o;
    const sx = renderW / result.imageWidth;
    const sy = (renderH || result.imageHeight) / result.imageHeight;
    return { ...o, x: Math.round(o.x * sx), y: Math.round(o.y * sy), w: Math.max(8, Math.round(o.w * sx)), h: Math.max(8, Math.round(o.h * sy)) };
  }, [result, renderH]);

  // ── Run AI analysis ─────────────────────────────────────────────
  const analyze = async () => {
    if (!file) return;
    setLoading(true); setError(""); setResult(null); setImported(false);
    try {
      // ── For PDFs: send the raw file directly to the Python ML server ──
      // The Python backend uses the PDF's vector text layer (CAD pipeline) which
      // is far more accurate than converting to JPEG first.
      if (isPdf) {
        setStep("Sending PDF to ML server (CAD vector pipeline)...");
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("scale_hint", scaleHint || "auto");
        fd.append("page", String(pageNum));

        const pyRes = await fetch("/api/floorplan", { method: "POST", body: fd });
        if (pyRes.ok) {
          const data = await pyRes.json();
          if (data.rooms?.length) {
            setResult(data);
            setSelectedId(data.rooms[0]?.id ?? null);
            setStep(`✓ ${data.rooms.length} rooms · ${data.pipeline ?? "ML"} · Scale ${data.scale ?? scaleHint}${data.processingMs ? ` · ${data.processingMs}ms` : ""}`);
            return;
          }
        }
        // Fallback: if Python backend is down or returned no rooms, try image AI
        setStep("ML server unavailable — falling back to AI vision...");
      }

      // ── For images (or PDF fallback): render to JPEG and call LM Studio ──
      setStep("Rendering to high-res image...");
      const { base64, mimeType, canvasW, canvasH } = isPdf
        ? await pdfPageToBase64(file, pageNum)
        : await imageFileToBase64(file);

      setStep(`Image: ${canvasW}×${canvasH}px — calling LM Studio vision...`);
      const res = await fetch("/api/ai/floorplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64: base64, mimeType,
          imageWidth: canvasW, imageHeight: canvasH,
          provider, lmStudioUrl: lmUrl, lmModel, scaleHint,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.rooms?.length) throw new Error("No rooms detected. Use a clearer floor plan with visible room labels, or start the ML server.");

      setResult(data);
      setSelectedId(data.rooms[0]?.id ?? null);
      setStep(`✓ ${data.rooms.length} rooms · Scale ${data.scale ?? scaleHint}${data.processingMs ? ` · ${data.processingMs}ms` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setStep("");
    } finally {
      setLoading(false);
    }
  };

  // ── Import to Takeoff ───────────────────────────────────────────
  const importToTakeoff = async () => {
    if (!result) return;
    setImporting(true);
    try {
      const post = (item: Record<string, unknown>) =>
        fetch(`/api/projects/${projectId}/takeoff`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "MARKUP", ...item, totalCost: Number(item.quantity ?? 0) * Number(item.unitCost ?? 0) }),
        });

      for (const r of result.rooms) {
        const sqft = r.areaSqM * 10.764;
        const wallSqft = r.wallAreaSqM * 10.764;
        await post({ category: "Flooring", description: `[${r.floor}] ${r.name} — Floor`, quantity: sqft, unit: "SF", unitCost: COST_FLOOR_SF, notes: `${r.areaSqM.toFixed(2)} m² | AI conf: ${((r.confidence ?? 0) * 100).toFixed(0)}%` });
        await post({ category: "Drywall",  description: `[${r.floor}] ${r.name} — Walls`, quantity: wallSqft, unit: "SF", unitCost: COST_DRYWALL_SF });
        if (r.ceilingSqM) await post({ category: "Drywall", description: `[${r.floor}] ${r.name} — Ceiling`, quantity: r.ceilingSqM * 10.764, unit: "SF", unitCost: COST_CEIL_SF });
        if (r.doorCount)   await post({ category: "Doors & Windows", description: `[${r.name}] Door${r.doorCount > 1 ? "s" : ""}`, quantity: r.doorCount, unit: "EA", unitCost: COST_DOOR_EA });
        if (r.windowCount) await post({ category: "Doors & Windows", description: `[${r.name}] Window${r.windowCount > 1 ? "s" : ""}`, quantity: r.windowCount, unit: "EA", unitCost: COST_WINDOW_EA });
      }
      queryClient.invalidateQueries({ queryKey: ["takeoff", projectId] });
      setImported(true);
    } finally { setImporting(false); }
  };

  // ── Export CSV ──────────────────────────────────────────────────
  const exportCsv = () => {
    if (!result) return;
    const rows = [["Room", "Type", "Floor", "Area m²", "Area ft²", "Walls m²", "Perimeter m", "Doors", "Windows", "Confidence"]];
    for (const r of result.rooms) rows.push([r.name, r.type, r.floor, r.areaSqM.toFixed(2), (r.areaSqM * 10.764).toFixed(1), r.wallAreaSqM.toFixed(2), (r.perimeterM ?? 0).toFixed(2), String(r.doorCount), String(r.windowCount), `${((r.confidence ?? 0)*100).toFixed(0)}%`]);
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "rooms.csv"; a.click();
  };

  const totalArea = result?.rooms.reduce((s, r) => s + r.areaSqM, 0) ?? 0;
  const selRoom   = result?.rooms.find(r => r.id === selectedId);

  // ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "calc(100vh - 80px)", margin: "-28px -32px", overflow: "hidden" }}>

      {/* ── Top toolbar ────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "8px 16px", borderBottom: "1px solid #e2e8f0",
        background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.04)", flexShrink: 0, zIndex: 10,
      }}>
        {/* Upload */}
        <label style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          padding: "7px 14px", borderRadius: 8,
          border: "1px dashed #e2e8f0", background: file ? "#eff6ff" : "#f8fafc",
          cursor: "pointer", fontSize: 12, fontWeight: 600,
          color: file ? "#2563eb" : "#64748b", transition: "all .15s",
        }}>
          <Upload size={13} />
          {file ? file.name.slice(0, 28) + (file.name.length > 28 ? "…" : "") : "Upload Floor Plan (PDF / PNG / JPG)"}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={onFile} />
        </label>

        {/* LM Studio model + scale */}
        {file && (
          <>
            <div style={{ minWidth: 200 }}>
              <LmStudioModelPicker baseUrl={lmUrl} value={lmModel} onChange={setLmModel} compact />
            </div>
            <select value={scaleHint} onChange={e => setScaleHint(e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 11, color: "#374151" }}>
              {["auto","1:50","1:100","1:200","1:500"].map(s => <option key={s} value={s}>{s === "auto" ? "Scale: auto" : `Scale ${s}`}</option>)}
            </select>
          </>
        )}

        {/* Analyze button */}
        <button onClick={analyze} disabled={!file || loading} style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          padding: "7px 20px", borderRadius: 8, border: "none",
          background: !file || loading ? "#e2e8f0" : "linear-gradient(135deg,#2563eb,#7c3aed)",
          color: !file || loading ? "#94a3b8" : "#fff",
          fontWeight: 700, fontSize: 13, cursor: !file || loading ? "not-allowed" : "pointer",
          boxShadow: !file || loading ? "none" : "0 4px 12px rgba(37,99,235,.3)",
          flexShrink: 0,
        }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {loading ? "Analyzing…" : "Detect Rooms"}
        </button>

        {/* Click-to-Measure button */}
        {file && (
          <button
            onClick={() => setClickMode(v => !v)}
            disabled={clickLoading}
            title="Click inside any room to auto-detect its boundary (Bluebeam Dynamic Fill style)"
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "7px 16px", borderRadius: 8, border: "none",
              background: clickMode ? "linear-gradient(135deg,#059669,#0891b2)"
                        : clickLoading ? "#e2e8f0" : "#f0fdf4",
              color: clickMode ? "#fff" : clickLoading ? "#94a3b8" : "#059669",
              fontWeight: 700, fontSize: 12,
              cursor: clickLoading ? "not-allowed" : "pointer",
              outline: `1px solid ${clickMode ? "transparent" : "#86efac"}`,
              flexShrink: 0,
            }}
          >
            {clickLoading ? <Loader2 size={13} className="animate-spin" /> : <span>🎯</span>}
            {clickLoading ? "Detecting…" : clickMode ? "Click a Room ↗" : "Click-to-Detect"}
          </button>
        )}

        {/* Status */}
        {step && (
          <span style={{ fontSize: 11, color: step.startsWith("✓") ? "#059669" : "#2563eb", fontWeight: 600 }}>
            {step}
          </span>
        )}
        {error && (
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#dc2626", background: "#fef2f2", padding: "4px 10px", borderRadius: 6 }}>
            <AlertCircle size={12} /> {error}
          </span>
        )}

        {/* Overlay toggles */}
        {result && (
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            <button onClick={() => setShowLabels(v => !v)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, border: `1px solid ${showLabels ? "#2563eb" : "#e2e8f0"}`, background: showLabels ? "#eff6ff" : "#fff", color: showLabels ? "#2563eb" : "#64748b", cursor: "pointer" }}>
              {showLabels ? <Eye size={12} /> : <EyeOff size={12} />} Labels
            </button>
            <button onClick={() => setShowOpenings(v => !v)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, border: `1px solid ${showOpenings ? "#d97706" : "#e2e8f0"}`, background: showOpenings ? "#fffbeb" : "#fff", color: showOpenings ? "#d97706" : "#64748b", cursor: "pointer" }}>
              <Layers size={12} /> Doors/Win
            </button>
            <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} style={{ padding: "5px 9px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}><ZoomIn size={13} color="#64748b" /></button>
            <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} style={{ padding: "5px 9px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}><ZoomOut size={13} color="#64748b" /></button>
            <button onClick={() => setZoom(1)} style={{ padding: "5px 9px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}><RotateCcw size={13} color="#64748b" /></button>
            <button onClick={() => setPanelOpen(v => !v)} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #e2e8f0", background: panelOpen ? "#eff6ff" : "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, color: panelOpen ? "#2563eb" : "#64748b" }}>
              {panelOpen ? "Hide panel" : "Show panel"}
            </button>
          </div>
        )}
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left: PDF viewer with SVG overlay ──────────────────── */}
        <div style={{ flex: 1, overflow: "auto", background: "#1e293b", padding: 24, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>

          {!fileUrl ? (
            /* Drop zone when no file */
            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
              padding: "80px 40px", borderRadius: 16,
              border: "2px dashed rgba(255,255,255,.15)", cursor: "pointer",
              color: "rgba(255,255,255,.5)", textAlign: "center",
            }}>
              <Upload size={48} opacity={0.4} />
              <div>
                <p style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,.7)" }}>Upload Floor Plan</p>
                <p style={{ fontSize: 13, marginTop: 6 }}>PDF, PNG, JPG — AI detects rooms with color highlights</p>
              </div>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={onFile} />
            </label>
          ) : (
            <div style={{
              position: "relative", display: "inline-block",
              transform: `scale(${zoom})`, transformOrigin: "top center",
              transition: "transform .2s",
              boxShadow: "0 12px 48px rgba(0,0,0,.5)",
            }}>
              {/* ── Actual PDF / image ───────────────────────────── */}
              <div ref={pageRef} style={{ display: "block" }}>
                {isPdf ? (
                  <Document
                    file={fileUrl}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    loading={
                      <div style={{ width: renderW, height: 600, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Loader2 size={32} color="#2563eb" className="animate-spin" />
                      </div>
                    }
                  >
                    <Page
                      pageNumber={pageNum}
                      width={renderW}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      onRenderSuccess={measureHeight}
                    />
                  </Document>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={fileUrl}
                    alt="Floor plan"
                    style={{ display: "block", maxWidth: "none", width: renderW }}
                    onLoad={e => {
                      const img = e.currentTarget as HTMLImageElement;
                      setRenderH(Math.round(img.naturalHeight * renderW / img.naturalWidth));
                    }}
                  />
                )}
              </div>

              {/* ── Click-to-Measure overlay (Bluebeam Dynamic Fill style) ── */}
              {file && renderH > 0 && (
                <div
                  style={{ position: "absolute", top: 0, left: 0, width: renderW, height: renderH,
                           cursor: clickMode ? "crosshair" : "default", zIndex: 10 }}
                  onClick={async (e) => {
                    if (!clickMode || !file) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const rx = (e.clientX - rect.left) / zoom;
                    const ry = (e.clientY - rect.top)  / zoom;
                    // Map render coords → analysis image coords
                    const imgX = result ? rx * (result.imageWidth  / renderW) : rx;
                    const imgY = result ? ry * (result.imageHeight / renderH) : ry;
                    setClickLoading(true);
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      fd.append("click_x", String(Math.round(imgX)));
                      fd.append("click_y", String(Math.round(imgY)));
                      const r = await fetch(`/api/floorplan/click-room`, { method:"POST", body: fd });
                      if (!r.ok) { const e2 = await r.json(); alert(e2.error || "Click failed"); return; }
                      const data = await r.json();
                      const rm = data.room;
                      if (rm) {
                        setResult(prev => prev ? {
                          ...prev,
                          rooms: [...(prev.rooms||[]), {...rm, id: `click_${Date.now()}`}],
                          imageWidth:  data.imageWidth  || prev.imageWidth,
                          imageHeight: data.imageHeight || prev.imageHeight,
                        } : prev);
                        setClickMode(false);
                      }
                    } catch(err) { alert("Click-room failed: " + err); }
                    finally { setClickLoading(false); }
                  }}
                />
              )}

              {/* ── SVG overlay — floor + walls + rooms + doors/windows ── */}
              {result && renderH > 0 && (
                <svg
                  width={renderW}
                  height={renderH}
                  style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
                >
                  {/* Layer 1: Building floor outline (filled light) */}
                  {showOpenings && result.buildingOutline && result.buildingOutline.length > 2 && (() => {
                    const sx = renderW / result.imageWidth;
                    const sy = renderH / result.imageHeight;
                    const pts = result.buildingOutline.map(([px, py]) =>
                      `${Math.round(px*sx)},${Math.round(py*sy)}`
                    ).join(" ");
                    return (
                      <polygon points={pts}
                        fill="#f0f9ff" fillOpacity={0.4}
                        stroke="#1e40af" strokeWidth={2.5}
                        strokeDasharray="8 4"
                      />
                    );
                  })()}

                  {/* Layer 2: Wall lines (gray structural walls) */}
                  {showOpenings && result.wallLines?.map((wl, i) => {
                    const sx = renderW / result.imageWidth;
                    const sy = renderH / result.imageHeight;
                    return (
                      <line key={`wl${i}`}
                        x1={Math.round(wl.x1*sx)} y1={Math.round(wl.y1*sy)}
                        x2={Math.round(wl.x2*sx)} y2={Math.round(wl.y2*sy)}
                        stroke="#334155" strokeWidth={1.5} opacity={0.5}
                      />
                    );
                  })}

                  {/* Layer 3: Room fills and borders */}
                  {result.rooms.map(room => {
                    const { x, y, w, h } = scaleCoord(room);
                    const { fill, stroke } = pal(room.type);
                    const isSel = room.id === selectedId;
                    const fontSize = Math.max(9, Math.min(14, w / 9));
                    return (
                      <g key={room.id} style={{ pointerEvents: "all", cursor: "pointer" }} onClick={() => setSelectedId(room.id === selectedId ? null : room.id)}>
                        <rect x={x} y={y} width={w} height={h} fill={fill} />
                        <rect x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth={isSel ? 3 : 1.5} rx={2} />
                        {isSel && (
                          <rect x={x-4} y={y-4} width={w+8} height={h+8} fill="none" stroke={stroke} strokeWidth={1} strokeDasharray="8 4" rx={4} opacity={0.7} />
                        )}
                        {showLabels && w > 50 && h > 35 && (
                          <>
                            <text x={x+w/2} y={y+h/2-6} textAnchor="middle" fontSize={fontSize} fontWeight="700" fill={stroke}
                              style={{ paintOrder:"stroke" as never, stroke:"#fff", strokeWidth:3 }}>
                              {room.name}
                            </text>
                            <text x={x+w/2} y={y+h/2+fontSize} textAnchor="middle" fontSize={Math.max(8,fontSize-2)} fill={stroke}
                              style={{ paintOrder:"stroke" as never, stroke:"#fff", strokeWidth:2 }}>
                              {room.areaSqM.toFixed(1)} m²
                            </text>
                          </>
                        )}
                        {(room.confidence ?? 0) < 0.7 && (
                          <circle cx={x+w-8} cy={y+8} r={5} fill="#f59e0b" stroke="#fff" strokeWidth={1} />
                        )}
                      </g>
                    );
                  })}

                  {/* Layer 4: Doors — amber semicircle indicator */}
                  {showOpenings && result.doors?.map((d, i) => {
                    const s = scaleOpening(d);
                    return (
                      <g key={`d${i}`}>
                        <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#f59e0b25" stroke="#f59e0b" strokeWidth={2} rx={s.w/2} />
                      </g>
                    );
                  })}
                  {/* Layer 4: Windows — cyan line */}
                  {showOpenings && result.windows?.map((w, i) => {
                    const s = scaleOpening(w);
                    return (
                      <g key={`w${i}`}>
                        <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#7dd3fc25" stroke="#0ea5e9" strokeWidth={2} />
                        <line x1={s.x} y1={s.y+s.h/2} x2={s.x+s.w} y2={s.y+s.h/2} stroke="#0ea5e9" strokeWidth={3} />
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          )}
        </div>

        {/* ── Right: analysis panel ─────────────────────────────── */}
        {panelOpen && (
          <div style={{
            width: 300, flexShrink: 0, borderLeft: "1px solid #e2e8f0",
            background: "#fff", display: "flex", flexDirection: "column", overflow: "hidden",
          }}>

            {/* Selected room detail */}
            {selRoom ? (
              <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", background: `${pal(selRoom.type).fill}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: pal(selRoom.type).stroke, flexShrink: 0, display: "inline-block" }} />
                  <p style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", flex: 1 }}>{selRoom.name}</p>
                  <span style={{ fontSize: 10, background: "#f1f5f9", padding: "2px 7px", borderRadius: 99, color: "#64748b" }}>{selRoom.type}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    { l: "Floor Area",  v: `${selRoom.areaSqM.toFixed(2)} m²\n(${(selRoom.areaSqM*10.764).toFixed(0)} ft²)` },
                    { l: "Wall Area",   v: `${selRoom.wallAreaSqM.toFixed(1)} m²` },
                    { l: "Dimensions",  v: `${selRoom.lengthM.toFixed(1)} × ${selRoom.widthM.toFixed(1)} m` },
                    { l: "Perimeter",   v: `${(selRoom.perimeterM??0).toFixed(1)} m` },
                    { l: "Doors",       v: selRoom.doorCount },
                    { l: "Windows",     v: selRoom.windowCount },
                    { l: "Floor",       v: selRoom.floor },
                    { l: "Confidence",  v: `${((selRoom.confidence??0)*100).toFixed(0)}%` },
                  ].map(({ l, v }) => (
                    <div key={l} style={{ background: "#fff", borderRadius: 7, padding: "6px 9px" }}>
                      <p style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".05em" }}>{l}</p>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", whiteSpace: "pre-line" }}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : result ? (
              /* Summary when no room selected */
              <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Floor Plan Summary</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    { l: "Rooms",        v: result.rooms.length, c: "#2563eb" },
                    { l: "Floor Area",   v: `${(result.floorAreaSqM ?? totalArea).toFixed(1)} m²`, c: "#059669" },
                    { l: "Room Area",    v: `${totalArea.toFixed(1)} m²`, c: "#7c3aed" },
                    { l: "Wall Lines",   v: result.wallLines?.length ?? 0, c: "#334155" },
                    { l: "Doors",        v: result.rooms.reduce((s,r)=>s+r.doorCount,0), c: "#d97706" },
                    { l: "Windows",      v: result.rooms.reduce((s,r)=>s+r.windowCount,0), c: "#0891b2" },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ background: "#fff", borderRadius: 7, padding: "8px 10px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                      <p style={{ fontSize: 10, color: "#94a3b8" }}>{l}</p>
                      <p style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</p>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, textAlign: "center" }}>Click a room on the drawing to see details</p>
              </div>
            ) : null}

            {/* Room list */}
            {result && (
              <div style={{ flex: 1, overflowY: "auto" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em", padding: "8px 14px 4px", borderBottom: "1px solid #f1f5f9" }}>
                  {result.rooms.length} Rooms Detected
                </p>
                {result.rooms.map(room => {
                  const { stroke } = pal(room.type);
                  return (
                    <button key={room.id} onClick={() => setSelectedId(room.id === selectedId ? null : room.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "9px 14px", textAlign: "left", border: "none",
                        borderBottom: "1px solid #f8fafc",
                        background: room.id === selectedId ? `${stroke}12` : "#fff",
                        cursor: "pointer", transition: "background .1s",
                      }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: stroke, flexShrink: 0, display: "inline-block" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{room.name}</p>
                        <p style={{ fontSize: 10, color: "#94a3b8" }}>{room.areaSqM.toFixed(1)} m² · {room.doorCount}D {room.windowCount}W</p>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: stroke, flexShrink: 0 }}>{(room.areaSqM*10.764).toFixed(0)} ft²</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Actions footer */}
            {result && (
              <div style={{ padding: 12, borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, background: "#fff" }}>
                <button onClick={exportCsv} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
                  <Download size={13} />CSV
                </button>
                {imported ? (
                  <div style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 8, background: "#f0fdf4", color: "#059669", fontSize: 12, fontWeight: 700 }}>
                    <CheckCircle2 size={14} />All imported!
                  </div>
                ) : (
                  <button onClick={importToTakeoff} disabled={importing} style={{
                    flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: "8px", borderRadius: 8, border: "none",
                    background: "linear-gradient(135deg,#059669,#10b981)",
                    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    opacity: importing ? 0.7 : 1,
                  }}>
                    {importing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Import to Takeoff
                  </button>
                )}
              </div>
            )}

            {/* PDF page controls */}
            {isPdf && numPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 14px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
                <button onClick={() => { setPageNum(p => Math.max(1, p-1)); setResult(null); }} disabled={pageNum <= 1} style={{ background: "none", border: "none", cursor: "pointer", color: pageNum <= 1 ? "#cbd5e1" : "#374151" }}>
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontSize: 12, color: "#374151" }}>Page {pageNum} / {numPages}</span>
                <button onClick={() => { setPageNum(p => Math.min(numPages, p+1)); setResult(null); }} disabled={pageNum >= numPages} style={{ background: "none", border: "none", cursor: "pointer", color: pageNum >= numPages ? "#cbd5e1" : "#374151" }}>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Legend bar ──────────────────────────────────────────── */}
      {result && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 16px", borderTop: "1px solid #e2e8f0", background: "#fff", flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginRight: 4 }}>LEGEND</span>
          {Object.entries(PALETTE).filter(([type]) => result.rooms.some(r => r.type === type)).map(([type, { stroke }]) => (
            <span key={type} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: stroke, background: `${stroke}18`, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: stroke, display: "inline-block" }} />
              {type}
            </span>
          ))}
          {showOpenings && <>
            <span style={{ fontSize: 10, color: "#1e40af", background: "#dbeafe", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>🏢 FLOOR OUTLINE</span>
            <span style={{ fontSize: 10, color: "#334155", background: "#f1f5f9", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>━ WALLS</span>
            <span style={{ fontSize: 10, color: "#d97706", background: "#fffbeb", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>🚪 DOOR</span>
            <span style={{ fontSize: 10, color: "#0891b2", background: "#ecfeff", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>🪟 WINDOW</span>
          </>}
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a3b8" }}>
            {result.source === "python_ml" ? `🐍 Python ML (${result.pipeline ?? ""})` : `🤖 AI Vision (${result.pipeline ?? "lmstudio"})`}
            {result.scale && ` · Scale ${result.scale}`}
          </span>
          <span style={{ fontSize: 10, color: "#64748b" }}>💡 Click room to select · Yellow dot = low confidence</span>
        </div>
      )}
    </div>
  );
}
