"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, AlertCircle, Clock, CheckCircle2, Shield, XCircle, Trash2, Loader2 } from "lucide-react";

type PunchStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "VERIFIED" | "CLOSED";
type Priority   = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface PunchItem {
  id: string; title: string; description?: string | null;
  status: PunchStatus; priority: Priority; category: string;
  assignedTo?: string | null; location?: string | null;
  createdAt: string; updatedAt: string;
}

const STATUSES: { value: PunchStatus; label: string; icon: React.ElementType; color: string; bg: string }[] = [
  { value: "OPEN",        label: "Open",        icon: AlertCircle,  color: "text-red-600",    bg: "bg-red-100" },
  { value: "IN_PROGRESS", label: "In Progress", icon: Clock,        color: "text-amber-600",  bg: "bg-amber-100" },
  { value: "RESOLVED",    label: "Resolved",    icon: CheckCircle2, color: "text-sky-600",    bg: "bg-sky-100" },
  { value: "VERIFIED",    label: "Verified",    icon: Shield,       color: "text-violet-600", bg: "bg-violet-100" },
  { value: "CLOSED",      label: "Closed",      icon: XCircle,      color: "text-gray-500",   bg: "bg-gray-100" },
];

const CATEGORIES = ["Structural","Mechanical","Electrical","Plumbing","Finishes","Safety","General"];
const PRIORITIES: Priority[] = ["LOW","MEDIUM","HIGH","CRITICAL"];
const PRIORITY_STYLES: Record<Priority, { bg: string; text: string }> = {
  LOW:      { bg: "bg-gray-100",   text: "text-gray-600" },
  MEDIUM:   { bg: "bg-amber-100",  text: "text-amber-700" },
  HIGH:     { bg: "bg-orange-100", text: "text-orange-700" },
  CRITICAL: { bg: "bg-red-100",    text: "text-red-700" },
};

export default function PunchListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [filterStatus, setFilterStatus] = useState<PunchStatus | "ALL">("ALL");
  const [form, setForm] = useState<Partial<PunchItem>>({ status: "OPEN", priority: "MEDIUM", category: "General" });

  const { data: items = [], isLoading } = useQuery<PunchItem[]>({
    queryKey: ["punchlist", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/punchlist`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: Partial<PunchItem>) => {
      const r = await fetch(`/api/projects/${projectId}/punchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed to add");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["punchlist", projectId] });
      setShowAdd(false);
      setForm({ status: "OPEN", priority: "MEDIUM", category: "General" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PunchStatus }) => {
      const r = await fetch(`/api/projects/${projectId}/punchlist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["punchlist", projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/projects/${projectId}/punchlist?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["punchlist", projectId] }),
  });

  const filtered = filterStatus === "ALL" ? items : items.filter(i => i.status === filterStatus);
  const counts = Object.fromEntries(STATUSES.map(s => [s.value, items.filter(i => i.status === s.value).length]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="fade-up">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>Punch List</h2>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
            5-stage workflow — all data saved to database
          </p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "#2563eb", color: "#fff", padding: "9px 18px",
          borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
        }}>
          <Plus size={15} /> Add Item
        </button>
      </div>

      {/* Status pipeline */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
        {STATUSES.map(({ value, label, icon: Icon, color, bg }) => (
          <button key={value} onClick={() => setFilterStatus(filterStatus === value ? "ALL" : value)} style={{
            borderRadius: 12, padding: "14px 10px", textAlign: "center",
            border: `2px solid ${filterStatus === value ? "#2563eb" : "transparent"}`,
            background: bg, cursor: "pointer",
            boxShadow: filterStatus === value ? "0 0 0 3px rgba(37,99,235,.15)" : "none",
            transition: "all .15s",
          }}>
            <Icon size={20} style={{ margin: "0 auto 6px", display: "block" }} className={color.replace("text-","")} />
            <p style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{counts[value] ?? 0}</p>
            <p style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{label}</p>
          </button>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 22, boxShadow: "0 4px 16px rgba(0,0,0,.06)" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>New Punch Item</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Title *</label>
              <input
                value={form.title ?? ""}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Crack in concrete slab at column B4"
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                onFocus={e => (e.target.style.borderColor = "#2563eb")}
                onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
              />
            </div>
            {[
              { key: "priority", label: "Priority", options: PRIORITIES },
              { key: "category", label: "Category", options: CATEGORIES },
            ].map(({ key, label, options }) => (
              <div key={key}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>{label}</label>
                <select
                  value={(form as Record<string, string>)[key] ?? ""}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none" }}
                >
                  {options.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Location</label>
              <input value={form.location ?? ""} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Grid B4, Level 2" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Assigned To</label>
              <input value={form.assignedTo ?? ""} onChange={e => setForm(p => ({ ...p, assignedTo: e.target.value }))} placeholder="Name or trade" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none" }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Description</label>
              <textarea value={form.description ?? ""} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button onClick={() => setShowAdd(false)} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button
              onClick={() => addMutation.mutate(form)}
              disabled={!form.title?.trim() || addMutation.isPending}
              style={{ padding: "9px 22px", borderRadius: 8, border: "none", background: !form.title?.trim() ? "#93c5fd" : "#2563eb", fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer" }}
            >
              {addMutation.isPending ? "Saving..." : "Add Item"}
            </button>
          </div>
        </div>
      )}

      {/* Items list */}
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1,2,3].map(i => <div key={i} className="shimmer" style={{ height: 80, borderRadius: 12 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 16, border: "2px dashed #e2e8f0", padding: "48px 24px", textAlign: "center" }}>
          <CheckCircle2 size={40} color="#cbd5e1" style={{ margin: "0 auto 12px" }} />
          <p style={{ color: "#94a3b8", fontSize: 14 }}>
            {filterStatus === "ALL" ? "No punch items. Click 'Add Item' to start." : `No ${filterStatus.toLowerCase().replace("_"," ")} items.`}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(item => {
            const st = STATUSES.find(s => s.value === item.status)!;
            const StatusIcon = st.icon;
            const pri = PRIORITY_STYLES[item.priority];
            return (
              <div key={item.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: 14, boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }} className={st.bg}>
                  <StatusIcon size={18} className={st.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{item.title}</p>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }} className={`${pri.bg} ${pri.text}`}>{item.priority}</span>
                    <span style={{ fontSize: 11, background: "#f1f5f9", color: "#64748b", padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>{item.category}</span>
                  </div>
                  {item.description && <p style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{item.description}</p>}
                  <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#94a3b8" }}>
                    {item.location && <span>📍 {item.location}</span>}
                    {item.assignedTo && <span>👤 {item.assignedTo}</span>}
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <select
                    value={item.status}
                    onChange={e => updateMutation.mutate({ id: item.id, status: e.target.value as PunchStatus })}
                    style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#f8fafc" }}
                  >
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <button
                    onClick={() => deleteMutation.mutate(item.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#cbd5e1", padding: 4 }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#ef4444")}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#cbd5e1")}
                  >
                    <Trash2 size={15} />
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
