import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);

  const draw = () => {
    if (!canvasRef.current || !analyser) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i] / 2;

      // Gradient color based on frequency
      const hue = (i / bufferLength) * 360;
      ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.8)`;
      
      // Draw bar
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

      // Add a small glow on top
      ctx.fillStyle = `hsla(${hue}, 70%, 70%, 1)`;
      ctx.fillRect(x, canvas.height - barHeight, barWidth, 2);

      x += barWidth + 1;
    }

    requestRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(draw);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, analyser]);

  return (
    <div className="relative w-full h-48 bg-black/40 rounded-lg border border-white/10 overflow-hidden">
      <canvas 
        ref={canvasRef} 
        width={800} 
        height={200} 
        className="w-full h-full"
      />
      <div className="absolute inset-0 pointer-events-none border-t border-white/5 bg-gradient-to-b from-white/5 to-transparent" />
    </div>
  );
};
