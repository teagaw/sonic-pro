/**
 * MixHealthDashboard.jsx — Sonic Pro UI v5 (Supabase Cloud Sync)
 *
 * New in v5:
 *   - Lazy auth: core DSP works without login; auth gate only on Save/Library
 *   - Save to Library button (fires AuthModal if not signed in)
 *   - Library panel (slide-in, shows saved analyses)
 *   - PrintPreviewModal (A4 preview before window.print())
 *   - Toast notification system (no external library)
 *   - Graceful Supabase degradation (buttons disabled with tooltip if unconfigured)
 *
 * DSP Worker and audio processing are 100% unchanged.
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { useAudioAnalyzer }     from "../hooks/useAudioAnalyzer";
import { getAllProfiles }        from "../constants/targetProfiles";
import { useAuth }              from "../hooks/useAuth";
import { useLibrary }           from "../hooks/useLibrary";
import { useWorkerContext }     from "../context/AudioWorkerContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { AuthModal }            from "./AuthModal";
import { LibraryPanel }         from "./LibraryPanel";
import { PrintPreviewModal }    from "./PrintPreviewModal";

// ─────────────────────────────────────────────────────────────
//  DESIGN TOKENS — using CSS variables for theme support
// ─────────────────────────────────────────────────────────────
const T = {
  bg0:       "var(--bg0)",
  bg1:       "var(--bg1)",
  bg2:       "var(--bg2)",
  bg3:       "var(--bg3)",
  border:    "var(--border)",
  borderBright: "var(--border-bright)",
  textPrim:  "var(--text-prim)",
  textMuted: "var(--text-muted)",
  textDim:   "var(--text-dim)",
  cyan:      "var(--cyan)",
  orange:    "var(--orange)",
  green:     "var(--green)",
  yellow:    "var(--yellow)",
  red:       "var(--red)",
  purple:    "var(--purple)",
};

const BAND_META = {
  sub:   { label: "SUB BASS",      range: "20–60 Hz",   color: "#7b5cff" },
  mud:   { label: "LOW-MID / MUD", range: "200–500 Hz", color: "#00c8ff" },
  harsh: { label: "PRESENCE",      range: "2–4 kHz",    color: "#ffb800" },
  air:   { label: "AIR",           range: "10 kHz+",    color: "#00ff87" },
};

const LABEL_COLORS = {
  "INTRO": "#555588", "VERSE": "#4477aa", "BUILD": "#aa7700",
  "DROP / CHORUS": "#cc2255", "BREAKDOWN": "#335544", "OUTRO": "#444466",
  "BROADBAND INTRO": "#6655aa", "BROADBAND BUILD": "#cc9900",
  "BROADBAND DROP": "#dd3366", "BROADBAND OUTRO": "#554477",
  "BROADBAND SECTION": "#336688",
};

// ─────────────────────────────────────────────────────────────
//  GLOBAL STYLES
// ─────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg0); color: var(--text-prim); font-family: 'Rajdhani', sans-serif;
    font-size: 15px; letter-spacing: 0.03em; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg1); }
  ::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 3px; }
  .mono { font-family: 'IBM Plex Mono', monospace; }
  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
`;

// ─────────────────────────────────────────────────────────────
//  TOAST SYSTEM (lightweight, no library)
// ─────────────────────────────────────────────────────────────
const TOAST_DURATION = 4000;

/**
 * useToasts — minimal toast state manager.
 * @returns {{ toasts, addToast, removeToast }}
 */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const addToast = useCallback((message, type = "info") => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), TOAST_DURATION);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

const TOAST_COLORS = {
  success: T.green,
  error:   T.red,
  warning: T.yellow,
  info:    T.cyan,
};

function ToastContainer({ toasts, onRemove }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", bottom: "24px", right: "24px",
      zIndex: 900, display: "flex", flexDirection: "column", gap: "8px",
      maxWidth: "360px" }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => onRemove(t.id)}
          style={{ background: T.bg1, border: `1px solid ${TOAST_COLORS[t.type] ?? T.cyan}66`,
            borderLeft: `3px solid ${TOAST_COLORS[t.type] ?? T.cyan}`,
            borderRadius: "4px", padding: "12px 16px",
            fontSize: "12px", color: T.textPrim, cursor: "pointer",
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            animation: "slideIn 0.2s ease-out",
            fontFamily: "'Rajdhani', sans-serif", letterSpacing: "0.04em" }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  SHARED UTILITY COMPONENTS
// ─────────────────────────────────────────────────────────────

function Panel({ title, accent = T.purple, children, style = {} }) {
  return (
    <div style={{ background: T.bg1, border: `1px solid ${T.border}`,
      borderTop: `2px solid ${accent}`, borderRadius: "4px", padding: "20px", ...style }}>
      {title && (
        <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
          fontSize: "11px", letterSpacing: "0.18em", color: accent,
          textTransform: "uppercase", marginBottom: "16px",
          display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%",
            background: accent, boxShadow: `0 0 8px ${accent}` }} />
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function LedMeter({ value, max = 100, color = T.green, segments = 20, style = {} }) {
  const filled = Math.round((value / max) * segments);
  return (
    <div style={{ display: "flex", gap: "2px", ...style }}>
      {Array.from({ length: segments }, (_, i) => {
        const active = i < filled;
        const c = i > segments * 0.85 ? T.red : i > segments * 0.65 ? T.yellow : color;
        return <div key={i} style={{ flex: 1, height: "8px", borderRadius: "1px",
          background: active ? c : T.bg3, boxShadow: active ? `0 0 4px ${c}88` : "none",
          transition: "background 0.1s" }} />;
      })}
    </div>
  );
}

function DeltaBar({ delta, maxDb = 12 }) {
  const clamped = Math.max(-maxDb, Math.min(maxDb, delta));
  const pct = (Math.abs(clamped) / maxDb) * 50;
  const pos = clamped >= 0;
  return (
    <div style={{ position: "relative", height: "16px", background: T.bg3,
      borderRadius: "2px", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "1px",
        background: T.borderBright, transform: "translateX(-50%)" }} />
      <div style={{ position: "absolute", top: "2px", bottom: "2px", width: `${pct}%`,
        left: pos ? "50%" : `${50 - pct}%`,
        background: pos ? T.cyan : T.orange,
        boxShadow: pos ? `0 0 8px ${T.cyan}66` : `0 0 8px ${T.orange}66`,
        borderRadius: "1px", transition: "width 0.4s ease, left 0.4s ease" }} />
    </div>
  );
}

function Stat({ label, value, unit = "", color = T.textPrim, glow = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: T.textMuted,
        textTransform: "uppercase" }}>{label}</div>
      <div className="mono" style={{ fontSize: "22px", fontWeight: 500, color,
        textShadow: glow ? `0 0 12px ${color}` : "none", lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: "12px", color: T.textMuted,
          marginLeft: "3px" }}>{unit}</span>}
      </div>
    </div>
  );
}

const SEVERITY_STYLE = {
  critical: { bg: "#ff306022", border: T.red,    icon: "⚠", label: "CRITICAL" },
  warning:  { bg: "#ffd00022", border: T.yellow, icon: "▲", label: "WARNING"  },
  info:     { bg: "#a06dff22", border: T.purple, icon: "ℹ", label: "INFO"     },
};

function WarningBadge({ type, severity, message }) {
  const s = SEVERITY_STYLE[severity] || SEVERITY_STYLE.info;
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}44`,
      borderLeft: `3px solid ${s.border}`, borderRadius: "3px",
      padding: "10px 14px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
      <span style={{ fontSize: "14px", color: s.border, flexShrink: 0,
        marginTop: "1px" }}>{s.icon}</span>
      <div>
        <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: s.border,
          fontWeight: 700, marginBottom: "4px" }}>{type} — {s.label}</div>
        <div style={{ fontSize: "13px", color: T.textPrim, lineHeight: 1.5 }}>{message}</div>
      </div>
    </div>
  );
}

/**
 * HeaderBtn — reusable header action button.
 * When `disabled` with a `disabledTooltip`, shows a native title tooltip.
 */
function HeaderBtn({ onClick, color, children, disabled = false, disabledTooltip, title }) {
  const tooltip = disabled ? disabledTooltip : title;
  return (
    <button onClick={disabled ? undefined : onClick} title={tooltip}
      style={{ background: "transparent", border: `1px solid ${disabled ? T.border : T.border}`,
        borderRadius: "3px", color: disabled ? T.textDim : color,
        padding: "6px 14px", fontSize: "11px", letterSpacing: "0.1em",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, transition: "all 0.15s",
        opacity: disabled ? 0.5 : 1 }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = `0 0 8px ${color}66`; } }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//  TRACK LOADER
// ─────────────────────────────────────────────────────────────
function TrackLoader({ trackType, trackState, onLoad }) {
  const fileInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const isUser = trackType === "user";
  const accent = isUser ? T.cyan : T.orange;
  const label  = isUser ? "USER MIX" : "REFERENCE TRACK";

  const handleFiles = useCallback((files) => {
    if (files && files[0]) onLoad(files[0], trackType);
  }, [onLoad, trackType]);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const statusLabel = {
    idle: "Drop audio file or click to browse",
    decoding: "Decoding audio…",
    analyzing: `Analyzing… ${trackState.progress}%`,
    done: trackState.fileName,
    error: `Error: ${trackState.error}`,
  }[trackState.status] || "";

  const statusColor = { error: T.red, done: T.green, analyzing: T.yellow,
    decoding: T.yellow }[trackState.status] || T.textMuted;

  return (
    <div style={{ background: dragging ? `${accent}11` : T.bg2,
      border: `1.5px dashed ${dragging ? accent : T.border}`, borderRadius: "4px",
      padding: "24px 20px", cursor: "pointer", transition: "all 0.2s",
      position: "relative", overflow: "hidden" }}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px",
        background: accent, opacity: trackState.status === "done" ? 1 : 0.4,
        boxShadow: `0 0 16px ${accent}` }} />
      <input ref={fileInputRef} type="file" accept="audio/*"
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)} />
      <div style={{ display: "flex", alignItems: "center",
        justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ fontSize: "10px", letterSpacing: "0.2em",
          fontWeight: 700, color: accent }}>{label}</div>
        <div style={{ width: "8px", height: "8px", borderRadius: "50%",
          background: trackState.status === "done" ? T.green
            : trackState.status === "error" ? T.red
            : trackState.status === "idle" ? T.textDim : T.yellow,
          boxShadow: trackState.status === "done" ? `0 0 10px ${T.green}` : "none",
          animation: ["analyzing","decoding"].includes(trackState.status)
            ? "pulse 1s ease-in-out infinite" : "none" }} />
      </div>
      <div className="mono" style={{ fontSize: "12px", color: statusColor,
        wordBreak: "break-all", lineHeight: 1.4 }}>{statusLabel}</div>
      {["analyzing","decoding"].includes(trackState.status) && (
        <div style={{ marginTop: "12px" }}>
          <LedMeter value={trackState.progress} color={accent} />
          <div style={{ marginTop: "10px", display: "flex",
            flexDirection: "column", gap: "6px" }}>
            {[85, 65, 75].map((w, i) => (
              <div key={i} style={{ height: "8px", width: `${w}%`,
                background: `${accent}22`, borderRadius: "2px",
                animation: "pulse 1.4s ease-in-out infinite",
                animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PROFILE SELECTOR
// ─────────────────────────────────────────────────────────────
function ProfileSelectorPanel({ selectedProfileId, onChange }) {
  const profiles = getAllProfiles();
  const selected = profiles[selectedProfileId];
  return (
    <Panel title="Comparison Mode" accent={T.purple}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <label style={{ fontSize: "10px", color: T.textMuted,
          textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Target Profile
        </label>
        <select value={selectedProfileId} onChange={(e) => onChange(e.target.value)}
          style={{ background: T.bg2, border: `1px solid ${T.border}`,
            color: T.textPrim, padding: "8px 12px", borderRadius: "3px",
            fontFamily: "'Rajdhani', sans-serif", fontSize: "13px",
            cursor: "pointer", width: "100%", outline: "none" }}>
          <option value="none">None (Reference Track Only)</option>
          {Object.values(profiles).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.isCustom ? " ★" : ""}
            </option>
          ))}
        </select>
        <div style={{ fontSize: "11px", color: T.textMuted, lineHeight: 1.5 }}>
          {selected
            ? <><strong style={{ color: T.textPrim }}>{selected.name}:</strong> {selected.description}</>
            : "Load a Reference track, or select a genre profile for instant target comparison."}
        </div>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
//  DELTA PANEL
// ─────────────────────────────────────────────────────────────
function DeltaPanel({ delta, selectedProfileId }) {
  if (!delta) {
    return (
      <Panel title="Delta Engine" accent={T.cyan}>
        <div style={{ color: T.textMuted, fontSize: "13px",
          textAlign: "center", padding: "20px 0" }}>
          Load a track and reference (or select a profile) to see frequency comparison.
        </div>
      </Panel>
    );
  }
  const profiles = getAllProfiles();
  const profile  = selectedProfileId !== "none" ? profiles[selectedProfileId] : null;
  const isProfileMode = delta.profileMode === true;
  const modeLabel = isProfileMode && profile
    ? `Comparing Against: ${profile.name}`
    : "Reference Comparison (Loudness Matched)";

  return (
    <Panel title={`Delta Engine — ${modeLabel}`} accent={T.cyan}>
      <details style={{ marginBottom: "12px", cursor: "pointer" }}>
        <summary style={{ fontSize: "11px", letterSpacing: "0.12em", color: T.textMuted,
          textTransform: "uppercase", userSelect: "none",
          display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: T.purple, fontSize: "13px" }}>ℹ</span>
          {isProfileMode ? "How Profile Comparison Works" : "What is Loudness Matching?"}
        </summary>
        <div style={{ marginTop: "8px", padding: "12px 14px",
          background: `${T.purple}14`, border: `1px solid ${T.purple}33`,
          borderRadius: "3px", fontSize: "12px", color: T.textMuted, lineHeight: 1.6 }}>
          {isProfileMode
            ? "Profile comparison anchors your mix at its median band level and compares each band against the genre target shape. Positive delta = more energy than the profile."
            : "Both tracks are matched to equal perceived loudness (LUFS) before comparison, so you see tonal balance differences — not volume differences."}
        </div>
      </details>

      {isProfileMode ? (
        <div style={{ padding: "10px 14px", background: `${T.purple}18`,
          border: `1px solid ${T.purple}44`, borderLeft: `3px solid ${T.purple}`,
          borderRadius: "3px", fontSize: "12px", color: T.textMuted,
          marginBottom: "16px", display: "flex",
          justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
          <span>Mode: <span style={{ color: T.purple }}>Genre Profile</span></span>
          <span>Profile: <span style={{ color: T.textPrim }}>{profile?.name ?? "—"}</span></span>
          <span>Your LUFS: <span className="mono" style={{ color: T.cyan }}>{delta.userLufs}</span></span>
        </div>
      ) : (
        delta.gainOffset !== undefined && (
          <div style={{ padding: "10px 14px", background: `${T.purple}18`,
            border: `1px solid ${T.purple}44`, borderLeft: `3px solid ${T.purple}`,
            borderRadius: "3px", fontSize: "12px", color: T.textMuted,
            marginBottom: "16px", display: "flex",
            justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <span>Your mix: <span className="mono" style={{ color: T.cyan }}>{delta.userLufs} LUFS</span></span>
            <span>Reference: <span className="mono" style={{ color: T.orange }}>{delta.referenceLufs} LUFS</span></span>
            <span>Offset: <span className="mono" style={{ color: T.purple }}>
              {delta.gainOffset > 0 ? "+" : ""}{delta.gainOffset} dB</span></span>
          </div>
        )
      )}

      <div style={{ display: "grid", gap: "20px" }}>
        {Object.entries(delta.bands ?? {}).map(([key, band]) => {
          const meta = BAND_META[key];
          const abs  = Math.abs(band.delta);
          const pos  = band.delta >= 0;
          return (
            <div key={key}>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "flex-end", marginBottom: "8px" }}>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: 700,
                    color: meta.color, letterSpacing: "0.1em" }}>{meta.label}</span>
                  <span className="mono" style={{ fontSize: "11px",
                    color: T.textMuted, marginLeft: "8px" }}>{meta.range}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="mono" style={{ fontSize: "18px", fontWeight: 500,
                    color: abs < 0.5 ? T.green : abs < 3 ? T.yellow : T.red,
                    textShadow: abs < 0.5 ? `0 0 8px ${T.green}` : abs < 3 ? `0 0 8px ${T.yellow}` : `0 0 8px ${T.red}` }}>
                    {pos ? "+" : ""}{band.delta.toFixed(1)}
                  </span>
                  <span style={{ fontSize: "10px", color: T.textMuted }}>dBFS</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "16px", marginBottom: "8px" }}>
                <div className="mono" style={{ fontSize: "11px", color: T.cyan }}>
                  YOUR MIX: {band.userDb.toFixed(1)} dB</div>
                <div className="mono" style={{ fontSize: "11px",
                  color: isProfileMode ? T.purple : T.orange }}>
                  {isProfileMode ? "TARGET:" : "REFERENCE:"} {band.refDb.toFixed(1)} dB</div>
              </div>
              <DeltaBar delta={band.delta} maxDb={12} />
              <div style={{ marginTop: "8px", fontSize: "12px",
                color: T.textMuted, lineHeight: 1.5 }}>{band.verdict}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "20px", marginTop: "20px",
        paddingTop: "16px", borderTop: `1px solid ${T.border}` }}>
        {[{ color: T.cyan, label: "Your mix higher" },
          { color: isProfileMode ? T.purple : T.orange, label: isProfileMode ? "Profile higher" : "Reference higher" }
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "12px", height: "4px", background: color, borderRadius: "2px" }} />
            <span style={{ fontSize: "11px", color: T.textMuted }}>{label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
//  MIX HEALTH PANEL
// ─────────────────────────────────────────────────────────────
function MixHealthPanel({ title, health, accent }) {
  if (!health) {
    return (
      <Panel title={title} accent={accent}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px" }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ height: "40px", background: T.bg3, borderRadius: "3px",
                animation: "pulse 1.4s ease-in-out infinite",
                animationDelay: `${i*0.1}s` }} />
            ))}
          </div>
          {[90,70,55,80].map((w,i) => (
            <div key={i} style={{ height: "10px", width: `${w}%`,
              background: T.bg3, borderRadius: "2px",
              animation: "pulse 1.4s ease-in-out infinite",
              animationDelay: `${i*0.12}s` }} />
          ))}
        </div>
      </Panel>
    );
  }
  const crestColor = health.crestFactor < 3 ? T.red : health.crestFactor < 6 ? T.yellow : T.green;
  const peakColor  = health.peakDb > -1 ? T.red : health.peakDb > -3 ? T.yellow : T.green;
  return (
    <Panel title={title} accent={accent}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: "16px", marginBottom: "20px" }}>
        <Stat label="Integrated LUFS" value={health.integratedLufs} unit="LUFS"
          color={health.integratedLufs > -9 ? T.red : health.integratedLufs < -20 ? T.purple : T.green}
          glow={health.integratedLufs > -9} />
        <Stat label="Peak" value={health.peakDb} unit="dBFS"
          color={peakColor} glow={health.peakDb > -1} />
        <Stat label="Crest Factor" value={health.crestFactor} unit="dB"
          color={crestColor} glow={health.crestFactor < 4} />
      </div>
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
          <span style={{ fontSize: "10px", letterSpacing: "0.15em", color: T.textMuted,
            textTransform: "uppercase" }}>Dynamic Range (Crest Factor)</span>
          <span className="mono" style={{ fontSize: "10px", color: T.textMuted }}>Target: 8–14 dB</span>
        </div>
        <LedMeter value={Math.min(health.crestFactor, 20)} max={20}
          color={crestColor} segments={24} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        gap: "12px", padding: "16px", background: T.bg2, borderRadius: "4px",
        border: `1px solid ${T.border}`, marginBottom: "20px" }}>
        {[
          { label: "Centroid", value: `${(health.centroid/1000).toFixed(2)} kHz`,
            note: health.centroid < 1500 ? "⬇ Muffled" : health.centroid > 4500 ? "⬆ Harsh" : "✓ Balanced" },
          { label: "85% Rolloff", value: `${(health.rolloff/1000).toFixed(1)} kHz`,
            note: health.rolloff < 8000 ? "Thin" : health.rolloff > 15000 ? "Extended" : "Typical" },
          { label: "Mid Flatness",
            value: `${((health.midRangeSpectralFlatness ?? 0)*100).toFixed(0)}%`,
            note: health.midRangeSpectralFlatness > 0.65 ? "⬆ Broadband"
              : health.midRangeSpectralFlatness > 0.40 ? "→ Mixed" : "⬇ Tonal",
            tooltip: "Mid-Range Spectral Flatness (1–4kHz): geometric/arithmetic mean ratio. High = broadband/noisy (drums). Low = tonal/peaked (synths, formants)." },
          { label: "Stereo Width",
            value: health.stereoWidth !== undefined ? health.stereoWidth.toFixed(2) : "—",
            note: health.stereoWidth < 0.3 ? "⬇ Narrow" : health.stereoWidth > 0.95 ? "⚠ Phase" : "✓ Healthy" },
          { label: "Clipping", value: `${health.clippingPercent}%`,
            note: health.clippingPercent > 0.01 ? "⚠ Clips" : "✓ Clean" },
        ].map(({ label, value, note, tooltip }) => (
          <div key={label}>
            <div style={{ fontSize: "10px", letterSpacing: "0.12em", color: T.textMuted,
              marginBottom: "4px", textTransform: "uppercase" }}>{label}</div>
            <div className="mono" style={{ fontSize: "18px", color: T.textPrim }}>{value}</div>
            <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "3px" }}>
              {tooltip
                ? <span title={tooltip} style={{ cursor: "help",
                    borderBottom: `1px dotted ${T.textMuted}` }}>{note}</span>
                : note}
            </div>
          </div>
        ))}
      </div>
      {health.warnings.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: T.textMuted,
            textTransform: "uppercase", marginBottom: "4px" }}>Mix Analysis</div>
          {health.warnings.map((w, i) => <WarningBadge key={i} {...w} />)}
        </div>
      ) : (
        <div style={{ padding: "12px 16px", background: `${T.green}11`,
          border: `1px solid ${T.green}33`, borderRadius: "4px",
          fontSize: "13px", color: T.green }}>✓ No critical issues detected</div>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
//  VIBE TIMELINE
// ─────────────────────────────────────────────────────────────
function VibeTimeline({ timeline, title, accent }) {
  const [hovered, setHovered] = useState(null);
  if (!timeline) {
    return (
      <Panel title={title} accent={accent}>
        <div style={{ color: T.textMuted, fontSize: "13px" }}>
          Load a track to see the vibe timeline.</div>
      </Panel>
    );
  }
  const totalDuration = timeline[timeline.length - 1]?.endTime || 1;
  return (
    <Panel title={title} accent={accent}>
      <div style={{ display: "flex", height: "40px", borderRadius: "3px",
        overflow: "hidden", marginBottom: "8px" }}>
        {timeline.map((seg, i) => {
          const w = ((seg.endTime - seg.startTime) / totalDuration) * 100;
          return (
            <div key={i} style={{ width: `${w}%`,
              background: LABEL_COLORS[seg.label] || T.bg3,
              opacity: 0.3 + seg.normalizedEnergy * 0.7,
              cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0 }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)} />
          );
        })}
      </div>
      <div style={{ display: "flex", height: "28px", gap: "2px", marginBottom: "12px" }}>
        {timeline.map((seg, i) => {
          const w = ((seg.endTime - seg.startTime) / totalDuration) * 100;
          const h = Math.max(2, seg.normalizedEnergy * 28);
          return (
            <div key={i} style={{ width: `${w}%`, display: "flex",
              alignItems: "flex-end", flexShrink: 0 }}>
              <div style={{ width: "100%", height: `${h}px`, background: accent,
                opacity: 0.5 + seg.normalizedEnergy * 0.5,
                borderRadius: "1px 1px 0 0" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
        {timeline.map((seg, i) => (
          <div key={i} style={{ padding: "3px 8px",
            background: hovered === i ? `${accent}22` : T.bg2,
            border: `1px solid ${hovered === i ? accent : T.border}`,
            borderRadius: "2px", cursor: "pointer" }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}>
            <span className="mono" style={{ fontSize: "10px", color: T.textMuted }}>
              {formatTime(seg.startTime)}</span>
            <span style={{ fontSize: "11px", fontWeight: 700,
              color: LABEL_COLORS[seg.label] || T.textPrim,
              letterSpacing: "0.08em", marginLeft: "6px" }}>{seg.label}</span>
          </div>
        ))}
      </div>
      {hovered !== null && timeline[hovered] && (
        <div style={{ padding: "12px", background: T.bg2, borderRadius: "4px",
          border: `1px solid ${T.border}`, display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)", gap: "12px" }}>
          {[
            { label: "Time", value: `${formatTime(timeline[hovered].startTime)}–${formatTime(timeline[hovered].endTime)}`, unit: "" },
            { label: "Energy", value: timeline[hovered].energyDb, unit: "dBFS" },
            { label: "Flux", value: (timeline[hovered].normalizedFlux * 100).toFixed(0), unit: "%" },
            { label: "Flatness", value: ((timeline[hovered].midRangeFlatness ?? 0) * 100).toFixed(0), unit: "%" },
            { label: "Segment", value: timeline[hovered].label, unit: "" },
          ].map(({ label, value, unit }) => (
            <div key={label}>
              <div style={{ fontSize: "10px", color: T.textMuted, letterSpacing: "0.12em",
                textTransform: "uppercase", marginBottom: "3px" }}>{label}</div>
              <div className="mono" style={{ fontSize: "13px", color: T.textPrim }}>
                {value}{unit && <span style={{ color: T.textMuted, fontSize: "10px",
                  marginLeft: "2px" }}>{unit}</span>}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ─────────────────────────────────────────────────────────────
//  DASHBOARD ROOT
// ─────────────────────────────────────────────────────────────
export function MixHealthDashboard({ theme: themeProp, toggleTheme: toggleThemeProp }) {
  const [selectedProfileId, setSelectedProfileId] = useState("none");
  const [showLibrary,       setShowLibrary]       = useState(false);
  const [showPrintPreview,  setShowPrintPreview]  = useState(false);
  const [isSaving,          setIsSaving]          = useState(false);

  const { state, loadTrack, reset, modelState, postToWorker } =
    useAudioAnalyzer({ selectedProfileId });
  const { user, reference, delta, deltaReady } = state;

  // Theme context for light/dark mode toggle
  const { theme: ctxTheme, toggleTheme: ctxToggleTheme } = useWorkerContext();
  const theme = themeProp ?? ctxTheme ?? "dark";
  const toggleTheme = toggleThemeProp ?? ctxToggleTheme ?? (() => {});

  const { toasts, addToast, removeToast } = useToasts();

  // Auth (lazy — only asked when user clicks a cloud-gated button)
  const { user: authUser, showAuthModal, setShowAuthModal, requireAuth, signOut } = useAuth();

  // Library (depends on auth user)
  const {
    analyses, count, isFull, isNearFull,
    loading: libraryLoading, error: libraryError,
    saveAnalysis, deleteAnalysis, fetchAnalyses,
  } = useLibrary(authUser);

  // ── Profile change ──────────────────────────────────────────
  const handleProfileChange = useCallback((profileId) => {
    setSelectedProfileId(profileId);
    if (!state.user.mixHealth) return;
    if (profileId === "none") {
      postToWorker({ type: "COMPUTE_DELTA_ONLY", payload: { targetProfile: null } });
    } else {
      const profile = getAllProfiles()[profileId];
      if (profile) postToWorker({ type: "COMPUTE_DELTA_ONLY", payload: { targetProfile: profile } });
    }
  }, [postToWorker, state.user.mixHealth]);

  // ── JSON export (local, no auth required) ──────────────────
  const handleExportJson = useCallback(() => {
    if (!state.user.mixHealth) { addToast("Analyze a mix before exporting.", "warning"); return; }
    const payload = {
      timestamp: new Date().toISOString(), sonicProVersion: "5.0.0",
      userTrack: { fileName: state.user.fileName, mixHealth: state.user.mixHealth,
        vibeTimeline: state.user.vibeTimeline },
      referenceTrack: state.reference.mixHealth
        ? { fileName: state.reference.fileName, mixHealth: state.reference.mixHealth,
            vibeTimeline: state.reference.vibeTimeline }
        : null,
      delta: state.delta, selectedProfile: selectedProfileId !== "none" ? selectedProfileId : null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `Sonic-Pro-Audit-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast("Analysis exported as JSON.", "success");
  }, [state, selectedProfileId, addToast]);

  // ── Save to library (cloud, requires auth) ──────────────────
  const handleSaveToLibrary = useCallback(() => {
    if (!state.user.mixHealth) {
      addToast("Analyze a mix before saving.", "warning");
      return;
    }
    requireAuth(async () => {
      if (isFull) {
        addToast("Library full (20 analyses). Delete one to save.", "error");
        return;
      }
      setIsSaving(true);
      const result = await saveAnalysis({
        fileName:        state.user.fileName,
        mixHealth:       state.user.mixHealth,
        referenceHealth: state.reference.mixHealth ?? null,
        vibeTimeline:    state.user.vibeTimeline   ?? null,
        delta:           state.delta               ?? null,
        selectedProfile: selectedProfileId,
      });
      setIsSaving(false);
      if (result.success) {
        addToast("Analysis saved to your library.", "success");
        if (isNearFull) addToast(`${20 - count - 1} library slots remaining.`, "warning");
      } else {
        addToast(result.error ?? "Save failed. Try again.", "error");
      }
    });
  }, [state, selectedProfileId, requireAuth, saveAnalysis, isFull, isNearFull, count, addToast]);

  // ── Print preview ──────────────────────────────────────────
  const handlePrintPreview = useCallback(() => {
    if (!state.user.mixHealth) {
      addToast("Analyze a mix before printing.", "warning");
      return;
    }
    setShowPrintPreview(true);
  }, [state.user.mixHealth, addToast]);

  // Build print snapshot
  const printSnapshot = {
    fileName:        state.user.fileName         ?? "",
    mixHealth:       state.user.mixHealth        ?? null,
    referenceHealth: state.reference.mixHealth   ?? null,
    delta:           deltaReady ? delta : null,
    selectedProfile: selectedProfileId !== "none" ? selectedProfileId : null,
    generatedAt:     new Date().toISOString(),
  };

  // ── Load analysis from library ──────────────────────────────
  const handleLoadFromLibrary = useCallback((analysis) => {
    // Cloud-loaded analyses are display-only (no audio re-upload).
    // Show a toast confirming the load. Extending to re-run analysis
    // would require persisting audio, which is out of scope.
    addToast(`Loaded: ${analysis.file_name}. Note: cloud loads are read-only.`, "info");
    setShowLibrary(false);
  }, [addToast]);

  // ── Library open: trigger fetch if user is logged in ────────
  const handleOpenLibrary = useCallback(() => {
    if (!authUser) {
      requireAuth(() => {
        setShowLibrary(true);
      });
    } else {
      setShowLibrary(true);
    }
  }, [authUser, requireAuth]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      console.warn("[Sonic Pro] Supabase is not configured. Cloud features are disabled. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.");
    }
  }, []);

  const cloudDisabledTooltip = !isSupabaseConfigured
    ? "Configure Supabase in .env to enable cloud features"
    : undefined;

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes slideIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @media print {
          button, input[type="file"], details summary,
          .sp-no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          body { margin: 0; padding: 0; background: var(--bg0); }
          @page { size: A4; margin: 15mm; }
          header { border-bottom: 2px solid var(--cyan); padding-bottom: 20px;
            margin-bottom: 30px; break-after: avoid; position: static !important; }
          main { max-width: 100%; padding: 0; }
          div[style*="grid"] { display: flex !important; flex-direction: column !important; gap: 12px !important; }
          body::before {
            content: "SONIC PRO — MIX ANALYSIS REPORT\\A Generated " attr(data-print-time);
            white-space: pre; display: block; font-size: 14px; font-weight: 700;
            color: var(--cyan); margin-bottom: 20px;
            font-family: 'Rajdhani', sans-serif; letter-spacing: 0.15em;
          }
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg0, color: T.textPrim,
        fontFamily: "'Rajdhani', sans-serif" }}>

        {/* ── HEADER ─────────────────────────────────────────── */}
        <header style={{ display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0 24px", height: "56px",
          background: T.bg1, borderBottom: `1px solid ${T.border}`,
          position: "sticky", top: 0, zIndex: 100 }}>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "32px", height: "32px",
              background: `linear-gradient(135deg, ${T.cyan}, ${T.purple})`,
              borderRadius: "6px", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: "14px", fontWeight: 700 }}>S</div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700,
                letterSpacing: "0.2em" }}>SONIC PRO</div>
              <div style={{ fontSize: "9px", letterSpacing: "0.2em",
                color: T.textMuted, marginTop: "1px" }}>MIX REFERENCE ANALYZER</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* DSP status */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px",
              marginRight: "4px" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%",
                background: modelState === "ready" ? T.green
                  : modelState === "loading" ? T.yellow : T.red,
                animation: modelState === "loading" ? "pulse 1s ease-in-out infinite" : "none",
                boxShadow: modelState === "ready" ? `0 0 8px ${T.green}` : "none" }} />
              <span className="mono" style={{ fontSize: "10px", color: T.textMuted,
                textTransform: "uppercase" }}>
                {modelState === "ready" ? "DSP Engine Ready"
                  : modelState === "loading" ? "Initialising…" : "Engine Error"}
              </span>
            </div>

            { !isSupabaseConfigured && (
              <div style={{ color: T.yellow, fontSize: "11px", fontWeight: 700,
                border: `1px solid ${T.yellow}55`, borderRadius: "4px", padding: "4px 8px",
                display: "inline-flex", alignItems: "center", marginLeft: "8px" }}>
                Supabase not configured — cloud features disabled
              </div>
            ) }

            {/* Theme Toggle */}
            <HeaderBtn
              color={T.cyan}
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              {theme === "dark" ? "Light" : "Dark"}
            </HeaderBtn>

            {/* Save to Library */}
            <HeaderBtn
              color={T.green}
              onClick={handleSaveToLibrary}
              disabled={!isSupabaseConfigured || isSaving}
              disabledTooltip={cloudDisabledTooltip || (isSaving ? "Saving…" : undefined)}>
              {isSaving ? "Saving…" : authUser ? "Save to Library" : "Save to Library"}
            </HeaderBtn>

            {/* Library */}
            <HeaderBtn
              color={T.purple}
              onClick={handleOpenLibrary}
              disabled={!isSupabaseConfigured}
              disabledTooltip={cloudDisabledTooltip}>
              Library{authUser && count > 0 ? ` (${count})` : ""}
            </HeaderBtn>

            {/* Print preview */}
            <HeaderBtn color={T.cyan} onClick={handlePrintPreview}>
              Print Preview
            </HeaderBtn>

            {/* Export JSON */}
            <HeaderBtn color={T.orange} onClick={handleExportJson}>
              Export JSON
            </HeaderBtn>

            {/* Sign out (only if logged in) */}
            {authUser && (
              <HeaderBtn color={T.textMuted} onClick={signOut}>
                Sign Out
              </HeaderBtn>
            )}

            {/* Reset */}
            <HeaderBtn color={T.textMuted} onClick={reset}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.red; e.currentTarget.style.color = T.red; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}>
              Reset
            </HeaderBtn>
          </div>
        </header>

        {/* ── MAIN ───────────────────────────────────────────── */}
        <main style={{ maxWidth: "1400px", margin: "0 auto", padding: "24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: "16px", marginBottom: "16px" }}>
            <TrackLoader trackType="user"      trackState={user}      onLoad={loadTrack} />
            <TrackLoader trackType="reference" trackState={state.reference} onLoad={loadTrack} />
          </div>
          <div style={{ marginBottom: "16px" }}>
            <ProfileSelectorPanel selectedProfileId={selectedProfileId}
              onChange={handleProfileChange} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: "16px", marginBottom: "16px" }}>
            <DeltaPanel delta={deltaReady ? delta : null}
              selectedProfileId={selectedProfileId} />
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <MixHealthPanel title="Your Mix — Health Check"
                health={user.mixHealth} accent={T.cyan} />
              {state.reference.mixHealth && (
                <MixHealthPanel title="Reference Track — Health Check"
                  health={state.reference.mixHealth} accent={T.orange} />
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <VibeTimeline title="Your Mix — Vibe Timeline"
              timeline={user.vibeTimeline} accent={T.cyan} />
            {state.reference.vibeTimeline && (
              <VibeTimeline title="Reference — Vibe Timeline"
                timeline={state.reference.vibeTimeline} accent={T.orange} />
            )}
          </div>
        </main>

        {/* ── FOOTER ─────────────────────────────────────────── */}
        <footer style={{ borderTop: `1px solid ${T.border}`, padding: "16px 24px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: "32px" }}>
          <span className="mono" style={{ fontSize: "10px", color: T.textDim }}>
            SONIC PRO v2.0 — FFT: 4096pt Hann · EBU R128 LUFS · Mid-Range Spectral Flatness
          </span>
          <span className="mono" style={{ fontSize: "10px", color: T.textDim }}>
            All DSP runs client-side. No audio data leaves your device.
          </span>
        </footer>
      </div>

      {/* ── MODALS & OVERLAYS ──────────────────────────────────── */}
      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}

      <LibraryPanel
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        analyses={analyses}
        count={count}
        isFull={isFull}
        isNearFull={isNearFull}
        loading={libraryLoading}
        error={libraryError}
        onLoadAnalysis={handleLoadFromLibrary}
        onDelete={deleteAnalysis}
        onRefresh={fetchAnalyses}
        user={authUser}
        onSignOut={signOut}
      />

      <PrintPreviewModal
        isOpen={showPrintPreview}
        onClose={() => setShowPrintPreview(false)}
        snapshot={printSnapshot}
      />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}

export default MixHealthDashboard;
