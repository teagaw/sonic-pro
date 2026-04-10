/**
 * PrintPreview.tsx — Sonic Pro v6 Print Report
 *
 * A proper A4 mastering analysis certificate.
 * Shows every metric the DSP engine produces:
 *   - 8-metric core panel (added rolloff + midRangeSpectralFlatness)
 *   - 7-band spectral balance with visual bars
 *   - Full delta table (band / your mix / target / delta / verdict)
 *   - Gain offset + match score + letter grade
 *   - DSP suggestions list (from delta.suggestions)
 *   - All warnings with severity + type + message
 *   - Vibe timeline energy bar chart
 *
 * Props extended: now accepts vibeTimeline.
 */

import React from 'react';
import type { MixHealth, DeltaBandResult, DeltaResult, VibeSegment } from '../lib/types';

// ─── Props ────────────────────────────────────────────────────
interface Props {
  analysis: {
    fileName:     string;
    fileSize:     number;
    duration:     number;
    mixHealth:    MixHealth;
    delta:        DeltaResult | null;
    vibeTimeline: VibeSegment[] | null;
  };
  targetName: string;
}

// ─── Helpers ──────────────────────────────────────────────────
function letterGrade(score: number): { letter: string; color: string } {
  if (score >= 90) return { letter: 'A', color: '#16a34a' };
  if (score >= 75) return { letter: 'B', color: '#2563eb' };
  if (score >= 60) return { letter: 'C', color: '#d97706' };
  if (score >= 40) return { letter: 'D', color: '#ea580c' };
  return { letter: 'F', color: '#dc2626' };
}

function fmtDuration(s: number) {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function fmtDate() {
  return new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).toUpperCase();
}

const BAND_LABELS: Record<string, string> = {
  sub: 'Sub', bass: 'Bass', lowMid: 'Low Mid', mid: 'Mid',
  highMid: 'High Mid', presence: 'Presence', brilliance: 'Brilliance',
};

// ─── Component ────────────────────────────────────────────────
export const PrintPreview: React.FC<Props> = ({ analysis, targetName }) => {
  const { fileName, fileSize, duration, mixHealth, delta, vibeTimeline } = analysis;
  const grade = delta ? letterGrade(delta.score) : null;

  return (
    <div
      className="bg-white text-black p-10 max-w-[210mm] mx-auto min-h-[297mm] shadow-2xl print:shadow-none"
      style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '10px' }}
    >

      {/* ════════════════════════════════════════════
          HEADER
      ════════════════════════════════════════════ */}
      <div className="flex justify-between items-end border-b-[3px] border-black pb-5 mb-6">
        <div>
          <div className="flex items-baseline gap-2 mb-1">
            <span style={{ fontSize: '26px', fontWeight: 900, letterSpacing: '-0.05em', fontStyle: 'italic', lineHeight: 1 }}>
              Sonic<span style={{ color: '#2563eb' }}>Pro</span>
            </span>
            <span style={{
              fontSize: '7px', fontWeight: 700, letterSpacing: '0.25em',
              border: '1px solid #d4d4d8', padding: '1px 5px', color: '#71717a',
              textTransform: 'uppercase',
            }}>v6 DSP</span>
          </div>
          <p style={{ fontSize: '7px', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#a1a1aa', fontWeight: 700 }}>
            Mix Analysis Report · EBU R128 · ITU-R BS.1770-4
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{fmtDate()}</p>
          <p style={{ fontSize: '7px', color: '#a1a1aa', marginTop: '2px', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            {targetName || 'No Profile'}
          </p>
          <p style={{ fontSize: '7px', color: '#a1a1aa', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            {delta?.profileMode ? 'Genre Profile Mode' : delta ? 'Reference Track Mode' : 'Standalone Analysis'}
          </p>
        </div>
      </div>

      {/* ════════════════════════════════════════════
          FILE INFO + GRADE BADGE
      ════════════════════════════════════════════ */}
      <div className="flex justify-between items-start mb-6">
        <div style={{ flex: 1, paddingRight: '24px' }}>
          <p style={{ fontSize: '7px', letterSpacing: '0.22em', textTransform: 'uppercase', color: '#a1a1aa', fontWeight: 700, marginBottom: '4px' }}>
            File
          </p>
          <p style={{ fontSize: '15px', fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.2 }}
            className="truncate max-w-[340px]">
            {fileName}
          </p>
          <p style={{ fontSize: '8px', color: '#a1a1aa', marginTop: '3px' }}>
            {(fileSize / (1024 * 1024)).toFixed(2)} MB
            &nbsp;·&nbsp;{fmtDuration(duration)}
            &nbsp;·&nbsp;{mixHealth.integratedLufs} LUFS integrated
          </p>
        </div>

        {grade && delta && (
          <div style={{
            textAlign: 'center', border: '2.5px solid #18181b',
            padding: '10px 18px', flexShrink: 0,
          }}>
            <p style={{ fontSize: '7px', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#a1a1aa', fontWeight: 700, marginBottom: '4px' }}>
              Match Score
            </p>
            <p style={{ fontSize: '38px', fontWeight: 900, lineHeight: 1, color: grade.color }}>{grade.letter}</p>
            <p style={{ fontSize: '16px', fontWeight: 900, lineHeight: 1.2, color: '#18181b' }}>
              {delta.score}
              <span style={{ fontSize: '9px', color: '#a1a1aa' }}>/100</span>
            </p>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════
          CORE METRICS — 8 metrics in 4-col grid
      ════════════════════════════════════════════ */}
      <Section label="Core Metrics">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {[
            { label: 'Integrated LUFS', value: String(mixHealth.integratedLufs), unit: 'LUFS' },
            { label: 'True Peak', value: String(mixHealth.peakDb), unit: 'dBFS' },
            { label: 'Crest Factor', value: String(mixHealth.crestFactor), unit: 'dB' },
            { label: 'Stereo Correlation', value: mixHealth.stereoWidth.toFixed(3), unit: '' },
            { label: 'Spectral Centroid', value: (mixHealth.centroid / 1000).toFixed(2), unit: 'kHz' },
            { label: 'Spectral Rolloff', value: (mixHealth.rolloff / 1000).toFixed(2), unit: 'kHz' },
            { label: 'Clipping', value: mixHealth.clippingPercent.toFixed(3), unit: '%' },
            { label: 'Mid Flatness', value: `${(mixHealth.midRangeSpectralFlatness * 100).toFixed(0)}`, unit: '%' },
          ].map(({ label, value, unit }) => (
            <div key={label} style={{ padding: '10px 12px', background: '#f9f9f9', border: '1px solid #e4e4e7' }}>
              <p style={{ fontSize: '7px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#a1a1aa', fontWeight: 700, marginBottom: '4px', lineHeight: 1.3 }}>
                {label}
              </p>
              <p style={{ fontSize: '17px', fontWeight: 900, lineHeight: 1, color: '#09090b' }}>
                {value}
                {unit && <span style={{ fontSize: '8px', color: '#a1a1aa', marginLeft: '2px' }}>{unit}</span>}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ════════════════════════════════════════════
          SPECTRAL BALANCE — 7 bands with bars
      ════════════════════════════════════════════ */}
      <Section label="7-Band Spectral Balance">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {Object.entries(mixHealth.spectralBands).map(([band, val]) => {
            const db = val as number;
            // Map -80..0 dB to 0..100% width
            const pct = Math.min(100, Math.max(2, ((db + 80) / 80) * 100));
            return (
              <div key={band} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#71717a', width: '72px', flexShrink: 0 }}>
                  {BAND_LABELS[band] ?? band}
                </span>
                <div style={{ flex: 1, height: '5px', background: '#f4f4f5', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: '#2563eb', opacity: 0.55 + pct / 240 }} />
                </div>
                <span style={{ fontSize: '8px', fontWeight: 700, fontFamily: 'monospace', width: '52px', textAlign: 'right', color: '#3f3f46' }}>
                  {db.toFixed(1)} dB
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ════════════════════════════════════════════
          DELTA TABLE — full 5-column table
      ════════════════════════════════════════════ */}
      {delta && (
        <Section label={`Spectral Delta — ${targetName}${delta.profileMode ? ' (Genre Profile)' : ' (Reference Track)'}`}>
          {delta.gainOffset !== 0 && (
            <p style={{ fontSize: '7px', color: '#a1a1aa', marginBottom: '6px', letterSpacing: '0.1em' }}>
              Gain normalisation: {delta.gainOffset > 0 ? '+' : ''}{delta.gainOffset.toFixed(1)} dB applied before comparison
              &nbsp;·&nbsp; Ref LUFS: {delta.referenceLufs !== null ? `${delta.referenceLufs} LUFS` : 'N/A'}
            </p>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #e4e4e7' }}>
                {['Band', 'Your Mix', 'Target', 'Delta', 'Verdict'].map(h => (
                  <th key={h} style={{
                    fontSize: '7px', letterSpacing: '0.18em', textTransform: 'uppercase',
                    color: '#a1a1aa', fontWeight: 700, paddingBottom: '5px',
                    textAlign: 'left', paddingRight: '10px',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(delta.bands as Record<string, DeltaBandResult>).map(([band, b]) => {
                const abs = Math.abs(b.delta);
                const col = abs < 0.5 ? '#16a34a' : abs < 2 ? '#d97706' : '#dc2626';
                return (
                  <tr key={band} style={{ borderBottom: '1px solid #f4f4f5' }}>
                    <td style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '5px 10px 5px 0', color: '#52525b' }}>
                      {BAND_LABELS[band] ?? band}
                    </td>
                    <td style={{ fontSize: '8px', fontFamily: 'monospace', padding: '5px 10px 5px 0', color: '#3f3f46' }}>
                      {b.userDb.toFixed(1)} dB
                    </td>
                    <td style={{ fontSize: '8px', fontFamily: 'monospace', padding: '5px 10px 5px 0', color: '#a1a1aa' }}>
                      {b.refDb.toFixed(1)} dB
                    </td>
                    <td style={{ fontSize: '8px', fontWeight: 700, fontFamily: 'monospace', padding: '5px 10px 5px 0', color: col }}>
                      {b.delta > 0 ? '+' : ''}{b.delta.toFixed(1)} dB
                    </td>
                    <td style={{ fontSize: '8px', color: '#71717a', fontStyle: 'italic', padding: '5px 0' }}>
                      {b.verdict}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      {/* ════════════════════════════════════════════
          DSP SUGGESTIONS — from delta.suggestions
      ════════════════════════════════════════════ */}
      {delta && delta.suggestions && delta.suggestions.length > 0 && (
        <Section label="DSP Recommendations">
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {delta.suggestions.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '7px', fontWeight: 900, color: '#d4d4d8', flexShrink: 0, marginTop: '1px', width: '14px' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p style={{ fontSize: '8px', color: '#52525b', lineHeight: 1.6, margin: 0 }}>{s}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* ════════════════════════════════════════════
          WARNINGS — full severity + type + message
      ════════════════════════════════════════════ */}
      {mixHealth.warnings.length > 0 && (
        <Section label={`DSP Warnings (${mixHealth.warnings.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {mixHealth.warnings.map((w, i) => {
              const accent = w.severity === 'critical' ? '#dc2626' : w.severity === 'warning' ? '#d97706' : '#2563eb';
              return (
                <div key={i} style={{
                  borderLeft: `3px solid ${accent}`,
                  background: `${accent}0a`,
                  padding: '7px 10px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '7px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.18em', color: accent }}>
                      {w.severity}
                    </span>
                    <span style={{ fontSize: '7px', color: '#d4d4d8' }}>·</span>
                    <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#71717a' }}>
                      {w.type}
                    </span>
                  </div>
                  <p style={{ fontSize: '8px', fontFamily: 'monospace', color: '#52525b', lineHeight: 1.5, margin: 0 }}>
                    {w.message}
                  </p>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ════════════════════════════════════════════
          VIBE TIMELINE — energy bar chart
      ════════════════════════════════════════════ */}
      {vibeTimeline && vibeTimeline.length > 0 && (
        <Section label={`Vibe Timeline — ${vibeTimeline.length} Segments`}>
          <div style={{ display: 'flex', gap: '1.5px', height: '36px', alignItems: 'flex-end' }}>
            {vibeTimeline.map((seg, i) => {
              const e = seg.normalizedEnergy;
              const color = e > 0.7 ? '#2563eb' : e > 0.4 ? '#7c3aed' : '#a1a1aa';
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
                  title={`${seg.label} · ${seg.energyDb.toFixed(1)} dB`}>
                  <div style={{
                    height: `${Math.max(8, e * 100)}%`,
                    background: color,
                    opacity: 0.55 + e * 0.45,
                  }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
            <span style={{ fontSize: '7px', color: '#a1a1aa' }}>0:00</span>
            <span style={{ fontSize: '7px', color: '#a1a1aa' }}>{fmtDuration(duration)}</span>
          </div>
        </Section>
      )}

      {/* ════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════ */}
      <div style={{
        marginTop: 'auto', paddingTop: '16px',
        borderTop: '2px solid #e4e4e7',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
      }}>
        <div>
          <p style={{ fontSize: '7px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#71717a' }}>
            Sonic<span style={{ color: '#2563eb' }}>Pro</span> · DSP Engine v6
          </p>
          <p style={{ fontSize: '7px', color: '#d4d4d8', marginTop: '2px', letterSpacing: '0.08em' }}>
            EBU R128 · ITU-R BS.1770-4 · FFT 8192pt · Cooley-Tukey Radix-2 · Zero-dependency DSP
          </p>
        </div>
        <p style={{ fontSize: '7px', color: '#d4d4d8', fontFamily: 'monospace' }}>
          {new Date().toISOString()}
        </p>
      </div>

    </div>
  );
};

// ─── Small section wrapper ────────────────────────────────────
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <p style={{
        fontSize: '7px', fontWeight: 700, letterSpacing: '0.28em',
        textTransform: 'uppercase', color: '#a1a1aa',
        borderBottom: '1px solid #f4f4f5', paddingBottom: '5px', marginBottom: '10px',
      }}>
        {label}
      </p>
      {children}
    </div>
  );
}
