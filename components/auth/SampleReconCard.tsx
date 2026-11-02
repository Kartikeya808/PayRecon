"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useProximity } from "@/hooks/useProximity";
import { formatMoney } from "@/lib/format";

// A static but delightful illustration of one reconciliation. Numbers are
// hard-coded but internally consistent and all rendered through formatMoney:
//   invoiced EUR 1,850.00 × 1.0800 ref rate = $1,998.00 expected
//   − intermediary EUR 20 ($21.60) − FX spread (1.0650 vs 1.0800, $27.45)
//   − bank charges ($15.00)  =  $1,933.95 received  (96.8% in, 3.2% fees)
const INVOICED_EUR = 1850;
const REF_RATE = 1.08;
const EXPECTED = 1998.0;
const FEES = 64.05;
const RECEIVED = 1933.95;
const RECEIVED_PCT = 96.8;
const FEES_PCT = 3.2;

const breakdown = [
  { label: "Intermediary bank fee", sub: `${formatMoney(20, "EUR")} in transit`, amount: -21.6 },
  { label: "FX spread", sub: "bank 1.0650 vs 1.0800", amount: -27.45 },
  { label: "Bank charges", sub: "on receipt", amount: -15.0 },
];

export function SampleReconCard({ panelRef }: { panelRef: RefObject<HTMLElement | null> }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { expanded } = useProximity(panelRef, cardRef);

  // Count the received figure up once on load (ease-out). The real value is the
  // default so SSR / no-JS / screen readers always have it.
  const [count, setCount] = useState(RECEIVED);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setGrown(true);
      return;
    }
    setGrown(false);
    const grow = requestAnimationFrame(() => setGrown(true));
    setCount(0);
    const t0 = performance.now();
    const dur = 950;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - t0) / dur);
      setCount(RECEIVED * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(grow);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={cardRef}
      className={`sample-card${expanded ? " is-open" : ""}`}
      tabIndex={0}
      role="group"
      aria-label="Sample reconciliation: invoiced EUR 1,850.00, received $1,933.95 of $1,998.00 expected. All normal costs."
    >
      <div className="sample-card__glare" aria-hidden="true" />

      <div className="sample-card__body">
        <div className="sample-head">
          <span className="promo-eyebrow" style={{ margin: 0 }}>
            Sample reconciliation
          </span>
          <span className="sample-hint">Move closer for the breakdown</span>
        </div>

        <div className="sample-id">
          <span className="mono" style={{ fontSize: 13 }}>
            INV-2026-021
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            · Brightfold GmbH
          </span>
          <span className="chip chip-mint" style={{ marginLeft: "auto", fontSize: 11.5 }}>
            Paid with costs
          </span>
        </div>

        <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Invoiced {formatMoney(INVOICED_EUR, "EUR")} · reference rate {REF_RATE.toFixed(4)}
        </div>

        <div className="sample-rows">
          <Row label="Expected" value={formatMoney(EXPECTED)} />
          <Row
            label="Fees and FX spread"
            value={formatMoney(-FEES)}
            valueCls="text-orange"
            chevron
            open={expanded}
          />

          {/* Breakdown — reveals on proximity / focus via grid-template-rows */}
          <div className={`sample-breakdown${expanded ? " is-open" : ""}`}>
            <div className="sample-breakdown__inner">
              {breakdown.map((b) => (
                <div key={b.label} className="sample-subrow">
                  <div>
                    <div style={{ fontSize: 13 }}>{b.label}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {b.sub}
                    </div>
                  </div>
                  <span className="tnum text-orange" style={{ fontSize: 13 }}>
                    {formatMoney(b.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Row
            label="Received"
            value={<span aria-hidden="true">{formatMoney(count)}</span>}
            srValue={formatMoney(RECEIVED)}
            bold
          />
        </div>

        {/* One stacked bar: received (blue) + fees (orange) */}
        <div className="sample-bar" aria-hidden="true">
          <span
            className="sample-bar__seg bar-blue"
            style={{ width: grown ? `${RECEIVED_PCT}%` : "0%" }}
          />
          <span
            className="sample-bar__seg bar-orange"
            style={{ width: grown ? `${FEES_PCT}%` : "0%" }}
          />
        </div>
        <div className="sample-legend" aria-hidden="true">
          <span>
            <i className="dot bar-blue" /> Received {RECEIVED_PCT}%
          </span>
          <span>
            <i className="dot bar-orange" /> Fees {FEES_PCT}%
          </span>
        </div>

        <div className="text-mint" style={{ fontSize: 13, marginTop: 12 }}>
          ✓ All normal costs. Nothing to chase.
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueCls = "",
  bold = false,
  chevron = false,
  open = false,
  srValue,
}: {
  label: string;
  value: React.ReactNode;
  valueCls?: string;
  bold?: boolean;
  chevron?: boolean;
  open?: boolean;
  srValue?: string;
}) {
  return (
    <div className="sample-row">
      <span className="muted" style={{ fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
        {label}
        {chevron && <span className={`sample-chevron${open ? " is-open" : ""}`}>›</span>}
      </span>
      <span className={`tnum ${valueCls}`} style={{ fontWeight: bold ? 700 : 500, fontSize: 14 }}>
        {value}
        {srValue && <span className="sr-only">{srValue}</span>}
      </span>
    </div>
  );
}
