"use client";

import { useState } from "react";
import { X, SlidersHorizontal } from "lucide-react";
import type { Drawing, DrawingScale } from "@/types";

const COMMON_SCALES = [
  { label: '1/8" = 1\'', ratio: 96, notation: '1/8" = 1\'' },
  { label: '1/4" = 1\'', ratio: 48, notation: '1/4" = 1\'' },
  { label: '3/8" = 1\'', ratio: 32, notation: '3/8" = 1\'' },
  { label: '1/2" = 1\'', ratio: 24, notation: '1/2" = 1\'' },
  { label: '3/4" = 1\'', ratio: 16, notation: '3/4" = 1\'' },
  { label: '1" = 1\'', ratio: 12, notation: '1" = 1\'' },
  { label: '1:100', ratio: 100, notation: '1:100' },
  { label: '1:50', ratio: 50, notation: '1:50' },
  { label: '1:20', ratio: 20, notation: '1:20' },
];

interface Props {
  drawing: Drawing;
  currentScale: DrawingScale | null;
  onSave: (scale: DrawingScale) => void;
  onClose: () => void;
}

export function ScaleCalibrator({ drawing, currentScale, onSave, onClose }: Props) {
  const [selected, setSelected] = useState(currentScale?.notation ?? "");
  const [customPx, setCustomPx] = useState(String(currentScale?.pxPerUnit ?? ""));
  const [unit, setUnit] = useState(currentScale?.realUnit ?? "ft");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const preset = COMMON_SCALES.find((s) => s.notation === selected);
    const pxPerUnit = preset ? 96 / preset.ratio : parseFloat(customPx);
    const scaleRatio = preset ? preset.ratio : null;

    try {
      const res = await fetch(`/api/drawings/${drawing.id}/scale`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notation: selected || null, pxPerUnit, realUnit: unit, scaleRatio, calibratedBy: "manual" }),
      });
      if (res.ok) {
        const saved = await res.json();
        onSave(saved);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-(--border) bg-(--card) p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-sky-500" />
            <h2 className="text-lg font-semibold text-(--foreground)">Set Drawing Scale</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-(--muted-foreground) hover:bg-(--secondary) transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-(--foreground)">Common Scales</label>
            <div className="grid grid-cols-3 gap-2">
              {COMMON_SCALES.map((s) => (
                <button
                  key={s.notation}
                  onClick={() => setSelected(s.notation)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                    selected === s.notation
                      ? "border-sky-500 bg-sky-50 text-sky-600"
                      : "border-(--border) hover:border-sky-300 hover:bg-sky-50/50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-(--foreground)">Or enter pixels per unit</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={customPx}
                onChange={(e) => { setCustomPx(e.target.value); setSelected("custom"); }}
                placeholder="e.g. 96"
                className="flex-1 rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400"
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400"
              >
                <option value="ft">feet</option>
                <option value="in">inches</option>
                <option value="m">meters</option>
                <option value="mm">mm</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-(--border) px-4 py-2 text-sm hover:bg-(--secondary) transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (!selected && !customPx)}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Apply Scale"}
          </button>
        </div>
      </div>
    </div>
  );
}
