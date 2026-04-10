/**
 * LibraryPanel.tsx — Cloud analysis library modal.
 *
 * Extracted from App.tsx. Receives data + callbacks via props;
 * owns no state of its own beyond the delete-confirmation flow.
 */

import React, { useState } from 'react';
import { Trash2, X, Clock, Zap, BarChart3, Music, CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { motion, AnimatePresence } from 'motion/react';
import type { SavedAnalysis } from '../hooks/useLibrary';

interface LibraryPanelProps {
  show:           boolean;
  onClose:        () => void;
  analyses:       SavedAnalysis[];
  count:          number;
  maxAnalyses:    number;
  isFull:         boolean;
  isNearFull:     boolean;
  isPro:          boolean;
  loading:        boolean;
  deleteAnalysis: (id: string) => Promise<{ success: boolean; error?: string }>;
  addToast:       (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

export function LibraryPanel({
  show, onClose, analyses, count, maxAnalyses, isFull, isNearFull,
  isPro, loading, deleteAnalysis, addToast,
}: LibraryPanelProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId,  setConfirmId]  = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setConfirmId(null);
    const res = await deleteAnalysis(id);
    if (!res.success) addToast(res.error ?? 'Delete failed.', 'error');
    setDeletingId(null);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const lufsColor = (v: number | null) => {
    if (v === null) return 'text-zinc-500';
    if (v >= -14) return 'text-green-400';
    if (v >= -18) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <Dialog open={show} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-zinc-900 border-zinc-800 p-0">

        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-bold">Analysis Library</DialogTitle>
              <DialogDescription className="text-[9px] uppercase tracking-widest font-mono text-zinc-500 mt-1">
                {isPro ? `${count} analyses saved` : `${count} / ${maxAnalyses} saves used`}
              </DialogDescription>
            </div>
            {(isFull || isNearFull) && (
              <Badge
                variant="outline"
                className={`text-[9px] font-mono uppercase tracking-widest ${
                  isFull ? 'border-red-500/40 text-red-400' : 'border-yellow-500/40 text-yellow-400'
                }`}
              >
                {isFull ? 'Library Full' : `${maxAnalyses - count} slot${maxAnalyses - count !== 1 ? "s" : ""} left`}
              </Badge>
            )}
          </div>

          {/* Tier progress bar */}
          <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${isFull ? 'bg-red-500' : isNearFull ? 'bg-yellow-500' : 'bg-blue-500'}`}
              initial={{ width: 0 }}
              animate={{ width: isPro ? "100%" : `${Math.min(100, (count / maxAnalyses) * 100)}%` }}
              transition={{ type: 'spring', stiffness: 60 }}
            />
          </div>
        </DialogHeader>

        {/* List */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-2">
            {loading ? (
              <div className="space-y-2 py-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 bg-zinc-800 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : analyses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                <CloudOff className="w-10 h-10 mb-3 opacity-50" />
                <p className="text-sm italic">No saved analyses yet.</p>
                <p className="text-[9px] uppercase tracking-widest font-mono mt-1">
                  Analyze a mix and click Save.
                </p>
              </div>
            ) : (
              <AnimatePresence>
                {analyses.map(a => (
                  <motion.div
                    key={a.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex items-center gap-4 p-4 bg-zinc-800/50 border border-zinc-700/50 rounded-xl group hover:border-zinc-600 transition-colors"
                  >
                    {/* Icon */}
                    <div className="w-10 h-10 bg-blue-600/10 rounded-lg flex items-center justify-center border border-blue-500/20 shrink-0">
                      <Music className="w-5 h-5 text-blue-500" />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate text-zinc-200">
                        {a.file_name || 'Untitled'}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1 text-[9px] font-mono text-zinc-500">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDate(a.created_at)}
                        </span>
                        {a.profile_id && (
                          <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                            {a.profile_id}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="flex items-center gap-4 shrink-0">
                      {a.integrated_lufs !== null && (
                        <div className="text-right">
                          <div className={`text-sm font-mono font-bold ${lufsColor(a.integrated_lufs)}`}>
                            {a.integrated_lufs.toFixed(1)}
                          </div>
                          <div className="text-[8px] font-mono text-zinc-600 uppercase">LUFS</div>
                        </div>
                      )}
                      {a.crest_factor !== null && (
                        <div className="text-right hidden md:block">
                          <div className="text-sm font-mono font-bold text-zinc-300">
                            {a.crest_factor.toFixed(1)}
                          </div>
                          <div className="text-[8px] font-mono text-zinc-600 uppercase">Crest</div>
                        </div>
                      )}
                    </div>

                    {/* Delete */}
                    <div className="shrink-0">
                      {confirmId === a.id ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDelete(a.id)}
                            disabled={!!deletingId}
                            className="text-[9px] font-mono text-red-400 uppercase tracking-widest hover:text-red-300 transition-colors"
                          >
                            {deletingId === a.id ? '…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest hover:text-zinc-300 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(a.id)}
                          disabled={!!deletingId}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-600 hover:text-red-400 transition-all rounded-lg hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 shrink-0">
          <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
            {isPro ? "Pro plan · Unlimited saves" : `Free tier · ${maxAnalyses} saves max · Upgrade for unlimited`}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
