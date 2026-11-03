import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";

export function isGoogleEnabled(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export const DEMO_EMAIL = "demo@pma.app";
// Server-only. The demo account is intentionally shared; never shown in the UI.
export const DEMO_PASSWORD = "pma-demo-" + (process.env.BETTER_AUTH_SECRET ?? "x").slice(0, 10);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  ...(isGoogleEnabled()
    ? {
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          },
        },
      }
    : {}),
  user: {
    additionalFields: {
      isDemo: { type: "boolean", defaultValue: false, input: false },
    },
  },
  trustedOrigins: [
    "http://localhost:3001",
    ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
  ],
});

/** The signed-in account id for a request, or null if unauthenticated. */
export async function requestUserId(req: Request): Promise<string | null> {
  try {
    const s = await auth.api.getSession({ headers: req.headers });
    return s?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Validate the request's session with Better Auth and return the user id, or a
 * 401 JSON Response when there is no valid session. A present-but-invalid
 * cookie (e.g. forged or expired) fails here — middleware only checks that a
 * cookie exists. Use at the top of a protected route:
 *
 *   const userId = await requireUserId(req);
 *   if (userId instanceof Response) return userId;
 */
export async function requireUserId(req: Request): Promise<string | Response> {
  const uid = await requestUserId(req);
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return uid;
}
