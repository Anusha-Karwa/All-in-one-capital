/**
 * Intake (§9.5): validate → idempotency → application row (status `received`) → founders split into
 * non-PII `founders` + encrypted `founders_pii` → documents stored → audit → enqueue.
 *
 * Nothing is lost: if anything fails after the application row exists, the row is moved to
 * `needs_attention: intake_incomplete:<step>` instead of disappearing.
 */
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { maskPii, scanPii } from "@/ai/pii";
import { execRows, type Db } from "@/db/client";
import { applications, auditLog, documents, founders, foundersPii, flags } from "@/db/schema";
import { encryptPii, keyedHash } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import type { ScreeningQueue } from "./queue";
import type { ApplicationInput, IncomingFile } from "./schema";
import type { DocStorage } from "./storage";

export interface SubmitDeps {
  storage: DocStorage;
  queue: ScreeningQueue;
  /** Override for tests; defaults to PII_ENCRYPTION_KEY. */
  piiKey?: string;
  now?: () => Date;
}

export interface SubmitMeta {
  source: "form" | "upload" | "seed" | "warm_intro";
  isTest?: boolean;
  actor?: string; // staff email for uploads/seed; "public" for the form
}

export interface SubmitResult {
  applicationId: string;
  publicRef: string;
  duplicate: boolean;
  enqueued: boolean;
}

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
export const normaliseCompany = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Same company + same files → same key → duplicate submissions merge into the existing application. */
export function idempotencyKey(companyName: string, files: { bytes: Uint8Array }[], isTest = false): string {
  const shas = files.map((f) => sha256(f.bytes)).sort();
  return sha256([isTest ? "test" : "live", normaliseCompany(companyName), ...shas].join("|"));
}

/** Application fields only (no founders) — used by staff upload and seed import, where the form PDF holds founder data. */
export type ApplicationCore = Partial<Omit<ApplicationInput, "consent" | "companyName">> & {
  companyName: string;
  /** sector/stage/founders are optional for seed/upload: filled from the form PDF by the extraction step. */
};

export async function submitApplication(
  d: Db,
  input: ApplicationCore,
  files: IncomingFile[],
  meta: SubmitMeta,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const now = deps.now?.() ?? new Date();
  const key = idempotencyKey(input.companyName, files, meta.isTest);

  const [existing] = await d.select().from(applications).where(eq(applications.idempotencyKey, key));
  if (existing) return { applicationId: existing.id, publicRef: existing.publicRef, duplicate: true, enqueued: false };

  // Fail early (before writing anything) if we'd be unable to protect founder PII.
  if (input.founders?.length) encryptPii("probe", deps.piiKey);

  const [{ n }] = await execRows<{ n: string }>(d, sql`select nextval('application_ref_seq') as n`);
  const publicRef = `APP-${now.getUTCFullYear()}-${String(n).padStart(4, "0")}`;
  const source = meta.source === "form" && input.howHeard === "warm_intro" ? "warm_intro" : meta.source;

  let app;
  try {
    [app] = await d
      .insert(applications)
      .values({
        publicRef,
        companyName: input.companyName,
        website: input.website ?? null,
        sectorClaimed: input.sector ?? null,
        stageClaimed: input.stage ?? null,
        location: input.location ?? null,
        incorporated: input.incorporated ?? null,
        amountRaising: input.amountRaising ?? null,
        valuation: input.valuation ?? null,
        source,
        sourceDetail: input.referrer ? maskPii(input.referrer) : null,
        status: "received",
        idempotencyKey: key,
        isTest: meta.isTest ?? false,
      })
      .returning();
  } catch (e) {
    // Concurrent duplicate submission lost the race on the unique key → return the winner.
    const [winner] = await d.select().from(applications).where(eq(applications.idempotencyKey, key));
    if (winner) return { applicationId: winner.id, publicRef: winner.publicRef, duplicate: true, enqueued: false };
    throw e;
  }

  let step = "founders";
  try {
    for (const f of input.founders ?? []) {
      const [{ n: fid }] = await execRows<{ n: string }>(d, sql`select nextval('founder_id_seq') as n`);
      const founderId = `F-${fid}`;
      const bgPii = f.background ? scanPii(f.background) : [];
      await d.insert(founders).values({
        id: founderId,
        applicationId: app.id,
        role: f.role,
        // Background summaries reach prompts, so any contact details typed into them are masked here.
        backgroundSummary: f.background ? maskPii(f.background) : null,
        linkedinUrlHash: f.linkedinUrl ? keyedHash(f.linkedinUrl, deps.piiKey) : null,
      });
      await d.insert(foundersPii).values({
        founderId,
        fullNameEnc: encryptPii(f.fullName, deps.piiKey),
        firstNameEnc: encryptPii(f.fullName.split(/\s+/)[0], deps.piiKey),
        emailEnc: encryptPii(f.email, deps.piiKey),
        phoneEnc: encryptPii(f.phone, deps.piiKey),
        linkedinUrlEnc: encryptPii(f.linkedinUrl, deps.piiKey),
      });
      if (bgPii.length)
        await d.insert(flags).values({
          applicationId: app.id,
          type: "pii_in_text",
          severity: "low",
          detail: `Founder ${founderId} background contained ${bgPii.join(", ")}; masked before storage.`,
        });
    }

    step = "documents";
    for (const f of files) {
      const hash = sha256(f.bytes);
      const stored = await deps.storage.put(`${app.publicRef}/${f.kind}-${hash.slice(0, 12)}.pdf`, f.bytes);
      await d.insert(documents).values({
        applicationId: app.id,
        kind: f.kind,
        filename: f.filename.slice(0, 200),
        blobUrl: stored.blobUrl,
        storageKey: stored.storageKey,
        sha256: hash,
      });
    }

    step = "audit";
    await d.insert(auditLog).values({
      actor: meta.actor ?? "public",
      action: "application_received",
      entityType: "application",
      entityId: app.id,
      detail: { publicRef, source, files: files.map((f) => f.kind), isTest: meta.isTest ?? false },
    });
  } catch (e) {
    logger.error({ applicationId: app.id, step, err: (e as Error).message }, "intake incomplete");
    await d
      .update(applications)
      .set({ status: "needs_attention", statusReason: `intake_incomplete:${step}`, statusChangedAt: new Date() })
      .where(eq(applications.id, app.id));
    throw e;
  }

  const { enqueued } = await deps.queue.enqueue(app.id).catch((e) => {
    logger.warn(
      { applicationId: app.id, err: (e as Error).message },
      "enqueue failed — stays 'received' for the sweep",
    );
    return { enqueued: false };
  });
  return { applicationId: app.id, publicRef, duplicate: false, enqueued };
}
