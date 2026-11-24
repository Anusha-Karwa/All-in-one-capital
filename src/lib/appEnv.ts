/**
 * Which environment this process is. Edge-safe (used by middleware).
 * Vercel production is ALWAYS prod, whatever APP_ENV says — so a missing or wrong variable can never
 * switch off prod protections (DECISIONS D-034).
 */
export type AppEnv = "dev" | "test" | "prod";

export function resolveAppEnv(src: Record<string, string | undefined> = process.env): AppEnv | undefined {
  if (src.VERCEL_ENV === "production") return "prod";
  const v = src.APP_ENV;
  return v === "dev" || v === "test" || v === "prod" ? v : undefined;
}
