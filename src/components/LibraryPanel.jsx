/**
 * @file src/components/LibraryPanel.jsx — Cloud library slide-in panel
 *
 * Shows the user's saved analyses, newest first.
 * Supports: load analysis back into app, delete, count/limit display.
 * Mobile-responsive: full-width on small screens.
 */

import { useState, useCallback } from "react";

const T = {
  bg0: "#060611", bg1: "#0d0d1e", bg2: "#14142a", bg3: "#1c1c38",
  border: "#252545", borderBright: "#3a3a60",
  textPrim: "#c8c8e8", textMuted: "#555575", textDim: "#35355a",
  cyan: "#00d8ff", orange: "#ff8c00", green: "#00ff87",
  yellow: "#ffd000", red: "#ff3060", purple: "#a06dff",
};

const MAX_ANALYSES = 20;
const WARN_AT      = 15;

/**
 * Format an ISO timestamp to a readable "Jan 15, 2025 · 14:32" string.
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    + " · "
    + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Single saved analysis card.
 *
 * @param {{
 *   analysis:  import("../hooks/useLibrary").SavedAnalysis,
 *   onLoad:    (analysis: Object) => void,
 *   onDelete:  (id: string) => Promise<void>,
 * }} props
 */
function AnalysisCard({ analysis, onLoad, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  const lufs     = analysis.integrated_lufs;
  const lufsColor = lufs > -9 ? T.red : lufs < -20 ? T.purple : T.green;

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    await onDelete(analysis.id);
    setDeleting(false);
    setConfirmDelete(false);
  }, [analysis.id, onDelete]);

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`,
      borderRadius: "4px", padding: "14px", display: "flex",
      flexDirection: "column", gap: "8px",
      transition: "border-color 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = T.borderBright}
      onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>

      {/* File name + timestamp */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: T.textPrim,
          wordBreak: "break-word", flex: 1, fontFamily: "'Rajdhani', sans-serif",
          letterSpacing: "0.05em" }}>
          {analysis.file_name || "Untitled analysis"}
        </div>
        {analysis.profile_id && (
          <div style={{ fontSize: "9px", letterSpacing: "0.12em", color: T.purple,
            background: `${T.purple}22`, border: `1px solid ${T.purple}44`,
            borderRadius: "2px", padding: "2px 6px", flexShrink: 0,
            textTransform: "uppercase", fontFamily: "'Rajdhani', sans-serif" }}>
            {analysis.profile_id}
          </div>
        )}
      </div>

      {/* Metrics row */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {lufs != null && (
          <span className="mono" style={{ fontSize: "11px", color: lufsColor }}>
            {lufs} LUFS
          </span>
        )}
        {analysis.peak_db != null && (
          <span className="mono" style={{ fontSize: "11px", color: T.textMuted }}>
            Peak {analysis.peak_db > 0 ? "+" : ""}{analysis.peak_db} dBFS
          </span>
        )}
        {analysis.crest_factor != null && (
          <span className="mono" style={{ fontSize: "11px", color: T.textMuted }}>
            CF {analysis.crest_factor} dB
          </span>
        )}
      </div>

      {/* Date */}
      <div style={{ fontSize: "10px", color: T.textDim, fontFamily: "'IBM Plex Mono', monospace" }}>
        {formatDate(analysis.created_at)}
      </div>

      {/* Actions */}
      {!confirmDelete ? (
        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
          <button
            onClick={() => onLoad(analysis)}
            style={{ flex: 1, background: `${T.cyan}18`,
              border: `1px solid ${T.cyan}66`, color: T.cyan,
              padding: "6px 10px", borderRadius: "3px",
              fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase",
              fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
              cursor: "pointer", transition: "all 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.background = `${T.cyan}28`}
            onMouseLeave={e => e.currentTarget.style.background = `${T.cyan}18`}>
            Load
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            style={{ background: "transparent", border: `1px solid ${T.border}`,
              color: T.textMuted, padding: "6px 10px", borderRadius: "3px",
              fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase",
              fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
              cursor: "pointer", transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.red; e.currentTarget.style.color = T.red; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}>
            Delete
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "8px", marginTop: "4px", alignItems: "center" }}>
          <span style={{ fontSize: "11px", color: T.yellow, flex: 1 }}>Delete this analysis?</span>
          <button onClick={handleDelete} disabled={deleting}
            style={{ background: `${T.red}22`, border: `1px solid ${T.red}66`, color: T.red,
              padding: "5px 10px", borderRadius: "3px", fontSize: "10px",
              letterSpacing: "0.1em", textTransform: "uppercase",
              fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
              cursor: deleting ? "not-allowed" : "pointer" }}>
            {deleting ? "…" : "Confirm"}
          </button>
          <button onClick={() => setConfirmDelete(false)}
            style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textMuted,
              padding: "5px 10px", borderRadius: "3px", fontSize: "10px",
              letterSpacing: "0.1em", textTransform: "uppercase",
              fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  LIBRARY PANEL
// ─────────────────────────────────────────────────────────────

/**
 * LibraryPanel — slide-in right panel showing saved analyses.
 *
 * @param {{
 *   isOpen:         boolean,
 *   onClose:        () => void,
 *   analyses:       import("../hooks/useLibrary").SavedAnalysis[],
 *   count:          number,
 *   isFull:         boolean,
 *   isNearFull:     boolean,
 *   loading:        boolean,
 *   error:          string | null,
 *   onLoadAnalysis: (analysis: Object) => void,
 *   onDelete:       (id: string) => Promise<void>,
 *   onRefresh:      () => void,
 *   user:           Object | null,
 *   onSignOut:      () => void,
 * }} props
 */
export function LibraryPanel({
  isOpen, onClose,
  analyses, count, isFull, isNearFull,
  loading, error,
  onLoadAnalysis, onDelete, onRefresh,
  user, onSignOut,
}) {
  if (!isOpen) return null;

  const slotsRemaining = MAX_ANALYSES - count;
  const slotColor = isFull ? T.red : isNearFull ? T.yellow : T.textMuted;

  return (
    <>
      {/* Backdrop */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(6,6,17,0.6)",
        backdropFilter: "blur(2px)", zIndex: 200 }}
        onClick={onClose} />

      {/* Panel */}
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0,
        width: "min(420px, 100vw)", background: T.bg1,
        borderLeft: `1px solid ${T.border}`, zIndex: 201,
        display: "flex", flexDirection: "column",
        boxShadow: `-20px 0 60px rgba(0,0,0,0.6)` }}>

        {/* Panel header */}
        <div style={{ padding: "20px", borderBottom: `1px solid ${T.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, letterSpacing: "0.15em",
              color: T.textPrim, fontFamily: "'Rajdhani', sans-serif" }}>
              SAVED ANALYSES
            </div>
            <div className="mono" style={{ fontSize: "10px", color: slotColor, marginTop: "3px" }}>
              {count} / {MAX_ANALYSES} saved
              {isNearFull && ` — ${slotsRemaining} slots remaining`}
              {isFull && " — Library full"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button onClick={onRefresh}
              title="Refresh"
              style={{ background: "transparent", border: `1px solid ${T.border}`,
                color: T.textMuted, width: "30px", height: "30px", borderRadius: "3px",
                cursor: "pointer", fontSize: "14px", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.cyan; e.currentTarget.style.color = T.cyan; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}>
              ↻
            </button>
            <button onClick={onClose}
              style={{ background: "transparent", border: `1px solid ${T.border}`,
                color: T.textMuted, width: "30px", height: "30px", borderRadius: "3px",
                cursor: "pointer", fontSize: "16px", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.red; e.currentTarget.style.color = T.red; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textMuted; }}>
              ✕
            </button>
          </div>
        </div>

        {/* Slot warning */}
        {(isNearFull || isFull) && (
          <div style={{ margin: "12px 20px 0", padding: "10px 14px",
            background: isFull ? `${T.red}18` : `${T.yellow}18`,
            border: `1px solid ${isFull ? T.red : T.yellow}44`,
            borderLeft: `3px solid ${isFull ? T.red : T.yellow}`,
            borderRadius: "3px", fontSize: "12px",
            color: isFull ? T.red : T.yellow }}>
            {isFull
              ? "Library full. Delete an analysis to save new ones."
              : `${slotsRemaining} slots remaining before your library is full.`}
          </div>
        )}

        {/* User info + sign out */}
        {user && (
          <div style={{ margin: "12px 20px 0", display: "flex",
            justifyContent: "space-between", alignItems: "center" }}>
            <span className="mono" style={{ fontSize: "11px", color: T.textMuted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {user.email}
            </span>
            <button onClick={onSignOut}
              style={{ background: "transparent", border: "none", color: T.textMuted,
                fontSize: "11px", cursor: "pointer", textDecoration: "underline",
                fontFamily: "'Rajdhani', sans-serif", letterSpacing: "0.08em",
                flexShrink: 0, marginLeft: "12px" }}>
              Sign out
            </button>
          </div>
        )}

        {/* Content area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px",
          display: "flex", flexDirection: "column", gap: "10px" }}>

          {loading && (
            <div style={{ textAlign: "center", padding: "40px 0",
              color: T.textMuted, fontSize: "13px" }}>
              Loading…
            </div>
          )}

          {error && !loading && (
            <div style={{ padding: "12px 14px", background: `${T.red}18`,
              border: `1px solid ${T.red}33`, borderLeft: `3px solid ${T.red}`,
              borderRadius: "3px", fontSize: "12px", color: T.red }}>
              {error}
            </div>
          )}

          {!loading && !error && analyses.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px",
              color: T.textMuted, fontSize: "13px", lineHeight: 1.6 }}>
              No saved analyses yet.<br />
              Analyze a mix and click{" "}
              <span style={{ color: T.cyan }}>Save to Library</span>{" "}
              to save it here.
            </div>
          )}

          {!loading && analyses.map(a => (
            <AnalysisCard
              key={a.id}
              analysis={a}
              onLoad={onLoadAnalysis}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export default LibraryPanel;
