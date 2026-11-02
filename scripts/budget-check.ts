// Prove the go-live guardrails at $0: every refusal happens BEFORE any network
// call, and the cache check runs in stub mode. Run: npm run budget-check
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { llmCalls, llmCache } from "@/db/schema";
import { complete, MODELS, PER_ACCOUNT_CAP_USD } from "@/lib/llm";
import { withAccount } from "@/lib/account-context";
import { saveSettings, getSettings } from "@/lib/settings";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

async function expectThrow(
  name: string,
  pattern: RegExp,
  fn: () => Promise<unknown>
) {
  let msg = "";
  try {
    await fn();
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  checks.push({ name, pass: pattern.test(msg), detail: msg || "(no throw)" });
}

async function main() {
  const originalSettings = await getSettings();
  // Point live mode at an unroutable endpoint so a *real* call would fail loudly;
  // if a guardrail works, we never get there.
  process.env.LLM_MODE = "live";
  process.env.MODEL_API_KEY = "sk-fake-do-not-use";
  process.env.MODEL_BASE_URL = "http://127.0.0.1:1/v1";
  await saveSettings({ spendingCapUsd: 100 });

  // 1. Global cap — seed > $100 of spend, expect refusal.
  const [g] = await db
    .insert(llmCalls)
    .values({ model: MODELS.wonder, purpose: "agent", costUsd: "250.000000" })
    .returning();
  await expectThrow("global $100 cap", /budget exhausted/i, () =>
    complete({ model: MODELS.wonder, purpose: "explain", messages: [{ role: "user", content: "nonce-" + Date.now() }] })
  );
  await db.delete(llmCalls).where(eq(llmCalls.id, g.id));

  // 2. Per-account cap — seed > $2 for one account, expect that account refused.
  const acct = "budget-check-user";
  const [a] = await db
    .insert(llmCalls)
    .values({ userId: acct, model: MODELS.spark, purpose: "extract", costUsd: (PER_ACCOUNT_CAP_USD + 0.5).toFixed(6) })
    .returning();
  await expectThrow(`per-account $${PER_ACCOUNT_CAP_USD} cap`, /account budget exhausted/i, () =>
    withAccount(acct, () =>
      complete({ model: MODELS.spark, purpose: "extract", messages: [{ role: "user", content: "acct-nonce-" + Date.now() }] })
    )
  );
  await db.delete(llmCalls).where(eq(llmCalls.id, a.id));

  // 3. Contributor tier — must be refused outright (financial-data safety).
  process.env.MODEL_TIER = "contributor";
  await expectThrow("Contributor tier refused", /contributor/i, () =>
    complete({ model: MODELS.spark, purpose: "extract", messages: [{ role: "user", content: "tier-nonce-" + Date.now() }] })
  );
  delete process.env.MODEL_TIER;

  // 4. Cache dedup — identical request (e.g. a re-uploaded file) costs $0. Run
  //    in stub mode so nothing hits the network; the second call must be cached.
  process.env.LLM_MODE = "stub";
  const dupMsg = [{ role: "user" as const, content: "dup-upload-nonce-" + Date.now() }];
  const first = await complete({ model: MODELS.spark, purpose: "extract", messages: dupMsg });
  const second = await complete({ model: MODELS.spark, purpose: "extract", messages: dupMsg });
  checks.push({
    name: "duplicate request cached (free)",
    pass: !first.cached && second.cached && second.costUsd === 0,
    detail: `first.cached=${first.cached} second.cached=${second.cached} second.cost=$${second.costUsd}`,
  });

  // Cleanup: restore settings (cache/llm_calls rows from check 4 are $0 stubs).
  await saveSettings({ spendingCapUsd: originalSettings.spendingCapUsd });
  await db.delete(llmCache).where(eq(llmCache.key, (await import("node:crypto")).createHash("sha256").update(JSON.stringify({ mode: "stub", model: MODELS.spark, purpose: "extract", messages: dupMsg, tools: null })).digest("hex")));

  // Report.
  let ok = true;
  for (const c of checks) {
    console.log(`${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}`);
    if (!c.pass) ok = false;
  }
  console.log(ok ? "\nAll guardrails enforced ($0 spent)." : "\nGUARDRAIL FAILURE.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
