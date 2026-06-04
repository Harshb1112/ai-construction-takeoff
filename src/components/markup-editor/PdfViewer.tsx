"use client";

/**
 * PdfViewer — renders PDF using pdfjs-dist v5 directly on a <canvas>.
 *
 * Supports:
 *  - OCG (Optional Content Groups) = PDF layers → exposed via onLayersLoaded
 *  - Layer visibility toggling via layerVisibility prop (re-renders page)
 *  - Page dimensions callback
 */

import { useEffect, useRef, useState } from "react";

export interface PdfLayer {
  id: string;
  name: string;
  visible: boolean;
}

interface Props {
  fileUrl: string;
  pageNumber: number;
  onPageCount:      (n: number) => void;
  onPageDimensions: (w: number, h: number) => void;
  onLayersLoaded?:  (layers: PdfLayer[]) => void;
  /** map of layer id → visible; pass updated map to re-render with changed visibility */
  layerVisibility?: Map<string, boolean>;
}

const PAGE_WIDTH = 1400; // CSS display width — coordinates based on this

export default function PdfViewer({
  fileUrl,
  pageNumber,
  onPageCount,
  onPageDimensions,
  onLayersLoaded,
  layerVisibility,
}: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const pdfRef     = useRef<any>(null);        // PDFDocumentProxy
  const ocgRef     = useRef<any>(null);        // OptionalContentConfig
  const renderTask = useRef<any>(null);        // current render task

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);
  const [dims,    setDims]    = useState({ w: PAGE_WIDTH, h: 1200 });

  // ── Load the PDF once ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(false);

        const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
        // Use v5 worker (matches pdfjs-dist v5.x)
        GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const buf = await res.arrayBuffer();

        const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
        if (cancelled) { pdf.destroy(); return; }

        pdfRef.current = pdf;
        onPageCount(pdf.numPages);

        // ── Extract OCG layers ──────────────────────────────────
        try {
          const ocConfig = await pdf.getOptionalContentConfig();
          if (!cancelled && ocConfig) {
            ocgRef.current = ocConfig;

            // pdfjs v5 exposes groups as a plain object keyed by xref id
            // Try getGroups() first, fall back to internal _map
            let groupsObj: Record<string, { name?: string }> | null = null;
            if (typeof (ocConfig as any).getGroups === "function") {
              groupsObj = (ocConfig as any).getGroups();
            } else if ((ocConfig as any)._map) {
              groupsObj = Object.fromEntries(
                (ocConfig as any)._map.entries?.() ?? []
              );
            }

            if (groupsObj && Object.keys(groupsObj).length > 0) {
              const layers: PdfLayer[] = Object.entries(groupsObj).map(
                ([id, g]: [string, any]) => ({
                  id,
                  name:    g?.name ?? g?.intent ?? id,
                  visible: g?.visible !== false,
                })
              );
              onLayersLoaded?.(layers);
            }
          }
        } catch {
          // OCG not supported by this PDF — silently ignore
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // ── Render the page (triggered by pageNumber OR layerVisibility changes) ──
  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;

    let cancelled = false;

    (async () => {
      try {
        // Cancel any in-flight render
        if (renderTask.current) {
          try { renderTask.current.cancel(); } catch {}
          renderTask.current = null;
        }

        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const vp0   = page.getViewport({ scale: 1 });
        const ratio = PAGE_WIDTH / vp0.width;

        // Render at 2× for sharpness, display at 1× via CSS
        const RENDER_SCALE = 2;
        const vp    = page.getViewport({ scale: ratio * RENDER_SCALE });

        // Internal canvas = 2x resolution
        canvas.width  = Math.round(vp.width);
        canvas.height = Math.round(vp.height);

        // CSS display = PAGE_WIDTH (1x) — so coordinates match pageDims
        const cssW = Math.round(vp0.width  * ratio);
        const cssH = Math.round(vp0.height * ratio);
        canvas.style.width  = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.style.imageRendering = "high-quality";

        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Apply layer visibility overrides to the OCG config
        const ocConfig = ocgRef.current;
        if (ocConfig && layerVisibility && layerVisibility.size > 0) {
          for (const [id, visible] of layerVisibility) {
            try {
              if (typeof (ocConfig as any).setVisibility === "function") {
                (ocConfig as any).setVisibility(id, visible);
              } else if ((ocConfig as any)._map?.has?.(id)) {
                (ocConfig as any)._map.get(id).visible = visible;
              }
            } catch {}
          }
        }

        const task = page.render({
          canvasContext: ctx,
          viewport:      vp,
          ...(ocConfig
            ? { optionalContentConfigPromise: Promise.resolve(ocConfig) }
            : {}),
        });
        renderTask.current = task;

        await task.promise;

        if (!cancelled) {
          // Pass CSS size (1x) to AnnotationCanvas — NOT the 2x render size
          setLoading(false);
          setDims({ w: cssW, h: cssH });
          onPageDimensions(cssW, cssH);
        }
      } catch (e: any) {
        if (e?.name !== "RenderingCancelledException" && !cancelled) {
          setError(true);
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfRef.current, pageNumber, layerVisibility]);

  // ── UI ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        width: PAGE_WIDTH, height: 600,
        background: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 8,
      }}>
        <p style={{ fontSize: 20 }}>⚠️</p>
        <p style={{ fontSize: 14, fontWeight: 600, color: "#ef4444" }}>Could not load PDF</p>
        <p style={{ fontSize: 12, color: "#94a3b8" }}>Re-upload the file and try again</p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
      {loading && (
        <div style={{
          position: "absolute", inset: 0,
          width: PAGE_WIDTH, height: dims.h,
          background: "#fff", zIndex: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 12,
        }}>
          <div className="spin" style={{
            width: 36, height: 36, borderRadius: "50%",
            border: "4px solid #e2e8f0", borderTopColor: "#2563eb",
          }} />
          <p style={{ fontSize: 13, color: "#94a3b8" }}>Loading PDF…</p>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width:  dims.w,
          height: dims.h,
          maxWidth: "100%",
        }}
      />
    </div>
  );
}
