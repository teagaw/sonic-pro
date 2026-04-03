/**
 * sw.js — Sonic Pro Service Worker v2
 *
 * Caching strategy:
 *   - App shell (HTML, CSS, JS bundles) → Cache First (fast loads after install)
 *   - Same-origin assets               → Cache First + Network Fallback
 *   - Audio files from user disk       → Never cached (blob: URLs bypass SW)
 *   - External requests                → Network Only
 *
 * Version bump (v1 → v2): forces browsers to discard the old cache and
 * re-download all updated app shell assets.
 */

const CACHE_VERSION = "sonic-pro-v2";
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;

// Files that form the app shell — pre-cached on install
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
];

// ─────────────────────────────────────────────────────────────
//  INSTALL — pre-cache the app shell
// ─────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  // Take control immediately, don't wait for old SW to unload
  self.skipWaiting();
});

// ─────────────────────────────────────────────────────────────
//  ACTIVATE — delete all old sonic-pro caches
// ─────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("sonic-pro-") && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Claim clients so the new SW takes over all open tabs
  self.clients.claim();
});

// ─────────────────────────────────────────────────────────────
//  FETCH — routing strategy
// ─────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept non-GET requests
  if (event.request.method !== "GET") return;

  // Same-origin assets (app shell, JS bundles, CSS) → Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Everything else (Supabase API, Google Fonts, etc.) → Network Only
  // Audio files from user disk arrive as blob: URLs and never reach here.
});

// ─────────────────────────────────────────────────────────────
//  CACHE STRATEGY
// ─────────────────────────────────────────────────────────────

/**
 * Cache First: serve from cache if available; otherwise fetch from network
 * and store the response for future requests.
 *
 * @param {Request} request
 * @param {string}  cacheName
 * @returns {Promise<Response>}
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Network error — resource unavailable offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
