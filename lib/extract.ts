import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { complete, MODELS } from "@/lib/llm";

// Extraction (PRD §7). CSV statements are parsed deterministically in code
// (no model call). Invoices (PDF/image) and platform PDFs use Muse Spark 1.3
// in live mode; in stub mode we read the generated manifest as the fixture.

export type ExtractedInvoice = {
  invoice_number: string;
  client_name: string;
  client_email: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total_amount: number;
  bank_charges_terms: "OUR" | "SHA" | "BEN" | "unknown";
  field_confidence: Record<string, number>;
};

export type ExtractedLine = {
  value_date: string;
  credited_inr: number;
  foreign_currency: string | null;
  foreign_amount: number | null;
  applied_rate: number | null;
  remitter_name: string | null;
  reference: string | null;
  channel: "SWIFT" | "Wise" | "Payoneer" | "PayPal" | "Other";
  bank_charges_inr: number | null;
  raw_text: string;
};

export type ExtractResult =
  | { type: "invoice"; invoice: ExtractedInvoice; parsedInCode: false }
  | { type: "statement"; lines: ExtractedLine[]; parsedInCode: boolean };

// ---- manifest (stub fixture) -------------------------------------------------
let manifestCache: {
  invoices: Record<string, ExtractedInvoice & { kind: string }>;
  statements: Record<string, { kind: string; parser?: string; lines?: ExtractedLine[] }>;
} | null = null;

function manifest() {
  if (manifestCache) return manifestCache;
  // Defaults to the demo manifest; override with PMA_DATA_DIR to stub-seed
  // another dataset (e.g. PMA_DATA_DIR=data/test-scenario).
  const p = join(process.cwd(), process.env.PMA_DATA_DIR ?? join("data", "demo"), "manifest.json");
  manifestCache = existsSync(p)
    ? JSON.parse(readFileSync(p, "utf8"))
    : { invoices: {}, statements: {} };
  return manifestCache!;
}

// ---- CSV (always code-parsed) -----------------------------------------------
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsvStatement(text: string): ExtractedLine[] {
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length);
  if (rows.length < 2) return [];
  const header = splitCsvLine(rows[0]);
  const idx = (k: string) => header.indexOf(k);
  const num = (v: string): number | null => (v === "" ? null : Number(v));
  return rows.slice(1).map((r) => {
    const c = splitCsvLine(r);
    return {
      value_date: c[idx("value_date")],
      credited_inr: Number(c[idx("credited_inr")]),
      foreign_currency: c[idx("foreign_currency")] || null,
      foreign_amount: num(c[idx("foreign_amount")]),
      applied_rate: num(c[idx("applied_rate")]),
      remitter_name: c[idx("remitter_name")] || null,
      reference: c[idx("reference")] || null,
      channel: (c[idx("channel")] || "Other") as ExtractedLine["channel"],
      bank_charges_inr: num(c[idx("bank_charges_inr")]),
      raw_text: c[idx("narration")] || r,
    };
  });
}

const isStub = () => (process.env.LLM_MODE ?? "stub") === "stub";

// ---- live invoice extraction (vision) ---------------------------------------

const INVOICE_EXTRACT_PROMPT = `You are an invoice data extractor. Read the invoice image and return ONLY a JSON object (no prose, no code fences) with exactly these keys:
{
  "invoice_number": string,          // the invoice id EXACTLY as printed incl. any letters/slashes/dashes; drop only the label word (e.g. "Invoice No:")
  "client_name": string|null,        // who the invoice is billed TO (buyer / bill-to), not the seller
  "client_email": string|null,       // the buyer's email if shown, else null
  "issue_date": string,              // invoice date as YYYY-MM-DD
  "due_date": string|null,           // due date as YYYY-MM-DD, else null
  "currency": string,                // ISO 4217 code, e.g. USD, EUR, INR
  "total_amount": number,            // grand total as a number, no currency symbol or thousands separators
  "bank_charges_terms": "OUR"|"SHA"|"BEN"|"unknown"
}
Use null when a field is absent. Dates MUST be YYYY-MM-DD. Do not invent values.`;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", pdf: "application/pdf",
};

function imageDataUri(filename: string, bytes: Buffer): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const mime = MIME_BY_EXT[ext] ?? "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** Tolerant JSON parse: strips ```json fences and leading/trailing prose. */
export function parseInvoice(raw: string): ExtractedInvoice {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  else {
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
  }
  const o = JSON.parse(s) as Partial<ExtractedInvoice>;
  return {
    invoice_number: String(o.invoice_number ?? ""),
    client_name: o.client_name ?? "",
    client_email: o.client_email ?? null,
    issue_date: o.issue_date ?? "",
    due_date: o.due_date ?? null,
    currency: (o.currency ?? "USD").toString().toUpperCase(),
    total_amount: Number(o.total_amount ?? 0),
    bank_charges_terms: (o.bank_charges_terms ?? "unknown") as ExtractedInvoice["bank_charges_terms"],
    field_confidence: o.field_confidence ?? {},
  };
}

export async function extract(
  filename: string,
  kind: "invoice" | "statement",
  bytes: Buffer
): Promise<ExtractResult> {
  const lower = filename.toLowerCase();

  // CSV → deterministic, no model.
  if (lower.endsWith(".csv")) {
    return { type: "statement", lines: parseCsvStatement(bytes.toString("utf8")), parsedInCode: true };
  }

  if (kind === "invoice") {
    if (isStub()) {
      const m = manifest().invoices[filename];
      if (m) {
        const { kind: _k, ...inv } = m;
        return { type: "invoice", invoice: inv, parsedInCode: false };
      }
      // Unknown file in stub mode — minimal placeholder.
      return {
        type: "invoice",
        parsedInCode: false,
        invoice: {
          invoice_number: filename,
          client_name: "Unknown",
          client_email: null,
          issue_date: "",
          due_date: null,
          currency: "USD",
          total_amount: 0,
          bank_charges_terms: "unknown",
          field_confidence: {},
        },
      };
    }
    const res = await complete({
      model: MODELS.spark,
      purpose: "extract",
      messages: [
        {
          role: "user",
          // Vision input: the model sees the actual invoice image, not just its
          // filename. Content is an OpenAI-compatible multimodal array.
          content: [
            { type: "text", text: INVOICE_EXTRACT_PROMPT },
            { type: "image_url", image_url: { url: imageDataUri(filename, bytes) } },
          ],
        } as unknown as import("@/lib/llm").ChatMessage,
      ],
    });
    return { type: "invoice", invoice: parseInvoice(res.content), parsedInCode: false };
  }

  // statement (PDF/platform)
  if (isStub()) {
    const m = manifest().statements[filename];
    return { type: "statement", lines: m?.lines ?? [], parsedInCode: false };
  }
  const res = await complete({
    model: MODELS.spark,
    purpose: "extract",
    messages: [{ role: "user", content: `Extract credit lines as JSON from ${filename}.` }],
  });
  return { type: "statement", lines: JSON.parse(res.content).lines ?? [], parsedInCode: false };
}
