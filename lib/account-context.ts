import { AsyncLocalStorage } from "node:async_hooks";

// Carries the current account through a request so the single LLM chokepoint
// (lib/llm.ts) can attribute spend and enforce the per-account cap without
// every caller having to thread a userId. CLI scripts run outside any context,
// so their calls are attributed to no account (null) and bounded only by the
// global cap (and, for the benchmark, its own $5 self-limit).
type AccountCtx = { userId: string };

const storage = new AsyncLocalStorage<AccountCtx>();

/** Run `fn` with the given account bound as the current billing context. */
export function withAccount<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ userId }, fn);
}

/** The account the current call should be billed to, or null outside a request. */
export function currentAccountId(): string | null {
  return storage.getStore()?.userId ?? null;
}
