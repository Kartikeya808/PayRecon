import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payments as paymentsT,
  invoices as invoicesT,
  matches as matchesT,
  allocations as allocationsT,
  gapBreakdowns as gapT,
  followups as followupsT,
} from "@/db/schema";
import { complete, MODELS } from "@/lib/llm";
import { getSettings } from "@/lib/settings";
import { inr } from "@/lib/format";

// ---------------------------------------------------------------------------
// Plain-language explanations and follow-up drafts (PRD §6.4). Every number in
// model-written prose must already appear in the computed breakdown — the
// number validator enforces this and we regenerate (or fall back to the
// deterministic template) if the model invents a figure.
// ---------------------------------------------------------------------------

const fc = (ccy: string, n: number) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Every numeric value a model is allowed to mention for this match. */
function allowedNumbers(nums: number[]): Set<string> {
  const out = new Set<string>();
  for (const n of nums) {
    if (!Number.isFinite(n)) continue;
    out.add((Math.round(n * 100) / 100).toFixed(2));
    out.add(String(Math.round(n)));
    out.add((Math.round(n * 100) / 100).toString());
  }
  return out;
}

/** True if every number in `text` is in the allowed set (± rounding). */
export function validateNumbers(text: string, allowed: Set<string>): { ok: boolean; bad: string[] } {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const bad: string[] = [];
  for (const raw of found) {
    const clean = raw.replace(/,/g, "");
    const val = Number(clean);
    if (!Number.isFinite(val)) continue;
    if (val < 10) continue; // ignore small ordinals ("one of 2", dates handled by context)
    const keys = [clean, Number(clean).toFixed(2), String(Math.round(val))];
    if (!keys.some((k) => allowed.has(k))) bad.push(raw);
  }
  return { ok: bad.length === 0, bad };
}

export type MatchFacts = {
  client: string;
  invoiceNumbers: string[];
  currency: string;
  invoiceFc: number; // expected foreign total
  receivedFc: number | null;
  outstandingFc: number;
  recoverableFeeFc: number;
  intermediaryFeeFc: number;
  midRate: number;
  appliedRate: number;
  classification: string;
  expectedInr: number;
  receivedInr: number;
  totalShortfallInr: number;
};

/** The deterministic explanation — always numerically correct; the fallback. */
export function templateExplanation(f: MatchFacts): string {
  const invs = f.invoiceNumbers.join(" and ");
  if (f.classification === "partial") {
    return `${f.client}'s transfer reached you as ${fc(f.currency, f.receivedFc ?? 0)}, short of the ${fc(f.currency, f.invoiceFc)} on ${invs}. Typical bank fees explain only part of the gap, so about ${fc(f.currency, f.outstandingFc)} looks unpaid rather than lost in transit. Your bank converted at ${f.appliedRate.toFixed(2)} against the reference rate of ${f.midRate.toFixed(2)}, leaving ${inr(f.receivedInr)} credited.`;
  }
  const recov =
    f.recoverableFeeFc > 0
      ? ` The invoice was marked "charges for sender", so the ${fc(f.currency, f.recoverableFeeFc)} in intermediary fees is recoverable from the client.`
      : " After normal bank costs, nothing is owed by the client.";
  return `${f.client} paid ${invs} in full. ${fc(f.currency, f.intermediaryFeeFc)} was deducted by an intermediary bank in transit, and your bank converted at ${f.appliedRate.toFixed(2)} against the reference rate of ${f.midRate.toFixed(2)}. After bank charges, ${inr(f.receivedInr)} was credited.${recov}`;
}

/**
 * Plain-words explanation. Stub mode returns the deterministic template. Live
 * mode asks Wonder to phrase it, validates every number against the breakdown,
 * and falls back to the template if validation fails (one regenerate attempt).
 */
export async function explain(f: MatchFacts): Promise<string> {
  const template = templateExplanation(f);
  if ((process.env.LLM_MODE ?? "stub") === "stub") return template;

  const allowed = allowedNumbers([
    f.invoiceFc,
    f.receivedFc ?? 0,
    f.outstandingFc,
    f.recoverableFeeFc,
    f.intermediaryFeeFc,
    f.midRate,
    f.appliedRate,
    f.expectedInr,
    f.receivedInr,
    f.totalShortfallInr,
  ]);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await complete({
      model: MODELS.wonder,
      purpose: "explain",
      temperature: attempt === 0 ? 0.3 : 0,
      messages: [
        {
          role: "system",
          content:
            "You explain a reconciled payment to a freelancer in two or three plain sentences. Use ONLY the numbers given — never introduce a figure that is not in the data. No markdown.",
        },
        { role: "user", content: JSON.stringify(f) },
      ],
    });
    const { ok } = validateNumbers(res.content, allowed);
    if (ok && res.content.trim()) return res.content.trim();
  }
  return template; // model kept inventing numbers — use the trusted template.
}

// ---- Follow-up drafts ------------------------------------------------------

export type FollowupKind = "partial" | "recoverable";

function followupBody(
  kind: FollowupKind,
  tone: "friendly" | "firm",
  o: {
    client: string;
    invoice: string;
    currency: string;
    amount: number;
    invoiceFc: number;
    receivedFc: number;
    signAs?: string;
  }
): { subject: string; body: string } {
  const amt = fc(o.currency, o.amount);
  const subject =
    kind === "partial"
      ? `${o.invoice}: remaining balance of ${amt}`
      : `${o.invoice}: recoverable bank fee of ${amt}`;

  const greeting = `Hi ${o.client.split(/\s|,/)[0] || "there"},`;
  const sign = `Thanks,\n${o.signAs || "Aarav"}`;

  if (kind === "partial") {
    const body =
      tone === "friendly"
        ? `${greeting}\n\nThanks for your payment against invoice ${o.invoice}. The invoice was for ${fc(o.currency, o.invoiceFc)} and we received ${fc(o.currency, o.receivedFc)}, which leaves ${amt} outstanding after typical bank fees.\n\nCould you arrange the remaining balance to the account details below?\n[Payment details]\n\n${sign}`
        : `${greeting}\n\nOur records show invoice ${o.invoice} for ${fc(o.currency, o.invoiceFc)} is not yet fully settled. We received ${fc(o.currency, o.receivedFc)}; ${amt} remains outstanding after accounting for normal bank fees.\n\nPlease arrange the remaining balance at your earliest convenience.\n[Payment details]\n\n${sign}`;
    return { subject, body };
  }

  const body =
    tone === "friendly"
      ? `${greeting}\n\nYour invoice ${o.invoice} was marked "charges for sender" (OUR), but ${amt} in intermediary bank fees was deducted in transit. Could you reimburse this amount to the account details below?\n[Payment details]\n\n${sign}`
      : `${greeting}\n\nInvoice ${o.invoice} was issued on OUR terms, meaning sender-side bank fees are your responsibility. ${amt} was deducted in transit and is recoverable. Please arrange reimbursement to the account details below.\n[Payment details]\n\n${sign}`;
  return { subject, body };
}

/**
 * Rebuild the follow-up drafts from the current reconciliation: one per partial
 * (balance owed) and one per OUR invoice with a recoverable intermediary fee.
 * Amounts come straight from gap_breakdowns — the model never sets them.
 */
export async function generateFollowups(): Promise<number> {
  const [ms, gaps, allocs, invs, pays] = await Promise.all([
    db.select().from(matchesT),
    db.select().from(gapT),
    db.select().from(allocationsT),
    db.select().from(invoicesT),
    db.select().from(paymentsT),
  ]);

  const invById = new Map(invs.map((i) => [i.id, i]));
  const payById = new Map(pays.map((p) => [p.id, p]));
  const gapByMatch = new Map(gaps.map((g) => [g.matchId, g]));
  const allocByMatch = new Map<number, typeof allocs>();
  for (const a of allocs) {
    if (a.matchId == null) continue;
    const l = allocByMatch.get(a.matchId) ?? [];
    l.push(a);
    allocByMatch.set(a.matchId, l);
  }

  const settings = await getSettings();
  await db.delete(followupsT);

  // Aggregate by invoice so split instalments don't produce duplicate drafts;
  // recoverable fees across instalments of one invoice sum into a single ask.
  type Draft = {
    kind: FollowupKind;
    invoiceId: number;
    client: string;
    invoice: string;
    currency: string;
    amount: number;
    invoiceFc: number;
    receivedFc: number;
  };
  const byInvoice = new Map<number, Draft>();

  for (const m of ms) {
    const g = gapByMatch.get(m.id);
    if (!g) continue;
    const myAllocs = allocByMatch.get(m.id) ?? [];
    const firstInv = myAllocs[0] ? invById.get(myAllocs[0].invoiceId!) : undefined;
    const p = m.paymentId != null ? payById.get(m.paymentId) : undefined;
    if (!firstInv) continue;

    const currency = firstInv.currency ?? p?.foreignCurrency ?? "USD";
    const outstanding = Number(g.outstandingFc ?? 0);
    const recoverable = Number(g.recoverableFeeFc ?? 0);
    const base = {
      invoiceId: firstInv.id,
      client: firstInv.clientName ?? "there",
      invoice: firstInv.invoiceNumber ?? "",
      currency,
      invoiceFc: Number(firstInv.amount ?? 0),
      receivedFc: Number(p?.foreignAmount ?? 0),
    };

    if (g.classification === "partial" && outstanding > 0.005) {
      byInvoice.set(firstInv.id, { ...base, kind: "partial", amount: outstanding });
    } else if (firstInv.bankChargesTerms === "OUR" && recoverable > 0.005) {
      const existing = byInvoice.get(firstInv.id);
      // A partial ask already wins; otherwise sum recoverable fees per invoice.
      if (existing?.kind === "partial") continue;
      byInvoice.set(firstInv.id, {
        ...base,
        kind: "recoverable",
        amount: (existing?.kind === "recoverable" ? existing.amount : 0) + recoverable,
      });
    }
  }

  for (const d of byInvoice.values()) {
    const { subject, body } = followupBody(d.kind, "friendly", { ...d, signAs: settings.signAs });
    await db.insert(followupsT).values({
      invoiceId: d.invoiceId,
      tone: "friendly",
      subject,
      body,
      status: "draft",
    });
  }

  return byInvoice.size;
}

/** Regenerate a single follow-up body in the requested tone (for the editor). */
export async function draftFollowup(
  invoiceId: number,
  tone: "friendly" | "firm"
): Promise<{ subject: string; body: string } | null> {
  const [inv] = await db.select().from(invoicesT).where(eq(invoicesT.id, invoiceId)).limit(1);
  if (!inv) return null;

  // Find the gap for this invoice via its allocation → match.
  const allocs = await db.select().from(allocationsT).where(eq(allocationsT.invoiceId, invoiceId));
  const alloc = allocs[0];
  if (!alloc?.matchId) return null;
  const [g] = await db.select().from(gapT).where(eq(gapT.matchId, alloc.matchId)).limit(1);
  if (!g) return null;
  const [m] = await db.select().from(matchesT).where(eq(matchesT.id, alloc.matchId)).limit(1);
  const p = m?.paymentId != null
    ? (await db.select().from(paymentsT).where(eq(paymentsT.id, m.paymentId)).limit(1))[0]
    : undefined;

  const outstanding = Number(g.outstandingFc ?? 0);
  const recoverable = Number(g.recoverableFeeFc ?? 0);
  const kind: FollowupKind = g.classification === "partial" ? "partial" : "recoverable";
  const settings = await getSettings();
  return followupBody(kind, tone, {
    client: inv.clientName ?? "there",
    invoice: inv.invoiceNumber ?? "",
    currency: inv.currency ?? p?.foreignCurrency ?? "USD",
    amount: kind === "partial" ? outstanding : recoverable,
    invoiceFc: Number(inv.amount ?? 0),
    receivedFc: Number(p?.foreignAmount ?? 0),
    signAs: settings.signAs,
  });
}
