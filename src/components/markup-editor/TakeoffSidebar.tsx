"use client";

import { useQuery } from "@tanstack/react-query";
import { Ruler, Square, Hash, Route, Plus, Trash2 } from "lucide-react";
import type { Annotation, TakeoffItem } from "@/types";
import { formatCurrency } from "@/lib/utils";

const TYPE_ICONS = {
  MEASUREMENT: Ruler,
  AREA: Square,
  COUNT: Hash,
  PERIMETER: Route,
  TEXT: Plus,
};

interface Props {
  projectId: string;
  drawingId: string;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string) => void;
}

export function TakeoffSidebar({ projectId, drawingId, annotations, selectedAnnotationId, onSelectAnnotation }: Props) {
  const { data: items = [], refetch } = useQuery<TakeoffItem[]>({
    queryKey: ["takeoff", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/takeoff`);
      return res.json();
    },
    refetchInterval: 3000,
  });

  const drawingItems = items.filter((i) => i.drawingId === drawingId);
  const totalCost = drawingItems.reduce((s, i) => s + (i.totalCost ?? 0), 0);

  return (
    <aside className="flex w-72 flex-col border-l border-(--border) bg-(--card)">
      <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
        <h3 className="text-sm font-semibold text-(--foreground)">Takeoff</h3>
        <span className="text-xs text-(--muted-foreground)">{drawingItems.length} items</span>
      </div>

      {/* Annotation list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-(--muted-foreground)">Markup Measurements</p>
          {annotations.length === 0 ? (
            <p className="text-xs text-(--muted-foreground) py-3">
              Use the tools to draw measurements on the drawing.
            </p>
          ) : (
            <div className="space-y-1">
              {annotations.map((ann) => {
                const Icon = TYPE_ICONS[ann.type] ?? Plus;
                return (
                  <button
                    key={ann.id}
                    onClick={() => onSelectAnnotation(ann.id)}
                    className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                      selectedAnnotationId === ann.id ? "bg-sky-50 border border-sky-200" : "hover:bg-(--secondary)"
                    }`}
                  >
                    <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded" style={{ backgroundColor: `${ann.color}20` }}>
                      <Icon className="h-3 w-3" style={{ color: ann.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs font-medium text-(--foreground)">
                        {ann.label ?? ann.type}
                      </p>
                      {ann.measurement != null && (
                        <p className="text-xs text-(--muted-foreground)">
                          {ann.measurement.toFixed(2)} {ann.unit}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-(--border) px-3 py-2">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-(--muted-foreground)">All Takeoff Items</p>
          <div className="space-y-1">
            {drawingItems.map((item) => (
              <div key={item.id} className="rounded-lg border border-(--border) bg-(--muted) p-2">
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-(--foreground)">{item.description}</p>
                    <p className="text-xs text-(--muted-foreground)">{item.quantity} {item.unit}</p>
                  </div>
                  {item.totalCost != null && (
                    <p className="flex-shrink-0 text-xs font-medium text-emerald-600">{formatCurrency(item.totalCost)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer totals */}
      {totalCost > 0 && (
        <div className="border-t border-(--border) px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-(--foreground)">This Drawing</p>
            <p className="text-sm font-bold text-emerald-600">{formatCurrency(totalCost)}</p>
          </div>
        </div>
      )}
    </aside>
  );
}
