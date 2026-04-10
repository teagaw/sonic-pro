/**
 * useAuth.ts — Lazy auth hook.
 * App works fully without login. Auth gate only on cloud-gated actions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface AuthState {
  user:           any | null;
  loading:        boolean;
  showAuthModal:  boolean;
  setShowAuthModal: (v: boolean) => void;
  requireAuth:    (cb: () => void) => void;
  signOut:        () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user,          setUser]          = useState<any>(null);
  const [loading,       setLoading]       = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const pendingCbRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (nextUser && pendingCbRef.current) {
        const cb = pendingCbRef.current;
        pendingCbRef.current = null;
        setShowAuthModal(false);
        setTimeout(cb, 100);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const requireAuth = useCallback((callback: () => void) => {
    if (!isSupabaseConfigured) return;
    if (user) { callback(); return; }
    pendingCbRef.current = callback;
    setShowAuthModal(true);
  }, [user]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return { user, loading, showAuthModal, setShowAuthModal, requireAuth, signOut };
}
