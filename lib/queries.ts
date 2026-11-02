import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { llmCalls } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import {
  documents,
  payments as paymentsT,
  invoices as invoicesT,
  matches as matchesT,
  allocations as allocationsT,
  gapBreakdowns as gapT,
} from "@/db/schema";
import { followups as followupsT } from "@/db/schema";
import type { FileRow, BoardRow, Status, Followup } from "@/lib/demo-data";

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "chip-gray" },
  reading: { label: "Reading…", cls: "chip-blue" },
  done: { label: "Done", cls: "chip-green" },
  needs_attention: { label: "Needs attention", cls: "chip-orange" },
  error: { label: "Error", cls: "chip-red" },
};

function kindOf(filename: string, kind: string): FileRow["kind"] {
  const f = filename.toLowerCase();
  if (kind === "invoice") return f.endsWith(".png") || f.endsWith(".jpg") ? "invoice-photo" : "invoice";
  return f.endsWith(".csv") ? "bank" : "platform";
}

function typeLabel(k: FileRow["kind"]): string {
  return k === "invoice"
    ? "Invoice"
    : k === "invoice-photo"
    ? "Invoice photo"
    : k === "bank"
    ? "Bank statement"
    : "Platform statement";
}

/** All uploaded documents, newest first, mapped to the FileRow UI shape. */
export async function getFileRows(): Promise<FileRow[]> {
  const docs = await db.select().from(documents).orderBy(desc(documents.createdAt));
  return docs.map((d) => {
    const kind = kindOf(d.filename, d.kind);
    const summary = (d.extractedJson ?? {}) as {
      kind?: string;
      fieldsFound?: number;
      fieldsTotal?: number;
      lowConfidence?: boolean;
      credits?: number;
      parsedInCode?: boolean;
    };
    const status = STATUS_CHIP[d.status] ?? STATUS_CHIP.queued;

    let fields = "—";
    let note: string | undefined;
    if (summary.kind === "invoice") {
      fields = `${summary.fieldsFound ?? 0} of ${summary.fieldsTotal ?? 7}`;
      if (d.status === "needs_attention") note = "A field needs a quick check";
    } else if (summary.kind === "statement") {
      fields = `${summary.credits ?? 0} credits`;
      if (summary.parsedInCode) note = "Parsed in code, no AI call";
    }

    return {
      name: d.filename,
      kind,
      type: typeLabel(kind),
      status,
      fields,
      note,
    } satisfies FileRow;
  });
}

// ---- Board -----------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(d: string | null): string {
  if (!d) return "—";
  const [, m, day] = d.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1] ?? ""}`.trim();
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}
function remitterMatchesClient(remitter: string, client: string): boolean {
  const A = tokens(remitter);
  const B = tokens(client);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.8;
}

export type BoardData = {
  rows: BoardRow[];
  summary: { label: string; count: number; color: string; caption: string }[];
  reconciled: boolean;
};

export async function getBoardData(): Promise<BoardData> {
  const [pays, invs, ms, allocs, gaps] = await Promise.all([
    db.select().from(paymentsT),
    db.select().from(invoicesT),
    db.select().from(matchesT),
    db.select().from(allocationsT),
    db.select().from(gapT),
  ]);

  const invById = new Map(invs.map((i) => [i.id, i]));
  const matchByPayment = new Map(ms.map((m) => [m.paymentId, m]));
  const allocByMatch = new Map<number, typeof allocs>();
  for (const a of allocs) {
    if (a.matchId == null) continue;
    const list = allocByMatch.get(a.matchId) ?? [];
    list.push(a);
    allocByMatch.set(a.matchId, list);
  }
  const gapByMatch = new Map(gaps.map((g) => [g.matchId, g]));

  const rows: BoardRow[] = pays
    .sort((a, b) => (b.valueDate ?? "").localeCompare(a.valueDate ?? ""))
    .map((p) => {
      const m = matchByPayment.get(p.id);
      const g = m ? gapByMatch.get(m.id) : undefined;
      const allocInvoices = m
        ? (allocByMatch.get(m.id) ?? []).map((a) => invById.get(a.invoiceId!)).filter(Boolean)
        : [];
      const classification = g?.classification;

      let status: Status;
      if (!m) status = "unmatched";
      else if (classification === "partial") status = "partial";
      else if (m.status === "needs_review") status = "needs-review";
      else if (classification === "fully_paid") status = "fully-paid";
      else if (classification === "needs_review") status = "needs-review";
      else status = "paid-with-costs";

      const shortfall =
        g != null ? Number(g.expectedInr) - Number(g.receivedInr) : null;

      const firstClient = allocInvoices[0]?.clientName ?? null;
      const remitterSub =
        m && firstClient && p.remitterName && !remitterMatchesClient(p.remitterName, firstClient)
          ? "Parent company of client"
          : undefined;

      return {
        id: `p_${p.id}`,
        date: shortDate(p.valueDate),
        remitter: p.remitterName ?? "—",
        remitterSub,
        channel: p.channel ?? "Other",
        creditedInr: Number(p.creditedInr ?? 0),
        invoice: allocInvoices.length
          ? allocInvoices.map((i) => i!.invoiceNumber).join(" + ")
          : null,
        matchId: m?.id,
        byAgent: m?.method === "agent",
        status,
        shortfallInr: shortfall,
      } satisfies BoardRow;
    });

  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const summary = [
    {
      label: "Settled",
      count: count("fully-paid") + count("paid-with-costs"),
      color: "var(--text)",
      caption: "Paid in full or with normal costs",
    },
    { label: "Partial", count: count("partial"), color: "var(--orange)", caption: "Follow-ups drafted" },
    {
      label: "Needs review",
      count: count("needs-review"),
      color: "var(--purple)",
      caption: "Agent suggestions to confirm",
    },
    { label: "Unmatched", count: count("unmatched"), color: "var(--red)", caption: "No invoice found" },
  ];

  return { rows, summary, reconciled: ms.length > 0 };
}

// ---- Follow-ups ------------------------------------------------------------

export type FollowupRow = Followup & { status: "draft" | "sent" };

/** Drafted follow-ups joined to their invoice, newest first, UI-shaped. */
export async function getFollowups(): Promise<FollowupRow[]> {
  const [fus, invs] = await Promise.all([
    db.select().from(followupsT).orderBy(desc(followupsT.createdAt)),
    db.select().from(invoicesT),
  ]);
  const invById = new Map(invs.map((i) => [i.id, i]));

  return fus.map((f) => {
    const inv = f.invoiceId != null ? invById.get(f.invoiceId) : undefined;
    const recoverable = (f.subject ?? "").toLowerCase().includes("recoverable");
    // Subject format is "<INV>: … of <CCY> <amount>" — parse it for the list chip.
    const m = (f.subject ?? "").match(/of ([A-Z]{3}) ([\d,]+\.\d{2})/);
    const amount = m ? `${m[1]} ${m[2]}` : "—";

    return {
      id: String(f.id),
      client: inv?.clientName ?? "Client",
      amount,
      amountCls: recoverable ? "text-mint" : "text-orange",
      invoice: inv?.invoiceNumber ?? "",
      chip: recoverable
        ? { label: "Recoverable fee", cls: "chip-mint" }
        : { label: "Partial", cls: "chip-orange" },
      to: inv?.clientEmail ?? "accounts@client.example",
      subject: f.subject ?? "",
      body: f.body ?? "",
      status: (f.status ?? "draft") as "draft" | "sent",
    } satisfies FollowupRow;
  });
}

// ---- Sidebar (live spend meter + follow-ups badge) ------------------------

export async function getSidebarData(): Promise<{
  spendUsd: number;
  capUsd: number;
  followupCount: number;
}> {
  const [[spendRow], [fuRow], settings] = await Promise.all([
    db.select({ total: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)` }).from(llmCalls),
    db.select({ n: sql<number>`count(*)` }).from(followupsT),
    getSettings(),
  ]);
  return {
    spendUsd: Number(spendRow?.total ?? 0),
    capUsd: settings.spendingCapUsd,
    followupCount: Number(fuRow?.n ?? 0),
  };
}

export async function getCounts() {
  const rows = await db.select().from(documents);
  const invoices = rows.filter((r) => r.kind === "invoice").length;
  const statements = rows.filter((r) => r.kind === "statement").length;
  const read = rows.filter((r) => r.status === "done" || r.status === "needs_attention").length;
  return { total: rows.length, invoices, statements, read };
}
