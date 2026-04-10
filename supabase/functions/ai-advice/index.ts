/**
 * supabase/functions/ai-advice/index.ts — AI Mix Coach (v2)
 *
 * Changes from v1:
 *   - Requires a valid JWT (auth needed to track usage).
 *   - Checks subscription tier + weekly AI audit count.
 *   - Free tier: 2 AI audits/week.  Pro: unlimited.
 *   - Increments usage count before calling Gemini.
 *
 * Deploy:  supabase functions deploy ai-advice
 * Secrets: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL   = "gemini-2.0-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const FREE_AI_LIMIT  = 2;

function getWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() + diff);
  return mon.toISOString().split("T")[0];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in to use the AI Mix Coach.", code: "AUTH_REQUIRED" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid session. Please sign in again.", code: "AUTH_REQUIRED" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: sub } = await admin.from("subscriptions").select("status").eq("user_id", user.id).single();
    const isPro = sub?.status === "active";

    if (!isPro) {
      const weekStart = getWeekStart();
      await admin.from("user_usage").upsert({ user_id: user.id, week_start: weekStart }, { onConflict: "user_id,week_start" });
      const { data: usage } = await admin.from("user_usage").select("ai_audits_count").eq("user_id", user.id).eq("week_start", weekStart).single();
      const current = usage?.ai_audits_count ?? 0;

      if (current >= FREE_AI_LIMIT) {
        const reset = new Date(weekStart);
        reset.setDate(reset.getDate() + 7);
        return json({
          error:     `Weekly AI audit limit reached (${FREE_AI_LIMIT}/week on free tier). Resets ${reset.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}. Upgrade to Pro for unlimited AI coaching.`,
          code:      "LIMIT_REACHED",
          remaining: 0,
          resetDate: reset.toISOString().split("T")[0],
        }, 429);
      }

      await admin.from("user_usage")
        .update({ ai_audits_count: current + 1, updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("week_start", weekStart);
    }

    const { mixHealth, delta, target } = await req.json();
    if (!mixHealth || !target) return json({ error: "Missing required fields." }, 400);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "AI service not configured on server." }, 503);

    const bandLines = delta
      ? Object.entries(delta.bands).map(([k, b]: [string, any]) => `  ${k}: ${b.delta > 0 ? "+" : ""}${b.delta.toFixed(1)} dB (${b.verdict})`).join("\n")
      : "  No reference comparison loaded.";

    const warningLines = mixHealth.warnings?.length > 0
      ? mixHealth.warnings.map((w: any) => `  [${w.severity.toUpperCase()}] ${w.type}: ${w.message}`).join("\n")
      : "  No critical warnings.";

    const prompt = `You are a Senior Mastering Engineer reviewing a professional mix analysis report.
All data below comes from a validated EBU R128-compliant DSP engine. Base EVERY suggestion only on the numbers provided.

INTEGRATED LUFS: ${mixHealth.integratedLufs} LUFS  (${target.name} target: ${target.targetLufs} LUFS)
TRUE PEAK: ${mixHealth.peakDb} dBFS | CREST FACTOR: ${mixHealth.crestFactor} dB | STEREO: ${mixHealth.stereoWidth.toFixed(3)}
CLIPPING: ${mixHealth.clippingPercent.toFixed(3)}% | MID FLATNESS: ${(mixHealth.midRangeSpectralFlatness * 100).toFixed(0)}%

SPECTRAL BANDS:
${Object.entries(mixHealth.spectralBands).map(([k, v]) => `  ${k}: ${v} dB`).join("\n")}

WARNINGS:
${warningLines}

DELTA vs ${target.name}:
${bandLines}

Provide exactly 3-4 specific actionable mastering tips as a numbered list. Each must cite exact dB values. End with one sentence on what this mix does well.`;

    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1000, temperature: 0.4 } }),
    });

    if (!geminiRes.ok) return json({ error: "AI service temporarily unavailable." }, 502);

    const data = await geminiRes.json();
    const advice = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "Unable to generate advice.";

    return json({ advice, isPro, remaining: isPro ? null : Math.max(0, FREE_AI_LIMIT - ((await admin.from("user_usage").select("ai_audits_count").eq("user_id", user.id).eq("week_start", getWeekStart()).single()).data?.ai_audits_count ?? FREE_AI_LIMIT)) });

  } catch (err: unknown) {
    console.error("ai-advice error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
