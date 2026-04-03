/**
 * @file src/lib/supabase.js — Supabase client singleton
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the Vite
 * environment. If either is missing or is a placeholder value, the client
 * is set to null and `isSupabaseConfigured` is false — all cloud features
 * degrade gracefully; core DSP analysis is never affected.
 *
 * Import pattern throughout the codebase:
 *   import { supabase, isSupabaseConfigured } from "../lib/supabase";
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  ?? "";
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** True when both env vars are present and look like real Supabase values. */
export const isSupabaseConfigured =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_URL.includes(".supabase.co") &&
  SUPABASE_KEY.length > 20;

/**
 * Singleton Supabase client.
 * `null` when env vars are missing — consumers must guard with
 * `isSupabaseConfigured` before calling any Supabase method.
 *
 * @type {import("@supabase/supabase-js").SupabaseClient | null}
 */
export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        // Persist session in localStorage so users stay logged in across refreshes
        persistSession:    true,
        detectSessionInUrl: true,  // handles OAuth redirects automatically
        autoRefreshToken:  true,
      },
    })
  : null;
