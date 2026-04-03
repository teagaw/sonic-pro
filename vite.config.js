import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VERCEL ? "/" : "/",
  plugins: [react()],

  worker: {
    /**
     * "es" format: Vite bundles the worker as an ES module.
     * audioWorker.js uses ES import syntax (no importScripts).
     *
     * AudioWorkerContext instantiates it with { type: "module" },
     * which is the browser-side complement to this setting.
     *
     * Browser support: Chrome 80+, Firefox 114+, Safari 15+.
     * For older targets, swap to format: "iife" and use importScripts() instead.
     */
    format: "es",
  },

  build: {
    target: "es2020",
    chunkSizeWarningLimit: 500,
    rollupOptions: {},
  },

  // No optimizeDeps needed — the worker is pure JS DSP with no external dependencies.
});
