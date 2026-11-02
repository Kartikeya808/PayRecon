// Evaluate invoice extraction against the FATURA ground-truth dataset.
//
//   npm run eval                      # 25 test invoices, real pipeline (honors LLM_MODE)
//   npm run eval -- --n 50 --split dev
//   npm run eval -- --selftest        # $0 self-test of scoring/mapping (synthetic extractor)
//   npm run eval -- --n 100 --json out.json
//
// In pipeline mode the harness calls lib/extract.extract(); with LLM_MODE=stub
// that returns placeholders (≈0 accuracy — proves the harness runs at $0), and
// with LLM_MODE=live it sends each image to the vision model and measures the
// real thing. --selftest bypasses the pipeline entirely and feeds a noisy copy
// of the ground truth through the scorer, so you can validate mapping/scoring
// without any model call.
import { writeFileSync } from "node:fs";
import type { ExtractedInvoice } from "@/lib/extract";
import {
  loadSplit, readAnnotation, readImageBytes, groundTruthFromAnnotation,
  emptyReport, tally, finalize, fieldMatch, SCORED_FIELDS, UNCOVERED_FIELDS,
  type Split, type GroundTruth,
} from "@/lib/eval/fatura";

// ---- args --------------------------------------------------------------------
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const n = Number(arg("n", "25"));
const split = (arg("split", "test") as Split);
const seed = Number(arg("seed", "42"));
const selftest = hasFlag("selftest");
const showFails = hasFlag("show-fails");
const noise = Number(arg("noise", "0.15"));
const jsonOut = arg("json");
const concurrency = Math.max(1, Number(arg("concurrency", "4")));

// The benchmark stops itself once it has spent this much, independent of the
// global ($100) and per-account ($2, N/A to scripts) caps in lib/llm.ts.
const BENCHMARK_CAP_USD = Number(arg("budget", "5"));

// ---- deterministic sampling --------------------------------------------------
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sample<T>(arr: T[], k: number, rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(k, a.length));
}

// ---- synthetic extractor for --selftest --------------------------------------
// Deterministically degrades the ground truth so the scorer sees a realistic
// mix of hits/misses. NOT a measurement of any model.
function noisyOracle(gt: GroundTruth, rng: () => number): Partial<ExtractedInvoice> {
  const keep = <T>(v: T): T | null => (rng() < noise ? null : v);
  let amount = gt.total_amount;
  if (amount != null && rng() < noise) amount = Number((amount + 0.5).toFixed(2)); // wrong value
  return {
    invoice_number: keep(gt.invoice_number) ?? undefined,
    client_name: keep(gt.client_name),
    client_email: null,
    issue_date: keep(gt.issue_date) ?? "",
    due_date: keep(gt.due_date),
    currency: keep(gt.currency) ?? "",
    total_amount: amount ?? undefined,
    bank_charges_terms: "unknown",
    field_confidence: {},
  } as Partial<ExtractedInvoice>;
}

// ---- run ---------------------------------------------------------------------
async function predict(
  row: { imgPath: string; annotPath: string },
  gt: GroundTruth,
  rng: () => number
): Promise<Partial<ExtractedInvoice>> {
  if (selftest) return noisyOracle(gt, rng);
  const { extract } = await import("@/lib/extract");
  const bytes = readImageBytes(row.imgPath);
  const res = await extract(row.imgPath, "invoice", bytes);
  if (res.type !== "invoice") return {};
  return res.invoice;
}

async function main() {
  const llmMode = process.env.LLM_MODE ?? "stub";
  const rows = sample(loadSplit(split), n, mulberry32(seed));
  const report = emptyReport();
  const perRowRng = mulberry32(seed ^ 0x9e3779b9);
  const failures: { file: string; field: string; expected: unknown; got: unknown }[] = [];

  // Only a real live run can spend, so only then do we track the $5 self-limit.
  const liveMode = !selftest && llmMode === "live";
  const { totalSpendUsd } = liveMode ? await import("@/lib/llm") : { totalSpendUsd: async () => 0 };
  const baselineSpend = liveMode ? await totalSpendUsd() : 0;
  let stoppedEarly = false;

  // Bounded-concurrency worker pool over the sampled rows.
  let idx = 0;
  async function worker() {
    while (!stoppedEarly) {
      // Claim an index atomically BEFORE any await, or concurrent workers race
      // past the end of the array.
      const i = idx++;
      if (i >= rows.length) break;
      // Stop before starting another invoice once the benchmark budget is hit.
      if (liveMode && (await totalSpendUsd()) - baselineSpend >= BENCHMARK_CAP_USD) {
        stoppedEarly = true;
        break;
      }
      const row = rows[i];
      try {
        const gt = groundTruthFromAnnotation(readAnnotation(row.annotPath));
        const pred = await predict(row, gt, perRowRng);
        tally(report, gt, pred);
        if (showFails) {
          for (const f of SCORED_FIELDS) {
            if (fieldMatch(f, gt, pred) === false) {
              failures.push({ file: row.imgPath, field: f, expected: gt[f], got: (pred as Record<string, unknown>)[f] });
            }
          }
        }
      } catch (e) {
        failures.push({ file: row.imgPath, field: "(error)", expected: "", got: String(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  finalize(report);

  // ---- report ----------------------------------------------------------------
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const bar = "─".repeat(64);
  console.log(bar);
  console.log(
    `FATURA extraction eval  ·  ${selftest ? "SELF-TEST (synthetic, $0)" : `pipeline (LLM_MODE=${llmMode})`}`
  );
  console.log(`split=${split}  n=${report.n}  seed=${seed}${selftest ? `  noise=${noise}` : ""}`);
  console.log(bar);
  console.log("field            support  present   correct   accuracy");
  for (const f of SCORED_FIELDS) {
    const t = report.perField[f];
    console.log(
      `${f.padEnd(16)} ${String(t.support).padStart(6)}  ` +
        `${String(t.present).padStart(7)}  ${String(t.correct).padStart(8)}   ` +
        `${t.support ? pct(t.correct / t.support) : "   —  "}`
    );
  }
  console.log(bar);
  console.log(
    `OVERALL          ${String(report.overall.support).padStart(6)}  ` +
      `${" ".repeat(7)}  ${String(report.overall.correct).padStart(8)}   ${pct(report.overall.accuracy)}`
  );
  console.log(`present-rate (extractor produced a value): ${pct(report.presentRate)}`);
  console.log(`not covered by FATURA ground truth: ${UNCOVERED_FIELDS.join(", ")}`);
  if (showFails && failures.length) {
    console.log(`${bar}\nmismatches (expected ← got):`);
    for (const f of failures) {
      console.log(`  ${f.file}  ${f.field}:  ${JSON.stringify(f.expected)}  ←  ${JSON.stringify(f.got)}`);
    }
  } else if (failures.length) {
    console.log(`errors: ${failures.length} (first: ${failures[0]?.got})`);
  }

  if (liveMode) {
    const spentHere = (await totalSpendUsd()) - baselineSpend;
    console.log(
      `${bar}\nbenchmark spend: $${spentHere.toFixed(4)} / $${BENCHMARK_CAP_USD.toFixed(2)} cap` +
        (stoppedEarly ? `  ← STOPPED EARLY (scored ${report.n} of ${rows.length})` : "")
    );
  }
  if (!selftest && llmMode === "stub") {
    console.log(`${bar}\nNote: LLM_MODE=stub → placeholders, not a real measurement.`);
    console.log(`Run live with:  LLM_MODE=live npm run eval -- --n ${n}`);
  }
  console.log(bar);

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ mode: selftest ? "selftest" : llmMode, split, seed, report }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
