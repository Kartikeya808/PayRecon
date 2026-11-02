import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payments as paymentsT,
  invoices as invoicesT,
  matches as matchesT,
  allocations as allocationsT,
  gapBreakdowns as gapT,
} from "@/db/schema";
import { inr } from "@/lib/format";
import { explain, type MatchFacts } from "@/lib/explain";
import type { MatchDetail, WaterfallLine } from "@/lib/demo-data";

const fc = (ccy: string, n: number) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CHIP: Record<string, { chip: string; label: string }> = {
  fully_paid: { chip: "chip-green", label: "Fully paid" },
  paid_with_costs: { chip: "chip-mint", label: "Paid with costs" },
  partial: { chip: "chip-orange", label: "Partial" },
  needs_review: { chip: "chip-purple", label: "Needs review" },
  unmatched: { chip: "chip-red", label: "Unmatched" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function longDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1] ?? ""} ${y}`;
}

/**
 * Pre-generate and store explanations for every match that lacks one, so the
 * dialog opens from a DB read. Called at the end of reconcile. Bounded
 * concurrency keeps it inside the function timeout; any match not warmed in
 * time simply generates on first open (and caches then). Errors are swallowed —
 * warming is best-effort and must never fail the reconcile.
 */
export async function warmMatchExplanations(concurrency = 5): Promise<void> {
  const rows = await db
    .select({ id: matchesT.id })
    .from(matchesT)
    .where(sql`${matchesT.explanation} is null`);
  const ids = rows.map((r) => r.id);
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        await getMatchDetail(id); // generates + writes back the explanation
      } catch {
        /* best-effort */
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

/** Build the full dialog detail for a match id, straight from the DB + gap math. */
export async function getMatchDetail(matchId: number): Promise<MatchDetail | null> {
  // Wave 1 — match, gap and allocations are all keyed by matchId (known up
  // front), so fetch them together instead of in sequence.
  const [[m], [g], allocs] = await Promise.all([
    db.select().from(matchesT).where(eq(matchesT.id, matchId)).limit(1),
    db.select().from(gapT).where(eq(gapT.matchId, matchId)).limit(1),
    db.select().from(allocationsT).where(eq(allocationsT.matchId, matchId)),
  ]);
  if (!m || !g) return null;

  // Wave 2 — payment (needs m.paymentId) and invoices (need allocation ids),
  // batched and run together.
  const invIds = allocs.map((a) => a.invoiceId).filter((x): x is number => x != null);
  const [pRows, invsRaw] = await Promise.all([
    m.paymentId != null
      ? db.select().from(paymentsT).where(eq(paymentsT.id, m.paymentId)).limit(1)
      : Promise.resolve([]),
    invIds.length
      ? db.select().from(invoicesT).where(inArray(invoicesT.id, invIds))
      : Promise.resolve([]),
  ]);
  const p = pRows[0];
  const invs = invsRaw.sort((a, b) =>
    (a.invoiceNumber ?? "").localeCompare(b.invoiceNumber ?? "")
  );
  if (!p || invs.length === 0) return null;

  const currency = p.foreignCurrency ?? invs[0].currency ?? "USD";
  const expectedInr = Number(g.expectedInr);
  const receivedInr = Number(g.receivedInr);
  const intermediaryFeeInr = Number(g.intermediaryFeeInr);
  const fxSpreadInr = Number(g.fxSpreadInr);
  const bankChargesInr = Number(g.bankChargesInr);
  const totalShortfallInr = expectedInr - receivedInr;
  const outstandingFc = Number(g.outstandingFc ?? 0);
  const recoverableFeeFc = Number(g.recoverableFeeFc ?? 0);
  const midRate = Number(g.midRate);
  const appliedRate = Number(g.appliedRate);
  const classification = g.classification ?? "paid_with_costs";
  const invoiceFc = invs.reduce((s, i) => s + Number(i.amount ?? 0), 0);
  // Expected foreign amount is the authoritative figure gap.ts used as A
  // (expectedInr / mid) — not the stored allocation, which may hold the
  // received amount for rule-matched partials.
  const expectedFc = midRate
    ? Math.round((expectedInr / midRate) * 100) / 100
    : invoiceFc;
  const receivedFc = p.foreignAmount != null ? Number(p.foreignAmount) : null;
  const intermediaryFeeFc = midRate ? Math.round((intermediaryFeeInr / midRate) * 100) / 100 : 0;

  // Mirror the board's status precedence (lib/queries) so the dialog chip
  // matches the row the user clicked: partial wins, else a needs_review match
  // shows "Needs review", else the gap classification.
  const chipKey =
    classification === "partial"
      ? "partial"
      : m.status === "needs_review"
      ? "needs_review"
      : classification;
  const chip = CHIP[chipKey] ?? CHIP.paid_with_costs;
  const invoiceLabel = invs.map((i) => i.invoiceNumber).join(" + ");
  const clientLabel = invs[0].clientName ?? p.remitterName ?? "—";
  const methodLabel = `${m.method === "agent" ? "Agent" : m.method === "manual" ? "Manual" : "Rule"} match · score ${(m.score ?? 0).toFixed(2)} · ${p.channel ?? "Other"}`;

  // Waterfall — honest amounts, widths scaled for readability only.
  const maxCost = Math.max(intermediaryFeeInr, fxSpreadInr, bankChargesInr, 1);
  const costWidth = (n: number) => Math.max(3, Math.round((n / maxCost) * 40));
  const w: WaterfallLine[] = [
    {
      label: "Expected at reference rate",
      sub: `${fc(currency, expectedFc)} × ${midRate.toFixed(2)}`,
      amount: inr(expectedInr),
      bar: "bar-gray",
      width: 100,
    },
  ];
  if (classification === "partial") {
    w.push({
      label: "Not received",
      sub: `${fc(currency, expectedFc - (receivedFc ?? 0))}: about ${fc(currency, outstandingFc)} owed + typical fees`,
      amount: "−" + inr(intermediaryFeeInr),
      amountCls: "text-red",
      bar: "bar-red",
      width: 100,
    });
  } else if (intermediaryFeeInr > 0.005) {
    w.push({
      label: "Intermediary bank fee",
      sub: `${fc(currency, intermediaryFeeFc)} deducted in transit`,
      amount: "−" + inr(intermediaryFeeInr),
      amountCls: "text-orange",
      bar: "bar-orange",
      width: costWidth(intermediaryFeeInr),
    });
  }
  w.push({
    label: "FX spread",
    sub: `Bank rate ${appliedRate.toFixed(2)} vs ${midRate.toFixed(2)}`,
    amount: "−" + inr(fxSpreadInr),
    amountCls: "text-orange",
    bar: "bar-orange",
    width: costWidth(fxSpreadInr),
  });
  w.push({
    label: "Bank charges + GST",
    sub: "Charged by your bank on receipt",
    amount: "−" + inr(bankChargesInr),
    amountCls: "text-orange",
    bar: "bar-orange",
    width: costWidth(bankChargesInr),
  });
  w.push({
    label: "Received",
    sub: `Credited ${longDate(p.valueDate)}`,
    amount: inr(receivedInr),
    bar: "bar-blue",
    width: Math.round((receivedInr / expectedInr) * 100),
  });

  const facts: MatchFacts = {
    client: clientLabel,
    invoiceNumbers: invs.map((i) => i.invoiceNumber ?? ""),
    currency,
    invoiceFc: expectedFc,
    receivedFc,
    outstandingFc,
    recoverableFeeFc,
    intermediaryFeeFc,
    midRate,
    appliedRate,
    classification,
    expectedInr,
    receivedInr,
    totalShortfallInr,
  };
  // Use the cached explanation if we have one; otherwise generate it once and
  // write it back so this match's dialog opens instantly from here on.
  let plainWords = m.explanation ?? "";
  if (!plainWords) {
    plainWords = await explain(facts);
    await db.update(matchesT).set({ explanation: plainWords }).where(eq(matchesT.id, matchId));
  }

  const markupPct = midRate ? ((midRate - appliedRate) / midRate) * 100 : 0;

  const detail: MatchDetail = {
    id: String(matchId),
    statusChip: chip.chip,
    statusLabel: chip.label,
    method: methodLabel,
    client: clientLabel,
    invoice: invoiceLabel,
    callout:
      classification === "partial"
        ? {
            big: `${fc(currency, outstandingFc)} likely still owed`,
            sub: `Only ${fc(currency, receivedFc ?? 0)} arrived for a ${fc(currency, expectedFc)} invoice. Normal fees explain the rest of the gap.`,
          }
        : recoverableFeeFc > 0
        ? {
            big: `${fc(currency, recoverableFeeFc)} recoverable fee`,
            sub: `Invoice is on OUR terms, so the intermediary fee can be billed back to the client.`,
          }
        : undefined,
    receivedOn: `Received on ${longDate(p.valueDate)}`,
    received: inr(receivedInr),
    expected: `of ${inr(expectedInr)} expected`,
    checkLine:
      classification === "fully_paid" || classification === "paid_with_costs"
        ? `The ${inr(totalShortfallInr)} gap is all normal costs. Nothing to chase.`
        : undefined,
    scaleNote: "",
    waterfall: w,
    gapCaption: classification === "partial" ? `Total gap ${inr(totalShortfallInr)}` : undefined,
    plainWords,
    evidenceLine: `${longDate(p.valueDate).toUpperCase()} · INWARD REMIT · ${(p.remitterName ?? "").toUpperCase()} · ${receivedFc != null ? fc(currency, receivedFc) : "—"} @ ${appliedRate.toFixed(2)} · REF ${p.reference ?? "—"}`,
    evidence: [
      { k: "Invoice", v: invoiceLabel },
      { k: "Issued", v: longDate(invs[0].issueDate) },
      { k: "Amount", v: fc(currency, invoiceFc) },
      { k: "Charges terms", v: invs[0].bankChargesTerms === "OUR" ? "OUR, sender pays" : invs[0].bankChargesTerms === "BEN" ? "BEN, receiver pays" : "SHA, shared" },
    ],
    rateDetails: [
      { k: "Value date", v: longDate(p.valueDate) },
      { k: "Reference rate", v: midRate.toFixed(2) },
      { k: "Your bank's rate", v: appliedRate.toFixed(2) },
      { k: "Markup on the rate", v: `${markupPct.toFixed(2)}%`, cls: "text-orange" },
      { k: "Arrived in " + currency, v: receivedFc != null ? fc(currency, receivedFc) : "—" },
    ],
    footer:
      classification === "partial"
        ? { reject: "Reject match", secondary: "Mark as settled", primary: "Draft follow-up", primaryIcon: "mail" }
        : { reject: "Reject match", secondary: "Reassign", primary: "Confirm match", primaryIcon: "check" },
  };

  return detail;
}
