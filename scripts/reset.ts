// Wipe the shared workspace to a clean slate so a new user lands on the empty
// states and uploads their own files. The business tables have no per-user
// scoping (single workspace), so "a fresh user" = an empty workspace.
//
//   npm run reset              full clean slate: data + spend meter + settings
//   npm run reset -- --data-only   keep the spend meter (llm_calls/cache) + settings
//   npm run reset -- --accounts    ALSO delete every sign-in (user/session/account)
//
// Auth accounts are KEPT by default so your existing logins (and the demo
// account) still work — only the workspace data is cleared.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documents, invoices, payments, matches, allocations, gapBreakdowns,
  followups, llmCalls, llmCache, settings,
  user, session, account, verification,
} from "@/db/schema";

const dataOnly = process.argv.includes("--data-only");
const wipeAccounts = process.argv.includes("--accounts");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(t: any): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t);
  return r?.n ?? 0;
}

async function main() {
  // 1. Business data — order respects foreign keys.
  await db.delete(allocations);
  await db.delete(gapBreakdowns);
  await db.delete(followups);
  await db.delete(matches);
  await db.delete(payments);
  await db.delete(invoices);
  await db.delete(documents);
  console.log("✓ Cleared workspace data (invoices, payments, matches, follow-ups, …)");

  // 2. Spend meter + model cache + settings — unless --data-only.
  if (!dataOnly) {
    await db.delete(llmCalls);
    await db.delete(llmCache);
    await db.delete(settings); // getSettings() falls back to DEFAULT_SETTINGS
    console.log("✓ Reset spend meter ($0), model cache, and settings to defaults");
  } else {
    console.log("· Kept spend meter, model cache, and settings (--data-only)");
  }

  // 3. Auth accounts — only if explicitly requested (nuclear).
  if (wipeAccounts) {
    await db.delete(session);
    await db.delete(account);
    await db.delete(verification);
    await db.delete(user);
    console.log("✓ Deleted ALL sign-ins (user/session/account) — truly pristine");
  } else {
    const users = await count(user);
    console.log(`· Kept ${users} sign-in account(s) — sign up a new one in the UI for the clean-slate test`);
  }

  // Confirm empty.
  const left = {
    invoices: await count(invoices),
    payments: await count(payments),
    matches: await count(matches),
    followups: await count(followups),
  };
  console.log(`\nWorkspace now: ${JSON.stringify(left)} — all zero = clean slate ✓`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
