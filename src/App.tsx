/**
 * App.tsx — Sonic Pro v6
 *
 * Thin shell. Owns:
 *   - Theme state (persisted in localStorage, anti-flash applied in index.html)
 *   - Service Worker registration
 *   - AudioWorkerProvider (must wrap MixDashboard so the worker never unmounts)
 *
 * All UI + business logic lives in MixDashboard.
 */

import { useState, useEffect, useCallback } from 'react';
import { AudioWorkerProvider } from './context/AudioWorkerContext';
import { MixDashboard } from './components/MixDashboard';

const THEME_KEY = 'sonic-pro-theme';

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then(reg  => console.log('[SW] Registered:', reg.scope))
        .catch(err => console.warn('[SW] Registration failed:', err));
    });
  }
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => { registerServiceWorker(); }, []);

  const toggleTheme = useCallback(
    () => setTheme(t => t === 'dark' ? 'light' : 'dark'),
    []
  );

  return (
    <AudioWorkerProvider>
      <MixDashboard theme={theme} toggleTheme={toggleTheme} />
    </AudioWorkerProvider>
  );
}
