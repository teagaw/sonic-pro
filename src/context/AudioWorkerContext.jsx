/**
 * AudioWorkerContext.jsx — Singleton DSP Worker Manager
 *
 * The Web Worker is instantiated ONCE at the module level, OUTSIDE any
 * React component lifecycle. React.StrictMode double-invokes effects —
 * keeping the worker at module scope guarantees it is never recreated,
 * even during hot reloads in development.
 *
 * Architecture:
 *   MODULE LEVEL   → worker instance created (survives all re-renders)
 *   Context Value  → { workerRef, subscribe, postToWorker, modelState }
 *   Consumers      → useAudioAnalyzer() calls postToWorker / subscribe
 *
 * The worker runs pure DSP code (FFT, Butterworth IIR filters, EBU R128
 * LUFS, spectral flatness). There are no ML models or external libraries.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";

// ─────────────────────────────────────────────────────────────
//  SINGLETON WORKER — created at module scope, never recreated
// ─────────────────────────────────────────────────────────────
let _workerInstance = null;

function getWorker() {
  if (!_workerInstance) {
    // Path is relative to THIS file (src/context/).
    // "../workers/audioWorker.js" correctly resolves to src/workers/audioWorker.js.
    // Do NOT change to "../audioWorker.js" — that path does not exist.
    _workerInstance = new Worker(
      new URL("../workers/audioWorker.js", import.meta.url),
      { type: "module" }
    );
    // Send INIT so the worker signals it is ready.
    // The worker responds with MODEL_READY immediately — this message type
    // is kept for API compatibility with the UI state machine; there is
    // no model to load. The DSP engine initialises synchronously.
    _workerInstance.postMessage({ type: "INIT" });
  }
  return _workerInstance;
}

// ─────────────────────────────────────────────────────────────
//  CONTEXT
// ─────────────────────────────────────────────────────────────
const AudioWorkerContext = createContext(null);

/**
 * @typedef {Object} WorkerContextValue
 * @property {{ current: Worker }} workerRef        — direct Worker reference
 * @property {(handler: Function) => () => void} subscribe — register a message handler; returns unsubscribe fn
 * @property {(message: Object, transferables?: Transferable[]) => void} postToWorker
 * @property {"idle"|"loading"|"ready"|"error"} modelState
 * @property {string|null} modelError
 * @property {"dark"|"light"} theme
 * @property {Function} toggleTheme
 */

/**
 * AudioWorkerProvider
 *
 * Wrap your app (or the sub-tree that uses audio analysis) with this provider.
 * Keep it high in the tree — ideally at <App /> level — so the context
 * (and therefore the worker) is never unmounted during a user session.
 *
 * Props:
 *   - children: React nodes
 *   - theme: "dark" | "light" (for future use, passed through)
 *   - toggleTheme: function to toggle theme
 */
export function AudioWorkerProvider({ children, theme, toggleTheme }) {
  const workerRef               = useRef(getWorker());
  const listenersRef            = useRef(new Set());
  const [modelState, setModelState] = useState("loading");
  const [modelError, setModelError] = useState(null);

  // ── Wire up the central message router ────────────────────
  useEffect(() => {
    const worker = workerRef.current;

    const onMessage = (event) => {
      const { type } = event.data;

      // Handle worker lifecycle messages at the provider level.
      // MODEL_READY / MODEL_LOADING / MODEL_ERROR are the worker protocol
      // message names — kept for compatibility with the UI state machine.
      if (type === "MODEL_READY")    setModelState("ready");
      if (type === "MODEL_LOADING")  setModelState("loading");
      if (type === "MODEL_ERROR") {
        setModelState("error");
        setModelError(event.data.error);
      }

      // Fan out to all registered subscribers
      listenersRef.current.forEach((handler) => {
        try { handler(event.data); } catch { /* individual handlers must not crash the router */ }
      });
    };

    const onError = (err) => {
      setModelState("error");
      setModelError(err.message ?? "Unknown worker error");
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error",   onError);

    return () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error",   onError);
      // NOTE: We intentionally do NOT terminate the worker here.
      // The provider lives for the full session; terminating on unmount
      // (which can happen in StrictMode) would kill the DSP engine mid-session.
    };
  }, []); // empty deps — runs once, tied to the singleton

  // ── Public API ─────────────────────────────────────────────

  /**
   * Subscribe to worker messages.
   * Returns an unsubscribe function — call it in your useEffect cleanup.
   *
   * @param {(message: Object) => void} handler
   * @returns {() => void} unsubscribe
   */
  const subscribe = useCallback((handler) => {
    listenersRef.current.add(handler);
    return () => listenersRef.current.delete(handler);
  }, []);

  /**
   * Post a message to the worker.
   * Pass an array of Transferable objects (e.g. ArrayBuffers) as the
   * second argument to trigger zero-copy transfer.
   *
   * @param {Object}         message
   * @param {Transferable[]} [transferables=[]]
   */
  const postToWorker = useCallback((message, transferables = []) => {
    workerRef.current.postMessage(message, transferables);
  }, []);

  /** @type {WorkerContextValue} */
  const value = {
    workerRef,
    subscribe,
    postToWorker,
    modelState,
    modelError,
    theme,
    toggleTheme,
  };

  return (
    <AudioWorkerContext.Provider value={value}>
      {children}
    </AudioWorkerContext.Provider>
  );
}

/**
 * useWorkerContext — raw access to the context.
 * Most consumers should use the higher-level useAudioAnalyzer() hook instead.
 *
 * @returns {WorkerContextValue}
 */
export function useWorkerContext() {
  const ctx = useContext(AudioWorkerContext);
  if (!ctx) {
    throw new Error(
      "useWorkerContext() must be used inside <AudioWorkerProvider>. " +
      "Wrap your app (or the relevant sub-tree) with <AudioWorkerProvider>."
    );
  }
  return ctx;
}

export default AudioWorkerContext;
