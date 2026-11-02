# Frontend test walkthrough (before go-live)

Two things to verify through the UI before flipping to live and pushing:

1. **The full product loop** works end-to-end (demo data, $0 stub).
2. **A brand-new user gets a clean slate** (empty states → real upload → live extraction).

The app runs on **http://localhost:3001**.

> **Heads-up — PDFs don't extract live.** The vision model only accepts
> **JPEG, PNG, GIF, WebP, ICO** (PDF → `400 unsupported media type`). CSV
> statements are parsed in code and are fine. So the *live* upload test below uses
> **image invoices** (the FATURA `.jpg`s). PDF support is a known go-live gap — see
> the bottom of this file.

---

## Part 1 — Full product loop on the demo ($0, stub mode)

This exercises every screen with the data the reconcile engine is proven on (21/21).

```bash
npm run seed          # (re)load the 20 demo invoices + 2 statements
npm run dev           # stub mode is the default — no spend
```

1. Open http://localhost:3001 → **"Try the demo"**.
2. **Board** — confirm payments are matched; the sidebar **spend meter** and
   **Follow-ups badge** show real numbers (not the old hardcoded values).
3. Click a matched row → the **match dialog** opens: read the plain-language
   **explanation** and check the **gap waterfall sums exactly** (expected − fees −
   spread = received).
4. **Follow-ups** — toggle a draft **friendly ↔ firm** (re-drafts), **Copy email**,
   **Mark as sent** (badge decrements).
5. **Settings** — drop the **fee allowance** to a tiny number and save → go back to
   the Board and confirm matches reclassify (paid-with-costs → partial). Restore it.
6. Back on **Board** or **Upload**, hit **Re-run / Reconcile** → watch the agent
   steps **stream live** (SSE) and finish "21 matched / correctly unmatched".

✅ Pass = every screen renders real DB data, the waterfall math is exact, and the
reconcile stream completes.

---

## Part 2 — Clean slate for a new user + full LIVE loop

This is the real pre-go-live test: a brand-new account, empty states, then
**live extraction + a full reconcile** using the purpose-built test scenario.

> The business data is a **single shared workspace** (no per-user tables), so a
> "fresh user" means an **empty workspace**. `npm run reset` clears it. Your
> sign-in accounts are **kept** unless you pass `--accounts`.

### The test dataset — `data/test-scenario/`

`npm run generate-demo-data -- --test` writes a self-contained scenario that
exercises **every** feature and is **live-compatible** (PNG invoices + one CSV
statement — no PDFs):

- 20 invoices across **USD / EUR / GBP**
- clean matches, **fee/spread gaps** (paid-with-costs waterfalls), **partials**
  (balance owed → follow-ups), **combined** payments (one credit, two invoices),
  **instalments** (one invoice, two credits), **parent-company** remitters,
  payments with **no invoice number** in the reference
- 2 **unrelated credits** (savings interest, a refund) that correctly stay unmatched

It reconciles to **19 matched + 2 correctly-unmatched (21/21)**.

```bash
npm run generate-demo-data -- --test   # creates data/test-scenario/ (regenerable, gitignored)
npm run reset                          # clean slate: data + spend meter ($0) + settings
LLM_MODE=live npm run dev              # live ONLY for this server
```

`reset` options: `--data-only` keeps the spend meter/settings; `--accounts` also
deletes every sign-in (truly pristine).

1. Open http://localhost:3001 → toggle to **"Create your account"** → sign up a
   fresh email + password. The Upload page should greet you by **your** name.
2. **Verify the empty states**: Board upload prompt, empty Upload/Follow-ups,
   Settings at defaults, sidebar spend meter **$0.00 / $100**.
3. **Upload the invoices (live extraction):** drag all of
   `data/test-scenario/invoices/*.png` onto the **invoice** dropzone. Each is sent
   to the vision model; watch them come back with real extracted fields and the
   **spend meter tick up** (~$0.003 each, ~$0.07 total).
4. **Upload the statement:** drop `data/test-scenario/statements/bank_statement.csv`
   on the **statement** dropzone (CSV is parsed in code — free).
5. Click **Reconcile** → watch the agent steps **stream live**, finishing
   **"19 matched, 2 unmatched."**
6. **Board** → open a few matches: read the **live explanation**, check the
   **waterfall sums exactly**, see the **partials** flagged with a balance owed.
7. **Follow-ups** → partial/recoverable drafts are generated (live prose); toggle
   tone, copy, mark sent.
8. **Settings** → change the fee allowance → matches reclassify on the Board.
9. **(Optional) real-world invoice:** drop a **FATURA `.jpg`** from
   `data/invoices_dataset_final/images/` to see extraction on a real invoice (it
   won't match — no corresponding credit — which is expected).
10. Sign out.

✅ Pass = fresh account → empty states → live extraction → full matched board
with explanations, partials, and follow-ups, and the meter shows real spend.

---

## Part 3 — Guardrails (already proven at $0)

You don't need to re-run these to test the UI, but they back the caps the UI shows:

```bash
npm run budget-check   # $0 — proves: $100 global cap, $2/account cap,
                       #      Contributor-tier refusal, free duplicate uploads
```

The **$2 per-account cap** applies to the account you're signed in as (demo
included) — so no single visitor can run up the bill through the UI.

---

## Pre-push checklist

```bash
# 1. This is not a git repo yet:
git init && git add -A && git status   # review what's staged

# 2. CONFIRM these are NOT staged (all covered by .gitignore):
#    .env.local          ← your real MODEL_API_KEY lives here. NEVER commit it.
#    data/invoices_dataset_final/  (943 MB)
#    data/uploads/  data/demo/  node_modules/  .next/
git check-ignore .env.local data/invoices_dataset_final   # should print both paths

# 3. Full green battery:
npx tsc --noEmit && npm test && npm run budget-check && npm run agent

# 4. The committed default stays stub (LLM_MODE lives only in the un-pushed
#    .env.local). Live is a deploy-time flip — see README "Going live".

git commit -m "…"
```

**The one thing that must be true before you push:** `git check-ignore .env.local`
prints `.env.local`. If it prints nothing, your Meta API key would be committed —
stop and fix `.gitignore` first.

---

## Known go-live gap: PDF extraction

The vision model is **image-only**. Today:

- **CSV** statements → parsed in code → ✅ work live.
- **Image** invoices (JPG/PNG/…) → ✅ work live.
- **PDF** invoices / platform statements → ❌ `400 unsupported media type`.

Most demo invoices and the demo `platform_statement.pdf` are PDFs, so the full
demo loop can't run live yet. Fix options:

- **(a)** Keep PDF handling in stub for the demo (live = image uploads only).
- **(b)** Add a **PDF → PNG rasterization** step in `lib/extract.ts` before the
  model call (needs a renderer — e.g. `pdfjs-dist`, or `pdftoppm`). This makes
  every demo file work live.

Ask if you want (b) implemented before deploy.
