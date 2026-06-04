"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Plus, Trash2, AlertTriangle, TrendingUp, Shield, Loader2 } from "lucide-react";

type Impact      = 1|2|3|4|5;
type Probability = 1|2|3|4|5;

interface Risk {
  id: string;
  title: string;
  description?: string;
  category: string;
  probability: Probability;
  impact: Impact;
  score: number;
  mitigation: string;
  owner?: string;
  contingency?: number;
  status: "OPEN"|"MITIGATED"|"CLOSED";
}

const CATEGORIES = ["Technical","Commercial","Schedule","Environmental","Regulatory","Force Majeure","Design","Resource"];

const scoreColor = (s: number) =>
  s >= 16 ? "#dc2626" : s >= 9 ? "#d97706" : s >= 4 ? "#2563eb" : "#16a34a";
const scoreBg = (s: number) =>
  s >= 16 ? "#fef2f2" : s >= 9 ? "#fffbeb" : s >= 4 ? "#eff6ff" : "#f0fdf4";
const scoreLabel = (s: number) =>
  s >= 16 ? "CRITICAL" : s >= 9 ? "HIGH" : s >= 4 ? "MEDIUM" : "LOW";

export default function RiskPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [risks, setRisks]     = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState<Partial<Risk>>({ category:"Technical", probability:3, impact:3, status:"OPEN" });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/projects/${projectId}/risks`);
    if (r.ok) setRisks(await r.json());
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const addRisk = async () => {
    if (!form.title) return;
    setSaving(true);
    const r = await fetch(`/api/projects/${projectId}/risks`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (r.ok) {
      const newRisk = await r.json();
      setRisks(prev => [...prev, newRisk]);
    }
    setForm({ category:"Technical", probability:3, impact:3, status:"OPEN" });
    setShowAdd(false);
    setSaving(false);
  };

  const deleteRisk = async (id: string) => {
    setRisks(prev => prev.filter(r => r.id !== id));
    await fetch(`/api/projects/${projectId}/risks`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const toggleStatus = async (id: string) => {
    const risk = risks.find(r => r.id === id);
    if (!risk) return;
    const next = risk.status === "OPEN" ? "MITIGATED" : risk.status === "MITIGATED" ? "CLOSED" : "OPEN";
    setRisks(prev => prev.map(r => r.id === id ? { ...r, status: next as Risk["status"] } : r));
    await fetch(`/api/projects/${projectId}/risks`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    });
  };

  const totalContingency = risks.filter(r=>r.contingency).reduce((s,r)=>s+(r.contingency??0),0);
  const criticalCount    = risks.filter(r=>r.score>=16).length;
  const highCount        = risks.filter(r=>r.score>=9&&r.score<16).length;

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, gap:10, color:"#64748b" }}>
      <Loader2 size={20} className="animate-spin"/> Loading risks…
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }} className="fade-up">
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
        <div>
          <h2 style={{ fontSize:20, fontWeight:800, color:"#0f172a" }}>Risk Register</h2>
          <p style={{ fontSize:13, color:"#64748b", marginTop:3 }}>P×I matrix · Mitigation strategies · Risk-adjusted contingency</p>
        </div>
        <button onClick={()=>setShowAdd(!showAdd)} style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"9px 16px", borderRadius:8, border:"none", background:"#dc2626", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>
          <Plus size={14}/>Add Risk
        </button>
      </div>

      {/* Summary */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {[
          { label:"Total Risks",  val:risks.length,                          color:"#0f172a", bg:"#f8fafc" },
          { label:"Critical",     val:criticalCount,                         color:"#dc2626", bg:"#fef2f2" },
          { label:"High",         val:highCount,                             color:"#d97706", bg:"#fffbeb" },
          { label:"Contingency",  val:`$${totalContingency.toLocaleString()}`, color:"#7c3aed", bg:"#faf5ff" },
        ].map(({ label, val, color, bg }) => (
          <div key={label} style={{ background:bg, borderRadius:12, border:"1px solid #e2e8f0", padding:"14px 18px" }}>
            <p style={{ fontSize:11, color:"#64748b", marginBottom:4 }}>{label}</p>
            <p style={{ fontSize:20, fontWeight:800, color }}>{val}</p>
          </div>
        ))}
      </div>

      {/* Risk Matrix */}
      {risks.length > 0 && (
        <div style={{ background:"#fff", borderRadius:14, border:"1px solid #e2e8f0", padding:18 }}>
          <p style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:12 }}>Risk Matrix (Probability × Impact)</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4 }}>
            {[5,4,3,2,1].map(p => [1,2,3,4,5].map(i => {
              const s = p*i;
              const inZone = risks.filter(r=>r.probability===p&&r.impact===i);
              return (
                <div key={`${p}${i}`} style={{ background:scoreBg(s), border:"1px solid #e2e8f0", borderRadius:6, padding:"6px 4px", textAlign:"center", minHeight:50, position:"relative" }}>
                  <span style={{ fontSize:9, color:scoreColor(s), fontWeight:700 }}>{s}</span>
                  {inZone.map(r=>(
                    <div key={r.id} style={{ background:scoreColor(r.score), borderRadius:3, padding:"1px 3px", fontSize:8, color:"#fff", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.title}>{r.title.slice(0,12)}</div>
                  ))}
                </div>
              );
            }))}
          </div>
          <div style={{ display:"flex", gap:6, marginTop:8, fontSize:10, color:"#64748b" }}>
            <span>← Impact →</span>
            <span style={{ marginLeft:"auto" }}>↑ Probability ↑</span>
          </div>
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <div style={{ background:"#f8fafc", borderRadius:12, border:"1px solid #e2e8f0", padding:20 }}>
          <p style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:14 }}>New Risk</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <input placeholder="Risk title *" value={form.title??""} onChange={e=>setForm(f=>({...f,title:e.target.value}))}
              style={{ gridColumn:"1/-1", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}/>
            <textarea placeholder="Description" value={form.description??""} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              style={{ gridColumn:"1/-1", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, minHeight:60, resize:"vertical" }}/>
            <select value={form.category??""} onChange={e=>setForm(f=>({...f,category:e.target.value}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, background:"#fff" }}>
              {CATEGORIES.map(c=><option key={c}>{c}</option>)}
            </select>
            <input placeholder="Owner" value={form.owner??""} onChange={e=>setForm(f=>({...f,owner:e.target.value}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}/>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:11, color:"#64748b" }}>Probability (1–5): {form.probability}</label>
              <input type="range" min={1} max={5} value={form.probability??3} onChange={e=>setForm(f=>({...f,probability:+e.target.value as Probability}))} style={{ width:"100%" }}/>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:11, color:"#64748b" }}>Impact (1–5): {form.impact}</label>
              <input type="range" min={1} max={5} value={form.impact??3} onChange={e=>setForm(f=>({...f,impact:+e.target.value as Impact}))} style={{ width:"100%" }}/>
            </div>
            <textarea placeholder="Mitigation strategy" value={form.mitigation??""} onChange={e=>setForm(f=>({...f,mitigation:e.target.value}))}
              style={{ gridColumn:"1/-1", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, minHeight:60, resize:"vertical" }}/>
            <input type="number" placeholder="Contingency ($)" value={form.contingency??""} onChange={e=>setForm(f=>({...f,contingency:+e.target.value}))}
              style={{ padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}/>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <button onClick={addRisk} disabled={saving||!form.title}
              style={{ padding:"8px 18px", borderRadius:8, border:"none", background:"#dc2626", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              {saving ? <><Loader2 size={13} className="animate-spin"/>Saving…</> : "Save Risk"}
            </button>
            <button onClick={()=>setShowAdd(false)} style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #e2e8f0", background:"#fff", fontSize:13, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Risk List */}
      {risks.length === 0 && !showAdd ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#94a3b8" }}>
          <Shield size={40} style={{ margin:"0 auto 12px", opacity:0.3 }}/>
          <p style={{ fontWeight:600 }}>No risks yet</p>
          <p style={{ fontSize:13 }}>Add your first risk to start the register</p>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {risks.map(r => (
            <div key={r.id} style={{ background:"#fff", borderRadius:12, border:`1px solid ${scoreColor(r.score)}30`, padding:"14px 16px", display:"grid", gridTemplateColumns:"auto 1fr auto auto", gap:12, alignItems:"start" }}>
              <div style={{ background:scoreBg(r.score), border:`1px solid ${scoreColor(r.score)}40`, borderRadius:8, padding:"6px 10px", textAlign:"center", minWidth:60 }}>
                <p style={{ fontSize:20, fontWeight:800, color:scoreColor(r.score), lineHeight:1 }}>{r.score}</p>
                <p style={{ fontSize:9, color:scoreColor(r.score), fontWeight:700 }}>{scoreLabel(r.score)}</p>
              </div>
              <div>
                <p style={{ fontSize:14, fontWeight:700, color:"#0f172a" }}>{r.title}</p>
                {r.description && <p style={{ fontSize:12, color:"#64748b", marginTop:2 }}>{r.description}</p>}
                <p style={{ fontSize:11, color:"#94a3b8", marginTop:4 }}>{r.category} · P:{r.probability} × I:{r.impact}{r.owner ? ` · ${r.owner}` : ""}{r.contingency ? ` · $${r.contingency.toLocaleString()} contingency` : ""}</p>
                {r.mitigation && <p style={{ fontSize:12, color:"#059669", marginTop:4 }}>↳ {r.mitigation}</p>}
              </div>
              <button onClick={()=>toggleStatus(r.id)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #e2e8f0", fontSize:11, fontWeight:600, cursor:"pointer", background: r.status==="OPEN"?"#fef2f2":r.status==="MITIGATED"?"#f0fdf4":"#f8fafc", color: r.status==="OPEN"?"#dc2626":r.status==="MITIGATED"?"#16a34a":"#64748b" }}>
                {r.status}
              </button>
              <button onClick={()=>deleteRisk(r.id)} style={{ background:"none", border:"none", cursor:"pointer", color:"#94a3b8", padding:4 }}><Trash2 size={14}/></button>
            </div>
          ))}
        </div>
      )}

      {risks.length > 0 && (
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e2e8f0", padding:16 }}>
          <div style={{ display:"flex", gap:16, alignItems:"center" }}>
            <TrendingUp size={16} style={{ color:"#7c3aed" }}/>
            <span style={{ fontSize:13, color:"#64748b" }}>
              Risk profile: <strong>{criticalCount} critical</strong> · <strong>{highCount} high</strong> · Total contingency: <strong>${totalContingency.toLocaleString()}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
