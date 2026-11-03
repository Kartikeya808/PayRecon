# PayRecon — Payment Reconciliation Agent

**Live demo:** https://payrecon-ai.vercel.app · **Video:** _&lt;add your video link&gt;_

Freelancers and small studios invoicing overseas clients get paid in a foreign
currency, but what lands in their home account (USD) rarely matches the invoice:
intermediary banks skim fees, the FX rate carries a spread, and bank charges come
off the top. PayRecon ingests invoices and bank/platform statements, matches
payments to invoices, and explains **exactly where every dollar went** — then
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

## Built during the hackathon

Developed locally from **29 Oct 2026** and pushed to this repository on
**2 Nov 2026**; `BUILD_LOG.md` is the dated record of how it came together.

Built from scratch for this event:

- **Document extraction** — invoices and bank/platform statements read by Muse Spark 1.3.
- **Deterministic matching** — rule-based payment-to-invoice matching, no model calls.
- **Tool-using agent** — Muse Wonder 1.0 resolves the hard cases (split transfers, combined invoices, instalments, parent-company remitters) over a streamed tool loop.
- **Gap math + number validator** — pure, unit-tested `lib/gap.ts`; the validator rejects any model sentence that introduces a figure not in the computed breakdown.
- **Follow-ups** — friendly / firm draft emails for whatever is genuinely still owed.
- **Budget caps** — global, per-account, and benchmark spend limits enforced in `lib/llm.ts`.
- **Auth + "Try the demo"** — Better Auth email/password and a one-click shared demo account; API routes validate the session server-side.
- **FATURA benchmark harness** — `npm run eval` scores extraction against a held-out set.
- **UI** — the full Next.js app: board, match breakdowns, follow-ups, settings, and login.

Not ours:

- The open-source dependencies listed in `package.json`.
- The UI was designed with **Google Stitch** during the event.
- The **Inter** and **JetBrains Mono** fonts.

## Data and credits

- **Demo data is synthetic**, generated by `scripts/generate-demo-data.ts` — no real client or payment data.
- The extraction benchmark uses **FATURA** (Limam, Dhiaf, Kessentini; Digital Research Center of Sfax; CC BY 4.0; DOI [10.5281/zenodo.10371464](https://doi.org/10.5281/zenodo.10371464)), downloaded separately and **not redistributed** in this repository.
- FX reference rates come from the **ECB via Frankfurter**.

## Status

Live on Vercel + Neon — **[payrecon-ai.vercel.app](https://payrecon-ai.vercel.app)** —
with **"Try the demo"** open to visitors. The end-to-end loop
(upload → auto-match → explain → follow-up) runs on the deployed app; every
protected API route validates the session server-side; and the shared demo
account carries its own spend cap. See `BUILD_LOG.md` for the dated build record.
