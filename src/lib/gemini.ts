/**
 * src/lib/gemini.ts — AI Mix Coach client (v3)
 *
 * Calls the ai-advice Edge Function (server-side key, usage-gated).
 * Returns a structured response so SidePanel can differentiate
 * between a limit error and a real AI response.
 */

import { supabase, isSupabaseConfigured } from "./supabase";
import type { MixHealth, DeltaResult }    from "./types";
import type { GoldenTarget }              from "./targets";

export type AiAdviceCode = "AUTH_REQUIRED" | "LIMIT_REACHED" | "SERVICE_ERROR";

export interface AiAdviceResult {
  advice:    string;        // Display text (advice OR user-facing error message)
  code?:     AiAdviceCode; // Set only when the call failed
  remaining: number | null; // Remaining AI audits this week (null = Pro/unknown)
  isPro:     boolean;
}

export async function getAiMixAdvice(
  mixHealth: MixHealth,
  delta:     DeltaResult | null,
  target:    GoldenTarget,
): Promise<AiAdviceResult> {

  if (!isSupabaseConfigured || !supabase) {
    return {
      advice:    "AI Mix Coach requires Supabase to be configured.",
      code:      "SERVICE_ERROR",
      remaining: null,
      isPro:     false,
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke("ai-advice", {
      body: { mixHealth, delta, target },
    });

    // Network / function error
    if (error) {
      console.error("ai-advice invoke error:", error);
      // Supabase wraps HTTP errors — try to extract the JSON body
      const body = (error as any)?.context?.responseBody;
      if (body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.code === "LIMIT_REACHED") {
            return { advice: parsed.error, code: "LIMIT_REACHED", remaining: 0, isPro: false };
          }
          if (parsed.code === "AUTH_REQUIRED") {
            return { advice: parsed.error, code: "AUTH_REQUIRED", remaining: null, isPro: false };
          }
        } catch {}
      }
      return { advice: "AI Mix Coach is temporarily offline. Review DSP warnings directly.", code: "SERVICE_ERROR", remaining: null, isPro: false };
    }

    // Function returned a structured error
    if (data?.code === "LIMIT_REACHED") {
      return { advice: data.error, code: "LIMIT_REACHED", remaining: 0, isPro: false };
    }
    if (data?.code === "AUTH_REQUIRED") {
      return { advice: data.error, code: "AUTH_REQUIRED", remaining: null, isPro: false };
    }
    if (data?.error) {
      return { advice: data.error, code: "SERVICE_ERROR", remaining: null, isPro: false };
    }

    return {
      advice:    data?.advice ?? "Unable to generate advice at this time.",
      remaining: data?.remaining ?? null,
      isPro:     data?.isPro ?? false,
    };

  } catch (err) {
    console.error("getAiMixAdvice error:", err);
    return { advice: "AI Mix Coach is temporarily offline.", code: "SERVICE_ERROR", remaining: null, isPro: false };
  }
}
