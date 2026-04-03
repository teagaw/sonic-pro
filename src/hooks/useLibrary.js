/**
 * @file src/hooks/useLibrary.js — Cloud library: save, fetch, delete analyses
 *
 * Limit policy:
 *   Free tier: 20 saved analyses per user.
 *   Warn at 15 ("5 slots remaining").
 *   Block at 20 ("Library full").
 *
 * Graceful degradation:
 *   If Supabase is unreachable (network error), operations fail with a
 *   user-facing error message. The app never crashes; local analysis continues.
 *
 * Usage:
 *   const { analyses, saveAnalysis, deleteAnalysis, fetchAnalyses,
 *           count, isFull, isNearFull, loading, error } = useLibrary(user);
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

/** Maximum saved analyses per user (soft client limit, hard server trigger optional). */
const MAX_ANALYSES = 20;
/** Threshold at which to show a "nearly full" warning. */
const WARN_AT      = 15;

/**
 * @typedef {Object} SavedAnalysis
 * @property {string}  id               Row UUID
 * @property {string}  created_at       ISO timestamp
 * @property {string}  file_name        Original mix file name
 * @property {number}  integrated_lufs  EBU R128 LUFS value
 * @property {number}  peak_db          True peak dBFS
 * @property {number}  crest_factor     Dynamic range proxy
 * @property {string|null} profile_id   Genre profile used (or null)
 * @property {Object}  full_data        Complete analysis snapshot
 */

/**
 * Hook for managing the user's saved analysis library.
 *
 * @param {import("@supabase/supabase-js").User | null} user  Current auth user
 * @returns {{
 *   analyses:       SavedAnalysis[],
 *   count:          number,
 *   isFull:         boolean,
 *   isNearFull:     boolean,
 *   loading:        boolean,
 *   error:          string | null,
 *   fetchAnalyses:  () => Promise<void>,
 *   saveAnalysis:   (payload: Object) => Promise<{ success: boolean, error?: string }>,
 *   deleteAnalysis: (id: string) => Promise<{ success: boolean, error?: string }>,
 * }}
 */
export function useLibrary(user) {
  const [analyses, setAnalyses] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  /** Fetch all analyses for the current user, newest first. */
  const fetchAnalyses = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !user) return;

    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("analyses")
      .select("id, created_at, file_name, integrated_lufs, peak_db, crest_factor, profile_id, full_data")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_ANALYSES + 5); // fetch a few extra to detect overflow

    if (fetchError) {
      setError("Could not load library. Check your connection and try again.");
    } else {
      setAnalyses(data ?? []);
    }

    setLoading(false);
  }, [user]);

  // Auto-fetch when the user logs in or changes
  useEffect(() => {
    if (user) fetchAnalyses();
    else       setAnalyses([]);
  }, [user, fetchAnalyses]);

  /**
   * Save an analysis snapshot to the user's cloud library.
   *
   * @param {Object}      params
   * @param {string}      params.fileName        Original file name (display only)
   * @param {Object}      params.mixHealth       Mix health metrics object
   * @param {Object|null} params.referenceHealth Reference track health (or null)
   * @param {Object|null} params.vibeTimeline    Vibe timeline array (or null)
   * @param {Object|null} params.delta           Delta result (or null)
   * @param {string|null} params.selectedProfile Profile id (or null)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  const saveAnalysis = useCallback(async (params) => {
    if (!isSupabaseConfigured || !supabase || !user) {
      return { success: false, error: "Not authenticated." };
    }

    if (analyses.length >= MAX_ANALYSES) {
      return {
        success: false,
        error:   "Library full (20 analyses). Delete an old analysis to save a new one.",
      };
    }

    const { fileName, mixHealth, referenceHealth, vibeTimeline, delta, selectedProfile } = params;

    const row = {
      user_id:         user.id,
      file_name:       fileName ?? "Unknown file",
      integrated_lufs: mixHealth?.integratedLufs ?? null,
      peak_db:         mixHealth?.peakDb         ?? null,
      crest_factor:    mixHealth?.crestFactor     ?? null,
      profile_id:      selectedProfile !== "none" ? (selectedProfile ?? null) : null,
      full_data: {
        mixHealth,
        referenceHealth: referenceHealth ?? null,
        vibeTimeline:    vibeTimeline    ?? null,
        delta:           delta           ?? null,
        selectedProfile: selectedProfile ?? null,
        savedAt:         new Date().toISOString(),
      },
    };

    const { error: insertError } = await supabase
      .from("analyses")
      .insert(row);

    if (insertError) {
      const msg = insertError.message.includes("limit")
        ? "Library full (20 analyses). Delete one to save."
        : "Failed to save. Check your connection and try again.";
      return { success: false, error: msg };
    }

    // Optimistically refresh the list
    await fetchAnalyses();
    return { success: true };
  }, [user, analyses.length, fetchAnalyses]);

  /**
   * Permanently delete a saved analysis by its row ID.
   *
   * @param {string} id  UUID of the row to delete
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  const deleteAnalysis = useCallback(async (id) => {
    if (!isSupabaseConfigured || !supabase || !user) {
      return { success: false, error: "Not authenticated." };
    }

    const { error: deleteError } = await supabase
      .from("analyses")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id); // redundant with RLS, but explicit is safer

    if (deleteError) {
      return { success: false, error: "Failed to delete. Try again." };
    }

    setAnalyses(prev => prev.filter(a => a.id !== id));
    return { success: true };
  }, [user]);

  const count      = analyses.length;
  const isFull     = count >= MAX_ANALYSES;
  const isNearFull = count >= WARN_AT && !isFull;

  return {
    analyses,
    count,
    isFull,
    isNearFull,
    loading,
    error,
    fetchAnalyses,
    saveAnalysis,
    deleteAnalysis,
  };
}
