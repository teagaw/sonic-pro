/**
 * VibeTimeline.tsx — Real vibe timeline from production DSP engine.
 * Labels come from energy + spectral flux + flatness, NOT random values.
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import type { VibeSegment } from '../lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const LABEL_COLORS: Record<string, string> = {
  'INTRO':             'bg-slate-600',
  'VERSE':             'bg-blue-700',
  'BUILD':             'bg-amber-600',
  'DROP / CHORUS':     'bg-red-600',
  'BREAKDOWN':         'bg-teal-800',
  'OUTRO':             'bg-slate-700',
  'BROADBAND INTRO':   'bg-violet-700',
  'BROADBAND BUILD':   'bg-orange-600',
  'BROADBAND DROP':    'bg-rose-600',
  'BROADBAND OUTRO':   'bg-purple-800',
  'BROADBAND SECTION': 'bg-cyan-700',
};

function formatTime(s: number): string {
  const m = Math.floor(s/60), sec = Math.floor(s%60).toString().padStart(2,'0');
  return `${m}:${sec}`;
}

interface Props { timeline: VibeSegment[] | null }

export const VibeTimeline: React.FC<Props> = ({ timeline }) => {
  const [hovered, setHovered] = useState<number|null>(null);
  if (!timeline || timeline.length === 0) return null;

  const total = timeline[timeline.length-1]?.endTime || 1;

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Vibe Timeline</h3>
          <div className="flex gap-3 text-[9px] font-mono text-zinc-600 flex-wrap justify-end">
            {['DROP / CHORUS','BUILD','BREAKDOWN','BROADBAND SECTION'].map(l => (
              <div key={l} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-sm ${LABEL_COLORS[l] ?? 'bg-zinc-700'}`} />
                <span>{l.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Colour strip */}
        <div className="flex h-10 w-full gap-px rounded overflow-hidden">
          {timeline.map((seg, i) => {
            const w = ((seg.endTime - seg.startTime) / total) * 100;
            const colorClass = LABEL_COLORS[seg.label] ?? 'bg-zinc-700';
            return (
              <React.Fragment key={i}>
                <Tooltip>
                <TooltipTrigger asChild>
                  <motion.div
                    initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
                    transition={{ delay: i * 0.015, type: 'spring', stiffness: 200, damping: 20 }}
                    className={`${colorClass} cursor-help hover:brightness-125 transition-all origin-bottom`}
                    style={{
                      width: `${w}%`, flexShrink: 0,
                      opacity: 0.4 + seg.normalizedEnergy * 0.6,
                    }}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                  />
                </TooltipTrigger>
                <TooltipContent className="bg-zinc-900 border-zinc-700 text-xs font-mono space-y-1">
                  <div className="font-bold text-blue-400">{seg.label}</div>
                  <div className="text-zinc-400">{formatTime(seg.startTime)} – {formatTime(seg.endTime)}</div>
                  <div className="text-zinc-500">Energy: {seg.energyDb} dBFS</div>
                  <div className="text-zinc-500">Flatness: {(seg.midRangeFlatness*100).toFixed(0)}%</div>
                </TooltipContent>
                </Tooltip>
              </React.Fragment>
            );
          })}
        </div>

        {/* Energy waveform */}
        <div className="flex h-6 gap-px items-end">
          {timeline.map((seg, i) => {
            const w = ((seg.endTime - seg.startTime) / total) * 100;
            const h = Math.max(4, seg.normalizedEnergy * 100);
            return (
              <div key={i} style={{ width: `${w}%`, flexShrink: 0, height: `${h}%` }}
                className="bg-blue-500/40 rounded-sm" />
            );
          })}
        </div>

        {/* Hover detail */}
        {hovered !== null && timeline[hovered] && (
          <motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}
            className="grid grid-cols-5 gap-3 p-3 bg-zinc-900/80 border border-zinc-800 rounded-lg text-[10px] font-mono">
            {[
              { label:'TIME', value:`${formatTime(timeline[hovered].startTime)}`},
              { label:'ENERGY', value:`${timeline[hovered].energyDb} dBFS`},
              { label:'FLUX', value:`${(timeline[hovered].normalizedFlux*100).toFixed(0)}%`},
              { label:'FLATNESS', value:`${(timeline[hovered].midRangeFlatness*100).toFixed(0)}%`},
              { label:'LABEL', value:timeline[hovered].label},
            ].map(({label,value}) => (
              <div key={label}>
                <div className="text-zinc-600 uppercase tracking-widest mb-1">{label}</div>
                <div className="text-zinc-300">{value}</div>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </TooltipProvider>
  );
};
