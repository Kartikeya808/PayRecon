import { NextRequest, NextResponse } from "next/server";
import { ingestFile } from "@/lib/ingest";
import { requireUserId } from "@/lib/auth";
import { withAccount } from "@/lib/account-context";

export const runtime = "nodejs";
// Each uploaded invoice is one live extraction call; a batch needs headroom.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Auth first: an unauthenticated request must never reach extraction.
  const userId = await requireUserId(req);
  if (userId instanceof Response) return userId;

  const form = await req.formData();
  const kind = (form.get("kind") as string) === "statement" ? "statement" : "invoice";
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  // Extraction spends against the signed-in account's per-account cap.
  return withAccount(userId, async () => {
    const results = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      results.push(await ingestFile(file.name, kind, bytes));
    }
    return NextResponse.json({ ok: true, results });
  });
}
