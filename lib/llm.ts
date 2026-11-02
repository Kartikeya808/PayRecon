import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { llmCalls, llmCache } from "@/db/schema";
import { currentAccountId } from "@/lib/account-context";

// ---------------------------------------------------------------------------
// The ONE place any model is called. Every call is logged (tokens + cost),
// capped by budget, cached by request hash, and short-circuited in stub mode.
// ---------------------------------------------------------------------------

export const MODELS = {
  spark: "muse-spark-1.3", // extraction
  wonder: "muse-wonder-1.0", // agent, explanations, follow-ups
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];
export type Purpose = "hello" | "extract" | "agent" | "explain" | "followup";

// Per-account spend ceiling. Applies to every authenticated account including
// the shared demo account — no single visitor can run up the bill. Independent
// of (and stricter than) the global MODEL_BUDGET_USD backstop.
export const PER_ACCOUNT_CAP_USD = 2;

// Every live call is token-bounded even when the caller omits maxTokens, so a
// runaway can't blow the budget. These are CEILINGS, not targets — the models
// are reasoning models (completion_tokens = hidden reasoning + answer), so the
// budget must cover both or we pay for reasoning and get empty content back.
// The model stops (finish=stop) well before the ceiling on normal inputs.
const MAX_TOKENS_BY_PURPOSE: Record<Purpose, number> = {
  hello: 500,
  extract: 3000, // vision reasoning + a full invoice JSON
  agent: 2000,
  explain: 1500,
  followup: 1500,
};

// Reasoning models accept reasoning_effort (low|medium|high). Low keeps cost
// and latency down with no quality loss on structured extraction / short prose.
// Override per deployment via MODEL_REASONING_EFFORT.
const DEFAULT_REASONING_EFFORT = (process.env.MODEL_REASONING_EFFORT ??
  "low") as "low" | "medium" | "high";

// USD per 1M tokens (PRD §9): in / cached / out.
const PRICING: Record<string, { in: number; cached: number; out: number }> = {
  "muse-wonder-1.0": { in: 4.0, cached: 0.2, out: 20.0 },
  "muse-spark-1.3": { in: 1.25, cached: 0.15, out: 4.25 },
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  [k: string]: unknown;
};

export type CompleteOptions = {
  model: ModelId;
  purpose: Purpose;
  messages: ChatMessage[];
  tools?: unknown;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
};

export type Usage = {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
};

export type CompleteResult = {
  content: string;
  usage: Usage;
  costUsd: number;
  cached: boolean;
  stubbed: boolean;
};

function costOf(model: string, u: Usage): number {
  const p = PRICING[model] ?? { in: 0, cached: 0, out: 0 };
  return (
    (u.inputTokens * p.in + u.cachedTokens * p.cached + u.outputTokens * p.out) /
    1_000_000
  );
}

function hashRequest(o: CompleteOptions): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        // Namespace by mode so stub fixtures are never served to a live call
        // (and vice-versa). Real re-uploads still dedupe within the same mode.
        mode: process.env.LLM_MODE ?? "stub",
        model: o.model,
        purpose: o.purpose,
        messages: o.messages,
        tools: o.tools ?? null,
      })
    )
    .digest("hex");
}

/** Total USD spent so far, read from llm_calls. */
export async function totalSpendUsd(): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls);
  return Number(row?.total ?? 0);
}

/** USD spent by a single account, read from llm_calls. */
export async function accountSpendUsd(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(sql`${llmCalls.userId} = ${userId}`);
  return Number(row?.total ?? 0);
}

/**
 * The spend ceiling. The user's settings cap is authoritative; the env var is
 * a hard backstop. We take the smaller so neither can be silently exceeded.
 */
async function budgetUsd(): Promise<number> {
  const envCap = Number(process.env.MODEL_BUDGET_USD ?? "100");
  try {
    const { getSettings } = await import("@/lib/settings");
    const s = await getSettings();
    const settingsCap = Number(s.spendingCapUsd);
    if (Number.isFinite(settingsCap) && settingsCap > 0) {
      return Math.min(envCap, settingsCap);
    }
  } catch {
    // settings unavailable — fall back to the env backstop
  }
  return envCap;
}

/** Deterministic fake response so the whole pipeline runs at $0 while developing. */
function stubResponse(o: CompleteOptions): string {
  switch (o.purpose) {
    case "hello":
      return `Hello from ${o.model} (stub mode).`;
    case "extract":
      return JSON.stringify({ stub: true, note: "extraction fixture" });
    case "agent":
      return JSON.stringify({ stub: true, note: "agent step fixture" });
    case "explain":
      return "Stub explanation — real prose is generated when LLM_MODE=live.";
    case "followup":
      return "Stub follow-up draft — real prose is generated when LLM_MODE=live.";
    default:
      return "stub";
  }
}

async function logCall(
  model: string,
  purpose: Purpose,
  usage: Usage,
  costUsd: number,
  userId: string | null
) {
  await db.insert(llmCalls).values({
    userId,
    model,
    purpose,
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedTokens,
    outputTokens: usage.outputTokens,
    costUsd: costUsd.toFixed(6),
  });
}

/** Standard tier only — Contributor-tier models may train on the data sent to
 *  them, which for this app is financial. Refuse them before any live call. */
function assertStandardTier(model: string): void {
  const tier = (process.env.MODEL_TIER ?? "standard").toLowerCase();
  if (tier === "contributor" || /contributor/i.test(model)) {
    throw new Error(
      `Refusing Contributor-tier model "${model}" (MODEL_TIER=${tier}): it may train on financial data. Use the standard tier.`
    );
  }
}

/**
 * Complete a model call. In stub mode returns a deterministic fixture ($0).
 * In live mode calls the Meta Model API (OpenAI-compatible), enforcing the
 * budget cap first and caching the response by request hash.
 */
export async function complete(o: CompleteOptions): Promise<CompleteResult> {
  const key = hashRequest(o);
  const accountId = currentAccountId();

  // 1. Cache hit — never re-call, never re-charge.
  const [hit] = await db
    .select()
    .from(llmCache)
    .where(sql`${llmCache.key} = ${key}`)
    .limit(1);
  if (hit) {
    const r = hit.response as { content: string; usage: Usage };
    return { ...r, costUsd: 0, cached: true, stubbed: false };
  }

  // 2. Stub mode — deterministic, free.
  if ((process.env.LLM_MODE ?? "stub") === "stub") {
    const content = stubResponse(o);
    const usage: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    await db.insert(llmCache).values({ key, response: { content, usage } });
    await logCall(o.model, o.purpose, usage, 0, accountId);
    return { content, usage, costUsd: 0, cached: false, stubbed: true };
  }

  // 3. Live mode — enforce caps + tier, then call the real endpoint.
  assertStandardTier(o.model);

  const spent = await totalSpendUsd();
  const cap = await budgetUsd();
  if (spent >= cap) {
    throw new Error(`Model budget exhausted: $${spent.toFixed(2)} / $${cap.toFixed(2)}`);
  }
  // Per-account cap — applies to every signed-in account, demo included.
  if (accountId) {
    const accountSpent = await accountSpendUsd(accountId);
    if (accountSpent >= PER_ACCOUNT_CAP_USD) {
      throw new Error(
        `Account budget exhausted: $${accountSpent.toFixed(2)} / $${PER_ACCOUNT_CAP_USD.toFixed(2)}`
      );
    }
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.MODEL_API_KEY,
    baseURL: process.env.MODEL_BASE_URL,
  });

  const res = await client.chat.completions.create({
    model: o.model,
    messages: o.messages as never,
    max_tokens: o.maxTokens ?? MAX_TOKENS_BY_PURPOSE[o.purpose],
    temperature: o.temperature,
    reasoning_effort: o.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    ...(o.tools ? { tools: o.tools as never } : {}),
  } as never);

  const content = res.choices[0]?.message?.content ?? "";
  const finish = res.choices[0]?.finish_reason;
  const u = res.usage;
  const usage: Usage = {
    inputTokens: u?.prompt_tokens ?? 0,
    cachedTokens:
      (u?.prompt_tokens_details as { cached_tokens?: number } | undefined)
        ?.cached_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
  };
  // Cached tokens shouldn't be double-counted as full-price input.
  usage.inputTokens = Math.max(0, usage.inputTokens - usage.cachedTokens);

  const costUsd = costOf(o.model, usage);
  // Always log the spend (it happened), but never cache a failed generation —
  // an empty or length-truncated reply would otherwise be served forever. These
  // are reasoning models: `length` means the budget was spent on reasoning
  // before any answer, so the fix is a higher max_tokens, not a cached failure.
  // We return the (empty) content so each caller's own handling applies —
  // explain() falls back to its trusted template, extraction surfaces a parse
  // error — rather than masking the failure here.
  const usable = content.trim().length > 0 && finish !== "length";
  if (usable) await db.insert(llmCache).values({ key, response: { content, usage } });
  await logCall(o.model, o.purpose, usage, costUsd, accountId);

  return { content, usage, costUsd, cached: false, stubbed: false };
}
