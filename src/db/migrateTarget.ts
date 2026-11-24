/**
 * Which database a deploy-time migration should touch (DECISIONS D-035).
 * - Vercel production → DATABASE_URL_UNPOOLED (direct connection, preferred for DDL) or DATABASE_URL.
 * - Anything else → DATABASE_URL_DEV only. Never DATABASE_URL: on Vercel, Neon's integration gives
 *   Preview the SAME DATABASE_URL as Production, so using it would migrate prod from a preview build.
 * - Nothing configured → skip (the app reports "not configured"; nothing to migrate).
 */
import { resolveAppEnv } from "@/lib/appEnv";

export type MigrateTarget = { url: string; label: string } | { skip: string };

export function migrateTarget(src: Record<string, string | undefined> = process.env): MigrateTarget {
  const appEnv = resolveAppEnv(src) ?? "dev";
  if (appEnv === "prod") {
    const url = src.DATABASE_URL_UNPOOLED || src.DATABASE_URL;
    return url
      ? { url, label: src.DATABASE_URL_UNPOOLED ? "prod (unpooled)" : "prod" }
      : { skip: "prod has no DATABASE_URL" };
  }
  if (src.DATABASE_URL_DEV?.startsWith("pglite://")) return { skip: "pglite is migrated by scripts/_db.ts at startup" };
  return src.DATABASE_URL_DEV
    ? { url: src.DATABASE_URL_DEV, label: "dev" }
    : { skip: `${appEnv} has no DATABASE_URL_DEV` };
}
