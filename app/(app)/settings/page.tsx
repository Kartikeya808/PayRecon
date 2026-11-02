"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Theme = "light" | "dark" | "system";

type Settings = {
  fullName: string;
  businessName: string;
  replyTo: string;
  signAs: string;
  feeAllowanceFc: number;
  feeSharePct: number;
  homeCurrency: string;
  spendingCapUsd: number;
  autoConfirm: boolean;
};

const FALLBACK: Settings = {
  fullName: "Aarav Mehta",
  businessName: "Mehta Design Studio",
  replyTo: "aarav@mehtadesign.example",
  signAs: "Aarav",
  feeAllowanceFc: 50,
  feeSharePct: 3,
  homeCurrency: "INR",
  spendingCapUsd: 100,
  autoConfirm: false,
};

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

export default function SettingsPage() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>("dark");
  const [s, setS] = useState<Settings>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("pma-theme");
    setTheme(stored === "light" ? "light" : "dark");
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: Settings) => setS({ ...FALLBACK, ...data }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  function applyTheme(t: Theme) {
    setTheme(t);
    const resolved =
      t === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : t;
    document.documentElement.setAttribute("data-theme", resolved);
    localStorage.setItem("pma-theme", resolved);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      if (res.ok) {
        setS({ ...FALLBACK, ...(await res.json()) });
        setDirty(false);
        router.refresh(); // update the sidebar spend cap
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Your profile, how PayRecon looks, and how it decides what counts as a
            normal cost.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 760, opacity: loaded ? 1 : 0.6, transition: "opacity .15s" }}>
        {/* Profile */}
        <Section title="Profile">
          <div className="card">
            <Row>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div className="avatar" style={{ width: 56, height: 56, fontSize: 20 }}>
                  {initials(s.fullName)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{s.fullName}</div>
                  <div className="muted" style={{ fontSize: 13.5 }}>
                    {s.replyTo}
                  </div>
                </div>
              </div>
            </Row>
            <InputRow label="Full name" value={s.fullName} onChange={(v) => set("fullName", v)} />
            <InputRow label="Business name" value={s.businessName} onChange={(v) => set("businessName", v)} />
            <InputRow label="Reply-to email" value={s.replyTo} onChange={(v) => set("replyTo", v)} />
            <InputRow label="Sign follow-ups as" value={s.signAs} onChange={(v) => set("signAs", v)} />
          </div>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <div className="card">
            <Row>
              <span>Theme</span>
              <div className="segmented">
                {(["light", "dark", "system"] as Theme[]).map((t) => (
                  <button
                    key={t}
                    className={theme === t ? "active" : ""}
                    onClick={() => applyTheme(t)}
                    style={{ textTransform: "capitalize" }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Row>
          </div>
          <Caption>
            System follows your device setting. The choice applies on every
            screen and is saved in this browser.
          </Caption>
        </Section>

        {/* Reconciliation rules */}
        <Section title="Reconciliation rules">
          <div className="card">
            <Row sub="Per payment, in the invoice currency. Gaps beyond this are flagged as owed.">
              <span>Typical fee allowance</span>
              <input
                className="input tnum"
                value={s.feeAllowanceFc}
                inputMode="decimal"
                style={{ width: 90, textAlign: "right" }}
                onChange={(e) => set("feeAllowanceFc", Number(e.target.value) || 0)}
              />
            </Row>
            <Row sub="Whichever is larger is treated as normal cost.">
              <span>Or up to this share of the invoice</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  className="input tnum"
                  value={s.feeSharePct}
                  inputMode="decimal"
                  style={{ width: 64, textAlign: "right" }}
                  onChange={(e) => set("feeSharePct", Number(e.target.value) || 0)}
                />
                <span className="muted">%</span>
              </div>
            </Row>
            <Row>
              <span>Reference rate</span>
              <select className="select" style={{ width: 280 }} defaultValue="ecb">
                <option value="ecb">ECB reference rate (Frankfurter)</option>
              </select>
            </Row>
            <Row>
              <span>Home currency</span>
              <select
                className="select"
                style={{ width: 200 }}
                value={s.homeCurrency}
                onChange={(e) => set("homeCurrency", e.target.value)}
              >
                <option value="INR">INR · Indian rupee</option>
              </select>
            </Row>
          </div>
          <Caption>
            Changing the allowance re-draws the line between &ldquo;paid with
            costs&rdquo; and &ldquo;partial&rdquo; the next time you reconcile.
          </Caption>
        </Section>

        {/* AI models and budget */}
        <Section title="AI models and budget">
          <div className="card">
            <Row sub="Extraction from PDFs and photos of invoices.">
              <span>Reading documents</span>
              <span className="muted">Muse Spark 1.3</span>
            </Row>
            <Row sub="Matching agent, explanations and follow-ups.">
              <span>Matching agent and writing</span>
              <span className="muted">Muse Wonder 1.0</span>
            </Row>
            <Row sub="Calls stop when the cap is reached. Shown live in the sidebar.">
              <span>Spending cap (USD)</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="muted">$</span>
                <input
                  className="input tnum"
                  value={s.spendingCapUsd}
                  inputMode="decimal"
                  style={{ width: 90, textAlign: "right" }}
                  onChange={(e) => set("spendingCapUsd", Number(e.target.value) || 0)}
                />
              </div>
            </Row>
            <Row sub="Matches at 0.9 confidence or higher skip review. Off means you check every one.">
              <span>Auto-confirm confident agent matches</span>
              <button
                className="switch"
                data-on={s.autoConfirm}
                onClick={() => set("autoConfirm", !s.autoConfirm)}
                aria-label="Auto-confirm"
              />
            </Row>
          </div>
          <Caption>
            PayRecon uses Meta Model API&apos;s standard tier, which does not use your
            documents to train models.
          </Caption>
        </Section>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 14,
            marginTop: 24,
          }}
        >
          <span className="muted" style={{ fontSize: 13 }}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div className="section-heading-sm">{title}</div>
      {children}
    </div>
  );
}

function Row({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 18px",
        borderTop: "1px solid var(--border)",
      }}
      className="settings-row"
    >
      {sub ? (
        <>
          <div>
            <div>{Array.isArray(children) ? children[0] : children}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {sub}
            </div>
          </div>
          <div>{Array.isArray(children) ? children[1] : null}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div className="muted" style={{ fontSize: 12.5, margin: "10px 4px 0" }}>
      {children}
    </div>
  );
}

function InputRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 18px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span className="muted" style={{ fontSize: 14 }}>
        {label}
      </span>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 320 }}
      />
    </div>
  );
}
