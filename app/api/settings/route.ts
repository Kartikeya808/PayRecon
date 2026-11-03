import { getSettings, saveSettings, type AppSettings } from "@/lib/settings";
import { requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await requireUserId(req);
  if (userId instanceof Response) return userId;
  return Response.json(await getSettings());
}

export async function POST(req: Request) {
  const userId = await requireUserId(req);
  if (userId instanceof Response) return userId;
  const patch = (await req.json().catch(() => ({}))) as Partial<AppSettings>;
  const saved = await saveSettings(patch);
  return Response.json(saved);
}
