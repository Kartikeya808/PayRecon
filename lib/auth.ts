import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import * as schema from "@/db/schema";
import { withAccount } from "@/lib/account-context";

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

/** Run `fn` inside the request's account billing context (so lib/llm.ts can
 *  attribute spend and enforce the per-account cap). */
export async function runWithRequestAccount<T>(
  req: Request,
  fn: () => Promise<T>
): Promise<T> {
  const uid = await requestUserId(req);
  return uid ? withAccount(uid, fn) : fn();
}
