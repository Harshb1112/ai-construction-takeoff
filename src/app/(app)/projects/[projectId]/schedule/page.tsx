"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Wand2, Loader2, Calendar,
  TrendingUp, AlertCircle, ChevronRight
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface ScheduleTask {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  progress: number; // 0-100
  predecessor?: string;
  depType?: "FS" | "FF" | "SS" | "SF";
  lag?: number;
  assignedTo?: string;
  budget?: number;
  actualCost?: number;
  critical?: boolean;
  phase?: string;
  color?: string;
}

const PHASES = ["Mobilization", "Foundation", "Framing", "Mechanical", "Finishes", "Closeout"];
const PHASE_COLORS: Record<string, string> = {
  Mobilization: "#6366f1", Foundation: "#0ea5e9", Framing: "#10b981",
  Mechanical: "#f59e0b", Finishes: "#ec4899", Closeout: "#8b5cf6",
};

// EVM calculations
function calcEVM(tasks: ScheduleTask[]) {
  const today = new Date();
  let pv = 0, ev = 0, ac = 0, bac = 0;

  for (const t of tasks) {
    const budget = t.budget ?? 0;
    bac += budget;
    const start = new Date(t.startDate);
    const end = new Date(t.endDate);
    const dur = end.getTime() - start.getTime();
    const elapsed = Math.min(today.getTime() - start.getTime(), dur);
    const schedPct = dur > 0 ? Math.max(0, Math.min(1, elapsed / dur)) : 0;
    pv += budget * schedPct;
    ev += budget * (t.progress / 100);
    ac += t.actualCost ?? 0;
  }

  const cpi = ev > 0 ? ev / ac : 1;
  const spi = pv > 0 ? ev / pv : 1;
  const eac = bac > 0 && cpi > 0 ? bac / cpi : bac;
  const vac = bac - eac;
  return { pv, ev, ac, bac, cpi, spi, eac, vac };
}

// Day difference
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

// Find project timeline
function timeline(tasks: ScheduleTask[]) {
  if (!tasks.length) return { start: new Date(), days: 30 };
  const starts = tasks.map((t) => new Date(t.startDate).getTime());
  const ends = tasks.map((t) => new Date(t.endDate).getTime());
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const days = Math.max(30, Math.ceil((max - min) / 86400000) + 7);
  return { start: new Date(min), days };
}

export default function SchedulePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newTask, setNewTask] = useState<Partial<ScheduleTask>>({
    name: "", startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    progress: 0, phase: "Foundation", budget: 0,
  });

  const { data: tasks = [] } = useQuery<ScheduleTask[]>({
    queryKey: ["schedule", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/schedule`);
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (task: Partial<ScheduleTask>) => {
      const r = await fetch(`/api/projects/${projectId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(task),
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule", projectId] });
      setShowAdd(false);
      setNewTask({ name: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), progress: 0, phase: "Foundation", budget: 0 });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/projects/${projectId}/schedule?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedule", projectId] }),
  });

  const generateFromBoq = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/boq`);
      const boq = await res.json();
      const sections = [...new Set((boq as { section: string }[]).map((b) => b.section))].slice(0, 8);
      // Duration based on budget: $10,000 per working day (industry rule of thumb)
      // Minimum 5 days, maximum 90 days per section
      let cursor = new Date();
      for (const section of sections) {
        const phase = PHASES.find((p) => section.toLowerCase().includes(p.toLowerCase())) ?? "Foundation";
        const sectionBudget = (boq as { section: string; totalCost: number }[])
          .filter((b) => b.section === section)
          .reduce((s: number, b) => s + (b.totalCost ?? 0), 0);
        const dur = Math.max(5, Math.min(90, Math.ceil(sectionBudget / 10000)));
        const end = new Date(cursor.getTime() + dur * 86400000);
        await fetch(`/api/projects/${projectId}/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: section.replace(/^\d+ - /, ""),
            startDate: cursor.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            progress: 0,
            phase,
            color: PHASE_COLORS[phase],
            budget: (boq as { section: string; totalCost: number }[]).filter((b) => b.section === section).reduce((s: number, b: { totalCost: number }) => s + (b.totalCost ?? 0), 0),
          }),
        });
        cursor = new Date(end.getTime() + 86400000);
      }
      queryClient.invalidateQueries({ queryKey: ["schedule", projectId] });
    } finally {
      setGenerating(false);
    }
  };

  const evm = useMemo(() => calcEVM(tasks), [tasks]);
  const { start: projStart, days: projDays } = useMemo(() => timeline(tasks), [tasks]);

  // Gantt column width
  const COL_W = 28;
  const LABEL_W = 220;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--foreground)">Project Schedule</h2>
          <p className="text-sm text-(--muted-foreground)">Gantt chart with Earned Value Management — from OpenConstructionERP</p>
        </div>
        <div className="flex gap-2">
          <button onClick={generateFromBoq} disabled={generating} className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-600 hover:bg-violet-100 disabled:opacity-50 transition-colors">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Generate from BOQ
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors">
            <Plus className="h-4 w-4" />Add Task
          </button>
        </div>
      </div>

      {/* EVM Dashboard */}
      {tasks.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          {[
            { label: "BAC", value: formatCurrency(evm.bac), color: "text-(--foreground)" },
            { label: "Planned Value", value: formatCurrency(evm.pv), color: "text-sky-600" },
            { label: "Earned Value", value: formatCurrency(evm.ev), color: "text-emerald-600" },
            { label: "Actual Cost", value: formatCurrency(evm.ac), color: "text-amber-600" },
            { label: "CPI", value: evm.cpi.toFixed(2), color: evm.cpi >= 1 ? "text-emerald-600" : "text-red-600" },
            { label: "SPI", value: evm.spi.toFixed(2), color: evm.spi >= 1 ? "text-emerald-600" : "text-red-600" },
            { label: "EAC", value: formatCurrency(evm.eac), color: evm.vac >= 0 ? "text-emerald-600" : "text-red-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-(--border) bg-(--card) p-3 text-center">
              <p className="text-xs text-(--muted-foreground)">{label}</p>
              <p className={`text-lg font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add Task Form */}
      {showAdd && (
        <div className="rounded-xl border border-(--border) bg-(--card) p-5">
          <h3 className="mb-4 font-semibold text-(--foreground)">New Task</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2 md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-(--muted-foreground)">Task Name *</label>
              <input value={newTask.name ?? ""} onChange={(e) => setNewTask((p) => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400" placeholder="e.g. Foundation Excavation" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--muted-foreground)">Phase</label>
              <select value={newTask.phase ?? "Foundation"} onChange={(e) => setNewTask((p) => ({ ...p, phase: e.target.value, color: PHASE_COLORS[e.target.value] }))} className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400">
                {PHASES.map((ph) => <option key={ph}>{ph}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--muted-foreground)">Budget ($)</label>
              <input type="number" value={newTask.budget ?? 0} onChange={(e) => setNewTask((p) => ({ ...p, budget: parseFloat(e.target.value) }))} className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--muted-foreground)">Start Date</label>
              <input type="date" value={newTask.startDate ?? ""} onChange={(e) => setNewTask((p) => ({ ...p, startDate: e.target.value }))} className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--muted-foreground)">End Date</label>
              <input type="date" value={newTask.endDate ?? ""} onChange={(e) => setNewTask((p) => ({ ...p, endDate: e.target.value }))} className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--muted-foreground)">Progress %</label>
              <input type="number" min="0" max="100" value={newTask.progress ?? 0} onChange={(e) => setNewTask((p) => ({ ...p, progress: parseInt(e.target.value) }))} className="w-full rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-sm outline-none focus:border-sky-400" />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-(--border) px-4 py-2 text-sm hover:bg-(--secondary) transition-colors">Cancel</button>
            <button onClick={() => saveMutation.mutate({ ...newTask, color: PHASE_COLORS[newTask.phase ?? "Foundation"] })} disabled={!newTask.name?.trim() || saveMutation.isPending} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50 transition-colors">
              {saveMutation.isPending ? "Saving..." : "Add Task"}
            </button>
          </div>
        </div>
      )}

      {/* Gantt Chart */}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-(--border) py-16 text-center">
          <Calendar className="h-10 w-10 text-(--muted-foreground)" />
          <div>
            <p className="font-medium text-(--foreground)">No schedule tasks yet</p>
            <p className="text-sm text-(--muted-foreground)">Generate from BOQ or add tasks manually.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-(--border) bg-(--card) overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: LABEL_W + projDays * COL_W }}>
              {/* Header: dates */}
              <div className="flex border-b border-(--border) bg-(--muted) sticky top-0 z-10">
                <div style={{ minWidth: LABEL_W, width: LABEL_W }} className="flex-shrink-0 px-3 py-2 text-xs font-semibold text-(--muted-foreground) border-r border-(--border)">
                  Task
                </div>
                <div className="flex flex-1 overflow-hidden">
                  {Array.from({ length: Math.ceil(projDays / 7) }).map((_, wi) => {
                    const d = new Date(projStart.getTime() + wi * 7 * 86400000);
                    return (
                      <div key={wi} style={{ width: 7 * COL_W }} className="flex-shrink-0 border-r border-(--border) px-1 py-2 text-xs text-(--muted-foreground)">
                        {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tasks */}
              {tasks.map((task, ti) => {
                const offsetDays = daysBetween(projStart.toISOString().slice(0, 10), task.startDate);
                const durDays = daysBetween(task.startDate, task.endDate) + 1;
                const color = task.color ?? PHASE_COLORS[task.phase ?? "Foundation"] ?? "#0ea5e9";
                const cpi = task.budget && task.actualCost ? (task.budget * task.progress / 100) / task.actualCost : 1;

                return (
                  <div key={task.id} className="flex border-b border-(--border) hover:bg-(--muted) group transition-colors">
                    {/* Label */}
                    <div style={{ minWidth: LABEL_W, width: LABEL_W }} className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-r border-(--border)">
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-(--foreground)">{task.name}</p>
                        <p className="text-xs text-(--muted-foreground)">{task.phase} · {task.progress}%</p>
                      </div>
                      <button onClick={() => deleteMutation.mutate(task.id)} className="opacity-0 group-hover:opacity-100 text-(--muted-foreground) hover:text-red-500 transition-all">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Gantt bar */}
                    <div className="relative flex-1 py-2.5" style={{ height: 44 }}>
                      {/* Bar */}
                      <div
                        style={{
                          position: "absolute",
                          left: offsetDays * COL_W,
                          width: durDays * COL_W,
                          height: 22,
                          top: "50%",
                          transform: "translateY(-50%)",
                          backgroundColor: `${color}30`,
                          border: `1.5px solid ${color}`,
                          borderRadius: 4,
                          overflow: "hidden",
                        }}
                        title={`${task.startDate} → ${task.endDate} (${task.progress}%)`}
                      >
                        {/* Progress fill */}
                        <div style={{ width: `${task.progress}%`, height: "100%", backgroundColor: color, opacity: 0.6 }} />
                        {/* Label inside bar */}
                        {durDays * COL_W > 60 && (
                          <span style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>
                            {task.progress}%
                          </span>
                        )}
                      </div>

                      {/* CPI warning */}
                      {task.budget && task.actualCost && cpi < 0.9 && (
                        <AlertCircle
                          className="absolute text-red-500"
                          style={{ width: 12, height: 12, right: offsetDays * COL_W + durDays * COL_W - 16, top: "25%" }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Today line */}
              <div
                style={{
                  position: "absolute",
                  left: LABEL_W + daysBetween(projStart.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)) * COL_W,
                  top: 0, bottom: 0, width: 2,
                  backgroundColor: "#ef4444",
                  opacity: 0.7,
                  pointerEvents: "none",
                  zIndex: 20,
                }}
              />
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center flex-wrap gap-3 border-t border-(--border) px-4 py-2">
            <span className="text-xs text-(--muted-foreground)">Phases:</span>
            {Object.entries(PHASE_COLORS).map(([ph, color]) => (
              <div key={ph} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs text-(--muted-foreground)">{ph}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: "#ef444460" }} />
              <span className="text-xs text-red-500">Today</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
