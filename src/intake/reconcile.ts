import { and, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { applications, auditLog, TRANSIENT_STATUSES } from "@/db/schema";
import { STUCK_AFTER_MS } from "./status";

/** Stuck-job reconciler (§4): transient status older than 30 min → needs_attention: stuck_in_<state>. */
export async function reconcileStuck(d: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const stuck = await d
    .select({ id: applications.id, status: applications.status })
    .from(applications)
    .where(and(inArray(applications.status, [...TRANSIENT_STATUSES]), lt(applications.statusChangedAt, cutoff)));
  for (const s of stuck) {
    await d
      .update(applications)
      .set({ status: "needs_attention", statusReason: `stuck_in_${s.status}`, statusChangedAt: now })
      .where(and(inArray(applications.id, [s.id]), inArray(applications.status, [s.status]))); // don't clobber a concurrent move
    await d.insert(auditLog).values({
      actor: "system:reconciler",
      action: "mark_stuck",
      entityType: "application",
      entityId: s.id,
      detail: { from: s.status },
    });
  }
  return stuck.map((s) => ({ id: s.id, reason: `stuck_in_${s.status}` }));
}
