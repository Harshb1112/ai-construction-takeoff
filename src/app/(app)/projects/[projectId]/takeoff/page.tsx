"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Download, Wand2, Brain, Loader2,
  ChevronDown, ChevronUp, Filter, FileText, CheckCircle2
} from "lucide-react";
import type { TakeoffItem } from "@/types";
import { formatCurrency, bufToBase64, getLmStudioUrl } from "@/lib/utils";
import { setupPdfWorker } from "@/lib/pdf-worker";
import dynamic from "next/dynamic";
const LmStudioModelPicker = dynamic(() => import("@/components/ui/LmStudioModelPicker").then(m => ({ default: m.LmStudioModelPicker })), { ssr: false });


// Convert PDF page to image using PDF.js (browser-side)
async function pdfPageToBase64(fileUrl: string): Promise<{ base64: string; mimeType: string }> {
  setupPdfWorker();
  const pdfjs = await import("pdfjs-dist");

  const pdf = await pdfjs.getDocument(fileUrl).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 }); // 2x = better quality for AI

  const canvas = document.createElement("canvas");
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  // @ts-expect-error — pdfjs RenderParameters type varies by version
  await (page.render as (p: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> })({ canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    base64:   dataUrl.split(",")[1],
    mimeType: "image/jpeg",
  };
}

// Convert any file to base64
async function fileToBase64(fileUrl: string, format: string): Promise<{ base64: string; mimeType: string }> {
  if (format === "PDF") {
    return pdfPageToBase64(fileUrl);
  }
  const res = await fetch(fileUrl);
  const buf = await res.arrayBuffer();
  const mimeType = format === "PNG" ? "image/png" : "image/jpeg";
  const base64   = bufToBase64(buf);
  return { base64, mimeType };
}

// ─── Inline Unit Cost Editor ──────────────────────────────────────
function InlineUnitCost({ item, onSave }: { item: TakeoffItem; onSave: (id: string, uc: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.unitCost ? String(item.unitCost) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0) onSave(item.id, n);
    setEditing(false);
  };

  if (!editing) return (
    <button
      onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}
      style={{
        fontFamily: "monospace", fontSize: 13, fontWeight: 500,
        background: item.unitCost ? "none" : "#fff7ed",
        border: item.unitCost ? "none" : "1px dashed #f59e0b",
        borderRadius: 6, padding: item.unitCost ? 0 : "2px 8px",
        cursor: "pointer", color: item.unitCost ? "#374151" : "#d97706",
        minWidth: 60, textAlign: "right",
      }}
      title="Click to edit unit cost"
    >
      {item.unitCost ? `$${item.unitCost.toFixed(2)}` : "add cost"}
    </button>
  );

  return (
    <input
      ref={inputRef}
      aria-label="Unit cost"
      type="number"
      step="0.01"
      min="0"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{
        width: 80, padding: "3px 6px", borderRadius: 6,
        border: "1px solid #2563eb", fontSize: 12,
        fontFamily: "monospace", outline: "none", textAlign: "right",
        boxShadow: "0 0 0 2px rgba(37,99,235,.2)",
      }}
    />
  );
}

export default function TakeoffPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient   = useQueryClient();

  const [filterCategory, setFilterCategory] = useState("");
  const [sortBy, setSortBy]     = useState<"category"|"description"|"quantity"|"totalCost">("category");
  const [sortDir, setSortDir]   = useState<"asc"|"desc">("asc");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const aiProvider = "lmstudio";
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiError, setAiError]         = useState("");
  const [aiStep, setAiStep]           = useState("");
  const [aiItemCount, setAiItemCount] = useState(0);
  const [newItem, setNewItem] = useState({
    category: "", description: "", quantity: "", unit: "EA", unitCost: "", notes: "",
  });

  // ── Fetch takeoff items — always return array ───────────────
  const { data: items = [], isLoading } = useQuery<TakeoffItem[]>({
    queryKey: ["takeoff", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/takeoff`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof newItem) => {
      const res = await fetch(`/api/projects/${projectId}/takeoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, source: "MANUAL" }),
      });
      if (!res.ok) throw new Error("Failed to add item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["takeoff", projectId] });
      setShowAddForm(false);
      setNewItem({ category: "", description: "", quantity: "", unit: "EA", unitCost: "", notes: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/projects/${projectId}/takeoff?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["takeoff", projectId] }),
  });

  // ── AI Takeoff — PDF/image → AI → items ────────────────────
  const runAiTakeoff = async () => {
    setAiLoading(true);
    setAiError("");
    setAiStep("");
    setAiItemCount(0);

    try {
      // Step 1: Get project drawings
      setAiStep("Loading project drawings...");
      const projRes = await fetch(`/api/projects/${projectId}`);
      if (!projRes.ok) throw new Error("Could not load project");
      const project = await projRes.json();
      const drawings = project.drawings ?? [];

      if (!drawings.length) {
        setAiError("No drawings found. Upload a PDF or image first.");
        return;
      }

      const drawing = drawings[0];
      setAiStep(`Processing: ${drawing.originalName} (${drawing.fileFormat})`);

      // Step 2: Convert file to base64 image
      // PDF gets rendered to JPEG via PDF.js — so AI can see it visually
      const { base64, mimeType } = await fileToBase64(drawing.fileUrl, drawing.fileFormat);

      setAiStep(`Analyzing with ${aiProvider === "lmstudio" ? "LM Studio" : aiProvider}...`);

      // Step 3: Choose correct API endpoint
      let aiRes: Response;
      if (aiProvider === "lmstudio") {
        const lmUrl = typeof window !== "undefined"
          ? (localStorage.getItem("lmstudio_url") ?? "http://localhost:1234/v1")
          : "http://localhost:1234/v1";

        aiRes = await fetch("/api/lmstudio/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Analyze this architectural drawing and extract ALL materials for a construction takeoff.

Return a JSON array inside \`\`\`json ... \`\`\` markers:
[
  {
    "category": "Lumber",
    "description": "2×4 Studs @ 16\" OC",
    "quantity": 45,
    "unit": "EA",
    "unitCost": 4.50,
    "notes": "Exterior wall framing"
  }
]

Categories: Lumber, Concrete, Masonry, Drywall, Insulation, Roofing, Flooring, Doors & Windows, Plumbing, Electrical, HVAC, Finishes.
Units: EA, LF, SF, CY, SY, BF, TON, GAL.`,
            fileBase64: base64,
            mimeType,
            model:   localStorage.getItem("lmstudio_model") ?? "local-model",
            baseUrl: lmUrl,
            stream:  false,
          }),
        });
      } else {
        aiRes = await fetch(`/api/ai/${aiProvider}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileBase64: base64, mimeType }),
        });
      }

      if (!aiRes.ok) {
        const err = await aiRes.json().catch(() => ({}));
        // 422 = vision not supported (already retried server-side, but still failed)
        if (aiRes.status === 422 && err.hint) {
          throw new Error(`Model "${localStorage.getItem("lmstudio_model") || "local-model"}" doesn't support images.\n${err.hint}`);
        }
        throw new Error(err.hint ?? err.error ?? `${aiProvider} returned ${aiRes.status}`);
      }

      const result = await aiRes.json();

      // Show text-only mode warning if model didn't support vision
      if (result.warning) {
        setAiStep(`⚠️ ${result.warning}`);
        await new Promise(r => setTimeout(r, 1500));
      }

      // Step 4: Parse items from response
      let extractedItems = result.items ?? [];

      // For LM Studio (non-streaming), parse from text if items array empty
      if (!extractedItems.length && result.text) {
        try {
          const match = result.text.match(/```json\n?([\s\S]*?)\n?```/) ?? result.text.match(/\[[\s\S]*?\]/);
          if (match) extractedItems = JSON.parse(match[1] ?? match[0]);
        } catch {}
      }

      if (!extractedItems.length) {
        setAiError("AI could not extract items. Try a different model or clearer drawing.");
        return;
      }

      setAiStep(`Saving ${extractedItems.length} items to database...`);

      // Step 5: Save each item to DB
      let savedCount = 0;
      for (const item of extractedItems) {
        if (!item.description || !item.quantity) continue;
        const qty  = parseFloat(String(item.quantity)) || 1;
        const cost = parseFloat(String(item.unitCost)) || 0;
        await fetch(`/api/projects/${projectId}/takeoff`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source:      `AI_${aiProvider.toUpperCase()}`,
            aiProvider,
            category:    item.category    ?? "General",
            subcategory: item.subcategory ?? null,
            description: item.description,
            quantity:    qty,
            unit:        item.unit        ?? "EA",
            unitCost:    cost || null,
            totalCost:   cost ? qty * cost : null,
            confidence:  item.confidence  ?? 0.8,
            notes:       item.notes       ?? `AI extracted from ${drawing.originalName}`,
          }),
        });
        savedCount++;
        setAiItemCount(savedCount);
      }

      queryClient.invalidateQueries({ queryKey: ["takeoff", projectId] });
      setAiStep(`✓ Done! ${savedCount} items extracted and saved.`);
      setTimeout(() => setShowAiPanel(false), 2000);

    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI analysis failed";
      setAiError(msg);
      setAiStep("");
    } finally {
      setAiLoading(false);
    }
  };

  const exportCSV = () => {
    const header = "Category,Description,Quantity,Unit,Unit Cost,Total Cost,Source\n";
    const rows = items.map(i =>
      [i.category, i.description, i.quantity, i.unit, i.unitCost ?? "", i.totalCost ?? "", i.source].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = "takeoff.csv"; a.click();
  };

  const sorted = [...items]
    .filter(i => !filterCategory || i.category.toLowerCase().includes(filterCategory.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortBy] ?? 0, bv = b[sortBy] ?? 0;
      return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

  const totalCost = items.reduce((s, i) => s + (i.totalCost ?? 0), 0);
  const categories = [...new Set(items.map(i => i.category))];

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) =>
    sortBy === col ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null;

  return (
    <div className="space-y-5" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {[
          { label: "Total Items",    value: items.length,                           color: "#0f172a" },
          { label: "Categories",     value: categories.length,                       color: "#0f172a" },
          { label: "Estimated Cost", value: formatCurrency(totalCost),              color: "#059669" },
          { label: "AI Items",       value: items.filter(i => i.source.startsWith("AI")).length, color: "#7c3aed" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{label}</p>
            <p style={{ fontSize: 24, fontWeight: 800, color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <Filter style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#94a3b8" }} />
          <input
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            placeholder="Filter by category..."
            style={{ height: 36, width: 200, paddingLeft: 30, paddingRight: 12, borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none" }}
          />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => setShowAiPanel(!showAiPanel)} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8, border: "1px solid #ddd6fe",
            background: "#faf5ff", color: "#7c3aed", fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>
            <Brain className="h-4 w-4" /> AI Takeoff
          </button>
          <button onClick={() => setShowAddForm(!showAddForm)} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0",
            background: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#374151",
          }}>
            <Plus className="h-4 w-4" /> Add Item
          </button>
          <button onClick={exportCSV} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: "#2563eb", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* ── AI Panel ──────────────────────────────────────────── */}
      {showAiPanel && (
        <div style={{ borderRadius: 16, border: "1px solid #ddd6fe", background: "#faf5ff", padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#6d28d9", marginBottom: 6 }}>
            AI-Powered Takeoff Extraction
          </h3>
          <p style={{ fontSize: 12, color: "#7c3aed", marginBottom: 16 }}>
            Select AI provider → click Run → AI will analyze your uploaded drawing and extract all materials automatically.
            <strong> PDF files are automatically converted to image for AI vision analysis.</strong>
          </p>

          {/* LM Studio model picker */}
          <div style={{ marginBottom: 12 }}>
            <LmStudioModelPicker
              baseUrl={typeof window !== "undefined" ? (localStorage.getItem("lmstudio_url") ?? "http://localhost:1234/v1") : "http://localhost:1234/v1"}
              value={typeof window !== "undefined" ? (localStorage.getItem("lmstudio_model") ?? "") : ""}
              onChange={m => localStorage.setItem("lmstudio_model", m)}
            />
          </div>

          {/* Step indicator */}
          {aiStep && (
            <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: aiStep.startsWith("✓") ? "#f0fdf4" : "#eff6ff", border: `1px solid ${aiStep.startsWith("✓") ? "#bbf7d0" : "#bfdbfe"}`, fontSize: 13, color: aiStep.startsWith("✓") ? "#16a34a" : "#2563eb", display: "flex", alignItems: "center", gap: 8 }}>
              {aiLoading && !aiStep.startsWith("✓") ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{aiStep}</span>
              {aiItemCount > 0 && <span style={{ marginLeft: "auto", fontWeight: 700 }}>{aiItemCount} items saved</span>}
            </div>
          )}

          {/* Error */}
          {aiError && (
            <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 13, color: "#dc2626" }}>
              <strong>Error:</strong> {aiError}
              {aiProvider === "lmstudio" && (
                <p style={{ marginTop: 6, fontSize: 12, color: "#7f1d1d" }}>
                  LM Studio: Open LM Studio app → load a model → start Local Server (port 1234) → use the model picker above, or go to <strong>Settings</strong> to set a custom IP/port.
                </p>
              )}
            </div>
          )}

          <button
            onClick={runAiTakeoff}
            disabled={aiLoading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "10px 24px", borderRadius: 9, border: "none",
              background: aiLoading ? "#a78bfa" : "#7c3aed",
              color: "#fff", fontWeight: 700, fontSize: 14, cursor: aiLoading ? "not-allowed" : "pointer",
            }}
          >
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {aiLoading ? "Analyzing drawing..." : "Run AI Takeoff"}
          </button>
        </div>
      )}

      {/* ── Add Item Form ─────────────────────────────────────── */}
      {showAddForm && (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>Add Takeoff Item</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[
              { field: "category",    label: "Category",      placeholder: "Lumber" },
              { field: "description", label: "Description",   placeholder: "2x4 Studs" },
              { field: "quantity",    label: "Quantity",       placeholder: "100", type: "number" },
              { field: "unitCost",    label: "Unit Cost ($)",  placeholder: "4.50", type: "number" },
              { field: "notes",       label: "Notes",          placeholder: "Optional" },
            ].map(({ field, label, placeholder, type }) => (
              <div key={field}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>{label}</label>
                <input
                  type={type ?? "text"}
                  value={newItem[field as keyof typeof newItem]}
                  onChange={e => setNewItem(p => ({ ...p, [field]: e.target.value }))}
                  placeholder={placeholder}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Unit</label>
              <select
                aria-label="Unit of measure"
                value={newItem.unit}
                onChange={e => setNewItem(p => ({ ...p, unit: e.target.value }))}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13 }}
              >
                {["EA","LF","SF","CY","SY","BF","TON","GAL","LB"].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button onClick={() => setShowAddForm(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button
              onClick={() => addMutation.mutate(newItem)}
              disabled={!newItem.category || !newItem.description || !newItem.quantity || addMutation.isPending}
              style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              {addMutation.isPending ? "Adding..." : "Add Item"}
            </button>
          </div>
        </div>
      )}

      {/* ── Takeoff Table ─────────────────────────────────────── */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {[
                  { label: "Category",  col: "category" as const },
                  { label: "Description", col: "description" as const },
                  { label: "Qty",  col: "quantity" as const },
                  { label: "Unit" },
                  { label: "Unit Cost" },
                  { label: "Total",  col: "totalCost" as const },
                  { label: "Source" },
                  { label: "" },
                ].map(({ label, col }) => (
                  <th key={label} onClick={col ? () => toggleSort(col) : undefined}
                    style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "#64748b", cursor: col ? "pointer" : "default", whiteSpace: "nowrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {label}{col && <SortIcon col={col} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} style={{ padding: "10px 14px" }}>
                        <div className="shimmer" style={{ height: 14, borderRadius: 4 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "48px 20px", textAlign: "center" }}>
                    <FileText style={{ width: 36, height: 36, color: "#cbd5e1", margin: "0 auto 10px" }} />
                    <p style={{ fontSize: 14, color: "#94a3b8", fontWeight: 500 }}>No takeoff items yet</p>
                    <p style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>
                      Upload a drawing and click <strong>AI Takeoff</strong>, or add items manually.
                    </p>
                  </td>
                </tr>
              ) : (
                sorted.map(item => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9", transition: "background .12s" }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "#f8fafc")}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "#fff")}>
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "#0f172a" }}>{item.category}</td>
                    <td style={{ padding: "10px 14px", color: "#374151" }}>{item.description}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", color: "#0f172a" }}>{item.quantity}</td>
                    <td style={{ padding: "10px 14px", color: "#64748b" }}>{item.unit}</td>
                    {/* Inline-editable unit cost */}
                    <td style={{ padding: "6px 14px", textAlign: "right" }}>
                      <InlineUnitCost
                        item={item}
                        onSave={(id, uc) => fetch(`/api/projects/${projectId}/takeoff`, {
                          method: "PATCH", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id, unitCost: uc, quantity: item.quantity }),
                        }).then(() => queryClient.invalidateQueries({ queryKey: ["takeoff", projectId] }))}
                      />
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#059669" }}>
                      {item.unitCost && item.quantity
                        ? formatCurrency((item.unitCost) * (item.quantity))
                        : item.totalCost ? formatCurrency(item.totalCost) : <span style={{ color: "#f59e0b", fontSize: 11 }}>enter cost →</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                        background: item.source === "MANUAL" ? "#f1f5f9" : item.source.startsWith("AI") ? "#ede9fe" : "#eff6ff",
                        color:      item.source === "MANUAL" ? "#475569" : item.source.startsWith("AI") ? "#6d28d9" : "#2563eb",
                      }}>
                        {item.source.replace("AI_", "")}
                      </span>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <button onClick={() => deleteMutation.mutate(item.id)} style={{
                        background: "none", border: "none", cursor: "pointer", color: "#cbd5e1", padding: 4,
                      }}
                      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#ef4444")}
                      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#cbd5e1")}>
                        <Trash2 style={{ width: 14, height: 14 }} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                  <td colSpan={5} style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: "#374151" }}>TOTAL ({items.length} items)</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, fontSize: 15, color: "#059669" }}>{formatCurrency(totalCost)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
