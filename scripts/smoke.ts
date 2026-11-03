/**
 * PayRecon smoke test — a "does it still work?" check for a running deployment.
 *
 * Usage:   npx tsx scripts/smoke.ts <BASE_URL>
 * Example: npx tsx scripts/smoke.ts https://payrecon.vercel.app
 *
 * It drives the live app with Playwright and records, per check, PASS / FAIL /
 * INFO. It is designed to spend ZERO model credits:
 *   - "Try the demo" only signs in (no model call).
 *   - Page loads read cached data; opening a match reads a cached explanation.
 *   - The unauthenticated API probes are shaped to be rejected *before* any
 *     extraction / explanation runs (upload with no file -> 400, matches with a
 *     non-existent id -> 404, followups via PATCH -> no handler, settings with
 *     an empty body -> no-op).
 *
 * Requires Playwright + a Chromium build to be available. If they aren't:
 *   npm install --no-save --no-package-lock playwright && npx playwright install chromium
 *
 * Exit code is 0 when every assertion passes, 1 otherwise. Step 5 only records
 * status codes (no assertions). Screenshots + a results.json land in
 * /tmp/smoke/<host>/.
 */
import { chromium, request as pwRequest, type Page, type Browser } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Result = { step: string; name: string; status: "PASS" | "FAIL" | "INFO"; detail: string };
const results: Result[] = [];
function record(step: string, name: string, status: Result["status"], detail = "") {
  results.push({ step, name, status, detail });
  const tag = status === "PASS" ? "✓ PASS" : status === "FAIL" ? "✗ FAIL" : "· INFO";
  console.log(`  ${tag}  [${step}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const BASE_URL = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!BASE_URL) {
  console.error("Usage: npx tsx scripts/smoke.ts <BASE_URL>");
  process.exit(2);
}
const HOST = new URL(BASE_URL).host;
const SHOT_DIR = join("/tmp/smoke", HOST);
mkdirSync(SHOT_DIR, { recursive: true });

/** Attach console-error + pageerror collectors to a page. */
function watchErrors(page: Page) {
  const errs: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  return {
    snapshot: () => errs.slice(),
    reset: () => {
      errs.length = 0;
    },
  };
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText || "");
}

/** Parse "₹1,65,507.50" / "−₹4,392.50" / "$1,234.00" / "EUR 1,850.00" -> number. */
function parseMoney(s: string): number {
  const neg = /^[−-]/.test(s.trim());
  const n = Number(s.replace(/[^\d.]/g, ""));
  return neg ? -n : n;
}

async function run() {
  console.log(`\nPayRecon smoke test → ${BASE_URL}`);
  console.log(`Screenshots → ${SHOT_DIR}\n`);

  const browser: Browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errs = watchErrors(page);

  // --- Step 1: /login ------------------------------------------------------
  try {
    errs.reset();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(500); // let the sample card settle
    await page.screenshot({ path: join(SHOT_DIR, "01-login.png"), fullPage: true });
    const consoleErrs = errs.snapshot();
    record("1", "/login no console errors", consoleErrs.length ? "FAIL" : "PASS", consoleErrs.join(" | "));
    const text = await bodyText(page);
    record("1", "sample card shows $ amounts", text.includes("$") ? "PASS" : "FAIL");
    record("1", "no ₹ on /login", text.includes("₹") ? "FAIL" : "PASS", text.includes("₹") ? "₹ present" : "");
  } catch (e) {
    record("1", "/login loads", "FAIL", String(e));
  }

  // --- Step 2: Try the demo ------------------------------------------------
  try {
    errs.reset();
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }),
      page.getByRole("button", { name: /Try the demo/i }).click(),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await page.screenshot({ path: join(SHOT_DIR, "02-app-home.png"), fullPage: true });
    const signedIn = !new URL(page.url()).pathname.startsWith("/login");
    record("2", "'Try the demo' lands signed in", signedIn ? "PASS" : "FAIL", `url=${page.url()}`);
  } catch (e) {
    record("2", "'Try the demo' lands signed in", "FAIL", String(e));
  }

  // --- Step 3: app pages load, no console errors, no ₹/INR -----------------
  const pages: { label: string; path: string; file: string }[] = [
    { label: "Upload", path: "/", file: "03-upload.png" },
    { label: "Board", path: "/board", file: "03-board.png" },
    { label: "Follow-ups", path: "/followups", file: "03-followups.png" },
    { label: "Settings", path: "/settings", file: "03-settings.png" },
  ];
  for (const p of pages) {
    try {
      errs.reset();
      await page.goto(`${BASE_URL}${p.path}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(SHOT_DIR, p.file), fullPage: true });
      const consoleErrs = errs.snapshot();
      record("3", `${p.label} no console errors`, consoleErrs.length ? "FAIL" : "PASS", consoleErrs.join(" | "));
      const text = await bodyText(page);
      record("3", `${p.label} no ₹`, text.includes("₹") ? "FAIL" : "PASS", text.includes("₹") ? "₹ present" : "");
      record("3", `${p.label} no INR`, /\bINR\b/.test(text) ? "FAIL" : "PASS", /\bINR\b/.test(text) ? "INR present" : "");
    } catch (e) {
      record("3", `${p.label} loads`, "FAIL", String(e));
    }
  }

  // --- Step 4: INV-2026-014 breakdown sums to the cent ---------------------
  try {
    await page.goto(`${BASE_URL}/board`, { waitUntil: "networkidle", timeout: 30000 });
    const row = page.locator("tr", { hasText: "INV-2026-014" }).first();
    await row.waitFor({ state: "visible", timeout: 15000 });
    const t0 = Date.now();
    await row.click();
    await page.locator(".dialog").waitFor({ state: "visible", timeout: 30000 });
    await page.locator(".waterfall-row").first().waitFor({ state: "visible", timeout: 15000 });
    const openMs = Date.now() - t0;
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOT_DIR, "04-match-dialog.png"), fullPage: true });

    const chip = (await page.locator(".dialog .chip").first().innerText().catch(() => "")).trim();
    const rows = await page.locator(".waterfall-row").evaluateAll((els) =>
      els.map((r) => ({
        label: (r.querySelector("div > div > div") as HTMLElement | null)?.innerText?.trim() ?? "",
        amount: (r.querySelector(".tnum") as HTMLElement | null)?.innerText?.trim() ?? "",
      }))
    );
    record("4", "INV-2026-014 dialog opened", rows.length ? "PASS" : "FAIL", `chip="${chip}", open=${openMs}ms (cached if fast)`);
    console.log("      waterfall:");
    rows.forEach((r) => console.log(`        ${r.label.padEnd(28)} ${r.amount}`));

    if (rows.length >= 3) {
      const expected = parseMoney(rows[0].amount);
      const received = parseMoney(rows[rows.length - 1].amount);
      const fees = rows.slice(1, -1).reduce((s, r) => s + Math.abs(parseMoney(r.amount)), 0);
      const diff = expected - fees - received;
      const sums = Math.abs(diff) < 0.005;
      record(
        "4",
        "Expected − fees = Received (to the cent)",
        sums ? "PASS" : "FAIL",
        `expected=${expected.toFixed(2)} − fees=${fees.toFixed(2)} − received=${received.toFixed(2)} ⇒ diff=${diff.toFixed(2)}`
      );
    } else {
      record("4", "Expected − fees = Received", "FAIL", `only ${rows.length} waterfall rows parsed`);
    }
  } catch (e) {
    record("4", "INV-2026-014 breakdown", "FAIL", String(e));
  }

  // --- Step 5: unauthenticated / fake-cookie API probes (record only) ------
  // Discover the real session cookie name from the signed-in context, so the
  // "fake cookie" case uses the right name with a garbage value.
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => /session/i.test(c.name));
  const sessionName = sessionCookie?.name ?? "better-auth.session_token";
  record("5", "session cookie name", "INFO", sessionName);

  const probes: { name: string; fn: (rc: import("playwright").APIRequestContext) => Promise<number> }[] = [
    {
      name: "POST /api/upload (no file)",
      fn: async (rc) => (await rc.post(`${BASE_URL}/api/upload`, { multipart: { kind: "invoice" } })).status(),
    },
    {
      name: "GET /api/matches/999999999",
      fn: async (rc) => (await rc.get(`${BASE_URL}/api/matches/999999999`)).status(),
    },
    {
      name: "PATCH /api/followups/999999999",
      fn: async (rc) => (await rc.fetch(`${BASE_URL}/api/followups/999999999`, { method: "PATCH", data: {} })).status(),
    },
    {
      name: "POST /api/settings (empty body)",
      fn: async (rc) => (await rc.post(`${BASE_URL}/api/settings`, { data: {} })).status(),
    },
  ];

  for (const [caseName, headers] of [
    ["no cookie", {}],
    ["fake cookie", { Cookie: `${sessionName}=fake.invalid.value` }],
  ] as const) {
    const rc = await pwRequest.newContext({ extraHTTPHeaders: headers });
    for (const probe of probes) {
      try {
        const status = await probe.fn(rc);
        record("5", `[${caseName}] ${probe.name}`, "INFO", `status ${status}`);
      } catch (e) {
        record("5", `[${caseName}] ${probe.name}`, "INFO", `error ${String(e)}`);
      }
    }
    await rc.dispose();
  }

  await browser.close();

  // --- Summary -------------------------------------------------------------
  const assertions = results.filter((r) => r.status !== "INFO");
  const failed = assertions.filter((r) => r.status === "FAIL");
  writeFileSync(join(SHOT_DIR, "results.json"), JSON.stringify({ baseUrl: BASE_URL, at: new Date().toISOString(), results }, null, 2));
  console.log(`\n${"-".repeat(60)}`);
  console.log(`Assertions: ${assertions.length - failed.length}/${assertions.length} passed, ${failed.length} failed.`);
  if (failed.length) console.log("Failed:\n" + failed.map((f) => `  ✗ [${f.step}] ${f.name} ${f.detail}`).join("\n"));
  console.log(`Results JSON → ${join(SHOT_DIR, "results.json")}`);
  console.log(`${"-".repeat(60)}\n`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
