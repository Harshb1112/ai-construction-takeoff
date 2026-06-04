"use client";

import { useState, useEffect, useCallback } from "react";
import { Cpu, RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface LmModel { id: string; object: string }

interface Props {
  baseUrl: string;
  value: string;
  onChange: (modelId: string) => void;
  compact?: boolean;
}

/**
 * Fetches the list of loaded models from LM Studio and renders a selector.
 * Persists the selected model to localStorage("lmstudio_model").
 */
export function LmStudioModelPicker({ baseUrl, value, onChange, compact = false }: Props) {
  const [models, setModels]   = useState<LmModel[]>([]);
  const [status, setStatus]   = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError]     = useState("");

  const fetchModels = useCallback(async () => {
    if (!baseUrl.trim()) return;
    setStatus("loading");
    setError("");
    try {
      const url = baseUrl.replace(/\/v1\/?$/, ""); // normalise — strip trailing /v1
      const res = await fetch(`/api/lmstudio/models?baseUrl=${encodeURIComponent(url + "/v1")}`);
      const data = await res.json();
      if (data.status === "connected" && data.models?.length) {
        setModels(data.models);
        setStatus("ok");
        // Auto-select first model if nothing chosen yet
        const currentId = localStorage.getItem("lmstudio_model") ?? "";
        const found = data.models.find((m: LmModel) => m.id === currentId);
        const pick = found ? found.id : data.models[0].id;
        onChange(pick);
        localStorage.setItem("lmstudio_model", pick);
      } else {
        setStatus("error");
        setError(data.hint ?? data.error ?? "LM Studio offline");
        setModels([]);
      }
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
      setModels([]);
    }
  }, [baseUrl, onChange]);

  // Auto-fetch on mount / when baseUrl changes
  useEffect(() => { fetchModels(); }, [fetchModels]);

  const handleChange = (id: string) => {
    onChange(id);
    localStorage.setItem("lmstudio_model", id);
  };

  if (compact) {
    // Minimal inline picker for use in small spaces
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Cpu size={13} color="#059669" />
        {status === "loading" && <Loader2 size={13} color="#059669" className="animate-spin" />}
        {status === "ok" && models.length > 0 && (
          <select
            value={value}
            onChange={e => handleChange(e.target.value)}
            style={{
              fontSize: 11, fontWeight: 600, color: "#059669",
              border: "1px solid #bbf7d0", borderRadius: 6,
              background: "#f0fdf4", padding: "2px 6px", cursor: "pointer",
              maxWidth: 180,
            }}
          >
            {models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
        )}
        {status === "error" && (
          <span style={{ fontSize: 10, color: "#dc2626" }} title={error}>Offline</span>
        )}
        <button onClick={fetchModels} title="Refresh models" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "#94a3b8" }}>
          <RefreshCw size={11} />
        </button>
      </div>
    );
  }

  // Full picker card
  return (
    <div style={{
      border: "1px solid #bbf7d0", borderRadius: 10,
      background: "#f0fdf4", padding: "10px 14px",
      marginTop: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Cpu size={14} color="#059669" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>LM Studio — Select Model</span>
        <button
          onClick={fetchModels}
          disabled={status === "loading"}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", background: "none", border: "none", cursor: "pointer" }}
        >
          {status === "loading"
            ? <Loader2 size={12} className="animate-spin" />
            : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      {status === "loading" && (
        <div style={{ fontSize: 11, color: "#64748b" }}>Connecting to {baseUrl}…</div>
      )}

      {status === "error" && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <XCircle size={14} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#dc2626" }}>Cannot connect to LM Studio</p>
            <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{error}</p>
            <p style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
              Open LM Studio → Load a model → Start Local Server → check URL in Settings
            </p>
          </div>
        </div>
      )}

      {status === "ok" && models.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
            <CheckCircle2 size={12} color="#059669" />
            <span style={{ fontSize: 10, color: "#059669", fontWeight: 600 }}>
              {models.length} model{models.length > 1 ? "s" : ""} loaded
            </span>
          </div>
          <select
            value={value}
            onChange={e => handleChange(e.target.value)}
            style={{
              width: "100%", padding: "7px 10px", borderRadius: 8,
              border: "1px solid #bbf7d0", background: "#fff",
              fontSize: 12, fontWeight: 600, color: "#059669",
              cursor: "pointer", outline: "none",
            }}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          {(() => {
            const activeId = (value || models[0]?.id || "").toLowerCase();
            const isVision = ["vision","llava","qwen","minicpm","moondream","bakllava","cogvlm","deepseek-vl","internvl"].some(v => activeId.includes(v));
            return (
              <div style={{ marginTop: 6, fontSize: 10 }}>
                <span style={{ color: "#94a3b8" }}>Using: </span>
                <strong style={{ color: "#059669" }}>{value || models[0]?.id}</strong>
                {isVision ? (
                  <span style={{ marginLeft: 6, background: "#dcfce7", color: "#15803d", padding: "1px 6px", borderRadius: 99, fontWeight: 700 }}>✓ Vision supported</span>
                ) : (
                  <div style={{ marginTop: 4, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 8px", color: "#92400e", lineHeight: 1.5 }}>
                    ⚠️ <strong>Text-only model</strong> — images will be auto-skipped and the AI will estimate from text only.<br />
                    For drawing analysis load a vision model: <strong>LLaVA, Qwen2-VL, MiniCPM-V, Moondream</strong>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
