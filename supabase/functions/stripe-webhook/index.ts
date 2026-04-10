/**
 * supabase/functions/stripe-webhook/index.ts
 *
 * Handles Stripe subscription lifecycle events and keeps the
 * public.subscriptions table in sync.
 *
 * Deploy:
 *   supabase functions deploy stripe-webhook --no-verify-jwt
 *
 * Secrets:
 *   supabase secrets set STRIPE_SECRET_KEY=sk_live_…
 *   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
 *
 * In Stripe Dashboard → Webhooks → Add endpoint:
 *   URL:    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
 *   Events: customer.subscription.created
 *           customer.subscription.updated
 *           customer.subscription.deleted
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe           from "https://esm.sh/stripe@14?target=deno";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  // ── Verify webhook signature ──────────────────────────────
  const sig     = req.headers.get("stripe-signature");
  const secret  = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const body    = await req.text();

  if (!sig || !secret) return new Response("Missing signature or secret", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, secret);
  } catch (err) {
    console.error("Webhook verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Resolve supabase user_id from subscription metadata ───
  async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
    // 1. Prefer metadata set on subscription_data at checkout time
    if (sub.metadata?.supabase_user_id) return sub.metadata.supabase_user_id;

    // 2. Try customer metadata
    try {
      const customer = await stripe.customers.retrieve(sub.customer as string) as Stripe.Customer;
      if (customer.metadata?.supabase_user_id) return customer.metadata.supabase_user_id;
    } catch {}

    // 3. Look up by stripe_subscription_id in our table
    const { data } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", sub.id)
      .single();

    return data?.user_id ?? null;
  }

  // ── Upsert subscription row ───────────────────────────────
  async function upsert(sub: Stripe.Subscription) {
    const userId = await resolveUserId(sub);
    if (!userId) {
      console.error("Could not resolve user_id for subscription", sub.id);
      return;
    }

    // Map Stripe status to our enum
    const status: string = (() => {
      switch (sub.status) {
        case "active":            return "active";
        case "canceled":          return "canceled";
        case "past_due":          return "past_due";
        case "incomplete":        return "incomplete";
        case "incomplete_expired":return "canceled";
        default:                  return "free";
      }
    })();

    await admin.from("subscriptions").upsert({
      user_id:                userId,
      stripe_customer_id:     sub.customer as string,
      stripe_subscription_id: sub.id,
      status,
      current_period_end: new Date((sub as any).current_period_end * 1000).toISOString(),
      updated_at:         new Date().toISOString(),
    }, { onConflict: "user_id" });

    console.log(`Subscription upserted: user=${userId} status=${status}`);
  }

  // ── Handle events ─────────────────────────────────────────
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsert(event.data.object as Stripe.Subscription);
      break;
    default:
      // Silently ignore other event types
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
