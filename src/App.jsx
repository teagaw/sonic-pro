/**
 * App.jsx — Sonic Pro root
 *
 * Registers the Service Worker and renders the provider + dashboard.
 * The <AudioWorkerProvider> sits here — as high as possible in the tree —
 * so the worker singleton is never unmounted during the session.
 *
 * Theme support: dark (default) and light mode via CSS variables.
 */

import { useEffect, useState } from "react";
import { AudioWorkerProvider } from "./context/AudioWorkerContext";
import { MixHealthDashboard }  from "./components/MixHealthDashboard";

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => console.log("[SW] Registered:", reg.scope))
        .catch((err) => console.warn("[SW] Registration failed:", err));
    });
  }
}

function initTheme() {
  const saved = localStorage.getItem("sonic-pro-theme");
  const theme = saved || "dark";
  document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

export default function App() {
  const [theme, setTheme] = useState(initTheme);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sonic-pro-theme", next);
  };

  return (
    <AudioWorkerProvider theme={theme} toggleTheme={toggleTheme}>
      <MixHealthDashboard />
    </AudioWorkerProvider>
  );
}
