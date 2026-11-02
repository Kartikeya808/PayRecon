import type { ToolInvoice, ToolPayment, Allocation } from "@/lib/agent/tools";

// ---------------------------------------------------------------------------
// The deterministic planner. In STUB mode this stands in for Muse Wonder's
// reasoning: given an unresolved payment and the invoice set, it decides which
// invoice(s) the payment covers and how (normal / combined / instalment /
// none). The same decisions are what the live model is prompted to reach via
// the tools — but here they are reproducible and free.
// ---------------------------------------------------------------------------

export type Plan =
  | {
      kind: "normal" | "combined" | "instalment";
      allocs: Allocation[];
      confidence: number;
      rationale: string;
    }
  | { kind: "unmatched"; reason: string };

const INV_RE = /INV[-\s]?\d{4}[-\s]?\d{2,4}/gi;
const normNum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}
function nameRatio(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Invoices whose number is written in the payment reference. */
function referencedInvoices(ref: string | null, invoices: ToolInvoice[]): ToolInvoice[] {
  if (!ref) return [];
  const hits = ref.match(INV_RE) ?? [];
  const wanted = new Set(hits.map(normNum));
  return invoices.filter((i) => i.invoiceNumber && wanted.has(normNum(i.invoiceNumber)));
}

/** Best remitter+amount match when the reference carries no invoice number. */
function matchByRemitterAmount(p: ToolPayment, invoices: ToolInvoice[]): ToolInvoice | null {
  if (p.foreignAmount == null || !p.remitterName) return null;
  let best: { inv: ToolInvoice; score: number } | null = null;
  for (const i of invoices) {
    if (!i.clientName || i.amount == null) continue;
    if (p.foreignCurrency && i.currency && p.foreignCurrency !== i.currency) continue;
    const ratio = p.foreignAmount / i.amount;
    if (ratio < 0.9 || ratio > 1.005) continue;
    const name = nameRatio(p.remitterName, i.clientName);
    if (name < 0.6) continue;
    const score = name + (1 - Math.abs(1 - ratio));
    if (!best || score > best.score) best = { inv: i, score };
  }
  return best?.inv ?? null;
}

/**
 * Decide what to do with one unresolved payment. `instalmentCounts` maps an
 * invoice number → how many instalment payments reference it, so each payment's
 * expected share is the invoice split evenly across its instalments.
 */
export function planPayment(
  p: ToolPayment,
  invoices: ToolInvoice[],
  instalmentCounts: Map<string, number>
): Plan {
  // No foreign leg at all → a domestic credit, not an inward remittance.
  if (!p.foreignCurrency || p.foreignAmount == null) {
    return {
      kind: "unmatched",
      reason: /interest|savings/i.test(p.remitterName ?? "")
        ? "Domestic savings interest, not a client payment"
        : "Domestic credit, not a foreign remittance",
    };
  }

  const refd = referencedInvoices(p.reference, invoices);
  const isInstalment = /instal?ment/i.test(p.reference ?? "");

  // Instalment: one invoice, this payment covers an even share of it.
  if (isInstalment && refd.length === 1) {
    const inv = refd[0];
    const n = instalmentCounts.get(normNum(inv.invoiceNumber ?? "")) || 1;
    const share = inv.amount != null ? Math.round((inv.amount / n) * 100) / 100 : 0;
    return {
      kind: "instalment",
      allocs: [{ invoice: inv, expectedFc: share }],
      confidence: 0.9,
      rationale: `Instalment payment — one of ${n} for ${inv.invoiceNumber} (${inv.currency} ${share} share)`,
    };
  }

  // Combined: one transfer settling two or more invoices.
  if (refd.length >= 2) {
    return {
      kind: "combined",
      allocs: refd.map((inv) => ({ invoice: inv, expectedFc: inv.amount ?? 0 })),
      confidence: 0.92,
      rationale: `One transfer covers ${refd.length} invoices: ${refd
        .map((i) => i.invoiceNumber)
        .join(", ")}`,
    };
  }

  // Single referenced invoice the rules somehow skipped.
  if (refd.length === 1) {
    const inv = refd[0];
    return {
      kind: "normal",
      allocs: [{ invoice: inv, expectedFc: inv.amount ?? 0 }],
      confidence: 0.9,
      rationale: `Reference names ${inv.invoiceNumber}`,
    };
  }

  // No invoice number in the reference — fall back to remitter + amount.
  const byName = matchByRemitterAmount(p, invoices);
  if (byName) {
    const name = nameRatio(p.remitterName ?? "", byName.clientName ?? "");
    const parent = name < 0.8;
    return {
      kind: "normal",
      allocs: [{ invoice: byName, expectedFc: byName.amount ?? 0 }],
      confidence: parent ? 0.78 : 0.86,
      rationale: parent
        ? `Remitter "${p.remitterName}" looks like the parent company of ${byName.clientName}; amount ${p.foreignCurrency} ${p.foreignAmount} fits ${byName.invoiceNumber}`
        : `No reference, but remitter and amount (${p.foreignCurrency} ${p.foreignAmount}) match ${byName.invoiceNumber}`,
    };
  }

  return { kind: "unmatched", reason: "No invoice matches the remitter or amount" };
}

/** Count instalment payments per invoice across the whole unresolved set. */
export function instalmentCounts(
  payments: ToolPayment[],
  invoices: ToolInvoice[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of payments) {
    if (!/instal?ment/i.test(p.reference ?? "")) continue;
    const refd = referencedInvoices(p.reference, invoices);
    if (refd.length !== 1) continue;
    const key = normNum(refd[0].invoiceNumber ?? "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
