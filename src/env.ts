/**
 * Environment validation (Zod). Every variable is listed in .env.example.
 *
 * Variables are optional at boot so each phase can run with only the keys it needs;
 * call `requireEnv([...])` at the point of use to fail loudly and specifically.
 */
import { z } from "zod";
import { resolveAppEnv } from "@/lib/appEnv";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const int = (d: number) => z.coerce.number().int().positive().default(d);
const opt = z.string().min(1).optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["dev", "test", "prod"]).default("dev"),

  DATABASE_URL: opt,
  DATABASE_URL_DEV: opt,

  GEMINI_API_KEY: opt,
  GEMINI_MODEL_FAST: opt,
  GEMINI_MODEL_SMART: opt,
  GEMINI_EMBEDDING_MODEL: opt,

  PORTKEY_API_KEY: opt,
  PORTKEY_VIRTUAL_KEY_GEMINI: opt,
  PORTKEY_CONFIG_ID: opt,
  PORTKEY_GATEWAY_URL: z.string().url().optional(), // self-hosted Portkey OSS gateway (D-037)
  PORTKEY_GATEWAY_SECRET: opt, // shared secret the self-hosted gateway requires

  LANGFUSE_PUBLIC_KEY: opt,
  LANGFUSE_SECRET_KEY: opt,
  LANGFUSE_HOST: z.string().url().default("https://cloud.langfuse.com"),

  INNGEST_EVENT_KEY: opt,
  INNGEST_SIGNING_KEY: opt,
  BLOB_READ_WRITE_TOKEN: opt, // legacy Blob auth (token mode)
  BLOB_STORE_ID: opt, // OIDC Blob auth (set by Vercel when a store is connected); token comes from the Vercel runtime
  BLOB_WEBHOOK_PUBLIC_KEY: opt, // set by Vercel with OIDC stores; only needed for upload-completed callbacks (unused)

  AUTH_SECRET: opt,
  GOOGLE_CLIENT_ID: opt,
  GOOGLE_CLIENT_SECRET: opt,
  ALLOWED_EMAILS: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean)
        : [],
    ),
  RIYA_EMAIL: opt,
  KUSHAL_EMAIL: opt,
  ADITYA_EMAIL: opt,

  TEST_MODE: bool.default(true),
  TEST_INBOX: opt,
  ALERT_EMAIL: opt,
  SLACK_WEBHOOK_URL: opt,

  PII_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine((k) => !k || Buffer.from(k, "base64").length === 32, "PII_ENCRYPTION_KEY must be 32 bytes, base64"),

  UPSTASH_REDIS_REST_URL: opt,
  UPSTASH_REDIS_REST_TOKEN: opt,
  TAVILY_API_KEY: opt,

  JUDGE_PROVIDER: z.enum(["anthropic", "openai"]).optional(),
  JUDGE_API_KEY_VIRTUAL: opt,

  EVAL_BASE_URL: opt,
  EVAL_API_TOKEN: opt,

  DAILY_LIMIT_INR: z.coerce.number().positive().default(500),
  SCORING_PER_MINUTE: int(5),
  WEB_CACHE_TTL_DAYS: int(7),
  MAX_RESEARCH_ITER: int(4),
  MAX_RESEARCH_FETCHES: int(8),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // Treat empty strings (common in .env files) as unset.
  const cleaned: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const appEnv = resolveAppEnv(cleaned);
  if (appEnv) cleaned.APP_ENV = appEnv;
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

let cached: Env | undefined;
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

export class MissingEnvError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing required environment variables: ${missing.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

/** Throw a MissingEnvError naming every absent key. Never logs values. */
export function requireEnv<K extends keyof Env>(keys: K[], e: Env = env()): { [P in K]: NonNullable<Env[P]> } {
  const missing = keys.filter((k) => e[k] === undefined || e[k] === null);
  if (missing.length) throw new MissingEnvError(missing as string[]);
  return Object.fromEntries(keys.map((k) => [k, e[k]])) as { [P in K]: NonNullable<Env[P]> };
}

/**
 * Which DATABASE_URL this process uses. Tests and dev never touch prod:
 * APP_ENV=prod → DATABASE_URL (Neon main); otherwise → DATABASE_URL_DEV (Neon dev/test branch).
 */
export function databaseUrl(e: Env = env()): string {
  if (e.APP_ENV === "prod") return requireEnv(["DATABASE_URL"], e).DATABASE_URL;
  return requireEnv(["DATABASE_URL_DEV"], e).DATABASE_URL_DEV;
}
