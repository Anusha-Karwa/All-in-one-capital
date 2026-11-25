import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { freshTestDb } from "@/db/migrate-local";
import { applications, auditLog, documentPages, documents } from "@/db/schema";
import { inngestQueue } from "@/intake/queue";
import { transitionStatus } from "@/intake/statusStore";
import { localStorageAt } from "@/intake/storage";
import { submitApplication } from "@/intake/submit";
import { makePdf } from "../../tests/makePdf";
import { currentStatus, markFailed, NOT_BUILT_REASON, stepParse, stepQueue, stepStopUntilBuilt } from "./screening";

let d: Db;
const storage = localStorageAt(mkdtempSync(path.join(tmpdir(), "scr-")));
const sent: unknown[] = [];

const WORDY = "SYNTHETIC deck page for tests with enough words on it to count as real extracted text content";
async function newApp(name = "Synthetica Labs", pages: string[][] = [[WORDY], [WORDY]]) {
  const files = [{ kind: "deck" as const, filename: "d.pdf", bytes: await makePdf(pages) }];
  const r = await submitApplication(
    d,
    { companyName: name },
    files,
    { source: "seed" },
    { storage, queue: inngestQueue(async (p) => sent.push(p)) },
  );
  return r.applicationId;
}

beforeEach(async () => {
  d = await freshTestDb();
  sent.length = 0;
}, 30_000);

describe("screening pipeline steps", () => {
  it("intake sends one Inngest event with a dedupe id", async () => {
    const id = await newApp();
    expect(sent).toEqual([{ name: "application/received", data: { applicationId: id }, id: `screen-${id}` }]);
  });

  it("happy path: received → queued → parsing → needs_attention(not built yet); pages extracted; audited", async () => {
    const id = await newApp();
    expect(await stepQueue(d, id)).toBe(true);
    const p = await stepParse(d, id, storage);
    expect(p.ok).toBe(true);
    expect((await d.select().from(documentPages)).length).toBe(2);
    await stepStopUntilBuilt(d, id, p.report);
    expect(await currentStatus(d, id)).toEqual({ status: "needs_attention", reason: NOT_BUILT_REASON });
    const changes = (await d.select().from(auditLog))
      .filter((a) => a.action === "status_change")
      .map((a) => (a.detail as { to: string }).to);
    expect(changes).toEqual(["queued", "parsing", "needs_attention"]);
  });

  it("a deck that is mostly images (little text) is flagged for the vision fallback", async () => {
    const id = await newApp("Imagey Co", [["logo"], ["chart"]]);
    await stepQueue(d, id);
    const p = await stepParse(d, id, storage);
    await stepStopUntilBuilt(d, id, p.report);
    expect((await currentStatus(d, id)).reason).toBe(`${NOT_BUILT_REASON};deck_mostly_images`);
  });

  it("a document that can't be read → needs_attention with a reason (never stuck)", async () => {
    const id = await newApp();
    await d.update(documents).set({ storageKey: "local:missing/file.pdf" }).where(eq(documents.applicationId, id));
    await stepQueue(d, id);
    const p = await stepParse(d, id, storage);
    expect(p).toMatchObject({ ok: false, reason: "parse_failed:deck" });
    expect((await currentStatus(d, id)).status).toBe("needs_attention");
  });

  it("final failure after retries → needs_attention: failed:<msg>, connection strings scrubbed", async () => {
    const id = await newApp();
    await stepQueue(d, id);
    await markFailed(d, id, "boom at postgres://user:pw@host/db");
    const s = await currentStatus(d, id);
    expect(s.status).toBe("needs_attention");
    expect(s.reason).toBe("failed:boom at [db-url]");
  });

  it("re-running a step is safe: a second queue/parse on a moved application is a no-op", async () => {
    const id = await newApp();
    await stepQueue(d, id);
    expect(await stepQueue(d, id)).toBe(false); // already queued
    await stepParse(d, id, storage);
    expect((await stepParse(d, id, storage)).reason).toBe("not_in_queued_state");
  });

  it("transitionStatus refuses human-only targets for the system and loses races gracefully", async () => {
    const id = await newApp();
    await expect(transitionStatus(d, id, ["received"], "approved", { kind: "system", name: "x" })).rejects.toThrow();
    await d.update(applications).set({ status: "queued" }).where(eq(applications.id, id));
    expect(await transitionStatus(d, id, ["received"], "queued", { kind: "system", name: "x" })).toBe(false);
  });
});

describe("Inngest function config", () => {
  it("uses THROTTLE (queues) not rateLimit (drops), concurrency 5, retries, and an onFailure handler", async () => {
    const { screenApplication, functions } = await import("./functions");
    const o = screenApplication.opts as unknown as Record<string, unknown>;
    expect(o.throttle).toEqual({ limit: 5, period: "1m" });
    expect(o.rateLimit).toBeUndefined();
    expect(o.concurrency).toEqual({ limit: 5 });
    expect(o.retries).toBe(3);
    expect(typeof o.onFailure).toBe("function");
    expect(functions.map((f) => (f.opts as { id: string }).id)).toEqual([
      "screen-application",
      "sweep-received",
      "reconcile-stuck",
    ]);
  });
});
