/**
 * src/components/SidePanel.tsx — v3
 *
 * Changes:
 *   - Accepts `subscription` (SubscriptionState) + `onUpgrade` props.
 *   - AI Mix Coach button is gated: disabled + usage badge for free tier.
 *   - Print Report button gated: disabled + remaining count for free tier.
 *   - Export JSON button gated (calls onExportJson which gates in MixDashboard).
 *   - Upgrade CTA button wired to onUpgrade.
 *   - Shows Pro badge + period-end when active.
 */

import React, { useState, useCallback } from 'react';
import {
  Sparkles, Activity, ChevronRight, Cloud, Printer,
  Download, Zap, ShieldCheck, Lock, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { PrintPreview }   from './PrintPreview';
import { getAiMixAdvice } from '../lib/gemini';
import { isSupabaseConfigured } from '../lib/supabase';
import { getAllProfiles }  from '../lib/targets';
import type { SubscriptionState } from '../hooks/useSubscription';
import type { MixHealth, DeltaResult, VibeSegment } from '../lib/types';
import type { GoldenTarget } from '../lib/targets';

// ─── Props ────────────────────────────────────────────────────
interface TrackState {
  fileName?:     string;
  fileSize?:     number;
  duration?:     number;
  mixHealth?:    MixHealth;
  vibeTimeline?: VibeSegment[] | null;
}

interface SidePanelProps {
  userTrack:         TrackState;
  refTrack:          TrackState;
  delta:             DeltaResult | null;
  deltaReady:        boolean;
  selectedProfileId: string;
  currentProfile:    GoldenTarget | null;
  subscription:      SubscriptionState;
  onSaveToLibrary:   () => void;
  onExportJson:      () => void;
  onUpgrade:         () => void;
  addToast:          (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

// ─── Component ────────────────────────────────────────────────
export function SidePanel({
  userTrack, refTrack, delta, deltaReady,
  selectedProfileId, currentProfile,
  subscription, onSaveToLibrary, onExportJson, onUpgrade, addToast,
}: SidePanelProps) {
  const [aiAdvice,    setAiAdvice]    = useState<string | null>(null);
  const [aiCode,      setAiCode]      = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const { isPro, usage, limits, canUseAI, canExport } = subscription;

  // ── AI Audit ───────────────────────────────────────────────
  const generateAiAdvice = useCallback(async () => {
    if (!userTrack.mixHealth) return;

    if (!canUseAI) {
      addToast(`You've used both AI audits this week. Resets Monday. Upgrade to Pro for unlimited.`, 'warning');
      return;
    }

    setIsAiLoading(true);
    setAiCode(null);
    const profile = getAllProfiles()[selectedProfileId];
    const result  = await getAiMixAdvice(userTrack.mixHealth, deltaReady ? delta : null, profile);
    setAiAdvice(result.advice);
    setAiCode(result.code ?? null);

    if (!result.code) {
      // Success — refresh subscription usage counts
      await subscription.refresh();
    }
    setIsAiLoading(false);
  }, [userTrack.mixHealth, delta, deltaReady, selectedProfileId, canUseAI, subscription, addToast]);

  // ── Usage badge helpers ────────────────────────────────────
  const aiRemaining  = isPro ? null : Math.max(0, limits.aiAuditsPerWeek - usage.aiAuditsThisWeek);
  const expRemaining = isPro ? null : Math.max(0, limits.exportsPerWeek  - usage.exportsThisWeek);

  return (
    <div className="space-y-6">

      {/* ── PRO BADGE (when subscribed) ────────────────────── */}
      {isPro && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-600/10 to-indigo-600/10 border border-blue-500/20 rounded-xl">
          <Crown className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400">Pro Plan Active</span>
          {subscription.periodEnd && (
            <span className="text-[8px] font-mono text-zinc-500 ml-auto">
              renews {subscription.periodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      )}

      {/* ── AI MIX COACH ───────────────────────────────────── */}
      <Card className="bg-zinc-900/50 border-zinc-800 relative overflow-hidden">
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          {!isPro && (
            <span className={`text-[8px] font-mono font-bold ${canUseAI ? 'text-zinc-500' : 'text-red-400'}`}>
              {aiRemaining}/{limits.aiAuditsPerWeek} left
            </span>
          )}
          <Sparkles className="w-4 h-4 text-blue-500 animate-pulse" />
        </div>
        <CardHeader>
          <CardTitle className="text-base font-bold">AI Mix Coach</CardTitle>
          <CardDescription className="text-[9px] uppercase tracking-widest font-mono">
            Gemini 2.0 Flash · Real DSP data
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAiLoading ? (
            <div className="space-y-3 py-4">
              {[3, 4, 2].map((w, i) => (
                <div key={i} className="h-3 bg-zinc-800 rounded animate-pulse" style={{ width: `${w * 25}%` }} />
              ))}
            </div>
          ) : aiAdvice ? (
            <>
              <ScrollArea className="h-64 pr-3">
                <div className={`whitespace-pre-line leading-relaxed text-xs font-mono ${
                  aiCode === 'LIMIT_REACHED' ? 'text-yellow-400' :
                  aiCode === 'AUTH_REQUIRED' ? 'text-blue-400'  :
                  aiCode === 'SERVICE_ERROR' ? 'text-red-400'   : 'text-zinc-300'
                }`}>
                  {aiAdvice}
                </div>
              </ScrollArea>
              {!aiCode && (
                <Button
                  variant="outline" size="sm" disabled={!canUseAI}
                  className="mt-4 w-full border-zinc-800 hover:bg-zinc-800 text-[9px] uppercase tracking-widest font-bold"
                  onClick={() => { setAiAdvice(null); generateAiAdvice(); }}
                >
                  {canUseAI ? 'Regenerate' : `Limit reached — upgrade for more`}
                </Button>
              )}
              {(aiCode === 'LIMIT_REACHED' || aiCode === 'AUTH_REQUIRED') && (
                <Button
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white text-[9px] uppercase tracking-widest font-bold"
                  onClick={onUpgrade}
                >
                  Upgrade to Pro — Unlimited
                </Button>
              )}
            </>
          ) : userTrack.mixHealth ? (
            <div className="text-center py-10 px-4">
              <div className="w-12 h-12 bg-blue-600/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                {canUseAI
                  ? <Sparkles className="w-6 h-6 text-blue-500" />
                  : <Lock className="w-6 h-6 text-zinc-600" />
                }
              </div>
              {canUseAI ? (
                <>
                  <p className="text-xs text-zinc-400 mb-1">
                    DSP analysis complete.<br />Generate expert mixing advice.
                  </p>
                  {!isPro && (
                    <p className="text-[9px] font-mono text-zinc-600 mb-4">
                      {aiRemaining} audit{aiRemaining !== 1 ? 's' : ''} remaining this week
                    </p>
                  )}
                  <Button
                    onClick={generateAiAdvice}
                    className="bg-blue-600 hover:bg-blue-700 text-white w-full text-[9px] uppercase tracking-widest font-bold"
                  >
                    Generate AI Mix Advice
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-zinc-500 mb-1">
                    Weekly limit reached<br />
                    <span className="text-[9px] font-mono">(2/week on free tier · resets Monday)</span>
                  </p>
                  <Button
                    className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white text-[9px] uppercase tracking-widest font-bold"
                    onClick={onUpgrade}
                  >
                    Upgrade for Unlimited
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="text-center py-10 px-4">
              <Activity className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-xs text-zinc-600 italic">
                Upload a track to receive professional mixing advice.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── EQ BLUEPRINT ───────────────────────────────────── */}
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" /> EQ Blueprint
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {deltaReady && delta?.suggestions.length > 0 ? (
            delta.suggestions.map((s, i) => (
              <div key={i} className="flex gap-2 p-3 bg-black/40 rounded-lg border border-white/5">
                <ChevronRight className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-[10px] text-zinc-400 leading-normal font-mono">{s}</p>
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-zinc-600 text-[9px] uppercase tracking-widest font-bold italic">
              {userTrack.mixHealth ? 'Mix is well-balanced ✓' : 'No analysis yet'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── EXPORT & SAVE ──────────────────────────────────── */}
      {userTrack.mixHealth && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Cloud className="w-4 h-4 text-blue-500" /> Export & Save
            </CardTitle>
            {!isPro && (
              <CardDescription className="text-[9px] font-mono text-zinc-600">
                {expRemaining} export{expRemaining !== 1 ? 's' : ''} left this week · {' '}
                {subscription.usage.exportsThisWeek}/{limits.exportsPerWeek} used
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-2">

            {/* Save to Library */}
            <Button
              variant="outline"
              className="w-full border-zinc-800 hover:bg-zinc-800 text-[9px] uppercase tracking-widest font-bold"
              onClick={onSaveToLibrary}
              disabled={!isSupabaseConfigured}
              title={!isSupabaseConfigured ? 'Configure Supabase in .env to enable cloud' : undefined}
            >
              <Cloud className="w-3 h-3 mr-2" /> Save to Library
            </Button>

            {/* Print Report — gated on canExport */}
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className={`w-full border-zinc-800 text-[9px] uppercase tracking-widest font-bold ${
                    canExport ? 'hover:bg-zinc-800' : 'opacity-50 cursor-not-allowed'
                  }`}
                  disabled={!canExport}
                  onClick={!canExport ? (e) => {
                    e.preventDefault();
                    addToast('Weekly export limit reached (3/week). Upgrade to Pro for unlimited exports.', 'warning');
                  } : undefined}
                  title={!canExport ? 'Weekly export limit reached. Upgrade to Pro.' : undefined}
                >
                  {!canExport && !isPro
                    ? <Lock className="w-3 h-3 mr-2 text-zinc-600" />
                    : <Printer className="w-3 h-3 mr-2" />
                  }
                  Print Report
                  {!isPro && expRemaining !== null && expRemaining <= 1 && canExport && (
                    <span className="ml-1 text-yellow-500">({expRemaining} left)</span>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[860px] max-h-[90vh] overflow-y-auto bg-zinc-900 border-zinc-800 p-0">
                <DialogHeader className="p-6 border-b border-zinc-800 bg-black/40">
                  <DialogTitle>Analysis Report</DialogTitle>
                  <DialogDescription className="text-zinc-500 text-xs">
                    A4 format — click Print to save as PDF.
                  </DialogDescription>
                </DialogHeader>
                <div className="p-8 bg-zinc-800/50">
                  <PrintPreview
                    analysis={{
                      fileName:     userTrack.fileName ?? '',
                      fileSize:     userTrack.fileSize ?? 0,
                      duration:     userTrack.duration ?? 0,
                      mixHealth:    userTrack.mixHealth!,
                      delta:        deltaReady ? delta : null,
                      vibeTimeline: userTrack.vibeTimeline ?? null,
                    }}
                    targetName={currentProfile?.name ?? ''}
                  />
                </div>
                <div className="p-6 border-t border-zinc-800 bg-black/40 flex justify-end">
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      document.body.setAttribute('data-print-time', new Date().toLocaleString());
                      window.print();
                      // Increment export usage after print
                      const { supabase } = await import('../lib/supabase');
                      if (supabase) {
                        await supabase.rpc('check_and_increment_export');
                        subscription.refresh();
                      }
                    }}
                  >
                    Print / Save PDF
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Export JSON — gated */}
            <Button
              variant="outline"
              className={`w-full border-zinc-800 text-[9px] uppercase tracking-widest font-bold ${
                canExport ? 'hover:bg-zinc-800' : 'opacity-50'
              }`}
              onClick={onExportJson}
            >
              {!canExport && !isPro
                ? <Lock className="w-3 h-3 mr-2 text-zinc-600" />
                : <Download className="w-3 h-3 mr-2" />
              }
              Export JSON
              {!isPro && expRemaining !== null && expRemaining <= 1 && canExport && (
                <span className="ml-1 text-yellow-500">({expRemaining} left)</span>
              )}
            </Button>

          </CardContent>
        </Card>
      )}

      {/* ── UPGRADE CTA (free users only) ──────────────────── */}
      {!isPro && (
        <Card className="bg-gradient-to-br from-blue-600 to-indigo-700 border-none text-white overflow-hidden relative shadow-2xl shadow-blue-600/20">
          <div className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 bg-white/10 rounded-full blur-xl" />
          <CardHeader>
            <CardTitle className="text-base font-bold italic uppercase">Unlock Pro</CardTitle>
            <CardDescription className="text-blue-100 text-[10px]">
              Remove all limits · Everything unlimited
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1.5">
              {[
                'Unlimited AI Mix Coach audits',
                'Unlimited analysis exports',
                'Unlimited library saves',
                'Unlimited track duration',
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-[9px] uppercase tracking-widest font-bold">
                  <ShieldCheck className="w-3 h-3 text-blue-200" /> {item}
                </li>
              ))}
            </ul>
            <Button
              className="w-full bg-white text-blue-600 hover:bg-blue-50 font-bold uppercase tracking-widest text-[9px] py-5"
              onClick={onUpgrade}
            >
              Upgrade for $9/mo
            </Button>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
