"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  Upload, Box, Layers, Info, FileText,
  Link2, CheckCircle2, Loader2, ChevronRight, AlertTriangle
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { COST_DATABASE } from "@/lib/cost-database";

// Pull live unit costs from cost database — no hardcoding
const _db = (id: string) => COST_DATABASE.find(x => x.id === id)?.prices?.us_national?.total ?? 0;

const IfcViewer = dynamic(() => import("@/components/viewers/IfcViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-xl bg-[#0f172a]">
      <div className="text-sm text-sky-400">Loading 3D viewer...</div>
    </div>
  ),
});

const DxfViewer = dynamic(
  () => import("@/components/markup-editor/renderers/DxfRenderer").then(m => ({ default: m.DxfRenderer })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] items-center justify-center rounded-xl bg-[#0d1117]">
        <div className="text-sm text-sky-400">Loading DXF viewer...</div>
      </div>
    ),
  }
);

const RvtConverter = dynamic(() => import("@/components/viewers/RvtConverter"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-xl bg-[#0f172a]">
      <div className="text-sm text-sky-400">Connecting to Autodesk APS…</div>
    </div>
  ),
});

// Unit costs from real cost database (CSI codes, US National rates)
const BIM_ELEMENT_COSTS: Record<string, { unit: string; unitCost: number; csiCode: string; section: string; qty: (count: number) => number }> = {
  Wall:   { unit: "SF",  unitCost: _db("04-0200") || 16.00,  csiCode: "04 22 00", section: "04 - Masonry",          qty: c => c * 80  },
  Slab:   { unit: "SF",  unitCost: _db("03-0110") || 6.50,   csiCode: "03 30 00", section: "03 - Concrete",          qty: c => c * 120 },
  Column: { unit: "EA",  unitCost: _db("03-0120") || 250.0,  csiCode: "03 30 00", section: "03 - Concrete",          qty: c => c       },
  Door:   { unit: "EA",  unitCost: _db("08-0100") || 600.0,  csiCode: "08 11 13", section: "08 - Doors & Windows",   qty: c => c       },
  Window: { unit: "EA",  unitCost: _db("08-0120") || 400.0,  csiCode: "08 52 00", section: "08 - Doors & Windows",   qty: c => c       },
};

interface IfcElement { id: number; type: string; name: string; color: number }
interface ElementStats { walls: number; slabs: number; columns: number; doors: number; windows: number }
interface BimGroup { type: string; count: number; unit: string; quantity: number; unitCost: number; total: number; csiCode: string; section: string }

function buildGroups(stats: ElementStats): BimGroup[] {
  const map: [string, number][] = [
    ["Wall", stats.walls], ["Slab", stats.slabs], ["Column", stats.columns],
    ["Door", stats.doors], ["Window", stats.windows],
  ];
  return map
    .filter(([, count]) => count > 0)
    .map(([type, count]) => {
      const cfg = BIM_ELEMENT_COSTS[type]!;
      const quantity = cfg.qty(count);
      return { type, count, unit: cfg.unit, quantity, unitCost: cfg.unitCost, total: quantity * cfg.unitCost, csiCode: cfg.csiCode, section: cfg.section };
    });
}

export default function Model3DPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [fileUrl, setFileUrl]       = useState<string | null>(null);
  const [fileName, setFileName]     = useState<string>("");
  const [activeTab, setActiveTab]   = useState<"viewer" | "bimlink" | "properties">("viewer");
  const [parsedStats, setParsedStats] = useState<ElementStats | null>(null);
  const [parsedElements, setParsedElements] = useState<IfcElement[]>([]);
  const [linking, setLinking]       = useState(false);
  const [linkedGroups, setLinkedGroups] = useState<Set<string>>(new Set());

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFileUrl(URL.createObjectURL(file));
    setParsedStats(null);
    setParsedElements([]);
    setLinkedGroups(new Set());
  };

  const handleElementsParsed = useCallback((elements: IfcElement[], stats: ElementStats) => {
    setParsedElements(elements);
    setParsedStats(stats);
  }, []);

  const linkGroupToBoq = async (group: BimGroup) => {
    setLinking(true);
    try {
      await fetch(`/api/projects/${projectId}/boq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: group.section,
          csiCode: group.csiCode,
          description: `BIM Link: ${group.type}s (${group.count} elements × ${group.unit === "EA" ? group.count : `~${group.quantity} ${group.unit}`})`,
          unit: group.unit,
          quantity: group.quantity,
          unitCost: group.unitCost,
          totalCost: group.total,
          notes: `Auto-linked from IFC model: ${fileName} · ${group.count} ${group.type} elements`,
          sortOrder: 0,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["boq", projectId] });
      setLinkedGroups(prev => new Set([...prev, group.type]));
    } finally {
      setLinking(false);
    }
  };

  const linkAllToBoq = async (groups: BimGroup[]) => {
    for (const g of groups) {
      if (!linkedGroups.has(g.type)) await linkGroupToBoq(g);
    }
  };

  const fileExt = fileName.split(".").pop()?.toLowerCase() ?? "";
  const isIfc = fileExt === "ifc";
  const isDxf = fileExt === "dxf";
  const isDwg = fileExt === "dwg";
  const isRvt = fileExt === "rvt";

  const bimGroups = parsedStats ? buildGroups(parsedStats) : [];
  const parsedElementCount = parsedStats ? Object.values(parsedStats).reduce((sum, value) => sum + value, 0) : 0;
  const totalBimCost = bimGroups.reduce((s, g) => s + g.total, 0);

  const IFC_FORMATS = [
    { ext: ".ifc", name: "IFC 2x3 / IFC 4", desc: "Export from Revit, ArchiCAD, Tekla, Vectorworks" },
    { ext: ".dxf", name: "AutoCAD DXF", desc: "Direct browser parse — all layers" },
    { ext: ".dwg", name: "AutoCAD DWG", desc: "Via FastAPI backend (start-backend.bat)" },
    { ext: ".rvt", name: "Revit RVT", desc: "Via FastAPI backend — or export as IFC first" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-(--foreground)">3D BIM Viewer + BOQ Link</h2>
        <p className="text-sm text-(--muted-foreground)">
          Upload IFC/DXF → view in 3D → group elements → link directly to your Bill of Quantities
        </p>
      </div>

      {!fileUrl ? (
        <div className="space-y-5">
          <label className="flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-(--border) bg-(--card) px-8 py-16 hover:border-sky-400 hover:bg-sky-50/20 transition-colors">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100">
              <Box className="h-8 w-8 text-sky-500" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-(--foreground)">Upload 3D BIM Model</p>
              <p className="text-sm text-(--muted-foreground)">IFC, DWG, DXF — click to browse</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {[".ifc", ".dwg", ".dxf", ".rvt"].map(ext => (
                <span key={ext} className="rounded-full border border-(--border) bg-(--muted) px-3 py-0.5 text-xs font-mono text-(--muted-foreground)">{ext}</span>
              ))}
            </div>
            <input type="file" accept=".ifc,.dwg,.dxf,.rvt" className="hidden" onChange={handleFileUpload} />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            {IFC_FORMATS.map(({ ext, name, desc }) => (
              <div key={ext} className="flex gap-3 rounded-xl border border-(--border) bg-(--card) p-4">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-sky-100">
                  <FileText className="h-4 w-4 text-sky-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-(--foreground)">{ext} — {name}</p>
                  <p className="text-xs text-(--muted-foreground)">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tab bar */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex rounded-xl border border-(--border) bg-(--card) overflow-hidden">
              {[
                { id: "viewer",  label: "3D View",         icon: Box },
                { id: "bimlink", label: `BIM → BOQ${bimGroups.length ? ` (${bimGroups.length})` : ""}`, icon: Link2 },
                { id: "properties", label: "Properties",   icon: Info },
              ].map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setActiveTab(id as typeof activeTab)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${activeTab === id ? "bg-sky-500 text-white" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                >
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>
            <span className="text-sm text-(--muted-foreground)">📁 {fileName}</span>
            <button onClick={() => { setFileUrl(null); setFileName(""); setParsedStats(null); }} className="ml-auto text-xs text-(--muted-foreground) hover:text-red-500 transition-colors">
              Change file
            </button>
          </div>

          {/* 3D Viewer */}
          {activeTab === "viewer" && (
            isIfc ? (
              <IfcViewer fileUrl={fileUrl} onElementsParsed={handleElementsParsed} />
            ) : isDxf ? (
              <DxfViewer fileUrl={fileUrl} fileFormat="DXF" />
            ) : isDwg ? (
              <DxfViewer fileUrl={fileUrl} fileFormat="DWG" />
            ) : isRvt ? (
              <RvtConverter
                fileUrl={fileUrl}
                fileName={fileName}
                onElementsParsed={handleElementsParsed}
              />
            ) : (
              <div className="flex h-[520px] items-center justify-center rounded-xl bg-[#0f172a]">
                <p className="text-sm text-slate-400">Unsupported format: <code className="text-red-400">.{fileExt}</code></p>
              </div>
            )
          )}

          {/* BIM → BOQ Bulk Link */}
          {activeTab === "bimlink" && (
            <div className="space-y-4">
              {bimGroups.length === 0 ? (
                <div className="rounded-xl border border-(--border) bg-(--card) p-8 text-center">
                  <Link2 className="h-10 w-10 text-(--muted-foreground) mx-auto mb-3" />
                  <p className="font-medium text-(--foreground)">Switch to 3D View first to parse elements</p>
                  <p className="text-sm text-(--muted-foreground) mt-1">The viewer will detect Walls, Slabs, Columns, Doors & Windows</p>
                  <button onClick={() => setActiveTab("viewer")} className="mt-4 flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors mx-auto">
                    <Box className="h-4 w-4" />Open 3D View
                  </button>
                </div>
              ) : (
                <>
                  {/* Summary */}
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-sm font-bold text-emerald-800">
                        {parsedElementCount} BIM elements detected — {bimGroups.length} groups ready to link
                      </p>
                      <p className="text-xs text-emerald-600 mt-1">
                        Total estimated material cost: <strong>{formatCurrency(totalBimCost)}</strong>
                      </p>
                    </div>
                    <button
                      onClick={() => linkAllToBoq(bimGroups)}
                      disabled={linking || bimGroups.every(g => linkedGroups.has(g.type))}
                      className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                      {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                      Link All Groups to BOQ
                    </button>
                  </div>

                  {/* Group table */}
                  <div className="rounded-xl border border-(--border) bg-(--card) overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-(--muted) border-b border-(--border)">
                          {["Element Type", "Count", "Qty", "Unit", "Unit Cost", "Total", "CSI Code", "Section", ""].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-(--border)">
                        {bimGroups.map(group => {
                          const isLinked = linkedGroups.has(group.type);
                          const colors: Record<string, string> = { Wall: "#e2e8f0", Slab: "#94a3b8", Column: "#475569", Door: "#f59e0b", Window: "#7dd3fc" };
                          return (
                            <tr key={group.type} className={`hover:bg-(--muted) transition-colors ${isLinked ? "opacity-70" : ""}`}>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: colors[group.type] ?? "#94a3b8" }} />
                                  <span className="font-medium text-(--foreground)">{group.type}s</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-sky-600">{group.count}</td>
                              <td className="px-4 py-3 font-mono">{group.quantity}</td>
                              <td className="px-4 py-3 text-(--muted-foreground)">{group.unit}</td>
                              <td className="px-4 py-3 font-mono">${group.unitCost.toFixed(2)}</td>
                              <td className="px-4 py-3 font-mono font-bold text-emerald-600">{formatCurrency(group.total)}</td>
                              <td className="px-4 py-3 text-xs font-mono text-(--muted-foreground)">{group.csiCode}</td>
                              <td className="px-4 py-3 text-xs text-(--muted-foreground)">{group.section}</td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => linkGroupToBoq(group)}
                                  disabled={linking || isLinked}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${isLinked ? "bg-emerald-100 text-emerald-700" : "bg-sky-500 text-white hover:bg-sky-600"} disabled:opacity-60`}
                                >
                                  {isLinked ? <><CheckCircle2 className="h-3 w-3" />Linked</> : <><Link2 className="h-3 w-3" />Link to BOQ</>}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-(--border) bg-(--muted)">
                          <td colSpan={5} className="px-4 py-3 text-right font-bold text-(--foreground)">Total BIM Estimate</td>
                          <td className="px-4 py-3 font-bold text-emerald-600">{formatCurrency(totalBimCost)}</td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    <strong>How quantities work:</strong> Walls × 80 SF/element · Slabs × 120 SF/element · Columns as EA ·
                    Doors & Windows as EA. These are estimates — edit quantities in the BOQ editor after linking.
                    Unit costs are from the cost database (US National average).
                  </div>
                </>
              )}
            </div>
          )}

          {/* Properties */}
          {activeTab === "properties" && (
            <div className="rounded-xl border border-(--border) bg-(--card) p-5 space-y-3">
              <p className="text-sm font-medium text-(--foreground)">Model Properties</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "File Name",    value: fileName },
                  { label: "Format",       value: fileName.split(".").pop()?.toUpperCase() ?? "IFC" },
                  { label: "Elements",     value: parsedElementCount > 0 ? `${parsedElementCount} parsed` : "Loading…" },
                  { label: "Viewer",       value: "Three.js WebGL" },
                  { label: "Standard",     value: "IFC 2x3 / IFC 4" },
                  { label: "BOQ Status",   value: linkedGroups.size > 0 ? `${linkedGroups.size} groups linked ✓` : "Not linked yet" },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-(--border) bg-(--muted) px-3 py-2">
                    <p className="text-xs text-(--muted-foreground)">{label}</p>
                    <p className="text-sm font-medium text-(--foreground)">{value}</p>
                  </div>
                ))}
              </div>
              {parsedStats && (
                <div>
                  <p className="text-xs font-semibold text-(--muted-foreground) mb-2 uppercase tracking-wide">Element Counts</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(parsedStats).filter(([,v]) => v > 0).map(([k, v]) => (
                      <span key={k} className="rounded-full bg-sky-100 text-sky-700 px-3 py-1 text-xs font-medium">
                        {k.charAt(0).toUpperCase() + k.slice(1)}: {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
