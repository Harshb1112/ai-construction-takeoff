"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, FileText, Table, FileSpreadsheet, Loader2 } from "lucide-react";
import type { Project } from "@/types";

export default function ExportPage() {
  const [selectedProject, setSelectedProject] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => { const r = await fetch("/api/projects"); const d = await r.json(); return Array.isArray(d) ? d : []; },
  });

  const doExport = async (type: "csv" | "boq" | "xlsx") => {
    if (!selectedProject) return;
    setExporting(type);
    try {
      if (type === "xlsx") {
        // Real ExcelJS BOQ export
        const a = document.createElement("a");
        a.href = `/api/projects/${selectedProject}/boq/export`;
        a.download = "boq.xlsx";
        a.click();
        return;
      }
      const endpoint = type === "csv" ? "takeoff" : "boq";
      const res = await fetch(`/api/projects/${selectedProject}/${endpoint}`);
      const items = await res.json();
      const isBoq = type === "boq";
      const header = isBoq
        ? "Section,Description,Unit,Qty,Unit Cost,Total\n"
        : "Category,Description,Qty,Unit,Unit Cost,Total,Source\n";
      const rows = items.map((i: Record<string, unknown>) => isBoq
        ? [i.section, i.description, i.unit, i.quantity, i.unitCost, i.totalCost].join(",")
        : [i.category, i.description, i.quantity, i.unit, i.unitCost ?? "", i.totalCost ?? "", i.source].join(",")
      ).join("\n");
      const blob = new Blob([header + rows], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${type}.csv`; a.click();
    } finally {
      setExporting(null);
    }
  };

  const exports = [
    { type: "csv"  as const, label: "Takeoff CSV",  icon: Table,         desc: "All takeoff items — CSV spreadsheet",        color: "text-emerald-500", bg: "bg-emerald-50" },
    { type: "boq"  as const, label: "BOQ CSV",       icon: FileSpreadsheet,desc: "Bill of Quantities by section — CSV",        color: "text-violet-500",  bg: "bg-violet-50"  },
    { type: "xlsx" as const, label: "BOQ Excel",     icon: FileText,      desc: "Professional Excel workbook (.xlsx) with section headers, subtotals & grand total", color: "text-sky-500", bg: "bg-sky-50" },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-(--foreground)">Export</h2>
        <p className="text-sm text-(--muted-foreground)">Export takeoff and BOQ data in various formats.</p>
      </div>

      <div>
        <label htmlFor="export-project-select" className="mb-1 block text-sm font-medium text-(--foreground)">Select Project</label>
        <select
          id="export-project-select"
          aria-label="Select project to export"
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="w-full rounded-lg border border-(--border) bg-(--card) px-3 py-2 text-sm outline-none focus:border-sky-400"
        >
          <option value="">— choose a project —</option>
          {projects.filter(p => p.status === "ACTIVE").map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4">
        {exports.map(({ type, label, icon: Icon, desc, color, bg }) => (
          <button
            key={type}
            onClick={() => doExport(type)}
            disabled={!selectedProject || exporting === type}
            className="flex items-center gap-4 rounded-xl border border-(--border) bg-(--card) p-5 hover:shadow-md transition-shadow disabled:opacity-50 text-left group"
          >
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bg}`}>
              {exporting === type ? <Loader2 className={`h-6 w-6 ${color} animate-spin`} /> : <Icon className={`h-6 w-6 ${color}`} />}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-(--foreground)">{label}</p>
              <p className="text-sm text-(--muted-foreground)">{desc}</p>
            </div>
            <Download className={`h-5 w-5 ${color} opacity-0 group-hover:opacity-100 transition-opacity`} />
          </button>
        ))}
      </div>
    </div>
  );
}
