/**
 * src/hooks/useSubscription.ts
 *
 * Fetches the current user's subscription tier and this week's
 * feature usage counts.  Exposes computed permission flags so
 * every component can gate actions with a single boolean.
 *
 * Tier limits:
 *   Free → 3 exports/week · 5 library saves
 *   Pro  → unlimited everything
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured }   from "../lib/supabase";

// ─── Constants ────────────────────────────────────────────────
const FREE_LIMITS = {
  exportsPerWeek:  3,
  maxSaves:        5,
} as const;

const PRO_LIMITS = {
  exportsPerWeek:  Infinity,
  maxSaves:        Infinity,
} as const;

// ─── Types ────────────────────────────────────────────────────
interface UsageState {
  exportsThisWeek:  number;
}

export interface SubscriptionState {
  isPro:      boolean;
  status:     string;           // 'free' | 'active' | 'canceled' | 'past_due'
  periodEnd:  Date | null;
  usage:      UsageState;
  limits:     typeof FREE_LIMITS | typeof PRO_LIMITS;
  canExport:  boolean;
  loading:    boolean;
  refresh:    () => Promise<void>;
}

// ─── Week start helper (ISO Monday, UTC — matches DB date_trunc('week', now())) ──
function getWeekStart(): string {
  const now  = new Date();
  const day  = now.getUTCDay();               // 0 = Sunday
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
  return mon.toISOString().split("T")[0];
}

// ─── Hook ─────────────────────────────────────────────────────
export function useSubscription(user: any | null): SubscriptionState {
  const [isPro,     setIsPro]     = useState(false);
  const [status,    setStatus]    = useState("free");
  const [periodEnd, setPeriodEnd] = useState<Date | null>(null);
  const [usage,     setUsage]     = useState<UsageState>({ exportsThisWeek: 0 });
  const [loading,   setLoading]   = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !user) {
      setIsPro(false);
      setStatus("free");
      setPeriodEnd(null);
      setUsage({ exportsThisWeek: 0 });
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
        .select("exports_count")
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
      exportsThisWeek:  usageRes.data?.exports_count   ?? 0,
    });

    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const limits    = isPro ? PRO_LIMITS : FREE_LIMITS;
  const canExport = isPro || usage.exportsThisWeek   < FREE_LIMITS.exportsPerWeek;

  return { isPro, status, periodEnd, usage, limits, canExport, loading, refresh };
}
