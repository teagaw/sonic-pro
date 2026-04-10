import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    /**
     * ES module format — required for TypeScript workers in Vite.
     * Instantiated with { type: 'module' } in src/context/AudioWorkerContext.tsx.
     */
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'motion':       ['motion'],
          'supabase':     ['@supabase/supabase-js'],
          'genai':        ['@google/genai'],
          'ui':           ['class-variance-authority', 'clsx', 'tailwind-merge'],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
