// Phase 1 — synthetic, rights-clean demo data (PRD §10). Deterministic.
// Produces: 20 invoices (3 as PNG "photos") + 2 statements (CSV + platform PDF),
// plus manifest.json (extraction ground truth) and answer_key.json (match truth).
//
// Run: npm run generate-demo-data
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { createCanvas } from "@napi-rs/canvas";

// ---------------------------------------------------------------- RNG (seeded)
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261029);

const DEMO = join(process.cwd(), "data", "demo");
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- mid rates
const MID: Record<string, number> = { USD: 84.95, EUR: 91.5, GBP: 107.2 };

type Invoice = {
  file: string; // filename
  photo: boolean;
  invoice_number: string;
  client_name: string;
  client_email: string;
  issue_date: string;
  due_date: string;
  currency: string;
  total_amount: number;
  bank_charges_terms: "OUR" | "SHA" | "BEN" | "unknown";
  field_confidence: Record<string, number>;
  lowConfidence?: string;
};

type Payment = {
  on: "csv" | "platform";
  value_date: string;
  remitter_name: string;
  reference: string;
  channel: string;
  foreign_currency: string | null;
  foreign_amount: number | null;
  applied_rate: number | null;
  credited_inr: number;
  bank_charges_inr: number | null;
  raw_text: string;
  // answer-key truth:
  expect_invoices: string[]; // invoice_numbers, [] = unmatched
  classification:
    | "fully_paid"
    | "paid_with_costs"
    | "partial"
    | "needs_review"
    | "unmatched";
};

// ---------------------------------------------------------------- invoices
function inv(
  n: number,
  client: string,
  email: string,
  currency: string,
  amount: number,
  opts: { photo?: boolean; terms?: Invoice["bank_charges_terms"]; low?: string } = {}
): Invoice {
  const num = `INV-2026-${String(n).padStart(3, "0")}`;
  const issueDay = 2 + ((n * 2) % 20); // Sep
  const issue = `2026-09-${String(issueDay).padStart(2, "0")}`;
  const due = `2026-10-${String(issueDay).padStart(2, "0")}`;
  const conf: Record<string, number> = {
    invoice_number: 1,
    client_name: 1,
    currency: 1,
    total_amount: 1,
    issue_date: 1,
    due_date: opts.low ? 0.52 : 1,
    bank_charges_terms: 1,
  };
  return {
    file: `${num}.${opts.photo ? "png" : "pdf"}`,
    photo: !!opts.photo,
    invoice_number: num,
    client_name: client,
    client_email: email,
    issue_date: issue,
    due_date: due,
    currency,
    total_amount: amount,
    bank_charges_terms: opts.terms ?? "SHA",
    field_confidence: conf,
    lowConfidence: opts.low,
  };
}

const HAL = ["Halcyon Analytics LLC", "accounts@halcyon.example"];
const JUN = ["Juniper Ridge Inc.", "accounts@juniperridge.example"];
const BRI = ["Brightfold GmbH", "buchhaltung@brightfold.example"];
const MAR = ["Marlowe & Finch LLP", "ap@marlowefinch.example"];
const LAR = ["Larkspur Studio", "hello@larkspur.example"];
const ORT = ["Ortolan Media", "finance@ortolan.example"];

const invoices: Invoice[] = [
  inv(1, HAL[0], HAL[1], "USD", 2000),
  inv(2, BRI[0], BRI[1], "EUR", 1500),
  inv(3, LAR[0], LAR[1], "USD", 1200, { photo: true }),
  inv(4, ORT[0], ORT[1], "USD", 900),
  inv(5, MAR[0], MAR[1], "GBP", 800),
  inv(6, HAL[0], HAL[1], "USD", 2500),
  inv(7, JUN[0], JUN[1], "USD", 1800),
  inv(8, BRI[0], BRI[1], "EUR", 1100),
  inv(9, MAR[0], MAR[1], "GBP", 1400, { photo: true }),
  inv(10, LAR[0], LAR[1], "USD", 1600),
  inv(11, ORT[0], ORT[1], "USD", 1300),
  inv(12, JUN[0], JUN[1], "USD", 2200),
  inv(13, JUN[0], JUN[1], "USD", 3000), // partial, owed 400
  inv(14, MAR[0], MAR[1], "GBP", 1500), // partial, owed 180
  inv(15, HAL[0], HAL[1], "USD", 1700, { photo: true, low: "due_date" }), // partial + needs attention
  inv(16, BRI[0], BRI[1], "EUR", 600), // combined w/ 17
  inv(17, BRI[0], BRI[1], "EUR", 580), // combined w/ 16
  inv(18, LAR[0], LAR[1], "USD", 700), // combined w/ 19
  inv(19, LAR[0], LAR[1], "USD", 750), // combined w/ 18
  inv(20, ORT[0], ORT[1], "USD", 2400, { terms: "OUR" }), // two instalments
];
const byNum = (num: string) => invoices.find((i) => i.invoice_number === num)!;

// ---------------------------------------------------------------- payments
const CHAN: Record<string, string> = {
  "Halcyon Analytics LLC": "SWIFT",
  "Juniper Ridge Inc.": "SWIFT",
  "Brightfold GmbH": "Wise",
  "Marlowe & Finch LLP": "SWIFT",
  "Larkspur Studio": "Payoneer",
  "Ortolan Media": "PayPal",
};

const payments: Payment[] = [];

function pushPaid(
  num: string,
  day: number,
  opts: { remitter?: string; noRef?: boolean; feeFc?: number } = {}
) {
  const i = byNum(num);
  const mid = MID[i.currency];
  const feeFc = opts.feeFc ?? (i.currency === "USD" ? 25 : i.currency === "EUR" ? 20 : 15);
  const F = round2(i.total_amount - feeFc);
  const rate = round2(mid - (i.currency === "GBP" ? 1.1 : 0.85));
  const charges = 590;
  const credited = round2(F * rate - charges);
  const remitter = opts.remitter ?? i.client_name;
  const ref = opts.noRef ? `PYMT ${1000 + day}` : i.invoice_number;
  payments.push({
    on: "csv",
    value_date: `2026-10-${String(day).padStart(2, "0")}`,
    remitter_name: remitter,
    reference: ref,
    channel: CHAN[i.client_name],
    foreign_currency: i.currency,
    foreign_amount: F,
    applied_rate: rate,
    credited_inr: credited,
    bank_charges_inr: charges,
    raw_text: `${day} OCT · INWARD REMIT · ${remitter.toUpperCase()} · ${i.currency} ${F.toFixed(2)} @ ${rate} · REF ${ref}`,
    expect_invoices: [num],
    classification: "paid_with_costs",
  });
}

// 12 clean paid-with-costs
pushPaid("INV-2026-001", 14, { remitter: "Kestrel Holdings Ltd" }); // parent company
pushPaid("INV-2026-002", 13, { remitter: "Brightfold Holding GmbH" }); // parent company
pushPaid("INV-2026-003", 12, { noRef: true }); // no invoice number in ref
pushPaid("INV-2026-004", 11, { noRef: true });
pushPaid("INV-2026-005", 10, { noRef: true });
pushPaid("INV-2026-006", 9);
pushPaid("INV-2026-007", 8);
pushPaid("INV-2026-008", 7);
pushPaid("INV-2026-009", 6);
pushPaid("INV-2026-010", 5);
pushPaid("INV-2026-011", 4);
pushPaid("INV-2026-012", 3);

// 3 partial
function pushPartial(num: string, day: number, owedFc: number) {
  const i = byNum(num);
  const mid = MID[i.currency];
  const typicalFee = 50;
  const F = round2(i.total_amount - owedFc - typicalFee);
  const rate = round2(mid - 0.45);
  const charges = 590;
  const credited = round2(F * rate - charges);
  payments.push({
    on: "csv",
    value_date: `2026-10-${String(day).padStart(2, "0")}`,
    remitter_name: i.client_name,
    reference: i.invoice_number,
    channel: CHAN[i.client_name],
    foreign_currency: i.currency,
    foreign_amount: F,
    applied_rate: rate,
    credited_inr: credited,
    bank_charges_inr: charges,
    raw_text: `${day} OCT · INWARD REMIT · ${i.client_name.toUpperCase()} · ${i.currency} ${F.toFixed(2)} @ ${rate} · REF ${i.invoice_number}`,
    expect_invoices: [num],
    classification: "partial",
  });
}
pushPartial("INV-2026-013", 12, 400);
pushPartial("INV-2026-014", 11, 180);
pushPartial("INV-2026-015", 15, 300);

// 2 combined (one payment covers two invoices)
function pushCombined(nums: string[], day: number, on: Payment["on"]) {
  const is = nums.map(byNum);
  const cur = is[0].currency;
  const mid = MID[cur];
  const total = is.reduce((s, i) => s + i.total_amount, 0);
  const F = round2(total - 25);
  const rate = round2(mid - 0.85);
  const charges = 590;
  const credited = round2(F * rate - charges);
  const client = is[0].client_name;
  const ref = nums.join(" ");
  payments.push({
    on,
    value_date: `2026-10-${String(day).padStart(2, "0")}`,
    remitter_name: client,
    reference: ref,
    channel: CHAN[client],
    foreign_currency: cur,
    foreign_amount: F,
    applied_rate: rate,
    credited_inr: credited,
    bank_charges_inr: charges,
    raw_text: `${day} OCT · INWARD REMIT · ${client.toUpperCase()} · ${cur} ${F.toFixed(2)} @ ${rate} · REF ${ref}`,
    expect_invoices: nums,
    classification: "paid_with_costs",
  });
}
pushCombined(["INV-2026-016", "INV-2026-017"], 10, "platform");
pushCombined(["INV-2026-018", "INV-2026-019"], 9, "platform");

// 2 instalments for one invoice (INV-020)
function pushInstalment(num: string, day: number, portion: number, on: Payment["on"]) {
  const i = byNum(num);
  const mid = MID[i.currency];
  const F = round2(portion - 20);
  const rate = round2(mid - 0.85);
  const charges = 295;
  const credited = round2(F * rate - charges);
  payments.push({
    on,
    value_date: `2026-10-${String(day).padStart(2, "0")}`,
    remitter_name: i.client_name,
    reference: `${i.invoice_number} INSTALMENT`,
    channel: CHAN[i.client_name],
    foreign_currency: i.currency,
    foreign_amount: F,
    applied_rate: rate,
    credited_inr: credited,
    bank_charges_inr: charges,
    raw_text: `${day} OCT · INWARD REMIT · ${i.client_name.toUpperCase()} · ${i.currency} ${F.toFixed(2)} @ ${rate} · REF ${i.invoice_number}`,
    expect_invoices: [num],
    classification: "paid_with_costs",
  });
}
pushInstalment("INV-2026-020", 8, 1200, "platform");
pushInstalment("INV-2026-020", 20, 1200, "platform");

// 2 unrelated credits (stay unmatched)
payments.push({
  on: "platform",
  value_date: "2026-10-03",
  remitter_name: "UPI REFUND 88213",
  reference: "UPI/88213",
  channel: "Other",
  foreign_currency: null,
  foreign_amount: null,
  applied_rate: null,
  credited_inr: 1250.0,
  bank_charges_inr: null,
  raw_text: "03 OCT · UPI REFUND 88213 · ₹1,250.00",
  expect_invoices: [],
  classification: "unmatched",
});
payments.push({
  on: "platform",
  value_date: "2026-10-02",
  remitter_name: "SAVINGS INTEREST",
  reference: "INT/Q3",
  channel: "Other",
  foreign_currency: null,
  foreign_amount: null,
  applied_rate: null,
  credited_inr: 430.0,
  bank_charges_inr: null,
  raw_text: "02 OCT · SAVINGS INTEREST · ₹430.00",
  expect_invoices: [],
  classification: "unmatched",
});

// ---------------------------------------------------------------- rendering
function renderInvoicePDF(i: Invoice): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    doc.info.CreationDate = new Date("2026-10-29T00:00:00Z");
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(26).text("INVOICE", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor("#555").text(`Mehta Design Studio`);
    doc.text(`GSTIN 27ABCDE1234F1Z5 · Pune, India`);
    doc.moveDown(1);

    doc.fillColor("#000").fontSize(14).text(i.invoice_number);
    doc.fontSize(11).fillColor("#555");
    doc.text(`Issued: ${i.issue_date}`);
    doc.text(`Due: ${i.due_date}`);
    doc.moveDown(1);

    doc.fillColor("#000").fontSize(12).text(`Bill to: ${i.client_name}`);
    doc.fontSize(11).fillColor("#555").text(i.client_email);
    doc.moveDown(1.5);

    doc.fillColor("#000").fontSize(12).text("Design and consulting services");
    doc.moveDown(0.5);
    doc
      .fontSize(18)
      .text(`Total: ${i.currency} ${i.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    doc.moveDown(1);
    doc
      .fontSize(10)
      .fillColor("#555")
      .text(`Bank charges terms: ${i.bank_charges_terms}`);
    doc.text("Please reference the invoice number with your payment.");
    doc.end();
  });
}

function renderInvoicePNG(i: Invoice): Buffer {
  const W = 840;
  const H = 1100;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  // paper
  ctx.fillStyle = "#fbfbf7";
  ctx.fillRect(0, 0, W, H);
  // slight rotation to mimic a photo
  ctx.translate(W / 2, H / 2);
  ctx.rotate((rand() - 0.5) * 0.05);
  ctx.translate(-W / 2, -H / 2);
  ctx.fillStyle = "#111";
  ctx.font = "bold 44px Arial";
  ctx.fillText("INVOICE", 64, 96);
  ctx.font = "22px Arial";
  ctx.fillStyle = "#333";
  ctx.fillText("Mehta Design Studio", 64, 150);
  ctx.fillStyle = "#111";
  ctx.font = "26px Arial";
  ctx.fillText(i.invoice_number, 64, 230);
  ctx.font = "20px Arial";
  ctx.fillStyle = "#333";
  ctx.fillText(`Issued: ${i.issue_date}`, 64, 270);
  ctx.fillText(
    i.lowConfidence === "due_date" ? "Due: (smudged)" : `Due: ${i.due_date}`,
    64,
    300
  );
  ctx.fillText(`Bill to: ${i.client_name}`, 64, 360);
  ctx.fillText(i.client_email, 64, 390);
  ctx.fillStyle = "#111";
  ctx.font = "bold 30px Arial";
  ctx.fillText(
    `Total: ${i.currency} ${i.total_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    64,
    470
  );
  ctx.font = "18px Arial";
  ctx.fillStyle = "#555";
  ctx.fillText(`Bank charges terms: ${i.bank_charges_terms}`, 64, 520);
  // noise
  const img = ctx.getImageData(0, 0, W, H);
  for (let p = 0; p < img.data.length; p += 4) {
    if (rand() < 0.04) {
      const n = (rand() - 0.5) * 60;
      img.data[p] += n;
      img.data[p + 1] += n;
      img.data[p + 2] += n;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toBuffer("image/png");
}

function renderCSV(ps: Payment[]): string {
  const header =
    "value_date,remitter_name,reference,channel,foreign_currency,foreign_amount,applied_rate,credited_inr,bank_charges_inr,narration";
  const rows = ps.map((p) =>
    [
      p.value_date,
      `"${p.remitter_name}"`,
      `"${p.reference}"`,
      p.channel,
      p.foreign_currency ?? "",
      p.foreign_amount ?? "",
      p.applied_rate ?? "",
      p.credited_inr,
      p.bank_charges_inr ?? "",
      `"${p.raw_text}"`,
    ].join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

function renderPlatformPDF(ps: Payment[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.info.CreationDate = new Date("2026-10-29T00:00:00Z");
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(20).text("Payout statement — October 2026");
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555").text("Credits only. Amounts in INR.");
    doc.moveDown(1).fillColor("#000").fontSize(10);
    for (const p of ps) {
      doc.text(p.raw_text);
      doc.moveDown(0.4);
    }
    doc.end();
  });
}

// ---------------------------------------------------------------- write all
// --test writes the SAME scenario to data/test-scenario as all-PNG invoices +
// a single CSV statement (no PDF), so every file extracts/parses under live
// mode (the vision model is image-only; CSV is code-parsed).
const TEST = process.argv.includes("--test");
const OUT = TEST ? join(process.cwd(), "data", "test-scenario") : DEMO;

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "invoices"), { recursive: true });
  mkdirSync(join(OUT, "statements"), { recursive: true });

  const manifest: {
    invoices: Record<string, unknown>;
    statements: Record<string, unknown>;
  } = { invoices: {}, statements: {} };

  for (const i of invoices) {
    // In test mode every invoice is a PNG image (live-compatible).
    const asImage = TEST || i.photo;
    const file = TEST ? `${i.invoice_number}.png` : i.file;
    const bytes = asImage ? renderInvoicePNG(i) : await renderInvoicePDF(i);
    writeFileSync(join(OUT, "invoices", file), bytes);
    manifest.invoices[file] = {
      kind: "invoice",
      invoice_number: i.invoice_number,
      client_name: i.client_name,
      client_email: i.client_email,
      issue_date: i.issue_date,
      due_date: i.lowConfidence === "due_date" ? null : i.due_date,
      currency: i.currency,
      total_amount: i.total_amount,
      bank_charges_terms: i.bank_charges_terms,
      field_confidence: i.field_confidence,
    };
  }

  // Test mode: ALL credit lines go into the one CSV (code-parsed, live-safe).
  // Demo mode: CSV + a platform PDF, as before.
  const csvPayments = TEST ? payments : payments.filter((p) => p.on === "csv");
  const platformPayments = TEST ? [] : payments.filter((p) => p.on === "platform");
  writeFileSync(join(OUT, "statements", "bank_statement.csv"), renderCSV(csvPayments));
  manifest.statements["bank_statement.csv"] = { kind: "statement", parser: "csv" };
  if (platformPayments.length) {
    writeFileSync(
      join(OUT, "statements", "platform_statement.pdf"),
      await renderPlatformPDF(platformPayments)
    );
    manifest.statements["platform_statement.pdf"] = {
      kind: "statement",
      lines: platformPayments.map(toLine),
    };
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  const answerKey = {
    invoices: invoices.length,
    payments: payments.map((p) => ({
      value_date: p.value_date,
      remitter_name: p.remitter_name,
      reference: p.reference,
      credited_inr: p.credited_inr,
      expect_invoices: p.expect_invoices,
      classification: p.classification,
    })),
  };
  writeFileSync(join(OUT, "answer_key.json"), JSON.stringify(answerKey, null, 2));

  const photos = invoices.filter((i) => i.photo).length;
  console.log(
    TEST
      ? `Generated ${invoices.length} PNG invoices + ${csvPayments.length} CSV credit lines (all live-compatible).`
      : `Generated ${invoices.length} invoices (${photos} photos), ` +
          `${csvPayments.length} CSV + ${platformPayments.length} platform credit lines ` +
          `(${payments.length} total).`
  );
  console.log(`Output: ${OUT}`);
}

function toLine(p: Payment) {
  return {
    value_date: p.value_date,
    credited_inr: p.credited_inr,
    foreign_currency: p.foreign_currency,
    foreign_amount: p.foreign_amount,
    applied_rate: p.applied_rate,
    remitter_name: p.remitter_name,
    reference: p.reference,
    channel: p.channel,
    bank_charges_inr: p.bank_charges_inr,
    raw_text: p.raw_text,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
