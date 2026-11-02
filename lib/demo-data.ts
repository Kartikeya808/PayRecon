// Synthetic demo data (PRD §10). Fictional clients, amounts and profile.
// Match detail numbers are placeholders for layout; in the app they come from gap.ts.

export type Status =
  | "fully-paid"
  | "paid-with-costs"
  | "partial"
  | "needs-review"
  | "unmatched";

export const statusChip: Record<Status, { label: string; cls: string }> = {
  "fully-paid": { label: "Fully paid", cls: "chip-green" },
  "paid-with-costs": { label: "Paid with costs", cls: "chip-mint" },
  partial: { label: "Partial", cls: "chip-orange" },
  "needs-review": { label: "Needs review", cls: "chip-purple" },
  unmatched: { label: "Unmatched", cls: "chip-red" },
};

export type BoardRow = {
  id: string;
  date: string;
  remitter: string;
  remitterSub?: string;
  channel: string;
  creditedInr: number;
  invoice: string | null; // display string, may include "+ 010"
  invoiceLink?: string; // which match id to open
  matchId?: number; // DB match id for fetching detail
  byAgent?: boolean;
  instalment?: string; // e.g. "1 of 2"
  status: Status;
  shortfallInr: number | null;
};

export const boardRows: BoardRow[] = [
  {
    id: "p_14",
    date: "14 Oct",
    remitter: "Halcyon Analytics LLC",
    channel: "SWIFT",
    creditedInr: 165507.5,
    invoice: "INV-2026-014",
    invoiceLink: "halcyon",
    status: "paid-with-costs",
    shortfallInr: 4392.5,
  },
  {
    id: "p_11",
    date: "12 Oct",
    remitter: "Juniper Ridge Inc.",
    channel: "SWIFT",
    creditedInr: 214885.0,
    invoice: "INV-2026-011",
    invoiceLink: "juniper",
    status: "partial",
    shortfallInr: 39965.0,
  },
  {
    id: "p_17",
    date: "10 Oct",
    remitter: "Brightfold GmbH",
    channel: "Wise",
    creditedInr: 108245.2,
    invoice: "INV-2026-009 + 010",
    byAgent: true,
    status: "paid-with-costs",
    shortfallInr: 1214.8,
  },
  {
    id: "p_09",
    date: "09 Oct",
    remitter: "Kestrel Holdings Ltd",
    remitterSub: "Parent company of client",
    channel: "SWIFT",
    creditedInr: 96402.0,
    invoice: "INV-2026-008",
    byAgent: true,
    status: "needs-review",
    shortfallInr: 2038.0,
  },
  {
    id: "p_07",
    date: "07 Oct",
    remitter: "Larkspur Studio",
    channel: "Payoneer",
    creditedInr: 41870.1,
    invoice: "INV-2026-007",
    instalment: "1 of 2",
    status: "paid-with-costs",
    shortfallInr: null,
  },
  {
    id: "p_06",
    date: "05 Oct",
    remitter: "Ortolan Media",
    channel: "PayPal",
    creditedInr: 62118.4,
    invoice: "INV-2026-006",
    status: "fully-paid",
    shortfallInr: 0,
  },
  {
    id: "p_03",
    date: "03 Oct",
    remitter: "UPI REFUND 88213",
    channel: "Other",
    creditedInr: 1250.0,
    invoice: null,
    status: "unmatched",
    shortfallInr: null,
  },
  {
    id: "p_05",
    date: "02 Oct",
    remitter: "Halcyon Analytics LLC",
    channel: "SWIFT",
    creditedInr: 166210.75,
    invoice: "INV-2026-005",
    status: "paid-with-costs",
    shortfallInr: 3689.25,
  },
];

export const summary = [
  {
    label: "Settled",
    count: 14,
    color: "var(--text)",
    caption: "Paid in full or with normal costs",
  },
  {
    label: "Partial",
    count: 3,
    color: "var(--orange)",
    caption: "Follow-ups drafted",
  },
  {
    label: "Needs review",
    count: 2,
    color: "var(--purple)",
    caption: "Agent suggestions to confirm",
  },
  {
    label: "Unmatched",
    count: 2,
    color: "var(--red)",
    caption: "No invoice found",
  },
];

export type AgentStep = {
  tool: string;
  time: string;
  text: string;
  dot: string; // css color var
};

export const agentSteps: AgentStep[] = [
  {
    tool: "list_unresolved()",
    time: "10:42:03",
    text: "5 payments need a closer look",
    dot: "var(--text-secondary)",
  },
  {
    tool: "get_payment(p_17)",
    time: "10:42:05",
    text: "Brightfold GmbH · EUR 1,180.00",
    dot: "var(--text-secondary)",
  },
  {
    tool: "compute_gap(p_17, [009, 010])",
    time: "10:42:07",
    text: "Fees and spread come to ₹1,214.80",
    dot: "var(--text-secondary)",
  },
  {
    tool: "propose_match(p_17)",
    time: "10:42:08",
    text: "Confidence 0.94. One transfer covers both invoices…",
    dot: "var(--green)",
  },
  {
    tool: "get_invoice(INV-2026-008)",
    time: "10:42:11",
    text: "Client on invoice: Kestrel Analytics",
    dot: "var(--text-secondary)",
  },
  {
    tool: "propose_match(p_09)",
    time: "10:42:13",
    text: "Confidence 0.78, sent for review…",
    dot: "var(--purple)",
  },
  {
    tool: "mark_unmatched(p_03)",
    time: "10:42:15",
    text: "Domestic UPI refund, not a foreign remittance",
    dot: "var(--red)",
  },
];

// ---- Match dialogs ----

export type WaterfallLine = {
  label: string;
  sub: string;
  amount: string; // preformatted
  amountCls?: string;
  bar: "bar-gray" | "bar-orange" | "bar-red" | "bar-blue";
  width: number; // percentage
};

export type MatchDetail = {
  id: string;
  statusChip: string;
  statusLabel: string;
  method: string;
  client: string;
  invoice: string;
  callout?: { big: string; sub: string };
  receivedOn: string;
  received: string;
  expected: string;
  checkLine?: string;
  scaleNote: string;
  waterfall: WaterfallLine[];
  gapCaption?: string;
  plainWords: string;
  evidenceLine: string;
  evidence: { k: string; v: string }[];
  rateDetails: { k: string; v: string; cls?: string }[];
  footer: {
    reject: string;
    secondary: string;
    primary: string;
    primaryIcon?: "check" | "mail";
  };
};

export const matches: Record<string, MatchDetail> = {
  halcyon: {
    id: "halcyon",
    statusChip: "chip-mint",
    statusLabel: "Paid with costs",
    method: "Rule match · score 0.93 · SWIFT",
    client: "Halcyon Analytics LLC",
    invoice: "INV-2026-014",
    receivedOn: "Received on 14 Oct",
    received: "₹1,65,507.50",
    expected: "of ₹1,69,900.00 expected",
    checkLine: "The ₹4,392.50 gap is all normal costs. Nothing to chase.",
    scaleNote: "Scale starts at ₹1,60,000",
    waterfall: [
      {
        label: "Expected at ECB reference rate",
        sub: "USD 2,000 × 84.95",
        amount: "₹1,69,900.00",
        bar: "bar-gray",
        width: 100,
      },
      {
        label: "Intermediary bank fee",
        sub: "USD 25 deducted in transit",
        amount: "−₹2,123.75",
        amountCls: "text-orange",
        bar: "bar-orange",
        width: 22,
      },
      {
        label: "FX spread",
        sub: "Bank rate 84.10 vs 84.95",
        amount: "−₹1,678.75",
        amountCls: "text-orange",
        bar: "bar-orange",
        width: 17,
      },
      {
        label: "Bank charges + GST",
        sub: "₹500 + ₹90 GST",
        amount: "−₹590.00",
        amountCls: "text-orange",
        bar: "bar-orange",
        width: 6,
      },
      {
        label: "Received",
        sub: "Credited 14 Oct",
        amount: "₹1,65,507.50",
        bar: "bar-blue",
        width: 57,
      },
    ],
    plainWords:
      "Halcyon paid the full USD 2,000. USD 25 was deducted by an intermediary bank before it reached you, and your bank converted the remaining USD 1,975 at 84.10, below the ECB reference rate of 84.95. After ₹590 in bank charges and GST, ₹1,65,507.50 was credited, so nothing is owed by the client.",
    evidenceLine:
      "14 OCT · INWARD REMIT · HALCYON ANALYTICS LLC · USD 1,975.00 @ 84.10 · REF INV2026014",
    evidence: [
      { k: "Invoice", v: "INV-2026-014" },
      { k: "Issued", v: "18 Sep 2026" },
      { k: "Amount", v: "USD 2,000.00" },
      { k: "Charges terms", v: "SHA, shared" },
    ],
    rateDetails: [
      { k: "Value date", v: "14 Oct 2026" },
      { k: "ECB reference rate", v: "84.95" },
      { k: "Your bank's rate", v: "84.10" },
      { k: "Markup on the rate", v: "1.00%", cls: "text-orange" },
      { k: "Arrived in USD", v: "USD 1,975.00" },
    ],
    footer: {
      reject: "Reject match",
      secondary: "Reassign",
      primary: "Confirm match",
      primaryIcon: "check",
    },
  },
  juniper: {
    id: "juniper",
    statusChip: "chip-orange",
    statusLabel: "Partial",
    method: "Rule match · score 0.91 · SWIFT",
    client: "Juniper Ridge Inc.",
    invoice: "INV-2026-011",
    callout: {
      big: "USD 400 likely still owed",
      sub: "Only USD 2,550 arrived for a USD 3,000 invoice. Normal fees explain about USD 50 of the gap.",
    },
    receivedOn: "Received on 12 Oct",
    received: "₹2,14,885.00",
    expected: "of ₹2,54,850.00 expected",
    scaleNote: "Scale starts at ₹2,10,000",
    waterfall: [
      {
        label: "Expected at ECB reference rate",
        sub: "USD 3,000 × 84.95",
        amount: "₹2,54,850.00",
        bar: "bar-gray",
        width: 100,
      },
      {
        label: "Not received",
        sub: "USD 450: about USD 400 owed + USD 50 typical fees",
        amount: "−₹38,227.50",
        amountCls: "text-red",
        bar: "bar-red",
        width: 100,
      },
      {
        label: "FX spread",
        sub: "Bank rate 84.50 vs 84.95",
        amount: "−₹1,147.50",
        amountCls: "text-orange",
        bar: "bar-orange",
        width: 8,
      },
      {
        label: "Bank charges + GST",
        sub: "₹500 + ₹90 GST",
        amount: "−₹590.00",
        amountCls: "text-orange",
        bar: "bar-orange",
        width: 5,
      },
      {
        label: "Received",
        sub: "Credited 12 Oct",
        amount: "₹2,14,885.00",
        bar: "bar-blue",
        width: 55,
      },
    ],
    gapCaption: "Total gap ₹39,965.00",
    plainWords:
      "Juniper Ridge's transfer reached you as USD 2,550, which is USD 450 short of the USD 3,000 invoice. Typical intermediary fees are around USD 50, so about USD 400 looks unpaid rather than lost in transit. Your bank converted at 84.50 against the ECB reference rate of 84.95 and charged ₹590, leaving ₹2,14,885.00 credited.",
    evidenceLine:
      "12 OCT · INWARD REMIT · JUNIPER RIDGE INC · USD 2,550.00 @ 84.50 · REF INV-2026-011",
    evidence: [
      { k: "Invoice", v: "INV-2026-011" },
      { k: "Issued", v: "2 Sep 2026" },
      { k: "Amount", v: "USD 3,000.00" },
      { k: "Charges terms", v: "SHA, shared" },
    ],
    rateDetails: [
      { k: "Value date", v: "12 Oct 2026" },
      { k: "ECB reference rate", v: "84.95" },
      { k: "Your bank's rate", v: "84.50" },
      { k: "Markup on the rate", v: "0.53%", cls: "text-orange" },
      { k: "Arrived in USD", v: "USD 2,550.00" },
    ],
    footer: {
      reject: "Reject match",
      secondary: "Mark as settled",
      primary: "Draft follow-up",
      primaryIcon: "mail",
    },
  },
};

// ---- Upload screen ----

export type FileRow = {
  name: string;
  kind: "invoice" | "invoice-photo" | "bank" | "platform";
  type: string;
  status: { label: string; cls: string };
  fields: string;
  note?: string;
};

export const fileRows: FileRow[] = [
  {
    name: "INV-2026-014.pdf",
    kind: "invoice",
    type: "Invoice",
    status: { label: "Done", cls: "chip-green" },
    fields: "7 of 7",
  },
  {
    name: "INV-2026-015.pdf",
    kind: "invoice",
    type: "Invoice",
    status: { label: "Done", cls: "chip-green" },
    fields: "7 of 7",
  },
  {
    name: "invoice_photo_juniper.jpg",
    kind: "invoice-photo",
    type: "Invoice photo",
    status: { label: "Needs attention", cls: "chip-orange" },
    fields: "6 of 7",
    note: "Due date unclear, check it",
  },
  {
    name: "INV-2026-017.pdf",
    kind: "invoice",
    type: "Invoice",
    status: { label: "Reading…", cls: "chip-blue" },
    fields: "—",
    note: "Muse Spark 1.3",
  },
  {
    name: "INV-2026-018.pdf",
    kind: "invoice",
    type: "Invoice",
    status: { label: "Queued", cls: "chip-gray" },
    fields: "—",
  },
  {
    name: "INV-2026-019.png",
    kind: "invoice-photo",
    type: "Invoice photo",
    status: { label: "Done", cls: "chip-green" },
    fields: "7 of 7",
  },
  {
    name: "statement_sep_oct.csv",
    kind: "bank",
    type: "Bank statement",
    status: { label: "Done", cls: "chip-green" },
    fields: "14 credits",
    note: "Parsed in code, no AI call",
  },
  {
    name: "platform_statement_oct.pdf",
    kind: "platform",
    type: "Platform statement",
    status: { label: "Done", cls: "chip-green" },
    fields: "7 credits",
  },
];

// ---- Follow-ups ----

export type Followup = {
  id: string;
  client: string;
  amount: string;
  amountCls: string;
  invoice: string;
  chip: { label: string; cls: string };
  to: string;
  subject: string;
  body: string;
};

export const followups: Followup[] = [
  {
    id: "juniper",
    client: "Juniper Ridge Inc.",
    amount: "USD 400.00",
    amountCls: "text-orange",
    invoice: "INV-2026-011",
    chip: { label: "Partial", cls: "chip-orange" },
    to: "accounts@juniperridge.example",
    subject: "INV-2026-011: remaining balance of USD 400",
    body: `Hi Dana,

Thanks for your payment against invoice INV-2026-011 dated 2 Sep 2026. The invoice was for USD 3,000.00 and we received USD 2,550.00, which leaves USD 400.00 outstanding after typical bank fees.

Could you arrange the remaining balance to the account details below?
[Payment details]

Thanks again,
Aarav`,
  },
  {
    id: "marlowe",
    client: "Marlowe & Finch LLP",
    amount: "GBP 180.00",
    amountCls: "text-orange",
    invoice: "INV-2026-003",
    chip: { label: "Partial", cls: "chip-orange" },
    to: "ap@marlowefinch.example",
    subject: "INV-2026-003: remaining balance of GBP 180",
    body: `Hi there,

Thanks for your payment against invoice INV-2026-003. GBP 180.00 remains outstanding after typical bank fees. Could you arrange the remaining balance to the account details below?
[Payment details]

Thanks again,
Aarav`,
  },
  {
    id: "tessellate",
    client: "Tessellate Labs",
    amount: "USD 35.00",
    amountCls: "text-mint",
    invoice: "INV-2026-012",
    chip: { label: "Recoverable fee", cls: "chip-mint" },
    to: "finance@tessellate.example",
    subject: "INV-2026-012: recoverable bank fee of USD 35",
    body: `Hi there,

Your invoice INV-2026-012 was marked "charges for sender" (OUR), but USD 35.00 in intermediary bank fees was deducted in transit. Could you reimburse this amount to the account details below?
[Payment details]

Thanks again,
Aarav`,
  },
];
