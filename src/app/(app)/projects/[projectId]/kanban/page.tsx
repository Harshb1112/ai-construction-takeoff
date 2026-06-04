"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, X, Loader2, GripVertical,
  Box, User, Calendar, CheckCircle2
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────
interface KanbanTask {
  id: string;
  name: string;
  phase: string;       // Used as kanban column: PLANNED | IN_PROGRESS | REVIEW | DONE
  assignedTo?: string | null;
  color?: string | null;
  notes?: string | null;  // Stores JSON: { priority, bimElement, dueDate, description }
  startDate: string;
  endDate: string;
  progress: number;
  budget?: number | null;
}

interface TaskMeta {
  priority: "Low" | "Medium" | "High" | "Critical";
  bimElement: string;
  dueDate: string;
  description: string;
}

// ─── Columns ─────────────────────────────────────────────────────
const COLUMNS: { id: string; label: string; color: string; bg: string }[] = [
  { id: "PLANNED",     label: "Planned",     color: "#64748b", bg: "#f8fafc" },
  { id: "IN_PROGRESS", label: "In Progress", color: "#2563eb", bg: "#eff6ff" },
  { id: "REVIEW",      label: "Review",      color: "#d97706", bg: "#fffbeb" },
  { id: "DONE",        label: "Done",        color: "#059669", bg: "#f0fdf4" },
];

const PRIORITIES: TaskMeta["priority"][] = ["Low", "Medium", "High", "Critical"];
const PRIORITY_COLORS: Record<string, string> = {
  Low: "#64748b", Medium: "#2563eb", High: "#d97706", Critical: "#dc2626",
};

const BIM_ELEMENTS = [
  "None", "Wall", "Floor Slab", "Column", "Beam", "Roof",
  "Door", "Window", "Stair", "Foundation", "Facade", "MEP - Plumbing",
  "MEP - Electrical", "MEP - HVAC", "Site Work",
];

function parseMeta(notes?: string | null): TaskMeta {
  try { return JSON.parse(notes ?? "{}"); } catch { return { priority: "Medium", bimElement: "None", dueDate: "", description: "" }; }
}

// ─── Task Card ───────────────────────────────────────────────────
function TaskCard({ task, onMove, onDelete }: {
  task: KanbanTask;
  onMove: (id: string, newPhase: string) => void;
  onDelete: (id: string) => void;
}) {
  const meta = parseMeta(task.notes);
  const dragging = useRef(false);

  return (
    <div
      draggable
      onDragStart={e => { dragging.current = true; e.dataTransfer.setData("taskId", task.id); }}
      onDragEnd={() => { dragging.current = false; }}
      style={{
        background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0",
        padding: "12px 14px", cursor: "grab", userSelect: "none",
        boxShadow: "0 1px 4px rgba(0,0,0,.04)",
        transition: "box-shadow .15s",
        borderLeft: `3px solid ${PRIORITY_COLORS[meta.priority] ?? "#64748b"}`,
      }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.boxShadow = "0 4px 14px rgba(0,0,0,.1)")}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(0,0,0,.04)")}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <GripVertical size={13} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#0f172a", lineHeight: 1.4 }}>{task.name}</p>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label="Delete task"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#cbd5e1", padding: 0, flexShrink: 0 }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#ef4444")}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#cbd5e1")}
        >
          <X size={13} />
        </button>
      </div>

      {meta.description && (
        <p style={{ fontSize: 11, color: "#64748b", marginTop: 5, lineHeight: 1.5, marginLeft: 21 }}>{meta.description}</p>
      )}

      {/* Tags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8, marginLeft: 21 }}>
        {/* Priority */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
          background: `${PRIORITY_COLORS[meta.priority]}18`,
          color: PRIORITY_COLORS[meta.priority],
        }}>
          {meta.priority}
        </span>

        {/* BIM Element */}
        {meta.bimElement && meta.bimElement !== "None" && (
          <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, background: "#faf5ff", color: "#7c3aed", padding: "2px 7px", borderRadius: 99, fontWeight: 600 }}>
            <Box size={9} />{meta.bimElement}
          </span>
        )}

        {/* Due date */}
        {meta.dueDate && (
          <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#94a3b8" }}>
            <Calendar size={9} />{meta.dueDate}
          </span>
        )}

        {/* Assigned */}
        {task.assignedTo && (
          <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#64748b" }}>
            <User size={9} />{task.assignedTo}
          </span>
        )}
      </div>

      {/* Quick column mover */}
      <div style={{ display: "flex", gap: 4, marginTop: 9, marginLeft: 21 }}>
        {COLUMNS.filter(c => c.id !== task.phase).map(col => (
          <button key={col.id} onClick={() => onMove(task.id, col.id)} style={{
            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5,
            background: col.bg, color: col.color, border: `1px solid ${col.color}40`, cursor: "pointer",
          }}>
            → {col.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────
export default function KanbanPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addCol, setAddCol]   = useState("PLANNED");
  const [form, setForm] = useState({ name: "", assignedTo: "", priority: "Medium" as TaskMeta["priority"], bimElement: "None", dueDate: "", description: "" });

  const { data: tasks = [], isLoading } = useQuery<KanbanTask[]>({
    queryKey: ["kanban", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/schedule`);
      if (!r.ok) return [];
      const all = await r.json();
      // Only kanban tasks (phase starts with PLANNED/IN_PROGRESS/REVIEW/DONE)
      return (Array.isArray(all) ? all : []).filter((t: KanbanTask) =>
        ["PLANNED","IN_PROGRESS","REVIEW","DONE"].includes(t.phase)
      );
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<KanbanTask>) => {
      const r = await fetch(`/api/projects/${projectId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["kanban", projectId] }); setShowAdd(false); },
  });

  const moveMutation = useMutation({
    mutationFn: async ({ id, phase }: { id: string; phase: string }) => {
      const r = await fetch(`/api/projects/${projectId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, phase }),
      });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kanban", projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/projects/${projectId}/schedule?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kanban", projectId] }),
  });

  const addTask = () => {
    if (!form.name.trim()) return;
    const today = new Date().toISOString().slice(0, 10);
    const due = form.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    saveMutation.mutate({
      name:       form.name.trim(),
      phase:      addCol,
      assignedTo: form.assignedTo || null,
      startDate:  today,
      endDate:    due,
      progress:   0,
      notes:      JSON.stringify({
        priority:    form.priority,
        bimElement:  form.bimElement,
        dueDate:     form.dueDate,
        description: form.description,
      }),
    });
    setForm({ name: "", assignedTo: "", priority: "Medium", bimElement: "None", dueDate: "", description: "" });
  };

  const onDropToColumn = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("taskId");
    if (id) moveMutation.mutate({ id, phase: colId });
  };

  const totalByCol = (colId: string) => tasks.filter(t => t.phase === colId).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-(--foreground)">BIM Kanban Tasks</h2>
          <p className="text-sm text-(--muted-foreground)">
            Tasks linked to model elements · drag between columns · priority & BIM element tags
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 transition-colors"
        >
          <Plus className="h-4 w-4" />Add Task
        </button>
      </div>

      {/* Stats bar */}
      {tasks.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {COLUMNS.map(col => (
            <div key={col.id} className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-3 py-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.color }} />
              <span className="text-sm text-(--muted-foreground)">{col.label}:</span>
              <span className="text-sm font-bold" style={{ color: col.color }}>{totalByCol(col.id)}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-3 py-2 ml-auto">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium text-(--foreground)">{totalByCol("DONE")}/{tasks.length} done</span>
          </div>
        </div>
      )}

      {/* Add task modal */}
      {showAdd && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 50,
          background: "rgba(0,0,0,.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 20,
        }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: 24,
            width: "100%", maxWidth: 520,
            boxShadow: "0 20px 60px rgba(0,0,0,.2)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>New Task</p>
              <button type="button" onClick={() => setShowAdd(false)} aria-label="Close task modal" style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}><X size={18} /></button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Task name */}
              <div style={{ gridColumn: "1/-1" }}>
                <label htmlFor="task-name" style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>Task Name *</label>
                <input
                  id="task-name"
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Inspect roof waterproofing"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" as const }}
                  onFocus={e => (e.target.style.borderColor = "#2563eb")}
                  onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                />
              </div>

              {/* Description */}
              <div style={{ gridColumn: "1/-1" }}>
                <label htmlFor="task-description" style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>Description</label>
                <textarea
                  id="task-description"
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Optional task details..."
                  rows={2}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", resize: "none", fontFamily: "inherit", boxSizing: "border-box" as const }}
                  onFocus={e => (e.target.style.borderColor = "#2563eb")}
                  onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                />
              </div>

              {/* Column */}
              <div>
                <label htmlFor="task-column" style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>Column</label>
                <select id="task-column" value={addCol} onChange={e => setAddCol(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}>
                  {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label htmlFor="task-priority" style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>Priority</label>
                <select id="task-priority" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value as TaskMeta["priority"] }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>

              {/* BIM Element */}
              <div>
                <label htmlFor="task-bim-element" style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>
                  <Box size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />BIM Element
                </label>
                <select id="task-bim-element" value={form.bimElement} onChange={e => setForm(p => ({ ...p, bimElement: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}>
                  {BIM_ELEMENTS.map(el => <option key={el}>{el}</option>)}
                </select>
              </div>

              {/* Due date */}
              <div>
                <label htmlFor="task-due-date" style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>Due Date</label>
                <input id="task-due-date" type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }} />
              </div>

              {/* Assigned */}
              <div>
                <label htmlFor="task-assigned-to" style={{ fontSize: 11, fontWeight: 700, color: "#374151", display: "block", marginBottom: 5 }}>Assigned To</label>
                <input id="task-assigned-to" value={form.assignedTo} onChange={e => setForm(p => ({ ...p, assignedTo: e.target.value }))} placeholder="Name / team" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={() => setShowAdd(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button
                onClick={addTask}
                disabled={!form.name.trim() || saveMutation.isPending}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "9px 22px", borderRadius: 8, border: "none",
                  background: form.name.trim() ? "#2563eb" : "#e2e8f0",
                  color: form.name.trim() ? "#fff" : "#94a3b8",
                  fontWeight: 700, fontSize: 13, cursor: form.name.trim() ? "pointer" : "not-allowed",
                }}
              >
                {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.phase === col.id);
            return (
              <div
                key={col.id}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onDropToColumn(e, col.id)}
                style={{
                  borderRadius: 14, border: `1px solid ${col.color}30`,
                  background: col.bg, minHeight: 200,
                  display: "flex", flexDirection: "column",
                }}
              >
                {/* Column header */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "12px 14px", borderBottom: `1px solid ${col.color}25`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: col.color, display: "inline-block" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>{col.label}</span>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, minWidth: 20, height: 20,
                    borderRadius: "50%", background: col.color,
                    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {colTasks.length}
                  </span>
                </div>

                {/* Task cards */}
                <div style={{ flex: 1, padding: "10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {colTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onMove={(id, phase) => moveMutation.mutate({ id, phase })}
                      onDelete={id => deleteMutation.mutate(id)}
                    />
                  ))}
                  {colTasks.length === 0 && (
                    <div style={{ padding: "20px 14px", textAlign: "center" }}>
                      <p style={{ fontSize: 11, color: "#94a3b8" }}>Drop tasks here</p>
                    </div>
                  )}
                  {/* Quick add */}
                  <button
                    onClick={() => { setAddCol(col.id); setShowAdd(true); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, width: "100%",
                      padding: "7px 10px", borderRadius: 8,
                      border: `1px dashed ${col.color}60`,
                      background: "transparent", cursor: "pointer",
                      fontSize: 12, color: col.color, fontWeight: 600,
                      transition: "background .15s",
                    }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = `${col.color}10`)}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                  >
                    <Plus size={13} />Add to {col.label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
