// FATURA extraction-evaluation toolkit (pure, no I/O side effects except the
// dataset reader). The dataset is seller-side invoices with ground-truth field
// text in `Annotations/Original_Format/*.json`. We normalize that text into the
// same canonical shape our extractor produces, then score field-by-field.
//
// Only fields FATURA actually annotates are scored. `client_email` and
// `bank_charges_terms` have no ground truth here, so they are reported as
// "not covered" rather than graded (see UNCOVERED_FIELDS).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtractedInvoice } from "@/lib/extract";

export const DATASET_DIR = join(
  process.cwd(),
  "data",
  "invoices_dataset_final"
);

/** The subset of ExtractedInvoice that FATURA gives us ground truth for. */
export type ScoredField =
  | "invoice_number"
  | "client_name"
  | "issue_date"
  | "due_date"
  | "currency"
  | "total_amount";

export const SCORED_FIELDS: ScoredField[] = [
  "invoice_number",
  "client_name",
  "issue_date",
  "due_date",
  "currency",
  "total_amount",
];

/** ExtractedInvoice fields FATURA has no ground truth for — never graded. */
export const UNCOVERED_FIELDS = ["client_email", "bank_charges_terms"] as const;

/** Canonical ground truth: nulls mean "not present on this invoice". */
export type GroundTruth = {
  invoice_number: string | null;
  client_name: string | null;
  issue_date: string | null; // YYYY-MM-DD
  due_date: string | null; // YYYY-MM-DD
  currency: string | null; // ISO-ish, e.g. USD
  total_amount: number | null;
};

// ---- normalizers -------------------------------------------------------------

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parse FATURA dates ("Date: 01-Oct-2003", "Due Date : 06-Jul-2012") → ISO. */
export function parseDate(text: string | null | undefined): string | null {
  if (!text) return null;
  // DD-Mon-YYYY (FATURA's canonical form)
  let m = text.match(/(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
  }
  // Numeric DD-MM-YYYY / DD/MM/YYYY
  m = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // ISO YYYY-MM-DD already
  m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** "INVOICE ID 7199-209" / "Invoice number 1962-389" → "7199-209". */
export function parseInvoiceNumber(
  text: string | null | undefined
): string | null {
  if (!text) return null;
  // Prefer the last token that contains a digit (invoice ids end the string).
  const tokens = text.split(/[\s:#]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[^A-Za-z0-9\-/]/g, "");
    if (/\d/.test(t) && t.length >= 2) return t;
  }
  return null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY",
};

/** "TOTAL : 663.70 USD" / "DUE_AMOUNT : 567.96 EUR" / "... 20.25 $". */
export function parseMoney(
  text: string | null | undefined
): { amount: number | null; currency: string | null } {
  if (!text) return { amount: null, currency: null };
  // Amount: last number with optional thousands separators / decimals.
  const nums = text.match(/-?\d[\d,]*\.?\d*/g);
  let amount: number | null = null;
  if (nums) {
    // Skip percentages like "(5.90%)" — take the largest magnitude number,
    // which is the money value rather than a rate.
    const cands = nums
      .map((n) => Number(n.replace(/,/g, "")))
      .filter((n) => Number.isFinite(n));
    if (cands.length) amount = cands.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  }
  let currency: string | null = null;
  const code = text.match(/\b(USD|EUR|GBP|INR|JPY|AUD|CAD|CHF|SGD|AED)\b/);
  if (code) currency = code[1];
  else {
    for (const [sym, iso] of Object.entries(CURRENCY_SYMBOLS)) {
      if (text.includes(sym)) { currency = iso; break; }
    }
  }
  return { amount, currency };
}

/** "Buyer :Timothy Rodriguez | 35..." / "BILL_TO: | Patricia Robertson | ...". */
export function parseName(text: string | null | undefined): string | null {
  if (!text) return null;
  // Strip leading label, then take the first non-empty line/segment that looks
  // like a name (letters, not an address with a street number).
  let s = text.replace(/^\s*(buyer|bill[_\s]*to|ship[_\s]*to|send[_\s]*to)\s*:?/i, "");
  const segments = s.split(/\n|\|/).map((x) => x.trim()).filter(Boolean);
  for (const seg of segments) {
    if (/\d{2,}/.test(seg)) continue; // address line
    if (/[A-Za-z]{2,}/.test(seg)) return seg;
  }
  return segments[0] ?? null;
}

// ---- ground-truth loader -----------------------------------------------------

type RawAnnotation = Record<string, { text?: string } | unknown>;

function textOf(ann: RawAnnotation, key: string): string | null {
  const v = ann[key];
  if (v && typeof v === "object" && "text" in v) {
    const t = (v as { text?: unknown }).text;
    return typeof t === "string" ? t : null;
  }
  return null;
}

export function groundTruthFromAnnotation(ann: RawAnnotation): GroundTruth {
  const money = parseMoney(textOf(ann, "TOTAL"));
  return {
    invoice_number: parseInvoiceNumber(textOf(ann, "NUMBER")),
    client_name: parseName(textOf(ann, "BUYER") ?? textOf(ann, "BILL_TO")),
    issue_date: parseDate(textOf(ann, "DATE")),
    due_date: parseDate(textOf(ann, "DUE_DATE")),
    currency: money.currency,
    total_amount: money.amount,
  };
}

// ---- dataset access ----------------------------------------------------------

export type Split = "train" | "dev" | "test";

export type DatasetRow = { imgPath: string; annotPath: string };

export function loadSplit(split: Split): DatasetRow[] {
  const csv = join(DATASET_DIR, `strat1_${split}.csv`);
  const text = readFileSync(csv, "utf8");
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  return rows.slice(1).map((r) => {
    const [img, annot] = r.split(",");
    return { imgPath: img.trim(), annotPath: annot.trim() };
  });
}

export function readAnnotation(annotFile: string): RawAnnotation {
  const p = join(DATASET_DIR, "Annotations", "Original_Format", annotFile);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function readImageBytes(imgFile: string): Buffer {
  const p = join(DATASET_DIR, "images", imgFile);
  if (!existsSync(p)) throw new Error(`image not found: ${p}`);
  return readFileSync(p);
}

// ---- comparators -------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function nameMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Tolerate one side carrying extra context (e.g. a title or suffix).
  return na.includes(nb) || nb.includes(na);
}

/**
 * Compare a predicted field to ground truth. Returns null when the field is
 * out of scope for this invoice (no GT value) — such fields don't count toward
 * support or accuracy.
 */
export function fieldMatch(
  field: ScoredField,
  gt: GroundTruth,
  pred: Partial<ExtractedInvoice>
): boolean | null {
  const expected = gt[field];
  if (expected === null || expected === undefined) return null;

  switch (field) {
    case "invoice_number": {
      const p = pred.invoice_number;
      return p != null && norm(String(p)) === norm(String(expected));
    }
    case "client_name": {
      const p = pred.client_name;
      return p != null && nameMatch(String(p), String(expected));
    }
    case "issue_date":
      return pred.issue_date != null && pred.issue_date === expected;
    case "due_date":
      return pred.due_date != null && pred.due_date === expected;
    case "currency": {
      const p = pred.currency;
      return p != null && String(p).toUpperCase() === String(expected).toUpperCase();
    }
    case "total_amount": {
      const p = pred.total_amount;
      if (p == null) return false;
      // Money must match to the cent — both sides come from the printed total.
      return Math.abs(Number(p) - Number(expected)) < 0.01;
    }
  }
}

// ---- scoring -----------------------------------------------------------------

export type FieldTally = {
  support: number; // invoices where GT had a value
  present: number; // of those, extractor produced a non-null value
  correct: number; // of those, value matched
};

export type Report = {
  n: number;
  perField: Record<ScoredField, FieldTally>;
  overall: { support: number; correct: number; accuracy: number };
  presentRate: number;
};

export function emptyReport(): Report {
  const perField = {} as Record<ScoredField, FieldTally>;
  for (const f of SCORED_FIELDS) perField[f] = { support: 0, present: 0, correct: 0 };
  return { n: 0, perField, overall: { support: 0, correct: 0, accuracy: 0 }, presentRate: 0 };
}

function isPresent(field: ScoredField, pred: Partial<ExtractedInvoice>): boolean {
  const v = pred[field];
  return v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
}

export function tally(
  report: Report,
  gt: GroundTruth,
  pred: Partial<ExtractedInvoice>
): void {
  report.n += 1;
  for (const f of SCORED_FIELDS) {
    const res = fieldMatch(f, gt, pred);
    if (res === null) continue; // no GT → out of scope
    const t = report.perField[f];
    t.support += 1;
    if (isPresent(f, pred)) t.present += 1;
    if (res) t.correct += 1;
  }
}

export function finalize(report: Report): Report {
  let support = 0, correct = 0, present = 0;
  for (const f of SCORED_FIELDS) {
    const t = report.perField[f];
    support += t.support;
    correct += t.correct;
    present += t.present;
  }
  report.overall = {
    support,
    correct,
    accuracy: support ? correct / support : 0,
  };
  report.presentRate = support ? present / support : 0;
  return report;
}
