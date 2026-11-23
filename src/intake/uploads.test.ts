import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleUpload } from "@vercel/blob/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { freshTestDb } from "@/db/migrate-local";
import { applications, documents } from "@/db/schema";
import { makePdf } from "../../tests/makePdf";
import { handleSubmission, type SubmissionDeps } from "./handleSubmission";
import { localStorageAt } from "./storage";
import { incomingPathFor, type IncomingStore, kindOfIncomingPath, uploadTokenOptions } from "./uploads";

describe("upload path rules", () => {
  it.each([
    ["incoming/deck/pitch.pdf", "deck"],
    ["incoming/form/application-AbC123xyz.pdf", "form"], // Blob's random suffix
    ["incoming/deck/../form/x.pdf", null],
    ["APP-2026-0001/deck-abc.pdf", null], // a stored application document — never referenceable
    ["incoming/other/x.pdf", null],
    ["incoming/deck/x.exe", null],
    ["incoming/deck/sub/x.pdf", null],
  ] as const)("%s → %s", (p, k) => expect(kindOfIncomingPath(p)).toBe(k));

  it("builds safe pathnames from arbitrary filenames", () => {
    expect(incomingPathFor("deck", "Our Deck (final) v2.1.PDF")).toBe("incoming/deck/Our-Deck-final-v2-1.pdf");
    expect(kindOfIncomingPath(incomingPathFor("form", "../../etc/passwd"))).toBe("form");
  });

  it("token constraints: PDF only, per-kind size cap, random suffix, short validity, 1-day TTL", () => {
    const o = uploadTokenOptions("incoming/deck/pitch.pdf", 1_000);
    expect(o).toEqual({
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 20 * 1024 * 1024,
      addRandomSuffix: true,
      validUntil: 1_000 + 600_000,
      ttlDays: 1,
    });
    expect(uploadTokenOptions("incoming/form/f.pdf").maximumSizeInBytes).toBe(10 * 1024 * 1024);
    expect(() => uploadTokenOptions("APP-2026-0001/deck.pdf")).toThrow();
  });

  it("Vercel handleUpload issues a client token for a valid path and refuses others (offline)", async () => {
    const token = "vercel_blob_rw_teststore123_secretsecretsecret";
    const req = (pathname: string) =>
      handleUpload({
        token,
        request: new Request("http://localhost/api/uploads", { method: "POST" }),
        body: { type: "blob.generate-client-token", payload: { pathname, clientPayload: null, multipart: false } },
        onBeforeGenerateToken: async (p) => uploadTokenOptions(p),
      });
    const ok = await req("incoming/deck/pitch.pdf");
    expect(ok.type).toBe("blob.generate-client-token");
    expect((ok as { clientToken: string }).clientToken).toMatch(/^vercel_blob_client_teststore123_/);
    await expect(req("APP-2026-0001/deck.pdf")).rejects.toThrow(/incoming/);
  });
});

/** In-memory stand-in for private Blob. */
function fakeIncoming(files: Record<string, Uint8Array>) {
  const deleted: string[] = [];
  const store: IncomingStore = {
    async get(p, max) {
      const b = files[p];
      if (!b) return null;
      return b.byteLength > max ? { tooLarge: true } : { bytes: b };
    },
    async del(ps) {
      deleted.push(...ps);
    },
  };
  return { store, deleted };
}

const KEY = Buffer.alloc(32, 5).toString("base64");
const payload = {
  companyName: "Synthetica Labs",
  sector: "fintech",
  stage: "pre_seed",
  founders: [{ fullName: "Asha Example", email: "asha@example.com", role: "CEO" }],
  consent: true,
};
const jsonReq = (body: unknown) =>
  new Request("http://x/api/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("handleSubmission — JSON with direct-upload references", () => {
  let d: Db;
  let deps: SubmissionDeps;
  let deck: Uint8Array;
  let fake: ReturnType<typeof fakeIncoming>;

  beforeEach(async () => {
    d = await freshTestDb();
    deck = await makePdf([["SYNTHETIC deck"]]);
    fake = fakeIncoming({
      "incoming/deck/pitch-A1b2C3.pdf": deck,
      "incoming/deck/big-Z9.pdf": new Uint8Array(21 * 1024 * 1024),
      "incoming/deck/notpdf-Q1.pdf": new TextEncoder().encode("hello world"),
    });
    deps = {
      storage: localStorageAt(mkdtempSync(path.join(tmpdir(), "up-"))),
      queue: { enqueue: async () => ({ enqueued: true }) },
      piiKey: KEY,
      incoming: fake.store,
    };
  }, 30_000);

  it("a 20 MB-class deck never passes through the request: refs in, application out, temp upload deleted", async () => {
    const r = await handleSubmission(
      d,
      jsonReq({
        payload,
        files: [{ kind: "deck", pathname: "incoming/deck/pitch-A1b2C3.pdf", filename: "pitch.pdf" }],
      }),
      "k1",
      deps,
    );
    expect(r.status).toBe(201);
    expect(r.body.publicRef).toMatch(/^APP-\d{4}-0001$/);
    const [doc] = await d.select().from(documents);
    expect(doc.kind).toBe("deck");
    expect(doc.storageKey).toMatch(/^local:APP-/); // copied into the application's own storage
    expect(fake.deleted).toEqual(["incoming/deck/pitch-A1b2C3.pdf"]);
  });

  it("refuses references outside incoming/ (e.g. another applicant's stored deck) and kind/path mismatches", async () => {
    for (const ref of [
      { kind: "deck", pathname: "APP-2026-0001/deck-abc.pdf", filename: "x.pdf" },
      { kind: "form", pathname: "incoming/deck/pitch-A1b2C3.pdf", filename: "x.pdf" },
    ]) {
      const r = await handleSubmission(d, jsonReq({ payload, files: [ref] }), "k2", deps);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/not a valid upload reference/);
    }
    expect(await d.select().from(applications)).toHaveLength(0);
  });

  it("re-validates on the server: oversize and non-PDF uploads are rejected and cleaned up", async () => {
    const big = await handleSubmission(
      d,
      jsonReq({ payload, files: [{ kind: "deck", pathname: "incoming/deck/big-Z9.pdf", filename: "big.pdf" }] }),
      "k3",
      deps,
    );
    expect(big.status).toBe(400);
    expect(JSON.stringify(big.body)).toMatch(/larger than 20 MB/);
    const fake2 = await handleSubmission(
      d,
      jsonReq({ payload, files: [{ kind: "deck", pathname: "incoming/deck/notpdf-Q1.pdf", filename: "x.pdf" }] }),
      "k3",
      deps,
    );
    expect(JSON.stringify(fake2.body)).toMatch(/not a PDF/);
    expect(fake.deleted).toEqual(expect.arrayContaining(["incoming/deck/big-Z9.pdf", "incoming/deck/notpdf-Q1.pdf"]));
  });

  it("expired/missing upload → clear message to re-attach", async () => {
    const r = await handleSubmission(
      d,
      jsonReq({ payload, files: [{ kind: "deck", pathname: "incoming/deck/gone-X.pdf", filename: "gone.pdf" }] }),
      "k4",
      deps,
    );
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/expired/);
  });

  it("invalid application data still deletes the temp upload", async () => {
    const r = await handleSubmission(
      d,
      jsonReq({
        payload: { ...payload, consent: false },
        files: [{ kind: "deck", pathname: "incoming/deck/pitch-A1b2C3.pdf", filename: "p.pdf" }],
      }),
      "k5",
      deps,
    );
    expect(r.status).toBe(400);
    expect(fake.deleted).toContain("incoming/deck/pitch-A1b2C3.pdf");
  });

  it("honeypot → 202, nothing stored, temp upload deleted", async () => {
    const r = await handleSubmission(
      d,
      jsonReq({
        payload,
        fax: "spam",
        files: [{ kind: "deck", pathname: "incoming/deck/pitch-A1b2C3.pdf", filename: "p.pdf" }],
      }),
      "k6",
      deps,
    );
    expect(r.status).toBe(202);
    expect(await d.select().from(applications)).toHaveLength(0);
    expect(fake.deleted).toContain("incoming/deck/pitch-A1b2C3.pdf");
  });

  it("JSON submissions need Blob configured", async () => {
    const r = await handleSubmission(d, jsonReq({ payload, files: [] }), "k7", { ...deps, incoming: undefined });
    expect(r.status).toBe(503);
  });

  it("rate limit applies to the JSON path too", async () => {
    const codes = [];
    for (let i = 0; i < 6; i++)
      codes.push((await handleSubmission(d, jsonReq({ payload: {}, files: [] }), "same-ip", deps)).status);
    expect(codes.at(-1)).toBe(429);
  });

  it("multipart path (local dev) still works", async () => {
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    fd.set("deck", new File([Buffer.from(deck)], "deck.pdf", { type: "application/pdf" }));
    const r = await handleSubmission(d, new Request("http://x/api/applications", { method: "POST", body: fd }), "k8", {
      ...deps,
      incoming: undefined,
    });
    expect(r.status).toBe(201);
  });
});
