"use client";

/**
 * RvtConverter — APS-free, Three.js native
 *
 * • IFC files  → loaded directly in IfcViewer (Three.js + web-ifc, 100% free)
 * • RVT files  → cannot be parsed without Autodesk tools; shows export guide
 */

import dynamic from "next/dynamic";
import { FileText, Info } from "lucide-react";

const IfcViewer = dynamic(() => import("@/components/viewers/IfcViewer"), { ssr: false });

interface IfcElement { id: number; type: string; name: string; color: number }
interface ElementStats { walls: number; slabs: number; columns: number; doors: number; windows: number }

interface Props {
  fileUrl:   string;
  fileName:  string;
  onElementsParsed?: (elements: IfcElement[], stats: ElementStats) => void;
}

export default function RvtConverter({ fileUrl, fileName, onElementsParsed }: Props) {
  const ext = fileName.split(".").pop()?.toLowerCase();

  // ── IFC: load directly in Three.js viewer ────────────────────────────────
  if (ext === "ifc") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-xs text-emerald-400">
          <FileText className="h-4 w-4 flex-shrink-0" />
          IFC file — rendering with Three.js (web-ifc engine, 100% local)
        </div>
        <IfcViewer fileUrl={fileUrl} onElementsParsed={onElementsParsed} />
      </div>
    );
  }

  // ── RVT / other Revit formats: show export guide ─────────────────────────
  return (
    <div className="flex flex-col items-center gap-6 rounded-xl bg-[#0f172a] border border-slate-800 px-8 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10">
        <Info className="h-7 w-7 text-sky-400" />
      </div>

      <div>
        <p className="text-lg font-bold text-white">Export IFC from Revit</p>
        <p className="mt-1 text-sm text-slate-400 max-w-md">
          <span className="font-mono text-amber-400">.{ext}</span> files cannot be opened directly —
          Revit&apos;s format is proprietary. Export as IFC and upload that instead.
        </p>
      </div>

      {/* Steps */}
      <div className="w-full max-w-lg space-y-2 text-left">
        {[
          { n: 1, text: 'Open your model in Revit' },
          { n: 2, text: 'File  →  Export  →  IFC' },
          { n: 3, text: 'Choose IFC 2x3 or IFC 4 format, click Export' },
          { n: 4, text: 'Upload the .ifc file here — it will render instantly in 3D' },
        ].map(({ n, text }) => (
          <div key={n} className="flex items-start gap-3 rounded-xl bg-slate-800/60 border border-slate-700 px-4 py-3 text-sm text-slate-300">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white mt-0.5">{n}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Viewer powered by Three.js + web-ifc — completely free, no API keys needed.
      </p>
    </div>
  );
}
