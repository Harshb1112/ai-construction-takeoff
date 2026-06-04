"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Cpu, Wifi, WifiOff, RefreshCw, CheckCircle2,
  AlertCircle, Loader2, ExternalLink, ChevronRight,
  Server, Zap, Eye, MessageSquare, Camera
} from "lucide-react";
import styles from "./page.module.css";

interface LmModel { id: string }

type FeatureColorKey = "blue" | "purple" | "green" | "amber" | "cyan" | "red";

const FEATURES = [
  { icon: MessageSquare, label: "AI Chat",            needs: "Any model",     colorKey: "blue"   as FeatureColorKey },
  { icon: Camera,        label: "Photo → BOQ",         needs: "Vision model*", colorKey: "purple" as FeatureColorKey },
  { icon: Eye,           label: "Floor Plan Analyzer", needs: "Vision model*", colorKey: "green"  as FeatureColorKey },
  { icon: Zap,           label: "AI Takeoff",          needs: "Vision model*", colorKey: "amber"  as FeatureColorKey },
  { icon: Server,        label: "BOQ Generation",      needs: "Any model",     colorKey: "cyan"   as FeatureColorKey },
  { icon: CheckCircle2,  label: "Knowledge Base Q&A",  needs: "Any model",     colorKey: "red"    as FeatureColorKey },
];

const VISION_MODELS = ["LLaVA", "Qwen2-VL", "MiniCPM-V", "BakLLaVA", "Moondream", "InternVL"];

const featureIconClassMap: Record<FeatureColorKey, string> = {
  blue:   styles.featureIconBlue,
  purple: styles.featureIconPurple,
  green:  styles.featureIconGreen,
  amber:  styles.featureIconAmber,
  cyan:   styles.featureIconCyan,
  red:    styles.featureIconRed,
};

export default function LmSetupPage() {
  const router = useRouter();
  const [url, setUrl] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem("lmstudio_url") ?? "http://localhost:1234/v1") : "http://localhost:1234/v1"
  );
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [models, setModels] = useState<LmModel[]>([]);
  const [selectedModel, setSelectedModel] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem("lmstudio_model") ?? "") : ""
  );
  const [errorMsg, setErrorMsg] = useState("");

  // Keep a ref so check() can read the latest selectedModel without being in its deps
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;

  const check = useCallback(async (testUrl?: string) => {
    const u = (testUrl ?? url).replace(/\/+$/, "");
    const base = u.endsWith("/v1") ? u : `${u}/v1`;
    setStatus("checking");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/lmstudio/models?baseUrl=${encodeURIComponent(base)}`);
      const data = await res.json();
      if (data.status === "connected" && data.models?.length) {
        setModels(data.models);
        setStatus("ok");
        localStorage.setItem("lmstudio_url", base);
        const current = selectedModelRef.current;
        if (!current || !data.models.find((m: LmModel) => m.id === current)) {
          setSelectedModel(data.models[0].id);
          localStorage.setItem("lmstudio_model", data.models[0].id);
        }
      } else {
        setStatus("error");
        setErrorMsg(data.hint ?? data.error ?? "LM Studio is not running or no model is loaded");
        setModels([]);
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg((e as Error).message);
      setModels([]);
    }
  }, [url]);

  useEffect(() => { check(); }, [check]);

  const handleModelChange = (id: string) => {
    setSelectedModel(id);
    localStorage.setItem("lmstudio_model", id);
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
    setStatus("idle");
  };

  const activeModel = models.find(m => m.id === selectedModel) ?? models[0];
  const isVision = activeModel?.id
    ? VISION_MODELS.some(v => activeModel.id.toLowerCase().includes(v.toLowerCase()))
    : false;

  // Derive class names from status
  const connectCardClass =
    status === "ok" ? styles.connectCardOk :
    status === "error" ? styles.connectCardError :
    styles.connectCardIdle;

  const urlInputClass =
    status === "ok" ? styles.urlInputOk :
    status === "error" ? styles.urlInputError :
    styles.urlInputIdle;

  const connectBtnClass =
    status === "checking" ? styles.connectBtnChecking : styles.connectBtnActive;

  const step2BadgeClass = status === "ok" ? styles.stepBadgeGreen : styles.stepBadgeBlue;

  return (
    <div className={`${styles.page} fade-up`}>

      {/* Header */}
      <div>
        <div className={styles.headerRow}>
          <div className={styles.headerIcon}>
            <Cpu size={22} color="#fff" />
          </div>
          <div>
            <h1 className={styles.headerTitle}>LM Studio — Master AI Setup</h1>
            <p className={styles.headerSub}>Run ALL AI features 100% locally · No API keys · No internet required</p>
          </div>
        </div>
      </div>

      {/* Step 1 — Install & Start */}
      <div className={styles.card}>
        <p className={styles.stepLabel}>
          <span className={styles.stepBadgeBlue}>1</span>
          Install &amp; Start LM Studio
        </p>
        <div className={styles.installGrid}>
          {[
            { step: "Download LM Studio", url: "https://lmstudio.ai", desc: "Free — Windows / Mac / Linux" },
            { step: "Load a model", url: null, desc: `For ALL features: load a vision model\n(${VISION_MODELS.slice(0, 3).join(", ")}, etc.)` },
            { step: "Start Local Server", url: null, desc: "Developer tab → Start Server\nDefault port: 1234" },
            { step: "Connect below ↓", url: null, desc: "Enter your IP if LM Studio is on another PC" },
          ].map(({ step, url: href, desc }) => (
            <div key={step} className={styles.installItem}>
              <div className={styles.installItemHeader}>
                <p className={styles.installItemTitle}>{step}</p>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.installLink}
                    aria-label="Download LM Studio"
                  >
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
              <p className={styles.installItemDesc}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Step 2 — Connect */}
      <div className={connectCardClass}>
        <p className={styles.stepLabel}>
          <span className={step2BadgeClass}>2</span>
          Connect to LM Studio
        </p>
        <div className={styles.connectRow}>
          <input
            value={url}
            onChange={handleUrlChange}
            onKeyDown={e => e.key === "Enter" && check(url)}
            placeholder="http://localhost:1234/v1"
            className={urlInputClass}
          />
          <button
            onClick={() => check(url)}
            disabled={status === "checking"}
            className={connectBtnClass}
          >
            {status === "checking" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {status === "checking" ? "Checking…" : "Test & Connect"}
          </button>
        </div>

        {/* Status display */}
        <div className={styles.statusDisplay}>
          {status === "ok" && (
            <div className={styles.statusOkBox}>
              <Wifi size={16} color="#059669" />
              <span className={styles.statusOkText}>Connected — {models.length} model{models.length !== 1 ? "s" : ""} loaded</span>
            </div>
          )}
          {status === "error" && (
            <div className={styles.statusErrorBox}>
              <WifiOff size={16} color="#dc2626" className={styles.statusErrorIcon} />
              <div>
                <p className={styles.statusErrorTitle}>Cannot connect</p>
                <p className={styles.statusErrorMsg}>{errorMsg}</p>
              </div>
            </div>
          )}
          {status === "idle" && (
            <p className={styles.statusIdleText}>Enter your LM Studio server URL and click Test &amp; Connect</p>
          )}
        </div>

        {/* Common URLs */}
        <div className={styles.quickRow}>
          <span className={styles.quickLabel}>Quick:</span>
          {["http://localhost:1234/v1", "http://127.0.0.1:1234/v1"].map(u => (
            <button key={u} onClick={() => { setUrl(u); check(u); }} className={styles.quickBtn}>{u}</button>
          ))}
        </div>
      </div>

      {/* Step 3 — Select Model */}
      {status === "ok" && models.length > 0 && (
        <div className={styles.card}>
          <p className={styles.stepLabel}>
            <span className={styles.stepBadgePurple}>3</span>
            Select Active Model
          </p>
          <div className={styles.modelList}>
            {models.map(m => {
              const isVis = VISION_MODELS.some(v => m.id.toLowerCase().includes(v.toLowerCase()));
              const isSel = m.id === (selectedModel || models[0]?.id);
              return (
                <button
                  key={m.id}
                  onClick={() => handleModelChange(m.id)}
                  className={isSel ? styles.modelBtnSelected : styles.modelBtnUnselected}
                >
                  <div className={isVis ? styles.modelDotVision : styles.modelDotText} />
                  <div className={styles.modelInfo}>
                    <p className={styles.modelName}>{m.id}</p>
                    <p className={isVis ? styles.modelTypeVision : styles.modelTypeText}>
                      {isVis ? "✓ Vision + Text — all features" : "Text only — chat, BOQ, knowledge (no image analysis)"}
                    </p>
                  </div>
                  {isSel && <CheckCircle2 size={16} color="#2563eb" />}
                </button>
              );
            })}
          </div>
          {!isVision && (
            <div className={styles.warnBox}>
              <strong>⚠️ Text-only model detected.</strong> To use PDF Takeoff, Floor Plan Analyzer, and Photo BOQ, load a <strong>vision model</strong> in LM Studio: {VISION_MODELS.slice(0, 3).join(", ")}, etc.
              <br />All other AI features (chat, BOQ editor, knowledge base) will work fine.
            </div>
          )}
          {isVision && (
            <div className={styles.successBox}>
              <strong>✓ Vision model — all features enabled.</strong> This model supports both text and image analysis.
            </div>
          )}
        </div>
      )}

      {/* Features covered */}
      <div className={styles.card}>
        <p className={styles.featuresTitle}>LM Studio covers ALL these AI features:</p>
        <div className={styles.featuresGrid}>
          {FEATURES.map(({ icon: Icon, label, needs, colorKey }) => {
            const needsVision = needs.includes("*");
            const available = !needsVision || isVision;
            const featureItemClass =
              status === "ok" && available ? styles.featureItemAvailable :
              status === "ok" && !available ? styles.featureItemUnavailable :
              styles.featureItemDefault;
            const iconColorClass = featureIconClassMap[colorKey];
            return (
              <div key={label} className={featureItemClass}>
                <div className={`${styles.featureIconWrap} ${iconColorClass}`}>
                  <Icon size={14} />
                </div>
                <div>
                  <p className={styles.featureName}>{label}</p>
                  <p className={
                    needsVision
                      ? (isVision ? styles.featureNeedsVisionReady : styles.featureNeedsVisionWarn)
                      : styles.featureNeedsAny
                  }>
                    {needsVision ? (isVision ? "✓ Vision ready" : "⚠ Needs vision model") : "✓ Any model"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Done button */}
      {status === "ok" && (
        <button onClick={() => router.push("/dashboard")} className={styles.doneBtn}>
          <CheckCircle2 size={18} />
          LM Studio ready — Go to Dashboard
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
