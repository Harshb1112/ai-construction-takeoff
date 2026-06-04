"use client";

import { Eye, EyeOff, Layers } from "lucide-react";

export interface Layer {
  id: string;          // unique key (rtype or dxf layer name)
  name: string;        // display name
  color: number | string;  // DXF color number OR hex string
  visible: boolean;
  count?: number;      // optional: number of items in this layer
}

interface Props {
  layers: Layer[];
  onToggleLayer: (id: string) => void;
  onToggleAll: (visible: boolean) => void;
  title?: string;
}

function resolveColor(c: number | string): string {
  if (typeof c === "string") return c;          // already hex
  const p: Record<number, string> = {
    1: "#ff4444", 2: "#ffff44", 3: "#44ff44",
    4: "#44ffff", 5: "#4444ff", 6: "#ff44ff", 7: "#e0e0e0",
  };
  return p[c] ?? "#888";
}

export function LayerPanel({ layers, onToggleLayer, onToggleAll, title = "Layers" }: Props) {
  const allVisible = layers.every((l) => l.visible);
  return (
    <div className="flex w-56 flex-col border-l border-(--border) bg-[#0f172a] text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-sky-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-sky-400">
            {title}
          </span>
        </div>
        <button
          onClick={() => onToggleAll(!allVisible)}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          {allVisible ? "Hide all" : "Show all"}
        </button>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto py-1">
        {layers.map((layer) => (
          <button
            key={layer.id}
            onClick={() => onToggleLayer(layer.id)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-gray-800 ${
              layer.visible ? "" : "opacity-40"
            }`}
          >
            {layer.visible
              ? <Eye className="h-3.5 w-3.5 text-gray-400" />
              : <EyeOff className="h-3.5 w-3.5 text-gray-500" />
            }
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: resolveColor(layer.color) }}
            />
            <span className="flex-1 truncate text-xs text-gray-300">{layer.name}</span>
            {layer.count != null && (
              <span className="text-[10px] text-gray-500 ml-auto">{layer.count}</span>
            )}
          </button>
        ))}
        {layers.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-500">No layers detected</p>
        )}
      </div>
    </div>
  );
}
