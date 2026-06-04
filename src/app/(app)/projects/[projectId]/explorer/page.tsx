"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PieChart, BarChart3, CheckCircle2,
  Loader2, Filter, Download, TrendingUp, Layers
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { TakeoffItem, BoqItem } from "@/types";

type GroupBy = "category" | "source" | "unit";

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  MANUAL:      { label: "Manual",        color: "#64748b" },
  AI_CLAUDE:   { label: "Claude AI",     color: "#7c3aed" },
  AI_GROQ:     { label: "Groq AI",       color: "#d97706" },
  AI_OPENAI:   { label: "GPT-4o",        color: "#059669" },
  AI_LMSTUDIO: { label: "LM Studio",     color: "#0891b2" },
  FASTAPI:     { label: "FastAPI",        color: "#2563eb" },
  MARKUP:      { label: "PDF Markup",    color: "#e11d48" },
};

export default function ExplorerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [groupBy, setGroupBy]       = useState<GroupBy>("category");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [pushing, setPushing]       = useState<string | null>(null);
  const [pushed, setPushed]         = useState<Set<string>>(new Set());

  const { data: takeoffItems = [], isLoading } = useQuery<TakeoffItem[]>({
    queryKey: ["takeoff", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/takeoff`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: boqItems = [] } = useQuery<BoqItem[]>({
    queryKey: ["boq", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/boq`);
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  // Filtered items
  const filtered = useMemo(() => sourceFilter === "ALL"
    ? takeoffItems
    : takeoffItems.filter(i => i.source === sourceFilter),
    [takeoffItems, sourceFilter]
  );

  // Pivot grouped data
  const groups = useMemo(() => {
    const map: Record<string, { key: string; items: TakeoffItem[]; totalCost: number; totalQty: number; count: number }> = {};
    for (const item of filtered) {
      const key = groupBy === "category" ? item.category
        : groupBy === "source" ? item.source
        : item.unit;
      if (!map[key]) map[key] = { key, items: [], totalCost: 0, totalQty: 0, count: 0 };
      map[key].items.push(item);
      map[key].totalCost += item.totalCost ?? 0;
      map[key].totalQty += item.quantity;
      map[key].count++;
    }
    return Object.values(map).sort((a, b) => b.totalCost - a.totalCost);
  }, [filtered, groupBy]);

  const grandTotal = groups.reduce((s, g) => s + g.totalCost, 0);

  // Push pivot group to BOQ
  const pushGroupToBoq = async (group: typeof groups[0]) => {
    setPushing(group.key);
    try {
      // Aggregate: one BOQ line per group
      const descriptions = [...new Set(group.items.map(i => i.description))].slice(0, 3).join(" / ");
      await fetch(`/api/projects/${projectId}/boq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: groupBy === "category" ? group.key : "Takeoff Import",
          description: `[${group.key}] ${descriptions}${group.count > 3 ? ` + ${group.count - 3} more` : ""}`,
          unit: groupBy === "unit" ? group.key : "LS",
          quantity: 1,
          unitCost: group.totalCost,
          totalCost: group.totalCost,
          notes: `Imported from Data Explorer · ${group.count} takeoff items · Grouped by ${groupBy}`,
          sortOrder: 0,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["boq", projectId] });
      setPushed(prev => new Set([...prev, group.key]));
    } finally {
      setPushing(null);
    }
  };

  // Export CSV
  const exportCsv = () => {
    const rows = [["Group", "Count", "Total Qty", "Total Cost", "% of Total"]];
    for (const g of groups) {
      rows.push([g.key, String(g.count), g.totalQty.toFixed(2), g.totalCost.toFixed(2), grandTotal ? `${(g.totalCost / grandTotal * 100).toFixed(1)}%` : "0%"]);
    }
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "explorer.csv"; a.click();
  };

  const allSources = [...new Set(takeoffItems.map(i => i.source))];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-(--foreground)">Data Explorer — Pivot → BOQ</h2>
        <p className="text-sm text-(--muted-foreground)">
          Pivot your takeoff data by category, source or unit · visualise costs · push any group directly to BOQ
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-(--border) bg-(--card) p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-(--muted-foreground)" />
          <span className="text-sm font-medium text-(--foreground)">Group by:</span>
          {(["category", "source", "unit"] as GroupBy[]).map(g => (
            <button key={g} onClick={() => setGroupBy(g)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors capitalize ${groupBy === g ? "bg-sky-500 text-white" : "border border-(--border) text-(--muted-foreground) hover:text-(--foreground)"}`}>
              {g}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-(--muted-foreground)" />
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="rounded-lg border border-(--border) bg-(--muted) px-3 py-1.5 text-sm outline-none focus:border-sky-400">
            <option value="ALL">All Sources</option>
            {allSources.map(s => <option key={s} value={s}>{SOURCE_LABELS[s]?.label ?? s}</option>)}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={exportCsv} className="flex items-center gap-2 rounded-lg border border-(--border) px-3 py-2 text-sm hover:bg-(--secondary) transition-colors">
            <Download className="h-4 w-4" />Export CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      {!isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Takeoff Items",  value: takeoffItems.length,       color: "#2563eb" },
            { label: "Groups",         value: groups.length,             color: "#7c3aed" },
            { label: "Total Cost",     value: formatCurrency(grandTotal), color: "#059669" },
            { label: "BOQ Items",      value: boqItems.length,           color: "#d97706" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-(--border) bg-(--card) p-4 text-center">
              <p className="text-xs text-(--muted-foreground)">{label}</p>
              <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-(--border) py-16 text-center">
          <PieChart className="h-12 w-12 text-(--muted-foreground)" />
          <div>
            <p className="font-semibold text-(--foreground)">No takeoff data yet</p>
            <p className="text-sm text-(--muted-foreground)">Run AI Takeoff or use Cost Database to populate data</p>
          </div>
        </div>
      ) : (
        <>
          {/* Bar chart SVG */}
          <div className="rounded-xl border border-(--border) bg-(--card) p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-5 w-5 text-sky-500" />
              <p className="font-semibold text-(--foreground)">Cost by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</p>
              <span className="ml-auto text-xs text-(--muted-foreground)">Total: {formatCurrency(grandTotal)}</span>
            </div>
            <div className="space-y-2">
              {groups.slice(0, 12).map(g => {
                const pct = grandTotal > 0 ? (g.totalCost / grandTotal) * 100 : 0;
                const src = SOURCE_LABELS[g.key];
                const barColor = src?.color ?? "#2563eb";
                return (
                  <div key={g.key} className="flex items-center gap-3">
                    <span className="w-28 text-xs text-(--muted-foreground) text-right truncate flex-shrink-0">{src?.label ?? g.key}</span>
                    <div className="flex-1 h-6 rounded-full bg-(--muted) overflow-hidden relative">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: barColor, opacity: 0.85 }}
                      />
                    </div>
                    <span className="w-20 text-xs font-mono text-right flex-shrink-0" style={{ color: barColor }}>
                      {formatCurrency(g.totalCost)}
                    </span>
                    <span className="w-10 text-xs text-(--muted-foreground) flex-shrink-0">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pivot table */}
          <div className="rounded-xl border border-(--border) bg-(--card) overflow-hidden">
            <div className="flex items-center justify-between border-b border-(--border) bg-(--muted) px-4 py-2.5">
              <p className="text-sm font-semibold text-(--foreground)">{groups.length} groups · {filtered.length} items</p>
              <p className="text-xs text-(--muted-foreground)">Click "Push to BOQ" to create one BOQ line per group</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--border)">
                  {["Group", "Items", "Top Description", "Total Qty", "Total Cost", "% Share", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {groups.map(g => {
                  const pct = grandTotal > 0 ? (g.totalCost / grandTotal * 100).toFixed(1) : "0";
                  const topDesc = g.items[0]?.description ?? "—";
                  const isPushed = pushed.has(g.key);
                  const src = SOURCE_LABELS[g.key];
                  return (
                    <tr key={g.key} className={`hover:bg-(--muted) transition-colors ${isPushed ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {src && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: src.color }} />}
                          <span className="font-semibold text-(--foreground)">{src?.label ?? g.key}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-sky-600">{g.count}</td>
                      <td className="px-4 py-3 text-(--muted-foreground) max-w-xs">
                        <span className="truncate block" title={topDesc}>{topDesc}</span>
                      </td>
                      <td className="px-4 py-3 font-mono">{g.totalQty.toFixed(1)}</td>
                      <td className="px-4 py-3 font-mono font-bold text-emerald-600">{formatCurrency(g.totalCost)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-(--muted) overflow-hidden">
                            <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-(--muted-foreground)">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => pushGroupToBoq(g)}
                          disabled={pushing === g.key || isPushed}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${isPushed ? "bg-emerald-100 text-emerald-700" : "bg-sky-500 text-white hover:bg-sky-600"} disabled:opacity-60`}
                        >
                          {pushing === g.key ? <Loader2 className="h-3 w-3 animate-spin" />
                            : isPushed ? <><CheckCircle2 className="h-3 w-3" />In BOQ</>
                            : <><TrendingUp className="h-3 w-3" />Push to BOQ</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-(--border) bg-(--muted)">
                  <td className="px-4 py-3 font-bold text-(--foreground)">TOTAL</td>
                  <td className="px-4 py-3 font-mono text-sky-600">{filtered.length}</td>
                  <td colSpan={2} />
                  <td className="px-4 py-3 font-bold text-emerald-600">{formatCurrency(grandTotal)}</td>
                  <td className="px-4 py-3 text-xs font-mono text-(--muted-foreground)">100%</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
