import React from 'react';
import { motion } from 'motion/react';

interface LufsMeterProps {
  lufs: number;
  target: number;
}

export const LufsMeter: React.FC<LufsMeterProps> = ({ lufs, target }) => {
  // LUFS range typically -60 to 0. We'll map -30 to 0 for the meter.
  const min = -30;
  const max = 0;
  const percentage = Math.max(0, Math.min(100, ((lufs - min) / (max - min)) * 100));
  const targetPercentage = Math.max(0, Math.min(100, ((target - min) / (max - min)) * 100));

  return (
    <div className="flex flex-col gap-2 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Loudness (LUFS)</span>
        <div className="flex gap-2 items-center">
          <span className="text-[10px] text-zinc-600 font-mono">Target: {target}</span>
          <span className="text-xs font-mono font-bold text-blue-400">{lufs.toFixed(1)}</span>
        </div>
      </div>

      <div className="relative h-6 bg-black rounded border border-zinc-800 overflow-hidden">
        {/* Target Marker */}
        <div 
          className="absolute top-0 bottom-0 w-0.5 bg-blue-500/50 z-20"
          style={{ left: `${targetPercentage}%` }}
        >
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-blue-500 rounded-full" />
        </div>

        {/* Level Bar */}
        <motion.div 
          className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-blue-900 via-blue-500 to-cyan-400"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ type: 'spring', stiffness: 50, damping: 20 }}
        />
        
        {/* Scale */}
        <div className="absolute inset-0 flex justify-between px-1 pointer-events-none">
          {[-30, -24, -18, -12, -6, 0].map(val => (
            <div key={val} className="flex flex-col items-center h-full">
              <div className="w-px h-1 bg-zinc-700" />
              <span className="text-[7px] text-zinc-600 mt-auto mb-0.5">{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
