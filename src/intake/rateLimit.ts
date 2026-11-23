import { sql } from "drizzle-orm";
import { execRows, type Db } from "@/db/client";

/**
 * Fixed-window limiter in Postgres (fallback when Upstash isn't configured).
 * Atomic upsert-and-increment; returns whether this hit is allowed.
 */
export async function hitRateLimit(d: Db, key: string, limit: number, windowMs: number, now = new Date()) {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await execRows<{ count: number }>(
    d,
    sql`insert into rate_limits (key, window_start, count) values (${key}, ${windowStart.toISOString()}, 1)
        on conflict (key, window_start) do update set count = rate_limits.count + 1
        returning count`,
  );
  const count = Number(row.count);
  return { allowed: count <= limit, count, retryAfterMs: windowStart.getTime() + windowMs - now.getTime() };
}
