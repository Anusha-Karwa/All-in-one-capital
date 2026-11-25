import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { applications, auditLog } from "@/db/schema";
import { type Actor, assertTransition, type Status } from "./status";

/**
 * Move an application to `to`, only if it is currently in one of `from` (optimistic, race-safe), and only along
 * the transition whitelist (src/intake/status.ts). Returns false if someone else already moved it.
 */
export async function transitionStatus(
  d: Db,
  id: string,
  from: Status[],
  to: Status,
  actor: Actor,
  reason?: string | null,
): Promise<boolean> {
  const [cur] = await d.select({ status: applications.status }).from(applications).where(eq(applications.id, id));
  if (!cur) throw new Error(`application ${id} not found`);
  if (!from.includes(cur.status)) return false;
  assertTransition(cur.status, to, actor, reason);
  const res = await d
    .update(applications)
    .set({ status: to, statusReason: reason ?? null, statusChangedAt: new Date() })
    .where(and(eq(applications.id, id), inArray(applications.status, [cur.status])))
    .returning({ id: applications.id });
  if (!res.length) return false;
  await d.insert(auditLog).values({
    actor: actor.kind === "human" ? actor.email : `system:${actor.name}`,
    action: "status_change",
    entityType: "application",
    entityId: id,
    detail: { from: cur.status, to, reason: reason ?? null },
  });
  return true;
}
