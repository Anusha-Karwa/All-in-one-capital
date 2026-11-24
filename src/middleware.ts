import { NextResponse, type NextRequest } from "next/server";
import { resolveAppEnv } from "@/lib/appEnv";
import { isPublicPath } from "@/lib/publicPaths";

/**
 * Until staff auth (Auth.js + Google allow-list) lands in Phase 8, internal pages and APIs are
 * BLOCKED in prod — applicant data must never be served unauthenticated. Dev/test stay open locally.
 */
export function middleware(req: NextRequest) {
  if (resolveAppEnv() !== "prod") return NextResponse.next();
  if (isPublicPath(req.nextUrl.pathname, req.method)) return NextResponse.next();
  return new NextResponse("Staff pages are disabled until sign-in is configured.", { status: 503 });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
