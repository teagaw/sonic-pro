/**
 * AuthModal.tsx — Lazy auth modal for cloud-gated actions.
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '../lib/supabase';

interface Props { onClose: () => void }

export const AuthModal: React.FC<Props> = ({ onClose }) => {
  const [tab,      setTab]      = useState<'signup'|'login'>('signup');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string|null>(null);
  const [success,  setSuccess]  = useState<string|null>(null);

  const handleSubmit = useCallback(async () => {
    if (!email.trim() || !password.trim()) { setError('Enter your email and password.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setError(null); setSuccess(null); setLoading(true);

    if (tab === 'signup') {
      const { error: e } = await supabase!.auth.signUp({ email, password });
      if (e) setError(e.message);
      else { setSuccess('Check your email for a confirmation link.'); setTab('login'); }
    } else {
      const { error: e } = await supabase!.auth.signInWithPassword({ email, password });
      if (e) setError(e.message.includes('Invalid') ? 'Email or password is incorrect.' : e.message);
    }
    setLoading(false);
  }, [tab, email, password]);

  const handleGoogle = useCallback(async () => {
    setLoading(true);
    await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    setLoading(false);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div
        initial={{ opacity:0, scale:0.95, y:10 }}
        animate={{ opacity:1, scale:1, y:0 }}
        exit={{ opacity:0, scale:0.95 }}
        className="bg-zinc-950 border border-zinc-800 rounded-2xl p-8 w-full max-w-md shadow-2xl shadow-blue-600/10"
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-bold text-zinc-100">Save to Your Library</h2>
            <p className="text-xs text-zinc-500 mt-1 font-mono uppercase tracking-widest">
              Free account • Analysis stays yours
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 mb-6">
          {(['signup','login'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null); setSuccess(null); }}
              className={`flex-1 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${tab===t?'bg-zinc-800 text-zinc-100':'text-zinc-500 hover:text-zinc-300'}`}>
              {t==='signup'?'Create Account':'Sign In'}
            </button>
          ))}
        </div>

        <Button onClick={handleGoogle} disabled={loading}
          className="w-full bg-white text-black hover:bg-zinc-100 mb-4 font-bold text-xs uppercase tracking-widest">
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-[10px] text-zinc-600">or</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>

        <div className="space-y-3 mb-4" onKeyDown={e => e.key==='Enter'&&handleSubmit()}>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="you@example.com" disabled={loading}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50" />
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            placeholder={tab==='signup'?'Min. 6 characters':'Your password'} disabled={loading}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50" />
        </div>

        {error   && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">{error}</div>}
        {success && <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-xs text-green-400">{success}</div>}

        <Button onClick={handleSubmit} disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest py-5">
          {loading ? 'Working…' : tab==='signup'?'Create Free Account':'Sign In'}
        </Button>

        <button onClick={onClose} className="w-full mt-3 text-[10px] text-zinc-600 hover:text-zinc-400 underline underline-offset-2 transition-colors">
          Continue without saving
        </button>
      </motion.div>
    </div>
  );
};
