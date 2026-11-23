import { config } from "dotenv";
config({ path: ".env.local" });

/** Scripts share the app's DB selection (APP_ENV → Neon branch, or pglite://...). */
export async function scriptDb() {
  const { db, execRows } = await import("@/db/client");
  const { databaseUrl } = await import("@/env");
  const url = databaseUrl();
  const d = await db();
  if (url.startsWith("pglite://")) {
    const { applyMigrationsLocal } = await import("@/db/migrate-local");
    const { sql } = await import("drizzle-orm");
    const [r] = await execRows<{ t: string | null }>(d, sql`select to_regclass('public.applications') as t`);
    if (!r.t) await applyMigrationsLocal(d);
  }
  return d;
}
