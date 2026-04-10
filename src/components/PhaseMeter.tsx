import React from 'react';
import { motion } from 'motion/react';

interface PhaseMeterProps {
  correlation: number; // -1 to 1
}

export const PhaseMeter: React.FC<PhaseMeterProps> = ({ correlation }) => {
  // Map -1..1 to 0..100%
  const percentage = ((correlation + 1) / 2) * 100;
  
  const getStatusColor = (val: number) => {
    if (val < 0) return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]';
    if (val < 0.3) return 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]';
    return 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]';
  };

  return (
    <div className="flex flex-col gap-2 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">Phase Correlation</span>
        <span className={`text-xs font-mono font-bold ${correlation < 0 ? 'text-red-400' : 'text-green-400'}`}>
          {correlation.toFixed(2)}
        </span>
      </div>
      
      <div className="relative h-3 bg-black rounded-full overflow-hidden border border-zinc-800">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-700 z-10" />
        
        {/* Indicator */}
        <motion.div 
          className={`absolute top-0 bottom-0 w-2 -ml-1 rounded-full ${getStatusColor(correlation)} transition-colors duration-300`}
          animate={{ left: `${percentage}%` }}
          transition={{ type: 'spring', stiffness: 100, damping: 15 }}
        />
      </div>
      
      <div className="flex justify-between text-[8px] font-mono text-zinc-600 uppercase tracking-tighter">
        <span>Out of Phase (-1)</span>
        <span>Mono (0)</span>
        <span>In Phase (+1)</span>
      </div>

      {correlation < 0 && (
        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400 leading-tight">
          ⚠️ CRITICAL: Negative correlation detected. Your mix will disappear on mono speakers (phones, clubs).
        </div>
      )}
    </div>
  );
};
