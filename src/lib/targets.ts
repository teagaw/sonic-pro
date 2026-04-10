/**
 * src/lib/targets.ts — Genre Target Profiles v5
 *
 * Each profile defines RELATIVE dB offsets between 7 spectral bands,
 * anchored to the median of the user's own band levels.
 * This is the same anchor-based system from the original Sonic Pro,
 * extended to 7 bands to match the UI.
 *
 * bandRatios.*.relative: expected dB offset from the median anchor.
 * targetLufs: typical mastered loudness for streaming on this genre.
 */

import type { SpectralBands } from './types';

export interface BandRatio { relative: number; label: string }

export interface GoldenTarget {
  id:          string;
  name:        string;
  genre:       string;
  targetLufs:  number;
  description: string;
  // Absolute band levels (for display in Golden Targets gallery)
  spectral:    SpectralBands;
  // Relative band ratios (for Delta Engine profile mode)
  bandRatios:  Record<keyof SpectralBands, BandRatio>;
}

export const GOLDEN_TARGETS: GoldenTarget[] = [
  {
    id: 'edm', name: 'EDM Mastery', genre: 'EDM',
    targetLufs: -7.5,
    description: 'Punchy lows, controlled mids, open top',
    spectral: { sub:-10, bass:-8, lowMid:-14, mid:-18, highMid:-20, presence:-22, brilliance:-28 },
    bandRatios: {
      sub:        { relative: -2.0, label: 'Elevated sub for punch' },
      bass:       { relative:  0.0, label: 'Anchor (median reference)' },
      lowMid:     { relative:  2.0, label: '+2.0dB vs median' },
      mid:        { relative:  3.0, label: '+3.0dB vs median' },
      highMid:    { relative:  4.5, label: '+4.5dB vs median' },
      presence:   { relative:  5.5, label: '+5.5dB vs median' },
      brilliance: { relative:  7.0, label: '+7.0dB vs median — open air' },
    },
  },
  {
    id: 'trap', name: 'Trap / Hip-Hop', genre: 'Trap',
    targetLufs: -8.0,
    description: 'Heavy 808s, thick low-mids, present vocals',
    spectral: { sub:-6, bass:-10, lowMid:-18, mid:-20, highMid:-22, presence:-24, brilliance:-30 },
    bandRatios: {
      sub:        { relative: -3.5, label: 'Heavy sub/808s' },
      bass:       { relative:  0.0, label: 'Anchor (median reference)' },
      lowMid:     { relative:  3.5, label: '+3.5dB vs median' },
      mid:        { relative:  4.0, label: '+4.0dB vs median' },
      highMid:    { relative:  4.5, label: '+4.5dB vs median' },
      presence:   { relative:  5.0, label: '+5.0dB vs median' },
      brilliance: { relative:  5.5, label: '+5.5dB vs median' },
    },
  },
  {
    id: 'pop', name: 'Modern Pop', genre: 'Pop',
    targetLufs: -9.0,
    description: 'Vocal-forward, compressed, bright highs',
    spectral: { sub:-14, bass:-12, lowMid:-16, mid:-14, highMid:-18, presence:-20, brilliance:-24 },
    bandRatios: {
      sub:        { relative:  1.5, label: 'Light sub' },
      bass:       { relative:  0.0, label: 'Anchor (median reference)' },
      lowMid:     { relative:  1.5, label: '+1.5dB vs median' },
      mid:        { relative:  3.5, label: '+3.5dB vs median — vocal focus' },
      highMid:    { relative:  5.5, label: '+5.5dB vs median' },
      presence:   { relative:  6.0, label: '+6.0dB vs median' },
      brilliance: { relative:  7.5, label: '+7.5dB vs median — bright pop air' },
    },
  },
  {
    id: 'techno', name: 'Dark Techno', genre: 'Techno',
    targetLufs: -7.0,
    description: 'Dense sub, punchy kick, flat high-mids',
    spectral: { sub:-8, bass:-8, lowMid:-12, mid:-18, highMid:-22, presence:-26, brilliance:-32 },
    bandRatios: {
      sub:        { relative: -1.5, label: 'Dense sub' },
      bass:       { relative:  0.0, label: 'Anchor (median reference)' },
      lowMid:     { relative:  2.0, label: '+2.0dB vs median' },
      mid:        { relative:  4.0, label: '+4.0dB vs median' },
      highMid:    { relative:  4.5, label: '+4.5dB vs median' },
      presence:   { relative:  4.5, label: '+4.5dB vs median' },
      brilliance: { relative:  5.0, label: '+5.0dB vs median' },
    },
  },
  {
    id: 'rock', name: 'Rock / Indie', genre: 'Rock',
    targetLufs: -11.0,
    description: 'Natural dynamics, guitar presence, room feel',
    spectral: { sub:-16, bass:-10, lowMid:-12, mid:-13, highMid:-15, presence:-18, brilliance:-22 },
    bandRatios: {
      sub:        { relative:  2.0, label: 'Modest sub' },
      bass:       { relative:  0.0, label: 'Anchor (median reference)' },
      lowMid:     { relative:  2.0, label: '+2.0dB vs median' },
      mid:        { relative:  3.5, label: '+3.5dB vs median' },
      highMid:    { relative:  3.5, label: '+3.5dB vs median — guitar bite' },
      presence:   { relative:  4.0, label: '+4.0dB vs median' },
      brilliance: { relative:  4.5, label: '+4.5dB vs median' },
    },
  },
  {
    id: 'cinematic', name: 'Cinematic / Film', genre: 'Film Score',
    targetLufs: -18.0,
    description: 'Full range, wide dynamics, immersive',
    spectral: { sub:-10, bass:-11, lowMid:-14, mid:-15, highMid:-17, presence:-19, brilliance:-20 },
    bandRatios: {
      sub:        { relative: -1.0, label: 'Rumble + weight' },
      bass:       { relative:  0.0, label: 'Anchor (median reference)' },
      lowMid:     { relative:  1.5, label: '+1.5dB vs median' },
      mid:        { relative:  2.5, label: '+2.5dB vs median' },
      highMid:    { relative:  3.5, label: '+3.5dB vs median' },
      presence:   { relative:  5.0, label: '+5.0dB vs median' },
      brilliance: { relative:  8.0, label: '+8.0dB vs median — extended air' },
    },
  },
];

const LS_KEY = 'sonic-pro-custom-profiles-v5';
const MAX_CUSTOM = 10;

export function loadCustomProfiles(): Record<string, GoldenTarget> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveCustomProfile(profile: GoldenTarget): void {
  const custom = loadCustomProfiles();
  if (Object.keys(custom).length >= MAX_CUSTOM)
    throw new Error(`Maximum ${MAX_CUSTOM} custom profiles. Delete one before saving.`);
  (custom as any)[profile.id] = { ...profile, isCustom: true, savedAt: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify(custom));
}

export function deleteCustomProfile(id: string): void {
  try {
    const custom = loadCustomProfiles();
    delete custom[id];
    localStorage.setItem(LS_KEY, JSON.stringify(custom));
  } catch {}
}

export function getAllProfiles(): Record<string, GoldenTarget> {
  return { ...Object.fromEntries(GOLDEN_TARGETS.map(t => [t.id, t])), ...loadCustomProfiles() };
}
