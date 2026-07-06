/**
 * src/components/SidePanel.tsx — v4
 *
 * Changes:
 *   - Accepts `subscription` (SubscriptionState) + `onUpgrade` props.
 *   - Print Report button gated: disabled + remaining count for free tier.
 *   - Export JSON button gated (calls onExportJson which gates in MixDashboard).
 *   - Upgrade CTA button wired to onUpgrade.
 *   - Shows Pro badge + period-end when active.
 */

import React from 'react';
import {
  ChevronRight, Cloud, Printer,
  Download, Zap, ShieldCheck, Lock, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { PrintPreview }   from './PrintPreview';
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
  const { isPro, usage, limits, canExport } = subscription;

  // ── Usage badge helper ─────────────────────────────────────
  const expRemaining = isPro ? null : Math.max(0, limits.exportsPerWeek - usage.exportsThisWeek);

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
