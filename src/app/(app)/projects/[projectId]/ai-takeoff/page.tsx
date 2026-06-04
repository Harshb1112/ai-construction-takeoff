"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload, CheckCircle2, Loader2, Download,
  ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  FileText, Cpu, Eye, EyeOff, Layers,
  Pencil, Trash2, Move, MessageSquare, Send, X, RotateCcw
} from "lucide-react";
import { bufToBase64, getLmStudioUrl } from "@/lib/utils";
import { COST_DATABASE } from "@/lib/cost-database";

const PdfDocumentViewer = dynamic(() => import("@/components/ai/PdfDocumentViewer").then(mod => mod.PdfDocumentViewer), {
  ssr: false,
  loading: () => (
    <div style={{ width: 1400, height: 600, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Loader2 size={28} color="#2563eb" className="animate-spin" />
    </div>
  ),
});

// Unit costs from cost database (CSI codes, US National rates)
const _db = (id: string) => COST_DATABASE.find(c => c.id === id)?.prices?.us_national?.total ?? 0;
const UNIT_COST_FLOOR_SF   = _db("09-0140"); // Hardwood flooring 3/4" Oak — 5.50/SF
const UNIT_COST_DRYWALL_SF = _db("09-0100"); // Gypsum drywall walls — 0.55/SF
const UNIT_COST_DOOR_EA    = _db("08-0100"); // Steel door 3'x7'      — 600/EA
const UNIT_COST_WINDOW_EA  = _db("08-0120"); // Aluminum window       — 400/EA
import { setupPdfWorker } from "@/lib/pdf-worker";
import styles from "./page.module.css";

// Configure the react-pdf v3 worker once at module load so both the
// <Document> viewer and pdfToBase64() share the same worker instance.
if (typeof window !== "undefined") setupPdfWorker();

// ─── Types ───────────────────────────────────────────────────────
interface DetectedRoom {
  id: string; name: string; type: string;
  layer?: string;                 // layer name (e.g. "Offices", "Circulation")
  x: number; y: number; w: number; h: number;
  polygon?: number[][];           // wall-following polygon pts [[x,y],...]
  areaSqM: number; lengthM: number; widthM: number;
  wallAreaSqM: number; ceilingSqM: number; perimeterM: number;
  doorCount: number; windowCount: number;
  floor: string; confidence: number;
}

interface LayerDef {
  name: string;
  color: string;
  visible: boolean;
  source: "semantic" | "detection" | "pdf_native" | "detected_type" | "detected";
  count?: number;
}
interface Opening { x: number; y: number; w: number; h: number }
interface PdfTextLabel {
  text: string; x: number; y: number; w: number; h: number;
  type: 'label'|'room_tag'|'dimension'|'grid_ref'|'area'|'nic'|'schedule_header';
  page?: number;
}
interface AnalysisResult {
  rooms: DetectedRoom[]; doors?: Opening[]; windows?: Opening[];
  textLabels?: PdfTextLabel[];   // ALL PDF text — every label from the drawing
  layers?: LayerDef[];
  scale?: string; unit?: string;
  imageWidth: number; imageHeight: number;
  totalAreaSqM?: number; processingMs?: number; pipeline?: string;
  mpp_px?: number;
}

// ─── Step definitions ─────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "PDF → Image",        icon: "📄", desc: "Rasterize page via PyMuPDF" },
  { id: 2, label: "Segmentation",        icon: "🧠", desc: "CubiCasa5k / YOLOv8 detection" },
  { id: 3, label: "OCR Scale",           icon: "🔍", desc: "Tesseract reads scale bar" },
  { id: 4, label: "Pixel → Real Area",   icon: "📐", desc: "Shapely polygon area in m²" },
  { id: 5, label: "Auto Markup",         icon: "🎨", desc: "Color-coded overlay on PDF" },
  { id: 6, label: "Table Generation",    icon: "📊", desc: "Rooms × area × perimeter" },
  { id: 7, label: "AI Summary",          icon: "🤖", desc: "LM Studio human-readable text" },
];

const ROOM_COLORS: Record<string, { fill: string; stroke: string }> = {
  BEDROOM:    { fill: "#6366f155", stroke: "#6366f1" },
  BATHROOM:   { fill: "#0ea5e955", stroke: "#0ea5e9" },
  KITCHEN:    { fill: "#f59e0b55", stroke: "#f59e0b" },
  LIVING:     { fill: "#10b98155", stroke: "#10b981" },
  DINING:     { fill: "#ec489955", stroke: "#ec4899" },
  CORRIDOR:   { fill: "#94a3b855", stroke: "#94a3b8" },
  STORE:      { fill: "#8b5cf655", stroke: "#8b5cf6" },
  BALCONY:    { fill: "#14b8a655", stroke: "#14b8a6" },
  GARAGE:     { fill: "#64748b55", stroke: "#64748b" },
  OFFICE:     { fill: "#2563eb55", stroke: "#2563eb" },
  MEETING:    { fill: "#7c3aed55", stroke: "#7c3aed" },
  RECEPTION:  { fill: "#05966955", stroke: "#059669" },
  LOBBY:      { fill: "#0891b255", stroke: "#0891b2" },
  ELECTRICAL: { fill: "#dc262655", stroke: "#dc2626" },
  MECHANICAL: { fill: "#d9770655", stroke: "#d97706" },
  STAIRCASE:  { fill: "#71717a55", stroke: "#71717a" },
  ELEVATOR:   { fill: "#52525b55", stroke: "#52525b" },
  TOILET:     { fill: "#0e749055", stroke: "#0e7490" },
  OTHER:      { fill: "#64748b33", stroke: "#64748b" },
};
const pal = (t: string) => ROOM_COLORS[t?.toUpperCase()] ?? ROOM_COLORS.OTHER;

// ─── Client-side post-processing filter ──────────────────────────
// Removes false positives: table rows, tiny blobs, extreme-aspect boxes
// (construction schedule cells, title blocks, legend areas, etc.)
function filterDetections(rooms: DetectedRoom[]): DetectedRoom[] {
  return rooms.filter(r => {
    // 1) Real rooms should have at least 1 m² of area
    if (r.areaSqM < 1.0) return false;
    // 2) Table rows / very thin horizontal bands: aspect ratio > 12
    const longer  = Math.max(r.w, r.h);
    const shorter = Math.min(r.w, r.h);
    if (shorter > 0 && longer / shorter > 12) return false;
    // 3) Degenerate bounding box (collapsed in one axis)
    if (r.w < 10 || r.h < 10) return false;
    return true;
  });
}

// ─── PDF → base64 for ML backend ─────────────────────────────────
async function pdfToBase64(file: File, pageNum = 1) {
  // Import pdfjs from react-pdf so we reuse the SAME v3 instance (and worker)
  // that <Document>/<Page> already use. Importing top-level pdfjs-dist (v5)
  // here would create a second, incompatible instance that destroys the shared
  // worker port and triggers "API version 3 ≠ Worker version 5" warnings.
  const { pdfjs } = await import("react-pdf");
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await pdf.getPage(pageNum);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(2.0, 1500 / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page.render as (p: any) => { promise: Promise<void> })({ canvasContext: ctx, viewport: vp }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return { base64: dataUrl.split(",")[1], mime: "image/jpeg", w: canvas.width, h: canvas.height };
}

async function imageToBase64(file: File) {
  const buf = await file.arrayBuffer();
  return new Promise<{ base64: string; mime: string; w: number; h: number }>((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); res({ base64: bufToBase64(buf), mime: file.type, w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = rej;
    img.src = url;
  });
}

// ─── Main page ───────────────────────────────────────────────────
export default function AiTakeoffPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient   = useQueryClient();

  const [file, setFile]         = useState<File | null>(null);
  const [fileUrl, setFileUrl]   = useState("");
  const [isPdf, setIsPdf]       = useState(false);
  const [pageNum, setPageNum]   = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [renderH, setRenderH]   = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);

  const [activeStep, setActiveStep]   = useState(0);
  const [stepDone, setStepDone]       = useState<Set<number>>(new Set());
  const [stepMsg, setStepMsg]         = useState<Record<number, string>>({});
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState("");

  const [result, setResult]         = useState<AnalysisResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showDoors, setShowDoors]       = useState(false); // off by default — too many false positives
  const [showTextLabels, setShowTextLabels] = useState(true);
  const [zoom, setZoom]             = useState(0.53);
  const [aiSummary, setAiSummary]   = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [imported, setImported]     = useState(false);
  const [scaleHint, setScaleHint]   = useState("auto");
  const [scaleDetected, setScaleDetected] = useState("");   // what PDF actually says
  const [scaleDetecting, setScaleDetecting] = useState(false);

  // ── Per-page results — each page has its OWN detection ────────────
  const [pageResults, setPageResults] = useState<Record<number, AnalysisResult>>({});

  // ── Layer visibility (name → visible) ─────────────────────────────
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [showLayerPanel, setShowLayerPanel]   = useState(false);

  const toggleLayer = (name: string) =>
    setLayerVisibility(prev => ({ ...prev, [name]: !(prev[name] ?? true) }));
  const isLayerVisible = (name?: string) =>
    name ? (layerVisibility[name] ?? true) : true;

  // Derive layers from current result (works even if server didn't return layers)
  const derivedLayers: LayerDef[] = useMemo(() => {
    if (!result) return [];
    // If server returned real layers — use them
    if (result.layers && result.layers.length > 0) return result.layers;
    // Otherwise build from rooms + doors + windows we already have
    const TYPE_COLORS: Record<string,string> = {
      OFFICE:"#2563eb", MEETING:"#7c3aed", CORRIDOR:"#6b7280",
      STORE:"#8b5cf6", KITCHEN:"#d97706", BATHROOM:"#0ea5e9",
      LOBBY:"#059669", OTHER:"#64748b",
    };
    const typeMap: Record<string, number> = {};
    result.rooms.forEach(r => { typeMap[r.type] = (typeMap[r.type] || 0) + 1; });
    const layers: LayerDef[] = Object.entries(typeMap).map(([t, c]) => ({
      name: t, color: TYPE_COLORS[t] ?? "#64748b",
      visible: true, source: "detected_type" as const, count: c,
    }));
    if ((result.doors ?? []).length > 0)   layers.push({name:"DOOR",   color:"#f59e0b",visible:true,source:"detected",count:result.doors?.length});
    if ((result.windows ?? []).length > 0) layers.push({name:"WINDOW", color:"#0ea5e9",visible:true,source:"detected",count:result.windows?.length});
    return layers;
  }, [result]);

  // Visible rooms (filtered by layer visibility)
  const visibleRooms   = result?.rooms.filter(r => isLayerVisible(r.layer ?? r.type)) ?? [];
  const visibleDoors   = isLayerVisible("DOOR")   ? (result?.doors   ?? []) : [];
  const visibleWindows = isLayerVisible("WINDOW") ? (result?.windows ?? []) : [];

  // ── Editor state ──────────────────────────────────────────────
  const [editMode, setEditMode]     = useState<"select"|"drag"|"erase"|"draw">("select");
  const [editingRoom, setEditingRoom] = useState<DetectedRoom | null>(null);
  const [aiCmd, setAiCmd]           = useState("");
  const [aiCmdLoading, setAiCmdLoading] = useState(false);
  const [resultHistory, setResultHistory] = useState<AnalysisResult[]>([]);

  // ── Manual draw state ─────────────────────────────────────────
  const [drawRect, setDrawRect]     = useState<{x:number;y:number;w:number;h:number}|null>(null);
  const [drawStart, setDrawStart]   = useState<{x:number;y:number}|null>(null);
  const [drawDialog, setDrawDialog] = useState<{
    imgX:number; imgY:number; imgW:number; imgH:number;
    polyPts?: number[][];  // polygon points in image space
  } | null>(null);
  const [newRoomName, setNewRoomName] = useState("New Room");
  const [newRoomType, setNewRoomType] = useState("OFFICE");

  // ── Polygon draw mode (click corners like Bluebeam) ────────────
  const [polyMode, setPolyMode]     = useState(false);  // polygon vs rectangle
  const [polyPoints, setPolyPoints] = useState<{x:number;y:number}[]>([]); // SVG pts

  const svgRef  = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    id: string; svgStartX: number; svgStartY: number;
    origX: number; origY: number;
  } | null>(null);

  const PDF_W = 1400;   // HD floor plan width

  // ── Editor helpers ────────────────────────────────────────────
  /** Save current result to undo history, then apply updater */
  const editResult = useCallback((updater: (prev: AnalysisResult) => AnalysisResult) => {
    setResult(prev => {
      if (!prev) return prev;
      setResultHistory(h => [...h.slice(-19), prev]); // keep 20 history steps
      return updater(prev);
    });
  }, []);

  const undoEdit = useCallback(() => {
    if (!resultHistory.length) return;
    const prev = resultHistory[resultHistory.length - 1];
    setResultHistory(h => h.slice(0, -1));
    setResult(prev);
  }, [resultHistory]);

  // ── Manual draw helpers ───────────────────────────────────────
  /** Convert SVG pixel position → image coordinate space */
  const svgToImg = useCallback((svgX: number, svgY: number) => {
    if (!result) return { x: 0, y: 0 };
    const sx = result.imageWidth  / PDF_W;
    const sy = result.imageHeight / renderH;
    return { x: Math.round(svgX * sx), y: Math.round(svgY * sy) };
  }, [result, renderH]);

  /** Real-world measurement from image pixels using detected scale */
  const pxToReal = useCallback((px: number) => {
    // mpp_px comes from server (real scale detection) — never hardcoded
    if (!result?.mpp_px) console.warn("[Scale] mpp_px missing from server response");
    const mpp = result?.mpp_px ?? 0.01693; // 0.01693 = 1/8"=1'-0" at 38dpi fallback only
    return px * mpp;
  }, [result]);

  const onDrawMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (editMode !== "draw" || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top)  / zoom;

    if (polyMode) {
      // Polygon mode — each click adds a vertex
      // Double-click closes the polygon
      if (e.detail === 2 && polyPoints.length >= 3) {
        // Close polygon → show save dialog
        const xs = polyPoints.map(p => p.x); const ys = polyPoints.map(p => p.y);
        const minX = Math.min(...xs); const maxX = Math.max(...xs);
        const minY = Math.min(...ys); const maxY = Math.max(...ys);
        const tl = svgToImg(minX, minY); const br = svgToImg(maxX, maxY);
        const imgPoly = polyPoints.map(p => svgToImg(p.x, p.y));
        setDrawDialog({
          imgX: tl.x, imgY: tl.y, imgW: br.x - tl.x, imgH: br.y - tl.y,
          polyPts: imgPoly.map(p => [p.x, p.y]),
        });
        setPolyPoints([]);
        return;
      }
      setPolyPoints(prev => [...prev, { x, y }]);
      return;
    }

    setDrawStart({ x, y });
    setDrawRect({ x, y, w: 0, h: 0 });
  }, [editMode, zoom, polyMode, polyPoints, svgToImg]);

  const onDrawMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (editMode !== "draw" || !drawStart || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / zoom;
    const cy = (e.clientY - rect.top)  / zoom;
    setDrawRect({
      x: Math.min(drawStart.x, cx),
      y: Math.min(drawStart.y, cy),
      w: Math.abs(cx - drawStart.x),
      h: Math.abs(cy - drawStart.y),
    });
  }, [editMode, drawStart, zoom]);

  const onDrawMouseUp = useCallback(() => {
    if (editMode !== "draw" || !drawRect || drawRect.w < 10 || drawRect.h < 10) {
      setDrawStart(null); setDrawRect(null); return;
    }
    // Convert SVG rect → image coordinates for storage
    const tl = svgToImg(drawRect.x, drawRect.y);
    const br = svgToImg(drawRect.x + drawRect.w, drawRect.y + drawRect.h);
    setDrawDialog({ imgX: tl.x, imgY: tl.y, imgW: br.x - tl.x, imgH: br.y - tl.y });
    setDrawStart(null);
  }, [editMode, drawRect, svgToImg]);

  const confirmDrawRoom = useCallback(() => {
    if (!drawDialog || !result) return;
    const { imgX, imgY, imgW, imgH, polyPts } = drawDialog;
    const lenM = Math.round(pxToReal(imgW) * 100) / 100;
    const widM = Math.round(pxToReal(imgH) * 100) / 100;

    // Shoelace formula for real polygon area (more accurate than bbox)
    let areaM: number;
    if (polyPts && polyPts.length >= 3) {
      let shoelace = 0;
      const n = polyPts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        shoelace += polyPts[i][0] * polyPts[j][1];
        shoelace -= polyPts[j][0] * polyPts[i][1];
      }
      const areaPx = Math.abs(shoelace) / 2;
      const mpp = result.mpp_px ?? 0.01693;
      areaM = Math.round(areaPx * mpp * mpp * 100) / 100;
    } else {
      areaM = Math.round(lenM * widM * 100) / 100;
    }
    const perim = Math.round((lenM + widM) * 2 * 100) / 100;
    const wallA = Math.round(perim * 2.8 * 0.8 * 100) / 100;
    const newRoom: DetectedRoom & { polygon?: number[][] } = {
      id:          `manual_${Date.now()}`,
      name:        newRoomName,
      type:        newRoomType,
      x: imgX, y: imgY, w: imgW, h: imgH,
      polygon:     polyPts ?? [[imgX,imgY],[imgX+imgW,imgY],[imgX+imgW,imgY+imgH],[imgX,imgY+imgH]],
      areaSqM:     areaM,
      lengthM:     lenM,
      widthM:      widM,
      wallAreaSqM: wallA,
      ceilingSqM:  areaM,
      perimeterM:  perim,
      doorCount:   0,
      windowCount: 0,
      floor:       "Ground Floor",
      confidence:  1.0,
    };
    editResult(prev => ({ ...prev, rooms: [...prev.rooms, newRoom] }));
    setDrawDialog(null);
    setDrawRect(null);
    setNewRoomName("New Room");
    setSelectedId(newRoom.id);
    setEditMode("select");
  }, [drawDialog, newRoomName, newRoomType, pxToReal, editResult]);

  const deleteRoom = useCallback((id: string) => {
    editResult(prev => ({ ...prev, rooms: prev.rooms.filter(r => r.id !== id) }));
    setSelectedId(null);
    setEditingRoom(null);
  }, [editResult]);

  const updateRoom = useCallback((id: string, patch: Partial<DetectedRoom>) => {
    editResult(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => r.id === id ? { ...r, ...patch } : r),
    }));
    if (editingRoom?.id === id) setEditingRoom(e => e ? { ...e, ...patch } : e);
  }, [editResult, editingRoom]);

  /** SVG drag — move a room overlay with mouse */
  const onSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>, roomId: string) => {
    if (editMode !== "drag") return;
    e.stopPropagation();
    const svg  = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const room = result?.rooms.find(r => r.id === roomId);
    if (!room) return;
    dragRef.current = {
      id: roomId,
      svgStartX: (e.clientX - rect.left) / zoom,
      svgStartY: (e.clientY - rect.top) / zoom,
      origX: room.x, origY: room.y,
    };
    e.preventDefault();
  }, [editMode, result, zoom]);

  const onSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current || !result || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const curX = (e.clientX - rect.left) / zoom;
    const curY = (e.clientY - rect.top) / zoom;
    const sx   = PDF_W / result.imageWidth;
    const sy   = renderH / result.imageHeight;
    const newX = Math.max(0, dragRef.current.origX + (curX - dragRef.current.svgStartX) / sx);
    const newY = Math.max(0, dragRef.current.origY + (curY - dragRef.current.svgStartY) / sy);
    setResult(prev => {
      if (!prev) return prev;
      return { ...prev, rooms: prev.rooms.map(r => r.id === dragRef.current!.id ? { ...r, x: newX, y: newY } : r) };
    });
  }, [result, renderH, zoom]);

  const onSvgMouseUp = useCallback(() => { dragRef.current = null; }, []);

  /** AI chat command parser */
  const applyAiCmd = useCallback(async () => {
    if (!result || !aiCmd.trim()) return;
    const cmd   = aiCmd.trim();
    const lower = cmd.toLowerCase();

    // Local parsing — instant, no LLM needed for simple commands
    // "delete [name]"
    const del = lower.match(/^(?:delete|remove|erase)\s+(.+)/);
    if (del) {
      const name = del[1];
      editResult(prev => ({ ...prev, rooms: prev.rooms.filter(r => !r.name.toLowerCase().includes(name)) }));
      setAiCmd(""); return;
    }
    // "rename [old] to [new]"
    const ren = lower.match(/rename\s+(.+?)\s+to\s+(.+)/);
    if (ren) {
      editResult(prev => ({ ...prev, rooms: prev.rooms.map(r => r.name.toLowerCase().includes(ren[1]) ? { ...r, name: ren[2].trim() } : r) }));
      setAiCmd(""); return;
    }
    // "[name] is [type]"
    const typ = lower.match(/^(.+?)\s+is\s+(office|meeting|corridor|bathroom|storage|kitchen|bedroom|living|lobby|elevator|stair|garage|other)/);
    if (typ) {
      editResult(prev => ({ ...prev, rooms: prev.rooms.map(r => r.name.toLowerCase().includes(typ[1]) ? { ...r, type: typ[2].toUpperCase() } : r) }));
      setAiCmd(""); return;
    }

    // Complex command → LM Studio
    setAiCmdLoading(true);
    try {
      const roomList = result.rooms.map(r => `${r.id}: ${r.name} (${r.type}, ${r.areaSqM.toFixed(1)}m²)`).join("\n");
      const prompt   = `Floor plan rooms:\n${roomList}\n\nUser correction: "${cmd}"\n\nReturn a JSON array of ONLY the rooms that need changes. Each item: {"id":"r1","name":"new name","type":"NEW_TYPE"}. Use types: OFFICE MEETING CORRIDOR BATHROOM STORE KITCHEN BEDROOM LIVING LOBBY ELEVATOR STAIRCASE GARAGE OTHER. Return only the JSON array.`;
      const res  = await fetch("/api/lmstudio/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, stream: false,
          model:   typeof window !== "undefined" ? (localStorage.getItem("lmstudio_model") ?? "local-model") : "local-model",
          baseUrl: getLmStudioUrl() }),
      });
      const data = await res.json();
      const text = data.text ?? "";
      const m    = text.match(/\[[\s\S]*?\]/);
      if (m) {
        const updates: Array<{id:string;name?:string;type?:string}> = JSON.parse(m[0]);
        editResult(prev => ({
          ...prev,
          rooms: prev.rooms.map(r => {
            const u = updates.find(x => x.id === r.id);
            return u ? { ...r, ...(u.name ? {name:u.name} : {}), ...(u.type ? {type:u.type} : {}) } : r;
          }),
        }));
      }
      setAiCmd("");
    } catch { /* LM Studio offline */ }
    finally { setAiCmdLoading(false); }
  }, [result, aiCmd, editResult]);

  // Measure rendered PDF height
  const measureHeight = useCallback(() => {
    if (pageRef.current) {
      const h = pageRef.current.offsetHeight || pageRef.current.clientHeight;
      if (h > 0) setRenderH(h);
    }
  }, []);

  useEffect(() => {
    if (!pageRef.current) return;
    const obs = new ResizeObserver(measureHeight);
    obs.observe(pageRef.current);
    return () => obs.disconnect();
  }, [fileUrl, measureHeight]);

  // Scale coordinates from ML canvas → PDF render space
  const scaleCoord = useCallback((r: DetectedRoom) => {
    if (!result || !result.imageWidth || !result.imageHeight || !renderH) return r;
    const sx = PDF_W / result.imageWidth;
    const sy = renderH / result.imageHeight;
    return { ...r, x: Math.round(r.x*sx), y: Math.round(r.y*sy), w: Math.round(r.w*sx), h: Math.round(r.h*sy) };
  }, [result, renderH]);

  const scaleOpen = useCallback((o: Opening) => {
    if (!result?.imageWidth || !renderH) return o;
    const sx = PDF_W / result.imageWidth;
    const sy = renderH / result.imageHeight;
    return { x: Math.round(o.x*sx), y: Math.round(o.y*sy), w: Math.max(10, Math.round(o.w*sx)), h: Math.max(10, Math.round(o.h*sy)) };
  }, [result, renderH]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setFileUrl(URL.createObjectURL(f));
    setIsPdf(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    setResult(null); setError(""); setActiveStep(0); setStepDone(new Set());
    setStepMsg({}); setAiSummary(""); setImported(false); setPageResults({});
    setScaleDetected(""); setScaleHint("auto");

    // Auto-fit zoom: fill viewer width properly
    requestAnimationFrame(() => {
      const viewerEl = document.querySelector('[class*="viewerArea"]') as HTMLElement | null;
      const rightPanel = document.querySelector('[class*="rightPanel"]') as HTMLElement | null;
      if (viewerEl) {
        const rightW  = rightPanel?.clientWidth ?? 360;
        const availW  = (viewerEl.clientWidth  || window.innerWidth - rightW - 40) - 32;
        const availH  = (viewerEl.clientHeight || window.innerHeight - 100) - 32;
        const zoomW   = availW / PDF_W;
        const zoomH   = availH / 800;
        const fitZoom = Math.min(zoomW, zoomH, 1.0);
        setZoom(Math.max(0.4, parseFloat(fitZoom.toFixed(2))));
      } else {
        setZoom(0.53);
      }
    });

    // Auto-detect scale from PDF immediately on upload
    const isPdfFile = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (isPdfFile) {
      setScaleDetecting(true);
      const fd = new FormData();
      fd.append("file", f, f.name);
      fd.append("page", "1");
      fetch("/api/floorplan/scale-detect", { method: "POST", body: fd })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.detected && data?.scale) {
            setScaleDetected(data.scale);
            setScaleHint(data.ratio ? `1:${data.ratio}` : "auto");
          } else {
            setScaleDetected("Not found in drawing");
          }
        })
        .catch(() => setScaleDetected("Detection failed"))
        .finally(() => setScaleDetecting(false));
    }
  };

  // ── Full 7-step pipeline ───────────────────────────────────────
  const run = useCallback(async () => {
    if (!file) return;
    setRunning(true); setError(""); setResult(null); setAiSummary("");
    setStepDone(new Set()); setStepMsg({});

    const done = (s: number, msg: string) => {
      setActiveStep(s + 1);
      setStepDone(prev => new Set([...prev, s]));
      setStepMsg(prev => ({ ...prev, [s]: msg }));
    };

    try {
      // ── Step 1: PDF → ALL pages analyzed separately ──────────────
      setActiveStep(1);
      let data: Record<string, unknown> | null = null;
      let w = 0, h = 0;

      // For PDFs: analyze EACH page separately and store per-page results
      // If numPages is not yet known (PDF viewer not loaded), get it via pdfjs
      let totalPdfPages = numPages;
      if (isPdf && totalPdfPages === 0) {
        try {
          const { pdfjs } = await import("react-pdf");
          const buf = await file.arrayBuffer();
          const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
          totalPdfPages = pdfDoc.numPages;
        } catch { totalPdfPages = 1; }
      }

      if (isPdf && totalPdfPages > 0) {
        const allPageResults: Record<number, AnalysisResult> = {};
        let doneCount = 0;
        let totalRooms = 0;

        const analyzePage = async (pg: number) => {
          const fd = new FormData();
          fd.append("file", file, file.name);
          fd.append("scale_hint", scaleHint || "auto");
          fd.append("page", String(pg));
          try {
            const pyRes = await fetch("/api/floorplan", { method: "POST", body: fd });
            if (pyRes.ok) {
              const pyData = await pyRes.json();
              if (pyData.rooms?.length) {
                pyData.rooms = (pyData.rooms as DetectedRoom[]).map((r: DetectedRoom) => ({
                  ...r, floor: `Page ${pg}`, id: `p${pg}_${r.id}`,
                }));
                allPageResults[pg] = pyData as AnalysisResult;
                totalRooms += pyData.rooms.length;
                // Show first completed page immediately
                if (pg === pageNum || Object.keys(allPageResults).length === 1) {
                  setResult(pyData as AnalysisResult);
                  w = pyData.imageWidth ?? 2000;
                  h = pyData.imageHeight ?? 1429;
                  data = pyData;
                }
                setPageResults({ ...allPageResults });
              }
            }
          } catch { /* page failed — skip */ }
          doneCount++;
          setStepMsg(prev => ({ ...prev, [1]: `Page ${doneCount}/${totalPdfPages} analyzed — ${totalRooms} rooms found` }));
        };

        // Analyze in parallel batches of 3 (fast for large PDFs, doesn't overload server)
        const BATCH = 3;
        setStepMsg(prev => ({ ...prev, [1]: `Analyzing ${totalPdfPages} pages in parallel…` }));
        for (let i = 0; i < totalPdfPages; i += BATCH) {
          const batch = [];
          for (let j = i + 1; j <= Math.min(i + BATCH, totalPdfPages); j++) batch.push(analyzePage(j));
          await Promise.all(batch);
        }

        setPageResults({ ...allPageResults });
        const curPageResult = allPageResults[pageNum] ?? allPageResults[Object.keys(allPageResults).map(Number).sort((a,b)=>a-b)[0]];
        if (curPageResult) {
          data = curPageResult as unknown as Record<string, unknown>;
          w = curPageResult.imageWidth ?? 2000;
          h = curPageResult.imageHeight ?? 1429;
        }
        done(1, `${totalPdfPages} pages done — ${totalRooms} rooms total`);

      } else if (isPdf) {
        // numPages not yet known — analyze current page only
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("scale_hint", scaleHint || "auto");
        fd.append("page", String(pageNum));
        const pyRes = await fetch("/api/floorplan", { method: "POST", body: fd });
        if (pyRes.ok) {
          const pyData = await pyRes.json();
          if (pyData.rooms?.length) {
            data = pyData;
            w = pyData.imageWidth ?? 2000;
            h = pyData.imageHeight ?? 1429;
            done(1, `PDF → ML server (${pyData.pipeline ?? "cad_vector"})`);
          }
        }
      }

      // Fallback: try floorplan server with image if PDF path failed
      if (!data) {
        const img = isPdf
          ? await pdfToBase64(file, pageNum)
          : await imageToBase64(file);
        w = img.w; h = img.h;
        done(1, `${w}×${h}px rendered`);

        // Try floorplan server with rendered image
        setActiveStep(2);
        try {
          const fd2 = new FormData();
          const blob2 = await fetch(`data:${img.mime};base64,${img.base64}`)
            .then(r => r.blob());
          fd2.append("file", blob2, "page.jpg");
          fd2.append("scale_hint", scaleHint || "auto");
          const pyRes2 = await fetch("/api/floorplan", { method: "POST", body: fd2 });
          if (pyRes2.ok) {
            const pyData2 = await pyRes2.json();
            if (pyData2.rooms?.length) { data = pyData2; }
          }
        } catch { /* server offline */ }

        if (!data?.rooms) throw new Error("Floorplan server offline — start scripts/floorplan_server.py");
      } else {
        setActiveStep(2);
      }

      if (!data || !(data.rooms as unknown[])?.length) throw new Error("No rooms detected");
      const pipeline = (data.pipeline as string) ?? "BIMBOSS TextGuided";
      const pipelineLabel = pipeline.includes("model")
        ? "BIMBOSS Model + TextGuided"
        : pipeline.includes("text_guided") ? "BIMBOSS TextGuided"
        : pipeline.includes("opencv") ? "BIMBOSS OpenCV"
        : pipeline;
      done(2, `${(data.rooms as unknown[]).length} rooms via ${pipelineLabel}`);

      // ── Step 3: Scale from floorplan server (PDF text layer) ─────
      setActiveStep(3);
      const scale = (data.scale as string | undefined) ?? scaleHint;
      const scaleDetectedOk = data.scaleDetected === true;
      const scaleSource = scaleDetectedOk ? "PDF text layer ✓" : "EasyOCR / estimated";
      const scaleClean  = scale?.replace(" (default)","").replace(" (estimated — scale not found in drawing)","") ?? "unknown";
      done(3, `${scaleClean} — ${scaleSource}`);

      // ── Step 4: Pixel → Real Area ─────────────────────────────
      setActiveStep(4);
      const dataRooms = data.rooms as DetectedRoom[];
      const totalArea = dataRooms.reduce((s: number, r: DetectedRoom) => s + r.areaSqM, 0);
      done(4, `Total: ${totalArea.toFixed(1)} m²`);

      // ── Step 5: Auto Markup ───────────────────────────────────
      setActiveStep(5);
      // ML coords → canvas/image coords (scaleX/Y = 1 for cad_vector since
      // imageWidth/Height already come from the ML server at native resolution)
      const imgW = (data.imageWidth as number) || w;
      const imgH = (data.imageHeight as number) || h;
      const scaleX = imgW > 0 ? w / imgW : 1;
      const scaleY = imgH > 0 ? h / imgH : 1;
      const scaledRooms = dataRooms.map((r: DetectedRoom) => ({
        ...r,
        x: Math.round(r.x * scaleX),
        y: Math.round(r.y * scaleY),
        w: Math.round(r.w * scaleX),
        h: Math.round(r.h * scaleY),
      }));
      // Remove false positives (table rows, tiny cells, extreme aspect ratios)
      const rooms = filterDetections(scaledRooms);
      setResult({ ...(data as Partial<AnalysisResult>), rooms, imageWidth: w, imageHeight: h } as AnalysisResult);
      setSelectedId(rooms[0]?.id ?? null);
      const filteredOut = dataRooms.length - rooms.length;
      done(5, filteredOut > 0
        ? `${rooms.length} rooms (${filteredOut} false-positives removed)`
        : `${rooms.length} rooms detected — all valid`);

      // ── Step 6: Table ─────────────────────────────────────────
      setActiveStep(6);
      done(6, `${rooms.length} rows × 8 columns`);

      // ── Step 7: AI Summary ────────────────────────────────────
      setActiveStep(7);
      setSummaryLoading(true);
      try {
        const byFloor: Record<string, DetectedRoom[]> = {};
        for (const r of rooms) { if (!byFloor[r.floor]) byFloor[r.floor] = []; byFloor[r.floor].push(r); }
        const prompt = `You are a professional quantity surveyor. Summarize this floor plan analysis in 2-3 sentences:
${Object.entries(byFloor).map(([fl, rs]) => `${fl}: ${rs.map(r => `${r.name} (${r.areaSqM.toFixed(1)} m²)`).join(", ")}`).join("\n")}
Total area: ${totalArea.toFixed(1)} m² | Scale: ${scale}
Write a professional summary for a QS report.`;

        const lmRes = await fetch("/api/lmstudio/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: prompt, stream: false,
            // model auto-detected from LM Studio /models endpoint
            model: typeof window !== "undefined" ? (localStorage.getItem("lmstudio_model") || undefined) : undefined,
            baseUrl: getLmStudioUrl(),
          }),
        });
        const lmData = await lmRes.json();
        const summary = lmData.text ?? lmData.error ?? "Summary not available.";
        setAiSummary(summary);
        done(7, "Summary generated");
      } catch {
        setAiSummary("LM Studio offline — start it to generate AI summary.");
        done(7, "Offline — manual review needed");
      } finally {
        setSummaryLoading(false);
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
      setActiveStep(0);
    }
  }, [file, isPdf, pageNum, scaleHint]);

  // ── Import to takeoff ──────────────────────────────────────────
  const importToTakeoff = async () => {
    if (!result) return;
    for (const r of result.rooms) {
      const sqft = r.areaSqM * 10.764;
      await fetch(`/api/projects/${projectId}/takeoff`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "MARKUP", category: "Room Area", description: `${r.name} — Floor`, quantity: sqft, unit: "SF", unitCost: UNIT_COST_FLOOR_SF, totalCost: sqft*UNIT_COST_FLOOR_SF, notes: `${r.areaSqM.toFixed(2)} m²` }),
      });
      if (r.wallAreaSqM) await fetch(`/api/projects/${projectId}/takeoff`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "MARKUP", category: "Drywall", description: `${r.name} — Walls`, quantity: r.wallAreaSqM*10.764, unit: "SF", unitCost: UNIT_COST_DRYWALL_SF, totalCost: r.wallAreaSqM*10.764*UNIT_COST_DRYWALL_SF }),
      });
    }
    queryClient.invalidateQueries({ queryKey: ["takeoff", projectId] });
    setImported(true);
  };

  // ── Export CSV ────────────────────────────────────────────────
  const exportCsv = () => {
    if (!result) return;
    const rows = [["Room","Type","Floor","Area m²","Area ft²","Wall Area m²","Ceiling m²","Perimeter m","Doors","Windows","Confidence"]];
    for (const r of result.rooms)
      rows.push([r.name,r.type,r.floor,r.areaSqM.toFixed(2),(r.areaSqM*10.764).toFixed(1),r.wallAreaSqM.toFixed(2),(r.ceilingSqM??0).toFixed(2),(r.perimeterM??0).toFixed(2),String(r.doorCount),String(r.windowCount),`${((r.confidence??0)*100).toFixed(0)}%`]);
    const blob = new Blob([rows.map(r=>r.join(",")).join("\n")], { type:"text/csv" });
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="floorplan_takeoff.csv"; a.click();
  };

  // ── Export PDF with markup overlay ───────────────────────────
  const [exportingPdf, setExportingPdf] = useState(false);
  const exportMarkupPdf = async () => {
    if (!file || !result || !isPdf) return;
    setExportingPdf(true);
    try {
      const { pdfjs } = await import("react-pdf");
      const buf = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

      const outDoc = await PDFDocument.create();
      const font   = await outDoc.embedFont(StandardFonts.HelveticaBold);

      const pagesToExport = Object.keys(pageResults).length > 0
        ? Object.entries(pageResults).map(([pg, r]) => ({ pg: parseInt(pg), r }))
        : [{ pg: pageNum, r: result }];

      for (const { pg, r: pageResult } of pagesToExport) {
        // Render PDF page to canvas at 2× resolution
        const pdfPage = await pdfDoc.getPage(pg);
        const vp0 = pdfPage.getViewport({ scale: 1 });
        const renderScale = Math.min(3.0, 3000 / Math.max(vp0.width, vp0.height));
        const vp = pdfPage.getViewport({ scale: renderScale });
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (pdfPage.render as (p: any) => { promise: Promise<void> })({ canvasContext: ctx, viewport: vp }).promise;

        // Draw room overlays
        const sx = canvas.width  / pageResult.imageWidth;
        const sy = canvas.height / pageResult.imageHeight;
        for (const room of pageResult.rooms) {
          const pts = room.polygon && room.polygon.length >= 3
            ? room.polygon : [[room.x,room.y],[room.x+room.w,room.y],[room.x+room.w,room.y+room.h],[room.x,room.y+room.h]];
          const p = pal(room.type);
          // Fill
          ctx.beginPath();
          ctx.moveTo(pts[0][0]*sx, pts[0][1]*sy);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0]*sx, pts[i][1]*sy);
          ctx.closePath();
          // Use exact same fill/stroke as screen overlay so export matches screen
          ctx.fillStyle   = p.fill;
          ctx.fill();
          ctx.strokeStyle = p.stroke;
          ctx.lineWidth   = Math.max(2, 2.5 * renderScale / 2);
          ctx.stroke();
          // Label background
          const cx = pts.reduce((s,pt)=>s+pt[0],0)/pts.length*sx;
          const cy = pts.reduce((s,pt)=>s+pt[1],0)/pts.length*sy;
          const label1 = room.name;
          const label2 = `${(room.areaSqM*10.764).toFixed(0)} ft²  (${room.areaSqM.toFixed(1)} m²)`;
          const fSize  = Math.max(11, Math.min(18, room.w * sx / label1.length * 1.2));
          ctx.font = `bold ${fSize}px Arial`;
          const tw1 = ctx.measureText(label1).width;
          const tw2 = ctx.measureText(label2).width;
          const bw  = Math.max(tw1, tw2) + 12;
          const bh  = fSize * 2.6 + 8;
          ctx.fillStyle   = "rgba(15,23,42,0.75)";
          ctx.beginPath();
          const rx = cx - bw/2, ry = cy - bh/2;
          ctx.roundRect(rx, ry, bw, bh, 4);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.fillText(label1, cx, cy - fSize*0.4);
          ctx.font = `${fSize*0.8}px Arial`;
          ctx.fillStyle = "#a5f3fc";
          ctx.fillText(label2, cx, cy + fSize*0.9);
        }

        // Embed canvas as PNG into output PDF
        const pngBytes = await new Promise<Uint8Array>((res, rej) => {
          canvas.toBlob(blob => {
            if (!blob) { rej(new Error("canvas.toBlob failed")); return; }
            blob.arrayBuffer().then(ab => res(new Uint8Array(ab)));
          }, "image/png");
        });
        const img       = await outDoc.embedPng(pngBytes);
        const outPage   = outDoc.addPage([vp0.width, vp0.height]);
        outPage.drawImage(img, { x:0, y:0, width: vp0.width, height: vp0.height });

        // Add small legend strip at bottom
        const legendY = 14;
        const types = [...new Set(pageResult.rooms.map(r=>r.type))].slice(0,8);
        let lx = 20;
        for (const t of types) {
          const pc = pal(t);
          const hexToRgb = (h: string) => {
            const r2 = parseInt(h.slice(1,3),16)/255;
            const g2 = parseInt(h.slice(3,5),16)/255;
            const b2 = parseInt(h.slice(5,7),16)/255;
            return rgb(r2,g2,b2);
          };
          outPage.drawRectangle({ x:lx, y:legendY, width:10, height:10,
            color: hexToRgb(pc.stroke), opacity:0.9 });
          outPage.drawText(t, { x:lx+13, y:legendY+2, size:7, font, color:rgb(0.2,0.2,0.2) });
          lx += 13 + font.widthOfTextAtSize(t, 7) + 10;
        }
      }

      const pdfBytes = await outDoc.save();
      const blob = new Blob([pdfBytes as unknown as ArrayBuffer], { type:"application/pdf" });
      const a = document.createElement("a");
      a.href     = URL.createObjectURL(blob);
      a.download = file.name.replace(/\.pdf$/i,"") + "_markup.pdf";
      a.click();
    } catch(e) {
      console.error("PDF export failed:", e);
    } finally {
      setExportingPdf(false);
    }
  };

  // ── Export DXF (CAD) ──────────────────────────────────────────
  const exportDxf = () => {
    if (!result || !file) return;
    const mpp  = result.mpp_px ?? 0.01693;
    const allRooms = Object.values(pageResults).length > 0
      ? Object.values(pageResults).flatMap(r => r.rooms)
      : result.rooms;

    // Collect unique layer names
    const layerTypes = [...new Set(allRooms.map(r => r.type))];

    // DXF layer color codes per type
    const DXF_COLORS: Record<string,number> = {
      OFFICE:5, MEETING:6, CORRIDOR:8, KITCHEN:2, BATHROOM:4,
      LIVING:3, BEDROOM:1, LOBBY:3, STORE:7, OTHER:9,
    };

    let dxf = `  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1015\n  0\nENDSEC\n`;

    // TABLES section — define layers
    dxf += `  0\nSECTION\n  2\nTABLES\n  0\nTABLE\n  2\nLAYER\n 70\n${layerTypes.length}\n`;
    for (const t of layerTypes) {
      dxf += `  0\nLAYER\n  2\n${t}\n 70\n0\n 62\n${DXF_COLORS[t]??9}\n  6\nCONTINUOUS\n`;
    }
    dxf += `  0\nENDTABLE\n  0\nENDSEC\n`;

    // ENTITIES section — room polygons + text labels
    dxf += `  0\nSECTION\n  2\nENTITIES\n`;

    for (const room of allRooms) {
      const pts = room.polygon && room.polygon.length >= 3
        ? room.polygon
        : [[room.x,room.y],[room.x+room.w,room.y],[room.x+room.w,room.y+room.h],[room.x,room.y+room.h]];

      // Convert pixels → meters (flip Y: DXF Y goes up, image Y goes down)
      const maxY = result.imageHeight;
      const realPts = pts.map(([px,py]: number[]) => [
        parseFloat((px * mpp).toFixed(4)),
        parseFloat(((maxY - py) * mpp).toFixed(4)),
      ]);

      // LWPOLYLINE (closed)
      dxf += `  0\nLWPOLYLINE\n  8\n${room.type}\n 70\n1\n 90\n${realPts.length}\n`;
      dxf += ` 43\n0.0\n`;
      for (const [x, y] of realPts) {
        dxf += ` 10\n${x}\n 20\n${y}\n`;
      }

      // TEXT label at centroid
      const cx = parseFloat((realPts.reduce((s,p)=>s+p[0],0)/realPts.length).toFixed(4));
      const cy = parseFloat((realPts.reduce((s,p)=>s+p[1],0)/realPts.length).toFixed(4));
      const areaLabel = `${room.name} | ${room.areaSqM.toFixed(1)}m² (${(room.areaSqM*10.764).toFixed(0)}ft²)`;
      dxf += `  0\nTEXT\n  8\n${room.type}\n 10\n${cx}\n 20\n${cy}\n 30\n0.0\n 40\n0.25\n  1\n${areaLabel}\n 72\n1\n 73\n2\n`;
    }

    dxf += `  0\nENDSEC\n  0\nEOF\n`;

    const blob = new Blob([dxf], { type:"application/dxf" });
    const a = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = file.name.replace(/\.pdf$/i,"") + "_rooms.dxf";
    a.click();
  };

  const totalArea  = result?.rooms.reduce((s,r)=>s+r.areaSqM,0)??0;
  const totalWall  = result?.rooms.reduce((s,r)=>s+r.wallAreaSqM,0)??0;
  const totalDoors = result?.rooms.reduce((s,r)=>s+r.doorCount,0)??0;
  const totalWins  = result?.rooms.reduce((s,r)=>s+r.windowCount,0)??0;
  const selRoom    = result?.rooms.find(r=>r.id===selectedId);

  return (
    <div className={styles.pageRoot}>

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>AI Takeoff</span>
        <span className={styles.toolbarSub}>7-step Revu-style pipeline</span>

        {/* Upload */}
        <label className={`${styles.uploadLabel} ${file ? styles.uploadLabelActive : ""}`}>
          <Upload size={13}/>{file ? file.name.slice(0,30) : "Upload PDF / Image"}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={onFile}/>
        </label>

        {/* Scale — auto-detected from PDF, editable if wrong */}
        <div style={{ display:"flex", alignItems:"center", gap:5,
          background:"rgba(255,255,255,0.07)", borderRadius:8,
          padding:"3px 10px", border:"1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ fontSize:10, color:"#94a3b8", whiteSpace:"nowrap" }}>Scale:</span>
          {scaleDetecting ? (
            <span style={{ fontSize:10, color:"#60a5fa", display:"flex", alignItems:"center", gap:4 }}>
              <Loader2 size={10} className="animate-spin"/> Reading PDF…
            </span>
          ) : scaleDetected ? (
            <span style={{ fontSize:10, color: scaleDetected.includes("Not found") || scaleDetected.includes("failed") ? "#f59e0b" : "#86efac",
              fontWeight:700, whiteSpace:"nowrap" }}>
              {scaleDetected.includes("Not found") || scaleDetected.includes("failed")
                ? "⚠ " : "✓ "}{scaleDetected}
            </span>
          ) : (
            <span style={{ fontSize:10, color:"#475569" }}>Upload PDF to detect</span>
          )}
          <input
            value={scaleHint === "auto" ? "" : scaleHint}
            onChange={e => setScaleHint(e.target.value || "auto")}
            placeholder="override e.g. 1:100"
            title="Override detected scale (e.g. 1:100, 1:50, 1/8&quot;=1'-0&quot;)"
            style={{
              width:110, fontSize:10, padding:"2px 6px",
              background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)",
              borderRadius:5, color:"#e2e8f0", outline:"none",
            }}
          />
        </div>

        {/* Page navigation — visible as soon as PDF loaded */}
        {isPdf && numPages > 1 && (
          <div style={{ display:"flex", alignItems:"center", gap:4, background:"rgba(255,255,255,0.08)", borderRadius:8, padding:"3px 8px", border:"1px solid rgba(255,255,255,0.12)" }}>
            <button
              onClick={()=>{ const pg=Math.max(1,pageNum-1); setPageNum(pg); setResult(pageResults[pg]??null); setSelectedId(null); setShowDoors(false); }}
              disabled={pageNum<=1}
              style={{ background:"none", border:"none", cursor:pageNum<=1?"not-allowed":"pointer", color:pageNum<=1?"#334155":"#94a3b8", padding:"2px 4px" }}>
              <ChevronLeft size={14}/>
            </button>
            <span style={{ fontSize:11, color:"#94a3b8", minWidth:60, textAlign:"center" }}>
              Page {pageNum}/{numPages}
              {pageResults[pageNum] && <span style={{ color:"#10b981", marginLeft:4 }}>✓</span>}
            </span>
            <button
              onClick={()=>{ const pg=Math.min(numPages,pageNum+1); setPageNum(pg); setResult(pageResults[pg]??null); setSelectedId(null); setShowDoors(false); }}
              disabled={pageNum>=numPages}
              style={{ background:"none", border:"none", cursor:pageNum>=numPages?"not-allowed":"pointer", color:pageNum>=numPages?"#334155":"#94a3b8", padding:"2px 4px" }}>
              <ChevronRight size={14}/>
            </button>
          </div>
        )}

        <button onClick={run} disabled={!file||running}
          className={`${styles.runBtn} ${!file||running ? styles.runBtnDisabled : styles.runBtnActive}`}>
          {running ? <Loader2 size={13} className="animate-spin"/> : <Cpu size={13}/>}
          {running ? "Analyzing…" : "Run Full Pipeline"}
        </button>

        {error && <span className={styles.errorBadge}>⚠ {error}</span>}

        {/* Overlay + Editor controls */}
        {result && (
          <div className={styles.toolbarRight}>
            <button onClick={()=>setShowLayerPanel(v=>!v)} title="Layers"
              className={`${styles.toolbarBtn} ${showLayerPanel ? styles.toolbarBtnActive : ""}`}>
              <Layers size={11}/> Layers {result?.layers ? `(${derivedLayers.length})` : ""}
            </button>
            <div className={styles.toolbarDivider}/>
            <button onClick={undoEdit} disabled={!resultHistory.length} title="Undo"
              className={styles.toolbarBtn}>
              <RotateCcw size={11}/>
            </button>
            {editMode === "draw" && (
              <div className={styles.drawModeToggle}>
                <button onClick={()=>{ setPolyMode(false); setPolyPoints([]); }} title="Rectangle draw"
                  className={`${styles.drawModeBtn} ${!polyMode ? styles.drawModeBtnActive : styles.drawModeBtnInactive}`}>▭ Rect</button>
                <button onClick={()=>{ setPolyMode(true); setPolyPoints([]); }} title="Polygon draw (click corners)"
                  className={`${styles.drawModeBtn} ${polyMode ? styles.drawModeBtnActive : styles.drawModeBtnInactive}`}>⬠ Poly</button>
              </div>
            )}
            {(["select","draw","drag","erase"] as const).map(mode => (
              <button key={mode} onClick={()=>{ setEditMode(mode); setDrawRect(null); setDrawStart(null); setPolyPoints([]); }}
                title={mode==="draw"?"Manual draw room":mode}
                className={`${styles.toolbarBtn} ${editMode===mode ? (mode==="draw" ? styles.toolbarBtnDraw : styles.toolbarBtnActive) : ""}`}>
                {mode==="select" ? <Eye size={11}/> : mode==="draw" ? <Pencil size={11}/> : mode==="drag" ? <Move size={11}/> : <Trash2 size={11}/>}
              </button>
            ))}
            <div className={styles.toolbarDivider}/>
            <button onClick={()=>setShowOverlay(v=>!v)} title="Toggle overlay"
              className={`${styles.toolbarBtn} ${showOverlay ? styles.toolbarBtnActive : ""}`}>
              {showOverlay?<Eye size={11}/>:<EyeOff size={11}/>}
            </button>
            <button onClick={()=>setShowDoors(v=>!v)}
              className={`${styles.toolbarBtn} ${showDoors ? styles.toolbarBtnErase : ""}`}>D/W</button>
            <button onClick={()=>setShowTextLabels(v=>!v)}
              title="Toggle all PDF text labels"
              className={`${styles.toolbarBtn} ${showTextLabels ? styles.toolbarBtnErase : ""}`}>TXT</button>
            <button onClick={()=>setZoom(z=>Math.min(z+0.1,3))} className={styles.toolbarBtn}><ZoomIn size={12}/></button>
            <button onClick={()=>setZoom(z=>Math.max(z-0.1,0.15))} className={styles.toolbarBtn}><ZoomOut size={12}/></button>
            <button onClick={()=>{
              const el = document.querySelector('[class*="viewerArea"]') as HTMLElement|null;
              if(el){ const fw=Math.min((el.clientWidth-32)/PDF_W,(el.clientHeight-32)/900,1.0); setZoom(Math.max(0.2,parseFloat(fw.toFixed(2)))); }
            }} className={styles.toolbarBtn} title="Fit to screen" style={{fontSize:9,fontWeight:700}}>FIT</button>
            <span style={{fontSize:9,color:"#475569",minWidth:28,textAlign:"center"}}>{Math.round(zoom*100)}%</span>
            <div className={styles.toolbarDivider}/>
            {/* ── Export buttons in toolbar ── */}
            <button
              onClick={exportMarkupPdf}
              disabled={!isPdf || exportingPdf}
              title="Export PDF with room markup overlay"
              className={styles.toolbarBtn}
              style={{ color:"#93c5fd", fontWeight:700, fontSize:10, gap:3, opacity:(!isPdf||exportingPdf)?0.4:1 }}
            >
              {exportingPdf ? <Loader2 size={11} className="animate-spin"/> : <FileText size={11}/>}
              PDF
            </button>
            <button
              onClick={exportDxf}
              title="Export rooms as DXF (AutoCAD / Revit / SketchUp)"
              className={styles.toolbarBtn}
              style={{ color:"#86efac", fontWeight:700, fontSize:10, gap:3 }}
            >
              <Download size={11}/>DXF
            </button>
            <button
              onClick={exportCsv}
              title="Export room table as CSV"
              className={styles.toolbarBtn}
              style={{ color:"#fbbf24", fontWeight:700, fontSize:10, gap:3 }}
            >
              <Download size={11}/>CSV
            </button>
          </div>
        )}
      </div>

      {/* ── Main layout ──────────────────────────────────────────── */}
      <div className={styles.mainLayout}>

        {/* ── Left: PDF viewer + SVG overlay ───────────────────── */}
        <div className={styles.viewerArea}>
          {!fileUrl ? (
            <label className={styles.uploadDropzone}>
              <FileText size={48} opacity={0.3}/>
              <p className={styles.uploadDropzoneTitle}>Upload a Floor Plan</p>
              <p className={styles.uploadDropzoneDesc}>PDF, PNG, JPG — AI analyzes rooms, walls, doors, windows</p>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={onFile}/>
            </label>
          ) : (
            <div style={{ transform:`scale(${zoom})`, transformOrigin:"top center", transition:"transform .2s" }} className={styles.pdfWrapper}>
              <div ref={pageRef} className={styles.pageContainer}>
                {isPdf ? (
                  <PdfDocumentViewer
                    fileUrl={fileUrl}
                    pageNum={pageNum}
                    pageWidth={PDF_W}
                    onLoadSuccess={setNumPages}
                    onRenderSuccess={measureHeight}
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={fileUrl} alt="Floor plan" style={{ display:"block", width:PDF_W }} onLoad={e=>{const i=e.currentTarget as HTMLImageElement; setRenderH(Math.round(i.naturalHeight*PDF_W/i.naturalWidth));}} draggable={false}/>
                )}

                {/* ── Layer Panel (floating overlay — triggered from toolbar) ── */}
                {showLayerPanel && derivedLayers.length > 0 && (
                  <div style={{
                    position:"absolute",top:8,left:8,zIndex:30,
                    background:"rgba(15,23,42,0.96)",backdropFilter:"blur(8px)",
                    borderRadius:12,border:"1px solid #1e293b",
                    padding:"10px 12px",minWidth:200,maxWidth:250,
                    boxShadow:"0 8px 24px rgba(0,0,0,.5)",
                  }}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                      <p style={{fontSize:11,fontWeight:700,color:"#7dd3fc",textTransform:"uppercase",letterSpacing:".05em",margin:0}}>
                        Layers ({derivedLayers.length})
                      </p>
                      <button onClick={()=>setShowLayerPanel(false)}
                        style={{background:"none",border:"none",cursor:"pointer",color:"#475569",fontSize:16,lineHeight:1,padding:"0 2px"}}>×</button>
                    </div>
                    {derivedLayers.map(layer => {
                      const vis=isLayerVisible(layer.name);
                      return (
                        <div key={layer.name} onClick={()=>toggleLayer(layer.name)}
                          style={{display:"flex",alignItems:"center",gap:7,padding:"5px 6px",borderRadius:6,cursor:"pointer",marginBottom:2,
                            background:vis?"rgba(255,255,255,0.05)":"transparent",opacity:vis?1:0.4,
                            border:`1px solid ${vis?"rgba(255,255,255,0.07)":"transparent"}`}}>
                          <span style={{fontSize:10,color:vis?"#7dd3fc":"#475569"}}>{vis?"👁":"○"}</span>
                          <span style={{width:10,height:10,borderRadius:"50%",flexShrink:0,background:layer.color??"#64748b"}}/>
                          <span style={{flex:1,fontSize:11,color:vis?"#e2e8f0":"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {layer.name}
                          </span>
                          {layer.count!=null&&<span style={{fontSize:9,color:"#475569"}}>{layer.count}</span>}
                          {layer.source==="pdf_native"&&<span style={{fontSize:8,background:"#1e293b",color:"#94a3b8",padding:"1px 4px",borderRadius:3}}>PDF</span>}
                        </div>
                      );
                    })}
                    <div style={{borderTop:"1px solid #1e293b",marginTop:6,paddingTop:6,display:"flex",gap:5}}>
                      <button onClick={()=>{const a:Record<string,boolean>={};derivedLayers.forEach(l=>{a[l.name]=true;});setLayerVisibility(a);}}
                        style={{flex:1,fontSize:9,padding:"3px 5px",borderRadius:4,border:"1px solid #1e293b",background:"none",color:"#7dd3fc",cursor:"pointer"}}>Show all</button>
                      <button onClick={()=>{const a:Record<string,boolean>={};derivedLayers.forEach(l=>{a[l.name]=false;});setLayerVisibility(a);}}
                        style={{flex:1,fontSize:9,padding:"3px 5px",borderRadius:4,border:"1px solid #1e293b",background:"none",color:"#475569",cursor:"pointer"}}>Hide all</button>
                    </div>
                  </div>
                )}

                {/* ── SVG overlay ── */}
                {result && showOverlay && renderH > 0 && (
                  <svg
                    ref={svgRef}
                    width={PDF_W} height={renderH}
                    style={{ position:"absolute", top:0, left:0,
                      cursor: editMode==="draw"?"crosshair": editMode==="drag"?"move": editMode==="erase"?"crosshair":"default" }}
                    onClick={e => { if (e.target === e.currentTarget && editMode==="select") { setSelectedId(null); setEditingRoom(null); } }}
                    onMouseDown={onDrawMouseDown}
                    onMouseMove={e => { onSvgMouseMove(e); onDrawMouseMove(e); }}
                    onMouseUp={e => { onSvgMouseUp(); onDrawMouseUp(); }}
                    onMouseLeave={e => { onSvgMouseUp(); onDrawMouseUp(); }}
                  >
                    <defs>
                      {/* White outline text effect */}
                      <filter id="lbl">
                        <feMorphology in="SourceGraphic" operator="dilate" radius="1.2" result="outline"/>
                        <feFlood floodColor="#fff" result="white"/>
                        <feComposite in="white" in2="outline" operator="in" result="wborder"/>
                        <feMerge><feMergeNode in="wborder"/><feMergeNode in="SourceGraphic"/></feMerge>
                      </filter>
                    </defs>

                    {/* ── Rooms — filtered by layer visibility ── */}
                    {visibleRooms.filter(room => room.type !== "NIC" && room.name !== "N.I.C.").map(room => {
                      const r    = scaleCoord(room);

                      // Color: custom > GREEN default (like manual Mattel markup)
                      const customHex = (room as DetectedRoom & {_customColor?:string})._customColor;
                      const GREEN = "#4ade80";   // green — new construction rooms
                      const GRAY  = "#9ca3af";   // gray  — NIC / existing
                      const isNic = room.type === "NIC" || room.name?.includes("N.I.C");
                      const isExisting = room.name?.includes("(E)") || room.type === "EXISTING";
                      const base  = customHex ?? (isNic ? GRAY : isExisting ? GRAY : GREEN);
                      const clr   = { stroke: base, fill: base + "40" };
                      const isSel  = room.id === selectedId;
                      const cx = r.x + r.w / 2;
                      const cy = r.y + r.h / 2;
                      const fs = Math.max(10, Math.min(15, Math.sqrt(r.w * r.h) / 7));
                      const areaFt = (room.areaSqM * 10.764).toFixed(1);
                      const areaM2 = room.areaSqM.toFixed(1);
                      const lft = (room.lengthM * 3.281).toFixed(0);
                      const wft = (room.widthM  * 3.281).toFixed(0);

                      // Scale polygon points (wall-following) to SVG space
                      const poly = room.polygon && room.polygon.length > 3
                        ? room.polygon.map(([px, py]) => {
                            const sx2 = PDF_W / result.imageWidth;
                            const sy2 = renderH / result.imageHeight;
                            return `${Math.round(px*sx2)},${Math.round(py*sy2)}`;
                          }).join(' ')
                        : null;

                      return (
                        <g key={room.id}
                          style={{ cursor: editMode==="erase"?"crosshair": editMode==="drag"?"grab":"pointer" }}
                          onClick={e => {
                            e.stopPropagation();
                            if (editMode === "erase") { deleteRoom(room.id); return; }
                            setSelectedId(isSel ? null : room.id);
                            setEditingRoom(isSel ? null : room);
                          }}
                          onMouseDown={e => onSvgMouseDown(e as unknown as React.MouseEvent<SVGSVGElement>, room.id)}>

                          {/* ── Bluebeam polygon shape ── */}
                          {poly ? (
                            <>
                              {isSel && <polygon points={poly}
                                fill="none" stroke={clr.stroke} strokeWidth={4}
                                strokeDasharray="10 4" opacity={0.9}/>}
                              <polygon points={poly}
                                fill={clr.fill}
                                stroke={clr.stroke}
                                strokeWidth={isSel ? 3 : 2}
                                style={{ pointerEvents:"all" }}/>
                            </>
                          ) : (
                            <>
                              {isSel && <rect x={r.x-4} y={r.y-4} width={r.w+8} height={r.h+8}
                                fill="none" stroke={clr.stroke} strokeWidth={3}
                                strokeDasharray="8 4" rx={4}/>}
                              <rect x={r.x} y={r.y} width={r.w} height={r.h}
                                fill={clr.fill} stroke={clr.stroke}
                                strokeWidth={isSel ? 3 : 2} rx={3}/>
                            </>
                          )}

                          {/* ── Bluebeam-style label: area ft² + name ── */}
                          {r.w > 40 && r.h > 25 && (
                            <>
                              {/* White pill background */}
                              <rect x={cx - 52} y={cy - 18} width={104} height={36}
                                rx={6} fill={clr.stroke} opacity={isSel?0.95:0.88}
                                style={{ pointerEvents:"none" }}/>
                              {/* Area ft² — primary (Bluebeam style) */}
                              <text x={cx} y={cy - 4}
                                textAnchor="middle" dominantBaseline="middle"
                                fontSize={Math.min(fs, 13)} fontWeight="800" fill="#fff"
                                style={{ userSelect:"none", pointerEvents:"none" }}>
                                {areaFt} ft²
                              </text>
                              {/* Room name below */}
                              {r.h > 45 && (
                                <text x={cx} y={cy + 13}
                                  textAnchor="middle" dominantBaseline="middle"
                                  fontSize={Math.min(fs - 2, 10)} fontWeight="600" fill="rgba(255,255,255,0.9)"
                                  style={{ userSelect:"none", pointerEvents:"none" }}>
                                  {room.name}
                                </text>
                              )}
                            </>
                          )}

                          {/* L×W dimensions shown when selected */}
                          {isSel && r.h > 55 && (
                            <text x={cx} y={cy + 28}
                              textAnchor="middle" fontSize={9} fill={clr.stroke} filter="url(#lbl)"
                              style={{ userSelect:"none", pointerEvents:"none" }}>
                              {lft}′ × {wft}′  ({areaM2} m²)
                            </text>
                          )}

                          {/* Delete ✕ */}
                          {isSel && (
                            <g onClick={e=>{e.stopPropagation();deleteRoom(room.id);}} style={{cursor:"pointer"}}>
                              <circle cx={r.x+r.w-4} cy={r.y+4} r={9} fill="#ef4444" stroke="#fff" strokeWidth={1.5}/>
                              <text x={r.x+r.w-4} y={r.y+4} textAnchor="middle"
                                dominantBaseline="central" fontSize={11} fill="#fff" fontWeight="900"
                                style={{pointerEvents:"none"}}>×</text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {/* Doors — only in floor-plan area (top 52% of SVG) */}
                    {showDoors && visibleDoors.map((d, i) => {
                      const s = scaleOpen(d);
                      if (s.y > renderH * 0.54) return null; // skip schedule area
                      return <rect key={`d${i}`} x={s.x} y={s.y} width={s.w} height={s.h}
                        fill="#f59e0b40" stroke="#f59e0b" strokeWidth={2} rx={2} style={{ pointerEvents:"none" }}/>;
                    })}
                    {/* Windows — only in floor-plan area */}
                    {showDoors && visibleWindows.map((w, i) => {
                      const s = scaleOpen(w);
                      if (s.y > renderH * 0.54) return null; // skip schedule area
                      return <rect key={`w${i}`} x={s.x} y={s.y} width={s.w} height={s.h}
                        fill="#7dd3fc40" stroke="#0ea5e9" strokeWidth={2} rx={1} style={{ pointerEvents:"none" }}/>;
                    })}

                    {/* ── ALL PDF Text Labels — every name/tag from the drawing ── */}
                    {showTextLabels && result?.textLabels?.map((lbl, i) => {
                      const sx2 = PDF_W / result.imageWidth;
                      const sy2 = renderH / result.imageHeight;
                      const lx  = Math.round(lbl.x * sx2);
                      const ly  = Math.round(lbl.y * sy2);
                      const lw  = Math.round(lbl.w * sx2);

                      // Color by type
                      const clrMap: Record<string, string> = {
                        label:           '#1e40af',   // blue  — room names
                        room_tag:        '#7c3aed',   // purple — A108 etc
                        dimension:       '#92400e',   // brown  — 20'-0"
                        grid_ref:        '#064e3b',   // dark green — A-1
                        area:            '#065f46',   // green — sq ft
                        nic:             '#9ca3af',   // gray — N.I.C.
                        schedule_header: '#6b7280',   // gray — schedules
                      };
                      const color = clrMap[lbl.type] ?? '#374151';

                      // Skip dimensions and schedule headers by default (too noisy)
                      if (['dimension','schedule_header'].includes(lbl.type)) return null;
                      if (ly > renderH * 0.88) return null;  // skip footer area

                      const fontSize = Math.min(11, Math.max(7, lw / (lbl.text.length * 0.65)));
                      return (
                        <g key={`txt${i}`} style={{ pointerEvents: 'none' }}>
                          <text
                            x={lx} y={ly + 10}
                            fontSize={fontSize}
                            fontWeight={lbl.type === 'label' ? '700' : '500'}
                            fill={color}
                            opacity={0.85}
                            style={{ userSelect: 'none' }}>
                            {lbl.text}
                          </text>
                        </g>
                      );
                    })}

                    {/* ── Polygon draw preview ── */}
                    {editMode === "draw" && polyMode && polyPoints.length > 0 && (
                      <g style={{ pointerEvents:"none" }}>
                        {/* Lines connecting clicked points */}
                        {polyPoints.map((pt, i) => i > 0 && (
                          <line key={i} x1={polyPoints[i-1].x} y1={polyPoints[i-1].y}
                            x2={pt.x} y2={pt.y} stroke="#10b981" strokeWidth={2.5} strokeDasharray="6 3"/>
                        ))}
                        {/* Close line preview */}
                        {polyPoints.length >= 2 && (
                          <line x1={polyPoints[polyPoints.length-1].x} y1={polyPoints[polyPoints.length-1].y}
                            x2={polyPoints[0].x} y2={polyPoints[0].y}
                            stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.5}/>
                        )}
                        {/* Filled polygon preview */}
                        {polyPoints.length >= 3 && (
                          <polygon
                            points={polyPoints.map(p=>`${p.x},${p.y}`).join(' ')}
                            fill="#10b98120" stroke="#10b981" strokeWidth={2}/>
                        )}
                        {/* Vertex dots */}
                        {polyPoints.map((pt, i) => (
                          <g key={i}>
                            <circle cx={pt.x} cy={pt.y} r={6} fill="#10b981" stroke="#fff" strokeWidth={2}/>
                            <text x={pt.x+9} y={pt.y+4} fontSize={9} fill="#10b981">{i+1}</text>
                          </g>
                        ))}
                        {/* Hint */}
                        <text x={polyPoints[0].x} y={polyPoints[0].y - 14}
                          fontSize={11} fill="#10b981" fontWeight="700"
                          style={{ filter:"url(#lbl)" }}>
                          {polyPoints.length >= 3 ? "Double-click to finish" : `${polyPoints.length} pts — click to add`}
                        </text>
                      </g>
                    )}

                    {/* ── Live rectangle draw preview ── */}
                    {editMode === "draw" && !polyMode && drawRect && drawRect.w > 4 && drawRect.h > 4 && (() => {
                      const { x, y, w, h } = drawRect;
                      // Convert SVG pixels → real dimensions using scale
                      const mpp = result?.mpp_px ?? 0.01693;
                      const sx  = result.imageWidth / PDF_W;
                      const lenM = parseFloat((w * sx * mpp).toFixed(1));
                      const widM = parseFloat((h * sx * mpp).toFixed(1));
                      const lenFt = (lenM * 3.281).toFixed(0);
                      const widFt = (widM * 3.281).toFixed(0);
                      const areaM = (lenM * widM).toFixed(1);
                      const areaFt = Math.round(parseFloat(areaM) * 10.764);
                      return (
                        <g style={{ pointerEvents:"none" }}>
                          {/* Box */}
                          <rect x={x} y={y} width={w} height={h}
                            fill="#10b98130" stroke="#10b981" strokeWidth={2.5}
                            strokeDasharray="8 4" rx={3}/>
                          {/* Dimension lines — width */}
                          <line x1={x} y1={y-8} x2={x+w} y2={y-8} stroke="#10b981" strokeWidth={1.5}/>
                          <line x1={x} y1={y-12} x2={x} y2={y-4} stroke="#10b981" strokeWidth={1.5}/>
                          <line x1={x+w} y1={y-12} x2={x+w} y2={y-4} stroke="#10b981" strokeWidth={1.5}/>
                          {/* Dimension lines — height */}
                          <line x1={x+w+8} y1={y} x2={x+w+8} y2={y+h} stroke="#10b981" strokeWidth={1.5}/>
                          <line x1={x+w+4} y1={y} x2={x+w+12} y2={y} stroke="#10b981" strokeWidth={1.5}/>
                          <line x1={x+w+4} y1={y+h} x2={x+w+12} y2={y+h} stroke="#10b981" strokeWidth={1.5}/>
                          {/* Width label */}
                          <rect x={x + w/2 - 56} y={y-30} width={112} height={20} rx={4} fill="#065f46" opacity={0.9}/>
                          <text x={x+w/2} y={y-16} textAnchor="middle" fontSize={11} fontWeight="700" fill="#fff">
                            {lenFt}′ ({lenM}m)
                          </text>
                          {/* Height label */}
                          <rect x={x+w+16} y={y+h/2-10} width={96} height={20} rx={4} fill="#065f46" opacity={0.9}/>
                          <text x={x+w+64} y={y+h/2+4} textAnchor="middle" fontSize={11} fontWeight="700" fill="#fff">
                            {widFt}′ ({widM}m)
                          </text>
                          {/* Area in center */}
                          {w > 80 && h > 50 && (
                            <>
                              <rect x={x+w/2-68} y={y+h/2-14} width={136} height={32} rx={5} fill="#065f46" opacity={0.92}/>
                              <text x={x+w/2} y={y+h/2-1} textAnchor="middle" fontSize={12} fontWeight="800" fill="#6ee7b7">
                                {lenFt}′ × {widFt}′
                              </text>
                              <text x={x+w/2} y={y+h/2+13} textAnchor="middle" fontSize={10} fill="#a7f3d0">
                                {areaFt} ft² / {areaM} m²
                              </text>
                            </>
                          )}
                        </g>
                      );
                    })()}
                  </svg>
                )}
              </div>
              {isPdf && numPages>1 && (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:12, padding:"10px 0", background:"rgba(0,0,0,.6)", borderRadius:"0 0 8px 8px" }}>
                  <button onClick={()=>{
                    const newPg = Math.max(1, pageNum-1);
                    setPageNum(newPg);
                    setResult(pageResults[newPg] ?? null);
                    setSelectedId(null); setEditingRoom(null);
                    setShowDoors(false);
                  }} disabled={pageNum<=1} style={{ background:"none", border:"none", cursor:"pointer", color:pageNum<=1?"#334155":"#fff" }}><ChevronLeft size={16}/></button>
                  <span style={{ fontSize:12, color:"#94a3b8" }}>
                    Page {pageNum}/{numPages}
                    {pageResults[pageNum] ? (
                      <span style={{ color:"#10b981", marginLeft:6 }}>
                        ✓ {pageResults[pageNum].rooms?.length ?? 0} rooms
                      </span>
                    ) : (
                      <span style={{ color:"#f59e0b", marginLeft:6 }}>not analyzed</span>
                    )}
                  </span>
                  <button onClick={()=>{
                    const newPg = Math.min(numPages, pageNum+1);
                    setPageNum(newPg);
                    setResult(pageResults[newPg] ?? null);
                    setSelectedId(null); setEditingRoom(null);
                    setShowDoors(false);
                  }} disabled={pageNum>=numPages} style={{ background:"none", border:"none", cursor:"pointer", color:pageNum>=numPages?"#334155":"#fff" }}><ChevronRight size={16}/></button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel ───────────────────────────────────────── */}
        <div className={styles.rightPanel}>

          {/* ── Layer Panel (in right sidebar, always accessible) ── */}
          {result && derivedLayers.length > 0 && (
            <div style={{ borderBottom:"1px solid #e2e8f0", flexShrink:0 }}>
              {/* Header — click to expand/collapse */}
              <button
                onClick={() => setShowLayerPanel(v => !v)}
                style={{ width:"100%", padding:"8px 14px", display:"flex", alignItems:"center", justifyContent:"space-between",
                  background:showLayerPanel?"#eff6ff":"#f8fafc", border:"none", cursor:"pointer",
                  borderBottom: showLayerPanel ? "1px solid #dbeafe" : "none" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <Layers size={12} color="#2563eb"/>
                  <span style={{ fontSize:11, fontWeight:700, color:"#2563eb", textTransform:"uppercase", letterSpacing:".05em" }}>
                    Layers ({derivedLayers.length})
                  </span>
                </div>
                <span style={{ fontSize:10, color:"#64748b" }}>{showLayerPanel ? "▲" : "▼"}</span>
              </button>

              {/* Layer list */}
              {showLayerPanel && (
                <div style={{ padding:"6px 10px", maxHeight:220, overflowY:"auto" }}>
                  {derivedLayers.map(layer => {
                    const vis = isLayerVisible(layer.name);
                    const cnt = layer.count ?? 0;
                    return (
                      <div key={layer.name}
                        onClick={() => toggleLayer(layer.name)}
                        style={{ display:"flex", alignItems:"center", gap:7, padding:"5px 6px", borderRadius:6,
                          cursor:"pointer", marginBottom:2, opacity:vis?1:0.4,
                          background:vis?"#f0f9ff":"transparent",
                          border:`1px solid ${vis?"#bae6fd":"transparent"}` }}>
                        {/* Eye */}
                        <span style={{ fontSize:10, color:vis?"#2563eb":"#94a3b8", flexShrink:0 }}>
                          {vis ? "●" : "○"}
                        </span>
                        {/* Color dot */}
                        <span style={{ width:10, height:10, borderRadius:"50%", flexShrink:0,
                          background:layer.color??"#64748b", opacity:vis?1:0.5 }}/>
                        {/* Name */}
                        <span style={{ flex:1, fontSize:11, fontWeight:600,
                          color:vis?"#0f172a":"#94a3b8",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {layer.name}
                        </span>
                        {/* Count */}
                        {cnt > 0 && (
                          <span style={{ fontSize:9, background:vis?`${layer.color}20`:"#f1f5f9",
                            color:vis?layer.color:"#94a3b8", padding:"1px 5px", borderRadius:99, flexShrink:0, fontWeight:700 }}>
                            {cnt}
                          </span>
                        )}
                        {/* Source badge */}
                        {layer.source==="pdf_native" && (
                          <span style={{ fontSize:8, background:"#f1f5f9", color:"#64748b",
                            padding:"1px 4px", borderRadius:3, flexShrink:0 }}>PDF</span>
                        )}
                      </div>
                    );
                  })}
                  {/* Actions */}
                  <div style={{ display:"flex", gap:5, marginTop:5, paddingTop:5, borderTop:"1px solid #f1f5f9" }}>
                    <button onClick={e=>{e.stopPropagation();const a:Record<string,boolean>={};derivedLayers.forEach(l=>{a[l.name]=true;});setLayerVisibility(a);}}
                      style={{ flex:1, fontSize:9, padding:"3px 5px", borderRadius:4, border:"1px solid #e2e8f0", background:"#fff", color:"#2563eb", cursor:"pointer", fontWeight:600 }}>
                      Show All
                    </button>
                    <button onClick={e=>{e.stopPropagation();const a:Record<string,boolean>={};derivedLayers.forEach(l=>{a[l.name]=false;});setLayerVisibility(a);}}
                      style={{ flex:1, fontSize:9, padding:"3px 5px", borderRadius:4, border:"1px solid #e2e8f0", background:"#fff", color:"#94a3b8", cursor:"pointer", fontWeight:600 }}>
                      Hide All
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Multi-page: all floors summary ── */}
          {Object.keys(pageResults).length > 1 && (
            <div style={{ padding:"8px 12px", borderBottom:"1px solid #e2e8f0", background:"#f0fdf4", flexShrink:0 }}>
              <p style={{ fontSize:10, fontWeight:700, color:"#15803d", marginBottom:5, textTransform:"uppercase" }}>
                {Object.keys(pageResults).length} Floors Analyzed — {Object.values(pageResults).reduce((s,r)=>s+(r.rooms?.length??0),0)} total rooms
              </p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {Object.entries(pageResults).sort((a,b)=>+a[0]-+b[0]).map(([pg, r]) => (
                  <button key={pg}
                    onClick={() => { const n=parseInt(pg); setPageNum(n); setResult(r); setSelectedId(null); setEditingRoom(null); }}
                    style={{ padding:"3px 9px", borderRadius:6, fontSize:10, fontWeight:700, cursor:"pointer",
                      border:`1px solid ${pageNum===parseInt(pg)?"#059669":"#bbf7d0"}`,
                      background:pageNum===parseInt(pg)?"#059669":"#fff",
                      color:pageNum===parseInt(pg)?"#fff":"#15803d" }}>
                    Page {pg} · {r.rooms?.length ?? 0}R
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Pipeline steps (fixed, non-scrolling) ── */}
          <div className={styles.stepsSection}>
            <p className={styles.stepsLabel}>Pipeline Progress</p>
            <div className={styles.steps}>
              {STEPS.map(s => {
                const isDone  = stepDone.has(s.id);
                const isActive = activeStep === s.id && running;
                const msg   = stepMsg[s.id];
                return (
                  <div key={s.id} className={`${styles.step} ${isDone ? styles.stepDone : isActive ? styles.stepActive : ""}`}>
                    <span className={styles.stepIcon}>{s.icon}</span>
                    <div className={styles.stepContent}>
                      <p className={`${styles.stepLabel} ${isDone ? styles.stepLabelDone : isActive ? styles.stepLabelActive : ""}`}>{s.id}. {s.label}</p>
                      {(isDone||isActive) && <p className={styles.stepMsg}>{isActive?"Processing…":msg}</p>}
                    </div>
                    {isDone   && <CheckCircle2 size={13} color="#16a34a" style={{ flexShrink:0 }}/>}
                    {isActive && <Loader2 size={13} color="#2563eb" className="animate-spin" style={{ flexShrink:0 }}/>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Everything else scrolls together ── */}
          <div className={styles.panelBody}>

            {/* KPI cards */}
            {result && (
              <div className={styles.kpiGrid}>
                {[
                  { l:"Rooms",      v:String(result.rooms.length),        c:"#2563eb" },
                  { l:"Total Area", v:`${totalArea.toFixed(1)} m²`,        c:"#059669" },
                  { l:"Wall Area",  v:`${totalWall.toFixed(1)} m²`,        c:"#7c3aed" },
                  { l:"Doors/Win",  v:`${totalDoors}/${totalWins}`,        c:"#d97706" },
                ].map(({l,v,c})=>(
                  <div key={l} className={styles.kpiCard}>
                    <p className={styles.kpiLabel}>{l}</p>
                    <p className={styles.kpiValue} style={{ color:c }}>{v}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Selected room editor ── */}
            {selRoom && (() => {
              const er = editingRoom?.id === selRoom.id ? editingRoom : selRoom;
              const stroke = pal(er.type).stroke;
              const fill   = pal(er.type).fill;

              // Computed metrics
              const heightM   = (er as DetectedRoom & { heightM?: number }).heightM ?? 2.8;
              const perimM    = er.perimeterM ?? ((er.lengthM + er.widthM) * 2);
              const wallSqM   = er.wallAreaSqM ?? (perimM * heightM * 0.80);
              const ceilSqM   = er.ceilingSqM  ?? er.areaSqM;
              const areaSqFt  = er.areaSqM * 10.764;
              const wallSqFt  = wallSqM * 10.764;
              const lenFt     = (er.lengthM ?? 0) * 3.281;
              const widFt     = (er.widthM  ?? 0) * 3.281;
              const perimFt   = perimM * 3.281;

              // Confidence color
              const conf     = er.confidence ?? 0;
              const confClr  = conf >= 0.85 ? "#059669" : conf >= 0.65 ? "#d97706" : "#dc2626";

              // Room type options grouped
              const TYPE_GROUPS = [
                { group:"Residential",   types:["BEDROOM","BATHROOM","KITCHEN","LIVING","DINING","BALCONY","GARAGE","STUDY","UTILITY"] },
                { group:"Commercial",    types:["OFFICE","MEETING","RECEPTION","LOBBY","CORRIDOR","STAIR","ELEVATOR"] },
                { group:"Service",       types:["STORE","ELECTRICAL","MECHANICAL","TOILET","STAIRCASE"] },
                { group:"Industrial",    types:["INDUSTRIAL","WAREHOUSE","WORKSHOP","LABORATORY"] },
                { group:"Other",         types:["OTHER","UNKNOWN"] },
              ];

              // Custom overlay colors (real color picker)
              const CUSTOM_COLORS = ["#2563eb","#059669","#7c3aed","#dc2626","#d97706","#0891b2","#ec4899","#84cc16","#f59e0b","#64748b","#0ea5e9","#10b981"];

              return (
                <div style={{ margin:"8px 10px", borderRadius:12, border:`1.5px solid ${stroke}60`, background:"#ffffff", overflow:"hidden" }}>

                  {/* ── Header ── */}
                  <div style={{ padding:"10px 12px", background:`${stroke}15`, borderBottom:`1px solid ${stroke}30`, display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ width:12, height:12, borderRadius:"50%", background:stroke, flexShrink:0 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:11, fontWeight:800, color:"#0f172a", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{er.name}</p>
                      <p style={{ fontSize:9, color:stroke, fontWeight:600 }}>{er.type} · {er.floor}</p>
                    </div>
                    <span style={{ fontSize:9, fontWeight:700, color:confClr, background:`${confClr}18`, padding:"2px 6px", borderRadius:99, border:`1px solid ${confClr}30` }}>
                      {Math.round(conf * 100)}% conf
                    </span>
                    <button onClick={() => deleteRoom(er.id)}
                      style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:6, cursor:"pointer", padding:"3px 7px", fontSize:10, color:"#dc2626", fontWeight:700, flexShrink:0 }}>
                      <Trash2 size={9} style={{ display:"inline", marginRight:2 }}/>Del
                    </button>
                  </div>

                  <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:8, background:"#fff" }}>

                    {/* ── Name ── */}
                    <div>
                      <p style={{ fontSize:9, color:"#64748b", fontWeight:600, marginBottom:3, textTransform:"uppercase", letterSpacing:".05em" }}>Room Name</p>
                      <input
                        value={er.name}
                        onChange={e => { const v=e.target.value; setEditingRoom(r=>r?{...r,name:v}:r); updateRoom(er.id,{name:v}); }}
                        placeholder="Enter room name from drawing"
                        style={{ width:"100%", padding:"7px 9px", borderRadius:7, border:`1.5px solid ${stroke}50`, fontSize:12, fontWeight:600, outline:"none", boxSizing:"border-box", background:"#f8fafc", color:"#0f172a" }}
                      />
                    </div>

                    {/* ── Type ── */}
                    <div>
                      <p style={{ fontSize:9, color:"#64748b", fontWeight:600, marginBottom:3, textTransform:"uppercase", letterSpacing:".05em" }}>Room Type</p>
                      <select value={er.type}
                        onChange={e => { const v=e.target.value; setEditingRoom(r=>r?{...r,type:v}:r); updateRoom(er.id,{type:v}); }}
                        aria-label="Room type"
                        style={{ width:"100%", padding:"7px 9px", borderRadius:7, border:`1.5px solid ${stroke}50`, fontSize:12, fontWeight:700, outline:"none", background:"#f8fafc", color:stroke, boxSizing:"border-box" }}>
                        {TYPE_GROUPS.map(({ group, types }) => (
                          <optgroup key={group} label={`── ${group} ──`}>
                            {types.map(t => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g," ")}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {/* ── Floor ── */}
                    <div>
                      <p style={{ fontSize:9, color:"#64748b", fontWeight:600, marginBottom:3, textTransform:"uppercase", letterSpacing:".05em" }}>Floor / Level</p>
                      <input
                        value={er.floor}
                        onChange={e => { const v=e.target.value; setEditingRoom(r=>r?{...r,floor:v}:r); updateRoom(er.id,{floor:v}); }}
                        placeholder="e.g. Ground Floor, Level 1"
                        style={{ width:"100%", padding:"6px 9px", borderRadius:7, border:"1.5px solid #e2e8f0", fontSize:11, outline:"none", boxSizing:"border-box", background:"#f8fafc", color:"#0f172a" }}
                      />
                    </div>

                    {/* ── Overlay color picker ── */}
                    <div>
                      <p style={{ fontSize:9, color:"#64748b", fontWeight:600, marginBottom:5, textTransform:"uppercase", letterSpacing:".05em" }}>Overlay Color</p>
                      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                        {CUSTOM_COLORS.map(c => (
                          <button key={c} onClick={() => {
                            // Update room color — stored as custom overlay color
                            setEditingRoom(r => r ? { ...r, _customColor: c } as DetectedRoom & {_customColor:string} : r);
                            updateRoom(er.id, { _customColor: c } as Partial<DetectedRoom>);
                          }}
                            style={{ width:20, height:20, borderRadius:"50%", background:c, border: stroke===c ? "2.5px solid #fff" : "2px solid transparent", cursor:"pointer", flexShrink:0 }}
                            title={c}
                          />
                        ))}
                      </div>
                    </div>

                    {/* ── Measurements ── */}
                    <div>
                      <p style={{ fontSize:9, color:"#64748b", fontWeight:600, marginBottom:5, textTransform:"uppercase", letterSpacing:".05em" }}>Measurements</p>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                        {[
                          { l:"Floor Area",   v:`${er.areaSqM.toFixed(2)} m²`,          sub:`${areaSqFt.toFixed(0)} ft²`,  c:"#059669" },
                          { l:"Perimeter",    v:`${perimM.toFixed(1)} m`,                sub:`${perimFt.toFixed(0)} ft`,    c:"#2563eb" },
                          { l:"Length",       v:`${(er.lengthM??0).toFixed(2)} m`,       sub:`${lenFt.toFixed(1)} ft`,      c:"#7c3aed" },
                          { l:"Width",        v:`${(er.widthM??0).toFixed(2)} m`,        sub:`${widFt.toFixed(1)} ft`,      c:"#7c3aed" },
                          { l:"Wall Area",    v:`${wallSqM.toFixed(1)} m²`,              sub:`${wallSqFt.toFixed(0)} ft²`,  c:"#d97706" },
                          { l:"Ceiling Area", v:`${ceilSqM.toFixed(1)} m²`,             sub:`${(ceilSqM*10.764).toFixed(0)} ft²`, c:"#0891b2" },
                        ].map(({ l, v, sub, c }) => (
                          <div key={l} style={{ background:"#f8fafc", borderRadius:7, padding:"6px 8px", border:"1px solid #e2e8f0" }}>
                            <p style={{ fontSize:9, color:"#64748b", marginBottom:2, fontWeight:600 }}>{l}</p>
                            <p style={{ fontSize:12, fontWeight:800, color:c }}>{v}</p>
                            <p style={{ fontSize:9, color:"#64748b" }}>{sub}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Height + Doors/Windows (editable) ── */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4 }}>
                      {([
                        { l:"Height (m)", key:"heightM",     val:(er as DetectedRoom & {heightM?:number}).heightM ?? 2.8, step:0.1, min:1.5, max:20 },
                        { l:"Doors",      key:"doorCount",   val:er.doorCount ?? 0,   step:1, min:0, max:20 },
                        { l:"Windows",    key:"windowCount", val:er.windowCount ?? 0, step:1, min:0, max:30 },
                      ] as Array<{l:string;key:string;val:number;step:number;min:number;max:number}>).map(({ l, key, val, step, min, max }) => (
                        <div key={key} style={{ background:"#f8fafc", borderRadius:7, padding:"6px 8px", border:"1px solid #e2e8f0" }}>
                          <p style={{ fontSize:9, color:"#64748b", fontWeight:600, marginBottom:3 }}>{l}</p>
                          <input type="number"
                            value={val}
                            min={min} max={max} step={step}
                            onChange={e => {
                              const n = parseFloat(e.target.value) || 0;
                              setEditingRoom(r => r ? { ...r, [key]: n } : r);
                              updateRoom(er.id, { [key]: n } as Partial<DetectedRoom>);
                            }}
                            style={{ width:"100%", padding:"2px 4px", borderRadius:5, border:"1px solid #e2e8f0", fontSize:12, fontWeight:700, background:"#fff", color:"#0f172a", outline:"none", boxSizing:"border-box" }}
                          />
                        </div>
                      ))}
                    </div>

                    {/* ── Notes ── */}
                    <div>
                      <p style={{ fontSize:9, color:"#64748b", fontWeight:600, marginBottom:3, textTransform:"uppercase", letterSpacing:".05em" }}>Notes / Remarks</p>
                      <textarea
                        value={(er as DetectedRoom & {notes?:string}).notes ?? ""}
                        onChange={e => { const v=e.target.value; setEditingRoom(r=>r?{...r,notes:v} as DetectedRoom & {notes:string}:r); updateRoom(er.id,{notes:v} as Partial<DetectedRoom>); }}
                        placeholder="Site notes, special conditions, finishes…"
                        rows={2}
                        style={{ width:"100%", padding:"6px 9px", borderRadius:7, border:"1.5px solid #e2e8f0", fontSize:11, outline:"none", boxSizing:"border-box", background:"#f8fafc", color:"#374151", resize:"none", fontFamily:"inherit", lineHeight:1.5 }}
                      />
                    </div>

                    {/* ── Quick actions ── */}
                    <div style={{ display:"flex", gap:5 }}>
                      {/* Duplicate room */}
                      <button onClick={() => {
                        if (!result) return;
                        const newRoom: DetectedRoom = { ...er, id:`dup_${Date.now()}`, name:`${er.name} (Copy)`, x: er.x+20, y: er.y+20 };
                        editResult(prev => ({ ...prev, rooms: [...prev.rooms, newRoom] }));
                      }}
                        style={{ flex:1, padding:"6px 0", borderRadius:7, border:"1px solid #e2e8f0", background:"#f8fafc", color:"#374151", fontSize:10, fontWeight:600, cursor:"pointer" }}>
                        ⊕ Duplicate
                      </button>
                      {/* Import this room to takeoff */}
                      <button onClick={async () => {
                        await fetch(`/api/projects/${projectId}/takeoff`, {
                          method:"POST", headers:{"Content-Type":"application/json"},
                          body: JSON.stringify({
                            source:"MARKUP", category:"Room Area",
                            description:`${er.name} — Floor`,
                            quantity: areaSqFt, unit:"SF",
                            unitCost: UNIT_COST_FLOOR_SF,
                            totalCost: areaSqFt * UNIT_COST_FLOOR_SF,
                            notes:`${er.areaSqM.toFixed(2)} m² · ${er.type} · ${er.floor}`,
                          }),
                        });
                        queryClient.invalidateQueries({ queryKey:["takeoff", projectId] });
                      }}
                        style={{ flex:1, padding:"6px 0", borderRadius:7, border:"1px solid #16a34a40", background:"#14532d40", color:"#86efac", fontSize:10, fontWeight:700, cursor:"pointer" }}>
                        → Takeoff
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* AI Summary */}
            {(aiSummary || summaryLoading) && (
              <div style={{ margin:"0 12px 10px", borderRadius:10, border:"1px solid #e9d5ff", background:"#faf5ff", padding:"10px 12px" }}>
                <p style={{ fontSize:11, fontWeight:700, color:"#7c3aed", marginBottom:6, display:"flex", alignItems:"center", gap:5 }}>
                  <Layers size={11}/>AI Summary
                </p>
                {summaryLoading
                  ? <div style={{ display:"flex", gap:6, alignItems:"center" }}><Loader2 size={12} color="#7c3aed" className="animate-spin"/><span style={{ fontSize:11, color:"#94a3b8" }}>Generating summary…</span></div>
                  : <p style={{ fontSize:11, color:"#4c1d95", lineHeight:1.65, whiteSpace:"pre-wrap" }}>{aiSummary}</p>
                }
              </div>
            )}

            {/* Room list */}
            {result && visibleRooms.length >= 0 && result.rooms.length > 0 && (
              <div style={{ borderTop:"1px solid #f1f5f9" }}>
                <p style={{ fontSize:10, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:".05em", padding:"8px 12px 4px" }}>
                  {visibleRooms.length}/{result.rooms.length} Rooms · {result.scale ?? scaleHint} · {result.pipeline ?? "ML"}
                </p>
                {visibleRooms.map(room => {
                  const { stroke } = pal(room.type);
                  const isSel = room.id === selectedId;
                  return (
                    <button key={room.id}
                      onClick={() => setSelectedId(isSel ? null : room.id)}
                      style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"8px 12px", textAlign:"left", border:"none", borderBottom:"1px solid #f8fafc", background: isSel ? `${stroke}15` : "#fff", cursor:"pointer", transition:"background .1s" }}>
                      <span style={{ width:9, height:9, borderRadius:"50%", background:stroke, flexShrink:0, display:"inline-block" }}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:11, fontWeight:600, color:"#0f172a", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{room.name}</p>
                        <p style={{ fontSize:10, color:"#64748b" }}>
                          {room.areaSqM.toFixed(1)} m²
                          {room.doorCount  > 0 && ` · ${room.doorCount}🚪`}
                          {room.windowCount > 0 && ` · ${room.windowCount}🪟`}
                        </p>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <p style={{ fontSize:10, fontWeight:700, color:stroke }}>{(room.areaSqM*10.764).toFixed(0)} ft²</p>
                        <p style={{ fontSize:9, color:"#94a3b8" }}>{room.type}</p>
                      </div>
                    </button>
                  );
                })}
                {/* Bottom padding so last item isn't hidden behind action bar */}
                <div style={{ height:8 }}/>
              </div>
            )}

            {/* ── AI Markup Editor chat ── */}
            {result && (
              <div style={{ margin:"0 12px 12px", borderRadius:10, border:"1px solid #dbeafe", background:"#eff6ff", padding:"10px 12px" }}>
                <p style={{ fontSize:11, fontWeight:700, color:"#1d4ed8", marginBottom:8, display:"flex", alignItems:"center", gap:5 }}>
                  <MessageSquare size={11}/> AI Markup Editor
                </p>
                <p style={{ fontSize:10, color:"#3b82f6", marginBottom:8, lineHeight:1.5 }}>
                  Commands: <strong>delete [name]</strong> · <strong>rename X to Y</strong> · <strong>X is office/meeting/corridor…</strong> · or plain English
                </p>
                <div style={{ display:"flex", gap:6 }}>
                  <input
                    value={aiCmd}
                    onChange={e => setAiCmd(e.target.value)}
                    onKeyDown={e => e.key==="Enter" && !e.shiftKey && applyAiCmd()}
                    placeholder='e.g. "delete Bedroom 2" or "top-left room is Lobby"'
                    style={{ flex:1, padding:"7px 10px", borderRadius:7, border:"1px solid #bfdbfe",
                      fontSize:11, outline:"none", background:"#fff" }}
                    aria-label="AI edit command"
                  />
                  <button onClick={applyAiCmd} disabled={aiCmdLoading || !aiCmd.trim()}
                    style={{ padding:"7px 12px", borderRadius:7, border:"none",
                      background:aiCmd.trim()?"#2563eb":"#e2e8f0",
                      color:aiCmd.trim()?"#fff":"#94a3b8",
                      cursor:aiCmd.trim()?"pointer":"default", flexShrink:0 }}>
                    {aiCmdLoading ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}
                  </button>
                </div>
                {resultHistory.length > 0 && (
                  <button onClick={undoEdit} style={{ marginTop:6, fontSize:10, color:"#64748b", background:"none", border:"none", cursor:"pointer", padding:0, display:"flex", alignItems:"center", gap:4 }}>
                    <RotateCcw size={10}/> Undo last edit ({resultHistory.length} available)
                  </button>
                )}
              </div>
            )}
          </div>{/* end scrollable section */}

          {/* ── Actions (fixed at bottom) ── */}
          {result && (
            <div className={styles.actionBar} style={{ flexWrap:"wrap", gap:5 }}>
              <button onClick={exportCsv} className={styles.actionBtnSecondary} title="Export room table as CSV">
                <Download size={13}/>CSV
              </button>
              <button
                onClick={exportMarkupPdf}
                disabled={!isPdf || exportingPdf}
                className={styles.actionBtnSecondary}
                title="Export PDF with coloured room markup overlay"
                style={{ background:"#1e3a5f", color:"#93c5fd", borderColor:"#2563eb", opacity: (!isPdf||exportingPdf)?0.5:1 }}
              >
                {exportingPdf ? <Loader2 size={13} className="animate-spin"/> : <FileText size={13}/>}
                {exportingPdf ? "Exporting…" : "PDF Markup"}
              </button>
              <button
                onClick={exportDxf}
                className={styles.actionBtnSecondary}
                title="Export rooms as DXF — opens in AutoCAD, Revit, SketchUp, etc."
                style={{ background:"#1a2e1a", color:"#86efac", borderColor:"#16a34a" }}
              >
                <Download size={13}/>DXF (CAD)
              </button>
              {imported ? (
                <div className={styles.importedSuccess}>
                  <CheckCircle2 size={14}/>Imported
                </div>
              ) : (
                <button onClick={importToTakeoff} className={styles.actionBtnPrimary}>
                  <CheckCircle2 size={13}/>Import to Takeoff
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Manual draw dialog — Save new room ───────────────────── */}
      {drawDialog && result && (() => {
        const mpp = result?.mpp_px ?? 0.01693;
        const lenM = parseFloat((drawDialog.imgW * mpp).toFixed(1));
        const widM = parseFloat((drawDialog.imgH * mpp).toFixed(1));
        const lenFt = (lenM * 3.281).toFixed(0);
        const widFt = (widM * 3.281).toFixed(0);
        const areaM = (lenM * widM).toFixed(1);
        const areaFt = Math.round(parseFloat(areaM) * 10.764);
        return (
          <div className={styles.drawDialogOverlay}>
            <div className={styles.drawDialog}>
              <p className={styles.drawDialogTitle}>Save Manual Markup</p>
              <div className={styles.drawDimsCard}>
                <p className={styles.drawDimsTitle}>
                  REAL DIMENSIONS — Scale: {result?.scale ?? '1/8″=1′-0″'}
                </p>
                <div className={styles.drawDimsGrid}>
                  {[
                    { l:"Length", v:`${lenFt}′ (${lenM}m)` },
                    { l:"Width",  v:`${widFt}′ (${widM}m)` },
                    { l:"Area",   v:`${areaFt} ft²` },
                    { l:"",       v:`${areaM} m²` },
                  ].map(({l,v})=>(
                    <div key={l+v} className={styles.drawDimItem}>
                      {l && <p className={styles.drawDimLabel}>{l}</p>}
                      <p className={styles.drawDimValue}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label className={styles.label} style={{ display:"block", marginBottom:4 }}>Room Name</label>
                <input
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  autoFocus
                  aria-label="Room name"
                  placeholder="e.g. Conference Room A"
                  className={styles.fieldInput}
                  style={{ border:"1px solid #2563eb", width:"100%", boxSizing:"border-box" }}
                />
              </div>
              <div style={{ marginBottom:20 }}>
                <label className={styles.label} style={{ display:"block", marginBottom:4 }}>Room Type</label>
                <select value={newRoomType} onChange={e=>setNewRoomType(e.target.value)}
                  aria-label="Room type"
                  className={styles.fieldSelect}
                  style={{ border:"1px solid var(--border)", width:"100%", boxSizing:"border-box" }}>
                  {["OFFICE","MEETING","CORRIDOR","BATHROOM","STORE","KITCHEN",
                    "BEDROOM","LIVING","LOBBY","ELEVATOR","STAIRCASE","GARAGE","OTHER"].map(t=>(
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className={styles.drawDialogFooter}>
                <button onClick={() => { setDrawDialog(null); setDrawRect(null); }} className={styles.drawDialogCancelBtn}>
                  Cancel
                </button>
                <button onClick={confirmDrawRoom} className={styles.drawDialogSaveBtn}>
                  Add to Markup
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Legend bar ────────────────────────────────────────────── */}
      {result && (
        <div className={styles.legendBar}>
          <span className={styles.legendLabel}>LEGEND:</span>
          {Object.entries(ROOM_COLORS).filter(([t])=>result.rooms.some(r=>r.type===t)).map(([t,{stroke}])=>(
            <span key={t} className={styles.legendPill} style={{ color:stroke, background:`${stroke}15` }}>
              <span className={styles.legendDot} style={{ background:stroke }}/>{t}
            </span>
          ))}
          {showDoors && <>
            <span className={styles.legendPill} style={{ color:"#d97706", background:"#fffbeb" }}>Door</span>
            <span className={styles.legendPill} style={{ color:"#0891b2", background:"#ecfeff" }}>Window</span>
          </>}
          <span className={styles.legendMeta}>
            Pipeline: <strong>{result.pipeline ?? "BIMBOSS"}</strong>
            {result.scale && <> · Scale: <strong style={{ color:"#f59e0b" }}>{result.scale}</strong></>}
            {result.processingMs && ` · ${result.processingMs}ms`}
          </span>
        </div>
      )}
    </div>
  );
}
