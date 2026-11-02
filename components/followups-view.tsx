"use client";

import { useState } from "react";
import { SparkleIcon } from "@/components/icons";
import type { FollowupRow } from "@/lib/queries";

export function FollowupsView({ items }: { items: FollowupRow[] }) {
  const [list, setList] = useState(items);
  const [selected, setSelected] = useState(items[0]?.id ?? "");
  const [tone, setTone] = useState<"friendly" | "firm">("friendly");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const active = list.find((f) => f.id === selected);

  if (!active) {
    return (
      <div className="card card-pad">
        <p className="muted" style={{ margin: 0, textAlign: "center", padding: "24px 0" }}>
          No follow-ups needed — every matched payment is settled. Run reconciliation on the
          Board to draft follow-ups for partial payments and recoverable fees.
        </p>
      </div>
    );
  }

  const update = (patch: Partial<FollowupRow>) =>
    setList((l) => l.map((f) => (f.id === active.id ? { ...f, ...patch } : f)));

  const regenerate = async (nextTone: "friendly" | "firm") => {
    setTone(nextTone);
    setBusy(true);
    try {
      const res = await fetch(`/api/followups/${active.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate", tone: nextTone }),
      });
      if (res.ok) {
        const d = await res.json();
        update({ subject: d.subject, body: d.body });
      }
    } finally {
      setBusy(false);
    }
  };

  const markSent = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/followups/${active.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sent" }),
      });
      if (res.ok) update({ status: "sent" });
    } finally {
      setBusy(false);
    }
  };

  const copyEmail = async () => {
    await navigator.clipboard.writeText(`Subject: ${active.subject}\n\n${active.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24 }}>
      {/* list */}
      <div className="card" style={{ alignSelf: "start" }}>
        {list.map((f, i) => (
          <button
            key={f.id}
            onClick={() => setSelected(f.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: f.id === selected ? "var(--nav-selected)" : "transparent",
              border: "none",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              padding: "16px 18px",
              cursor: "pointer",
              color: "inherit",
              borderRadius:
                i === 0 ? "14px 14px 0 0" : i === list.length - 1 ? "0 0 14px 14px" : 0,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontWeight: 600 }}>{f.client}</span>
              <span className={`tnum ${f.amountCls}`} style={{ fontWeight: 600 }}>
                {f.amount}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span className="mono muted" style={{ fontSize: 12.5 }}>
                {f.invoice}
              </span>
              <span className={`chip ${f.chip.cls}`} style={{ fontSize: 11.5 }}>
                {f.chip.label}
              </span>
              {f.status === "sent" && (
                <span className="chip chip-green" style={{ fontSize: 11.5 }}>
                  Sent
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* editor */}
      <div className="card card-pad">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <h2 className="section-heading" style={{ margin: 0 }}>
            Email to {active.client}
          </h2>
          <div className="segmented">
            <button
              className={tone === "friendly" ? "active" : ""}
              onClick={() => regenerate("friendly")}
              disabled={busy}
            >
              Friendly
            </button>
            <button
              className={tone === "firm" ? "active" : ""}
              onClick={() => regenerate("firm")}
              disabled={busy}
            >
              Firm
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="To">
            <input className="input" defaultValue={active.to} key={active.id + "to"} />
          </Field>
          <Field label="Subject">
            <input className="input" value={active.subject} onChange={(e) => update({ subject: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea
              className="textarea"
              rows={12}
              value={active.body}
              onChange={(e) => update({ body: e.target.value })}
            />
          </Field>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <span className="sparkle">
            <SparkleIcon />
          </span>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Drafted by Muse Wonder 1.0 · amounts come from the reconciliation, not the model
          </span>
        </div>

        <div
          className="hairline"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 18,
            paddingTop: 16,
          }}
        >
          <button className="btn btn-link" onClick={markSent} disabled={busy || active.status === "sent"}>
            {active.status === "sent" ? "Marked as sent" : "Mark as sent"}
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => regenerate(tone)} disabled={busy}>
              {busy ? "Working…" : "Regenerate"}
            </button>
            <button className="btn btn-primary" onClick={copyEmail}>
              {copied ? "Copied!" : "Copy email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </label>
  );
}
