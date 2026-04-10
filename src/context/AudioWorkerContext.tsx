/**
 * AudioWorkerContext.tsx — Singleton DSP Worker Manager
 *
 * Worker created ONCE at module scope — survives React.StrictMode
 * double-invokes and component re-mounts. Never terminated during session.
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

type WorkerState = 'loading' | 'ready' | 'error';

interface WorkerContextValue {
  subscribe:    (handler: (msg: any) => void) => () => void;
  postToWorker: (message: any, transferables?: Transferable[]) => void;
  modelState:   WorkerState;
  modelError:   string | null;
}

let _workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (!_workerInstance) {
    _workerInstance = new Worker(
      new URL('../workers/audioWorker.ts', import.meta.url),
      { type: 'module' }
    );
    _workerInstance.postMessage({ type: 'INIT' });
  }
  return _workerInstance;
}

const AudioWorkerContext = createContext<WorkerContextValue | null>(null);

export function AudioWorkerProvider({ children }: { children: React.ReactNode }) {
  const workerRef    = useRef(getWorker());
  const listenersRef = useRef(new Set<(msg: any) => void>());
  const [modelState, setModelState] = useState<WorkerState>('loading');
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    const worker = workerRef.current;

    const onMessage = (event: MessageEvent) => {
      const { type } = event.data;
      if (type === 'ENGINE_READY' || type === 'MODEL_READY') setModelState('ready');
      if (type === 'MODEL_ERROR') { setModelState('error'); setModelError(event.data.error); }
      listenersRef.current.forEach(h => { try { h(event.data); } catch {} });
    };

    const onError = (err: ErrorEvent) => {
      setModelState('error');
      setModelError(err.message ?? 'Worker error');
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error',   onError);

    return () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error',   onError);
      // Intentionally NOT terminating — worker is a session-long singleton
    };
  }, []);

  const subscribe = useCallback((handler: (msg: any) => void) => {
    listenersRef.current.add(handler);
    return () => listenersRef.current.delete(handler);
  }, []);

  const postToWorker = useCallback((message: any, transferables: Transferable[] = []) => {
    workerRef.current.postMessage(message, transferables);
  }, []);

  return (
    <AudioWorkerContext.Provider value={{ subscribe, postToWorker, modelState, modelError }}>
      {children}
    </AudioWorkerContext.Provider>
  );
}

export function useWorkerContext(): WorkerContextValue {
  const ctx = useContext(AudioWorkerContext);
  if (!ctx) throw new Error('useWorkerContext must be inside <AudioWorkerProvider>');
  return ctx;
}

export default AudioWorkerContext;
