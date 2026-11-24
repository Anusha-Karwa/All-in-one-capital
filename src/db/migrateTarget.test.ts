import { describe, expect, it } from "vitest";
import { migrateTarget } from "./migrateTarget";

describe("deploy-time migration target", () => {
  it("Vercel production migrates prod, preferring the unpooled URL", () => {
    expect(
      migrateTarget({
        VERCEL_ENV: "production",
        DATABASE_URL: "postgres://pooled",
        DATABASE_URL_UNPOOLED: "postgres://direct",
      }),
    ).toEqual({ url: "postgres://direct", label: "prod (unpooled)" });
    expect(migrateTarget({ VERCEL_ENV: "production", DATABASE_URL: "postgres://pooled" })).toEqual({
      url: "postgres://pooled",
      label: "prod",
    });
  });
  it("a preview build NEVER migrates the shared prod DATABASE_URL", () => {
    expect(
      migrateTarget({
        VERCEL_ENV: "preview",
        APP_ENV: "dev",
        DATABASE_URL: "postgres://prod",
        DATABASE_URL_UNPOOLED: "postgres://prod",
      }),
    ).toEqual({ skip: "dev has no DATABASE_URL_DEV" });
    expect(
      migrateTarget({ VERCEL_ENV: "preview", DATABASE_URL: "postgres://prod", DATABASE_URL_DEV: "postgres://dev" }),
    ).toEqual({ url: "postgres://dev", label: "dev" });
  });
  it("skips cleanly when nothing is configured or the DB is local PGlite", () => {
    expect(migrateTarget({})).toHaveProperty("skip");
    expect(migrateTarget({ DATABASE_URL_DEV: "pglite://./.pglite" })).toHaveProperty("skip");
  });
});
