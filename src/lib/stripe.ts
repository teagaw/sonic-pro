/**
 * src/lib/stripe.ts
 *
 * Starts a Stripe Checkout session by calling the create-checkout
 * Edge Function.  Redirects the user to Stripe on success.
 *
 * Usage:
 *   import { startCheckout } from '../lib/stripe';
 *   const { error } = await startCheckout();
 *   if (error) addToast(error, 'error');
 *   // On success the page redirects to Stripe Checkout — no return value needed.
 */

import { supabase, isSupabaseConfigured } from "./supabase";

export async function startCheckout(): Promise<{ error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { error: "Supabase is not configured." };
  }

  try {
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: { returnUrl: window.location.href },
    });

    if (error)       return { error: error.message ?? "Checkout failed. Please try again." };
    if (data?.error) return { error: data.error };
    if (data?.url)   { window.location.href = data.url; return {}; }

    return { error: "No checkout URL returned from server." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Checkout failed." };
  }
}
