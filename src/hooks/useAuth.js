/**
 * @file src/hooks/useAuth.js — Authentication state + lazy login trigger
 *
 * Core behaviour:
 *   • The app works fully without authentication (core DSP is always available).
 *   • Auth is only requested when the user clicks a cloud-gated action
 *     (Save to Library, Export to Cloud).
 *   • Exposes `requireAuth(callback)` — call this from any button handler.
 *     If already authenticated, runs callback immediately.
 *     If not, opens the AuthModal and runs callback after successful sign-in.
 *
 * Usage:
 *   const { user, loading, requireAuth, showAuthModal, setShowAuthModal } = useAuth();
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

/**
 * @typedef {Object} AuthState
 * @property {import("@supabase/supabase-js").User | null} user   Current user or null
 * @property {boolean}  loading            True while initial session is being resolved
 * @property {boolean}  showAuthModal      Controls AuthModal visibility
 * @property {Function} setShowAuthModal   Directly toggle the modal
 * @property {Function} requireAuth        Gate a callback behind authentication
 * @property {Function} signOut            Sign the current user out
 */

/**
 * Hook providing Supabase auth state and lazy-auth pattern.
 *
 * @returns {AuthState}
 */
export function useAuth() {
  const [user,          setUser]          = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Holds the callback to run after the user successfully signs in.
  // Cleared after it fires once so it doesn't run on subsequent sign-ins.
  const pendingCallbackRef = useRef(null);

  // ── Subscribe to Supabase auth state changes ──────────────
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    // Resolve the current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const nextUser = session?.user ?? null;
        setUser(nextUser);

        // If a callback was waiting for auth, run it now
        if (nextUser && pendingCallbackRef.current) {
          const cb = pendingCallbackRef.current;
          pendingCallbackRef.current = null;
          setShowAuthModal(false);
          // Small delay so the modal has time to close before the action fires
          setTimeout(cb, 100);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Gate an action behind authentication.
   * If the user is already signed in, runs `callback` immediately.
   * Otherwise, stores the callback and opens the AuthModal.
   * After the user signs in, the callback is run automatically.
   *
   * @param {() => void} callback  Action to run once authenticated
   */
  const requireAuth = useCallback((callback) => {
    if (!isSupabaseConfigured) return; // Supabase not configured — feature disabled
    if (user) {
      callback();
    } else {
      pendingCallbackRef.current = callback;
      setShowAuthModal(true);
    }
  }, [user]);

  /**
   * Sign the current user out.
   * @returns {Promise<void>}
   */
  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return {
    user,
    loading,
    showAuthModal,
    setShowAuthModal,
    requireAuth,
    signOut,
  };
}
