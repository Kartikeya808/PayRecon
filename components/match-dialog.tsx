"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ExpandIcon,
  CollapseIcon,
  CloseIcon,
  CheckIcon,
  MailIcon,
  AlertIcon,
  SparkleIcon,
} from "./icons";
import type { MatchDetail } from "@/lib/demo-data";

function Waterfall({ m }: { m: MatchDetail }) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h3 className="section-heading" style={{ margin: 0 }}>
          Where the money went
        </h3>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {m.scaleNote}
        </span>
      </div>
      <div style={{ marginTop: 8 }}>
        {m.waterfall.map((w, i) => (
          <div
            key={i}
            className="waterfall-row"
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
          >
            <div
              style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{w.label}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {w.sub}
                </div>
              </div>
              <div
                className={`tnum ${w.amountCls ?? ""}`}
                style={{ fontWeight: 600, whiteSpace: "nowrap" }}
              >
                {w.amount}
              </div>
            </div>
            <div className="waterfall-track">
              <div
                className={`waterfall-bar ${w.bar}`}
                style={{ width: `${w.width}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {m.gapCaption && (
        <div
          className="muted"
          style={{ fontSize: 13, marginTop: 10, textAlign: "right" }}
        >
          {m.gapCaption}
        </div>
      )}
    </div>
  );
}

function PlainWords({ m }: { m: MatchDetail }) {
  return (
    <div>
      <h3 className="section-heading">In plain words</h3>
      <p style={{ margin: 0, lineHeight: 1.65 }}>{m.plainWords}</p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 10,
        }}
      >
        <span className="sparkle">
          <SparkleIcon />
        </span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Written by Muse Wonder 1.0 · every number checked against the computed
          breakdown
        </span>
      </div>
    </div>
  );
}

function Evidence({ m }: { m: MatchDetail }) {
  return (
    <div>
      <h3 className="section-heading">Evidence</h3>
      <div className="inset-group">
        <div
          className="mono"
          style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 10 }}
        >
          {m.evidenceLine}
        </div>
        {m.evidence.map((e) => (
          <div key={e.k} className="kv-row">
            <span className="k">{e.k}</span>
            <span className="tnum">{e.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RateDetails({ m }: { m: MatchDetail }) {
  return (
    <div>
      <h3 className="section-heading">Rate details</h3>
      <div className="inset-group">
        {m.rateDetails.map((r) => (
          <div key={r.k} className="kv-row">
            <span className="k">{r.k}</span>
            <span className={`tnum ${r.cls ?? ""}`}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MatchDialog({
  match,
  onClose,
}: {
  match: MatchDetail;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const PrimaryIcon = match.footer.primaryIcon === "mail" ? MailIcon : CheckIcon;

  async function act(action: "confirm" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/matches/${match.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        onClose();
        router.refresh(); // re-render the board with the new state
      }
    } finally {
      setBusy(false);
    }
  }

  // Primary button: a "mail" icon means "Draft follow-up" (go to the drafts),
  // otherwise it confirms the match.
  const onPrimary =
    match.footer.primaryIcon === "mail"
      ? () => router.push("/followups")
      : () => act("confirm");

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className={`dialog${expanded ? " expanded" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            padding: "22px 24px 18px",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}
            >
              <span className={`chip ${match.statusChip}`}>
                {match.statusLabel}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>
                {match.method}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
                {match.client}
              </h2>
              <span className="mono muted" style={{ fontSize: 14 }}>
                {match.invoice}
              </span>
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "0 24px 8px" }}>
          {match.callout && (
            <div className="callout callout-orange" style={{ marginBottom: 20 }}>
              <span className="text-orange" style={{ marginTop: 1 }}>
                <AlertIcon style={{ width: 20, height: 20 }} />
              </span>
              <div>
                <div
                  className="text-orange"
                  style={{ fontSize: 18, fontWeight: 700 }}
                >
                  {match.callout.big}
                </div>
                <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
                  {match.callout.sub}
                </div>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <div className="muted" style={{ fontSize: 13 }}>
              {match.receivedOn}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="tnum" style={{ fontSize: 30, fontWeight: 700 }}>
                {match.received}
              </span>
              <span className="muted tnum" style={{ fontSize: 15 }}>
                {match.expected}
              </span>
            </div>
            {match.checkLine && (
              <div
                className="text-mint"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 14,
                  marginTop: 6,
                }}
              >
                <CheckIcon style={{ width: 16, height: 16 }} />
                {match.checkLine}
              </div>
            )}
          </div>

          {expanded ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
              <Waterfall m={match} />
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <PlainWords m={match} />
                <Evidence m={match} />
                <RateDetails m={match} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <Waterfall m={match} />
              <PlainWords m={match} />
              <Evidence m={match} />
              <button
                className="link"
                onClick={() => setExpanded(true)}
                style={{ fontSize: 14, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
              >
                Show rate details ›
              </button>
            </div>
          )}
        </div>

        {/* footer */}
        <div
          className="hairline"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            marginTop: 16,
          }}
        >
          <button className="btn btn-danger-text" onClick={() => act("reject")} disabled={busy}>
            {match.footer.reject}
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" onClick={onPrimary} disabled={busy}>
              <PrimaryIcon />
              {busy ? "Working…" : match.footer.primary}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
