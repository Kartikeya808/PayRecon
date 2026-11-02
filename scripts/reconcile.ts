// Run the deterministic matching pass and score it against the answer key.
// Run: npm run reconcile
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";
import {
  payments as paymentsT,
  invoices as invoicesT,
  matches as matchesT,
  allocations as allocationsT,
} from "@/db/schema";
import { reconcileDeterministic } from "@/lib/match";

type AnswerKey = {
  payments: {
    value_date: string;
    credited_inr: number;
    reference: string;
    expect_invoices: string[];
  }[];
};

async function main() {
  const summary = await reconcileDeterministic();
  console.log("Deterministic pass:", summary);

  const ak: AnswerKey = JSON.parse(
    readFileSync(join(process.cwd(), "data", "demo", "answer_key.json"), "utf8")
  );
  const keyOf = (vd: string, inr: number) => `${vd}|${Math.round(inr * 100)}`;
  const answerByKey = new Map(ak.payments.map((p) => [keyOf(p.value_date, p.credited_inr), p]));

  const [pays, invs, ms, allocs] = await Promise.all([
    db.select().from(paymentsT),
    db.select().from(invoicesT),
    db.select().from(matchesT),
    db.select().from(allocationsT),
  ]);
  const invNum = new Map(invs.map((i) => [i.id, i.invoiceNumber]));
  const payById = new Map(pays.map((p) => [p.id, p]));
  const allocByMatch = new Map<number, string[]>();
  for (const a of allocs) {
    if (a.matchId == null) continue;
    const list = allocByMatch.get(a.matchId) ?? [];
    if (a.invoiceId != null) list.push(invNum.get(a.invoiceId) ?? "");
    allocByMatch.set(a.matchId, list);
  }

  let autoCorrect = 0;
  let autoTotal = 0;
  let reviewCorrect = 0;
  let reviewTotal = 0;

  for (const m of ms) {
    const p = payById.get(m.paymentId!);
    if (!p) continue;
    const ans = answerByKey.get(keyOf(p.valueDate ?? "", Number(p.creditedInr ?? 0)));
    const assigned = allocByMatch.get(m.id) ?? [];
    const correct = assigned.every((n) => ans?.expect_invoices.includes(n)) && assigned.length > 0;
    if (m.status === "auto") {
      autoTotal++;
      if (correct) autoCorrect++;
    } else {
      reviewTotal++;
      if (correct) reviewCorrect++;
    }
  }

  const total = pays.length;
  console.log("\n— Scoring vs answer key —");
  console.log(`Auto matches: ${autoCorrect}/${autoTotal} correct (precision ${pct(autoCorrect, autoTotal)})`);
  console.log(`Needs-review matches: ${reviewCorrect}/${reviewTotal} correct (precision ${pct(reviewCorrect, reviewTotal)})`);
  console.log(
    `Correctly matched/proposed overall: ${autoCorrect + reviewCorrect}/${total} payments (${pct(autoCorrect + reviewCorrect, total)})`
  );
  console.log(`Deferred to agent (Phase 5): ${total - autoTotal - reviewTotal} payments`);
  process.exit(0);
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
