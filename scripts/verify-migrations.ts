/**
 * Applies every migration in ./drizzle to an in-memory Postgres (PGlite + pgvector) and checks
 * the result. Proves migrations are valid without touching Neon. `npm run db:verify`
 */
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

async function main() {
  const pg = new PGlite({ extensions: { vector } });
  const files = readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    for (const stmt of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
    console.log(`applied ${f}`);
  }
  const tables = await pg.query<{ n: number }>(
    "select count(*)::int as n from information_schema.tables where table_schema='public'",
  );
  const ext = await pg.query("select extname from pg_extension where extname='vector'");
  // round-trip a vector to prove the column type works
  await pg.exec(
    `insert into portfolio_companies (name, added_by, embedding) values ('probe','manual','[${Array(768).fill(0.1).join(",")}]')`,
  );
  const nn = await pg.query<{ d: number }>(
    `select (embedding <=> '[${Array(768).fill(0.1).join(",")}]')::float as d from portfolio_companies`,
  );
  console.log({ tables: tables.rows[0].n, pgvector: ext.rows.length === 1, cosineSelfDistance: nn.rows[0].d });
  if (ext.rows.length !== 1 || tables.rows[0].n < 30) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
