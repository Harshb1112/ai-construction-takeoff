"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, Info } from "lucide-react";
import { MarkupEditor } from "@/components/markup-editor/MarkupEditor";
import type { Drawing } from "@/types";
import { formatBytes } from "@/lib/utils";

export default function DrawingEditorPage() {
  const { projectId, drawingId } = useParams<{ projectId: string; drawingId: string }>();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/drawings/${drawingId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setDrawing(d ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [drawingId]);

  if (loading) return (
    <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div className="spin" style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #e2e8f0", borderTopColor: "#2563eb" }} />
    </div>
  );

  if (!drawing) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "80px 24px", textAlign: "center" }}>
      <p style={{ fontSize: 15, color: "#94a3b8" }}>Drawing not found.</p>
      <Link href={`/projects/${projectId}`} style={{ color: "#2563eb", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
        ← Back to project
      </Link>
    </div>
  );

  const FORMAT_COLOR: Record<string, string> = {
    PDF: "#dc2626", DWG: "#2563eb", DXF: "#7c3aed", IFC: "#059669",
    PNG: "#0891b2", JPG: "#d97706", JPEG: "#d97706",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", margin: "-28px -32px" }}>

      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "0 16px", height: 48,
        background: "#fff", borderBottom: "1px solid #e2e8f0",
        boxShadow: "0 1px 4px rgba(0,0,0,.04)",
        flexShrink: 0,
      }}>
        {/* Back */}
        <Link href={`/projects/${projectId}/drawings`} style={{
          display: "flex", alignItems: "center", gap: 6, textDecoration: "none",
          color: "#64748b", fontSize: 12, fontWeight: 600,
          padding: "5px 10px", borderRadius: 7, border: "1px solid #e2e8f0",
          transition: "all .15s",
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "#f8fafc")}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "#fff")}
        >
          <ArrowLeft size={13} /> Back
        </Link>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: "#e2e8f0" }} />

        {/* File info */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 99,
            background: `${FORMAT_COLOR[drawing.fileFormat] ?? "#64748b"}18`,
            color: FORMAT_COLOR[drawing.fileFormat] ?? "#64748b",
          }}>
            {drawing.fileFormat}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
            {drawing.originalName}
          </span>
          <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>
            {formatBytes(drawing.fileSizeBytes)}
          </span>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Tips */}
        <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
          <Info size={11} />
          Select tool (V) → click annotation → Delete key to remove
        </div>

        {/* Download original */}
        <a href={drawing.fileUrl} download={drawing.originalName} style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 12px", borderRadius: 7, border: "1px solid #e2e8f0",
          background: "#fff", color: "#64748b", textDecoration: "none",
          fontSize: 12, fontWeight: 600, transition: "all .15s",
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "#f8fafc")}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "#fff")}
        >
          <Download size={13} /> Download
        </a>
      </div>

      {/* ── Editor ────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <MarkupEditor drawing={drawing} projectId={projectId} />
      </div>
    </div>
  );
}
