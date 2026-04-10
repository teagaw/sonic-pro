/**
 * src/hooks/useSubscription.ts
 *
 * Fetches the current user's subscription tier and this week's
 * feature usage counts.  Exposes computed permission flags so
 * every component can gate actions with a single boolean.
 *
 * Tier limits:
 *   Free → 2 AI audits/week · 3 exports/week · 5 library saves
 *   Pro  → unlimited everything
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured }   from "../lib/supabase";

// ─── Constants ────────────────────────────────────────────────
export const FREE_LIMITS = {
  aiAuditsPerWeek: 2,
  exportsPerWeek:  3,
  maxSaves:        5,
} as const;

export const PRO_LIMITS = {
  aiAuditsPerWeek: Infinity,
  exportsPerWeek:  Infinity,
  maxSaves:        Infinity,
} as const;

// ─── Types ────────────────────────────────────────────────────
export interface UsageState {
  aiAuditsThisWeek: number;
  exportsThisWeek:  number;
}

export interface SubscriptionState {
  isPro:      boolean;
  status:     string;           // 'free' | 'active' | 'canceled' | 'past_due'
  periodEnd:  Date | null;
  usage:      UsageState;
  limits:     typeof FREE_LIMITS | typeof PRO_LIMITS;
  canUseAI:   boolean;
  canExport:  boolean;
  loading:    boolean;
  refresh:    () => Promise<void>;
}

// ─── Week start helper (ISO Monday) ──────────────────────────
function getWeekStart(): string {
  const now  = new Date();
  const day  = now.getDay();                  // 0 = Sunday
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split("T")[0];
}

// ─── Hook ─────────────────────────────────────────────────────
export function useSubscription(user: any | null): SubscriptionState {
  const [isPro,     setIsPro]     = useState(false);
  const [status,    setStatus]    = useState("free");
  const [periodEnd, setPeriodEnd] = useState<Date | null>(null);
  const [usage,     setUsage]     = useState<UsageState>({ aiAuditsThisWeek: 0, exportsThisWeek: 0 });
  const [loading,   setLoading]   = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !user) {
      setIsPro(false);
      setStatus("free");
      setPeriodEnd(null);
      setUsage({ aiAuditsThisWeek: 0, exportsThisWeek: 0 });
      return;
    }

    setLoading(true);

    // Fetch subscription and usage in parallel
    const [subRes, usageRes] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("user_usage")
        .select("ai_audits_count, exports_count")
        .eq("user_id", user.id)
        .eq("week_start", getWeekStart())
        .single(),
    ]);

    const subStatus = (subRes.data?.status ?? "free") as string;
    const pro       = subStatus === "active";
    setIsPro(pro);
    setStatus(subStatus);
    setPeriodEnd(subRes.data?.current_period_end ? new Date(subRes.data.current_period_end) : null);

    setUsage({
      aiAuditsThisWeek: usageRes.data?.ai_audits_count ?? 0,
      exportsThisWeek:  usageRes.data?.exports_count   ?? 0,
    });

    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const limits    = isPro ? PRO_LIMITS : FREE_LIMITS;
  const canUseAI  = isPro || usage.aiAuditsThisWeek  < FREE_LIMITS.aiAuditsPerWeek;
  const canExport = isPro || usage.exportsThisWeek   < FREE_LIMITS.exportsPerWeek;

  return { isPro, status, periodEnd, usage, limits, canUseAI, canExport, loading, refresh };
}
