"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2, Loader2, Upload, CheckCircle2, Building2, ChevronDown, ChevronUp } from "lucide-react";
import { MATERIAL_RATES, estimateFromArea } from "@/lib/material-rates";
import { formatCurrency, bufToBase64, getLmStudioUrl } from "@/lib/utils";
import dynamic from "next/dynamic";
const LmStudioModelPicker = dynamic(() => import("@/components/ui/LmStudioModelPicker").then(m => ({ default: m.LmStudioModelPicker })), { ssr: false });

interface RoomMaterial {
  category: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost?: number;
  materialCode?: string;
  confidence?: number;
}

interface Room {
  floorLevel: string;
  roomName: string;
  areaSqFt: number;
  ceilingHeightFt?: number;
  materials: RoomMaterial[];
}

const MATERIAL_KEYS = Object.keys(MATERIAL_RATES);

export default function RoomExtractPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [expandedRooms, setExpandedRooms] = useState<Set<number>>(new Set());
  const provider = "lmstudio" as const;
  const lmStudioUrl = getLmStudioUrl();
  const [lmModel, setLmModel] = useState(() => typeof window !== "undefined" ? (localStorage.getItem("lmstudio_model") ?? "") : "");
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set(["studs_16oc", "drywall_walls", "paint_interior", "hardwood"]));

  const runExtraction = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const base64 = bufToBase64(buf);
      const res = await fetch("/api/ai/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mimeType: file.type, provider, lmStudioUrl, lmModel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRooms(data.rooms ?? []);
      setExpandedRooms(new Set(data.rooms?.map((_: Room, i: number) => i) ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  };

  const importToTakeoff = async () => {
    setLoading(true);
    try {
      for (const room of rooms) {
        // Import AI-extracted materials
        for (const mat of room.materials) {
          await fetch(`/api/projects/${projectId}/takeoff`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: `AI_${provider.toUpperCase()}`,
              aiProvider: provider,
              category: mat.category,
              description: `[${room.floorLevel} - ${room.roomName}] ${mat.description}`,
              quantity: mat.quantity,
              unit: mat.unit,
              unitCost: mat.unitCost ?? null,
              confidence: mat.confidence ?? 0.7,
              notes: `Room area: ${room.areaSqFt} sq ft | Ceiling: ${room.ceilingHeightFt ?? "?"}ft`,
              metadata: { floorLevel: room.floorLevel, roomName: room.roomName, areaSqFt: room.areaSqFt },
            }),
          });
        }

        // Import consumption-rate estimated materials
        for (const key of selectedMaterials) {
          const rate = MATERIAL_RATES[key];
          const est = estimateFromArea(room.areaSqFt, key);
          if (!est) continue;
          await fetch(`/api/projects/${projectId}/takeoff`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: "FASTAPI",
              category: rate.category,
              description: `[${room.roomName}] ${rate.name}`,
              quantity: est.quantity,
              unit: est.unit,
              unitCost: rate.avgUnitCost,
              totalCost: est.totalCost,
              notes: `Consumption rate estimate from ${room.areaSqFt} sq ft`,
            }),
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["takeoff", projectId] });
      setImported(true);
    } finally {
      setLoading(false);
    }
  };

  const toggleRoom = (i: number) => {
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const totalArea = rooms.reduce((s, r) => s + r.areaSqFt, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-(--foreground)">Room-Wise Material Extraction</h2>
        <p className="text-sm text-(--muted-foreground)">
          Upload a PDF or image of an architectural drawing. AI extracts materials room-by-room using the multi-modal pipeline from Repo 2 (Groq LLaMA 3 + consumption rates).
        </p>
      </div>

      {/* Upload + Config */}
      <div className="rounded-xl border border-(--border) bg-(--card) p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="extract-upload-file" className="mb-1 block text-sm font-medium text-(--foreground)">Upload Drawing / PDF</label>
            <input
              id="extract-upload-file"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.dxf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-sky-500 file:px-3 file:py-1 file:text-xs file:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-(--foreground)">AI — LM Studio</label>
            <LmStudioModelPicker baseUrl={lmStudioUrl} value={lmModel} onChange={setLmModel} />
          </div>
        </div>

        {/* Material rates selection */}
        <div>
          <label className="mb-2 block text-sm font-medium text-(--foreground)">
            Auto-estimate these materials from room area (consumption rates)
          </label>
          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1 md:grid-cols-3 lg:grid-cols-4">
            {MATERIAL_KEYS.map((key) => {
              const rate = MATERIAL_RATES[key];
              const checked = selectedMaterials.has(key);
              return (
                <label key={key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${checked ? "border-sky-400 bg-sky-50 text-sky-700" : "border-(--border) hover:border-sky-200"}`}>
                  <input type="checkbox" checked={checked} onChange={(e) => {
                    setSelectedMaterials((prev) => {
                      const next = new Set(prev);
                      e.target.checked ? next.add(key) : next.delete(key);
                      return next;
                    });
                  }} className="accent-sky-500" />
                  <span className="truncate">{rate.name}</span>
                </label>
              );
            })}
          </div>
        </div>

        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <button
          onClick={runExtraction}
          disabled={!file || loading}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {loading ? "Extracting..." : "Extract Room-Wise Materials"}
        </button>
      </div>

      {/* Results */}
      {rooms.length > 0 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-(--border) bg-(--card) p-4 text-center">
              <p className="text-2xl font-bold text-(--foreground)">{rooms.length}</p>
              <p className="text-xs text-(--muted-foreground)">Rooms Detected</p>
            </div>
            <div className="rounded-xl border border-(--border) bg-(--card) p-4 text-center">
              <p className="text-2xl font-bold text-(--foreground)">{totalArea.toFixed(0)}</p>
              <p className="text-xs text-(--muted-foreground)">Total sq ft</p>
            </div>
            <div className="rounded-xl border border-(--border) bg-(--card) p-4 text-center">
              <p className="text-2xl font-bold text-(--foreground)">
                {rooms.reduce((s, r) => s + r.materials.length, 0)}
              </p>
              <p className="text-xs text-(--muted-foreground)">Material Items</p>
            </div>
          </div>

          {/* Room cards */}
          {rooms.map((room, ri) => (
            <div key={ri} className="rounded-xl border border-(--border) bg-(--card) overflow-hidden">
              <button
                className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-(--secondary) transition-colors"
                onClick={() => toggleRoom(ri)}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100">
                  <Building2 className="h-5 w-5 text-sky-500" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-(--foreground)">{room.roomName}</p>
                  <p className="text-xs text-(--muted-foreground)">
                    {room.floorLevel} · {room.areaSqFt} sq ft · {room.ceilingHeightFt ?? "?"}ft ceiling · {room.materials.length} materials
                  </p>
                </div>
                {expandedRooms.has(ri) ? <ChevronUp className="h-4 w-4 text-(--muted-foreground)" /> : <ChevronDown className="h-4 w-4 text-(--muted-foreground)" />}
              </button>

              {expandedRooms.has(ri) && (
                <div className="border-t border-(--border)">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-(--border) bg-(--muted)">
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-(--muted-foreground)">Material</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-(--muted-foreground)">Category</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-(--muted-foreground)">Qty</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-(--muted-foreground)">Unit</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-(--muted-foreground)">Total</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold uppercase text-(--muted-foreground)">AI Conf.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-(--border)">
                      {room.materials.map((mat, mi) => (
                        <tr key={mi} className="hover:bg-(--muted) transition-colors">
                          <td className="px-4 py-2 text-(--foreground)">
                            {mat.description}
                            {mat.materialCode && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-mono text-amber-700">{mat.materialCode}</span>}
                          </td>
                          <td className="px-4 py-2 text-(--muted-foreground)">{mat.category}</td>
                          <td className="px-4 py-2 text-right font-mono">{mat.quantity}</td>
                          <td className="px-4 py-2 text-(--muted-foreground)">{mat.unit}</td>
                          <td className="px-4 py-2 text-right font-mono text-emerald-600">
                            {mat.unitCost ? formatCurrency(mat.quantity * mat.unitCost) : "—"}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${(mat.confidence ?? 0) > 0.8 ? "bg-emerald-100 text-emerald-700" : (mat.confidence ?? 0) > 0.5 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
                              {((mat.confidence ?? 0) * 100).toFixed(0)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {/* Import button */}
          <div className="flex justify-end">
            {imported ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Imported to Takeoff
              </div>
            ) : (
              <button
                onClick={importToTakeoff}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Import All to Takeoff
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
