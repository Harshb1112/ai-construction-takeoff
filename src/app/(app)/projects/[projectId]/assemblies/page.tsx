"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Plus, Layers, Trash2, Calculator, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { MATERIAL_RATES } from "@/lib/material-rates";
import { formatCurrency } from "@/lib/utils";

interface AssemblyParameter { name: string; label: string; unit: string; defaultValue: number; value: number }
interface AssemblyComponent { materialKey: string; description: string; quantity: number; unit: string; unitCost: number; quantityExpr?: string }
interface Assembly { id: string; name: string; category: string; description?: string; parameters: AssemblyParameter[]; components: AssemblyComponent[] }

// Helper: pull unitCost from MATERIAL_RATES — never hardcode prices
const mr = (key: string) => MATERIAL_RATES[key]?.avgUnitCost ?? 0;

// Default templates seeded into DB on first visit
const DEFAULT_TEMPLATES: Omit<Assembly, "id">[] = [
  {
    name: "Wood Stud Wall Framing", category: "Lumber",
    description: "Complete wall framing with studs, plates, and headers",
    parameters: [
      { name:"wallLength", label:"Wall Length",   unit:"ft", defaultValue:20, value:20 },
      { name:"wallHeight", label:"Wall Height",   unit:"ft", defaultValue:9,  value:9  },
      { name:"studSpacing",label:"Stud Spacing",  unit:"in", defaultValue:16, value:16 },
    ],
    components: [
      { materialKey:"studs_16oc",    description:"2×4 Studs",          quantity:0, unit:"EA", unitCost:mr("studs_16oc"),    quantityExpr:'Math.ceil(wallLength / (studSpacing/12)) + 2' },
      { materialKey:"top_plates",    description:"Double Top Plates",   quantity:0, unit:"LF", unitCost:mr("top_plates"),    quantityExpr:'wallLength * 2' },
      { materialKey:"bottom_plates", description:"Bottom Plate",        quantity:0, unit:"LF", unitCost:mr("bottom_plates"), quantityExpr:'wallLength' },
    ],
  },
  {
    name: "Concrete Slab on Grade", category: "Concrete",
    description: "4-inch concrete slab with rebar and vapor barrier",
    parameters: [
      { name:"slabArea",  label:"Slab Area",  unit:"sf", defaultValue:500, value:500 },
      { name:"thickness", label:"Thickness",  unit:"in", defaultValue:4,   value:4   },
    ],
    components: [
      { materialKey:"concrete_slab", description:"Concrete (ready-mix)", quantity:0, unit:"CY", unitCost:mr("concrete_slab"), quantityExpr:'slabArea * (thickness/12) / 27' },
    ],
  },
  {
    name: "Exterior Wall System (Complete)", category: "Composite",
    description: "Full exterior wall: framing, sheathing, insulation, drywall",
    parameters: [
      { name:"wallSF", label:"Wall Area", unit:"sf", defaultValue:200, value:200 },
    ],
    components: [
      { materialKey:"studs_16oc",   description:"2×4 Studs",           quantity:0, unit:"EA", unitCost:mr("studs_16oc"),    quantityExpr:'Math.ceil(wallSF / 9)' },
      { materialKey:"batt_r13",     description:"Batt Insulation R-13", quantity:0, unit:"SF", unitCost:mr("batt_r13"),      quantityExpr:'wallSF * 1.05' },
      { materialKey:"drywall_walls",description:"Drywall Interior",     quantity:0, unit:"SF", unitCost:mr("drywall_walls"), quantityExpr:'wallSF * 1.1'  },
      { materialKey:"sheathing",    description:"OSB Sheathing",        quantity:0, unit:"SF", unitCost:mr("sheathing"),     quantityExpr:'wallSF * 1.05' },
    ],
  },
];

function evalExpr(expr: string, params: Record<string, number>): number {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(params), `return ${expr}`);
    return Math.max(0, Math.round(fn(...Object.values(params)) * 100) / 100);
  } catch { return 0; }
}

function computeAssembly(a: Assembly) {
  const paramValues: Record<string, number> = {};
  for (const p of a.parameters) paramValues[p.name] = p.value;
  let grandTotal = 0;
  const components = a.components.map(c => {
    const computed = c.quantityExpr ? evalExpr(c.quantityExpr, paramValues) : c.quantity;
    const total    = computed * c.unitCost;
    grandTotal += total;
    return { ...c, computed, total };
  });
  return { components, grandTotal };
}

export default function AssembliesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [importing, setImporting]   = useState<string|null>(null);
  const [imported, setImported]     = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/projects/${projectId}/assemblies`);
    if (r.ok) {
      let list: Assembly[] = await r.json();
      // Seed defaults on first visit
      if (list.length === 0) {
        const created: Assembly[] = [];
        for (const t of DEFAULT_TEMPLATES) {
          const cr = await fetch(`/api/projects/${projectId}/assemblies`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(t),
          });
          if (cr.ok) created.push(await cr.json());
        }
        list = created;
      }
      setAssemblies(list.map(a => ({
        ...a,
        parameters: Array.isArray(a.parameters) ? a.parameters : [],
        components:  Array.isArray(a.components)  ? a.components  : [],
      })));
      if (list.length > 0) setExpanded(new Set([list[0].id]));
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const updateParam = async (assemblyId: string, paramName: string, value: number) => {
    setAssemblies(prev => prev.map(a => a.id !== assemblyId ? a : {
      ...a, parameters: a.parameters.map(p => p.name === paramName ? { ...p, value } : p),
    }));
    // Debounce save — save the updated assembly
    const updated = assemblies.find(a => a.id === assemblyId);
    if (!updated) return;
    const newParams = updated.parameters.map(p => p.name === paramName ? { ...p, value } : p);
    await fetch(`/api/projects/${projectId}/assemblies`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: assemblyId, parameters: newParams }),
    });
  };

  const deleteAssembly = async (id: string) => {
    setAssemblies(prev => prev.filter(a => a.id !== id));
    await fetch(`/api/projects/${projectId}/assemblies`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const importToTakeoff = async (assembly: Assembly) => {
    setImporting(assembly.id);
    const { components } = computeAssembly(assembly);
    try {
      for (const c of components) {
        await fetch(`/api/projects/${projectId}/takeoff`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "MANUAL", category: assembly.category,
            description: `[${assembly.name}] ${c.description}`,
            quantity: c.computed, unit: c.unit, unitCost: c.unitCost, totalCost: c.total,
            notes: `From assembly: ${assembly.name}`,
          }),
        });
      }
      setImported(prev => new Set([...prev, assembly.id]));
    } finally { setImporting(null); }
  };

  const toggleExpand = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, gap:10, color:"#64748b" }}>
      <Loader2 size={20} className="animate-spin"/>Loading assemblies…
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-(--foreground)">Parameterized Assemblies</h2>
        <p className="text-sm text-(--muted-foreground)">
          Assembly templates with dynamic quantity calculations. Adjust parameters — quantities recompute instantly. Import to Takeoff.
        </p>
      </div>

      <div className="space-y-4">
        {assemblies.map(assembly => {
          const { components, grandTotal } = computeAssembly(assembly);
          const isExpanded = expanded.has(assembly.id);
          return (
            <div key={assembly.id} className="rounded-xl border border-(--border) bg-(--card) overflow-hidden">
              <button className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-(--secondary) transition-colors" onClick={()=>toggleExpand(assembly.id)}>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100">
                  <Layers className="h-5 w-5 text-sky-500"/>
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-(--foreground)">{assembly.name}</p>
                  <p className="text-xs text-(--muted-foreground)">{assembly.description} · {components.length} components · {formatCurrency(grandTotal)}</p>
                </div>
                <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-600">{assembly.category}</span>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-(--muted-foreground)"/> : <ChevronDown className="h-4 w-4 text-(--muted-foreground)"/>}
              </button>

              {isExpanded && (
                <div className="border-t border-(--border) p-5 space-y-5">
                  {/* Parameters */}
                  <div>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">Parameters</p>
                    <div className="flex flex-wrap gap-4">
                      {assembly.parameters.map(param => (
                        <div key={param.name} className="flex-1 min-w-32">
                          <label className="mb-1 block text-xs font-medium text-(--foreground)">{param.label} ({param.unit})</label>
                          <input type="number" value={param.value}
                            onChange={e=>updateParam(assembly.id, param.name, parseFloat(e.target.value)||0)}
                            className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-1.5 text-sm outline-none focus:border-sky-400"/>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Components table */}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">Computed Quantities</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-(--border)">
                          {["Material","Qty","Unit","Unit Cost","Total","Formula"].map(h=>(
                            <th key={h} className="py-2 text-left text-xs font-semibold text-(--muted-foreground)">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-(--border)">
                        {components.map((c,i) => (
                          <tr key={i} className="hover:bg-(--muted)">
                            <td className="py-2 text-(--foreground)">{c.description}</td>
                            <td className="py-2 font-mono font-semibold text-sky-600">{c.computed}</td>
                            <td className="py-2 text-(--muted-foreground)">{c.unit}</td>
                            <td className="py-2 font-mono">${c.unitCost.toFixed(2)}</td>
                            <td className="py-2 font-mono text-emerald-600">{formatCurrency(c.total)}</td>
                            <td className="py-2 text-xs font-mono text-(--muted-foreground) truncate max-w-32">{c.quantityExpr}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-(--border)">
                          <td colSpan={4} className="py-2 text-right font-semibold text-(--foreground)">Assembly Total</td>
                          <td className="py-2 font-bold text-emerald-600">{formatCurrency(grandTotal)}</td>
                          <td/>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={()=>importToTakeoff(assembly)} disabled={!!importing||imported.has(assembly.id)}
                      className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors">
                      <Calculator className="h-4 w-4"/>
                      {imported.has(assembly.id) ? "Imported to Takeoff ✓" : importing===assembly.id ? "Importing…" : "Import to Takeoff"}
                    </button>
                    <button onClick={()=>deleteAssembly(assembly.id)}
                      className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors">
                      <Trash2 className="h-4 w-4"/>Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
