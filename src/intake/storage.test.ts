import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function mode(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  const m = await import("./storage");
  return m.blobMode();
}

describe("blob mode (D-036)", () => {
  it("a read-write token wins when present", async () => {
    expect(await mode({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x_y", BLOB_STORE_ID: "store_1" })).toBe("token");
  });
  it("Storage-tab stores (BLOB_STORE_ID only) use OIDC", async () => {
    expect(await mode({ BLOB_STORE_ID: "store_1" })).toBe("oidc");
  });
  it("nothing configured → null", async () => {
    expect(await mode({})).toBeNull();
  });

  it("prod without any Blob config refuses to fall back to local disk", async () => {
    vi.stubEnv("APP_ENV", "prod");
    const m = await import("./storage");
    expect(() => m.defaultStorage()).toThrow(/Blob storage is required in prod/);
  });
});
