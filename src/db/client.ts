import { neon } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { databaseUrl } from "@/env";
import * as schema from "./schema";

/** Driver-agnostic Drizzle handle (Neon HTTP in dev/prod, PGlite for local/no-network and tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let _db: Promise<Db> | undefined;

/**
 * `pglite://memory` or `pglite://./path` → embedded Postgres + pgvector (see DECISIONS D-011).
 * Anything else → Neon serverless HTTP.
 */
export async function makeDb(url: string): Promise<Db> {
  if (url.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { vector } = await import("@electric-sql/pglite-pgvector");
    const { drizzle } = await import("drizzle-orm/pglite");
    const target = url.slice("pglite://".length);
    const client = new PGlite({ ...(target === "memory" ? {} : { dataDir: target }), extensions: { vector } });
    return drizzle(client, { schema }) as unknown as Db;
  }
  return drizzleNeon(neon(url), { schema }) as unknown as Db;
}

/** Lazily-created client bound to the environment-appropriate database (never prod outside APP_ENV=prod). */
export function db(): Promise<Db> {
  _db ??= makeDb(databaseUrl());
  return _db;
}

/** Test hook: inject a database (e.g. in-memory PGlite with migrations applied). */
export function setDbForTests(d: Db | undefined) {
  _db = d ? Promise.resolve(d) : undefined;
}

export { schema };

/** Raw SQL → rows, for both drivers (Neon HTTP and PGlite both return `{ rows }`). */
export async function execRows<T = Record<string, unknown>>(d: Db, query: import("drizzle-orm").SQL): Promise<T[]> {
  const res = (await d.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}
