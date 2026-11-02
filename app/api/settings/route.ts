import { getSettings, saveSettings, type AppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getSettings());
}

export async function POST(req: Request) {
  const patch = (await req.json().catch(() => ({}))) as Partial<AppSettings>;
  const saved = await saveSettings(patch);
  return Response.json(saved);
}
