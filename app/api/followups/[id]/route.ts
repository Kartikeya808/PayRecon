import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { followups as followupsT } from "@/db/schema";
import { draftFollowup } from "@/lib/explain";
import { runWithRequestAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Regenerating a draft is a live Wonder call; needs more than the 10s default.
export const maxDuration = 60;

// Mark a draft as sent, or regenerate its body in a different tone. Amounts are
// never touched here — draftFollowup pulls them from the stored breakdown.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const followupId = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    tone?: "friendly" | "firm";
  };
  if (!Number.isFinite(followupId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  const [f] = await db.select().from(followupsT).where(eq(followupsT.id, followupId)).limit(1);
  if (!f) return Response.json({ error: "not found" }, { status: 404 });

  if (body.action === "sent") {
    await db.update(followupsT).set({ status: "sent" }).where(eq(followupsT.id, followupId));
    return Response.json({ ok: true, status: "sent" });
  }

  if (body.action === "regenerate") {
    const tone = body.tone === "firm" ? "firm" : "friendly";
    if (f.invoiceId == null) return Response.json({ error: "no invoice" }, { status: 400 });
    // Re-drafting spends (live): bill it to the signed-in account.
    const draft = await runWithRequestAccount(req, () => draftFollowup(f.invoiceId!, tone));
    if (!draft) return Response.json({ error: "cannot regenerate" }, { status: 400 });
    await db
      .update(followupsT)
      .set({ tone, subject: draft.subject, body: draft.body })
      .where(eq(followupsT.id, followupId));
    return Response.json({ ok: true, ...draft, tone });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
