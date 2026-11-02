// Ingest the generated demo files into the DB through the real pipeline.
// Run: npm run seed            (truncates ingest tables, then ingests)
//      npm run seed -- --keep  (no truncate)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documents,
  invoices,
  payments,
  matches,
  allocations,
  gapBreakdowns,
  followups,
} from "@/db/schema";
import { ingestFile } from "@/lib/ingest";

// Source dir: `npm run seed` → data/demo; `npm run seed -- --dir data/test-scenario`.
const dirArg = (() => {
  const i = process.argv.indexOf("--dir");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "data/demo";
})();
const DEMO = join(process.cwd(), dirArg);

async function reset() {
  // Order respects foreign keys.
  await db.delete(allocations);
  await db.delete(gapBreakdowns);
  await db.delete(followups);
  await db.delete(matches);
  await db.delete(payments);
  await db.delete(invoices);
  await db.delete(documents);
}

async function ingestDir(dir: string, kind: "invoice" | "statement") {
  const files = readdirSync(join(DEMO, dir));
  let cached = 0;
  for (const f of files) {
    const bytes = readFileSync(join(DEMO, dir, f));
    const r = await ingestFile(f, kind, bytes);
    if (r.cached) cached++;
  }
  return { count: files.length, cached };
}

async function main() {
  if (!process.argv.includes("--keep")) {
    await reset();
    console.log("Reset ingest tables.");
  }

  const inv = await ingestDir("invoices", "invoice");
  const stmt = await ingestDir("statements", "statement");

  // Second pass proves the SHA cache (idempotent — nothing re-extracted).
  const inv2 = await ingestDir("invoices", "invoice");
  const stmt2 = await ingestDir("statements", "statement");

  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(documents);
  const [i] = await db.select({ n: sql<number>`count(*)::int` }).from(invoices);
  const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(payments);

  console.log(`Ingested ${inv.count} invoices + ${stmt.count} statements.`);
  console.log(
    `Second pass cached: ${inv2.cached}/${inv2.count} invoices, ` +
      `${stmt2.cached}/${stmt2.count} statements (expect all cached).`
  );
  console.log(`DB now: ${d.n} documents, ${i.n} invoices, ${p.n} payments.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
