/**
 * @file src/components/PrintPreviewModal.jsx — A4 print preview modal
 *
 * Strategy: Enhanced window.print() — no PDF libraries, zero bundle bloat.
 * 
 * Flow:
 *   1. User clicks "Print / PDF" in the header.
 *   2. This modal opens, showing an A4-formatted preview.
 *   3. User clicks "Print / Save as PDF" → window.print() fires.
 *      Browser's print dialog handles "Save as PDF" natively.
 *
 * Print CSS injected by this component targets `.sp-print-scope`.
 * The main app's @media print styles hide interactive elements globally.
 *
 * The A4 preview inside the modal is a scrollable 793px-wide container
 * that mirrors what the printed page will look like. This sets expectations
 * before the user commits to printing.
 */

import { useMemo } from "react";

const T = {
  bg0: "#060611", bg1: "#0d0d1e", bg2: "#14142a", bg3: "#1c1c38",
  border: "#252545", textPrim: "#c8c8e8", textMuted: "#555575", textDim: "#35355a",
  cyan: "#00d8ff", orange: "#ff8c00", green: "#00ff87",
  yellow: "#ffd000", red: "#ff3060", purple: "#a06dff",
};

const BAND_META = {
  sub:   { label: "Sub Bass",        range: "20–60 Hz"   },
  mud:   { label: "Low-Mid / Mud",   range: "200–500 Hz" },
  harsh: { label: "Harsh / Presence",range: "2–4 kHz"    },
  air:   { label: "Air / Shimmer",   range: "10 kHz+"    },
};

function formatDate(iso) {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─────────────────────────────────────────────────────────────
//  PRINT PREVIEW SECTIONS
// ─────────────────────────────────────────────────────────────

function MetricRow({ label, value, unit = "" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between",
      alignItems: "baseline", padding: "5px 0",
      borderBottom: `1px solid ${T.border}` }}>
      <span style={{ fontSize: "11px", color: T.textMuted, textTransform: "uppercase",
        letterSpacing: "0.1em", fontFamily: "'Rajdhani', sans-serif" }}>{label}</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "13px", color: T.textPrim }}>
        {value ?? "—"}{unit && <span style={{ color: T.textMuted, marginLeft: "3px" }}>{unit}</span>}
      </span>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.2em",
      color: T.cyan, textTransform: "uppercase", fontFamily: "'Rajdhani', sans-serif",
      borderBottom: `1px solid ${T.cyan}44`, paddingBottom: "6px", marginBottom: "12px" }}>
      {children}
    </div>
  );
}

function PrintPreviewContent({ snapshot }) {
  const { fileName, mixHealth, referenceHealth, delta, selectedProfile, generatedAt } = snapshot;

  return (
    <div style={{ fontFamily: "'Rajdhani', sans-serif", color: T.textPrim, lineHeight: 1.5 }}>

      {/* Cover / Title */}
      <div style={{ marginBottom: "28px", paddingBottom: "20px",
        borderBottom: `2px solid ${T.cyan}` }}>
        <div style={{ fontSize: "9px", letterSpacing: "0.25em", color: T.cyan,
          textTransform: "uppercase", marginBottom: "8px" }}>
          Sonic Pro — Mix Analysis Report
        </div>
        <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "0.1em",
          color: T.textPrim, marginBottom: "4px" }}>
          {fileName || "Untitled Mix"}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", color: T.textMuted }}>
          Generated {formatDate(generatedAt)}
        </div>
        {selectedProfile && selectedProfile !== "none" && (
          <div style={{ marginTop: "6px", display: "inline-block",
            padding: "2px 8px", background: `${T.purple}22`,
            border: `1px solid ${T.purple}44`, borderRadius: "2px",
            fontSize: "10px", color: T.purple, letterSpacing: "0.1em",
            textTransform: "uppercase", fontFamily: "'Rajdhani', sans-serif" }}>
            Profile: {selectedProfile}
          </div>
        )}
      </div>

      {/* Mix Health */}
      {mixHealth && (
        <div style={{ marginBottom: "24px" }}>
          <SectionTitle>Mix Health — Your Mix</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
            <MetricRow label="Integrated Loudness" value={mixHealth.integratedLufs} unit="LUFS" />
            <MetricRow label="True Peak"            value={mixHealth.peakDb}         unit="dBFS" />
            <MetricRow label="Crest Factor"         value={mixHealth.crestFactor}    unit="dB"   />
            <MetricRow label="Spectral Centroid"    value={mixHealth.centroid != null ? (mixHealth.centroid/1000).toFixed(2) : null} unit="kHz" />
            <MetricRow label="85% Rolloff"          value={mixHealth.rolloff != null ? (mixHealth.rolloff/1000).toFixed(1) : null}  unit="kHz" />
            <MetricRow label="Stereo Width"         value={mixHealth.stereoWidth}    unit=""     />
            <MetricRow label="Clipping"             value={mixHealth.clippingPercent} unit="%"   />
            <MetricRow label="Mid Spectral Flatness" value={mixHealth.midRangeSpectralFlatness != null ? (mixHealth.midRangeSpectralFlatness * 100).toFixed(0) : null} unit="%" />
          </div>
          {mixHealth.warnings?.length > 0 && (
            <div style={{ marginTop: "12px" }}>
              <div style={{ fontSize: "10px", color: T.textMuted, letterSpacing: "0.12em",
                textTransform: "uppercase", marginBottom: "8px" }}>Warnings</div>
              {mixHealth.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: "11px", color: T.textPrim,
                  padding: "5px 10px", borderLeft: `2px solid ${w.severity === "critical" ? T.red : w.severity === "warning" ? T.yellow : T.purple}`,
                  marginBottom: "4px" }}>
                  <strong style={{ textTransform: "uppercase", letterSpacing: "0.1em",
                    fontSize: "9px", color: w.severity === "critical" ? T.red : T.yellow }}>
                    {w.type}
                  </strong>
                  {" — "}{w.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reference Health */}
      {referenceHealth && (
        <div style={{ marginBottom: "24px" }}>
          <SectionTitle>Mix Health — Reference Track</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
            <MetricRow label="Integrated Loudness" value={referenceHealth.integratedLufs} unit="LUFS" />
            <MetricRow label="True Peak"           value={referenceHealth.peakDb}         unit="dBFS" />
            <MetricRow label="Crest Factor"        value={referenceHealth.crestFactor}    unit="dB"   />
            <MetricRow label="Stereo Width"        value={referenceHealth.stereoWidth}    unit=""     />
          </div>
        </div>
      )}

      {/* Delta Engine */}
      {delta?.bands && (
        <div style={{ marginBottom: "24px" }}>
          <SectionTitle>
            Delta Engine{delta.profileMode ? ` — ${selectedProfile ?? "Profile"}` : " — Reference Comparison"}
          </SectionTitle>
          {!delta.profileMode && delta.gainOffset !== undefined && (
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px",
              color: T.textMuted, marginBottom: "10px" }}>
              Your mix: {delta.userLufs} LUFS &nbsp;|&nbsp;
              Reference: {delta.referenceLufs} LUFS &nbsp;|&nbsp;
              Offset applied: {delta.gainOffset > 0 ? "+" : ""}{delta.gainOffset} dB
            </div>
          )}
          {Object.entries(delta.bands).map(([key, band]) => {
            const meta  = BAND_META[key] ?? { label: key, range: "" };
            const abs   = Math.abs(band.delta);
            const color = abs < 0.5 ? T.green : abs < 3 ? T.yellow : T.red;
            return (
              <div key={key} style={{ marginBottom: "10px", paddingBottom: "10px",
                borderBottom: `1px solid ${T.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "baseline", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 700, letterSpacing: "0.08em", fontSize: "12px" }}>
                    {meta.label}{" "}
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px",
                      color: T.textMuted, fontWeight: 400 }}>
                      {meta.range}
                    </span>
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "14px", fontWeight: 600, color }}>
                    {band.delta >= 0 ? "+" : ""}{band.delta.toFixed(1)} dB
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: T.textMuted }}>
                  {band.verdict}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: "20px", paddingTop: "12px",
        borderTop: `1px solid ${T.border}`,
        display: "flex", justifyContent: "space-between",
        fontSize: "9px", color: T.textDim,
        fontFamily: "'IBM Plex Mono', monospace" }}>
        <span>SONIC PRO v2.0 — All DSP processing ran 100% client-side</span>
        <span>No audio data was transmitted to any server</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL
// ─────────────────────────────────────────────────────────────

/**
 * PrintPreviewModal — A4 layout preview before window.print().
 *
 * @param {{
 *   isOpen:    boolean,
 *   onClose:   () => void,
 *   snapshot:  {
 *     fileName:         string,
 *     mixHealth:        Object | null,
 *     referenceHealth:  Object | null,
 *     delta:            Object | null,
 *     selectedProfile:  string | null,
 *     generatedAt:      string,
 *   }
 * }} props
 */
export function PrintPreviewModal({ isOpen, onClose, snapshot }) {
  // Build a stable snapshot reference so the preview doesn't flicker
  const stableSnapshot = useMemo(() => ({
    fileName:        snapshot?.fileName        ?? "",
    mixHealth:       snapshot?.mixHealth       ?? null,
    referenceHealth: snapshot?.referenceHealth ?? null,
    delta:           snapshot?.delta           ?? null,
    selectedProfile: snapshot?.selectedProfile ?? null,
    generatedAt:     snapshot?.generatedAt     ?? new Date().toISOString(),
  }), [snapshot]);

  if (!isOpen) return null;

  const handlePrint = () => {
    document.body.setAttribute("data-print-time", new Date().toLocaleString());
    window.print();
  };

  return (
    <>
      {/* Scoped print CSS — only prints .sp-print-root; hides the modal chrome */}
      <style>{`
        @media print {
          body > *:not(.sp-print-root) { display: none !important; }
          .sp-print-root {
            position: static !important;
            background: #060611 !important;
            padding: 0 !important;
          }
          .sp-print-backdrop { display: none !important; }
          .sp-print-modal-chrome { display: none !important; }
          .sp-print-page {
            width: 100% !important;
            max-width: none !important;
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
          }
          @page { size: A4 portrait; margin: 15mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      <div className="sp-print-root" style={{ position: "fixed", inset: 0, zIndex: 500,
        display: "flex", flexDirection: "column", background: "rgba(6,6,17,0.92)",
        backdropFilter: "blur(6px)" }}>

        {/* Modal chrome (hidden during print) */}
        <div className="sp-print-modal-chrome" style={{ display: "flex",
          alignItems: "center", justifyContent: "space-between",
          padding: "14px 24px", background: T.bg1,
          borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.15em",
              color: T.textPrim, fontFamily: "'Rajdhani', sans-serif" }}>
              PRINT PREVIEW
            </div>
            <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>
              A4 portrait layout · Tip: choose "Save as PDF" in the print dialog
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={handlePrint}
              style={{ background: `${T.cyan}22`, border: `1px solid ${T.cyan}`,
                color: T.cyan, padding: "8px 18px", borderRadius: "3px",
                fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, cursor: "pointer",
                transition: "all 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = `${T.cyan}38`}
              onMouseLeave={e => e.currentTarget.style.background = `${T.cyan}22`}>
              Print / Save as PDF
            </button>
            <button onClick={onClose}
              style={{ background: "transparent", border: `1px solid ${T.border}`,
                color: T.textMuted, padding: "8px 14px", borderRadius: "3px",
                fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, cursor: "pointer",
                transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.red; e.currentTarget.style.color = T.red; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}>
              Close
            </button>
          </div>
        </div>

        {/* Scrollable A4 preview */}
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 24px",
          display: "flex", justifyContent: "center" }}>
          <div className="sp-print-page"
            style={{ width: "793px", minHeight: "1122px", background: T.bg0,
              border: `1px solid ${T.border}`, borderRadius: "2px",
              padding: "40px 48px",
              boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
            <PrintPreviewContent snapshot={stableSnapshot} />
          </div>
        </div>
      </div>
    </>
  );
}

export default PrintPreviewModal;
