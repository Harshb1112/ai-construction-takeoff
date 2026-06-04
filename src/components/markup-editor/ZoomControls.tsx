"use client";

import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onFit }: Props) {
  return (
    <div className="absolute bottom-6 right-6 flex flex-col gap-1 rounded-xl border border-(--border) bg-white/90 backdrop-blur p-1 shadow-lg">
      <button onClick={onZoomIn} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-(--secondary) transition-colors text-(--foreground)">
        <ZoomIn className="h-4 w-4" />
      </button>
      <div className="text-center text-xs font-medium text-(--muted-foreground) py-0.5">
        {Math.round(zoom * 100)}%
      </div>
      <button onClick={onZoomOut} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-(--secondary) transition-colors text-(--foreground)">
        <ZoomOut className="h-4 w-4" />
      </button>
      <div className="h-px bg-[var(--border)]" />
      <button onClick={onFit} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-(--secondary) transition-colors text-(--foreground)">
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
}
