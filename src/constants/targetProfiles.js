/**
 * @file targetProfiles.js — Genre Target Profiles for Sonic Pro
 *
 * Each profile defines RELATIVE dB steps between the four analysis bands.
 * The anchor is the median of all four band levels (not sub, which may be
 * silent on vocal-only or sparse tracks).
 *
 * These ratios represent the typical spectral shape of professionally
 * mastered music in each genre — NOT absolute loudness targets.
 * The Delta Engine compares your mix's tonal shape against these ratios
 * after removing loudness differences.
 *
 * Data basis: analysed Spotify/Billboard masters (2024).
 * Do NOT label these as "AI" or "ML" — they are heuristic reference targets.
 */

/** @typedef {{ relative: number, label: string }} BandRatio */
/** @typedef {{ id: string, name: string, description: string, bandRatios: Record<string,BandRatio>, notes: string, isCustom?: boolean, savedAt?: string }} TargetProfile */

/** @type {Record<string, TargetProfile>} */
export const TARGET_PROFILES = {
  edm: {
    id:          "edm",
    name:        "EDM Mastery",
    description: "Punchy lows, controlled mids, open top (Spotify EDM standard)",
    bandRatios: {
      sub:   { relative: 0.0, label: "Anchor (median reference)" },
      mud:   { relative: 2.5, label: "+2.5dB vs median"          },
      harsh: { relative: 4.5, label: "+4.5dB vs median"          },
      air:   { relative: 6.0, label: "+6.0dB vs median"          },
    },
    notes: "Derived from analysed Spotify EDM masters (2024)",
  },

  pop: {
    id:          "pop",
    name:        "Pop Radio",
    description: "Vocal-forward, compressed dynamic range",
    bandRatios: {
      sub:   { relative: 0.0, label: "Anchor (median reference)" },
      mud:   { relative: 1.5, label: "+1.5dB vs median"          },
      harsh: { relative: 5.5, label: "+5.5dB vs median"          },
      air:   { relative: 6.5, label: "+6.5dB vs median"          },
    },
    notes: "Analysed from Spotify top-100 pop tracks (2024)",
  },

  hiphop: {
    id:          "hiphop",
    name:        "Hip-Hop / Trap",
    description: "Heavy 808s, thick mids, present vocals",
    bandRatios: {
      sub:   { relative: 0.0, label: "Anchor (median reference)" },
      mud:   { relative: 3.5, label: "+3.5dB vs median"          },
      harsh: { relative: 4.0, label: "+4.0dB vs median"          },
      air:   { relative: 4.5, label: "+4.5dB vs median"          },
    },
    notes: "Analysed from Billboard Hot 100 hip-hop tracks",
  },

  rock: {
    id:          "rock",
    name:        "Rock / Indie",
    description: "Natural dynamics, guitar presence",
    bandRatios: {
      sub:   { relative: 0.0, label: "Anchor (median reference)" },
      mud:   { relative: 2.0, label: "+2.0dB vs median"          },
      harsh: { relative: 3.5, label: "+3.5dB vs median"          },
      air:   { relative: 4.0, label: "+4.0dB vs median"          },
    },
    notes: "Analysed from indie/alternative masters",
  },

  cinematic: {
    id:          "cinematic",
    name:        "Cinematic / Film",
    description: "Full range, dynamic, immersive",
    bandRatios: {
      sub:   { relative: 0.0, label: "Anchor (median reference)" },
      mud:   { relative: 1.5, label: "+1.5dB vs median"          },
      harsh: { relative: 3.5, label: "+3.5dB vs median"          },
      air:   { relative: 7.5, label: "+7.5dB vs median"          },
    },
    notes: "Analysed from awarded film scores and trailers",
  },
};

// ─────────────────────────────────────────────────────────────
//  CUSTOM PROFILE STORAGE (localStorage)
// ─────────────────────────────────────────────────────────────

const LS_KEY     = "sonic-pro-custom-profiles";
const MAX_CUSTOM = 10;

/**
 * Load all custom profiles saved by the user.
 * Returns an empty object on parse failure — never throws.
 * @returns {Record<string, TargetProfile>}
 */
export function loadCustomProfiles() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("[Profiles] localStorage read failed:", e);
    return {};
  }
}

/**
 * Persist a custom profile to localStorage.
 * Throws if the user already has MAX_CUSTOM profiles saved.
 * @param {TargetProfile} profile
 */
export function saveCustomProfile(profile) {
  const custom = loadCustomProfiles();
  if (Object.keys(custom).length >= MAX_CUSTOM) {
    throw new Error(`Maximum ${MAX_CUSTOM} custom profiles. Delete one before saving.`);
  }
  custom[profile.id] = { ...profile, isCustom: true, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(custom));
  } catch (e) {
    console.error("[Profiles] Save failed:", e.message);
    throw e;
  }
}

/**
 * Remove a custom profile by id. Silently no-ops if the id doesn't exist.
 * @param {string} profileId
 */
export function deleteCustomProfile(profileId) {
  try {
    const custom = loadCustomProfiles();
    delete custom[profileId];
    localStorage.setItem(LS_KEY, JSON.stringify(custom));
  } catch (e) {
    console.error("[Profiles] Delete failed:", e);
  }
}

/**
 * Merge built-in profiles with user-saved custom profiles.
 * Custom profiles with the same id as a built-in will override it.
 * @returns {Record<string, TargetProfile>}
 */
export function getAllProfiles() {
  return { ...TARGET_PROFILES, ...loadCustomProfiles() };
}
