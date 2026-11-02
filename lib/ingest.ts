import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, invoices, payments } from "@/db/schema";
import { putFile } from "@/lib/storage";
import { extract } from "@/lib/extract";

export type IngestResult = {
  documentId: number;
  filename: string;
  cached: boolean; // true = same file SHA already ingested, skipped re-extraction
  status: string;
  error?: string; // set when extraction failed (e.g. an unsupported file type)
};

const INVOICE_FIELDS = [
  "invoice_number",
  "client_name",
  "currency",
  "total_amount",
  "issue_date",
  "due_date",
  "bank_charges_terms",
] as const;

/**
 * Store a file, extract it, and persist invoices/payments. Idempotent by SHA:
 * re-uploading the same bytes short-circuits (no re-extraction, no model calls).
 */
export async function ingestFile(
  filename: string,
  kind: "invoice" | "statement",
  bytes: Buffer
): Promise<IngestResult> {
  const sha = createHash("sha256").update(bytes).digest("hex");

  const existing = await db
    .select()
    .from(documents)
    .where(eq(documents.sha256, sha))
    .limit(1);
  if (existing.length) {
    return {
      documentId: existing[0].id,
      filename,
      cached: true,
      status: existing[0].status,
    };
  }

  const url = await putFile(sha, filename, bytes);

  const [doc] = await db
    .insert(documents)
    .values({ kind, filename, sha256: sha, blobUrl: url, status: "reading" })
    .returning();

  // Extraction can fail (e.g. a PDF sent to the image-only vision model). Keep
  // it per-file: mark this document "error" and return, so one bad file never
  // crashes the whole upload batch and the file list shows what happened.
  let result;
  try {
    result = await extract(filename, kind, bytes);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(documents)
      .set({ status: "error", extractedJson: { error: message } })
      .where(eq(documents.id, doc.id));
    return { documentId: doc.id, filename, cached: false, status: "error", error: message };
  }

  let status: "done" | "needs_attention" = "done";
  let summary: Record<string, unknown> = {};

  if (result.type === "invoice") {
    const inv = result.invoice;
    const fieldsFound = INVOICE_FIELDS.filter(
      (f) => (inv as Record<string, unknown>)[f] != null && (inv as Record<string, unknown>)[f] !== ""
    ).length;
    const lowConf = Object.values(inv.field_confidence ?? {}).some((c) => c < 0.7);
    if (fieldsFound < INVOICE_FIELDS.length || lowConf) status = "needs_attention";

    await db.insert(invoices).values({
      documentId: doc.id,
      invoiceNumber: inv.invoice_number,
      clientName: inv.client_name,
      clientEmail: inv.client_email,
      issueDate: inv.issue_date || null,
      dueDate: inv.due_date,
      currency: inv.currency,
      amount: inv.total_amount != null ? String(inv.total_amount) : null,
      bankChargesTerms: inv.bank_charges_terms,
      fieldConfidence: inv.field_confidence,
    });
    summary = {
      kind: "invoice",
      fieldsFound,
      fieldsTotal: INVOICE_FIELDS.length,
      lowConfidence: lowConf,
      parsedInCode: false,
    };
  } else {
    const lines = result.lines;
    if (lines.length) {
      await db.insert(payments).values(
        lines.map((l) => ({
          documentId: doc.id,
          valueDate: l.value_date || null,
          creditedInr: l.credited_inr != null ? String(l.credited_inr) : null,
          foreignCurrency: l.foreign_currency,
          foreignAmount: l.foreign_amount != null ? String(l.foreign_amount) : null,
          appliedRate: l.applied_rate != null ? String(l.applied_rate) : null,
          remitterName: l.remitter_name,
          reference: l.reference,
          channel: l.channel,
          bankChargesInr: l.bank_charges_inr != null ? String(l.bank_charges_inr) : null,
          rawText: l.raw_text,
        }))
      );
    }
    summary = { kind: "statement", credits: lines.length, parsedInCode: result.parsedInCode };
  }

  await db
    .update(documents)
    .set({ status, extractedJson: summary })
    .where(eq(documents.id, doc.id));

  return { documentId: doc.id, filename, cached: false, status };
}
