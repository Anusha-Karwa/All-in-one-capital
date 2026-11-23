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
