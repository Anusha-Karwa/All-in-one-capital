/** Routes reachable without staff sign-in. Everything else is internal. */
export function isPublicPath(pathname: string, method: string): boolean {
  if (pathname === "/apply" || pathname.startsWith("/apply/") || pathname === "/privacy") return true;
  if (pathname === "/api/health") return method === "GET";
  if (pathname === "/api/applications") return method === "POST";
  if (pathname === "/api/uploads") return method === "POST"; // scoped, rate-limited upload tokens for /apply
  if (pathname === "/api/inngest") return true; // Inngest verifies its own signature
  return false;
}
