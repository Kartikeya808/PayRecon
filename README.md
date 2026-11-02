# PayRecon — Payment Reconciliation Agent

Freelancers and small studios invoicing overseas clients get paid in foreign
currency, but what lands in their INR account rarely matches the invoice:
intermediary banks skim fees, the FX rate carries a spread, and bank charges +
GST come off the top. PayRecon ingests invoices and bank/platform statements, matches
payments to invoices, and explains **exactly where every penny went** — then
drafts the follow-up emails for whatever is genuinely still owed.

Built for the **Meta AI Dev Hackathon** around one end-to-end loop:
**upload → auto-match → explain the gap → draft follow-up.**

## The golden rule

**Money math is done in code, never by the model.** Every figure on screen comes
from pure, unit-tested TypeScript (`lib/gap.ts`). The model only:

- **reads** documents (extraction, Muse Spark 1.3),
- **resolves** the hard matches via a tool-using agent (Muse Wonder 1.0), and
- **writes** plain-language explanations and follow-ups.

A **number validator** rejects any model-written sentence that introduces a
figure not already in the computed breakdown — the credibility story for a
financial tool.

## Stack

- **Next.js** (App Router) + **Tailwind v4** — RSC embed data in the first paint;
  API routes handle uploads and the SSE reconcile stream; interactive pieces are
  client islands.
- **Neon Postgres** via **Drizzle** (`pg`) — single source of truth, same engine
  local and in prod.
- **Better Auth** — email/password + a one-click **"Try the demo"** account
  (Google appears once creds exist). `middleware.ts` gates the app.
- **Meta Model API** (OpenAI-compatible) through one wrapper (`lib/llm.ts`) that
  logs every call's tokens + cost, caches by request SHA, and **refuses calls
  once spend passes the cap**.
- Files on **Vercel Blob**; FX from **Frankfurter** (ECB reference rates).

## How it fits together

```
upload → /api/upload → Blob + documents row → extract.ts → invoices/payments
reconcile → /api/reconcile (SSE) → match.ts (rules) → agent tool loop → board
open a match → /api/matches/[id] → gap breakdown + validated explanation
partial / recoverable → follow-up drafts (friendly / firm)
```

Deterministic-first: CSV parsing, matching, and gap math make **no model calls**
and are instant; the agent only runs on the few hard cases (split transfers,
combined invoices, instalments, parent-company remitters), streamed live over SSE
so you can watch each tool call.

## Running it

```bash
npm install
npm run generate-demo-data   # 20 invoices + 2 statements + answer key (deterministic)
npm run db:push              # create tables in Neon
npm run seed                 # ingest the demo files
npm run reconcile            # deterministic pass, scored vs the answer key
npm run agent                # full pass (rules + agent), scored 21/21
npm test                     # gap math: worked example + sum invariant (1,000 cases)
npm run dev                  # http://localhost:3001  → "Try the demo"
```

Everything above runs **stub-first at $0** (`LLM_MODE=stub`): deterministic
fixtures, real pipeline. The whole app is clickable without spending a cent.

### Going live

Flip these in `.env.local` (keep the budget headroom):

```
LLM_MODE=live
MODEL_API_KEY=…            # Meta Model API key
MODEL_BASE_URL=…           # OpenAI-compatible endpoint
MODEL_TIER=standard        # standard tier only — Contributor is refused (see below)
FX_MODE=live               # real ECB rates via Frankfurter
```

**Guardrails (all enforced in `lib/llm.ts`, proven at $0 by `npm run budget-check`):**

- **Global cap — $100.** `MODEL_BUDGET_USD` backstop min'd with the Settings cap;
  once logged spend reaches it, calls throw before any network request.
- **Per-account cap — $2**, for every signed-in account *including the shared demo
  account*. Requests run inside an account billing context (`lib/account-context.ts`)
  so no single visitor can run up the bill.
- **Benchmark cap — $5.** `npm run eval` stops itself after $5 of live spend,
  independent of the global cap.
- **Bounded generations.** Every live call carries a per-purpose `max_tokens`; the
  agent resolves at most **20 payments (tool turns)** per run.
- **Free duplicates.** Identical requests (e.g. a re-uploaded file) hit the SHA-256
  response cache and cost nothing.
- **Standard tier only.** Contributor-tier models may train on the financial data we
  send them, so a live call is refused when `MODEL_TIER=contributor` (or the model id
  looks like a Contributor model).

## Scripts

| Script | What it does |
|---|---|
| `npm run generate-demo-data` | Rights-clean synthetic invoices + statements + answer key |
| `npm run seed` | Ingest the demo files into Neon |
| `npm run reconcile` | Deterministic pass, scored vs answer key |
| `npm run agent` | Full reconcile (rules + agent), scored vs answer key |
| `npm run budget-check` | Prove the spend cap refuses calls past the cap ($0) |
| `npm test` | Vitest — gap math worked example + sum invariant |
| `npm run hello` | One call to each model (writes a cost row) |

## Status

Backend phases 0–8 complete and verified against the answer key (see
`BUILD_LOG.md` and `BACKEND_INTEGRATION.md`). Phase 9 is deployment to Vercel +
Neon main branch.
