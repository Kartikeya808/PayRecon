import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payments as paymentsT,
  invoices as invoicesT,
  matches as matchesT,
  allocations as allocationsT,
  gapBreakdowns as gapT,
} from "@/db/schema";
import { getMidRate } from "@/lib/fx";
import { computeGap, roundBreakdown } from "@/lib/gap";
import { getSettings } from "@/lib/settings";

// ---- scoring (PRD §6.1, weights sum to 1.0) --------------------------------

export type PaymentRec = {
  id: number;
  remitterName: string | null;
  reference: string | null;
  foreignCurrency: string | null;
  foreignAmount: number | null;
  creditedInr: number | null;
  valueDate: string | null;
  bankChargesInr: number | null;
};

export type InvoiceRec = {
  id: number;
  invoiceNumber: string | null;
  clientName: string | null;
  currency: string | null;
  amount: number | null;
  issueDate: string | null;
  bankChargesTerms: "OUR" | "SHA" | "BEN" | "unknown" | null;
};

const normNum = (s: string) =>
  s.toUpperCase().replace(/INV/g, "").replace(/[^A-Z0-9]/g, "");

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Token-set ratio: shared tokens over the smaller name (0..1). */
function tokenSetRatio(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** How many of the invoice set's numbers appear in a payment reference. */
export function referencedInvoiceCount(ref: string | null, invs: InvoiceRec[]): number {
  if (!ref) return 0;
  const r = normNum(ref);
  return invs.filter((i) => i.invoiceNumber && r.includes(normNum(i.invoiceNumber))).length;
}

export function scorePair(p: PaymentRec, i: InvoiceRec): number {
  let s = 0;
  // Invoice number in reference — 0.35
  if (p.reference && i.invoiceNumber && normNum(p.reference).includes(normNum(i.invoiceNumber)))
    s += 0.35;
  // Remitter ≈ client (token-set ratio ≥ 0.8) — 0.25
  if (p.remitterName && i.clientName && tokenSetRatio(p.remitterName, i.clientName) >= 0.8)
    s += 0.25;
  // Amount fits (foreign 90–100% of invoice) — 0.25
  if (p.foreignAmount != null && i.amount) {
    const ratio = p.foreignAmount / i.amount;
    if (ratio >= 0.9 && ratio <= 1.005) s += 0.25;
  }
  // Currency matches — 0.10
  if (p.foreignCurrency && i.currency && p.foreignCurrency === i.currency) s += 0.1;
  // Date plausible (0–120 days after invoice) — 0.05
  if (p.valueDate && i.issueDate) {
    const d = daysBetween(p.valueDate, i.issueDate);
    if (d >= 0 && d <= 120) s += 0.05;
  }
  return s;
}

export type Assignment = {
  paymentId: number;
  invoiceId: number;
  score: number;
  status: "auto" | "needs_review";
};

/**
 * Greedy highest-score-first 1:1 assignment. Payments whose reference names
 * more than one invoice, or an instalment, are left for the agent (Phase 5).
 * ≥0.85 → auto; 0.60–0.85 with an invoice-number hit → needs_review.
 */
export function assign(payments: PaymentRec[], invoices: InvoiceRec[]): Assignment[] {
  const deferred = new Set(
    payments
      .filter(
        (p) =>
          referencedInvoiceCount(p.reference, invoices) > 1 ||
          /instal?ment/i.test(p.reference ?? "")
      )
      .map((p) => p.id)
  );

  const candidates: (Assignment & { hasNumber: boolean })[] = [];
  for (const p of payments) {
    if (deferred.has(p.id)) continue;
    for (const i of invoices) {
      const score = scorePair(p, i);
      if (score < 0.5) continue;
      const hasNumber =
        !!p.reference && !!i.invoiceNumber && normNum(p.reference).includes(normNum(i.invoiceNumber));
      candidates.push({ paymentId: p.id, invoiceId: i.id, score, hasNumber, status: "auto" });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedP = new Set<number>();
  const usedI = new Set<number>();
  const out: Assignment[] = [];
  for (const c of candidates) {
    if (usedP.has(c.paymentId) || usedI.has(c.invoiceId)) continue;
    let status: Assignment["status"] | null = null;
    if (c.score >= 0.85) status = "auto";
    else if (c.score >= 0.6 && c.hasNumber) status = "needs_review";
    if (!status) continue;
    usedP.add(c.paymentId);
    usedI.add(c.invoiceId);
    out.push({ paymentId: c.paymentId, invoiceId: c.invoiceId, score: c.score, status });
  }
  return out;
}

// ---- persistence -----------------------------------------------------------

const num = (v: string | null): number | null => (v == null ? null : Number(v));

export async function reconcileDeterministic() {
  const settings = await getSettings();
  const pRows = await db.select().from(paymentsT);
  const iRows = await db.select().from(invoicesT);

  const payments: PaymentRec[] = pRows.map((p) => ({
    id: p.id,
    remitterName: p.remitterName,
    reference: p.reference,
    foreignCurrency: p.foreignCurrency,
    foreignAmount: num(p.foreignAmount),
    creditedInr: num(p.creditedInr),
    valueDate: p.valueDate,
    bankChargesInr: num(p.bankChargesInr),
  }));
  const invoices: InvoiceRec[] = iRows.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    clientName: i.clientName,
    currency: i.currency,
    amount: num(i.amount),
    issueDate: i.issueDate,
    bankChargesTerms: i.bankChargesTerms,
  }));

  // Fresh run — clear previous rule matches and their children.
  await db.delete(allocationsT);
  await db.delete(gapT);
  await db.delete(matchesT);

  const assignments = assign(payments, invoices);
  const pById = new Map(payments.map((p) => [p.id, p]));
  const iById = new Map(invoices.map((i) => [i.id, i]));

  let auto = 0;
  let needsReview = 0;

  for (const a of assignments) {
    const p = pById.get(a.paymentId)!;
    const i = iById.get(a.invoiceId)!;

    const [m] = await db
      .insert(matchesT)
      .values({
        paymentId: p.id,
        score: a.score,
        method: "rule",
        status: a.status,
        rationale: `Rule match, score ${a.score.toFixed(2)}`,
      })
      .returning();

    await db.insert(allocationsT).values({
      matchId: m.id,
      invoiceId: i.id,
      amountFc: String(p.foreignAmount ?? i.amount ?? 0),
    });

    if (i.amount != null && p.creditedInr != null && p.valueDate && (p.foreignCurrency || i.currency)) {
      const mid = await getMidRate(p.valueDate, (p.foreignCurrency || i.currency)!);
      const g = roundBreakdown(
        computeGap({
          invoiceAmountFc: i.amount,
          foreignAmount: p.foreignAmount,
          bankChargesInr: p.bankChargesInr ?? 0,
          creditedInr: p.creditedInr,
          midRate: mid,
          chargesTerms: i.bankChargesTerms ?? "unknown",
          feeCapFc: settings.feeAllowanceFc,
          feeSharePct: settings.feeSharePct,
        })
      );
      await db.insert(gapT).values({
        matchId: m.id,
        expectedInr: String(g.expectedInr),
        receivedInr: String(g.receivedInr),
        intermediaryFeeInr: String(g.intermediaryFeeInr),
        fxSpreadInr: String(g.fxSpreadInr),
        bankChargesInr: String(g.bankChargesInr),
        outstandingFc: String(g.outstandingFc),
        recoverableFeeFc: String(g.recoverableFeeFc),
        classification: g.classification,
        midRate: String(g.midRate),
        appliedRate: String(g.appliedRate),
      });
    }

    if (a.status === "auto") auto++;
    else needsReview++;
  }

  return {
    totalPayments: payments.length,
    matched: assignments.length,
    auto,
    needsReview,
    unmatched: payments.length - assignments.length,
  };
}
