import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Lightweight edge check for *page* routes (cookie presence only — no DB call);
// a missing cookie redirects to /login. The routes that call requireUserId
// (upload, matches, followups, settings) are excluded from the matcher so they
// can do full session validation themselves and return 401 — for a missing cookie
// AND a forged one — instead of being redirected. Other API routes keep the
// existing cookie-presence gate.
export function middleware(req: NextRequest) {
  const hasSession = !!getSessionCookie(req);
  const { pathname } = req.nextUrl;
  const isLogin = pathname === "/login";

  if (!hasSession && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasSession && isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, static assets, the public auth/demo APIs,
  // and the four routes that self-validate via requireUserId (so they answer
  // 401 rather than being redirected). All other routes keep the cookie gate.
  matcher: [
    "/((?!api/auth|api/demo|api/upload|api/matches|api/followups|api/settings|_next/static|_next/image|favicon.ico).*)",
  ],
};
