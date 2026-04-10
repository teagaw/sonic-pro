/**
 * src/hooks/useLibrary.ts — Cloud analysis library hook (v2)
 *
 * Changes: accepts isPro flag.
 * Free tier: 5 saves max.  Pro tier: unlimited.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured }   from "../lib/supabase";
import type { MixHealth, VibeSegment, DeltaResult } from "../lib/types";

const FREE_MAX = 5;

export interface SavedAnalysis {
  id:              string;
  created_at:      string;
  file_name:       string;
  integrated_lufs: number | null;
  peak_db:         number | null;
  crest_factor:    number | null;
  profile_id:      string | null;
  full_data:       any;
}

export function useLibrary(user: any | null, isPro: boolean = false) {
  const maxAnalyses = isPro ? Infinity : FREE_MAX;
  const warnAt      = isPro ? Infinity : FREE_MAX - 1;

  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const fetchAnalyses = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !user) return;
    setLoading(true);
    setError(null);
    const limit = isPro ? 500 : FREE_MAX + 5;
    const { data, error: fetchError } = await supabase
      .from("analyses")
      .select("id, created_at, file_name, integrated_lufs, peak_db, crest_factor, profile_id, full_data")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (fetchError) setError("Could not load library. Check your connection.");
    else setAnalyses(data ?? []);
    setLoading(false);
  }, [user, isPro]);

  useEffect(() => { if (user) fetchAnalyses(); else setAnalyses([]); }, [user, fetchAnalyses]);

  const saveAnalysis = useCallback(async (params: {
    fileName: string; mixHealth: MixHealth; referenceHealth: MixHealth | null;
    vibeTimeline: VibeSegment[] | null; delta: DeltaResult | null; selectedProfile: string | null;
  }) => {
    if (!isSupabaseConfigured || !supabase || !user)
      return { success: false, error: "Not authenticated." };
    if (!isPro && analyses.length >= FREE_MAX)
      return { success: false, error: `Library full (${FREE_MAX} saves on free tier). Upgrade to Pro for unlimited saves.` };

    const row = {
      user_id:         user.id,
      file_name:       params.fileName ?? "Unknown file",
      integrated_lufs: params.mixHealth?.integratedLufs ?? null,
      peak_db:         params.mixHealth?.peakDb         ?? null,
      crest_factor:    params.mixHealth?.crestFactor     ?? null,
      profile_id:      params.selectedProfile !== "none" ? (params.selectedProfile ?? null) : null,
      full_data: {
        mixHealth:       params.mixHealth,
        referenceHealth: params.referenceHealth ?? null,
        vibeTimeline:    params.vibeTimeline    ?? null,
        delta:           params.delta           ?? null,
        selectedProfile: params.selectedProfile ?? null,
        savedAt:         new Date().toISOString(),
      },
    };

    const { error: insertError } = await supabase.from("analyses").insert(row);
    if (insertError) {
      const msg = insertError.message.includes("limit") || insertError.message.includes("full")
        ? `Library full (${FREE_MAX} saves on free tier). Upgrade to Pro.`
        : "Failed to save. Check your connection.";
      return { success: false, error: msg };
    }
    await fetchAnalyses();
    return { success: true };
  }, [user, isPro, analyses.length, fetchAnalyses]);

  const deleteAnalysis = useCallback(async (id: string) => {
    if (!isSupabaseConfigured || !supabase || !user)
      return { success: false, error: "Not authenticated." };
    const { error: deleteError } = await supabase.from("analyses").delete().eq("id", id).eq("user_id", user.id);
    if (deleteError) return { success: false, error: "Failed to delete. Try again." };
    setAnalyses(prev => prev.filter(a => a.id !== id));
    return { success: true };
  }, [user]);

  const count      = analyses.length;
  const isFull     = count >= maxAnalyses;
  const isNearFull = count >= warnAt && !isFull;

  return { analyses, count, isFull, isNearFull, maxAnalyses, loading, error, fetchAnalyses, saveAnalysis, deleteAnalysis };
}
