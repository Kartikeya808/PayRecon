// Run the full reconcile (deterministic + agent) and score the FINAL state
// against the answer key. Run: npm run agent
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";
import {
  payments as paymentsT,
  invoices as invoicesT,
  matches as matchesT,
  allocations as allocationsT,
} from "@/db/schema";
import { runAgent } from "@/lib/agent/run";
import { generateFollowups } from "@/lib/explain";

type AnswerKey = {
  payments: { value_date: string; credited_inr: number; expect_invoices: string[] }[];
};

async function main() {
  console.log("— Agent run —\n");
  for await (const ev of runAgent()) {
    if (ev.type === "status") console.log(`\n[${ev.phase}] ${ev.text}`);
    else if (ev.type === "step") console.log(`  ${ev.tool.padEnd(34)} ${ev.text}`);
    else if (ev.type === "done") console.log("\nStats:", ev.stats);
  }
  const n = await generateFollowups();
  console.log(`\nFollow-ups generated: ${n}`);

  const ak: AnswerKey = JSON.parse(
    readFileSync(join(process.cwd(), "data", "demo", "answer_key.json"), "utf8")
  );
  const keyOf = (vd: string, i: number) => `${vd}|${Math.round(i * 100)}`;
  const ansBy = new Map(ak.payments.map((p) => [keyOf(p.value_date, p.credited_inr), p]));

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
    const l = allocByMatch.get(a.matchId) ?? [];
    if (a.invoiceId != null) l.push(invNum.get(a.invoiceId) ?? "");
    allocByMatch.set(a.matchId, l);
  }
  const matchedPayIds = new Set(ms.map((m) => m.paymentId));

  let correct = 0;
  const wrong: string[] = [];
  for (const m of ms) {
    const p = payById.get(m.paymentId!);
    if (!p) continue;
    const ans = ansBy.get(keyOf(p.valueDate ?? "", Number(p.creditedInr ?? 0)));
    const assigned = (allocByMatch.get(m.id) ?? []).sort();
    const expect = [...(ans?.expect_invoices ?? [])].sort();
    const ok = assigned.length === expect.length && assigned.every((n, i) => n === expect[i]);
    if (ok) correct++;
    else wrong.push(`p${p.id}: got [${assigned.join(",")}] expected [${expect.join(",")}]`);
  }

  // Correctly-left-unmatched payments.
  let unmatchedOk = 0;
  for (const p of pays) {
    if (matchedPayIds.has(p.id)) continue;
    const ans = ansBy.get(keyOf(p.valueDate ?? "", Number(p.creditedInr ?? 0)));
    if (ans && ans.expect_invoices.length === 0) unmatchedOk++;
    else wrong.push(`p${p.id}: left unmatched but answer expected ${ans?.expect_invoices.join(",")}`);
  }

  console.log("\n— Scoring vs answer key —");
  console.log(`Matches correct:        ${correct}/${ms.length}`);
  console.log(`Correctly unmatched:    ${unmatchedOk}`);
  console.log(`Total payments covered: ${correct + unmatchedOk}/${pays.length}`);
  if (wrong.length) {
    console.log("\nMISMATCHES:");
    wrong.forEach((w) => console.log("  ✗ " + w));
  } else {
    console.log("\n✓ 100% of answer-key outcomes correct (matched or correctly unmatched).");
  }
  process.exit(wrong.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
