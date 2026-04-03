/**
 * @file src/components/AuthModal.jsx — Lazy auth modal
 *
 * Opened only when a user tries a cloud-gated action (Save/Export).
 * Supports email/password (sign-up and sign-in) and Google OAuth.
 * Uses Supabase Auth — no backend code required.
 *
 * Design: matches Sonic Pro Studio Dark aesthetic (T tokens inline).
 */

import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

// ─────────────────────────────────────────────────────────────
//  DESIGN TOKENS (duplicated here so component is self-contained)
// ─────────────────────────────────────────────────────────────
const T = {
  bg0: "#060611", bg1: "#0d0d1e", bg2: "#14142a", bg3: "#1c1c38",
  border: "#252545", borderBright: "#3a3a60",
  textPrim: "#c8c8e8", textMuted: "#555575",
  cyan: "#00d8ff", green: "#00ff87", yellow: "#ffd000",
  red: "#ff3060", purple: "#a06dff",
};

// ─────────────────────────────────────────────────────────────
//  INTERNAL COMPONENTS
// ─────────────────────────────────────────────────────────────

function InputField({ label, type = "text", value, onChange, placeholder, disabled }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label style={{ fontSize: "10px", letterSpacing: "0.14em", color: T.textMuted,
        textTransform: "uppercase", fontFamily: "'Rajdhani', sans-serif" }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        style={{ background: T.bg2, border: `1px solid ${T.border}`,
          color: T.textPrim, padding: "10px 12px", borderRadius: "3px",
          fontSize: "14px", outline: "none", fontFamily: "'IBM Plex Mono', monospace",
          transition: "border-color 0.15s",
          opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "auto" }}
        onFocus={e => e.target.style.borderColor = T.cyan}
        onBlur={e  => e.target.style.borderColor = T.border}
      />
    </div>
  );
}

function AuthButton({ onClick, disabled, loading, color = T.cyan, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{ background: loading ? T.bg3 : `${color}22`,
        border: `1px solid ${loading ? T.border : color}`,
        color: loading ? T.textMuted : color, padding: "10px 16px",
        borderRadius: "3px", fontSize: "12px", letterSpacing: "0.12em",
        textTransform: "uppercase", fontFamily: "'Rajdhani', sans-serif",
        fontWeight: 700, cursor: disabled || loading ? "not-allowed" : "pointer",
        width: "100%", transition: "all 0.15s" }}>
      {loading ? "Working…" : children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL
// ─────────────────────────────────────────────────────────────

/**
 * AuthModal — shown when a user triggers a cloud-gated action without being signed in.
 *
 * @param {{ onClose: () => void }} props
 */
export function AuthModal({ onClose }) {
  const [tab,      setTab]      = useState("signup");  // "signup" | "login"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [success,  setSuccess]  = useState(null);

  const clearMessages = () => { setError(null); setSuccess(null); };

  /** Handle email/password submit for both sign-up and sign-in. */
  const handleEmailSubmit = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    clearMessages();
    setLoading(true);

    if (tab === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setSuccess("Check your email for a confirmation link, then come back to sign in.");
        setTab("login");
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message.includes("Invalid")
          ? "Email or password is incorrect."
          : signInError.message);
      }
      // On success, the onAuthStateChange listener in useAuth fires and closes the modal
    }

    setLoading(false);
  }, [tab, email, password]);

  /** Sign in with Google OAuth. Redirects to the current page after auth. */
  const handleGoogleSignIn = useCallback(async () => {
    clearMessages();
    setLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) setError(oauthError.message);
    setLoading(false);
  }, []);

  const handleKeyDown = (e) => { if (e.key === "Enter") handleEmailSubmit(); };

  return (
    /* Backdrop */
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(6,6,17,0.85)",
        backdropFilter: "blur(4px)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>

      {/* Modal card */}
      <div style={{ background: T.bg1, border: `1px solid ${T.border}`,
        borderTop: `2px solid ${T.cyan}`, borderRadius: "6px",
        padding: "32px", width: "100%", maxWidth: "420px",
        display: "flex", flexDirection: "column", gap: "20px",
        boxShadow: `0 0 60px ${T.cyan}22` }}>

        {/* Header */}
        <div>
          <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "0.12em",
            color: T.textPrim, fontFamily: "'Rajdhani', sans-serif" }}>
            Save to Your Library
          </div>
          <div style={{ fontSize: "13px", color: T.textMuted, marginTop: "6px", lineHeight: 1.5 }}>
            Create a free account to save analyses across sessions.
            Core analysis features always work without an account.
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: "4px", background: T.bg2,
          borderRadius: "4px", padding: "3px" }}>
          {["signup", "login"].map(t => (
            <button key={t} onClick={() => { setTab(t); clearMessages(); }}
              style={{ flex: 1, padding: "7px", borderRadius: "3px", border: "none",
                background: tab === t ? T.bg3 : "transparent",
                color: tab === t ? T.textPrim : T.textMuted,
                fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, cursor: "pointer",
                transition: "all 0.15s" }}>
              {t === "signup" ? "Create Account" : "Sign In"}
            </button>
          ))}
        </div>

        {/* Google sign-in */}
        <AuthButton onClick={handleGoogleSignIn} loading={loading} color={T.purple}>
          Continue with Google
        </AuthButton>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ flex: 1, height: "1px", background: T.border }} />
          <span style={{ fontSize: "11px", color: T.textMuted }}>or</span>
          <div style={{ flex: 1, height: "1px", background: T.border }} />
        </div>

        {/* Email + Password */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          onKeyDown={handleKeyDown}>
          <InputField label="Email" type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com" disabled={loading} />
          <InputField label="Password" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={tab === "signup" ? "At least 6 characters" : "Your password"}
            disabled={loading} />
        </div>

        {/* Error / Success messages */}
        {error && (
          <div style={{ padding: "10px 14px", background: "#ff306022",
            border: "1px solid #ff306044", borderLeft: `3px solid ${T.red}`,
            borderRadius: "3px", fontSize: "12px", color: T.red }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ padding: "10px 14px", background: "#00ff8722",
            border: "1px solid #00ff8744", borderLeft: `3px solid ${T.green}`,
            borderRadius: "3px", fontSize: "12px", color: T.green }}>
            {success}
          </div>
        )}

        {/* Submit */}
        <AuthButton onClick={handleEmailSubmit} loading={loading} color={T.cyan}>
          {tab === "signup" ? "Create Free Account" : "Sign In"}
        </AuthButton>

        {/* Dismiss */}
        <button onClick={onClose}
          style={{ background: "transparent", border: "none",
            color: T.textMuted, fontSize: "12px", cursor: "pointer",
            fontFamily: "'Rajdhani', sans-serif", letterSpacing: "0.1em",
            textDecoration: "underline", alignSelf: "center" }}>
          Continue without saving
        </button>
      </div>
    </div>
  );
}

export default AuthModal;
