/**
 * useAudioAnalyzer.ts — Audio analysis hook (v5)
 *
 * Decodes audio on main thread → validates → zero-copy transfers to worker.
 * Exposes loadTrack, reset, and all analysis state.
 */

import { useState, useCallback, useEffect } from 'react';
import { useWorkerContext } from '../context/AudioWorkerContext';
import type { MixHealth, VibeSegment, DeltaResult } from '../lib/types';
import { getAllProfiles } from '../lib/targets';

const FFT_SIZE          = 8192;
const SR_MIN            = 8000;
const SR_MAX            = 384000;
const MAX_DURATION_SECS = 1200; // 20-minute Free tier limit

interface TrackState {
  status:       'idle' | 'decoding' | 'analyzing' | 'done' | 'error';
  fileName:     string | null;
  fileSize:     number;
  duration:     number;
  progress:     number;
  mixHealth:    MixHealth | null;
  vibeTimeline: VibeSegment[] | null;
  error:        string | null;
}

interface AnalyzerState {
  user:       TrackState;
  reference:  TrackState;
  delta:      DeltaResult | null;
  deltaReady: boolean;
}

function makeTrackState(): TrackState {
  return { status:'idle', fileName:null, fileSize:0, duration:0, progress:0, mixHealth:null, vibeTimeline:null, error:null };
}

async function decodeAudioFile(file: File) {
  const raw     = await file.arrayBuffer();
  const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await tempCtx.decodeAudioData(raw);
  await tempCtx.close();
  const { sampleRate, numberOfChannels, length: totalSamples, duration } = decoded;
  const left  = new Float32Array(decoded.getChannelData(0));
  const right = numberOfChannels > 1 ? new Float32Array(decoded.getChannelData(1)) : new Float32Array(left);
  return { left, right, sampleRate, totalSamples, duration };
}

function validateAudio(sampleRate: number, totalSamples: number, duration: number, fileName: string) {
  if (sampleRate < SR_MIN || sampleRate > SR_MAX)
    throw new Error(`"${fileName}" has unsupported sample rate (${sampleRate} Hz). Use 44.1kHz or 48kHz.`);
  if (totalSamples < FFT_SIZE)
    throw new Error(`"${fileName}" is too short. Minimum: ${(FFT_SIZE/44100*1000).toFixed(0)} ms.`);
  if (duration > MAX_DURATION_SECS) {
    const mins = (duration/60).toFixed(1);
    throw new Error(`"${fileName}" is ${mins} min. Free tier limit is 20 min. Upgrade to Pro.`);
  }
}

export function useAudioAnalyzer(selectedProfileId: string = 'none') {
  const { subscribe, postToWorker, modelState, modelError } = useWorkerContext();

  const [state, setState] = useState<AnalyzerState>({
    user:       makeTrackState(),
    reference:  makeTrackState(),
    delta:      null,
    deltaReady: false,
  });

  useEffect(() => {
    const unsub = subscribe((msg: any) => {
      switch (msg.type) {
        case 'PROGRESS':
          setState(prev => ({
            ...prev,
            [msg.trackType]: {
              ...prev[msg.trackType as 'user'|'reference'],
              progress: msg.percent,
              status:   msg.percent >= 100 ? 'done' : 'analyzing',
            },
          }));
          break;
        case 'TRACK_ANALYZED':
          setState(prev => ({
            ...prev,
            [msg.trackType]: {
              ...prev[msg.trackType as 'user'|'reference'],
              status:'done', progress:100,
              mixHealth:    msg.payload.mixHealth,
              vibeTimeline: msg.payload.vibeTimeline,
              error:null,
            },
          }));
          break;
        case 'DELTA_READY':
          setState(prev => ({ ...prev, delta: msg.payload.delta, deltaReady: true }));
          break;
        case 'ERROR':
          if (msg.trackType) {
            setState(prev => ({
              ...prev,
              [msg.trackType]: { ...prev[msg.trackType as 'user'|'reference'], status:'error', error:msg.error, progress:0 },
            }));
          }
          break;
        case 'RESET_OK':
          setState({ user:makeTrackState(), reference:makeTrackState(), delta:null, deltaReady:false });
          break;
      }
    });
    return unsub;
  }, [subscribe]);

  const loadTrack = useCallback(async (file: File, trackType: 'user' | 'reference') => {
    if (!file) return;
    setState(prev => ({
      ...prev,
      [trackType]: { ...makeTrackState(), status:'decoding', fileName:file.name, fileSize:file.size },
    }));

    try {
      const { left, right, sampleRate, totalSamples, duration } = await decodeAudioFile(file);
      validateAudio(sampleRate, totalSamples, duration, file.name);

      setState(prev => ({
        ...prev,
        [trackType]: { ...prev[trackType], status:'analyzing', duration, progress:5 },
      }));

      const targetProfile = selectedProfileId !== 'none' ? (getAllProfiles()[selectedProfileId] ?? null) : null;

      postToWorker(
        { type:'ANALYZE_TRACK', payload:{ leftBuffer:left.buffer, rightBuffer:right.buffer, sampleRate, trackType, targetProfile } },
        [left.buffer, right.buffer]
      );
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        [trackType]: { ...prev[trackType], status:'error', error: err.message ?? 'Failed to decode.' },
      }));
    }
  }, [postToWorker, selectedProfileId]);

  const reset = useCallback(() => postToWorker({ type: 'RESET' }), [postToWorker]);

  const computeDeltaOnly = useCallback((profileId: string) => {
    const profile = profileId !== 'none' ? (getAllProfiles()[profileId] ?? null) : null;
    postToWorker({ type: 'COMPUTE_DELTA_ONLY', payload: { targetProfile: profile } });
  }, [postToWorker]);

  return { state, loadTrack, reset, computeDeltaOnly, modelState, modelError, postToWorker };
}
