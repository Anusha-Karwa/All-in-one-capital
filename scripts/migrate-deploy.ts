/**
 * Runs on every Vercel build (package.json "vercel-build"), BEFORE `next build`.
 * Applies pending drizzle/ migrations to the right database (src/db/migrateTarget.ts). Already-applied
 * migrations are skipped (tracked in drizzle.__drizzle_migrations). If this fails, the build fails and the
 * previous deployment stays live. Never prints connection strings.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { migrateTarget } from "../src/db/migrateTarget";

async function main() {
  const t = migrateTarget();
  if ("skip" in t) {
    console.log(`[migrate] skipped: ${t.skip}`);
    return;
  }
  const started = Date.now();
  await migrate(drizzle(neon(t.url)), { migrationsFolder: "drizzle" });
  const rows = (await neon(t.url)`select count(*)::int as n from drizzle.__drizzle_migrations`) as { n: number }[];
  console.log(
    `[migrate] ${t.label}: up to date — ${rows[0].n} migrations applied in total (${Date.now() - started} ms)`,
  );
}
main().catch((e) => {
  const msg = (e instanceof Error ? e.message : String(e)).replace(/postgres(ql)?:\/\/\S+/g, "[db-url]");
  console.error(`[migrate] FAILED: ${msg}`);
  process.exit(1);
});
