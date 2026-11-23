import { describe, expect, it } from "vitest";
import { databaseUrl, MissingEnvError, parseEnv, requireEnv } from "./env";

describe("env", () => {
  it("applies safe defaults (TEST_MODE on, ₹500 limit, loop caps)", () => {
    const e = parseEnv({});
    expect(e.TEST_MODE).toBe(true);
    expect(e.DAILY_LIMIT_INR).toBe(500);
    expect(e.MAX_RESEARCH_ITER).toBe(4);
    expect(e.MAX_RESEARCH_FETCHES).toBe(8);
    expect(e.WEB_CACHE_TTL_DAYS).toBe(7);
    expect(e.SCORING_PER_MINUTE).toBe(5);
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ GEMINI_API_KEY: "" }).GEMINI_API_KEY).toBeUndefined();
  });

  it("parses ALLOWED_EMAILS into a lowercase list", () => {
    expect(parseEnv({ ALLOWED_EMAILS: " A@x.com, b@y.com ," }).ALLOWED_EMAILS).toEqual(["a@x.com", "b@y.com"]);
  });

  it("rejects a PII key that is not 32 bytes", () => {
    expect(() => parseEnv({ PII_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
    expect(parseEnv({ PII_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }).PII_ENCRYPTION_KEY).toBeTruthy();
  });

  it("requireEnv names every missing key and never the values", () => {
    const e = parseEnv({ GEMINI_API_KEY: "secret-value" });
    try {
      requireEnv(["GEMINI_API_KEY", "PORTKEY_API_KEY", "LANGFUSE_PUBLIC_KEY"], e);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvError);
      expect((err as Error).message).toContain("PORTKEY_API_KEY");
      expect((err as Error).message).toContain("LANGFUSE_PUBLIC_KEY");
      expect((err as Error).message).not.toContain("secret-value");
    }
  });

  it("never routes non-prod processes to the prod database", () => {
    const vars = { DATABASE_URL: "postgres://prod", DATABASE_URL_DEV: "postgres://dev" };
    expect(databaseUrl(parseEnv({ ...vars, APP_ENV: "test" }))).toBe("postgres://dev");
    expect(databaseUrl(parseEnv({ ...vars, APP_ENV: "dev" }))).toBe("postgres://dev");
    expect(databaseUrl(parseEnv({ ...vars, APP_ENV: "prod" }))).toBe("postgres://prod");
    expect(() => databaseUrl(parseEnv({ DATABASE_URL: "postgres://prod", APP_ENV: "test" }))).toThrow(MissingEnvError);
  });
});
