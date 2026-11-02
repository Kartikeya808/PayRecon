import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings as settingsT } from "@/db/schema";

// ---------------------------------------------------------------------------
// User settings — a single JSON row (id = 1). Profile feeds follow-up drafts;
// the fee allowance/share feed the gap classification (so changing them really
// moves what counts as a "normal cost"); the spending cap feeds the meter.
// ---------------------------------------------------------------------------

export type AppSettings = {
  fullName: string;
  businessName: string;
  replyTo: string;
  signAs: string;
  feeAllowanceFc: number; // typical fee allowance, invoice currency (gap feeCap)
  feeSharePct: number; // or this share of the invoice, whichever is larger
  homeCurrency: string;
  spendingCapUsd: number;
  autoConfirm: boolean; // auto-confirm agent matches at ≥0.9 confidence
};

export const DEFAULT_SETTINGS: AppSettings = {
  fullName: "Aarav Mehta",
  businessName: "Mehta Design Studio",
  replyTo: "aarav@mehtadesign.example",
  signAs: "Aarav",
  feeAllowanceFc: 50,
  feeSharePct: 3,
  homeCurrency: "INR",
  spendingCapUsd: 100,
  autoConfirm: false,
};

function coerce(data: Partial<AppSettings> | null | undefined): AppSettings {
  const d = data ?? {};
  return {
    fullName: String(d.fullName ?? DEFAULT_SETTINGS.fullName),
    businessName: String(d.businessName ?? DEFAULT_SETTINGS.businessName),
    replyTo: String(d.replyTo ?? DEFAULT_SETTINGS.replyTo),
    signAs: String(d.signAs ?? DEFAULT_SETTINGS.signAs),
    feeAllowanceFc: Number.isFinite(d.feeAllowanceFc) ? Number(d.feeAllowanceFc) : DEFAULT_SETTINGS.feeAllowanceFc,
    feeSharePct: Number.isFinite(d.feeSharePct) ? Number(d.feeSharePct) : DEFAULT_SETTINGS.feeSharePct,
    homeCurrency: String(d.homeCurrency ?? DEFAULT_SETTINGS.homeCurrency),
    spendingCapUsd: Number.isFinite(d.spendingCapUsd) ? Number(d.spendingCapUsd) : DEFAULT_SETTINGS.spendingCapUsd,
    autoConfirm: Boolean(d.autoConfirm ?? DEFAULT_SETTINGS.autoConfirm),
  };
}

/** Current settings, merged over defaults (so new fields are always present). */
export async function getSettings(): Promise<AppSettings> {
  const [row] = await db.select().from(settingsT).where(eq(settingsT.id, 1)).limit(1);
  return coerce(row?.data as Partial<AppSettings> | undefined);
}

/** Persist a patch; returns the full merged settings. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = coerce({ ...current, ...patch });
  const [existing] = await db.select().from(settingsT).where(eq(settingsT.id, 1)).limit(1);
  if (existing) {
    await db.update(settingsT).set({ data: next, updatedAt: new Date() }).where(eq(settingsT.id, 1));
  } else {
    await db.insert(settingsT).values({ id: 1, data: next });
  }
  return next;
}
