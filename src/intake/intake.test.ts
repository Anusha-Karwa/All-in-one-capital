import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { freshTestDb } from "@/db/migrate-local";
import { applications, auditLog, documentPages, documents, flags, founders, foundersPii } from "@/db/schema";
import { decryptPii } from "@/lib/crypto";
import { makePdf } from "../../tests/makePdf";
import { parseDocuments } from "./parseDocuments";
import type { ScreeningQueue } from "./queue";
import { hitRateLimit } from "./rateLimit";
import { reconcileStuck } from "./reconcile";
import { applicationInput, validateFiles } from "./schema";
import { localStorageAt } from "./storage";
import { submitApplication, type SubmitDeps } from "./submit";

const KEY = Buffer.alloc(32, 3).toString("base64");
let d: Db;
let deps: SubmitDeps;
let enqueued: string[];

// SYNTHETIC applicant — not one of the seed companies.
const form = () =>
  applicationInput.parse({
    companyName: "Synthetica Labs",
    sector: "fintech",
    stage: "pre_seed",
    howHeard: "warm_intro",
    referrer: "Intro via a portfolio founder (ping me at intro@example.com)",
    founders: [
      {
        fullName: "Asha Example",
        email: "Asha@Example.com",
        phone: "+91 98765 43210",
        linkedinUrl: "https://linkedin.com/in/asha-x",
        role: "CEO",
        background: "CA, 4 yrs GST practice. Call 9876543210",
      },
    ],
    consent: true,
  });

beforeEach(async () => {
  d = await freshTestDb();
  enqueued = [];
  const queue: ScreeningQueue = { enqueue: async (id) => (enqueued.push(id), { enqueued: true }) };
  deps = { storage: localStorageAt(mkdtempSync(path.join(tmpdir(), "uploads-"))), queue, piiKey: KEY };
}, 30_000);

const deck = async (text = "Synthetica deck page") => ({
  kind: "deck" as const,
  filename: "deck.pdf",
  bytes: await makePdf([[text], ["Traction: 3 pilots"]]),
});

describe("form validation", () => {
  it("requires consent and at least one founder", () => {
    expect(applicationInput.safeParse({ ...form(), consent: false }).success).toBe(false);
    expect(applicationInput.safeParse({ ...form(), founders: [] }).success).toBe(false);
  });
  it("files: deck required, PDF magic bytes, size limits", async () => {
    expect(validateFiles([])).toContain("A pitch deck (PDF) is required");
    expect(validateFiles([{ kind: "deck", filename: "x.pdf", bytes: new TextEncoder().encode("hello") }])[0]).toMatch(
      /not a PDF/,
    );
    expect(validateFiles([await deck()])).toEqual([]);
  });
});

describe("submitApplication", () => {
  it("creates a received application with a sequential public ref, warm-intro source, and enqueues it", async () => {
    const r = await submitApplication(d, form(), [await deck()], { source: "form" }, deps);
    expect(r.publicRef).toMatch(/^APP-\d{4}-0001$/);
    expect(r.duplicate).toBe(false);
    expect(enqueued).toEqual([r.applicationId]);
    const [a] = await d.select().from(applications);
    expect(a).toMatchObject({ status: "received", source: "warm_intro", sectorClaimed: "fintech" });
    expect(a.sourceDetail).not.toContain("intro@example.com");
    expect(await d.select().from(auditLog)).toHaveLength(1);
  });

  it("splits PII: founders row has no PII; founders_pii is encrypted and decryptable", async () => {
    await submitApplication(d, form(), [await deck()], { source: "form" }, deps);
    const [f] = await d.select().from(founders);
    expect(f.id).toBe("F-1001");
    expect(f.backgroundSummary).toBe("CA, 4 yrs GST practice. Call [phone]");
    expect(JSON.stringify(f)).not.toMatch(/asha|example\.com|98765/i);
    const [p] = await d.select().from(foundersPii);
    expect(JSON.stringify(p)).not.toMatch(/asha|example\.com|98765/i);
    expect(decryptPii(p.emailEnc, KEY)).toBe("asha@example.com");
    expect(decryptPii(p.firstNameEnc, KEY)).toBe("Asha");
    const [fl] = await d.select().from(flags);
    expect(fl).toMatchObject({ type: "pii_in_text", severity: "low" });
  });

  it("duplicate submission (same company + same files) merges into the existing application", async () => {
    const file = await deck();
    const r1 = await submitApplication(d, form(), [file], { source: "form" }, deps);
    const r2 = await submitApplication(
      d,
      { ...form(), companyName: "SYNTHETICA labs " },
      [file],
      { source: "form" },
      deps,
    );
    expect(r2).toMatchObject({ duplicate: true, publicRef: r1.publicRef });
    expect(await d.select().from(applications)).toHaveLength(1);
  });

  it("concurrent duplicates: exactly one row, both callers get the same ref", async () => {
    const file = await deck();
    const rs = await Promise.all([1, 2, 3].map(() => submitApplication(d, form(), [file], { source: "form" }, deps)));
    expect(new Set(rs.map((r) => r.publicRef)).size).toBe(1);
    expect(await d.select().from(applications)).toHaveLength(1);
  });

  it("is_test submissions never merge with live ones", async () => {
    const file = await deck();
    await submitApplication(d, form(), [file], { source: "form" }, deps);
    const t = await submitApplication(d, form(), [file], { source: "form", isTest: true }, deps);
    expect(t.duplicate).toBe(false);
  });

  it("refuses founder PII when no encryption key is available — before writing anything", async () => {
    await expect(
      submitApplication(d, form(), [await deck()], { source: "form" }, { ...deps, piiKey: "short" }),
    ).rejects.toThrow(/32 bytes/);
    expect(await d.select().from(applications)).toHaveLength(0);
  });

  it("storage failure → application kept as needs_attention (never lost)", async () => {
    const broken = {
      ...deps,
      storage: {
        put: async () => {
          throw new Error("disk full");
        },
        get: async () => new Uint8Array(),
      },
    };
    await expect(submitApplication(d, form(), [await deck()], { source: "form" }, broken)).rejects.toThrow("disk full");
    const [a] = await d.select().from(applications);
    expect(a).toMatchObject({ status: "needs_attention", statusReason: "intake_incomplete:documents" });
  });

  it("queue failure → stays received (picked up by the sweep), submission still succeeds", async () => {
    const r = await submitApplication(
      d,
      form(),
      [await deck()],
      { source: "form" },
      {
        ...deps,
        queue: {
          enqueue: async () => {
            throw new Error("down");
          },
        },
      },
    );
    expect(r.enqueued).toBe(false);
    expect((await d.select().from(applications))[0].status).toBe("received");
  });
});

describe("parseDocuments", () => {
  it("extracts page text into document_pages and is idempotent", async () => {
    const r = await submitApplication(
      d,
      form(),
      [await deck("Synthetica: payroll advances for SMEs")],
      { source: "form" },
      deps,
    );
    await parseDocuments(d, r.applicationId, deps.storage);
    const rep = await parseDocuments(d, r.applicationId, deps.storage);
    expect(rep.documents[0].pages).toBe(2);
    const pages = await d.select().from(documentPages);
    expect(pages).toHaveLength(2);
    expect(pages.find((p) => p.pageNo === 1)!.text).toContain("payroll advances");
    expect((await d.select().from(documents))[0].pageCount).toBe(2);
  });
});

describe("rate limit + reconciler", () => {
  it("allows 5/min per key then blocks; new window resets", async () => {
    const t = new Date("2026-11-23T10:00:05Z");
    const res = [];
    for (let i = 0; i < 6; i++) res.push((await hitRateLimit(d, "apply:ip1", 5, 60_000, t)).allowed);
    expect(res).toEqual([true, true, true, true, true, false]);
    expect((await hitRateLimit(d, "apply:ip2", 5, 60_000, t)).allowed).toBe(true);
    expect((await hitRateLimit(d, "apply:ip1", 5, 60_000, new Date("2026-11-23T10:01:01Z"))).allowed).toBe(true);
  });

  it("moves applications stuck >30 min in a transient state to needs_attention with a reason", async () => {
    const r = await submitApplication(d, form(), [await deck()], { source: "form" }, deps);
    const old = new Date(Date.now() - 31 * 60_000);
    await d
      .update(applications)
      .set({ status: "researching", statusChangedAt: old })
      .where(eq(applications.id, r.applicationId));
    const out = await reconcileStuck(d);
    expect(out).toEqual([{ id: r.applicationId, reason: "stuck_in_researching" }]);
    expect((await d.select().from(applications))[0]).toMatchObject({
      status: "needs_attention",
      statusReason: "stuck_in_researching",
    });
    expect(await reconcileStuck(d)).toEqual([]);
  });
});
