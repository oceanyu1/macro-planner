import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Optimistic check only: every server action and page also calls requireUser().
export default auth((req) => {
  if (req.auth) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.nextUrl));
});

export const config = {
  // Everything except sign-in, the cron route (it has its own secret), and static files.
  matcher: [
    "/((?!login|api/auth|api/cron|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|apple-icon|sw.js).*)",
  ],
};
