/**
 * MixDashboard.tsx — Main UI orchestrator for Sonic Pro v6.
 *
 * Owns all session state and audio refs. Renders:
 *   - AppHeader (top bar)
 *   - Left column: upload zone, visualizer, meters, spectral tabs
 *   - Right column: <SidePanel> (AI coach, EQ blueprint, export, upgrade)
 *   - <LibraryPanel> modal
 *   - <AuthModal>
 *   - Toast stack
 *   - Footer
 *
 * AI advice state lives inside <SidePanel> — this component doesn't
 * need to know about it.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload, Play, Pause, Activity, Target,
  Zap, Music, CheckCircle2, AlertTriangle,
  Cloud, History, BarChart3, Waves,
  RefreshCw, Download, Sun, Moon, X, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { DeltaBandResult } from '../lib/types';

import { useAudioAnalyzer }             from '../hooks/useAudioAnalyzer';
import { useAuth }                      from '../hooks/useAuth';
import { useLibrary }                   from '../hooks/useLibrary';
import { useSubscription }              from '../hooks/useSubscription';
import { startCheckout }                from '../lib/stripe';
import { GOLDEN_TARGETS, getAllProfiles } from '../lib/targets';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

import { AudioVisualizer } from './AudioVisualizer';
import { PhaseMeter }      from './PhaseMeter';
import { LufsMeter }       from './LufsMeter';
import { VibeTimeline }    from './VibeTimeline';
import { AuthModal }       from './AuthModal';
import { LibraryPanel }    from './LibraryPanel';
import { SidePanel }       from './SidePanel';

// ─── Toast ────────────────────────────────────────────────────
interface Toast { id: number; message: string; type: 'success' | 'error' | 'warning' | 'info' }
const toastColors = {
  success: 'border-green-500/40 text-green-400',
  error:   'border-red-500/40 text-red-400',
  warning: 'border-yellow-500/40 text-yellow-400',
  info:    'border-blue-500/40 text-blue-400',
};

// ─── Props ────────────────────────────────────────────────────
interface MixDashboardProps {
  theme:       string;
  toggleTheme: () => void;
}

export function MixDashboard({ theme, toggleTheme }: MixDashboardProps) {
  const [selectedProfileId, setSelectedProfileId] = useState('edm');
  const [isPlaying,         setIsPlaying]         = useState(false);
  const [showLibrary,       setShowLibrary]       = useState(false);
  const [toasts,            setToasts]            = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const audioRef     = useRef<HTMLAudioElement>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const sourceRef    = useRef<MediaElementAudioSourceNode | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // ── Hooks ──────────────────────────────────────────────────
  const { user, showAuthModal, setShowAuthModal, requireAuth, signOut } = useAuth();

  const subscription = useSubscription(user);

  const { state, loadTrack, reset, computeDeltaOnly, modelState } =
    useAudioAnalyzer(selectedProfileId);
  const { user: userTrack, reference: refTrack, delta, deltaReady } = state;

  const {
    analyses, count, isFull, isNearFull, maxAnalyses,
    loading: libLoading, saveAnalysis, deleteAnalysis,
  } = useLibrary(user, subscription.isPro);

  // ── Toast helper ───────────────────────────────────────────
  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  // ── Handlers ───────────────────────────────────────────────
  const handleProfileChange = useCallback((profileId: string) => {
    setSelectedProfileId(profileId);
    if (userTrack.mixHealth) computeDeltaOnly(profileId);
  }, [computeDeltaOnly, userTrack.mixHealth]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileLoad(f, 'user');
  }, []);

  const handleFileLoad = useCallback((file: File, trackType: 'user' | 'reference') => {
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    if (trackType === 'user' && audioRef.current) {
      objectUrlRef.current = URL.createObjectURL(file);
      audioRef.current.src = objectUrlRef.current;
    }
    loadTrack(file, trackType);
  }, [loadTrack]);

  const togglePlayback = useCallback(() => {
    if (!audioRef.current) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      sourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioCtxRef.current.destination);
    }
    if (isPlaying) { audioRef.current.pause(); }
    else {
      audioRef.current.play();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleReset = useCallback(() => {
    reset();
    setIsPlaying(false);
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    if (audioRef.current) audioRef.current.src = '';
  }, [reset]);

  const handleSaveToLibrary = useCallback(() => {
    if (!userTrack.mixHealth) { addToast('Analyze a mix before saving.', 'warning'); return; }
    requireAuth(async () => {
      if (isFull) {
        if (subscription.isPro) {
          addToast('Unexpected error: library full. Please refresh.', 'error');
        } else {
          addToast(`Library full (${maxAnalyses} saves on free tier). Upgrade to Pro for unlimited saves.`, 'error');
        }
        return;
      }
      const res = await saveAnalysis({
        fileName:        userTrack.fileName ?? 'Unknown',
        mixHealth:       userTrack.mixHealth!,
        referenceHealth: refTrack.mixHealth ?? null,
        vibeTimeline:    userTrack.vibeTimeline ?? null,
        delta:           deltaReady ? delta : null,
        selectedProfile: selectedProfileId,
      });
      if (res.success) {
        addToast('Analysis saved to library ✓', 'success');
        if (isNearFull && !subscription.isPro)
          addToast(`${maxAnalyses - count - 1} free save slot${maxAnalyses - count - 1 !== 1 ? 's' : ''} remaining.`, 'warning');
      } else {
        addToast(res.error ?? 'Save failed.', 'error');
      }
    });
  }, [userTrack, refTrack, delta, deltaReady, selectedProfileId, requireAuth, saveAnalysis, isFull, isNearFull, count, maxAnalyses, subscription, addToast]);

  const handleExportJson = useCallback(async () => {
    if (!userTrack.mixHealth) { addToast('Analyze a mix first.', 'warning'); return; }

    // Gate: require auth to track weekly usage
    if (!user) { setShowAuthModal(true); return; }

    if (!subscription.canExport) {
      addToast('Weekly export limit reached (3/week on free tier). Upgrade to Pro for unlimited exports.', 'warning');
      return;
    }

    // Check + increment via DB RPC (atomic — server-enforced)
    const { supabase } = await import('../lib/supabase');
    if (supabase) {
      const { data, error } = await supabase.rpc('check_and_increment_export');
      if (error || !data?.allowed) {
        addToast(data?.error ?? 'Export limit reached. Upgrade to Pro for unlimited exports.', 'warning');
        await subscription.refresh();
        return;
      }
    }

    const blob = new Blob([JSON.stringify({
      timestamp: new Date().toISOString(), sonicProVersion: '6.0.0',
      userTrack: { fileName: userTrack.fileName, mixHealth: userTrack.mixHealth, vibeTimeline: userTrack.vibeTimeline },
      referenceTrack: refTrack.mixHealth ? { fileName: refTrack.fileName, mixHealth: refTrack.mixHealth } : null,
      delta: deltaReady ? delta : null, selectedProfile: selectedProfileId,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SonicPro-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('Exported as JSON ✓', 'success');
    await subscription.refresh();
  }, [userTrack, refTrack, delta, deltaReady, selectedProfileId, user, subscription, addToast, setShowAuthModal]);

  const isAnalyzing     = userTrack.status === 'analyzing' || userTrack.status === 'decoding';
  const currentProfile  = getAllProfiles()[selectedProfileId] ?? null;

  // ── Render ─────────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className={`min-h-screen font-sans ${theme === 'dark' ? 'bg-[#0a0a0a] text-zinc-100' : 'bg-zinc-50 text-zinc-900'}`}>

        {/* ── HEADER ─────────────────────────────────────── */}
        <header className={`border-b ${theme === 'dark' ? 'border-white/5 bg-black/40' : 'border-zinc-200 bg-white/80'} backdrop-blur-xl sticky top-0 z-50`}>
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.4)]">
                <Zap className="w-5 h-5 text-white fill-white" />
              </div>
              <span className="font-bold text-xl tracking-tight uppercase italic">
                Sonic<span className="text-blue-500">Pro</span>
              </span>
              <Badge variant="outline" className="ml-1 border-blue-500/30 text-blue-400 bg-blue-500/5 px-2 py-0 text-[9px] uppercase tracking-widest font-mono">
                v6 DSP
              </Badge>
              <div className="hidden md:flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${modelState === 'ready' ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : modelState === 'loading' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">
                  {modelState === 'ready' ? 'DSP Ready' : modelState === 'loading' ? 'Initialising…' : 'Engine Error'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5' : 'text-zinc-500 hover:text-zinc-700 hover:bg-black/5'}`}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {userTrack.mixHealth && (
                <>
                  <Button variant="outline" size="sm" onClick={handleExportJson}
                    className="text-[9px] uppercase tracking-widest font-bold border-zinc-800 hover:bg-zinc-900">
                    <Download className="w-3 h-3 mr-1" /> JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSaveToLibrary}
                    className={`text-[9px] uppercase tracking-widest font-bold ${isSupabaseConfigured ? 'border-zinc-800 hover:bg-zinc-900' : 'border-zinc-800/50 opacity-50'}`}
                    title={!isSupabaseConfigured ? 'Configure Supabase in .env to enable cloud features' : undefined}>
                    <Cloud className="w-3 h-3 mr-1" /> Save
                  </Button>
                </>
              )}

              {isSupabaseConfigured && user && (
                <button onClick={() => setShowLibrary(true)}
                  className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors flex items-center gap-1">
                  <History className="w-3 h-3" /> Library {count > 0 ? `(${count})` : ''}
                </button>
              )}

              {isSupabaseConfigured && (user ? (
                <div className="flex items-center gap-3">
                  <span className="text-[9px] text-zinc-600 font-mono hidden md:block">{user.email}</span>
                  <Button variant="ghost" size="sm" onClick={signOut} className="text-[9px] uppercase tracking-widest">Logout</Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setShowAuthModal(true)}
                  className="text-[9px] uppercase tracking-widest text-zinc-400 hover:text-white">Login</Button>
              ))}

              {userTrack.mixHealth && (
                <Button variant="ghost" size="sm" onClick={handleReset}
                  className="text-[9px] uppercase tracking-widest text-zinc-500 hover:text-red-400">
                  <RefreshCw className="w-3 h-3 mr-1" /> Reset
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* ── MAIN ───────────────────────────────────────── */}
        <main className="max-w-7xl mx-auto px-6 py-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

            {/* ── LEFT COLUMN ──────────────────────────── */}
            <div className="lg:col-span-8 space-y-8">

              {/* Upload / Track card */}
              <section>
                {userTrack.status === 'idle' || userTrack.status === 'error' ? (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-2xl blur opacity-20 group-hover:opacity-35 transition duration-700" />
                    <label
                      className="relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-zinc-800 rounded-2xl bg-zinc-900/50 hover:bg-zinc-900/80 transition-all cursor-pointer"
                      onDragOver={e => e.preventDefault()} onDrop={handleDrop}
                    >
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                          <Upload className="w-8 h-8 text-zinc-400" />
                        </div>
                        <p className="text-lg font-medium text-zinc-200 mb-1">Drop your mix for deep analysis</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">WAV · MP3 · AIFF · MAX 20 MIN · FREE TIER</p>
                        {userTrack.status === 'error' && (
                          <div className="mt-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 text-center">
                            {userTrack.error}
                          </div>
                        )}
                      </div>
                      <input type="file" className="hidden" accept="audio/*"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileLoad(f, 'user'); }} />
                    </label>
                  </motion.div>
                ) : (
                  <Card className="bg-zinc-900/50 border-zinc-800 overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between pb-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-600/10 rounded-xl flex items-center justify-center border border-blue-500/20">
                          <Music className="w-6 h-6 text-blue-500" />
                        </div>
                        <div>
                          <CardTitle className="text-base font-bold truncate max-w-[280px]">{userTrack.fileName}</CardTitle>
                          <CardDescription className="font-mono text-[9px] uppercase tracking-widest flex gap-3">
                            {userTrack.duration > 0 && (
                              <span>{Math.floor(userTrack.duration / 60)}:{Math.floor(userTrack.duration % 60).toString().padStart(2, '0')}</span>
                            )}
                            <span className={isAnalyzing ? 'text-blue-400 animate-pulse' : 'text-green-400'}>
                              {isAnalyzing ? `DSP Processing… ${userTrack.progress}%` : 'Analysis Complete ✓'}
                            </span>
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="icon" className="rounded-full border-zinc-700 hover:bg-zinc-800 w-10 h-10" onClick={togglePlayback}>
                          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                        </Button>
                        <label className="cursor-pointer">
                          <Button variant="outline" className="text-zinc-400 border-zinc-700 hover:bg-zinc-800 text-[9px] uppercase tracking-widest font-bold" asChild>
                            <span>Reference</span>
                          </Button>
                          <input type="file" className="hidden" accept="audio/*"
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileLoad(f, 'reference'); }} />
                        </label>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {isAnalyzing && (
                        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                          <motion.div className="h-full bg-blue-500 rounded-full"
                            animate={{ width: `${userTrack.progress}%` }}
                            transition={{ type: 'spring', stiffness: 30 }} />
                        </div>
                      )}
                      <AudioVisualizer analyser={analyserRef.current} isPlaying={isPlaying} />
                      {userTrack.vibeTimeline && <VibeTimeline timeline={userTrack.vibeTimeline} />}
                      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} className="hidden" />
                    </CardContent>
                  </Card>
                )}
              </section>

              {/* Reference track status */}
              {refTrack.status !== 'idle' && (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-xs font-mono ${refTrack.status === 'done' ? 'bg-orange-500/5 border-orange-500/20 text-orange-400' : refTrack.status === 'error' ? 'bg-red-500/5 border-red-500/20 text-red-400' : 'bg-zinc-900/50 border-zinc-800 text-zinc-500'}`}>
                  {refTrack.status === 'done' ? <CheckCircle2 className="w-4 h-4" /> : refTrack.status === 'error' ? <AlertTriangle className="w-4 h-4" /> : <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />}
                  <span>Reference: {refTrack.status === 'done' ? refTrack.fileName : refTrack.status === 'error' ? refTrack.error : `Loading… ${refTrack.progress}%`}</span>
                </div>
              )}

              {/* Phase + LUFS meters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <PhaseMeter correlation={userTrack.mixHealth?.stereoWidth ?? 0} />
                <LufsMeter lufs={userTrack.mixHealth?.integratedLufs ?? -60} target={currentProfile?.targetLufs ?? -14} />
              </div>

              {/* DSP metrics grid */}
              {userTrack.mixHealth && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'True Peak',    value: `${userTrack.mixHealth.peakDb.toFixed(1)} dBFS`,          icon: Zap,           color: userTrack.mixHealth.peakDb > -1 ? 'text-red-400' : 'text-green-400' },
                    { label: 'Crest Factor', value: `${userTrack.mixHealth.crestFactor.toFixed(1)} dB`,        icon: BarChart3,      color: userTrack.mixHealth.crestFactor < 6 ? 'text-yellow-400' : 'text-green-400' },
                    { label: 'Clipping',     value: `${userTrack.mixHealth.clippingPercent.toFixed(3)}%`,      icon: AlertTriangle,  color: userTrack.mixHealth.clippingPercent > 0.01 ? 'text-red-400' : 'text-green-400' },
                    { label: 'Centroid',     value: `${(userTrack.mixHealth.centroid / 1000).toFixed(2)} kHz`, icon: Waves,          color: 'text-blue-400' },
                  ].map((m, i) => (
                    <Card key={i} className="bg-zinc-900/50 border-zinc-800 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <m.icon className="w-3 h-3 text-zinc-500" />
                        <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold">{m.label}</span>
                      </div>
                      <div className={`text-sm font-mono font-bold ${m.color}`}>{m.value}</div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Mix warnings */}
              {userTrack.mixHealth?.warnings.length > 0 && (
                <div className="space-y-2">
                  {userTrack.mixHealth.warnings.map((w, i) => (
                    <div key={i} className={`flex gap-3 p-3 rounded-xl border text-xs ${w.severity === 'critical' ? 'bg-red-500/5 border-red-500/20 text-red-400' : w.severity === 'warning' ? 'bg-yellow-500/5 border-yellow-500/20 text-yellow-400' : 'bg-blue-500/5 border-blue-500/20 text-blue-400'}`}>
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold uppercase tracking-wider text-[9px] mb-0.5">{w.type} — {w.severity}</div>
                        <div className="font-mono opacity-90">{w.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Spectral tabs */}
              <Tabs defaultValue="delta">
                <div className="flex items-center justify-between mb-4">
                  <TabsList className="bg-zinc-900 border border-zinc-800 p-1">
                    <TabsTrigger value="delta"   className="data-[state=active]:bg-zinc-800 text-[9px] uppercase tracking-widest font-bold">Spectral Delta</TabsTrigger>
                    <TabsTrigger value="targets" className="data-[state=active]:bg-zinc-800 text-[9px] uppercase tracking-widest font-bold">Golden Targets</TabsTrigger>
                    <TabsTrigger value="bands"   className="data-[state=active]:bg-zinc-800 text-[9px] uppercase tracking-widest font-bold">Band Map</TabsTrigger>
                  </TabsList>
                </div>

                {/* Delta */}
                <TabsContent value="delta">
                  <Card className="bg-zinc-900/50 border-zinc-800">
                    <CardHeader>
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-500" />
                        {deltaReady && delta?.profileMode
                          ? `Comparing to: ${currentProfile?.name}`
                          : deltaReady && !delta?.profileMode
                          ? 'Reference comparison (loudness matched)'
                          : 'Frequency Imbalance'}
                      </CardTitle>
                      {deltaReady && delta && (
                        <div className="flex items-center gap-2 mt-1">
                          <div className={`text-lg font-mono font-bold ${delta.score >= 80 ? 'text-green-400' : delta.score >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {delta.score}/100
                          </div>
                          <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono">Mix Score</span>
                          {delta.profileMode === false && delta.userLufs !== undefined && (
                            <span className="ml-auto text-[9px] font-mono text-zinc-500">
                              Your: <span className="text-blue-400">{delta.userLufs} LUFS</span>
                              {' '}Ref: <span className="text-orange-400">{delta.referenceLufs} LUFS</span>
                              {' '}Offset: <span className="text-purple-400">{delta.gainOffset > 0 ? '+' : ''}{delta.gainOffset} dB</span>
                            </span>
                          )}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {userTrack.mixHealth && deltaReady && delta ? (
                        Object.entries(delta.bands as Record<string, DeltaBandResult>).map(([band, b]) => {
                          const abs = Math.abs(b.delta), pos = b.delta >= 0;
                          const color = abs < 0.5 ? 'text-green-400' : abs < 3 ? 'text-yellow-400' : 'text-red-400';
                          return (
                            <div key={band} className="space-y-2">
                              <div className="flex justify-between items-baseline text-[10px] font-mono uppercase tracking-wider">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-zinc-400 cursor-help border-b border-dotted border-zinc-700">{band}</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs bg-zinc-900 border-zinc-700">
                                    <div className="font-bold mb-1">{b.label}</div>
                                    <div>Your mix: {b.userDb} dB</div>
                                    <div>Target: {b.refDb} dB</div>
                                  </TooltipContent>
                                </Tooltip>
                                <span className={color}>{pos ? '+' : ''}{b.delta.toFixed(1)} dB</span>
                              </div>
                              <div className="relative h-2 bg-black rounded-full overflow-hidden border border-zinc-800">
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-700 z-10" />
                                <motion.div
                                  className={`absolute top-0 bottom-0 rounded-full ${abs < 0.5 ? 'bg-green-500/50' : pos ? 'bg-red-500/50' : 'bg-blue-500/50'}`}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.min(50, abs * 5)}%`, left: pos ? '50%' : `${50 - Math.min(50, abs * 5)}%` }}
                                  transition={{ type: 'spring', stiffness: 80, damping: 15 }}
                                />
                              </div>
                              <p className="text-[9px] font-mono text-zinc-600">{b.verdict}</p>
                            </div>
                          );
                        })
                      ) : userTrack.mixHealth ? (
                        <div className="py-6 text-center text-zinc-600 text-xs italic">
                          Select a genre target above or load a reference track to see spectral delta.
                        </div>
                      ) : (
                        <div className="h-40 flex items-center justify-center text-zinc-600 italic text-sm">
                          Upload a track to see spectral analysis
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Golden targets gallery */}
                <TabsContent value="targets">
                  <Card className="bg-zinc-900/50 border-zinc-800">
                    <CardContent className="pt-6">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {GOLDEN_TARGETS.map(t => (
                          <button key={t.id} onClick={() => handleProfileChange(t.id)}
                            className={`p-4 rounded-xl border transition-all text-left group ${selectedProfileId === t.id ? 'bg-blue-600/10 border-blue-500/50 shadow-[0_0_20px_rgba(37,99,235,0.1)]' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}>
                            <Target className={`w-5 h-5 mb-3 ${selectedProfileId === t.id ? 'text-blue-500' : 'text-zinc-500'}`} />
                            <div className="font-bold text-sm mb-0.5">{t.name}</div>
                            <div className="text-[9px] uppercase tracking-widest text-zinc-500 font-mono">{t.genre} · {t.targetLufs} LUFS</div>
                            <div className="text-[9px] text-zinc-600 mt-1">{t.description}</div>
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Band map */}
                <TabsContent value="bands">
                  <Card className="bg-zinc-900/50 border-zinc-800">
                    <CardContent className="pt-6 space-y-3">
                      {userTrack.mixHealth ? (
                        Object.entries(userTrack.mixHealth.spectralBands).map(([band, val]) => {
                          const pct = Math.max(0, Math.min(100, ((val as number) + 80) * 1.2));
                          return (
                            <div key={band} className="flex items-center gap-3">
                              <span className="text-[9px] font-mono uppercase w-20 text-zinc-500">{band}</span>
                              <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                                <motion.div className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 rounded-full"
                                  initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 50 }} />
                              </div>
                              <span className="text-[9px] font-mono w-14 text-right text-zinc-400">{(val as number).toFixed(1)} dB</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="h-40 flex items-center justify-center text-zinc-600 italic text-sm">Upload a track to see band levels</div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>

            {/* ── RIGHT COLUMN ─────────────────────────── */}
            <div className="lg:col-span-4">
              <SidePanel
                userTrack={userTrack}
                refTrack={refTrack}
                delta={deltaReady ? delta : null}
                deltaReady={deltaReady}
                selectedProfileId={selectedProfileId}
                currentProfile={currentProfile}
                subscription={subscription}
                onSaveToLibrary={handleSaveToLibrary}
                onExportJson={handleExportJson}
                onUpgrade={async () => {
                  const { error } = await startCheckout();
                  if (error) addToast(error, 'error');
                }}
                addToast={addToast}
              />
            </div>
          </div>
        </main>

        {/* ── FOOTER ─────────────────────────────────────── */}
        <footer className={`border-t ${theme === 'dark' ? 'border-white/5 bg-black/40' : 'border-zinc-200 bg-white/60'} py-10`}>
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-500" />
              <span className="font-bold tracking-tight uppercase italic">SonicPro</span>
            </div>
            <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest text-center">
              EBU R128 · ITU-R BS.1770-4 · FFT 8192pt · Zero-copy DSP · Client-side only
            </div>
            <div className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest">
              © 2026 Sonic Pro Audio
            </div>
          </div>
        </footer>

        {/* ── MODALS ─────────────────────────────────────── */}
        <LibraryPanel
          show={showLibrary}
          onClose={() => setShowLibrary(false)}
          analyses={analyses}
          count={count}
          maxAnalyses={maxAnalyses}
          isFull={isFull}
          isNearFull={isNearFull}
          isPro={subscription.isPro}
          loading={libLoading}
          deleteAnalysis={deleteAnalysis}
          addToast={addToast}
        />

        <AnimatePresence>
          {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
        </AnimatePresence>

        {/* ── TOASTS ─────────────────────────────────────── */}
        <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 max-w-sm">
          <AnimatePresence>
            {toasts.map(t => (
              <motion.div key={t.id}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.96 }}
                className={`flex items-center justify-between gap-3 px-4 py-3 bg-zinc-950 border rounded-xl text-xs font-mono shadow-2xl cursor-pointer ${toastColors[t.type]}`}
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              >
                <span>{t.message}</span>
                <X className="w-3 h-3 shrink-0 opacity-60" />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

      </div>
    </TooltipProvider>
  );
}
