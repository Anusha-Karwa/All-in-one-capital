import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";
import { buildHealthReport } from "./health";

describe("health report", () => {
  it("reports unconfigured integrations honestly without failing overall", async () => {
    const r = await buildHealthReport(parseEnv({ APP_ENV: "test" }), {});
    expect(r.ok).toBe(true);
    expect(r.checks.database.status).toBe("not_configured");
    expect(r.checks.portkey.status).toBe("not_configured");
    expect(r.testMode).toBe(true);
  });

  it("in prod, a missing database makes the report unhealthy", async () => {
    const r = await buildHealthReport(parseEnv({ APP_ENV: "prod" }), {});
    expect(r.ok).toBe(false);
  });

  it("marks the DB ok when the probe succeeds", async () => {
    const r = await buildHealthReport(parseEnv({ APP_ENV: "test", DATABASE_URL_DEV: "postgres://x" }), {
      db: async () => {},
    });
    expect(r.checks.database.status).toBe("ok");
    expect(r.ok).toBe(true);
  });

  it("fails overall and redacts connection strings when the DB probe throws", async () => {
    const r = await buildHealthReport(parseEnv({ APP_ENV: "test", DATABASE_URL_DEV: "postgres://x" }), {
      db: async () => {
        throw new Error("cannot reach postgres://user:pw@host/db");
      },
    });
    expect(r.ok).toBe(false);
    expect(r.checks.database.status).toBe("error");
    expect(r.checks.database.detail).not.toContain("pw@host");
  });
});
