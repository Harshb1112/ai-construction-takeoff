"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  HardHat, Calculator, Camera, Clipboard,
  CheckCircle2, ChevronRight, Sparkles
} from "lucide-react";

// Every module in the app
const ALL_MODULES = [
  { id: "drawings",    label: "Drawings & Markup",  icon: "📐", desc: "PDF/DWG annotation & takeoff" },
  { id: "rooms",       label: "Room Analyzer",       icon: "🏠", desc: "Floor plan → 2D/3D/4D rooms" },
  { id: "model3d",     label: "3D BIM Viewer",       icon: "📦", desc: "IFC/DWG/DXF → 3D with BIM link" },
  { id: "takeoff",     label: "AI Takeoff",          icon: "🤖", desc: "Groq/Claude/LM Studio extraction" },
  { id: "extract",     label: "AI Extract",          icon: "✨", desc: "Room-wise material extraction" },
  { id: "photo-boq",   label: "Photo → BOQ",         icon: "📸", desc: "Site photo AI estimation" },
  { id: "boq",         label: "BOQ Editor",          icon: "📋", desc: "Hierarchical BOQ, GAEB, S-Curve" },
  { id: "costdb",      label: "Cost Database",       icon: "💰", desc: "98+ items, 14 regions, live pricing" },
  { id: "assemblies",  label: "Assemblies",          icon: "🔧", desc: "Parameterized quantity templates" },
  { id: "explorer",    label: "Data Explorer",       icon: "📊", desc: "Pivot BOQ → charts → export" },
  { id: "schedule",    label: "Schedule (4D+EVM)",   icon: "📅", desc: "Gantt · EVM · CPI · SPI" },
  { id: "kanban",      label: "BIM Kanban Tasks",    icon: "🗂️", desc: "Tasks linked to model elements" },
  { id: "punchlist",   label: "Punch List",          icon: "✅", desc: "5-stage deficiency workflow" },
  { id: "requirements",label: "Requirements (EAC)",  icon: "🛡️", desc: "Entity-Attribute-Constraint gates" },
  { id: "risk",        label: "Risk Register",       icon: "⚠️", desc: "Probability × Impact matrix" },
  { id: "chat",        label: "AI Chat",             icon: "💬", desc: "Streaming · Groq/Claude/LM Studio" },
  { id: "knowledge",   label: "Knowledge Base",      icon: "📚", desc: "PDF · AI Q&A with your docs" },
];

type Role = "admin" | "estimator" | "field";

const ROLES: {
  id: Role;
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  desc: string;
  modules: string[];
}[] = [
  {
    id: "admin",
    label: "Project Admin / Manager",
    icon: HardHat,
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
    desc: "Full access — manage projects, approve BOQs, track budgets & schedule",
    modules: ALL_MODULES.map(m => m.id), // all 17
  },
  {
    id: "estimator",
    label: "Cost Estimator / QS",
    icon: Calculator,
    color: "#7c3aed",
    bg: "#faf5ff",
    border: "#ddd6fe",
    desc: "Drawings, AI takeoff, BOQ editing, cost databases, assemblies & export",
    modules: ["drawings","rooms","takeoff","extract","photo-boq","boq","costdb","assemblies","explorer","requirements","chat","knowledge"],
  },
  {
    id: "field",
    label: "Field / Site Manager",
    icon: Camera,
    color: "#059669",
    bg: "#f0fdf4",
    border: "#bbf7d0",
    desc: "Site photos, punch list, schedule, kanban tasks & risk register",
    modules: ["drawings","photo-boq","schedule","kanban","punchlist","risk","chat","model3d"],
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());

  const selectRole = (role: typeof ROLES[0]) => {
    setSelectedRole(role.id);
    setEnabledModules(new Set(role.modules));
  };

  const toggleModule = (id: string) => {
    setEnabledModules(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const finish = () => {
    localStorage.setItem("user_role", selectedRole!);
    localStorage.setItem("enabled_modules", JSON.stringify([...enabledModules]));
    router.push("/dashboard");
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }} className="fade-up">

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#eff6ff", borderRadius: 99, padding: "6px 18px", marginBottom: 18 }}>
          <Sparkles size={14} color="#2563eb" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#2563eb" }}>Welcome to AI Construction Takeoff</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>
          {step === 1 ? "Select Your Role" : "Configure Your Modules"}
        </h1>
        <p style={{ fontSize: 15, color: "#64748b" }}>
          {step === 1
            ? "We'll pre-select the right tools for your workflow — you can change any time in Settings"
            : `${enabledModules.size} of ${ALL_MODULES.length} modules enabled · Toggle to customize`}
        </p>

        {/* Progress steps */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 20 }}>
          {[1, 2].map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: s <= step ? "#2563eb" : "#e2e8f0",
                color: s <= step ? "#fff" : "#94a3b8",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 14, transition: "all .3s",
              }}>
                {s < step ? <CheckCircle2 size={16} /> : s}
              </div>
              <span style={{ fontSize: 12, color: s <= step ? "#2563eb" : "#94a3b8", fontWeight: s === step ? 700 : 400 }}>
                {s === 1 ? "Choose Role" : "Set Modules"}
              </span>
              {s < 2 && <ChevronRight size={14} color="#cbd5e1" />}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Role Selection */}
      {step === 1 && (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
          {ROLES.map(role => {
            const Icon = role.icon;
            const active = selectedRole === role.id;
            return (
              <button
                key={role.id}
                onClick={() => selectRole(role)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start",
                  gap: 14, padding: 24, borderRadius: 16, textAlign: "left",
                  border: `2px solid ${active ? role.color : role.border}`,
                  background: active ? role.bg : "#fff",
                  cursor: "pointer", transition: "all .2s",
                  boxShadow: active ? `0 4px 20px ${role.color}22` : "none",
                }}
              >
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: `${role.color}15`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={24} color={role.color} />
                </div>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>{role.label}</p>
                  <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>{role.desc}</p>
                </div>
                <div style={{
                  fontSize: 11, color: role.color, fontWeight: 700,
                  background: `${role.color}15`, padding: "4px 10px", borderRadius: 99,
                }}>
                  {role.modules.length} modules pre-selected
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Step 2: Module Selection */}
      {step === 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>
          {ALL_MODULES.map(mod => {
            const on = enabledModules.has(mod.id);
            return (
              <button
                key={mod.id}
                onClick={() => toggleModule(mod.id)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px",
                  borderRadius: 12, border: `2px solid ${on ? "#2563eb" : "#e2e8f0"}`,
                  background: on ? "#eff6ff" : "#fff",
                  cursor: "pointer", textAlign: "left", transition: "all .15s",
                }}
              >
                <span style={{ fontSize: 22, lineHeight: 1 }}>{mod.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: on ? "#1d4ed8" : "#0f172a", lineHeight: 1 }}>{mod.label}</p>
                  <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, lineHeight: 1.4 }}>{mod.desc}</p>
                </div>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                  background: on ? "#2563eb" : "#e2e8f0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginTop: 2,
                }}>
                  {on && <CheckCircle2 size={12} color="#fff" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32, paddingTop: 24, borderTop: "1px solid #e2e8f0" }}>
        {step === 2 ? (
          <button
            onClick={() => setStep(1)}
            style={{ padding: "11px 24px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", fontSize: 14, fontWeight: 600, color: "#374151", cursor: "pointer" }}
          >
            ← Back
          </button>
        ) : <div />}

        <button
          onClick={step === 1 ? () => { if (selectedRole) setStep(2); } : finish}
          disabled={step === 1 && !selectedRole}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 32px", borderRadius: 10, border: "none",
            background: selectedRole || step === 2 ? "#2563eb" : "#e2e8f0",
            color: selectedRole || step === 2 ? "#fff" : "#94a3b8",
            fontSize: 14, fontWeight: 700, cursor: selectedRole || step === 2 ? "pointer" : "not-allowed",
            boxShadow: selectedRole || step === 2 ? "0 4px 14px rgba(37,99,235,.3)" : "none",
            transition: "all .2s",
          }}
        >
          {step === 1 ? "Next: Configure Modules" : `Start with ${enabledModules.size} Modules`}
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
