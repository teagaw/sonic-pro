/**
 * useAudioAnalyzer.js — Audio Analyzer Hook (v4)
 *
 * Changes from v3:
 *   - Imports getAllProfiles from targetProfiles.js
 *   - Accepts selectedProfileId prop; forwards targetProfile to worker payload
 *   - postToWorker exposed so dashboard can call COMPUTE_DELTA_ONLY directly
 *   - Existing zero-copy ArrayBuffer transfer unchanged
 */

import { useState, useCallback, useEffect } from "react";
import { useWorkerContext } from "../context/AudioWorkerContext";
import { getAllProfiles }   from "../constants/targetProfiles";

// ─────────────────────────────────────────────────────────────
//  CONSTANTS (must match audioWorker.js)
// ─────────────────────────────────────────────────────────────
const FFT_SIZE = 4096;
const SR_MIN   = 8000;
const SR_MAX   = 384000;
const MAX_DURATION_SEC = 1200; // 20 minutes (Free tier limit)

// ─────────────────────────────────────────────────────────────
//  STATE FACTORY
// ─────────────────────────────────────────────────────────────
function makeTrackState() {
  return {
    status:       "idle",   // "idle"|"decoding"|"analyzing"|"done"|"error"
    fileName:     null,
    progress:     0,
    mixHealth:    null,
    vibeTimeline: null,
    error:        null,
  };
}

// ─────────────────────────────────────────────────────────────
//  STEREO DECODER
// ─────────────────────────────────────────────────────────────

/**
 * Decode an audio File into separate Left and Right Float32Arrays.
 * Stereo → left=ch0, right=ch1.
 * Mono   → left=ch0, right=copy of ch0 (distinct buffer for transfer).
 * Both ArrayBuffers are transferred zero-copy to the worker.
 */
async function decodeAudioFile(file) {
  const raw     = await file.arrayBuffer();
  const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await tempCtx.decodeAudioData(raw);
  await tempCtx.close();

  const { sampleRate, numberOfChannels, length: totalSamples } = decoded;
  const left  = new Float32Array(decoded.getChannelData(0));
  const right = numberOfChannels > 1
    ? new Float32Array(decoded.getChannelData(1))
    : new Float32Array(left);

  return { left, right, sampleRate, totalSamples };
}

/**
 * Pre-flight validation before ArrayBuffer transfer.
 * Gives instant UI feedback without a worker round-trip.
 */
function validateDecodedAudio(sampleRate, totalSamples, fileName) {
  if (sampleRate < SR_MIN || sampleRate > SR_MAX) {
    throw new Error(
      `"${fileName}" has an unsupported sample rate (${sampleRate} Hz). ` +
      `Supported: ${SR_MIN}–${SR_MAX} Hz. Re-export at 44.1kHz or 48kHz.`
    );
  }
  if (totalSamples < FFT_SIZE) {
    const ms = (totalSamples / sampleRate * 1000).toFixed(0);
    throw new Error(
      `"${fileName}" is too short (${ms} ms). ` +
      `Minimum: ${(FFT_SIZE / 44100 * 1000).toFixed(0)} ms. Load a complete track.`
    );
  }
  // Duration check: prevent memory exhaustion (20 min free tier limit)
  const durationSec = totalSamples / sampleRate;
  if (durationSec > MAX_DURATION_SEC) {
    const mins = Math.floor(MAX_DURATION_SEC / 60);
    throw new Error(
      `"${fileName}" exceeds ${mins}-minute Free Tier limit. ` +
      `Upgrade to Pro for unlimited analysis.`
    );
  }
}

// ─────────────────────────────────────────────────────────────
//  HOOK
// ─────────────────────────────────────────────────────────────

/**
 * useAudioAnalyzer
 *
 * @param {{ selectedProfileId?: string }} [options]
 *   selectedProfileId: currently selected genre profile id, or "none"
 *
 * @returns {{
 *   state:         { user, reference, delta, deltaReady },
 *   loadTrack:     (file: File, trackType: "user"|"reference") => Promise<void>,
 *   reset:         () => void,
 *   modelState:    string,
 *   modelError:    string|null,
 *   postToWorker:  (message: Object, transferables?: Transferable[]) => void,
 * }}
 */
export function useAudioAnalyzer({ selectedProfileId = "none" } = {}) {
  const { subscribe, postToWorker, modelState, modelError } = useWorkerContext();

  const [state, setState] = useState({
    user:       makeTrackState(),
    reference:  makeTrackState(),
    delta:      null,
    deltaReady: false,
  });

  // ── Subscribe to worker messages ────────────────────────────
  useEffect(() => {
    const unsub = subscribe((msg) => {
      switch (msg.type) {

        case "PROGRESS":
          setState(prev => ({
            ...prev,
            [msg.trackType]: {
              ...prev[msg.trackType],
              progress: msg.percent,
              status:   msg.percent >= 100 ? "done" : "analyzing",
            },
          }));
          break;

        case "TRACK_ANALYZED":
          setState(prev => ({
            ...prev,
            [msg.trackType]: {
              ...prev[msg.trackType],
              status:       "done",
              progress:     100,
              mixHealth:    msg.payload.mixHealth,
              vibeTimeline: msg.payload.vibeTimeline,
              error:        null,
            },
          }));
          break;

        case "DELTA_READY":
          setState(prev => ({
            ...prev,
            delta:      msg.payload.delta,
            deltaReady: true,
          }));
          break;

        case "ERROR":
          setState(prev => {
            // Worker errors may or may not carry a trackType
            if (msg.trackType) {
              return {
                ...prev,
                [msg.trackType]: {
                  ...prev[msg.trackType],
                  status:   "error",
                  error:    msg.error,
                  progress: 0,
                },
              };
            }
            return prev; // delta-only errors don't affect track state
          });
          break;

        case "RESET_OK":
          setState({
            user:       makeTrackState(),
            reference:  makeTrackState(),
            delta:      null,
            deltaReady: false,
          });
          break;

        default:
          break;
      }
    });
    return unsub;
  }, [subscribe]);

  // ── loadTrack ────────────────────────────────────────────────
  /**
   * Decode and analyze an audio file.
   * Passes targetProfile to the worker so it can emit a profile-mode
   * DELTA_READY immediately after analysis (no second round-trip needed).
   *
   * @param {File} file
   * @param {"user"|"reference"} trackType
   */
  const loadTrack = useCallback(async (file, trackType) => {
    if (!file) return;

    setState(prev => ({
      ...prev,
      [trackType]: {
        ...prev[trackType],
        status: "decoding", fileName: file.name, progress: 0, error: null,
      },
    }));

    try {
      const { left, right, sampleRate, totalSamples } = await decodeAudioFile(file);
      validateDecodedAudio(sampleRate, totalSamples, file.name);

      setState(prev => ({
        ...prev,
        [trackType]: { ...prev[trackType], status: "analyzing", progress: 5 },
      }));

      // Resolve current profile (null if "none")
      const targetProfile = selectedProfileId !== "none"
        ? (getAllProfiles()[selectedProfileId] ?? null)
        : null;

      // ZERO-COPY STEREO TRANSFER
      postToWorker(
        {
          type: "ANALYZE_TRACK",
          payload: {
            leftBuffer:  left.buffer,
            rightBuffer: right.buffer,
            sampleRate,
            trackType,
            targetProfile, // null = reference-only mode; profile = immediate profile delta
          },
        },
        [left.buffer, right.buffer]
      );

    } catch (err) {
      setState(prev => ({
        ...prev,
        [trackType]: {
          ...prev[trackType],
          status: "error",
          error:  err.message ?? "Failed to decode audio file.",
        },
      }));
    }
  }, [postToWorker, selectedProfileId]);

  // ── reset ────────────────────────────────────────────────────
  const reset = useCallback(() => {
    postToWorker({ type: "RESET" });
  }, [postToWorker]);

  // Expose postToWorker so MixHealthDashboard can fire COMPUTE_DELTA_ONLY
  return { state, loadTrack, reset, modelState, modelError, postToWorker };
}

export default useAudioAnalyzer;
