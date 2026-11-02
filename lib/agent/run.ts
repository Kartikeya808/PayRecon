import { reconcileDeterministic } from "@/lib/match";
import * as tools from "@/lib/agent/tools";
import { planPayment, instalmentCounts, type Plan } from "@/lib/agent/planner";
import { getSettings } from "@/lib/settings";
import { inr } from "@/lib/format";

// ---------------------------------------------------------------------------
// The agent run, as an async generator of events the SSE route streams out.
// It runs the deterministic pass first (instant, no model), then walks the
// unresolved payments through the six tools. Decisions are made in code
// (planner) so the money math and matches are reproducible — the golden rule:
// the model never computes a number or silently changes a match.
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: "status"; phase: "deterministic" | "agent" | "complete"; text: string }
  | { type: "step"; tool: string; text: string; dot: string; time: string }
  | {
      type: "done";
      stats: { matched: number; auto: number; needsReview: number; unmatched: number };
    };

const DOT = {
  neutral: "var(--text-secondary)",
  green: "var(--green)",
  purple: "var(--purple)",
  red: "var(--red)",
  orange: "var(--orange)",
} as const;

function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}

function step(tool: string, text: string, dot: string): AgentEvent {
  return { type: "step", tool, text, dot, time: clock() };
}

const ccy = (c: string | null, n: number | null) =>
  c && n != null ? `${c} ${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—";

export async function* runAgent(): AsyncGenerator<AgentEvent> {
  // 1. Deterministic pass — rules match the easy majority, no model calls.
  yield { type: "status", phase: "deterministic", text: "Matching by rules…" };
  const det = await reconcileDeterministic();
  yield step(
    "reconcile_rules()",
    `${det.matched} of ${det.totalPayments} matched by rules · ${det.unmatched} left for the agent`,
    DOT.neutral
  );

  // 2. Agent pass over what's left.
  yield { type: "status", phase: "agent", text: "Agent resolving the hard cases…" };
  const settings = await getSettings();
  const fee = { feeCapFc: settings.feeAllowanceFc, feeSharePct: settings.feeSharePct };
  const unresolved = await tools.listUnresolved();
  const invoices = await tools.listInvoices();
  yield step(
    "list_unresolved()",
    `${unresolved.length} payment${unresolved.length === 1 ? "" : "s"} need a closer look`,
    DOT.neutral
  );

  const counts = instalmentCounts(unresolved, invoices);
  const ordered = [...unresolved].sort((a, b) =>
    (b.valueDate ?? "").localeCompare(a.valueDate ?? "")
  );

  let auto = det.auto;
  let needsReview = det.needsReview;
  let agentMatched = 0;
  let unmatched = 0;

  // Guardrail: the agent resolves at most this many payments (one "tool turn"
  // per payment). A runaway can't loop forever; remaining items stay unmatched
  // for human review. Today ~9 reach the agent, well under the cap.
  const MAX_TOOL_TURNS = 20;
  let turns = 0;

  for (const p of ordered) {
    if (turns >= MAX_TOOL_TURNS) {
      yield step(
        "turn_limit()",
        `Stopped at ${MAX_TOOL_TURNS} agent turns — remaining payments left unmatched for review`,
        DOT.red
      );
      break;
    }
    turns++;
    yield step("get_payment(p" + p.id + ")", `${p.remitterName ?? "—"} · ${ccy(p.foreignCurrency, p.foreignAmount) || p.reference}`, DOT.neutral);

    const plan: Plan = planPayment(p, invoices, counts);

    if (plan.kind === "unmatched") {
      await tools.markUnmatched(p, plan.reason);
      unmatched++;
      yield step(`mark_unmatched(p${p.id})`, plan.reason, DOT.red);
      continue;
    }

    // Peek at the invoices the agent decided on.
    for (const a of plan.allocs) {
      yield step(
        `get_invoice(${a.invoice.invoiceNumber})`,
        `${a.invoice.clientName} · ${ccy(a.invoice.currency, a.invoice.amount)}`,
        DOT.neutral
      );
    }

    yield step(
      `get_mid_market_rate(${p.valueDate}, ${p.foreignCurrency})`,
      "Mid-market reference rate for the value date",
      DOT.neutral
    );

    const gap = await tools.computeGapForMatch(p, plan.allocs, fee);
    yield step(
      `compute_gap(p${p.id})`,
      gap.classification === "partial"
        ? `About ${ccy(p.foreignCurrency, gap.outstandingFc)} still owed (gap ${inr(gap.totalShortfallInr)})`
        : `Fees and spread come to ${inr(gap.totalShortfallInr)}`,
      gap.classification === "partial" ? DOT.orange : DOT.neutral
    );

    const res = await tools.proposeMatch({
      payment: p,
      allocs: plan.allocs,
      confidence: plan.confidence,
      rationale: plan.rationale,
      fee,
      autoConfirm: settings.autoConfirm,
    });
    agentMatched++;
    if (res.status === "needs_review") needsReview++;
    else auto++;
    yield step(
      `propose_match(p${p.id})`,
      `Confidence ${plan.confidence.toFixed(2)} — ${plan.rationale}`,
      res.status === "needs_review" ? DOT.purple : DOT.green
    );
  }

  const matched = det.matched + agentMatched;
  yield {
    type: "status",
    phase: "complete",
    text: `Done — ${matched} matched, ${unmatched} unmatched.`,
  };
  yield { type: "done", stats: { matched, auto, needsReview, unmatched } };
}
