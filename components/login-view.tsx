"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { SampleReconCard } from "@/components/auth/SampleReconCard";
import {
  EyeIcon,
  EyeOffIcon,
  MoonIcon,
  SunIcon,
  GoogleIcon,
  SparkleIcon,
} from "@/components/icons";

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    setDark(localStorage.getItem("pma-theme") !== "light");
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    const theme = next ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pma-theme", theme);
  }
  return (
    <button
      className="icon-btn"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{ position: "absolute", top: 24, right: 24 }}
    >
      {dark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

export function LoginView({ googleEnabled }: { googleEnabled: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "signin"
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name: name || email.split("@")[0] });
      if (res.error) {
        setError(
          mode === "signin"
            ? "That password doesn't match this account. Try again or reset it."
            : res.error.message || "Could not create the account. Try a different email."
        );
        setBusy(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    await signIn.social({ provider: "google", callbackURL: "/" });
  }

  async function demo() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/demo", { method: "POST" });
      if (!r.ok) throw new Error();
      window.location.href = "/";
    } catch {
      setError("Couldn't start the demo. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "flex" }}>
      <ThemeToggle />

      {/* LEFT — product promise */}
      <div
        ref={panelRef}
        className="login-left"
        style={{
          flex: 1,
          padding: "40px 56px",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="brand-mark brand-mark-hero">$</div>
          <div>
            <div className="brand-name">PayRecon</div>
            <div className="brand-sub">Reconciliation</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24, maxWidth: 520 }}>
          <div>
            <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, margin: 0 }}>
              Know where every dollar went.
            </h1>
            <p className="muted" style={{ fontSize: 16, marginTop: 14, lineHeight: 1.5 }}>
              Match foreign payments to invoices, see what fees and FX spreads cost
              you, and chase only what&apos;s actually owed.
            </p>
            <div className="login-features">
              <span className="login-feature">Reads PDFs and phone photos</span>
              <span className="login-feature">Fees and FX, explained</span>
              <span className="login-feature">Chase only what&apos;s owed</span>
            </div>
          </div>
          <SampleReconCard panelRef={panelRef} />
        </div>

        <div className="muted" style={{ fontSize: 12 }}>
          Powered by Meta&apos;s Muse models · Not tax or accounting advice
        </div>
      </div>

      {/* RIGHT — sign-in */}
      <div
        className="login-right"
        style={{
          width: 520,
          flexShrink: 0,
          background: "var(--sidebar)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
        }}
      >
        <div style={{ width: 420, maxWidth: "100%" }}>
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              padding: 32,
            }}
          >
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
              {mode === "signin" ? "Sign in" : "Create your account"}
            </h2>
            <p className="muted" style={{ fontSize: 14, marginTop: 6, marginBottom: 22 }}>
              {mode === "signin"
                ? "Welcome back. Pick up where you left off."
                : "A minute to set up. Then upload and reconcile."}
            </p>

            {googleEnabled && (
              <>
                <button
                  onClick={google}
                  disabled={busy}
                  className="btn"
                  style={{
                    width: "100%",
                    background: "#fff",
                    color: "#1f1f1f",
                    border: "1px solid #dadce0",
                    fontWeight: 500,
                  }}
                >
                  <GoogleIcon />
                  Continue with Google
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    margin: "18px 0",
                  }}
                >
                  <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  <span className="muted" style={{ fontSize: 12 }}>
                    or
                  </span>
                  <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>
              </>
            )}

            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {mode === "signup" && (
                <label style={{ display: "block" }}>
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
                    Your name
                  </div>
                  <input
                    className="input"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}

              <label style={{ display: "block" }}>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
                  Email or username
                </div>
                <input
                  className="input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Password
                  </span>
                  {mode === "signin" && (
                    <span
                      className="link"
                      style={{ fontSize: 12.5 }}
                      onClick={() =>
                        setError("Password reset isn't available in the demo — use Try the demo below.")
                      }
                    >
                      Forgot password?
                    </span>
                  )}
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    className="input"
                    type={show ? "text" : "password"}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{
                      paddingRight: 44,
                      borderColor: error ? "var(--red)" : undefined,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label="Show password"
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      padding: 6,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {show ? <EyeOffIcon style={{ width: 18, height: 18 }} /> : <EyeIcon style={{ width: 18, height: 18 }} />}
                  </button>
                </div>
                {error && (
                  <div className="text-red" style={{ fontSize: 13, marginTop: 8 }}>
                    {error}
                  </div>
                )}
              </div>

              <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%", fontWeight: 600 }}>
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>

            <div className="muted" style={{ fontSize: 13, textAlign: "center", marginTop: 18 }}>
              {mode === "signin" ? "New to PayRecon? " : "Already have an account? "}
              <span
                className="link"
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                }}
              >
                {mode === "signin" ? "Create an account" : "Sign in"}
              </span>
            </div>
          </div>

          {/* Try the demo */}
          <div style={{ marginTop: 24 }}>
            <button
              onClick={demo}
              disabled={busy}
              className="btn btn-demo"
              style={{ width: "100%" }}
            >
              <span className="text-purple" style={{ display: "inline-flex" }}>
                <SparkleIcon style={{ width: 16, height: 16 }} />
              </span>
              Try the demo
            </button>
            <div className="muted" style={{ fontSize: 12.5, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
              Opens a sample workspace with 20 invoices and 21 payments. No sign-up
              needed.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
