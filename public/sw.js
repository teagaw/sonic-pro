/**
 * public/sw.js — Sonic Pro Service Worker v3
 *
 * Ported from previous version and updated for v6.
 *
 * Caching strategy:
 *   - App shell (HTML, JS bundles, CSS) → Cache First (fast loads after install)
 *   - Same-origin assets               → Cache First + Network Fallback
 *   - Audio files from user disk       → Never cached (blob: URLs bypass SW)
 *   - External requests (Supabase, Gemini) → Network Only
 *
 * Version bump forces browsers to discard the old cache and re-download
 * all updated assets. Bump CACHE_VERSION whenever you deploy a new build.
 */

const CACHE_VERSION = 'sonic-pro-v3';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;

// Pre-cached on install — the minimal app shell
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ─── INSTALL — pre-cache the app shell ────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
  );
  // Take control immediately — don't wait for old SW to unload
  self.skipWaiting();
});

// ─── ACTIVATE — delete all old sonic-pro caches ───────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('sonic-pro-') && key !== SHELL_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  // Claim all open tabs so the new SW takes effect without a reload
  self.clients.claim();
});

// ─── FETCH — routing strategy ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept GET requests
  if (event.request.method !== 'GET') return;

  // Never intercept Supabase or Gemini API calls — they need live network
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('generativelanguage.googleapis.com')
  ) return;

  // Same-origin assets (app shell, Vite bundles, CSS) → Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Everything else → Network Only
  // Audio files from user disk arrive as blob: URLs and never reach here.
});

// ─── CACHE STRATEGIES ─────────────────────────────────────────

/**
 * Cache First: serve from cache if available; otherwise fetch from
 * network, cache the response, and return it.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Only cache valid, same-origin responses
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // If network fails and there's no cache, let the browser handle it
    return Response.error();
  }
}
