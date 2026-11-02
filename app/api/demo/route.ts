import { eq } from "drizzle-orm";
import { auth, DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/db/schema";

export const runtime = "nodejs";

// Signs the visitor into a shared, pre-seeded demo account. No password shown
// in the UI (PRD: judges/first-time visitors). Created on first use.
export async function POST() {
  const body = { email: DEMO_EMAIL, password: DEMO_PASSWORD };

  try {
    await auth.api.signUpEmail({
      body: { name: "Demo user", ...body },
    });
    // Flag it as the demo account (used later for its own spending cap).
    await db.update(user).set({ isDemo: true }).where(eq(user.email, DEMO_EMAIL));
  } catch {
    // Already exists — fine.
  }

  // Fresh sign-in; return the response so its Set-Cookie reaches the browser.
  return auth.api.signInEmail({ body, asResponse: true });
}
