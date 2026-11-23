import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { buildHealthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const e = env();
  const report = await buildHealthReport(e, {
    db: async () => {
      const { db } = await import("@/db/client");
      const rows = await db().execute(sql`select extname from pg_extension where extname = 'vector'`);
      if (rows.rows.length === 0)
        throw new Error("connected, but pgvector extension is not installed (run migrations)");
    },
  });
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}
