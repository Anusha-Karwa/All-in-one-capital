import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "./client";

/** Apply ./drizzle/*.sql to a PGlite-backed Db (tests + local mode). Neon uses drizzle-kit migrate. */
export async function applyMigrationsLocal(d: Db, dir = path.join(process.cwd(), "drizzle")) {
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    for (const stmt of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await d.execute(sql.raw(stmt));
    }
  }
}

/** Fresh in-memory database with all migrations applied — used by tests. */
export async function freshTestDb(): Promise<Db> {
  const { makeDb } = await import("./client");
  const d = await makeDb("pglite://memory");
  await applyMigrationsLocal(d);
  return d;
}
