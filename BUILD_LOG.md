# Build log

Running log of work built during the hackathon (PRD §0, §11).

## 2026-10-29

### Frontend (6 screens)
- Next.js (App Router) + TypeScript + Tailwind v4. Upload, Board, Match dialog
  (paid-with-costs + partial, with expand state), Follow-ups, Settings.
- Dark/light theme from CSS variables; time-aware greeting on the dashboard.
- Rendered from static mock data in `lib/demo-data.ts` (to be replaced by the backend).

### Phase 0 — Backend foundations & plumbing
- **Neon Postgres** wired via Drizzle (`pg` dialect). `db/schema.ts` with 11 tables
  (documents, invoices, payments, matches, allocations, gap_breakdowns, followups,
  llm_calls, llm_cache, fx_rates, settings); pushed to Neon with `drizzle-kit push`.
- `lib/db.ts` — pooled Drizzle client (hot-reload safe).
- `lib/llm.ts` — single model wrapper: stub mode (deterministic, $0), cost logging to
  `llm_calls`, budget cap (`MODEL_BUDGET_USD`), SHA-256 response cache (`llm_cache`).
- `scripts/hello-llm.ts` + `npm run hello` — acceptance check.
- **Verified:** both models called in stub mode logged rows to `llm_calls` at $0; re-run
  hit the cache and added no new rows.

### Phase 1 — Demo data generator
- `scripts/generate-demo-data.ts` (seeded, deterministic): 20 invoices (3 as PNG "photos"
  with rotation + noise via `@napi-rs/canvas`, rest PDFs via pdfkit), 2 statements
  (generic-bank CSV + platform PDF), 21 credit lines covering every case in PRD §10
  (paid-with-costs incl. parent-company remitter and missing invoice-number, partial,
  one-payment-two-invoices, two instalments, unrelated).
- Writes `data/demo/manifest.json` (extraction ground truth for stub mode) and
  `data/demo/answer_key.json` (match-scoring truth for Phases 4–6).
- **Verified:** `npm run generate-demo-data` → 20 invoices + 21 lines, deterministic.

### Phase 2 — Extraction + Upload wiring
- `lib/storage.ts` — file store (local in dev; Neon Object Storage/S3 in Phase 9).
- `lib/extract.ts` — CSV parsed deterministically in code; invoices/platform PDF via Muse
  Spark 1.3 in live mode, via manifest fixture in stub mode.
- `lib/ingest.ts` — store → extract → persist invoices/payments; **idempotent by file SHA**
  (re-upload short-circuits, no re-extraction).
- `app/api/upload/route.ts` (HTTP) + `scripts/seed.ts` (bulk-ingest demo files).
- `app/page.tsx` now a Server Component reading `documents` via `lib/queries.ts`;
  `components/upload-dropzones.tsx` client island for drag/drop + POST + refresh.
- **Verified:** `npm run seed` → 22 documents, 20 invoices, 21 payments; second pass
  **100% cached** (no duplicate rows). Upload page renders real rows (PDFs, PNG photos,
  "Parsed in code" for CSV, "Needs attention" for the low-confidence photo). `POST
  /api/upload` of an existing file returns `cached: true`.

### Auth — Screen 0 sign-in (Better Auth on Neon)
- `STITCH_PROMPTS.md` updated with Screen 0 (two-column sign-in + "Try the demo").
- **Better Auth** on the Neon DB (Drizzle adapter). Tables `user/session/account/verification`
  added to `db/schema.ts` and pushed. `lib/auth.ts` (server), `lib/auth-client.ts` (client),
  handler at `app/api/auth/[...all]/route.ts`.
- Email/password enabled; **Google social hidden unless `GOOGLE_CLIENT_ID`+SECRET set**
  (no dead control, per brief). `app/api/demo/route.ts` signs into a shared pre-seeded
  demo account server-side (no password in UI).
- `middleware.ts` gates every route behind a session (redirect to `/login`); `/login`
  bounces to `/` when already signed in.
- Route group restructure: authed pages moved to `app/(app)/` with the sidebar layout;
  root layout is now chrome-free so `/login` renders full-bleed. Sidebar shows the real
  session user + Sign out.
- `components/login-view.tsx` — promo panel, sign-in/sign-up toggle, password show/hide,
  error state (red border + message), theme toggle, "Try the demo".
- **Verified:** `GET /` unauthenticated → 307 `/login`; demo POST sets a session and
  unlocks the app (`isDemo:true`); email sign-up/sign-in return 200 + cookie; wrong
  password → 401; Google button hidden (no creds); all four app pages render with the
  sidebar under a session.

### Phase 3 — Gap math + FX
- `lib/gap.ts` — pure `computeGap` (PRD §6.3): expected/received, intermediary fee, FX
  spread (residual so the sum invariant is exact), bank charges, classification
  (fully_paid / paid_with_costs / partial / needs_review), outstanding + recoverable fee.
  `roundBreakdown` for display.
- `lib/fx.ts` — `getMidRate`: fixed demo mids that MATCH the generator (so the breakdown
  reproduces invoice figures exactly); Frankfurter + `fx_rates` cache + weekend snap when
  `FX_MODE=live`.
- `tests/gap.test.ts` (Vitest) — **4/4 pass**: §6.3 worked example exact; **sum invariant
  < 1e-6 on 1,000 random cases**; partial classification; recoverable-fee (OUR).

### Phase 4 — Matching + Board wiring
- `lib/match.ts` — scorer (PRD §6.1 weighted signals), token-set remitter ratio, normalized
  invoice-number match; greedy 1:1 assignment (≥0.85 auto, 0.60–0.85 w/ number →
  needs_review); multi-invoice / instalment references deferred to the agent. Persists
  `matches` + `allocations` + `gap_breakdowns` (via `gap.ts` + `fx.ts`).
- `lib/queries.ts` `getBoardData()` — joins payments/matches/allocations/invoices/gaps →
  `BoardRow[]` + summary; status precedence reclassifies partials and parent-company.
- `app/(app)/board/page.tsx` → Server Component; `components/board-view.tsx` → client
  island (filter, table, agent-activity placeholder for Phase 5).
- `scripts/reconcile.ts` (`npm run reconcile`) — runs the pass + scores vs answer key.
- Next config: `serverExternalPackages: ["pg", …]` (fixes pg webpack bundling).
- **Verified:** reconcile → 21 payments, 12 matched (8 auto + 4 needs-review), **100%
  precision (0 false matches)**, 9 correctly deferred to the agent. Board renders live:
  Settled 8 · Partial 3 · Needs review 1 · Unmatched 9; parent-company (Kestrel) flagged.

### Phase 5 — Agent pass + SSE activity
- `lib/agent/tools.ts` — the six tools (PRD §6.2) as real DB functions:
  `listUnresolved`, `getPayment`, `getInvoiceByNumber`/`listInvoices`, `getMidMarketRate`,
  `computeGapForMatch` (money math via `gap.ts`), `proposeMatch` (persists match
  method=`agent` + allocations + gap_breakdown), `markUnmatched`. Agent can only change
  the board through these.
- `lib/agent/planner.ts` — deterministic decision layer (stands in for Wonder's reasoning
  in stub mode; the decisions the live model is prompted toward): detects combined
  transfers (ref names ≥2 invoices), instalments (even invoice split across the two
  INSTALMENT lines), no-reference remitter+amount matches (incl. parent-company → 0.78
  needs-review), and domestic non-remittances → mark_unmatched.
- `lib/agent/run.ts` — `runAgent()` async generator: runs the deterministic pass, then
  walks each unresolved payment through the tools, yielding a step event per tool call
  (tool, text, dot colour, time). Fully deterministic → the golden rule holds (no model
  computes a number or silently moves a match).
- `app/api/reconcile/route.ts` — SSE (GET, Node runtime) streaming each event; rebuilds
  follow-up drafts on completion.
- `components/board-view.tsx` — live Agent-activity panel (EventSource, auto-scroll, pulse
  indicator); **Re-run** button and Upload **Reconcile** (`/board?run=1`) both stream the
  agent; `router.refresh()` re-reads the board on done. Rows are now clickable.
- `scripts/agent-run.ts` (`npm run agent`) — runs the full pass and scores the FINAL state.
- **Verified:** full reconcile → **19/19 matches correct + 2 correctly unmatched = 21/21**;
  combined (016+017, 018+019), instalments (020 ×2), PYMT remitter matches (003/004/005),
  UPI refund + savings interest left unmatched. SSE stream verified live over HTTP.

### Phase 6 — Explanations + follow-ups + dialog wiring
- `db/schema.ts` — added `gap_breakdowns.recoverable_fee_fc` (OUR fees billable back);
  persisted by `match.ts` and the agent; pushed to Neon.
- `lib/explain.ts` — plain-language explanation (deterministic template in stub; Wonder in
  live) + **number validator** (every figure in model prose must be in the computed JSON,
  else regenerate once then fall back to the template). Follow-up draft generator
  (friendly/firm); `generateFollowups()` rebuilds drafts from the reconciliation —
  one per partial (balance owed) and one per OUR invoice (recoverable fee, summed across
  instalments). Amounts always from `gap_breakdowns`, never the model.
- `lib/match-detail.ts` — `getMatchDetail(id)` builds the full `MatchDetail` (header,
  waterfall that sums exactly to Received, callout, evidence, rate details, plain words)
  from payment + allocations + gap. Expected FC derived from `expectedInr / midRate` (the
  authoritative A), fixing a rule-partial allocation storing the received amount.
- `app/api/matches/[id]/route.ts` — `GET` detail; `POST` confirm/reject (reject clears the
  match + children). `app/api/followups/[id]/route.ts` — `POST` mark-sent / regenerate tone.
- `components/match-dialog.tsx` now fed by fetched detail (board rows open it);
  `lib/queries.ts` `getFollowups()`; `app/(app)/followups/page.tsx` → Server Component +
  `components/followups-view.tsx` client editor (tone toggle re-drafts, Copy email =
  clipboard, Mark as sent = POST).
- **Verified:** waterfalls sum exactly (e.g. 1,37,250 − 1,830 − 1,258 − 590 = 1,33,572);
  partial callout "USD 360 owed, USD 2,550 of USD 3,000"; recoverable USD 40 (20+20) on
  INV-020; regenerate-firm + mark-sent round-trip; 4 drafts generated; `npm test` 4/4 green.

### Phase 7 — Settings persistence + live cost meter
- `lib/settings.ts` — single JSON settings row (id=1) with defaults + coercion:
  profile (name/business/reply-to/sign-as), fee allowance + share, home currency,
  spending cap, auto-confirm. `app/api/settings/route.ts` GET/POST.
- **Settings actually drive the math:** `reconcileDeterministic` (match.ts), the agent
  (`run.ts` loads once, threads into `computeGapForMatch`/`proposeMatch`), and follow-up
  drafts (`explain.ts` sign-off) all read settings. Verified: allowance=5/0% → all 19
  matched flip to `partial`; restored 50/3% → 16 paid_with_costs + 3 partial.
- `app/(app)/settings/page.tsx` → data-driven client (fetch GET on mount, controlled
  inputs, POST on save, `router.refresh()` to update the sidebar). Theme stays in
  localStorage. `autoConfirm` marks agent matches ≥0.9 as `confirmed`.
- **Live sidebar:** `lib/queries.ts getSidebarData()` (SUM `llm_calls.cost_usd`, cap from
  settings, follow-up count); `app/(app)/layout.tsx` is now an async RSC passing props to
  `components/sidebar.tsx` — spend meter `$X / $cap` + progress bar (replaces hardcoded
  `$0.84/$100`), follow-ups nav badge from DB (was hardcoded `3`).
- **Verified:** settings persist across reload; meter + badge reflect real DB; agent still
  21/21 with settings threaded.

### Phase 8 — Go-live guardrails, polish, verification
- `lib/llm.ts` budget cap now reads the **user's settings cap** (min with the
  `MODEL_BUDGET_USD` env backstop) and refuses calls once logged spend ≥ cap — before any
  network request. `scripts/budget-check.ts` (`npm run budget-check`, $0) seeds fake spend
  and confirms the refusal: **"Model budget exhausted: $250.00 / $100.00" ✓**.
- Empty states: Board shows an upload/reconcile prompt when there are no payments
  (Upload + Follow-ups empty states already existed); reconcile SSE emits an error status
  on failure.
- `README.md` — hackathon write-up: the golden rule, stack, the one loop, how to run
  ($0 stub-first), and the **going-live** flip (`LLM_MODE=live` + key + `FX_MODE=live`).
- **Live flip is a user action** (needs the Meta Model API key + spend authorization): the
  app is live-ready and the cap is proven, but no real spend was incurred.
- **Verified:** `npm run agent` 21/21 · `npm test` 4/4 · `npm run budget-check` ✓ · all
  four app pages + settings render 200 under a demo session.
