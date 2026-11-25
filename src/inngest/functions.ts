import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { applications } from "@/db/schema";
import { env } from "@/env";
import { reconcileStuck } from "@/intake/reconcile";
import { defaultStorage } from "@/intake/storage";
import { EVENTS, inngest } from "./client";
import { markFailed, stepParse, stepQueue, stepStopUntilBuilt } from "./screening";

/**
 * Screening run per application (Case 04 Task 2). Concurrency 5; THROTTLE (queues extra runs — unlike
 * rateLimit, which would drop them) at SCORING_PER_MINUTE; 3 retries per step; on final failure the application
 * goes to needs_attention with the reason. Nothing disappears.
 */
export const screenApplication = inngest.createFunction(
  {
    id: "screen-application",
    triggers: [{ event: EVENTS.applicationReceived }],
    concurrency: { limit: 5 },
    throttle: { limit: env().SCORING_PER_MINUTE, period: "1m" },
    retries: 3,
    idempotency: "event.data.applicationId",
    onFailure: async ({ event, error }) => {
      const id = (event.data.event.data as { applicationId?: string }).applicationId;
      if (id) await markFailed(await db(), id, error.message);
    },
  },
  async ({ event, step }) => {
    const id = (event.data as { applicationId: string }).applicationId;
    await step.run("queue", async () => stepQueue(await db(), id));
    const parsed = await step.run("parse", async () => stepParse(await db(), id, defaultStorage()));
    if (!parsed.ok) return { id, ended: parsed.reason };
    await step.run("stop-until-built", async () => stepStopUntilBuilt(await db(), id, parsed.report));
    return { id, ended: "needs_attention" };
  },
);

/** Safety net: re-send events for anything still 'received' after 2 minutes (e.g. a send failed at intake). */
export const sweepReceived = inngest.createFunction(
  { id: "sweep-received", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    const ids = await step.run("find", async () =>
      (
        await (
          await db()
        )
          .select({ id: applications.id })
          .from(applications)
          .where(and(eq(applications.status, "received"), lt(applications.createdAt, new Date(Date.now() - 120_000))))
      ).map((r) => r.id),
    );
    if (ids.length)
      await step.sendEvent(
        "enqueue",
        ids.map((applicationId) => ({
          name: EVENTS.applicationReceived,
          data: { applicationId },
          id: `screen-${applicationId}`,
        })),
      );
    return { enqueued: ids.length };
  },
);

/** Reconciler (§4): anything >30 min in a transient state → needs_attention: stuck_in_<state>. */
export const reconcile = inngest.createFunction(
  { id: "reconcile-stuck", triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => {
    const out = await step.run("reconcile", async () => reconcileStuck(await db()));
    return { marked: out.length };
  },
);

export const functions = [screenApplication, sweepReceived, reconcile];
