"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Wand2, Loader2, CheckCircle2, ImagePlus } from "lucide-react";
import { formatCurrency, bufToBase64, getLmStudioUrl } from "@/lib/utils";
import dynamic from "next/dynamic";
const LmStudioModelPicker = dynamic(() => import("@/components/ui/LmStudioModelPicker").then(m => ({ default: m.LmStudioModelPicker })), { ssr: false });

interface BotItem {
  section: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  confidence: number;
  notes?: string;
}

const PHOTO_BOQ_PROMPT = `You are an expert construction estimator.

Analyze this construction site photograph and generate a Bill of Quantities (BOQ).

Return a JSON array of BOQ items:
\`\`\`json
[
  {
    "section": "03 - Concrete",
    "description": "Concrete Slab 4\" thick",
    "unit": "CY",
    "quantity": 45,
    "unitCost": 165,
    "confidence": 0.8,
    "notes": "Estimated from visible area"
  }
]
\`\`\`

Look for:
- Structural elements (concrete, steel, masonry, wood framing)
- In-progress work and completed work
- Equipment and materials on site
- Scope of work visible in the photo

Use CSI MasterFormat section numbers.
Estimate realistic quantities and unit costs (USD).
Set confidence 0-1 based on visibility.`;

export default function PhotoBoqPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BotItem[]>([]);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);
  const provider = "lmstudio" as const;
  const lmStudioUrl = getLmStudioUrl();
  const [lmModel, setLmModel] = useState(() => typeof window !== "undefined" ? (localStorage.getItem("lmstudio_model") ?? "") : "");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setFiles(selected);
    setPreviews(selected.map((f) => URL.createObjectURL(f)));
    setItems([]);
    setImported(false);
  };

  const runPhotoBoq = async () => {
    if (!files.length) return;
    setLoading(true);
    setError("");
    const allItems: BotItem[] = [];

    try {
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const base64 = bufToBase64(buf);

        const endpoint = provider === "lmstudio" ? "/api/ai/lmstudio" : `/api/ai/${provider}`;
        const body: Record<string, unknown> = { fileBase64: base64, mimeType: file.type, prompt: PHOTO_BOQ_PROMPT };
        if (provider === "lmstudio") { body.baseUrl = lmStudioUrl; body.model = lmModel || "local-model"; }
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const parsed = data.items ?? [];
        allItems.push(...parsed);
      }
      setItems(allItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const importToBoq = async () => {
    setLoading(true);
    try {
      for (const item of items) {
        await fetch(`/api/projects/${projectId}/boq`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section: item.section,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            unitCost: item.unitCost,
            notes: item.notes ?? `Confidence: ${(item.confidence * 100).toFixed(0)}% (Photo AI)`,
          }),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["boq", projectId] });
      setImported(true);
    } finally {
      setLoading(false);
    }
  };

  const grandTotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-(--foreground)">Photo → BOQ</h2>
        <p className="text-sm text-(--muted-foreground)">
          Upload construction site photos. GPT-4o Vision + Claude analyze them and generate a scoped Bill of Quantities automatically — like OpenConstructionERP's Photo-to-Estimate feature.
        </p>
      </div>

      {/* Upload */}
      <div className="rounded-xl border border-(--border) bg-(--card) p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="photo-boq-files" className="mb-1 block text-sm font-medium text-(--foreground)">Site Photos (JPG/PNG)</label>
            <input
              id="photo-boq-files"
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp"
              aria-label="Upload site photos for BOQ estimation"
              onChange={handleFileChange}
              className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-sky-500 file:px-3 file:py-1 file:text-xs file:text-white cursor-pointer"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-(--foreground)">AI — LM Studio</label>
            <LmStudioModelPicker baseUrl={lmStudioUrl} value={lmModel} onChange={setLmModel} />
          </div>
        </div>

        {/* Previews */}
        {previews.length > 0 && (
          <div className="flex gap-3 flex-wrap">
            {previews.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt={`Photo ${i + 1}`} className="h-24 w-24 rounded-lg object-cover border border-(--border)" />
            ))}
          </div>
        )}

        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <button
          onClick={runPhotoBoq}
          disabled={!files.length || loading}
          className="flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {loading ? "Analyzing photos..." : `Analyze ${files.length || ""} Photo${files.length !== 1 ? "s" : ""}`}
        </button>
      </div>

      {/* BOQ Results */}
      {items.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-(--border) bg-(--card) p-4 text-center">
              <p className="text-2xl font-bold">{items.length}</p>
              <p className="text-xs text-(--muted-foreground)">BOQ Items</p>
            </div>
            <div className="rounded-xl border border-(--border) bg-(--card) p-4 text-center">
              <p className="text-2xl font-bold">{[...new Set(items.map((i) => i.section))].length}</p>
              <p className="text-xs text-(--muted-foreground)">CSI Sections</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-700">{formatCurrency(grandTotal)}</p>
              <p className="text-xs text-emerald-600">Estimated Total</p>
            </div>
          </div>

          <div className="rounded-xl border border-(--border) bg-(--card) overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--border) bg-(--muted)">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-(--muted-foreground)">Section</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-(--muted-foreground)">Description</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-(--muted-foreground)">Qty</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-(--muted-foreground)">Unit</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-(--muted-foreground)">Unit Cost</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-(--muted-foreground)">Total</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase text-(--muted-foreground)">Conf.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {items.map((item, i) => (
                  <tr key={i} className="hover:bg-(--muted) transition-colors">
                    <td className="px-4 py-2 text-xs text-(--muted-foreground)">{item.section}</td>
                    <td className="px-4 py-2 text-(--foreground)">{item.description}</td>
                    <td className="px-4 py-2 text-right font-mono">{item.quantity}</td>
                    <td className="px-4 py-2 text-(--muted-foreground)">{item.unit}</td>
                    <td className="px-4 py-2 text-right font-mono">${item.unitCost.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right font-mono text-emerald-600">{formatCurrency(item.quantity * item.unitCost)}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${item.confidence > 0.7 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {(item.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            {imported ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />Imported to BOQ
              </div>
            ) : (
              <button onClick={importToBoq} disabled={loading} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Import to BOQ
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
