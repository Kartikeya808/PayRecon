import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  matches as matchesT,
  allocations as allocationsT,
  gapBreakdowns as gapT,
} from "@/db/schema";
import { getMatchDetail } from "@/lib/match-detail";
import { requireUserId } from "@/lib/auth";
import { withAccount } from "@/lib/account-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// GET builds the detail via a live explanation (Wonder, ~8-10s); the default
// 10s function limit times out on the slower (partial) ones.
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId(req);
  if (userId instanceof Response) return userId;

  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  // The explanation is generated here (live) — bill it to the account.
  const detail = await withAccount(userId, () => getMatchDetail(matchId));
  if (!detail) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(detail);
}

// Confirm / reject / reassign a match. Reject removes the match (and its
// children) so the payment returns to the unmatched pool.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId(req);
  if (userId instanceof Response) return userId;

  const { id } = await params;
  const matchId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (!Number.isFinite(matchId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }

  if (body.action === "confirm") {
    await db.update(matchesT).set({ status: "confirmed" }).where(eq(matchesT.id, matchId));
    return Response.json({ ok: true, status: "confirmed" });
  }

  if (body.action === "reject") {
    await db.delete(gapT).where(eq(gapT.matchId, matchId));
    await db.delete(allocationsT).where(eq(allocationsT.matchId, matchId));
    await db.delete(matchesT).where(eq(matchesT.id, matchId));
    return Response.json({ ok: true, status: "rejected" });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}
