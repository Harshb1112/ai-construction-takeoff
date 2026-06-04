"use client";

import { useCallback, useRef, useState } from "react";
import type { Annotation, AnnotationPoint, DrawingScale } from "@/types";
import type { ToolType } from "./MarkupEditor";

interface Props {
  annotations: Annotation[];
  activeTool: ToolType;
  scale: DrawingScale | null;
  zoom: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAnnotationCreated: (a: Omit<Annotation, "id" | "createdAt" | "updatedAt">) => void;
  onAnnotationDeleted: (id: string) => void;
  pageNumber: number;
  drawingId: string;
}

// ─── Helpers ─────────────────────────────────────────────────
function pxToReal(px: number, scale: DrawingScale | null): number {
  return scale?.pxPerUnit ? px / scale.pxPerUnit : px;
}

function polygonArea(pts: AnnotationPoint[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

function polylineLength(pts: AnnotationPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

const STAMPS = ["APPROVED", "REJECTED", "FOR REVIEW", "REVISED", "FINAL"];

const TOOL_COLORS: Record<string, string> = {
  select: "#6366f1",
  measure: "#0ea5e9",
  area: "#10b981",
  perimeter: "#8b5cf6",
  polygon: "#10b981",
  count: "#f59e0b",
  text: "#374151",
  cloud: "#ef4444",
  arrow: "#f97316",
  rectangle: "#3b82f6",
  highlight: "#fbbf24",
  stamp: "#dc2626",
};

// Cloud annotation path generator
function cloudPath(pts: AnnotationPoint[], r: number): string {
  if (pts.length < 2) return "";
  const bumps: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.floor(len / (r * 3)));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const mx = p1.x + dx * (t0 + t1) / 2;
      const my = p1.y + dy * (t0 + t1) / 2;
      const nx = -dy / len;
      const ny = dx / len;
      const cx = mx + nx * r;
      const cy = my + ny * r;
      bumps.push(`A ${r} ${r} 0 0 1 ${p1.x + dx * t1} ${p1.y + dy * t1}`);
    }
  }
  const start = pts[0];
  return `M ${start.x} ${start.y} ${bumps.join(" ")} Z`;
}

// ─── Main component ───────────────────────────────────────────
export function AnnotationLayer({
  annotations, activeTool, scale, zoom, selectedId,
  onSelect, onAnnotationCreated, onAnnotationDeleted, pageNumber, drawingId,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drawing, setDrawing] = useState<AnnotationPoint[]>([]);
  const [mousePos, setMousePos] = useState<AnnotationPoint | null>(null);
  const [textInput, setTextInput] = useState<{ pos: AnnotationPoint; value: string } | null>(null);
  const [stampMenu, setStampMenu] = useState<AnnotationPoint | null>(null);
  const [rectStart, setRectStart] = useState<AnnotationPoint | null>(null);

  const getSVGPoint = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }, [zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === "select") return;
    setMousePos(getSVGPoint(e));
  }, [activeTool, getSVGPoint]);

  const finishPolyTool = useCallback((pts: AnnotationPoint[]) => {
    const color = TOOL_COLORS[activeTool] ?? "#0ea5e9";
    const unit = scale?.realUnit ?? "ft";

    if (activeTool === "measure") {
      const len = pxToReal(polylineLength(pts), scale);
      onAnnotationCreated({ drawingId, pageNumber, type: "MEASUREMENT", geometry: pts, measurement: +len.toFixed(2), unit, label: `${len.toFixed(1)} ${unit}`, color, opacity: 1 });
    } else if (activeTool === "perimeter") {
      const len = pxToReal(polylineLength(pts), scale);
      onAnnotationCreated({ drawingId, pageNumber, type: "PERIMETER", geometry: pts, measurement: +len.toFixed(2), unit, label: `Perimeter: ${len.toFixed(1)} ${unit}`, color, opacity: 1 });
    } else if (activeTool === "area" || activeTool === "polygon") {
      const pxArea = polygonArea(pts);
      const realSide = pxToReal(Math.sqrt(pxArea), scale);
      const area = +(realSide * realSide).toFixed(2);
      onAnnotationCreated({ drawingId, pageNumber, type: "AREA", geometry: pts, measurement: area, unit: `${unit}²`, label: `${area.toFixed(1)} ${unit}²`, color, opacity: 0.25 });
    } else if (activeTool === "cloud") {
      const len = pxToReal(polylineLength(pts), scale);
      onAnnotationCreated({ drawingId, pageNumber, type: "AREA", geometry: pts, measurement: +len.toFixed(2), unit, label: "Cloud", color: TOOL_COLORS.cloud, opacity: 0.15 });
    }
    setDrawing([]);
  }, [activeTool, drawingId, onAnnotationCreated, pageNumber, scale]);

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === "select") { onSelect(null); return; }
    const pt = getSVGPoint(e);

    // Single-click finishable tools
    if (activeTool === "count") {
      onAnnotationCreated({ drawingId, pageNumber, type: "COUNT", geometry: [pt], measurement: 1, unit: "EA", label: "Count", color: TOOL_COLORS.count, opacity: 1 });
      return;
    }
    if (activeTool === "text") { setTextInput({ pos: pt, value: "" }); return; }
    if (activeTool === "stamp") { setStampMenu(pt); return; }

    // Rectangle: click-drag-click
    if (activeTool === "rectangle" || activeTool === "highlight") {
      if (!rectStart) { setRectStart(pt); return; }
      const pts = [rectStart, { x: pt.x, y: rectStart.y }, pt, { x: rectStart.x, y: pt.y }];
      const pxArea = polygonArea(pts);
      const realSide = pxToReal(Math.sqrt(pxArea), scale);
      const area = +(realSide * realSide).toFixed(2);
      const color = activeTool === "highlight" ? TOOL_COLORS.highlight : TOOL_COLORS.rectangle;
      onAnnotationCreated({ drawingId, pageNumber, type: "AREA", geometry: pts, measurement: area, unit: `${scale?.realUnit ?? "ft"}²`, label: activeTool === "highlight" ? "Highlight" : `Area: ${area.toFixed(1)} ${scale?.realUnit ?? "ft"}²`, color, opacity: activeTool === "highlight" ? 0.35 : 0.15 });
      setRectStart(null);
      return;
    }

    // Arrow: 2 points
    if (activeTool === "arrow") {
      if (drawing.length === 0) { setDrawing([pt]); return; }
      onAnnotationCreated({ drawingId, pageNumber, type: "MEASUREMENT", geometry: [drawing[0], pt], label: "→", color: TOOL_COLORS.arrow, opacity: 1 });
      setDrawing([]);
      return;
    }

    // Poly tools (measure, area, perimeter, polygon, cloud)
    setDrawing((prev) => [...prev, pt]);
  }, [activeTool, drawing, drawingId, getSVGPoint, onAnnotationCreated, pageNumber, rectStart, scale, onSelect]);

  const handleDoubleClick = useCallback(() => {
    if (drawing.length >= 2) finishPolyTool(drawing);
    setDrawing([]);
  }, [drawing, finishPolyTool]);

  const placeStamp = useCallback((pos: AnnotationPoint, label: string) => {
    onAnnotationCreated({ drawingId, pageNumber, type: "TEXT", geometry: [pos], label: `[${label}]`, color: label === "APPROVED" ? "#16a34a" : label === "REJECTED" ? "#dc2626" : "#d97706", opacity: 1 });
    setStampMenu(null);
  }, [drawingId, onAnnotationCreated, pageNumber]);

  const textSave = useCallback(() => {
    if (!textInput?.value.trim()) { setTextInput(null); return; }
    onAnnotationCreated({ drawingId, pageNumber, type: "TEXT", geometry: [textInput.pos], label: textInput.value, color: TOOL_COLORS.text, opacity: 1 });
    setTextInput(null);
  }, [drawingId, onAnnotationCreated, pageNumber, textInput]);

  const allPts = mousePos && drawing.length > 0 ? [...drawing, mousePos] : drawing;
  const rectPreview = rectStart && mousePos ? [rectStart, { x: mousePos.x, y: rectStart.y }, mousePos, { x: rectStart.x, y: mousePos.y }] : null;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{ cursor: activeTool === "select" ? "default" : "crosshair" }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
    >
      {/* Saved annotations */}
      {annotations.map((ann) => (
        <AnnotationShape
          key={ann.id}
          annotation={ann}
          isSelected={selectedId === ann.id}
          onSelect={() => onSelect(ann.id)}
          onDelete={() => onAnnotationDeleted(ann.id)}
          zoom={zoom}
        />
      ))}

      {/* In-progress polygon/area/cloud */}
      {allPts.length >= 2 && ["measure", "perimeter", "area", "polygon", "cloud"].includes(activeTool) && (
        <>
          {["area", "polygon"].includes(activeTool) && (
            <polygon points={allPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={`${TOOL_COLORS[activeTool]}30`} stroke={TOOL_COLORS[activeTool]} strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom},${3 / zoom}`} />
          )}
          {["measure", "perimeter"].includes(activeTool) && (
            <polyline points={allPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke={TOOL_COLORS[activeTool]} strokeWidth={2 / zoom} strokeDasharray={`${5 / zoom},${3 / zoom}`} />
          )}
          {activeTool === "cloud" && allPts.length >= 3 && (
            <path d={cloudPath(allPts, 10 / zoom)} fill={`${TOOL_COLORS.cloud}20`} stroke={TOOL_COLORS.cloud} strokeWidth={1.5 / zoom} />
          )}
        </>
      )}
      {allPts.map((pt, i) => <circle key={i} cx={pt.x} cy={pt.y} r={3 / zoom} fill={TOOL_COLORS[activeTool] ?? "#0ea5e9"} />)}

      {/* Rectangle preview */}
      {rectPreview && (
        <polygon points={rectPreview.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={activeTool === "highlight" ? `${TOOL_COLORS.highlight}40` : `${TOOL_COLORS.rectangle}20`}
          stroke={TOOL_COLORS[activeTool]} strokeWidth={1.5 / zoom} strokeDasharray={`${5 / zoom},${3 / zoom}`} />
      )}

      {/* Arrow preview */}
      {activeTool === "arrow" && drawing.length === 1 && mousePos && (
        <g>
          <line x1={drawing[0].x} y1={drawing[0].y} x2={mousePos.x} y2={mousePos.y}
            stroke={TOOL_COLORS.arrow} strokeWidth={2 / zoom} markerEnd="url(#arrowhead)" />
        </g>
      )}

      {/* Arrow marker */}
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <polygon points="0 0, 8 4, 0 8" fill={TOOL_COLORS.arrow} />
        </marker>
        <marker id="arrowhead-ann" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill={TOOL_COLORS.arrow} />
        </marker>
      </defs>

      {/* Text input */}
      {textInput && (
        <foreignObject x={textInput.pos.x} y={textInput.pos.y - 12 / zoom} width={220 / zoom} height={36 / zoom}>
          <input
            // @ts-expect-error — xmlns is valid on SVG foreignObject children but not in React's JSX types
            xmlns="http://www.w3.org/1999/xhtml"
            autoFocus
            value={textInput.value}
            onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
            onBlur={textSave}
            onKeyDown={(e) => e.key === "Enter" && textSave()}
            style={{ fontSize: 13 / zoom, padding: `${2 / zoom}px ${5 / zoom}px`, border: `${1.5 / zoom}px solid #0ea5e9`, borderRadius: 4 / zoom, background: "white", width: "100%", outline: "none" }}
          />
        </foreignObject>
      )}

      {/* Stamp menu */}
      {stampMenu && (
        <foreignObject x={stampMenu.x} y={stampMenu.y} width={140 / zoom} height={160 / zoom}>
          <div
            // @ts-expect-error — xmlns is valid on SVG foreignObject children but not in React's JSX types
            xmlns="http://www.w3.org/1999/xhtml"
            style={{ fontSize: 12 / zoom, background: "white", border: `1px solid #e2e8f0`, borderRadius: 6 / zoom, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", overflow: "hidden" }}
          >
            {STAMPS.map((s) => (
              <button
                key={s}
                onClick={() => placeStamp(stampMenu, s)}
                style={{ display: "block", width: "100%", padding: `${5 / zoom}px ${8 / zoom}px`, textAlign: "left", cursor: "pointer", borderBottom: `1px solid #f1f5f9`, fontSize: 11 / zoom, color: s === "APPROVED" ? "#16a34a" : s === "REJECTED" ? "#dc2626" : "#d97706" }}
              >
                {s}
              </button>
            ))}
            <button onClick={() => setStampMenu(null)} style={{ display: "block", width: "100%", padding: `${4 / zoom}px ${8 / zoom}px`, textAlign: "center", fontSize: 10 / zoom, color: "#94a3b8" }}>Cancel</button>
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

// ─── Annotation Shape Renderer ───────────────────────────────
function AnnotationShape({ annotation, isSelected, onSelect, onDelete, zoom }: {
  annotation: Annotation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  zoom: number;
}) {
  const { type, geometry: pts, color, opacity, label } = annotation;
  const sw = (isSelected ? 3 : 2) / zoom;

  const textStyle = {
    paintOrder: "stroke" as const,
    stroke: "white",
    strokeWidth: 3 / zoom,
  };

  return (
    <g onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ cursor: "pointer" }}>
      {/* COUNT */}
      {type === "COUNT" && pts[0] && (
        <>
          <circle cx={pts[0].x} cy={pts[0].y} r={10 / zoom} fill={color} fillOpacity={opacity} stroke={isSelected ? "#fff" : "none"} strokeWidth={2 / zoom} />
          <text x={pts[0].x} y={pts[0].y + 4 / zoom} textAnchor="middle" fill="white" fontSize={10 / zoom} fontWeight="700">+</text>
        </>
      )}

      {/* TEXT / STAMP */}
      {type === "TEXT" && pts[0] && (
        <text
          x={pts[0].x} y={pts[0].y} fill={color} fontSize={14 / zoom} fontWeight="600"
          style={textStyle}
        >
          {label}
        </text>
      )}

      {/* MEASUREMENT / ARROW */}
      {type === "MEASUREMENT" && pts.length >= 2 && (
        <>
          {label === "→" ? (
            // Arrow annotation
            <line
              x1={pts[0].x} y1={pts[0].y} x2={pts[pts.length - 1].x} y2={pts[pts.length - 1].y}
              stroke={color} strokeWidth={sw} markerEnd="url(#arrowhead-ann)"
            />
          ) : (
            // Linear measurement
            <>
              <polyline
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none" stroke={color} strokeWidth={sw}
                strokeDasharray={isSelected ? `${5 / zoom},${3 / zoom}` : undefined}
                strokeLinecap="round"
              />
              {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3 / zoom} fill={color} />)}
              {label && pts.length >= 2 && (
                <text
                  x={(pts[0].x + pts[pts.length - 1].x) / 2}
                  y={(pts[0].y + pts[pts.length - 1].y) / 2 - 6 / zoom}
                  textAnchor="middle" fill={color} fontSize={11 / zoom} fontWeight="700"
                  style={textStyle}
                >
                  {label}
                </text>
              )}
            </>
          )}
        </>
      )}

      {/* PERIMETER */}
      {type === "PERIMETER" && pts.length >= 2 && (
        <>
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
          {label && (
            <text
              x={pts.reduce((s, p) => s + p.x, 0) / pts.length}
              y={Math.min(...pts.map((p) => p.y)) - 6 / zoom}
              textAnchor="middle" fill={color} fontSize={11 / zoom} fontWeight="700" style={textStyle}
            >
              {label}
            </text>
          )}
        </>
      )}

      {/* AREA (includes polygon, rectangle, highlight, cloud) */}
      {type === "AREA" && pts.length >= 3 && (
        <>
          {label === "Cloud" ? (
            <path d={cloudPath(pts, 10 / zoom)} fill={`${color}25`} stroke={color} strokeWidth={sw} />
          ) : (
            <polygon
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={color} fillOpacity={opacity} stroke={color} strokeWidth={sw}
              strokeDasharray={isSelected ? `${5 / zoom},${3 / zoom}` : undefined}
            />
          )}
          {label && label !== "Highlight" && (
            <text
              x={pts.reduce((s, p) => s + p.x, 0) / pts.length}
              y={pts.reduce((s, p) => s + p.y, 0) / pts.length}
              textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize={11 / zoom} fontWeight="700" style={textStyle}
            >
              {label}
            </text>
          )}
        </>
      )}

      {/* Selection handles */}
      {isSelected && pts[0] && (
        <>
          <circle cx={pts[0].x} cy={pts[0].y} r={5 / zoom} fill="none" stroke="white" strokeWidth={1.5 / zoom} />
          <g onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ cursor: "pointer" }}>
            <circle cx={pts[0].x + 16 / zoom} cy={pts[0].y - 16 / zoom} r={9 / zoom} fill="#ef4444" />
            <text x={pts[0].x + 16 / zoom} y={pts[0].y - 16 / zoom + 4 / zoom} textAnchor="middle" fill="white" fontSize={12 / zoom} fontWeight="700">×</text>
          </g>
        </>
      )}
    </g>
  );
}

