import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fxRates } from "@/db/schema";

// Mid-market (ECB reference) rates. In demo mode we use fixed rates that MATCH
// scripts/generate-demo-data.ts, so the gap breakdown reproduces the invoice
// figures exactly. In live mode (FX_MODE=live) we call Frankfurter and cache.

export const DEMO_MIDS: Record<string, number> = {
  USD: 84.95,
  EUR: 91.5,
  GBP: 107.2,
};

const isLive = () => process.env.FX_MODE === "live";

function previousBusinessDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay();
  if (day === 0) d.setUTCDate(d.getUTCDate() - 2); // Sunday → Friday
  else if (day === 6) d.setUTCDate(d.getUTCDate() - 1); // Saturday → Friday
  return d.toISOString().slice(0, 10);
}

/** Mid-market rate from `base` to INR on `date` (YYYY-MM-DD). */
export async function getMidRate(date: string, base: string): Promise<number> {
  const quote = "INR";

  if (!isLive()) {
    const r = DEMO_MIDS[base];
    if (r == null) throw new Error(`No demo mid rate for ${base}`);
    return r;
  }

  const day = previousBusinessDay(date);

  const cached = await db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.date, day), eq(fxRates.base, base), eq(fxRates.quote, quote)))
    .limit(1);
  if (cached.length) return Number(cached[0].rate);

  const url = `https://api.frankfurter.dev/v1/${day}?base=${base}&symbols=${quote}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const json = (await res.json()) as { rates?: Record<string, number> };
  const rate = json.rates?.[quote];
  if (rate == null) throw new Error(`No ${quote} rate for ${base} on ${day}`);

  await db.insert(fxRates).values({ date: day, base, quote, rate: String(rate) });
  return rate;
}
