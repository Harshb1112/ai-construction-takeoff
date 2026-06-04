"use client";

/**
 * RegionAnalyzer — Real PDF→OCR→Markup→AI→Output workflow
 * =========================================================
 * 1. User selects an annotation
 * 2. User types a note: "Calculate concrete for this beam"
 * 3. Click "Analyze Region with AI"
 * 4. This component:
 *    a. Crops the PDF canvas to the annotation bounding box
 *    b. Extracts OCR text from the page using pdfjs-dist text layer
 *    c. Sends: cropped image + OCR text + user note + measurement → AI
 *    d. AI returns: takeoff items + summary
 *    e. Items auto-saved to DB
 * 5. Shows result with takeoff items
 */

import { useState, useCallback, useRef } from "react";
import {
  Brain, Loader2, CheckCircle2, X, Sparkles,
  FileText, Wand2, ChevronRight, AlertCircle, Cpu
} from "lucide-react";
import type { Annotation } from "@/types";
import { bufToBase64, getLmStudioUrl } from "@/lib/utils";
import { setupPdfWorker } from "@/lib/pdf-worker";

// Extract OCR text from a PDF page using pdfjs-dist text content API
async function extractOcrFromPage(fileUrl: string, pageNum: number): Promise<string> {
  try {
    setupPdfWorker();
    const pdfjs = await import("pdfjs-dist");

    const pdf = await pdfjs.getDocument(fileUrl).promise;
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Join all text items preserving approximate spatial order
    const text = (textContent.items as Array<{ str?: string }>)
      .map(item => item.str ?? "")
      .filter(Boolean)
      .join(" ");

    return text;
  } catch {
    return ""; // OCR failed gracefully
  }
}

// Crop the PDF canvas to annotation bounding box → returns base64 JPEG
async function cropRegionFromCanvas(
  annotation: Annotation,
  pageCanvasEl: HTMLCanvasElement | null,
  zoom: number
): Promise<string | null> {
  if (!pageCanvasEl || !annotation.geometry?.length) return null;

  // Calculate bounding box of annotation in canvas coordinates
  const pts = annotation.geometry;
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.max(0, Math.min(...xs) * zoom) - 8;
  const minY = Math.max(0, Math.min(...ys) * zoom) - 8;
  const maxX = Math.min(pageCanvasEl.width, Math.max(...xs) * zoom) + 8;
  const maxY = Math.min(pageCanvasEl.height, Math.max(...ys) * zoom) + 8;
  const w = Math.max(10, maxX - minX);
  const h = Math.max(10, maxY - minY);

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width  = w;
  cropCanvas.height = h;
  const ctx = cropCanvas.getContext("2d");
  if (!ctx) return null;

  // Draw the region from the PDF canvas
  ctx.drawImage(pageCanvasEl, minX, minY, w, h, 0, 0, w, h);

  return cropCanvas.toDataURL("image/jpeg", 0.92).split(",")[1];
}

// Get full PDF page as base64 JPEG (fallback when canvas crop unavailable)
async function getFullPageBase64(fileUrl: string, pageNum: number, format: string): Promise<string | null> {
  try {
    if (["PDF"].includes(format)) {
      setupPdfWorker();
      const pdfjs = await import("pdfjs-dist");

      const pdf = await pdfjs.getDocument(fileUrl).promise;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement("canvas");
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      // @ts-expect-error — pdfjs render params type varies by version
      await (page.render as (p: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> })({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/jpeg", 0.88).split(",")[1];
    } else {
      const res = await fetch(fileUrl);
      const buf = await res.arrayBuffer();
      return bufToBase64(buf);
    }
  } catch {
    return null;
  }
}

interface Props {
  annotation: Annotation;
  drawing: { id: string; fileUrl: string; fileFormat: string; originalName: string };
  projectId: string;
  pageNumber: number;
  zoom: number;
  onClose: () => void;
  onItemsSaved: () => void;
}

type Provider = "lmstudio";

export function RegionAnalyzer({ annotation, drawing, projectId, pageNumber, zoom, onClose, onItemsSaved }: Props) {
  const [note, setNote]           = useState(annotation.userNote ?? "");
  const provider: Provider = "lmstudio";
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState("");
  const [result, setResult]       = useState<{ summary: string; confidence: number; takeoffItems: unknown[]; savedCount: number } | null>(null);
  const [error, setError]         = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Save note to annotation DB
  const saveNote = useCallback(async (noteText: string) => {
    await fetch(`/api/drawings/${drawing.id}/annotations/${annotation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userNote: noteText }),
    }).catch(() => {});
  }, [annotation.id, drawing.id]);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError("");
    setResult(null);

    // Save note first
    if (note) await saveNote(note);

    try {
      // Step 1: Get PDF canvas element (the actual rendered page)
      setStep("Cropping marked region...");
      const pageCanvas = document.querySelector(".react-pdf__Page__canvas") as HTMLCanvasElement | null;
      let croppedBase64 = await cropRegionFromCanvas(annotation, pageCanvas, zoom);

      if (!croppedBase64) {
        setStep("Rendering PDF region...");
        croppedBase64 = await getFullPageBase64(drawing.fileUrl, pageNumber, drawing.fileFormat);
      }

      if (!croppedBase64) throw new Error("Could not capture drawing region");

      // Step 2: Extract OCR text from this PDF page
      setStep("Extracting text from page (OCR)...");
      const ocrText = await extractOcrFromPage(drawing.fileUrl, pageNumber);

      // Step 3: Send to AI
      setStep(`Analyzing region with ${provider}...`);

      const lmUrl = typeof window !== "undefined"
        ? localStorage.getItem("lmstudio_url") ?? "http://localhost:1234/v1"
        : "http://localhost:1234/v1";

      const res = await fetch("/api/ai/region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          croppedBase64,
          ocrText,
          userNote:       note || "Extract all materials and quantities visible in this marked region",
          annotationType: annotation.type,
          measurement:    annotation.measurement,
          unit:           annotation.unit,
          provider,
          lmBaseUrl:      lmUrl,
          annotationId:   annotation.id,
          projectId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.hint ?? "AI analysis failed");

      setResult(data);
      onItemsSaved();
      setStep("");

    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setStep("");
    } finally {
      setLoading(false);
    }
  }, [annotation, drawing, note, pageNumber, projectId, provider, saveNote, zoom, onItemsSaved]);

  const typeColor: Record<string, string> = {
    AREA: "#059669", MEASUREMENT: "#2563eb",
    PERIMETER: "#0891b2", COUNT: "#d97706", TEXT: "#6b7280",
  };
  const annColor = typeColor[annotation.type] ?? "#2563eb";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(15,23,42,.6)", backdropFilter: "blur(4px)",
      padding: 16,
    }} onClick={onClose}>
      <div style={{
        width: "100%", maxWidth: 540,
        background: "#fff", borderRadius: 20,
        boxShadow: "0 24px 64px rgba(0,0,0,.2)",
        overflow: "hidden",
        animation: "bounceIn .3s cubic-bezier(.34,1.56,.64,1) both",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "18px 22px", background: "#0f172a", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: `${annColor}25`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Brain size={20} color={annColor} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Analyze Marked Region</p>
            <p style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              {annotation.type} · {annotation.measurement?.toFixed(1)} {annotation.unit} · {drawing.originalName}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Workflow diagram */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", overflow: "auto" }}>
            {[
              { icon: FileText,  label: "PDF Region",  color: "#64748b" },
              { icon: ChevronRight, label: null,        color: "#cbd5e1" },
              { icon: FileText,  label: "OCR Text",    color: "#2563eb" },
              { icon: ChevronRight, label: null,        color: "#cbd5e1" },
              { icon: Wand2,     label: "AI Analysis", color: "#7c3aed" },
              { icon: ChevronRight, label: null,        color: "#cbd5e1" },
              { icon: CheckCircle2, label: "Takeoff",  color: "#059669" },
            ].map(({ icon: Icon, label, color }, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <Icon size={13} color={color} />
                {label && <span style={{ fontSize: 10, color, fontWeight: 600 }}>{label}</span>}
              </div>
            ))}
          </div>

          {/* User note */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 8 }}>
              Your instruction for this region <span style={{ fontWeight: 400, color: "#94a3b8" }}>(tell AI what to calculate)</span>
            </label>
            <textarea
              ref={noteRef}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={
                annotation.type === "AREA"
                  ? 'e.g. "Calculate concrete volume for this slab, 200mm thick"\n      "Estimate drywall for this room"\n      "Find all materials for this section"'
                  : annotation.type === "MEASUREMENT"
                  ? 'e.g. "Calculate studs needed for this wall length at 16" OC"'
                  : 'e.g. "What materials are visible in this marked region?"'
              }
              rows={3}
              style={{
                width: "100%", padding: "10px 12px",
                borderRadius: 10, border: "1px solid #e2e8f0",
                fontSize: 13, fontFamily: "inherit", resize: "vertical",
                outline: "none", lineHeight: 1.6, boxSizing: "border-box",
                background: note ? "#f0fdf4" : "#fff",
                borderColor: note ? "#86efac" : "#e2e8f0",
              }}
              onFocus={e => (e.target.style.borderColor = "#7c3aed")}
              onBlur={e => {
                e.target.style.borderColor = note ? "#86efac" : "#e2e8f0";
                if (note) saveNote(note);
              }}
            />
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              AI will receive: your note + cropped region image + OCR text from PDF
            </p>
          </div>

          {/* AI badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>🤖 LM Studio — 100% local</span>
          </div>

          {/* Step indicator */}
          {step && (
            <div style={{ padding: "10px 14px", borderRadius: 9, background: "#eff6ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", gap: 8 }}>
              <Loader2 size={14} color="#2563eb" className="spin" />
              <span style={{ fontSize: 12, color: "#2563eb", fontWeight: 600 }}>{step}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 9, background: "#fef2f2", border: "1px solid #fecaca", display: "flex", alignItems: "flex-start", gap: 8 }}>
              <AlertCircle size={14} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{ borderRadius: 12, border: "1px solid #bbf7d0", background: "#f0fdf4", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #bbf7d0", display: "flex", alignItems: "center", gap: 8 }}>
                <CheckCircle2 size={16} color="#059669" />
                <p style={{ fontSize: 13, fontWeight: 700, color: "#065f46" }}>
                  {result.savedCount} items extracted and saved to Takeoff
                </p>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#059669", fontWeight: 700 }}>
                  {Math.round((result.confidence ?? 0) * 100)}% confidence
                </span>
              </div>
              {result.summary && (
                <div style={{ padding: "10px 16px", borderBottom: "1px solid #bbf7d0" }}>
                  <p style={{ fontSize: 12, color: "#065f46", lineHeight: 1.6 }}>{result.summary}</p>
                </div>
              )}
              <div style={{ padding: "10px 16px", maxHeight: 200, overflowY: "auto" }}>
                {(result.takeoffItems as { category?: string; description?: string; quantity?: number; unit?: string; unitCost?: number }[]).map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #dcfce7" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#059669", minWidth: 20 }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{item.description}</p>
                      <p style={{ fontSize: 11, color: "#64748b" }}>{item.category}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#059669", fontFamily: "monospace" }}>
                        {item.quantity} {item.unit}
                      </p>
                      {item.unitCost ? (
                        <p style={{ fontSize: 10, color: "#94a3b8" }}>${item.unitCost}/unit</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analyze button */}
          {!result && (
            <button
              onClick={analyze}
              disabled={loading}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
                background: loading ? "#a78bfa" : "linear-gradient(135deg,#7c3aed,#2563eb)",
                color: "#fff", fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                boxShadow: loading ? "none" : "0 4px 16px rgba(124,58,237,.3)",
                transition: "all .2s",
              }}
            >
              {loading ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
              {loading ? "Analyzing..." : "Analyze Region with AI"}
            </button>
          )}

          {result && (
            <button onClick={onClose} style={{
              width: "100%", padding: "11px 0", borderRadius: 12, border: "1px solid #bbf7d0",
              background: "#f0fdf4", color: "#059669", fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}>
              ✓ Done — Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
