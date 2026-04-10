/**
 * supabase/functions/create-checkout/index.ts
 *
 * Creates a Stripe Checkout session for the $9/mo Pro subscription.
 * Requires an authenticated user (JWT in Authorization header).
 *
 * Deploy:
 *   supabase functions deploy create-checkout
 *
 * Secrets (set once):
 *   supabase secrets set STRIPE_SECRET_KEY=sk_live_…
 *   supabase secrets set STRIPE_PRICE_ID=price_…   ← your $9/mo recurring price
 *
 * The client calls this via:
 *   supabase.functions.invoke('create-checkout', { body: { returnUrl: window.location.href } })
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe           from "https://esm.sh/stripe@14?target=deno";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  try {
    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in before upgrading." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid session." }, 401);

    // ── Stripe ────────────────────────────────────────────────
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });
    const priceId = Deno.env.get("STRIPE_PRICE_ID");
    if (!priceId) return json({ error: "Stripe price not configured." }, 503);

    const { returnUrl } = await req.json().catch(() => ({ returnUrl: supabaseUrl }));

    // ── Get or create Stripe customer ─────────────────────────
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: sub } = await admin.from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).single();
    let customerId = sub?.stripe_customer_id as string | undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin.from("subscriptions").update({ stripe_customer_id: customerId }).eq("user_id", user.id);
    }

    // ── Create Checkout session ───────────────────────────────
    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}upgraded=1`,
      cancel_url:  returnUrl,
      metadata:    { supabase_user_id: user.id },
      subscription_data: {
        metadata: { supabase_user_id: user.id },
      },
    });

    return json({ url: session.url });

  } catch (err: unknown) {
    console.error("create-checkout error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
