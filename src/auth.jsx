// ─────────────────────────────────────────────────────────────────────────
//  eSSF Curve — Authentication
// ─────────────────────────────────────────────────────────────────────────
//
//  Exports:
//    <LoginGate>       wraps the app; nothing renders inside until an
//                      authenticated admin user is signed in
//    <HeaderUserBadge> inline badge for the page header showing the
//                      signed-in user + a sign-out link
//    useAuth()         hook returning { session, logout } (admins only)
//
//  Flow:
//    1. Branded landing page (logo, tagline, sign-in button)
//    2. Click "Sign in" → login form (email + password)
//    3. Submit credentials → check against users.js
//       - admin role: proceed into the app
//       - member role: shown "Pending access" screen; cannot proceed
//       - invalid:    error message, stay on form
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, createContext, useContext } from "react";
import { USERS, SESSION_VERSION, SESSION_MAX_AGE_DAYS } from "./users.js";

// ── Design tokens (match main app) ───────────────────────────────────────
const NAVY = "#0b2a6f";
const TEAL = "#139cb6";
const BORDER = "#dfe7f2";
const RUST = "#b4332e";
const AMBER = "#bf7a1a";
const INK = "#1d1d1f";
const SLATE = "#5a6984";
const WHISPER = "#8e9bb5";
const SURFACE_TINT = "#f7fbff";

const STORAGE_KEY = "essf_curve_session";

// ── Crypto / session helpers ─────────────────────────────────────────────

async function sha256(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function findUser(email) {
  const lower = (email || "").trim().toLowerCase();
  return USERS.find((u) => u.email.toLowerCase() === lower) || null;
}

async function verifyCredentials(email, password) {
  const user = findUser(email);
  if (!user) return null;
  const inputHash = await sha256(password);
  if (inputHash !== user.hash) return null;
  return user;
}

function readSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.email || !s.timestamp || !s.version) return null;
    if (s.version !== SESSION_VERSION) return null;
    const ageMs = Date.now() - s.timestamp;
    const maxAgeMs = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) return null;
    // Confirm user still exists in allow-list AND still has admin role
    const u = findUser(s.email);
    if (!u) return null;
    if (u.role !== "admin") return null;
    return { ...s, role: u.role };
  } catch {
    return null;
  }
}

function writeSession(user) {
  const s = {
    email: user.email.trim().toLowerCase(),
    label: user.label || user.email,
    role: user.role,
    timestamp: Date.now(),
    version: SESSION_VERSION,
    sessionId: crypto.randomUUID
      ? crypto.randomUUID()
      : String(Math.random()).slice(2),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  return s;
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Context ──────────────────────────────────────────────────────────────

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <LoginGate>");
  return ctx;
}

// ── Main gate ────────────────────────────────────────────────────────────

export function LoginGate({ children, logoSrc }) {
  // screen states: "landing" → "login" → (success: app | pending: blocked)
  const [session, setSession] = useState(() => readSession());
  const [screen, setScreen] = useState("landing"); // landing | login | pending
  const [pendingUserLabel, setPendingUserLabel] = useState("");

  useEffect(() => {
    setSession(readSession());
  }, []);

  const logout = () => {
    clearSession();
    setSession(null);
    setScreen("landing");
    setPendingUserLabel("");
  };

  // Already authenticated admin? Skip everything else.
  if (session) {
    return (
      <AuthContext.Provider value={{ session, logout }}>
        {children}
      </AuthContext.Provider>
    );
  }

  // Pending screen — non-admin tried to log in
  if (screen === "pending") {
    return (
      <PendingAccessScreen
        label={pendingUserLabel}
        onBack={() => {
          setScreen("landing");
          setPendingUserLabel("");
        }}
      />
    );
  }

  // Login form
  if (screen === "login") {
    return (
      <LoginScreen
        onCancel={() => setScreen("landing")}
        onAuth={(user) => {
          if (user.role === "admin") {
            const s = writeSession(user);
            setSession(s);
          } else {
            // Non-admin: record their label for pending screen, then redirect
            setPendingUserLabel(user.label || user.email);
            setScreen("pending");
          }
        }}
      />
    );
  }

  // Default: landing
  return <LandingScreen onSignIn={() => setScreen("login")} logoSrc={logoSrc} />;
}

// ── Branded landing page ─────────────────────────────────────────────────

function LandingScreen({ onSignIn, logoSrc }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at top, #eaf1fb 0%, ${SURFACE_TINT} 50%, #fff 100%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: INK,
      }}
    >
      {/* Logo block */}
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        {logoSrc && (
          <img
            src={logoSrc}
            alt="eSSF Curve"
            style={{
              height: 120,
              maxWidth: "100%",
              objectFit: "contain",
              display: "block",
              margin: "0 auto 20px",
            }}
          />
        )}
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: TEAL,
            letterSpacing: 4,
            marginBottom: 16,
          }}
        >
          ANALYTICAL WORKBENCH
        </div>
        <p
          style={{
            fontSize: 15,
            color: SLATE,
            maxWidth: 440,
            margin: "0 auto",
            lineHeight: 1.6,
          }}
        >
          A unified browser-based workbench for ICH M10 validation, plate-reader analysis, and analytical method development.
        </p>
      </div>

      {/* Sign-in CTA */}
      <button
        onClick={onSignIn}
        style={{
          padding: "12px 36px",
          background: NAVY,
          color: "#fff",
          border: "none",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.3,
          cursor: "pointer",
          fontFamily: "inherit",
          boxShadow: "0 6px 20px rgba(11,42,111,0.18)",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#162d6e";
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 8px 24px rgba(11,42,111,0.22)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = NAVY;
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 6px 20px rgba(11,42,111,0.18)";
        }}
      >
        Sign in
      </button>

      <div
        style={{
          marginTop: 14,
          fontSize: 11,
          color: WHISPER,
          textAlign: "center",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        Authorized lab members only. If you don&rsquo;t have credentials, please contact the lab lead.
      </div>

      {/* Bottom credit line */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 10,
          color: WHISPER,
          letterSpacing: 0.5,
        }}
      >
        Designed and developed by Cyndell Gracieux-Singleton · &copy; {new Date().getFullYear()} · All rights reserved
      </div>
    </div>
  );
}

// ── Login screen ─────────────────────────────────────────────────────────

function LoginScreen({ onAuth, onCancel }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await verifyCredentials(email, password);
      await new Promise((r) => setTimeout(r, 350)); // mask timing differences
      if (!user) {
        setError("Email or password not recognized. Please check both and try again.");
        setBusy(false);
        return;
      }
      onAuth(user);
    } catch (err) {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at top, #eaf1fb 0%, ${SURFACE_TINT} 50%, #fff 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#fff",
          borderRadius: 14,
          border: `1px solid ${BORDER}`,
          padding: "32px 30px",
          boxShadow: "0 12px 36px rgba(11,42,111,0.10)",
        }}
      >
        {/* Compact header */}
        <div style={{ marginBottom: 22 }}>
          <button
            onClick={onCancel}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: WHISPER,
              fontSize: 11,
              fontFamily: "inherit",
              marginBottom: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            ← back
          </button>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: TEAL,
              letterSpacing: 2,
              marginBottom: 4,
            }}
          >
            eSSF Curve
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: NAVY,
              margin: 0,
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
            }}
          >
            Sign in
          </h1>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="email" style={labelStyle}>Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label htmlFor="password" style={labelStyle}>Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={errorStyle}>{error}</div>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            style={{
              width: "100%",
              padding: "10px 16px",
              background: busy || !email || !password ? "#9aaad0" : NAVY,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: busy || !email || !password ? "default" : "pointer",
              fontFamily: "inherit",
              boxShadow: "0 4px 14px rgba(11,42,111,0.12)",
              transition: "background 0.15s",
            }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div
            style={{
              fontSize: 10,
              color: WHISPER,
              marginTop: 16,
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            Your sign-in will be remembered on this browser for {SESSION_MAX_AGE_DAYS} days.
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Pending-access screen for non-admin users ────────────────────────────

function PendingAccessScreen({ label, onBack }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at top, #eaf1fb 0%, ${SURFACE_TINT} 50%, #fff 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#fff",
          borderRadius: 14,
          border: `1px solid ${BORDER}`,
          padding: "36px 34px",
          textAlign: "center",
          boxShadow: "0 12px 36px rgba(11,42,111,0.10)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "#fef9f0",
            border: `2px solid ${AMBER}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontSize: 26,
          }}
        >
          ⏳
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: NAVY,
            margin: "0 0 12px",
            letterSpacing: "-0.01em",
          }}
        >
          Almost there, {label}
        </h1>
        <p
          style={{
            fontSize: 14,
            color: INK,
            lineHeight: 1.6,
            margin: "0 0 8px",
          }}
        >
          Your account is recognized, but access to the workbench hasn&rsquo;t been enabled yet.
        </p>
        <p
          style={{
            fontSize: 13,
            color: SLATE,
            lineHeight: 1.6,
            margin: "0 0 28px",
          }}
        >
          The tools are ready &mdash; we&rsquo;re finalizing testing and walking the team through the new workflow first. You&rsquo;ll be enabled shortly. If you have questions, please reach out to the lab lead.
        </p>
        <button
          onClick={onBack}
          style={{
            padding: "9px 22px",
            background: "#fff",
            color: NAVY,
            border: `1.5px solid ${NAVY}`,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Return to home
        </button>
      </div>
    </div>
  );
}

// ── Inline header badge for placement inside the existing page header ────
//
// Drop this component anywhere inside the page header in your main app.
// It renders just text + a sign-out link, no background, no fixed position.
//
// Example:
//   <div className="page-header">
//     <h1>eSSF Curve</h1>
//     <HeaderUserBadge />
//   </div>

export function HeaderUserBadge({ compact = false }) {
  const { session, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);

  if (!session) return null;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: compact ? 10 : 11,
        color: SLATE,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: WHISPER }}>Signed in as</span>
      <span style={{ color: NAVY, fontWeight: 700 }}>
        {session.label || session.email}
      </span>
      <span style={{ color: WHISPER }}>·</span>
      {confirming ? (
        <>
          <span style={{ color: RUST, fontWeight: 600 }}>Sign out?</span>
          <button onClick={logout} style={linkBtn(RUST)}>yes</button>
          <button onClick={() => setConfirming(false)} style={linkBtn(WHISPER)}>no</button>
        </>
      ) : (
        <button onClick={() => setConfirming(true)} style={linkBtn(TEAL)}>
          sign out
        </button>
      )}
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#30437a",
  marginBottom: 5,
};

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #d8dfeb",
  fontSize: 13,
  fontFamily: "inherit",
  color: INK,
  background: "#fff",
  boxSizing: "border-box",
  outline: "none",
};

const errorStyle = {
  fontSize: 11,
  color: RUST,
  background: "#fef0ee",
  border: `1px solid #f5d4cf`,
  borderRadius: 6,
  padding: "8px 12px",
  marginBottom: 14,
  lineHeight: 1.5,
};

function linkBtn(color) {
  return {
    background: "none",
    border: "none",
    padding: 0,
    color,
    fontSize: "inherit",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "underline",
  };
}
