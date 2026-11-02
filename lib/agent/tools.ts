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

// ---------------------------------------------------------------------------
// The six tools the agent (Muse Wonder 1.0) may call (PRD §6.2). Every tool is
// real TypeScript over the DB — the only thing that differs between stub and
// live mode is WHO decides the sequence of calls (planner vs the model). The
// agent can only change the board through propose_match / mark_unmatched.
// ---------------------------------------------------------------------------

const num = (v: string | null): number | null => (v == null ? null : Number(v));

export type ToolPayment = {
  id: number;
  valueDate: string | null;
  foreignCurrency: string | null;
  foreignAmount: number | null;
  creditedInr: number | null;
  bankChargesInr: number | null;
  remitterName: string | null;
  reference: string | null;
  channel: string | null;
};

export type ToolInvoice = {
  id: number;
  invoiceNumber: string | null;
  clientName: string | null;
  currency: string | null;
  amount: number | null;
  issueDate: string | null;
  bankChargesTerms: "OUR" | "SHA" | "BEN" | "unknown" | null;
};

function toPayment(p: typeof paymentsT.$inferSelect): ToolPayment {
  return {
    id: p.id,
    valueDate: p.valueDate,
    foreignCurrency: p.foreignCurrency,
    foreignAmount: num(p.foreignAmount),
    creditedInr: num(p.creditedInr),
    bankChargesInr: num(p.bankChargesInr),
    remitterName: p.remitterName,
    reference: p.reference,
    channel: p.channel,
  };
}

function toInvoice(i: typeof invoicesT.$inferSelect): ToolInvoice {
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    clientName: i.clientName,
    currency: i.currency,
    amount: num(i.amount),
    issueDate: i.issueDate,
    bankChargesTerms: i.bankChargesTerms,
  };
}

/** Payments with no match yet — what the deterministic pass left for the agent. */
export async function listUnresolved(): Promise<ToolPayment[]> {
  const [pays, ms] = await Promise.all([
    db.select().from(paymentsT),
    db.select().from(matchesT),
  ]);
  const matched = new Set(ms.map((m) => m.paymentId));
  return pays.filter((p) => !matched.has(p.id)).map(toPayment);
}

export async function getPayment(id: number): Promise<ToolPayment | null> {
  const [p] = await db.select().from(paymentsT).where(eq(paymentsT.id, id)).limit(1);
  return p ? toPayment(p) : null;
}

export async function getInvoiceByNumber(number: string): Promise<ToolInvoice | null> {
  const [i] = await db
    .select()
    .from(invoicesT)
    .where(eq(invoicesT.invoiceNumber, number))
    .limit(1);
  return i ? toInvoice(i) : null;
}

export async function listInvoices(): Promise<ToolInvoice[]> {
  const rows = await db.select().from(invoicesT);
  return rows.map(toInvoice);
}

export { getMidRate as getMidMarketRate };

export type Allocation = { invoice: ToolInvoice; expectedFc: number };

/** Fee thresholds from user settings (default 50 / 3%). */
export type FeeConfig = { feeCapFc?: number; feeSharePct?: number };

/**
 * Compute the gap for a payment against a set of invoice allocations. `expectedFc`
 * is the foreign amount this payment is expected to cover for that invoice — the
 * full invoice amount for a normal/combined match, or an instalment share. The
 * money math itself is done in code (lib/gap.ts), never by the model.
 */
export async function computeGapForMatch(
  payment: ToolPayment,
  allocs: Allocation[],
  fee: FeeConfig = {}
) {
  const currency = payment.foreignCurrency ?? allocs[0]?.invoice.currency;
  if (!currency || !payment.valueDate) throw new Error("Missing currency/date");
  const mid = await getMidRate(payment.valueDate, currency);
  const expectedFc = allocs.reduce((s, a) => s + a.expectedFc, 0);
  const terms = allocs[0]?.invoice.bankChargesTerms ?? "unknown";

  const g = roundBreakdown(
    computeGap({
      invoiceAmountFc: expectedFc,
      foreignAmount: payment.foreignAmount,
      bankChargesInr: payment.bankChargesInr ?? 0,
      creditedInr: payment.creditedInr ?? 0,
      midRate: mid,
      chargesTerms: terms,
      feeCapFc: fee.feeCapFc,
      feeSharePct: fee.feeSharePct,
    })
  );
  return g;
}

export type ProposeArgs = {
  payment: ToolPayment;
  allocs: Allocation[];
  confidence: number;
  rationale: string;
  fee?: FeeConfig;
  autoConfirm?: boolean;
};

/** Persist an agent match: matches (method=agent) + allocations + gap_breakdown. */
export async function proposeMatch(args: ProposeArgs) {
  const { payment, allocs, confidence, rationale, fee = {}, autoConfirm = false } = args;
  const status =
    autoConfirm && confidence >= 0.9 ? "confirmed" : confidence >= 0.85 ? "auto" : "needs_review";

  const [m] = await db
    .insert(matchesT)
    .values({
      paymentId: payment.id,
      score: confidence,
      method: "agent",
      status,
      rationale,
    })
    .returning();

  for (const a of allocs) {
    await db.insert(allocationsT).values({
      matchId: m.id,
      invoiceId: a.invoice.id,
      amountFc: String(a.expectedFc),
    });
  }

  const g = await computeGapForMatch(payment, allocs, fee);
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

  return { matchId: m.id, status, classification: g.classification, gap: g };
}

/** Record that a payment has no matching invoice (domestic, interest, refund). */
export async function markUnmatched(payment: ToolPayment, reason: string) {
  // Unmatched = no match row; we keep the reason only for the activity trace.
  return { paymentId: payment.id, reason };
}
