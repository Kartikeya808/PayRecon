import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Lightweight edge check (cookie presence only — no DB call). Full validation
// happens in the server routes/handlers.
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
  // Everything except Next internals, auth/demo API, and static assets.
  matcher: ["/((?!api/auth|api/demo|_next/static|_next/image|favicon.ico).*)"],
};
