"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnnotationCanvas } from "./AnnotationCanvas";
import { ToolPalette } from "./ToolPalette";
import { TakeoffSidebar } from "./TakeoffSidebar";
import { ScaleCalibrator } from "./ScaleCalibrator";
import { LayerPanel } from "./LayerPanel";
import { DrawingAIAssistant } from "./DrawingAIAssistant";
import { MeasurementTable } from "./MeasurementTable";
import { RegionAnalyzer } from "./RegionAnalyzer";
import type { Drawing, Annotation, DrawingScale, AnnotationPoint } from "@/types";
import { bufToBase64 } from "@/lib/utils";
import { setupPdfWorker } from "@/lib/pdf-worker";

// ─── Room type → highlight color ─────────────────────────────────
const ROOM_COLORS: Record<string, string> = {
  BEDROOM: "#6366f1", BATHROOM: "#0ea5e9", KITCHEN: "#f59e0b",
  LIVING: "#10b981",  DINING: "#ec4899",   CORRIDOR: "#94a3b8",
  STORE: "#8b5cf6",   BALCONY: "#14b8a6",  GARAGE: "#64748b",
  STUDY: "#2563eb",   UTILITY: "#d97706",  HALL: "#84cc16",
  OTHER: "#64748b",
};

// ─── PDF page → base64 for AI ────────────────────────────────────
async function pdfToBase64ForAI(fileUrl: string, pageNum = 1): Promise<{ base64: string; mimeType: string; canvasW: number; canvasH: number }> {
  setupPdfWorker();
  const { getDocument } = await import("pdfjs-dist");
  const res = await fetch(fileUrl);
  const buf = await res.arrayBuffer();
  const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await pdf.getPage(pageNum);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(3.0, 2000 / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({ scale });
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

async function imageToBase64ForAI(fileUrl: string): Promise<{ base64: string; mimeType: string; canvasW: number; canvasH: number }> {
  const res = await fetch(fileUrl);
  const buf = await res.arrayBuffer();
  const base64 = bufToBase64(buf);
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ base64, mimeType, canvasW: img.naturalWidth, canvasH: img.naturalHeight });
    img.onerror = reject;
    img.src = fileUrl;
  });
}

export type ToolType =
  | "select" | "measure" | "area" | "count" | "perimeter"
  | "text" | "cloud" | "arrow" | "rectangle" | "highlight"
  | "polygon" | "stamp" | "callout" | "image";

// Lazy load heavy renderers
const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: () => <ViewerSkeleton text="Loading PDF..." dark={false} />,
});
const DxfViewer = dynamic(
  () => import("./renderers/DxfRenderer").then(m => ({ default: m.DxfRenderer })),
  { ssr: false, loading: () => <ViewerSkeleton text="Parsing DXF..." dark /> }
);

function ViewerSkeleton({ text, dark }: { text: string; dark?: boolean }) {
  return (
    <div style={{
      width: 900, height: 700,
      background: dark ? "#1a1a2e" : "#f1f5f9",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12,
    }}>
      <div className="spin" style={{ width: 36, height: 36, borderRadius: "50%", border: "4px solid #e2e8f0", borderTopColor: "#2563eb" }} />
      <p style={{ fontSize: 13, color: dark ? "#7dd3fc" : "#64748b" }}>{text}</p>
    </div>
  );
}

interface DxfLayer { name: string; color: number; visible: boolean }

interface Props { drawing: Drawing; projectId: string }

export function MarkupEditor({ drawing, projectId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef   = useRef<HTMLDivElement>(null);

  // Tools & state
  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [zoom, setZoom]   = useState(1);
  const [panX, setPanX]   = useState(0);
  const [panY, setPanY]   = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageDims, setPageDims]     = useState({ w: 1400, h: 1000 }); // updated by PdfViewer callback

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId]   = useState<string | null>(null);

  // Scale & UI
  const [scale, setScale]               = useState<DrawingScale | null>(drawing.scale ?? null);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const [showSidebar, setShowSidebar]   = useState(true);
  const [showTable, setShowTable]       = useState(false);
  const [showRegionAI, setShowRegionAI] = useState(false);
  const [dxfLayers, setDxfLayers]         = useState<DxfLayer[]>([]);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  // AI room layers: hidden type IDs (for Image annotations)
  const [hiddenRoomTypes, setHiddenRoomTypes] = useState<Set<string>>(new Set());
  // PDF real OCG layers
  const [pdfLayers, setPdfLayers]           = useState<import("./PdfViewer").PdfLayer[]>([]);
  const [pdfLayerVis, setPdfLayerVis]       = useState<Map<string, boolean>>(new Map());

  // ── AI room detection (LM Studio only) ───────────────────────
  const [aiDetecting, setAiDetecting]   = useState(false);
  const [aiDetectStep, setAiDetectStep] = useState("");
  const [aiDetectError, setAiDetectError] = useState("");
  const [showAiAssistant, setShowAiAssistant] = useState(false);

  const isDxf   = ["DWG", "DXF"].includes(drawing.fileFormat);
  const isPdf   = drawing.fileFormat === "PDF";
  const isImage = ["PNG", "JPG", "JPEG"].includes(drawing.fileFormat);

  // ── Auto-show measurement table when first annotation added ──
  useEffect(() => {
    if (annotations.length > 0 && !showTable) setShowTable(true);
  }, [annotations.length]);

  // ── Load annotations ─────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/drawings/${drawing.id}/annotations?page=${pageNumber}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => Array.isArray(d) && setAnnotations(d))
      .catch(() => {});
  }, [drawing.id, pageNumber]);

  // ── Save new annotation ──────────────────────────────────────
  const handleCreated = useCallback(async (ann: Omit<Annotation, "id" | "createdAt" | "updatedAt">) => {
    try {
      const res = await fetch(`/api/drawings/${drawing.id}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ann),
      });
      if (!res.ok) return;
      const saved = await res.json();
      setAnnotations(prev => [...prev, saved]);

      // Auto-create takeoff item from measurements
      if (ann.measurement && ann.unit && ["MEASUREMENT", "AREA", "PERIMETER"].includes(ann.type)) {
        const isAiRoom = ann.aiAnalyzed === true;
        await fetch(`/api/projects/${projectId}/takeoff`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            drawingId:   drawing.id,
            annotationId: saved.id,
            source:      isAiRoom ? "AI_CLAUDE" : "MARKUP",
            category:    ann.type === "AREA" ? (isAiRoom ? "Room Area" : "Area Measurement")
                         : ann.type === "COUNT" ? "Count"
                         : "Linear Measurement",
            description: ann.label ?? `${ann.type} — ${drawing.originalName}`,
            quantity:    ann.measurement,
            unit:        ann.unit,
            // Unit costs for AI-detected rooms (can be edited later in takeoff page)
            unitCost:    isAiRoom && ann.unit?.includes("m") ? 5.5 * 10.764 : null,
            totalCost:   isAiRoom && ann.unit?.includes("m")
              ? ann.measurement * 5.5 * 10.764
              : null,
            notes: ann.userNote ?? null,
          }),
        });
      }
    } catch {}
  }, [drawing.id, drawing.originalName, projectId]);

  // ── Delete annotation ────────────────────────────────────────
  const handleDeleted = useCallback(async (id: string) => {
    await fetch(`/api/drawings/${drawing.id}/annotations/${id}`, { method: "DELETE" }).catch(() => {});
    setAnnotations(prev => prev.filter(a => a.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [drawing.id, selectedId]);

  // ── Update annotation geometry ───────────────────────────────
  const handleUpdated = useCallback(async (id: string, geometry: AnnotationPoint[]) => {
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, geometry } : a));
    await fetch(`/api/drawings/${drawing.id}/annotations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geometry }),
    }).catch(() => {});
  }, [drawing.id]);

  // ── AI Detect: fetch drawing → AI analysis → create annotations ──
  // Defined AFTER handleCreated to avoid temporal dead zone
  const aiDetectRooms = useCallback(async () => {
    if (aiDetecting) return;
    setAiDetecting(true);
    setAiDetectError("");
    try {
      setAiDetectStep("Converting drawing to high-res image...");
      let base64 = "", mimeType = "image/jpeg", canvasW = 0, canvasH = 0;
      if (isPdf) {
        const r = await pdfToBase64ForAI(drawing.fileUrl, pageNumber);
        base64 = r.base64; mimeType = r.mimeType; canvasW = r.canvasW; canvasH = r.canvasH;
      } else {
        const r = await imageToBase64ForAI(drawing.fileUrl);
        base64 = r.base64; mimeType = r.mimeType; canvasW = r.canvasW; canvasH = r.canvasH;
      }

      // Use BIMBOSS floorplan server (TextGuided + trained UNet model)
      setAiDetectStep("Analyzing with BIMBOSS Model + TextGuided...");

      const fd = new FormData();
      // Upload original file directly (PDF preferred for best accuracy)
      if (drawing.fileUrl) {
        try {
          const fileRes = await fetch(drawing.fileUrl);
          const blob    = await fileRes.blob();
          const ext     = drawing.fileUrl.split('.').pop()?.toLowerCase() ?? "pdf";
          fd.append("file", blob, `drawing.${ext}`);
        } catch {
          // fallback: send rendered image
          const imgBlob = await fetch(`data:${mimeType};base64,${base64}`).then(r => r.blob());
          fd.append("file", imgBlob, "drawing.jpg");
        }
      } else {
        const imgBlob = await fetch(`data:${mimeType};base64,${base64}`).then(r => r.blob());
        fd.append("file", imgBlob, "drawing.jpg");
      }
      fd.append("page",        String(pageNumber));
      fd.append("scale_hint",  "auto");

      const res  = await fetch("/api/floorplan", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.rooms?.length) throw new Error(data.error ?? "No rooms detected — make sure floorplan server is running");

      // Scale BIMBOSS coords → editor pageDims space
      const imgW = data.imageWidth  || canvasW || 1600;
      const imgH = data.imageHeight || canvasH || 1143;
      const sx = pageDims.w / imgW;
      const sy = pageDims.h / imgH;

      setAiDetectStep(`Creating ${data.rooms.length} rooms via ${data.pipeline ?? "BIMBOSS"}...`);
      let created = 0;
      for (const room of data.rooms) {
        const px  = room.x * sx;
        const py  = room.y * sy;
        const prw = room.w * sx;
        const prh = room.h * sy;
        // Green for new rooms, gray for existing (E) and NIC
        const isExisting = room.name?.includes("(E)") || room.type === "EXISTING";
        const isNic      = room.type === "NIC" || room.name?.includes("N.I.C");
        const color = isNic || isExisting ? "#94a3b8" : "#4ade80";

        // Use wall-following polygon if available, else bbox
        let geometry: AnnotationPoint[];
        if (room.polygon && room.polygon.length >= 3) {
          geometry = room.polygon.map(([px2, py2]: number[]) => ({
            x: px2 * sx, y: py2 * sy,
          }));
        } else {
          geometry = [
            { x: px,        y: py        },
            { x: px + prw,  y: py        },
            { x: px + prw,  y: py + prh  },
            { x: px,        y: py + prh  },
          ];
        }
        const areaSqM = room.areaSqM ?? 0;
        const measurement = scale?.pxPerUnit
          ? (prw / scale.pxPerUnit) * (prh / scale.pxPerUnit)
          : areaSqM;
        await handleCreated({
          drawingId:   drawing.id,
          pageNumber,
          type:        "AREA",
          geometry,
          measurement: +measurement.toFixed(2),
          unit:        scale?.realUnit ?? "m²",
          label:       `${room.name} (${areaSqM.toFixed(1)} m²)`,
          color,
          opacity:     0.22,
          userNote:    `AI · ${room.type} · conf ${((room.confidence ?? 0) * 100).toFixed(0)}%`,
          aiAnalyzed:  true,
        });
        created++;
      }
      setAiDetectStep(`✓ ${created} rooms highlighted · measurement table updated`);
      setShowTable(true);
    } catch (e) {
      setAiDetectError(e instanceof Error ? e.message : "Detection failed");
      setAiDetectStep("");
    } finally {
      setAiDetecting(false);
    }
  }, [aiDetecting, isPdf, drawing.fileUrl, drawing.id, pageNumber, pageDims, scale, handleCreated]);

  // ── Mouse wheel zoom ─────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.12 : 0.9;
        setZoom(z => Math.max(0.05, Math.min(20, z * factor)));
      } else {
        setPanX(x => x - e.deltaX * 0.6);
        setPanY(y => y - e.deltaY * 0.6);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Middle-mouse pan ─────────────────────────────────────────
  const panning   = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }, []);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!panning.current) return;
    setPanX(x => x + (e.clientX - lastMouse.current.x));
    setPanY(y => y + (e.clientY - lastMouse.current.y));
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onMouseUp = useCallback(() => { panning.current = false; }, []);

  const selectedAnn = annotations.find(a => a.id === selectedId);

  // ── AI Room Layers (PDF/Image) — derived from annotations ────────
  const aiRoomLayers = useMemo(() => {
    if (isDxf) return [];
    const typeMap: Map<string, { color: string; count: number }> = new Map();
    for (const ann of annotations) {
      if (!ann.aiAnalyzed) continue;
      // Extract rtype from userNote: "AI · BEDROOM · conf 90%"
      const m = ann.userNote?.match(/AI\s*[·•]\s*([A-Z_]+)\s*[·•]/);
      const rtype = m ? m[1] : "OTHER";
      const color = ROOM_COLORS[rtype] ?? ROOM_COLORS.OTHER;
      const existing = typeMap.get(rtype);
      typeMap.set(rtype, { color, count: (existing?.count ?? 0) + 1 });
    }
    return Array.from(typeMap.entries()).map(([rtype, { color, count }]) => ({
      id:      rtype,
      name:    rtype.charAt(0) + rtype.slice(1).toLowerCase(),
      color,
      visible: !hiddenRoomTypes.has(rtype),
      count,
    }));
  }, [annotations, hiddenRoomTypes, isDxf]);

  // Annotations filtered by hidden room types (for canvas render)
  const visibleAnnotations = useMemo(() => {
    if (hiddenRoomTypes.size === 0) return annotations;
    return annotations.filter(ann => {
      if (!ann.aiAnalyzed) return true;  // always show manual annotations
      const m = ann.userNote?.match(/AI\s*[·•]\s*([A-Z_]+)\s*[·•]/);
      const rtype = m ? m[1] : "OTHER";
      return !hiddenRoomTypes.has(rtype);
    });
  }, [annotations, hiddenRoomTypes]);

  const handleToggleRoomLayer = useCallback((rtype: string) => {
    setHiddenRoomTypes(prev => {
      const next = new Set(prev);
      if (next.has(rtype)) next.delete(rtype); else next.add(rtype);
      return next;
    });
  }, []);

  const handleToggleAllRoomLayers = useCallback((visible: boolean) => {
    if (visible) {
      setHiddenRoomTypes(new Set());
    } else {
      setHiddenRoomTypes(new Set(aiRoomLayers.map(l => l.id)));
    }
  }, [aiRoomLayers]);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", background: "#e8edf2" }}>

      {/* ── Tool Palette ─────────────────────────────────────── */}
      <ToolPalette
        activeTool={activeTool}
        onToolChange={t => { setActiveTool(t); setSelectedId(null); }}
        onOpenScale={() => setShowScaleDialog(true)}
        onToggleSidebar={() => setShowSidebar(s => !s)}
        showSidebar={showSidebar}
        isDxf={isDxf}
        showLayerPanel={showLayerPanel}
        onToggleLayerPanel={() => setShowLayerPanel(s => !s)}
        onToggleTable={() => setShowTable(s => !s)}
        showTable={showTable}
        tableCount={annotations.filter(a => a.measurement != null).length}
        onAiDetect={isPdf || isImage ? aiDetectRooms : undefined}
        aiDetecting={aiDetecting}
        onAiChat={() => setShowAiAssistant(s => !s)}
        showAiChat={showAiAssistant}
      />

      {/* ── Main canvas area ─────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ position: "relative", flex: 1, overflow: "hidden",
          cursor: activeTool === "select" ? "default" : "crosshair" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        {/* ── Transform container ─────────────────────────────── */}
        <div
          ref={wrapperRef}
          style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: `translate(-50%,-50%) translate(${panX}px,${panY}px) scale(${zoom})`,
            transformOrigin: "center center",
            willChange: "transform",
          }}
        >
          {/* PDF ─────────────────────────────────────────── */}
          {isPdf && (
            <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
              <PdfViewer
                fileUrl={drawing.fileUrl}
                pageNumber={pageNumber}
                onPageCount={setTotalPages}
                onPageDimensions={(w, h) => setPageDims({ w, h })}
                onLayersLoaded={layers => {
                  setPdfLayers(layers);
                  // All layers visible by default
                  setPdfLayerVis(new Map(layers.map(l => [l.id, l.visible])));
                  // Auto-open layer panel when PDF has layers
                  if (layers.length > 0) setShowLayerPanel(true);
                }}
                layerVisibility={pdfLayerVis}
              />
              <AnnotationCanvas
                width={pageDims.w} height={pageDims.h}
                annotations={visibleAnnotations}
                activeTool={activeTool} scale={scale} zoom={zoom}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreated={handleCreated}
                onDeleted={handleDeleted}
                onUpdated={handleUpdated}
                pageNumber={pageNumber}
                drawingId={drawing.id}
              />
            </div>
          )}

          {/* Image ──────────────────────────────────────── */}
          {isImage && (
            <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={drawing.fileUrl} alt="Drawing"
                draggable={false} style={{ display: "block", userSelect: "none" }}
                onLoad={e => {
                  const img = e.currentTarget;
                  setPageDims({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
              <AnnotationCanvas
                width={pageDims.w} height={pageDims.h}
                annotations={visibleAnnotations}
                activeTool={activeTool} scale={scale} zoom={zoom}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreated={handleCreated}
                onDeleted={handleDeleted}
                onUpdated={handleUpdated}
                pageNumber={pageNumber}
                drawingId={drawing.id}
              />
            </div>
          )}

          {/* DXF / DWG ──────────────────────────────────── */}
          {isDxf && (
            <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
              <DxfViewer
                fileUrl={drawing.fileUrl}
                fileFormat={drawing.fileFormat}
                onLayersLoaded={layers => {
                  setDxfLayers(layers);
                  setPageDims({ w: 900, h: 700 });
                }}
              />
              <AnnotationCanvas
                width={pageDims.w} height={pageDims.h}
                annotations={visibleAnnotations}
                activeTool={activeTool} scale={scale} zoom={zoom}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreated={handleCreated}
                onDeleted={handleDeleted}
                onUpdated={handleUpdated}
                pageNumber={pageNumber}
                drawingId={drawing.id}
              />
            </div>
          )}
        </div>

        {/* ── Toolbar overlays ─────────────────────────────────── */}

        {/* Zoom controls */}
        <div style={{
          position: "absolute", bottom: 20, right: 20, zIndex: 30,
          display: "flex", flexDirection: "column", gap: 0,
          background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0",
          boxShadow: "0 4px 16px rgba(0,0,0,.1)", overflow: "hidden",
        }}>
          {[
            { label: "+",                  action: () => setZoom(z => Math.min(20, z * 1.25)) },
            { label: `${Math.round(zoom * 100)}%`, action: () => { setZoom(1); setPanX(0); setPanY(0); }, small: true },
            { label: "−",                  action: () => setZoom(z => Math.max(0.05, z / 1.25)) },
          ].map(({ label, action, small }) => (
            <button key={label} onClick={action} style={{
              width: 40, height: small ? 26 : 36, border: "none",
              borderBottom: "1px solid #f1f5f9",
              background: "transparent", cursor: "pointer",
              fontSize: small ? 10 : 20, color: "#374151", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "#f8fafc")}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
            >{label}</button>
          ))}
        </div>

        {/* Page navigation */}
        {isPdf && totalPages > 1 && (
          <div style={{
            position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 30,
            display: "flex", alignItems: "center", gap: 12,
            background: "rgba(15,23,42,.85)", backdropFilter: "blur(8px)",
            color: "#fff", padding: "8px 20px", borderRadius: 99, fontSize: 13, fontWeight: 600,
          }}>
            <button onClick={() => setPageNumber(p => Math.max(1, p-1))} disabled={pageNumber<=1}
              style={{ background:"none",border:"none",color:pageNumber<=1?"#64748b":"#fff",cursor:"pointer",fontSize:18 }}>‹</button>
            <span>Page {pageNumber} of {totalPages}</span>
            <button onClick={() => setPageNumber(p => Math.min(totalPages, p+1))} disabled={pageNumber>=totalPages}
              style={{ background:"none",border:"none",color:pageNumber>=totalPages?"#64748b":"#fff",cursor:"pointer",fontSize:18 }}>›</button>
          </div>
        )}

        {/* Scale badge */}
        {scale?.notation && (
          <div style={{
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 30,
            background: "rgba(37,99,235,.9)", color: "#fff",
            padding: "4px 14px", borderRadius: 99, fontSize: 12, fontWeight: 600,
          }}>
            Scale: {scale.notation}
          </div>
        )}

        {/* AI Detect status — small toast above canvas */}
        {(aiDetectStep || aiDetectError) && (
          <div style={{
            position:"absolute", top:12, left:"50%", transform:"translateX(-50%)", zIndex:40,
            background: aiDetectError ? "rgba(220,38,38,.92)" : "rgba(15,23,42,.92)",
            backdropFilter:"blur(8px)", padding:"6px 16px", borderRadius:99,
            fontSize:11, fontWeight:600,
            color: aiDetectError ? "#fca5a5" : "#7dd3fc",
          }}>
            {aiDetectError ? `⚠️ ${aiDetectError}` : aiDetectStep}
          </div>
        )}

        {/* ── Measurement Table panel ──── */}
        {showTable && (
          <MeasurementTable
            annotations={visibleAnnotations}
            onDelete={handleDeleted}
            onSelect={setSelectedId}
            selectedId={selectedId}
            onClose={() => setShowTable(false)}
          />
        )}

        {/* ── Analyze Region button (when annotation selected) ── */}
        {selectedId && selectedAnn && (
          <button
            onClick={() => setShowRegionAI(true)}
            style={{
              position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 50,
              display: "flex", alignItems: "center", gap: 8,
              background: "linear-gradient(135deg,#7c3aed,#2563eb)",
              color: "#fff", padding: "9px 22px", borderRadius: 99,
              border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
              boxShadow: "0 4px 20px rgba(124,58,237,.45)",
              animation: "bounceIn .3s ease both",
            }}
          >
            ✨ Analyze Region with AI → Takeoff
          </button>
        )}

        {/* Hint */}
        <div style={{
          position: "absolute", top: 12, right: 12, zIndex: 30,
          background: "rgba(15,23,42,.7)", color: "#94a3b8",
          padding: "5px 12px", borderRadius: 7, fontSize: 11,
          pointerEvents: "none",
        }}>
          {activeTool === "select"    ? "V — Click annotation → drag vertex to edit → Delete key to remove" :
           activeTool === "count"    ? "Click to place counter" :
           activeTool === "text"     ? "Click to add note" :
           activeTool === "stamp"    ? "Click to stamp" :
           activeTool === "arrow"    ? "Click start → click end" :
           activeTool === "rectangle"|| activeTool === "highlight" ? "Click corner → click opposite corner" :
           "Click points · Double-click to finish · Esc to cancel"}
        </div>

        {/* AI Assistant — opens from sidebar icon */}
        {showAiAssistant && (
          <DrawingAIAssistant
            drawing={drawing}
            projectId={projectId}
            onAddToTakeoff={async items => {
              for (const item of items) {
                await fetch(`/api/projects/${projectId}/takeoff`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ source: "AI_GROQ", category: "AI Extracted", ...item, drawingId: drawing.id }),
                });
              }
            }}
          />
        )}
      </div>

      {/* ── DXF layer panel ─────────────────────────────────────── */}
      {isDxf && showLayerPanel && dxfLayers.length > 0 && (
        <LayerPanel
          title="CAD Layers"
          layers={dxfLayers.map(l => ({ id: l.name, name: l.name, color: l.color, visible: l.visible }))}
          onToggleLayer={() => {}}
          onToggleAll={() => {}}
        />
      )}

      {/* ── PDF real OCG layers ──────────────────────────────────── */}
      {isPdf && showLayerPanel && pdfLayers.length > 0 && (
        <LayerPanel
          title="PDF Layers"
          layers={pdfLayers.map(l => ({
            id:      l.id,
            name:    l.name,
            color:   "#60a5fa",   // blue for PDF layers
            visible: pdfLayerVis.get(l.id) ?? l.visible,
          }))}
          onToggleLayer={id => {
            setPdfLayerVis(prev => {
              const next = new Map(prev);
              next.set(id, !(next.get(id) ?? true));
              return next;
            });
          }}
          onToggleAll={visible => {
            setPdfLayerVis(new Map(pdfLayers.map(l => [l.id, visible])));
          }}
        />
      )}

      {/* ── PDF has no OCG: show AI room layers instead ──────────── */}
      {isPdf && showLayerPanel && pdfLayers.length === 0 && aiRoomLayers.length > 0 && (
        <LayerPanel
          title="Room Layers"
          layers={aiRoomLayers}
          onToggleLayer={handleToggleRoomLayer}
          onToggleAll={handleToggleAllRoomLayers}
        />
      )}

      {/* ── Image: AI room layers ────────────────────────────────── */}
      {isImage && showLayerPanel && (
        <LayerPanel
          title="Room Layers"
          layers={aiRoomLayers}
          onToggleLayer={handleToggleRoomLayer}
          onToggleAll={handleToggleAllRoomLayers}
        />
      )}

      {/* ── Takeoff sidebar ──────────────────────────────────────── */}
      {showSidebar && (
        <TakeoffSidebar
          projectId={projectId}
          drawingId={drawing.id}
          annotations={visibleAnnotations}
          selectedAnnotationId={selectedId}
          onSelectAnnotation={setSelectedId}
        />
      )}

      {/* ── Scale dialog ─────────────────────────────────────────── */}
      {showScaleDialog && (
        <ScaleCalibrator
          drawing={drawing}
          currentScale={scale}
          onSave={s => { setScale(s); setShowScaleDialog(false); }}
          onClose={() => setShowScaleDialog(false)}
        />
      )}

      {/* ── Region AI Analyzer ──────────────────────────────────── */}
      {showRegionAI && selectedAnn && (
        <RegionAnalyzer
          annotation={selectedAnn}
          drawing={drawing}
          projectId={projectId}
          pageNumber={pageNumber}
          zoom={zoom}
          onClose={() => setShowRegionAI(false)}
          onItemsSaved={() => setShowRegionAI(false)}
        />
      )}
    </div>
  );
}
