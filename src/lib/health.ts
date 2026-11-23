import type { Env } from "@/env";

export type CheckStatus = "ok" | "error" | "not_configured" | "configured_unprobed";
export interface CheckResult {
  status: CheckStatus;
  detail?: string;
  latencyMs?: number;
}
export interface HealthReport {
  ok: boolean;
  appEnv: Env["APP_ENV"];
  testMode: boolean;
  checks: Record<string, CheckResult>;
  checkedAt: string;
}

export type Probe = () => Promise<void>;

async function timed(probe: Probe): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await probe();
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch (err) {
    // Error messages only — never echo connection strings.
    const msg = err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "[db-url]") : "unknown error";
    return { status: "error", detail: msg.slice(0, 200), latencyMs: Date.now() - t0 };
  }
}

function presence(e: Env, keys: (keyof Env)[], phase: string): CheckResult {
  const missing = keys.filter((k) => !e[k]);
  return missing.length
    ? { status: "not_configured", detail: `missing ${missing.join(", ")} (wired in ${phase})` }
    : { status: "configured_unprobed", detail: `live probe added in ${phase}` };
}

/**
 * Build the /api/health report. Probes are injected so this is unit-testable.
 * Integrations that are not yet wired report `not_configured`/`configured_unprobed`
 * rather than pretending to be healthy.
 */
export async function buildHealthReport(e: Env, probes: { db?: Probe }): Promise<HealthReport> {
  const dbUrlKey: keyof Env = e.APP_ENV === "prod" ? "DATABASE_URL" : "DATABASE_URL_DEV";
  const checks: Record<string, CheckResult> = {
    database: !e[dbUrlKey]
      ? { status: "not_configured", detail: `missing ${dbUrlKey}` }
      : probes.db
        ? await timed(probes.db)
        : { status: "configured_unprobed" },
    portkey: presence(e, ["PORTKEY_API_KEY", "PORTKEY_VIRTUAL_KEY_GEMINI"], "Phase 1"),
    gemini: presence(
      e,
      ["GEMINI_API_KEY", "GEMINI_MODEL_FAST", "GEMINI_MODEL_SMART", "GEMINI_EMBEDDING_MODEL"],
      "Phase 1",
    ),
    langfuse: presence(e, ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"], "Phase 1"),
    inngest: presence(e, ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"], "Phase 3"),
    gmail: presence(e, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], "Phase 8"),
    calendar: presence(e, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], "Phase 8"),
  };
  // Overall ok = nothing is in error. Unconfigured integrations are expected during the phased build.
  // In prod the database must be reachable, not merely "not configured".
  const ok =
    Object.values(checks).every((c) => c.status !== "error") &&
    (e.APP_ENV !== "prod" || checks.database.status === "ok");
  return { ok, appEnv: e.APP_ENV, testMode: e.TEST_MODE, checks, checkedAt: new Date().toISOString() };
}
