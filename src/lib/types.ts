/**
 * Shared TypeScript types for Sonic Pro v5.
 * Single source of truth — imported by hooks, components, and worker.
 */

export interface SpectralBands {
  sub: number; bass: number; lowMid: number; mid: number;
  highMid: number; presence: number; brilliance: number;
}

export interface MixWarning {
  type:     string;
  severity: 'critical' | 'warning' | 'info';
  message:  string;
}

export interface MixHealth {
  peakDb:                   number;
  crestFactor:              number;
  centroid:                 number;
  rolloff:                  number;
  integratedLufs:           number;
  stereoWidth:              number;
  clippingPercent:          number;
  midRangeSpectralFlatness: number;
  spectralBands:            SpectralBands;
  warnings:                 MixWarning[];
}

export interface VibeSegment {
  startTime:        number;
  endTime:          number;
  energyDb:         number;
  normalizedEnergy: number;
  normalizedFlux:   number;
  midRangeFlatness: number;
  label:            string;
}

export interface DeltaBandResult {
  label:   string;
  userDb:  number;
  refDb:   number;
  delta:   number;
  verdict: string;
}

export interface DeltaResult {
  bands:          Record<string, DeltaBandResult>;
  gainOffset:     number;
  userLufs:       number;
  referenceLufs:  number | null;
  profileId:      string | null;
  profileMode:    boolean;
  score:          number;
  suggestions:    string[];
}

/** Shape stored in Supabase full_data column */
export interface AnalysisSnapshot {
  mixHealth:       MixHealth;
  referenceHealth: MixHealth | null;
  vibeTimeline:    VibeSegment[] | null;
  delta:           DeltaResult | null;
  selectedProfile: string | null;
  savedAt:         string;
}
