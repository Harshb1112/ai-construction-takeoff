"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Cpu, Wifi, WifiOff, RefreshCw, CheckCircle2,
  AlertCircle, Server, Zap, Eye, EyeOff, ExternalLink
} from "lucide-react";
import styles from "./page.module.css";

// ─── Roboflow section component ──────────────────────────────────
function RoboflowSection() {
  const [apiKey, setApiKey] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem("roboflow_api_key") ?? "") : ""
  );
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => {
    localStorage.setItem("roboflow_api_key", apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={styles.rfCard}>
      <div className={styles.rfHeader}>
        <div className={styles.rfIcon}>
          <Zap size={18} color="#fff" />
        </div>
        <div>
          <p className={styles.rfTitle}>Roboflow — CubiCasa5k Hosted Model</p>
          <p className={styles.rfSub}>YOLOv8 trained on 5,000 floor plans · detects rooms, doors, windows · 10k free calls/month</p>
        </div>
        <a
          href="https://universe.roboflow.com/floorplan-recognition/cubicasa5k-2-qpmsa"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.externalLink}
        >
          View Model <ExternalLink size={11} />
        </a>
      </div>

      <div className={styles.formRow}>
        <div className={styles.passwordWrap}>
          <input
            type={show ? "text" : "password"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="rf_xxxxxxxxxxxxxxxx  (get free at app.roboflow.com)"
            className={styles.passwordInput}
          />
          <button onClick={() => setShow(v => !v)} className={styles.eyeButton}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <button
          onClick={save}
          disabled={!apiKey.trim()}
          className={apiKey.trim() ? styles.saveButtonActive : styles.saveButtonDisabled}
        >
          {saved ? <><CheckCircle2 size={14} /> Saved!</> : "Save"}
        </button>
      </div>
      <p className={styles.hintText}>
        <strong>Pipeline priority:</strong> CubiCasa5k (local ML) → Roboflow (cloud) → OpenCV (local CV)<br />
        Add <code className={styles.inlineCode}>ROBOFLOW_API_KEY=rf_...</code> to <code className={styles.inlineCode}>.env.local</code> for server-side use.
      </p>
    </div>
  );
}

interface LmModel { id: string; object: string }
interface LmStatus { status: "connected" | "offline" | "loading"; models: LmModel[]; baseUrl: string; error?: string }

export default function SettingsPage() {
  // Read env URL (set by server) or localStorage fallback
  const savedUrl = typeof window !== "undefined"
    ? (localStorage.getItem("lmstudio_url") ?? process.env.NEXT_PUBLIC_LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1")
    : "http://localhost:1234/v1";

  const [lm, setLm]       = useState<LmStatus>({ status: "loading", models: [], baseUrl: savedUrl });
  const [lmUrl, setLmUrl] = useState(savedUrl);
  const [testError, setTestError] = useState("");

  // Ref so checkLmStudio (useCallback with [] deps) can read the latest lmUrl
  const lmUrlRef = useRef(lmUrl);
  lmUrlRef.current = lmUrl;

  const checkLmStudio = useCallback(async (url?: string) => {
    const testUrl = (url ?? lmUrlRef.current).replace(/\/+$/, "").replace(/\/models$/, "");
    setTestError("");
    try {
      const res = await fetch(`/api/lmstudio/models?baseUrl=${encodeURIComponent(testUrl)}`);
      const data = await res.json();
      if (data.status === "connected") {
        localStorage.setItem("lmstudio_url", testUrl);
      }
      setLm({
        status:  data.status === "connected" ? "connected" : "offline",
        models:  data.models ?? [],
        baseUrl: testUrl,
        error:   data.error,
      });
    } catch (e) {
      setTestError((e as Error).message);
      setLm({ status: "offline", models: [], baseUrl: lmUrlRef.current, error: "Cannot reach LM Studio API" });
    }
  }, []);

  useEffect(() => { void checkLmStudio(); }, [checkLmStudio]);

  return (
    <div className={`${styles.page} fade-up`}>
      <div>
        <h2 className={styles.pageTitle}>Settings</h2>
        <p className={styles.pageDescription}>Configure AI providers and connections</p>
      </div>

      {/* ─── LM Studio ───────────────────────────────────────── */}
      <div className={styles.card}>
        {/* Header */}
        <div className={`${styles.sectionHeader} ${lm.status === "connected" ? styles.statusConnected : styles.statusOffline}`}>
          <div className={`${styles.iconBadge} ${lm.status === "connected" ? styles.connectedBadge : styles.offlineBadge}`}>
            <Cpu size={20} color={lm.status === "connected" ? "#16a34a" : "#dc2626"} />
          </div>
          <div className={styles.cardTitleGroup}>
            <p className={styles.cardTitle}>LM Studio — Local AI</p>
            <div className={styles.statusRow}>
              {lm.status === "loading" ? (
                <RefreshCw size={13} color="#94a3b8" className="spin" />
              ) : lm.status === "connected" ? (
                <Wifi size={13} color="#16a34a" />
              ) : (
                <WifiOff size={13} color="#dc2626" />
              )}
              <span className={`${styles.statusText} ${
                lm.status === "connected" ? styles.statusTextConnected :
                lm.status === "loading"   ? styles.statusTextLoading  :
                styles.statusTextOffline
              }`}>
                {lm.status === "loading"
                  ? "Checking..."
                  : lm.status === "connected"
                    ? `Connected — ${lm.models.length} model${lm.models.length !== 1 ? "s" : ""} loaded`
                    : "Offline"}
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              setLm(p => ({ ...p, status: "loading" }));
              void checkLmStudio();
            }}
            className={styles.actionButton}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        <div className={styles.cardBody}>
          {/* Models list */}
          {lm.status === "connected" && lm.models.length > 0 && (
            <div>
              <p className={styles.cardCaption}>Loaded Models</p>
              <div className={styles.modelList}>
                {lm.models.map(m => (
                  <div key={m.id} className={styles.modelRow}>
                    <div className={`${styles.statusDot} ${styles.dotGreen}`} />
                    <div className={styles.cardTitleGroup}>
                      <p className={styles.modelId}>{m.id}</p>
                      <p className={styles.subtitle}>Ready for inference</p>
                    </div>
                    <span className={styles.modelStatus}>Active</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Offline instructions */}
          {lm.status === "offline" && (
            <div className={styles.alertPanel}>
              <div className={styles.alertRow}>
                <AlertCircle size={18} color="#dc2626" className={styles.alertIcon} />
                <div>
                  <p className={styles.alertTitle}>LM Studio is not running</p>
                  <ol className={styles.stepList}>
                    <li>Open <strong>LM Studio</strong> app on your computer</li>
                    <li>Go to <strong>Developer tab</strong> (≡ icon)</li>
                    <li>Click <strong>&ldquo;Start Server&rdquo;</strong> — default port 1234</li>
                    <li>In <strong>Models tab</strong> — load any model</li>
                    <li>Click <strong>Refresh</strong> above ↑</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* Base URL */}
          <div>
            <label className={styles.cardCaption}>
              <Server size={13} className={styles.iconInline} />
              LM Studio Server URL
            </label>
            <div className={styles.formRow}>
              <input
                value={lmUrl}
                onChange={e => setLmUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    setLm(p => ({ ...p, status: "loading" }));
                    void checkLmStudio(lmUrl);
                  }
                }}
                placeholder="http://192.168.1.31:443/v1"
                className={styles.textInput}
              />
              <button
                onClick={() => {
                  setLm(p => ({ ...p, status: "loading" }));
                  void checkLmStudio(lmUrl);
                }}
                disabled={lm.status === "loading"}
                className={lm.status === "loading" ? styles.testButtonDisabled : styles.testButtonActive}
              >
                {lm.status === "loading" ? <RefreshCw size={13} className="spin" /> : <Wifi size={13} />}
                Test &amp; Connect
              </button>
            </div>

            {/* Error detail */}
            {testError && lm.status === "offline" && (
              <div className={styles.errorBox}>{testError}</div>
            )}

            {lm.status === "connected" && (
              <div className={styles.successBox}>
                ✓ Connected to {lm.baseUrl} — {lm.models.length} model(s) available
              </div>
            )}

            <div className={styles.commonUrls}>
              <p>Common URLs:</p>
              {["http://localhost:1234/v1", "http://192.168.1.31:443/v1", "http://192.168.1.31:1234/v1"].map(u => (
                <button key={u} onClick={() => {
                  setLmUrl(u);
                  setLm(p => ({ ...p, status: "loading" }));
                  void checkLmStudio(u);
                }} className={styles.linkButton}>
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* How to use in the app */}
          <div className={styles.infoCard}>
            <p className={styles.infoTitle}>
              <Zap size={14} /> How to use LM Studio in the app
            </p>
            <ul className={styles.infoList}>
              <li><strong>AI Chat</strong> → Select &ldquo;LM Studio (Local)&rdquo; from provider dropdown</li>
              <li><strong>AI Takeoff</strong> → Select &ldquo;LM Studio&rdquo; tab → Run AI Takeoff</li>
              <li><strong>Room Analyzer</strong> → Select &ldquo;LM Studio&rdquo; provider</li>
              <li><strong>Drawing AI Assistant</strong> → Click &ldquo;LM Studio&rdquo; in provider selector</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ─── Roboflow API Key ───────────────────────────────── */}
      <RoboflowSection />

      {/* ─── LM Studio Status ────────────────────────────────── */}
      <div className={styles.smallStatusCard}>
        <h3 className={styles.smallStatusTitle}>LM Studio Status</h3>
        <div className={lm.status === "connected" ? styles.statusSummaryConnected : styles.statusSummaryOffline}>
          <div className={`${styles.statusDot} ${lm.status === "connected" ? styles.dotGreen : styles.dotOffline}`} />
          <div>
            <p className={`${styles.statusLabel} ${lm.status === "connected" ? styles.connectedText : styles.offlineText}`}>
              {lm.status === "connected"
                ? `Connected — ${lm.models.length} model${lm.models.length !== 1 ? "s" : ""} loaded`
                : lm.status === "loading" ? "Connecting…"
                : "Offline — open LM Studio and start Local Server"}
            </p>
            <p className={styles.subtitle}>{lm.baseUrl}</p>
          </div>
          <a href="/lm-setup" className={styles.setupLink}>
            Full Setup →
          </a>
        </div>
        {lm.status === "connected" && lm.models.length > 0 && (
          <div className={styles.smallModelsList}>
            <p className={styles.smallModelsLabel}>Loaded Models</p>
            <div className={styles.cardSubsection}>
              {lm.models.map(m => (
                <div key={m.id} className={styles.smallModelRow}>
                  <div className={`${styles.smallDot} pulse`} />
                  <p className={styles.smallModelName}>{m.id}</p>
                  <span className={styles.smallActiveBadge}>Active</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
