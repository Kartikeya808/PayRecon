# PMA — Backend Integration Plan (phasewise)

## Context

The frontend is **already built and running** (Next.js App Router + Tailwind v4): six
screens — Upload, Board, Match detail dialog (×2 states), Follow-ups, Settings — all
rendering from **static mock data** in `lib/demo-data.ts`. This plan replaces that mock
layer with a real backend, phase by phase, and shows **how each piece of the stack fits
together**.

Target: the Meta AI Dev Hackathon. The build must prove one loop end to end —
**upload → auto-match → explain the gap → draft follow-up** — and show the Meta Model
API doing visible work (extraction, a tool-using agent, plain-language explanations, a
live cost meter).

**Decisions locked with the user:**
- **LLM:** build **stub-first** (deterministic fake responses, `$0` spend). Flip one env
  var to go live after the backend is done; reserve the **$150** credits for real runs,
  capped at **$100** with headroom.
- **Data flow:** **Hybrid** — Server Components read the DB and embed data in the first
  paint (no spinners); API routes handle uploads + the SSE reconcile stream; the existing
  interactive pieces stay as client "islands" fed by server data.
- **Auth (added — Screen 0):** **Better Auth** on the Neon DB (Drizzle adapter), email/
  password + optional Google social (hidden until creds exist) + a server-side **"Try the
  demo"** account. `middleware.ts` gates all routes; authed pages live in the `app/(app)/`
  route group; `/login` is chrome-free. Built before Phases 3–4 at the user's request
  (supersedes the earlier "auth out of scope" note, since we are deploying).
- **Database & deploy:** **Neon Postgres from day one** (via Drizzle's `pg` dialect), so
  there is no late migration. Local dev points at a **Neon dev branch** (or a local Docker
  Postgres) — identical code to prod. Uploaded files go to **Vercel Blob** (serverless has
  no persistent disk), and the app is **hosted on Vercel**. Deployment is **Phase 9**;
  Phases 0–8 are built and demoed against the same Neon database.

---

## How the stack fits together

```
                         ┌──────────────────────────────────────────────┐
  Browser (React)        │  Next.js App Router  (Vercel)                 │
  ───────────────        │                                               │
  Server Components ◄─────┤  app/*/page.tsx  (RSC: read DB, embed data)  │
    Board / Follow-ups   │        │                                      │
    Settings / Upload    │        ▼                                      │
        │ props          │  db/ (Drizzle, pg)  ──►  Neon Postgres        │
        ▼                │        ▲                                      │
  Client islands         │        │ queries                              │
    filters, dialog, ────┼──► app/api/upload     (POST → Vercel Blob)   │
    tone toggle          │    app/api/reconcile  (SSE: match + agent)   │
        │ fetch / SSE     │    app/api/matches/[id] (GET detail, POST    │
        ▼                │                          confirm/reject)     │
                         │        │                                      │
                         │        ▼                                      │
                         │  lib/  extract.ts  match.ts  gap.ts  fx.ts    │
                         │        agent/  llm.ts  storage.ts (blob)      │
                         └──────────────┬───────────────────────────────┘
                                        ▼
                  Neon Postgres  ·  Vercel Blob (files)  ·  Frankfurter FX
                  Meta Model API: Spark 1.3 (extract) + Wonder 1.0 (agent/write)
```

**The golden rule (PRD §0):** *money math is done in code, never by the model.* The model
only extracts fields, resolves ambiguous matches via tools, and writes prose. Every
number on screen comes from pure TypeScript (`gap.ts`) with unit tests, and a number
validator rejects any model text that introduces a figure not in the computed JSON.

### What each layer owns

| Layer | Owns | Key files |
|---|---|---|
| **DB** | Single source of truth; **Neon Postgres** via Drizzle (`pg`) | `db/schema.ts`, `lib/db.ts`, `drizzle.config.ts` |
| **File storage** | Uploaded PDFs/images; returns a durable URL | `lib/storage.ts` (Vercel Blob) |
| **LLM wrapper** | All model calls, cost logging, budget cap, stub mode, SHA cache | `lib/llm.ts` |
| **Extraction** | PDF/image → structured fields (Spark); CSV parsed in code | `lib/extract.ts` |
| **Money math** | Gap waterfall, classification — pure & tested | `lib/gap.ts`, `lib/fx.ts` |
| **Matching** | Deterministic scorer + greedy assignment | `lib/match.ts` |
| **Agent** | Tool loop for hard cases (split/combined/parent-company) | `lib/agent/` |
| **API** | Uploads, SSE reconcile stream, match actions | `app/api/*` |
| **Frontend** | Already built; swap mock imports for server data | `app/*/page.tsx`, `components/*` |

### Mock → real source map (what each phase replaces)

| Current mock (`lib/demo-data.ts` / hardcoded) | Replaced by | Phase |
|---|---|---|
| `fileRows` (Upload list) | `documents` table + `extract.ts` status | 2 |
| `boardRows`, `summary` | `payments`+`matches`+`gap_breakdowns` query | 4 |
| `agentSteps` (activity timeline) | SSE events from `/api/reconcile` | 5 |
| `matches` (dialog detail) | `GET /api/matches/[id]` from `gap_breakdowns` | 6 |
| `followups` | `followups` table + generator | 6 |
| Sidebar `$0.84 / $100` meter | `SUM(cost_usd)` from `llm_calls` | 7 |
| Follow-ups nav badge `3` | count from `followups` table | 7 |

`lib/format.ts` (`inr`, `fc`) and all the `demo-data.ts` **types** (`BoardRow`,
`MatchDetail`, `FileRow`, `Followup`, `Status`, `statusChip`) are **kept and reused** —
they become the contract between server queries and the client islands.

---

## Phases

Each phase is independently demoable and ends with an acceptance check. Finish a phase's
check before starting the next.

### Phase 0 — Foundations & plumbing
**Goal:** DB and the one LLM wrapper everything depends on.
- `db/schema.ts` — 8 tables (PRD §8): `documents, invoices, payments, matches,
  allocations, gap_breakdowns, followups, llm_calls` (+ `fx_rates`, `settings`). `lib/db.ts`
  — single Drizzle client over **Neon Postgres** (`drizzle-orm/neon-serverless` +
  `@neondatabase/serverless`). `drizzle.config.ts` with `dialect: "postgresql"`; schema
  pushed via `drizzle-kit`.
- Create a **Neon project** with a `main` and a `dev` branch; local dev uses the `dev`
  branch connection string (same engine as prod → no migration surprises).
- `lib/llm.ts` — OpenAI SDK with `baseURL` override; **logs every call** to `llm_calls`
  (model, tokens, cached tokens, `cost_usd`); **refuses** calls once logged spend passes
  `MODEL_BUDGET_USD`; **stub mode** (`LLM_MODE=stub`) returns deterministic fixtures;
  **SHA-256 response cache** (a `llm_cache` table) so re-runs never re-call.
- `.env.local`: `DATABASE_URL` (Neon dev branch), `MODEL_API_KEY`, `MODEL_BASE_URL`,
  `MODEL_BUDGET_USD=100`, `LLM_MODE=stub`, `BLOB_READ_WRITE_TOKEN` (Phase 2).
- **Fits:** nothing user-facing; the spine every later phase calls.
- **Check:** `drizzle-kit push` creates the tables in Neon; a hello call to each model
  writes a row in `llm_calls` with a cost (stub = $0).

### Phase 1 — Demo data generator
**Goal:** rights-clean synthetic inputs so dev needs no real documents.
- `scripts/generate-demo-data.ts` (fixed seed, PRD §10): 20 invoice PDFs (pdfkit), 3 of
  them as PNG "photos", 2 statements (CSV + platform-style PDF), 21 credit lines covering
  every case; writes `data/demo/answer_key.json`.
- **Fits:** the files the Upload screen ingests; answer key scores accuracy in tests.
- **Check:** deterministic — 20 invoices, 2 statements, answer key reproduced byte-stable.

### Phase 2 — Extraction + Upload wiring  *(replaces `fileRows`)*
**Goal:** real files in, structured fields out, status on screen.
- `lib/storage.ts` — thin wrapper over **Vercel Blob** (`@vercel/blob`): `put(file)` →
  durable URL, `get(url)` → bytes. (Local dev uses the same Blob store via token; no
  local-disk writes, so dev == prod.)
- `lib/extract.ts` — Spark 1.3 structured output (JSON-schema from PRD §7) for
  PDF/images; **CSV parsed deterministically in code** (no model call); cache by file SHA.
- `app/api/upload/route.ts` — receive files → **`storage.put` (Blob)** → insert
  `documents` (with blob URL + SHA) → run extraction → populate `invoices`/`payments` →
  update status.
- `app/page.tsx` — becomes a Server Component that reads `documents` and maps to
  `FileRow[]`; a small client island handles drag/drop + POST + live status. Remove
  `fileRows` import.
- **Flow:** browser → `POST /api/upload` → Blob + `documents` row → `extract.ts` (reads
  bytes from Blob) → rows → status chips (Queued → Reading… → Done / Needs attention).
- **Check:** ≥95% field accuracy vs answer key; **re-upload = 0 model calls** (cache hit).

### Phase 3 — Gap math + FX  *(the trust core, pure & tested)*
**Goal:** every rupee on screen provably correct.
- `lib/gap.ts` — pure functions implementing PRD §6.3 (expected/received, intermediary
  fee, FX spread, bank charges, classification: Paid-with-costs / Partial / Needs-review).
- `lib/fx.ts` — Frankfurter ECB rates + `fx_rates` table cache (Postgres); weekend→previous
  business day.
- `tests/` (Vitest) — the §6.3 worked example exact; **sum invariant** holds on 1,000
  random cases.
- **Fits:** feeds the dialog waterfall, board shortfall, follow-up amounts (next phases).
- **Check:** tests green; `intermediary_fee + fx_spread + bank_charges == total_shortfall`.

### Phase 4 — Matching + Board wiring  *(replaces `boardRows`, `summary`)*
**Goal:** payments auto-matched to invoices, board shows real data.
- `lib/match.ts` — scorer (PRD §6.1 weights) + greedy highest-score-first assignment;
  writes `matches`, `allocations`, and `gap_breakdowns` (calls `gap.ts` + `fx.ts`).
- `app/board/page.tsx` — split into a Server Component (reads
  payments/matches/invoices/gap_breakdowns, computes `summary`, maps to `BoardRow[]`) +
  the existing interactive board as a client island receiving props. Remove
  `boardRows`/`summary` imports.
- **Flow:** DB → server query → `BoardRow[]` + summary → client board island.
- **Check:** ≥70% of payments auto-matched correctly (no model call) vs answer key.

### Phase 5 — Agent pass + SSE activity  *(replaces `agentSteps`; the "wow")*
**Goal:** the hard cases resolved by a visible tool-using agent.
- `lib/agent/` — Wonder 1.0 tool loop with the six tools (PRD §6.2): `list_unresolved`,
  `get_invoice`/`get_payment`, `get_mid_market_rate`, `compute_gap`, `propose_match`,
  `mark_unmatched`. 20-turn cap; stable system prefix (prompt caching); **agent may only
  change matches through tools**.
- `app/api/reconcile/route.ts` — **SSE**: runs the deterministic pass, then the agent
  pass, streaming each tool call as an event.
- Wire the Upload **Reconcile** button and Board **Re-run** → `EventSource` →
  Agent-activity panel fills live; final event triggers `router.refresh()` to re-read the
  board.
- **Flow:** button → `EventSource /api/reconcile` → `match.ts` then agent loop → each tool
  call emitted as SSE → client appends to timeline → done → board refreshes.
- **Why SSE:** live agent reasoning is the judge-facing highlight; deterministic pass
  handles most cases instantly so the agent only runs on the few hard ones.
- **Check:** 100% of answer-key matches correct or flagged for review; **no hallucinated
  amounts** (every amount came from `compute_gap`).

### Phase 6 — Explanations + follow-ups + dialog wiring  *(replaces `matches`, `followups`)*
**Goal:** plain-language explanation per match; drafted follow-ups.
- Explanation generator (Wonder, PRD §6.4) + **number validator** (every number in the
  output must appear in the computed JSON; regenerate once if not). Follow-up draft
  generator (friendly / firm).
- `app/api/matches/[id]/route.ts` — `GET` returns a full `MatchDetail` (header, waterfall
  from `gap_breakdowns`, plain words, evidence, rate details); `POST` for
  confirm/reject/reassign.
- `components/match-dialog.tsx` — fetch detail by id on open (remove `matches` lookup).
  `app/followups/page.tsx` — server reads `followups` → client editor island; **Copy
  email** = clipboard, **Mark as sent** = `POST`. Remove `followups` import.
- **Check:** every explanation passes the number check; follow-ups exist for all Partial
  cases.

### Phase 7 — Settings persistence + live cost meter
**Goal:** real settings and a real budget meter.
- Persist profile, theme, fee allowance/share, reference rate, home currency, spending
  cap, auto-confirm (settings table or JSON config consumed by `match.ts`/`gap.ts`).
- `app/settings/page.tsx` ↔ `/api/settings`. `components/sidebar.tsx` spend meter reads
  `SUM(cost_usd)` from `llm_calls` (remove hardcoded `$0.84 / $100`); follow-ups badge
  count from DB.
- **Check:** settings persist across reload; meter reflects actual logged spend.

### Phase 8 — Go live, guardrails, polish, verification
**Goal:** flip to the real Meta Model API and harden for the demo.
- Set `LLM_MODE=live` + `MODEL_API_KEY`; run the full demo; confirm the budget cap
  refuses calls past `$100` (keeping `$50` of the `$150` as headroom). Empty/error states,
  README "Built during the hackathon" section, `BUILD_LOG.md`.
- **Check:** full demo run **< 90 s** and **< $1.50**; budget cap enforced.

### Phase 9 — Deploy (Vercel + Neon + Blob)
**Goal:** a live, clickable URL for judges.
- Push the repo; **import to Vercel**. Set env vars in Vercel: `DATABASE_URL` (Neon
  **main** branch, pooled), `MODEL_API_KEY`, `MODEL_BASE_URL`, `MODEL_BUDGET_USD`,
  `LLM_MODE=live`, `BLOB_READ_WRITE_TOKEN` (Vercel Blob auto-provisions).
- Run `drizzle-kit push` against the Neon **main** branch; optionally seed it once by
  running the upload+reconcile flow so the deployed board isn't empty for judges.
- Confirm the SSE route works on Vercel (Node.js runtime, streaming responses enabled),
  and that uploads land in Blob and extraction reads them back.
- **Fits:** same code as local — only the connection strings and `LLM_MODE` differ.
- **Check:** the live URL loads all six screens with data; an end-to-end upload → reconcile
  → explain → follow-up works in production; cost meter reflects real spend.

---

## Hackathon considerations (baked into the design)

- **Latency** — deterministic-first: CSV parsing, matching, and gap math make **no model
  calls** and are instant; extraction cached by SHA; agent prefix prompt-cached; **SSE**
  keeps the UI alive during the agent run; **RSC embeds data in the first paint** so pages
  never spinner. Use **Neon's pooled connection string** and deploy the app in the **same
  region** as the Neon project so the DB hop is ~1–5 ms.
- **Scalability** — stateless API routes on Vercel (scale horizontally); **Neon** is
  serverless Postgres (autoscaling, connection pooling); files on **Vercel Blob/CDN**;
  per-file extraction parallelizable; cost grows **sub-linearly** because the agent only
  touches the few hard cases. This is a genuinely deployable, multi-user-capable stack, not
  a laptop-only demo.
- **Relevancy (judging)** — Meta Model API is **central and visible**: extraction, the
  live agent tool trace, plain-language explanations, and the cost meter. Purple
  attribution marks agent work; the number validator demonstrates "math in code, not
  model" — the credibility story for a *financial* tool.
- **Budget** — stub-first dev costs **$0**; `$150` reserved for live runs; hard cap at
  `$100`. Est. full run ~$1.00 first / ~$0.80 re-runs (extraction cached).

---

## Verification (end to end)

1. `npm run generate-demo-data` → confirm 20 invoices + 2 statements + `answer_key.json`.
2. `npm test` (Vitest) → gap math worked example + sum invariant (1,000 cases) + matching
   scorer vs answer key.
3. **Stub run** (`LLM_MODE=stub`, `$0`): `npm run dev`, walk all six screens — upload the
   generated files, click Reconcile, watch the agent panel stream, open a match dialog
   (check the waterfall sums and the number validator), open a Partial, copy a follow-up,
   change a setting and confirm it persists, watch the cost meter move.
4. **Live run** (`LLM_MODE=live`): one full pass; confirm **< 90 s**, **< $1.50**, budget
   cap enforced, and that `llm_calls` shows real token/cost rows.
5. **Deployed (Phase 9):** open the Vercel URL on another device; run upload → reconcile →
   explain → follow-up against Neon `main`; confirm Blob uploads and SSE streaming work.

## Critical files

- **New backend:** `db/schema.ts`, `lib/db.ts`, `drizzle.config.ts`, `lib/storage.ts`,
  `lib/llm.ts`, `lib/extract.ts`, `lib/gap.ts`, `lib/fx.ts`, `lib/match.ts`, `lib/agent/*`,
  `app/api/upload/route.ts`, `app/api/reconcile/route.ts`, `app/api/matches/[id]/route.ts`,
  `scripts/generate-demo-data.ts`, `tests/*`.
- **Frontend edits (swap mock → server data):** `app/page.tsx`, `app/board/page.tsx`,
  `app/followups/page.tsx`, `app/settings/page.tsx`, `components/sidebar.tsx`,
  `components/match-dialog.tsx`.
- **Reused as the server↔client contract:** `lib/format.ts`, and the types in
  `lib/demo-data.ts` (`BoardRow`, `MatchDetail`, `FileRow`, `Followup`, `Status`).
