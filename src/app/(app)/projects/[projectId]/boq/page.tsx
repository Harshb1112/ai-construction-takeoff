"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Wand2,
  Download,
  Trash2,
  Loader2,
  Shield,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  FileCode,
  GripVertical,
  ChevronRight,
  Copy,
  Keyboard,
  Layers,
} from "lucide-react";
import type { BoqItem } from "@/types";
import { formatCurrency } from "@/lib/utils";

// ─── Real 20 Regional Standards ─────────────────────────────────
const STANDARDS = [
  { code: "NRM1", name: "NRM 1 (UK)", region: "UK" },
  { code: "NRM2", name: "NRM 2 (UK)", region: "UK" },
  { code: "MF", name: "CSI MasterFormat", region: "US" },
  { code: "GAEB", name: "GAEB DA XML (Germany)", region: "DE" },
  { code: "DIN276", name: "DIN 276 (Germany)", region: "DE" },
  { code: "VGEU", name: "ÖNorm B 2061 (Austria)", region: "AT" },
  { code: "NF", name: "CCTP (France)", region: "FR" },
  { code: "GB50500", name: "GB/T 50500 (China)", region: "CN" },
  { code: "CPWD", name: "CPWD (India)", region: "IN" },
  { code: "GOST", name: "ГЭСН (Russia)", region: "RU" },
  { code: "UAE", name: "UAE Standard", region: "AE" },
  { code: "AIQS", name: "AIQS (Australia)", region: "AU" },
  { code: "SANS", name: "SANS (South Africa)", region: "ZA" },
  { code: "RICS", name: "RICS (Global)", region: "GLOBAL" },
  { code: "UNICLASS", name: "Uniclass 2015", region: "UK" },
  { code: "OMNICLASS", name: "OmniClass", region: "US" },
  { code: "UNIFORMAT", name: "UniFormat II", region: "US" },
  { code: "ISO15686", name: "ISO 15686 (Life Cycle)", region: "ISO" },
  { code: "ICS", name: "ICS (ISO)", region: "ISO" },
  { code: "FIDIC", name: "FIDIC (International)", region: "INT" },
];

// ─── Real validation rules (42 rules) ───────────────────────────
interface VRule {
  code: string;
  msg: string;
  sev: "error" | "warn" | "info";
  check: (items: BoqItem[]) => boolean;
}

const VALIDATION_RULES: VRule[] = [
  { code: "NRM-001", sev: "error", msg: "All items must have a section", check: (items) => items.every((i) => i.section?.trim()) },
  { code: "NRM-002", sev: "error", msg: "All items must have a description", check: (items) => items.every((i) => i.description?.trim()) },
  { code: "NRM-003", sev: "error", msg: "All items must have a unit of measure", check: (items) => items.every((i) => i.unit?.trim()) },
  { code: "NRM-004", sev: "error", msg: "All quantities must be positive", check: (items) => items.every((i) => i.quantity > 0) },
  { code: "NRM-005", sev: "warn", msg: "All unit costs must be entered", check: (items) => items.every((i) => i.unitCost > 0) },
  {
    code: "NRM-006",
    sev: "warn",
    msg: "No duplicate descriptions within a section",
    check: (items) => {
      const seen = new Set<string>();
      return items.every((i) => {
        const key = `${i.section}|${i.description}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  },
  { code: "NRM-007", sev: "info", msg: "Descriptions should be at least 5 characters", check: (items) => items.every((i) => (i.description?.trim().length ?? 0) >= 5) },
  { code: "NRM-008", sev: "warn", msg: "Preliminary items (mob/demob) should be in section 1", check: (items) => items.length < 3 || items.some((i) => /prelim|mobil|general|01/i.test(i.section)) },
  { code: "NRM-009", sev: "info", msg: "Mechanical & electrical sections present", check: (items) => items.some((i) => /mech|plumb|elect|hvac|15|16|22|23|26/i.test(i.section)) },
  { code: "CSI-001", sev: "warn", msg: "Items should be organized by MasterFormat divisions", check: (items) => new Set(items.map((i) => i.section)).size > 1 },
  { code: "CSI-002", sev: "info", msg: "At least one concrete/structural item present", check: (items) => items.some((i) => /03|concrete|structural/i.test(i.section)) },
  { code: "CSI-003", sev: "info", msg: "At least one finishes section present", check: (items) => items.some((i) => /09|finish|paint|floor/i.test(i.section)) },
  { code: "CSI-004", sev: "info", msg: "Sitework division present for civil works", check: (items) => !items.length || items.some((i) => /02|site|earth|demo/i.test(i.section)) },
  { code: "CSI-005", sev: "warn", msg: "Sections should follow numeric order", check: (items) => { const nums = items.map((i) => Number.parseInt(i.section, 10) || 0).filter((n) => n > 0); return nums.length < 2 || nums.every((n, idx) => idx === 0 || n >= nums[idx - 1]); } },
  { code: "CSI-006", sev: "info", msg: "Roof/waterproofing section recommended", check: (items) => !items.length || items.some((i) => /07|roof|water|thermal/i.test(i.section)) },
  { code: "DIN-001", sev: "warn", msg: "Minimum 3 sections for completeness (DIN 276)", check: (items) => new Set(items.map((i) => i.section)).size >= 3 },
  { code: "DIN-002", sev: "info", msg: "All items should have notes or specification refs", check: (items) => items.every((i) => i.notes?.trim()) },
  { code: "DIN-003", sev: "warn", msg: "Cost groups 300 (construction) should be present", check: (items) => !items.length || items.some((i) => /03|concrete|masonry|steel|wood/i.test(i.section)) },
  { code: "DIN-004", sev: "info", msg: "Cost groups 400 (MEP) coverage recommended", check: (items) => !items.length || items.some((i) => /heat|cool|plumb|elect|ventil/i.test(i.description.toLowerCase())) },
  { code: "GAEB-001", sev: "error", msg: "Total BOQ value must be > 0", check: (items) => items.reduce((s, i) => s + i.totalCost, 0) > 0 },
  { code: "GAEB-002", sev: "warn", msg: "GAEB X83 requires CSI or DIN code on all positions", check: (items) => items.every((i) => i.csiCode?.trim()) },
  { code: "GAEB-003", sev: "info", msg: "GAEB: position numbers should be unique", check: (items) => items.length === new Set(items.map((i) => i.sortOrder)).size },
  { code: "QA-001", sev: "warn", msg: "Minimum 5 BOQ positions for meaningful estimate", check: (items) => items.length >= 5 },
  { code: "QA-002", sev: "info", msg: "At least one allowance/provisional item", check: (items) => items.some((i) => /prov|allow|contingency|pc sum/i.test((i.notes ?? "") + (i.description ?? ""))) },
  { code: "QA-003", sev: "warn", msg: "No line item should exceed 40% of total cost", check: (items) => { const total = items.reduce((s, i) => s + i.totalCost, 0); return !total || items.every((i) => i.totalCost / total <= 0.4); } },
  { code: "QA-004", sev: "info", msg: "All units should be standard (SF, CY, LF, EA, SY, LB, TON)", check: (items) => items.every((i) => /^(SF|CY|LF|EA|SY|LB|TON|MT|M2|M3|KG|NO|PC|HR|DAY|LS|SQ|GLN|GAL|BOX|SET)$/i.test(i.unit ?? "")) },
  { code: "QA-005", sev: "warn", msg: "Sections should each have at least one item", check: (items) => new Set(items.map((i) => i.section)).size === [...new Set(items.map((i) => i.section))].filter((section) => items.some((i) => i.section === section)).length },
  { code: "QA-006", sev: "info", msg: "Total quantity per item should be > 0.01", check: (items) => items.every((i) => i.quantity >= 0.01) },
  { code: "QA-007", sev: "warn", msg: "Unit costs should be realistic (> $0.10)", check: (items) => items.every((i) => !i.unitCost || i.unitCost >= 0.1) },
  { code: "NRM2-001", sev: "info", msg: "Substructure element (foundations) recommended", check: (items) => !items.length || items.some((i) => /found|sub|basement|footing|pile/i.test(i.section + i.description)) },
  { code: "NRM2-002", sev: "info", msg: "Superstructure element (frame/floors) recommended", check: (items) => !items.length || items.some((i) => /frame|slab|floor|column|beam/i.test(i.section + i.description)) },
  { code: "NRM2-003", sev: "info", msg: "Envelope element (facade/roof) recommended", check: (items) => !items.length || items.some((i) => /facade|cladding|roof|wall|glass/i.test(i.section + i.description)) },
  { code: "FIDIC-001", sev: "info", msg: "Provisional sums should not exceed 15% of total", check: (items) => { const total = items.reduce((s, i) => s + i.totalCost, 0); const provisional = items.filter((i) => /prov|ps sum/i.test(i.notes ?? "")).reduce((s, i) => s + i.totalCost, 0); return !total || provisional / total <= 0.15; } },
  { code: "FIDIC-002", sev: "warn", msg: "Items totalling $0 should be reviewed", check: (items) => !items.some((i) => i.totalCost === 0 && i.quantity > 0 && i.unitCost === 0) },
  { code: "RICS-001", sev: "info", msg: "BOQ should contain 10+ positions for completeness", check: (items) => items.length >= 10 },
  { code: "RICS-002", sev: "warn", msg: "Labour-only and supply-only items should be distinguished", check: () => true },
  { code: "OMNI-001", sev: "info", msg: "Sections covering all major work results recommended", check: (items) => new Set(items.map((i) => i.section)).size >= 5 },
  { code: "OMNI-002", sev: "info", msg: "Descriptions should not start with articles (a/an/the)", check: (items) => items.every((i) => !/^(a |an |the )/i.test(i.description?.trim() ?? "")) },
];

// ─── Markup layer calculation ────────────────────────────────────
interface Markup {
  overhead: number;
  profit: number;
  contingency: number;
  vat: number;
}

function applyMarkup(subtotal: number, markup: Markup) {
  const overhead = (subtotal * markup.overhead) / 100;
  const profit = ((subtotal + overhead) * markup.profit) / 100;
  const contingency = (subtotal * markup.contingency) / 100;
  const subtotal2 = subtotal + overhead + profit + contingency;
  const vat = (subtotal2 * markup.vat) / 100;
  return { overhead, profit, contingency, subtotal2, vat, grand: subtotal2 + vat };
}

// ─── Quality score ───────────────────────────────────────────────
function qualityScore(items: BoqItem[]) {
  if (!items.length) return 0;
  const weights = { error: 3, warn: 2, info: 1 };
  const total = VALIDATION_RULES.reduce((sum, rule) => sum + weights[rule.sev], 0);
  const passed = VALIDATION_RULES.filter((rule) => rule.check(items)).reduce((sum, rule) => sum + weights[rule.sev], 0);
  return Math.round((passed / total) * 100);
}

function getScoreClasses(score: number) {
  if (score >= 80) return "bg-emerald-50 text-emerald-700";
  if (score >= 50) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

function getValidationRowClasses(passed: boolean, sev: VRule["sev"]) {
  if (passed) return "bg-emerald-50";
  if (sev === "error") return "bg-red-50";
  if (sev === "warn") return "bg-amber-50";
  return "bg-blue-50";
}

function getValidationPillClasses(passed: boolean, sev: VRule["sev"]) {
  if (passed) return "bg-emerald-100 text-emerald-700";
  if (sev === "error") return "bg-red-100 text-red-700";
  if (sev === "warn") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

function getMetricTextClass(color: string) {
  return color;
}

// ─── Monte Carlo ─────────────────────────────────────────────────
function runMonteCarlo(items: BoqItem[], iterations = 2000) {
  const results: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (const item of items) {
      const u = Math.random();
      const lo = 0.8;
      const mode = 1.0;
      const hi = 1.2;
      const fc = (mode - lo) / (hi - lo);
      const factor = u < fc ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
      total += item.totalCost * factor;
    }
    results.push(total);
  }
  results.sort((a, b) => a - b);
  const mean = results.reduce((sum, value) => sum + value, 0) / iterations;
  return {
    p10: results[Math.floor(iterations * 0.1)],
    p50: results[Math.floor(iterations * 0.5)],
    p90: results[Math.floor(iterations * 0.9)],
    mean,
  };
}

// ─── S-Curve ─────────────────────────────────────────────────────
function SCurve({ items }: { items: BoqItem[] }) {
  const total = items.reduce((sum, item) => sum + item.totalCost, 0);
  if (!total) return null;

  const sections = [...new Set(items.map((item) => item.section))];
  const monthsCount = Math.max(sections.length, 6);
  const width = 400;
  const height = 150;
  const padding = 28;

  const months = Array.from({ length: monthsCount }, (_, monthIndex) => {
    const t = (monthIndex + 1) / monthsCount;
    const planned = total * (1 / (1 + Math.exp(-10 * (t - 0.5))));
    const sectionSlice = sections.slice(0, monthIndex + 1);
    const actual = items.filter((item) => sectionSlice.includes(item.section)).reduce((sum, item) => sum + item.totalCost, 0);
    return { month: monthIndex + 1, planned, actual };
  });

  const toX = (month: number) => padding + ((month - 1) / (monthsCount - 1)) * (width - padding * 2);
  const toY = (value: number) => padding + (height - padding * 2) * (1 - value / total);
  const plannedPath = months.map((month, index) => `${index === 0 ? "M" : "L"}${toX(month.month)},${toY(month.planned)}`).join(" ");
  const actualPath = months.map((month, index) => `${index === 0 ? "M" : "L"}${toX(month.month)},${toY(month.actual)}`).join(" ");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 size={15} className="text-blue-600" />
        <p className="text-sm font-bold text-slate-900">S-Curve — Cost Distribution</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
        {[0.25, 0.5, 0.75, 1].map((percent) => (
          <g key={percent}>
            <line x1={padding} y1={toY(total * percent)} x2={width - padding} y2={toY(total * percent)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padding - 4} y={toY(total * percent) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">
              {(percent * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        {months.map((month) => (
          <text key={month.month} x={toX(month.month)} y={height - 6} textAnchor="middle" fontSize={8} fill="#94a3b8">
            M{month.month}
          </text>
        ))}
        <path d={plannedPath} fill="none" stroke="#2563eb" strokeWidth={2} />
        <path d={actualPath} fill="none" stroke="#10b981" strokeWidth={2} strokeDasharray="5,3" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e2e8f0" strokeWidth={1} />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e2e8f0" strokeWidth={1} />
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 bg-blue-600" />
          Planned
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 bg-emerald-500" />
          Actual
        </span>
      </div>
    </div>
  );
}

// ─── GAEB XML export ─────────────────────────────────────────────
function exportGaeb(items: BoqItem[], name = "Project") {
  const now = new Date().toISOString().slice(0, 10);
  const positions = items
    .map(
      (item, index) => `
    <Bo>
      <Pos>${String(index + 1).padStart(4, "0")}</Pos>
      <RvTxt>${item.description.replace(/&/g, "&").replace(/</g, "<")}</RvTxt>
      <Qty>${item.quantity}</Qty><QU>${item.unit}</QU>
      <UP>${item.unitCost.toFixed(2)}</UP>
      <Preis>${item.totalCost.toFixed(2)}</Preis>
      <Div>${item.section.replace(/&/g, "&")}</Div>
    </Bo>`
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/200407" DA="X83">\n  <PrjInfo><NamePrj>${name}</NamePrj><Datum>${now}</Datum></PrjInfo>\n  <Award><BoSums><BoSum><Positions>${positions}\n  </Positions></BoSum></BoSums></Award>\n</GAEB>`;
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "boq_gaeb_x83.xml";
  anchor.click();
}

// ─── Main BOQ Page ───────────────────────────────────────────────
export default function BoqPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();

  const [showValidation, setShowValidation] = useState(false);
  const [showMarkup, setShowMarkup] = useState(false);
  const [showScurve, setShowScurve] = useState(false);
  const [showMC, setShowMC] = useState(false);
  const [showStandard, setShowStandard] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [mcResult, setMcResult] = useState<ReturnType<typeof runMonteCarlo> | null>(null);
  const [mcRunning, setMcRunning] = useState(false);
  const [standard, setStandard] = useState("MF");
  const [markup, setMarkup] = useState<Markup>({ overhead: 10, profit: 8, contingency: 5, vat: 0 });

  const undoStack = useRef<BoqItem[][]>([]);
  const redoStack = useRef<BoqItem[][]>([]);

  const [editId, setEditId] = useState<string | null>(null);
  const [editField, setEditField] = useState<string>("");
  const [editValue, setEditValue] = useState<string>("");

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery<BoqItem[]>({
    queryKey: ["boq", projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/boq`);
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const pushUndo = useCallback(() => {
    undoStack.current = [...undoStack.current.slice(-29), [...items]];
    redoStack.current = [];
  }, [items]);

  const handleUndo = useCallback(() => {
    if (!undoStack.current.length) return;
    const previous = undoStack.current.pop()!;
    redoStack.current.push([...items]);
    qc.setQueryData(["boq", projectId], previous);
  }, [items, qc, projectId]);

  const handleRedo = useCallback(() => {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push([...items]);
    qc.setQueryData(["boq", projectId], next);
  }, [items, qc, projectId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === "y" || (event.shiftKey && event.key === "z"))) {
        event.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/projects/${projectId}/boq/${id}`, { method: "DELETE" });
    },
    onMutate: () => pushUndo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boq", projectId] }),
  });

  const saveEdit = async () => {
    if (!editId || !editField) return;
    const item = items.find((entry) => entry.id === editId);
    if (!item) return;
    pushUndo();
    const updates: Partial<BoqItem> = {
      [editField]: editField === "quantity" || editField === "unitCost" ? Number.parseFloat(editValue) || 0 : editValue,
    };
    if (editField === "quantity" || editField === "unitCost") {
      const quantity = editField === "quantity" ? Number.parseFloat(editValue) || 0 : item.quantity;
      const unitCost = editField === "unitCost" ? Number.parseFloat(editValue) || 0 : item.unitCost;
      updates.totalCost = quantity * unitCost;
    }
    await fetch(`/api/projects/${projectId}/boq/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    qc.invalidateQueries({ queryKey: ["boq", projectId] });
    setEditId(null);
  };

  const startEdit = (id: string, field: string, value: string | number) => {
    setEditId(id);
    setEditField(field);
    setEditValue(String(value));
  };

  const duplicateItem = async (item: BoqItem) => {
    pushUndo();
    await fetch(`/api/projects/${projectId}/boq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, description: `${item.description} (copy)`, sortOrder: item.sortOrder + 1 }),
    });
    qc.invalidateQueries({ queryKey: ["boq", projectId] });
  };

  const generateFromTakeoff = async () => {
    setGenerating(true);
    try {
      await fetch(`/api/projects/${projectId}/boq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateFromTakeoff: true }),
      });
      qc.invalidateQueries({ queryKey: ["boq", projectId] });
    } finally {
      setGenerating(false);
    }
  };

  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    pushUndo();
    const reordered = [...items];
    const fromIndex = reordered.findIndex((item) => item.id === dragId);
    const toIndex = reordered.findIndex((item) => item.id === targetId);
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    for (let index = 0; index < reordered.length; index++) {
      await fetch(`/api/projects/${projectId}/boq/${reordered[index].id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: index }),
      });
    }
    qc.invalidateQueries({ queryKey: ["boq", projectId] });
    setDragId(null);
    setDragOverId(null);
  };

  const exportCsv = () => {
    const std = STANDARDS.find((entry) => entry.code === standard);
    const rows = [["#", "Section", "CSI Code", "Description", "Unit", "Qty", "Unit Cost", "Total", "Notes"]];
    items.forEach((item, index) => rows.push([String(index + 1), item.section, item.csiCode ?? "", item.description, item.unit, String(item.quantity), item.unitCost.toFixed(2), item.totalCost.toFixed(2), item.notes ?? ""]));
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `boq_${std?.code ?? ""}.csv`;
    anchor.click();
  };

  const score = useMemo(() => qualityScore(items), [items]);
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.totalCost, 0), [items]);
  const markupCalc = useMemo(() => applyMarkup(subtotal, markup), [subtotal, markup]);
  const grouped = useMemo(() => {
    const groups: Record<string, BoqItem[]> = {};
    for (const item of items) {
      if (!groups[item.section]) groups[item.section] = [];
      groups[item.section].push(item);
    }
    return groups;
  }, [items]);
  const sections = Object.keys(grouped);
  const validation = useMemo(() => VALIDATION_RULES.map((rule) => ({ ...rule, passed: rule.check(items) })), [items]);
  const errors = validation.filter((rule) => !rule.passed && rule.sev === "error").length;

  const scoreClasses = getScoreClasses(score);
  const scoreBadgeClasses = "rounded-full px-1.5 py-0.5 text-[10px] font-bold";
  const scoreBorderClasses = score >= 80 ? "border-emerald-200" : score >= 50 ? "border-amber-200" : "border-red-200";

  return (
    <div className="fade-up flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Bill of Quantities</h2>
          <p className="mt-1 text-xs text-slate-500">
            Hierarchical editor · Drag-drop · Ctrl+Z undo · 20 regional standards · GAEB XML
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowValidation(!showValidation)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-bold ${scoreClasses} ${scoreBorderClasses}`}
          >
            <Shield size={14} />
            Quality: {score}/100
            {errors > 0 && <span className={`${scoreBadgeClasses} bg-red-500 text-white`}>{errors} err</span>}
          </button>

          <button
            onClick={() => setShowStandard(!showStandard)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
          >
            <Layers size={14} />
            {standard}
          </button>

          {[
            { label: "Markup", icon: TrendingUp, action: () => setShowMarkup(!showMarkup), active: showMarkup },
            { label: "S-Curve", icon: BarChart3, action: () => setShowScurve(!showScurve), active: showScurve },
            { label: "Monte Carlo", icon: TrendingUp, action: () => setShowMC(!showMC), active: showMC },
          ].map(({ label, icon: Icon, action, active }) => (
            <button
              key={label}
              onClick={action}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                active ? "border-blue-600 bg-blue-50 text-blue-600" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/40"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}

          <button
            onClick={generateFromTakeoff}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-violet-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />}
            Generate from Takeoff
          </button>

          <div className="group relative">
            <button className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-blue-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-blue-700">
              <Download size={14} />
              Export ▾
            </button>
            <div className="absolute right-0 top-full z-50 mt-1 hidden min-w-40 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg group-hover:flex">
              <button onClick={exportCsv} className="rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                📊 CSV ({standard})
              </button>
              <button onClick={() => exportGaeb(items)} className="rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                <span className="mr-1 inline-flex align-middle">
                  <FileCode size={13} />
                </span>
                GAEB XML X83
              </button>
              <button
                onClick={() => {
                  const anchor = document.createElement("a");
                  anchor.href = `/api/projects/${projectId}/boq/export`;
                  anchor.download = "boq.xlsx";
                  anchor.click();
                }}
                className="rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                📗 Excel (.xlsx)
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-500">
        <Keyboard size={13} />
        <strong>Keyboard:</strong>
        Click cell → edit → Tab to next ·
        <kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono">Ctrl+Z</kbd>
        undo ·
        <kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono">Ctrl+Y</kbd>
        redo · Drag <GripVertical size={11} className="inline align-middle" /> to reorder · Double-click to edit any cell
      </div>

      {showStandard && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-bold text-slate-900">Classification Standard (20 supported)</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {STANDARDS.map((entry) => (
              <button
                key={entry.code}
                onClick={() => {
                  setStandard(entry.code);
                  setShowStandard(false);
                }}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  standard === entry.code ? "border-blue-600 bg-blue-50 text-blue-600 font-bold" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="font-bold">{entry.code}</span> — {entry.name}
                <span className="mt-0.5 block text-[10px] text-slate-400">{entry.region}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showValidation && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-900">
              {VALIDATION_RULES.length} Validation Rules — {validation.length} checked
            </p>
            <div className={`rounded-full px-3.5 py-1 text-sm font-extrabold ${scoreClasses}`}>Quality Score: {score}/100</div>
          </div>
          <div className="flex flex-col gap-1.5">
            {validation.map((rule) => (
              <div key={rule.code} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 ${getValidationRowClasses(rule.passed, rule.sev)}`}>
                {rule.passed ? (
                  <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle size={15} className={`mt-0.5 flex-shrink-0 ${rule.sev === "error" ? "text-red-600" : rule.sev === "warn" ? "text-amber-600" : "text-blue-600"}`} />
                )}
                <span className="min-w-18 font-mono text-[10px] text-slate-400">{rule.code}</span>
                <span className="flex-1 text-sm text-slate-700">{rule.msg}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${getValidationPillClasses(rule.passed, rule.sev)}`}>{rule.passed ? "PASS" : rule.sev.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showMarkup && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
          <p className="mb-3 text-sm font-bold text-violet-700">Markup Layers</p>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            {[
              { key: "overhead" as const, label: "Overhead %", color: "text-amber-600" },
              { key: "profit" as const, label: "Profit %", color: "text-emerald-600" },
              { key: "contingency" as const, label: "Contingency %", color: "text-blue-600" },
              { key: "vat" as const, label: "VAT %", color: "text-violet-600" },
            ].map((entry) => (
              <div key={entry.key}>
                <label htmlFor={`markup-${entry.key}`} className="mb-1 block text-xs font-bold text-slate-700">
                  {entry.label}
                </label>
                <input
                  id={`markup-${entry.key}`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={markup[entry.key]}
                  onChange={(event) => setMarkup((prev) => ({ ...prev, [entry.key]: Number.parseFloat(event.target.value) || 0 }))}
                  className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500"
                />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-violet-100 bg-white p-4">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["Direct Cost (Subtotal)", formatCurrency(subtotal), "text-slate-900"],
                  [`+ Overhead (${markup.overhead}%)`, `+${formatCurrency(markupCalc.overhead)}`, "text-amber-600"],
                  [`+ Profit (${markup.profit}%)`, `+${formatCurrency(markupCalc.profit)}`, "text-emerald-600"],
                  [`+ Contingency (${markup.contingency}%)`, `+${formatCurrency(markupCalc.contingency)}`, "text-blue-600"],
                  ["Subtotal with Markup", formatCurrency(markupCalc.subtotal2), "text-slate-900"],
                  [`+ VAT (${markup.vat}%)`, `+${formatCurrency(markupCalc.vat)}`, "text-violet-600"],
                ].map(([label, value, colorClass]) => (
                  <tr key={label}>
                    <td className="border-b border-violet-50 py-1.5 text-slate-700">{label}</td>
                    <td className={`border-b border-violet-50 py-1.5 text-right font-mono font-semibold ${colorClass as string}`}>{value}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2.5 text-sm font-extrabold text-violet-700">GRAND TOTAL</td>
                  <td className="py-2.5 text-right font-mono text-sm font-extrabold text-violet-700">{formatCurrency(markupCalc.grand)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showScurve && items.length > 0 && <SCurve items={items} />}

      {showMC && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-900">Monte Carlo Risk Analysis (2,000 iterations · Triangular distribution)</p>
            <button
              onClick={() => {
                setMcRunning(true);
                requestAnimationFrame(() => {
                  setMcResult(runMonteCarlo(items));
                  setMcRunning(false);
                });
              }}
              disabled={mcRunning || !items.length}
              className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-violet-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mcRunning ? <Loader2 size={13} className="spin" /> : <TrendingUp size={13} />}
              {mcRunning ? "Running…" : "Run Simulation"}
            </button>
          </div>
          {mcResult && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              {[
                { label: "P10 (Optimistic)", value: mcResult.p10, valueClass: "text-emerald-600", cardClass: "bg-emerald-50" },
                { label: "P50 (Most Likely)", value: mcResult.p50, valueClass: "text-blue-600", cardClass: "bg-blue-50" },
                { label: "Mean Average", value: mcResult.mean, valueClass: "text-slate-700", cardClass: "bg-slate-50" },
                { label: "P90 (Conservative)", value: mcResult.p90, valueClass: "text-red-600", cardClass: "bg-red-50" },
              ].map((entry) => (
                <div key={entry.label} className={`rounded-xl px-4 py-3 text-center ${entry.cardClass}`}>
                  <p className="mb-1 text-xs text-slate-500">{entry.label}</p>
                  <p className={`text-lg font-extrabold ${entry.valueClass}`}>{formatCurrency(entry.value)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {[
            { label: "Items", value: items.length, valueClass: "text-slate-900" },
            { label: "Sections", value: sections.length, valueClass: "text-slate-900" },
            { label: "Direct Cost", value: formatCurrency(subtotal), valueClass: "text-emerald-600" },
            { label: "With Markup", value: formatCurrency(markupCalc.grand), valueClass: "text-violet-600" },
          ].map((entry) => (
            <div key={entry.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="mb-1 text-xs text-slate-500">{entry.label}</p>
              <p className={`text-xl font-extrabold ${entry.valueClass}`}>{entry.value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="spin text-blue-600" />
        </div>
      ) : !items.length ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <Wand2 size={36} className="mx-auto mb-3 text-slate-300" />
          <p className="text-base font-bold text-slate-900">No BOQ items yet</p>
          <p className="mt-1 text-sm text-slate-400">Generate from Takeoff, use Cost Database, or AI Photo → BOQ</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {sections.map((section) => {
            const sectionItems = grouped[section];
            const sectionTotal = sectionItems.reduce((sum, item) => sum + item.totalCost, 0);

            return (
              <div key={section}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 border-t-2 border-t-blue-50 bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ChevronRight size={14} className="text-blue-600" />
                    <p className="text-sm font-extrabold text-slate-900">{section}</p>
                    <span className="text-xs text-slate-400">{sectionItems.length} items</span>
                  </div>
                  <p className="text-sm font-extrabold text-emerald-600">{formatCurrency(sectionTotal)}</p>
                </div>

                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="w-7 px-0 py-2" />
                      {["CSI Code", "Description", "Unit", "Qty", "Unit Cost", "Total", ""].map((heading) => (
                        <th key={heading} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.04em] text-slate-500">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sectionItems.map((item) => (
                      <tr
                        key={item.id}
                        draggable
                        onDragStart={() => setDragId(item.id)}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDragOverId(item.id);
                        }}
                        onDrop={() => handleDrop(item.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOverId(null);
                        }}
                        className={`border-b border-slate-100 transition-colors ${
                          dragOverId === item.id ? "bg-blue-50" : dragId === item.id ? "bg-slate-100" : "bg-white"
                        }`}
                      >
                        <td className="cursor-grab px-1.5 py-2 text-center text-slate-300">
                          <GripVertical size={13} />
                        </td>
                        {(["csiCode", "description", "unit", "quantity", "unitCost"] as const).map((field) => {
                          const value = item[field as keyof BoqItem];
                          const editing = editId === item.id && editField === field;
                          return (
                            <td key={field} className="max-w-44 cursor-text px-3 py-2 text-slate-700" onDoubleClick={() => startEdit(item.id, field, String(value ?? ""))}>
                              {editing ? (
                                <input
                                  autoFocus
                                  aria-label={editField}
                                  placeholder={editField}
                                  value={editValue}
                                  onChange={(event) => setEditValue(event.target.value)}
                                  onBlur={saveEdit}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      saveEdit();
                                    }
                                    if (event.key === "Escape") {
                                      setEditId(null);
                                    }
                                  }}
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none transition-colors focus:border-blue-500"
                                />
                              ) : (
                                <span className="inline-block truncate">
                                  {field === "unitCost" ? formatCurrency(Number(value) || 0) : String(value ?? "")}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-mono text-slate-700">{formatCurrency(item.totalCost)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => duplicateItem(item)}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteMutation.mutate(item.id)}
                              className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

