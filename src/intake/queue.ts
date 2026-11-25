import { logger } from "@/lib/logger";

/**
 * Screening queue. Phase 3 wires Inngest (concurrency 5, throttle SCORING_PER_MINUTE). Until then the
 * no-op queue leaves applications in `received`; nothing is lost — a sweep enqueues every `received` row
 * once Inngest is configured, and the reconciler surfaces anything that sits too long.
 */
export interface ScreeningQueue {
  enqueue(applicationId: string): Promise<{ enqueued: boolean }>;
}

export const noopQueue: ScreeningQueue = {
  async enqueue(applicationId) {
    logger.info({ applicationId }, "queue not configured — application left in 'received'");
    return { enqueued: false };
  },
};

/** Inngest-backed queue. Event id = applicationId, so a duplicate send can't start a second run. */
export function inngestQueue(
  send: (p: { name: string; data: { applicationId: string }; id: string }) => Promise<unknown>,
): ScreeningQueue {
  return {
    async enqueue(applicationId) {
      await send({ name: "application/received", data: { applicationId }, id: `screen-${applicationId}` });
      return { enqueued: true };
    },
  };
}

export async function defaultQueue(): Promise<ScreeningQueue> {
  const { env } = await import("@/env");
  if (!env().INNGEST_EVENT_KEY) return noopQueue;
  const { inngest } = await import("@/inngest/client");
  return inngestQueue((p) => inngest.send(p));
}
