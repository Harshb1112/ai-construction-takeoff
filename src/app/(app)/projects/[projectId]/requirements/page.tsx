"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Plus, CheckCircle2, Shield, Trash2, Loader2, FileText } from "lucide-react";

type QualityGate = "completeness"|"consistency"|"coverage"|"compliance";
type Status      = "OPEN"|"VERIFIED"|"FAILED";

interface EacItem {
  id: string; entity: string; attribute: string; constraint: string;
  category: string; boqRef?: string; status: Status; gate: QualityGate; notes?: string;
}

const CATEGORIES = ["Structural","Fire Safety","Thermal","Acoustic","Waterproofing","Electrical","Mechanical","Architectural","Accessibility"];
const GATES: { id: QualityGate; label: string; desc: string; icon: React.ElementType; color: string }[] = [
  { id:"completeness", label:"1 · Completeness", desc:"All required requirements captured", icon:CheckCircle2, color:"#2563eb" },
  { id:"consistency",  label:"2 · Consistency",  desc:"No contradicting requirements",     icon:Shield,       color:"#7c3aed" },
  { id:"coverage",     label:"3 · Coverage",     desc:"All elements covered",              icon:FileText,     color:"#059669" },
  { id:"compliance",   label:"4 · Compliance",   desc:"BOQ satisfies all constraints",     icon:CheckCircle2, color:"#d97706" },
];

export default function RequirementsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [requirements, setRequirements] = useState<EacItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [showAdd, setShowAdd]   = useState(false);
  const [activeGate, setActiveGate] = useState<QualityGate>("completeness");
  const [running, setRunning]   = useState(false);
  const [gateResults, setGateResults] = useState<Record<QualityGate, boolean>>({
    completeness: false, consistency: false, coverage: false, compliance: false,
  });
  const [form, setForm] = useState<Partial<EacItem>>({ category:"Structural", gate:"completeness", status:"OPEN" });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/projects/${projectId}/requirements`);
    if (r.ok) setRequirements(await r.json());
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const addReq = async () => {
    if (!form.entity || !form.attribute || !form.constraint) return;
    setSaving(true);
    const r = await fetch(`/api/projects/${projectId}/requirements`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) { const item = await r.json(); setRequirements(prev => [...prev, item]); }
    setForm({ category:"Structural", gate:"completeness", status:"OPEN" });
    setShowAdd(false);
    setSaving(false);
  };

  const deleteReq = async (id: string) => {
    setRequirements(prev => prev.filter(r => r.id !== id));
    await fetch(`/api/projects/${projectId}/requirements`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const toggleStatus = async (id: string) => {
    const req = requirements.find(r => r.id === id);
    if (!req) return;
    const next = req.status === "OPEN" ? "VERIFIED" : req.status === "VERIFIED" ? "FAILED" : "OPEN";
    setRequirements(prev => prev.map(r => r.id === id ? { ...r, status: next as Status } : r));
    await fetch(`/api/projects/${projectId}/requirements`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    });
  };

  const runGates = () => {
    setRunning(true);
    const reqs = requirements;
    setGateResults({
      completeness: reqs.length >= 5,
      consistency:  !reqs.some((r, i) => reqs.slice(i+1).some(r2 => r2.entity===r.entity && r2.attribute===r.attribute && r2.constraint!==r.constraint)),
      coverage:     new Set(reqs.map(r => r.category)).size >= 3,
      compliance:   reqs.filter(r => r.boqRef?.trim()).length >= Math.ceil(reqs.length * 0.5),
    });
    setRunning(false);
  };

  const filtered = activeGate === "completeness" ? requirements : requirements.filter(r => r.gate === activeGate);
  const scoreGates = Object.values(gateResults).filter(Boolean).length;

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, gap:10, color:"#64748b" }}>
      <Loader2 size={20} className="animate-spin"/> Loading requirements…
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }} className="fade-up">
      <div>
        <h2 style={{ fontSize:20, fontWeight:800, color:"#0f172a" }}>EAC Requirements</h2>
        <p style={{ fontSize:13, color:"#64748b", marginTop:3 }}>Entity → Attribute → Constraint triplets · 4 Quality Gates · BOQ Traceability</p>
      </div>

      {/* Gates */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
        {GATES.map(g => {
          const passed = gateResults[g.id];
          const Icon   = g.icon;
          return (
            <button key={g.id} onClick={()=>setActiveGate(g.id)}
              style={{ background: activeGate===g.id ? `${g.color}10` : "#fff", border:`1px solid ${activeGate===g.id?g.color:"#e2e8f0"}`, borderRadius:12, padding:"12px 14px", cursor:"pointer", textAlign:"left" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                <Icon size={14} style={{ color: passed ? "#16a34a" : g.color }}/>
                <span style={{ fontSize:12, fontWeight:700, color: passed ? "#16a34a" : g.color }}>{g.label}</span>
                {passed && <span style={{ marginLeft:"auto", fontSize:10, background:"#f0fdf4", color:"#16a34a", padding:"1px 6px", borderRadius:99, fontWeight:700 }}>PASS</span>}
              </div>
              <p style={{ fontSize:11, color:"#64748b" }}>{g.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display:"flex", gap:10 }}>
        <button onClick={runGates} disabled={running||requirements.length===0}
          style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #7c3aed", background:"#7c3aed10", color:"#7c3aed", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          {running ? <Loader2 size={13} className="animate-spin"/> : <Shield size={13}/>}
          Run Quality Gates {scoreGates > 0 && `(${scoreGates}/4 passed)`}
        </button>
        <button onClick={()=>setShowAdd(!showAdd)}
          style={{ marginLeft:"auto", display:"inline-flex", alignItems:"center", gap:6, padding:"9px 16px", borderRadius:8, border:"none", background:"#2563eb", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>
          <Plus size={14}/>Add Requirement
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div style={{ background:"#f8fafc", borderRadius:12, border:"1px solid #e2e8f0", padding:20 }}>
          <p style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:14 }}>New Requirement</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
            <input placeholder="Entity (e.g. Exterior Wall) *" value={form.entity??""} onChange={e=>setForm(f=>({...f,entity:e.target.value}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}/>
            <input placeholder="Attribute (e.g. fire_rating) *" value={form.attribute??""} onChange={e=>setForm(f=>({...f,attribute:e.target.value}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}/>
            <input placeholder="Constraint (e.g. ≥ F90) *" value={form.constraint??""} onChange={e=>setForm(f=>({...f,constraint:e.target.value}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}/>
            <select value={form.category??""} onChange={e=>setForm(f=>({...f,category:e.target.value}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, background:"#fff" }}>
              {CATEGORIES.map(c=><option key={c}>{c}</option>)}
            </select>
            <select value={form.gate??""} onChange={e=>setForm(f=>({...f,gate:e.target.value as QualityGate}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, background:"#fff" }}>
              {GATES.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <input placeholder="BOQ Ref (optional)" value={form.boqRef??""} onChange={e=>setForm(f=>({...f,boqRef:e.target.value}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}/>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <button onClick={addReq} disabled={saving||!form.entity||!form.attribute||!form.constraint}
              style={{ padding:"8px 18px", borderRadius:8, border:"none", background:"#2563eb", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              {saving ? <><Loader2 size={13} className="animate-spin"/>Saving…</> : "Save"}
            </button>
            <button onClick={()=>setShowAdd(false)} style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #e2e8f0", background:"#fff", fontSize:13, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#94a3b8" }}>
          <FileText size={40} style={{ margin:"0 auto 12px", opacity:0.3 }}/>
          <p style={{ fontWeight:600 }}>No requirements yet</p>
          <p style={{ fontSize:13 }}>Add your first EAC requirement</p>
        </div>
      ) : (
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e2e8f0", overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
                {["Entity","Attribute","Constraint","Category","BOQ Ref","Status",""].map(h=>(
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:"#64748b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"10px 14px", fontWeight:600 }}>{r.entity}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"monospace", color:"#2563eb" }}>{r.attribute}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"monospace", color:"#059669" }}>{r.constraint}</td>
                  <td style={{ padding:"10px 14px", color:"#64748b" }}>{r.category}</td>
                  <td style={{ padding:"10px 14px", color:"#94a3b8", fontFamily:"monospace" }}>{r.boqRef||"—"}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <button onClick={()=>toggleStatus(r.id)} style={{ padding:"3px 9px", borderRadius:6, border:"1px solid #e2e8f0", fontSize:11, fontWeight:600, cursor:"pointer",
                      background: r.status==="OPEN"?"#eff6ff":r.status==="VERIFIED"?"#f0fdf4":"#fef2f2",
                      color: r.status==="OPEN"?"#2563eb":r.status==="VERIFIED"?"#16a34a":"#dc2626" }}>
                      {r.status}
                    </button>
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <button onClick={()=>deleteReq(r.id)} style={{ background:"none", border:"none", cursor:"pointer", color:"#94a3b8" }}><Trash2 size={13}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
