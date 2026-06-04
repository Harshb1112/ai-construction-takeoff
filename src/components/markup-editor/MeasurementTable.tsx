"use client";

import { useMemo, useState } from "react";
import { Download, Trash2, ChevronDown, ChevronUp, BarChart3, X } from "lucide-react";
import type { Annotation } from "@/types";

interface Props {
  annotations: Annotation[];
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  onClose: () => void;
}

type GroupKey = "AREA" | "MEASUREMENT" | "PERIMETER" | "COUNT" | "TEXT";

const GROUP_LABELS: Record<GroupKey, string> = {
  AREA:        "Areas",
  MEASUREMENT: "Linear Measurements",
  PERIMETER:   "Perimeters",
  COUNT:       "Counts",
  TEXT:        "Notes & Stamps",
};

const GROUP_COLORS: Record<GroupKey, string> = {
  AREA:        "#059669",
  MEASUREMENT: "#2563eb",
  PERIMETER:   "#0891b2",
  COUNT:       "#d97706",
  TEXT:        "#6b7280",
};

const GROUP_BG: Record<GroupKey, string> = {
  AREA:        "#f0fdf4",
  MEASUREMENT: "#eff6ff",
  PERIMETER:   "#ecfeff",
  COUNT:       "#fffbeb",
  TEXT:        "#f8fafc",
};

export function MeasurementTable({ annotations, onDelete, onSelect, selectedId, onClose }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Group annotations by type
  const groups = useMemo(() => {
    const g: Partial<Record<GroupKey, Annotation[]>> = {};
    for (const ann of annotations) {
      const key = ann.type as GroupKey;
      if (!g[key]) g[key] = [];
      g[key]!.push(ann);
    }
    return g;
  }, [annotations]);

  // Totals per group
  const totals = useMemo(() => {
    const t: Partial<Record<GroupKey, { sum: number; unit: string; count: number }>> = {};
    for (const [key, anns] of Object.entries(groups)) {
      const k = key as GroupKey;
      const withMeasure = (anns || []).filter(a => a.measurement != null);
      t[k] = {
        sum: withMeasure.reduce((s, a) => s + (a.measurement ?? 0), 0),
        unit: withMeasure[0]?.unit ?? "",
        count: (anns || []).length,
      };
    }
    return t;
  }, [groups]);

  const exportCSV = () => {
    const rows: string[][] = [["#", "Type", "Label", "Measurement", "Unit", "Color"]];
    let i = 1;
    for (const [type, anns] of Object.entries(groups)) {
      for (const ann of anns || []) {
        rows.push([
          String(i++),
          type,
          ann.label ?? "",
          ann.measurement != null ? ann.measurement.toFixed(2) : "",
          ann.unit ?? "",
          ann.color,
        ]);
      }
    }
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "measurements.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const totalAnnotations = annotations.length;

  return (
    <div style={{
      position: "absolute", bottom: 60, left: 60, zIndex: 100,
      width: 400, maxHeight: "70vh",
      background: "#fff", borderRadius: 16,
      border: "1px solid #e2e8f0",
      boxShadow: "0 16px 48px rgba(0,0,0,.18)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }} className="bounce-in">

      {/* Header */}
      <div style={{
        padding: "14px 16px", background: "#0f172a",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <BarChart3 size={16} color="#94a3b8" />
        <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", flex: 1 }}>
          Measurement Summary
        </p>
        <span style={{ fontSize: 11, color: "#64748b", background: "#1e293b", padding: "2px 8px", borderRadius: 99 }}>
          {totalAnnotations} items
        </span>
        <button onClick={exportCSV} title="Export CSV" style={{
          background: "#1e293b", border: "none", cursor: "pointer",
          padding: "4px 8px", borderRadius: 6, color: "#94a3b8",
          display: "flex", alignItems: "center", gap: 4, fontSize: 11,
        }}>
          <Download size={12} /> CSV
        </button>
        <button onClick={onClose} style={{
          background: "none", border: "none", cursor: "pointer", color: "#64748b",
        }}>
          <X size={16} />
        </button>
      </div>

      {/* Groups */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {Object.keys(groups).length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
            <BarChart3 size={32} color="#e2e8f0" style={{ margin: "0 auto 10px" }} />
            <p>No measurements yet.</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>Draw area, line, or count markers on the PDF.</p>
          </div>
        ) : (
          (Object.keys(groups) as GroupKey[]).map(type => {
            const anns = groups[type] ?? [];
            const tot = totals[type];
            const isCollapsed = collapsed[type];
            const color = GROUP_COLORS[type] ?? "#64748b";
            const bg = GROUP_BG[type] ?? "#f8fafc";

            return (
              <div key={type} style={{ borderBottom: "1px solid #f1f5f9" }}>
                {/* Group header */}
                <button
                  onClick={() => setCollapsed(p => ({ ...p, [type]: !p[type] }))}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", background: bg,
                    border: "none", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: color, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", flex: 1 }}>
                    {GROUP_LABELS[type] ?? type}
                  </span>
                  <span style={{ fontSize: 11, color, fontWeight: 700 }}>
                    {anns.length} items
                    {tot?.sum ? ` · ${tot.sum.toFixed(1)} ${tot.unit}` : ""}
                  </span>
                  {isCollapsed ? <ChevronDown size={13} color="#94a3b8" /> : <ChevronUp size={13} color="#94a3b8" />}
                </button>

                {/* Annotation rows */}
                {!isCollapsed && (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ padding: "5px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".05em" }}>Label</th>
                        <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>Value</th>
                        <th style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#94a3b8" }}>Unit</th>
                        <th style={{ width: 32 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {anns.map((ann, i) => {
                        const isSel = selectedId === ann.id;
                        return (
                          <tr
                            key={ann.id}
                            onClick={() => onSelect(ann.id)}
                            style={{
                              background: isSel ? `${color}12` : i % 2 === 0 ? "#fff" : "#fafafa",
                              cursor: "pointer",
                              outline: isSel ? `1px solid ${color}` : "none",
                              outlineOffset: -1,
                            }}
                          >
                            <td style={{ padding: "7px 14px", fontSize: 12, color: "#374151", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: ann.color, marginRight: 6 }} />
                              {ann.label ?? ann.type}
                            </td>
                            <td style={{ padding: "7px 8px", textAlign: "right", fontSize: 12, fontWeight: 700, color, fontFamily: "monospace" }}>
                              {ann.measurement != null ? ann.measurement.toFixed(1) : "—"}
                            </td>
                            <td style={{ padding: "7px 8px", fontSize: 11, color: "#94a3b8" }}>
                              {ann.unit ?? ""}
                            </td>
                            <td style={{ padding: "7px 6px" }}>
                              <button
                                onClick={e => { e.stopPropagation(); onDelete(ann.id); }}
                                title="Delete this annotation"
                                style={{
                                  background: "none", border: "none", cursor: "pointer",
                                  color: "#cbd5e1", padding: "2px 4px", borderRadius: 4,
                                  display: "flex", alignItems: "center",
                                }}
                                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#ef4444")}
                                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#cbd5e1")}
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Group total */}
                    {tot?.sum ? (
                      <tfoot>
                        <tr style={{ background: bg, borderTop: `1px solid ${color}30` }}>
                          <td style={{ padding: "6px 14px", fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                            Total {GROUP_LABELS[type]}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 13, fontWeight: 800, color, fontFamily: "monospace" }}>
                            {tot.sum.toFixed(2)}
                          </td>
                          <td style={{ padding: "6px 8px", fontSize: 11, color }}>
                            {tot.unit}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Grand summary footer */}
      {totalAnnotations > 0 && (
        <div style={{ padding: "10px 14px", background: "#0f172a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>Total annotations</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{totalAnnotations}</span>
        </div>
      )}
    </div>
  );
}
