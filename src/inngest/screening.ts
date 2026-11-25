/**
 * The screening pipeline's steps as plain functions (testable without Inngest). The Inngest function in
 * ./functions.ts runs each one as a durable, retried step.
 *
 * Built so far: received → queued → parsing (PDF text per page). Claim extraction, research and scoring need
 * the model prompts and seed data and are not built yet, so a run currently ENDS in
 * needs_attention: "screening_not_built:extraction" — visible and honest, never a silent limbo.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { applications } from "@/db/schema";
import { parseDocuments, type ParseReport } from "@/intake/parseDocuments";
import type { Status } from "@/intake/status";
import { transitionStatus } from "@/intake/statusStore";
import type { DocStorage } from "@/intake/storage";

const SYS = { kind: "system", name: "screening" } as const;
export const NOT_BUILT_REASON = "screening_not_built:extraction";

export async function stepQueue(d: Db, id: string) {
  return transitionStatus(d, id, ["received", "needs_attention"], "queued", SYS);
}

export async function stepParse(
  d: Db,
  id: string,
  storage: DocStorage,
): Promise<{ ok: boolean; report?: ParseReport; reason?: string }> {
  const moved = await transitionStatus(d, id, ["queued"], "parsing", SYS);
  if (!moved) return { ok: false, reason: "not_in_queued_state" };
  const report = await parseDocuments(d, id, storage);
  const failed = report.documents.filter((x) => x.error);
  if (!report.documents.length || failed.length) {
    const reason = !report.documents.length
      ? "parse_failed:no_documents"
      : `parse_failed:${failed.map((f) => f.kind).join(",")}`;
    await transitionStatus(d, id, ["parsing"], "needs_attention", SYS, reason);
    return { ok: false, report, reason };
  }
  return { ok: true, report };
}

/** Placeholder end of pipeline until extraction/research/scoring exist. */
export async function stepStopUntilBuilt(d: Db, id: string, report?: ParseReport) {
  const reason = report?.needsVisionFallback ? `${NOT_BUILT_REASON};deck_mostly_images` : NOT_BUILT_REASON;
  return transitionStatus(d, id, ["parsing"], "needs_attention", SYS, reason);
}

const TRANSIENT: Status[] = ["received", "queued", "parsing", "researching", "scoring"];

/** After Inngest gives up retrying: never leave the application in a transient state. */
export async function markFailed(d: Db, id: string, error: string) {
  const reason = `failed:${error.replace(/postgres(ql)?:\/\/\S+/g, "[db-url]").slice(0, 180)}`;
  return transitionStatus(d, id, TRANSIENT, "needs_attention", SYS, reason);
}

export async function currentStatus(d: Db, id: string) {
  const [a] = await d
    .select({ status: applications.status, reason: applications.statusReason })
    .from(applications)
    .where(eq(applications.id, id));
  return a;
}
