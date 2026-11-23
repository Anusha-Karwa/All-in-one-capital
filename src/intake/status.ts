/**
 * Application lifecycle (§4). Every application is in exactly one status; only listed transitions are legal.
 *
 * R12 / kill criterion 4: approved / rejected / on_hold can ONLY be set by a human actor. The pipeline can at
 * most reach `scored` or `needs_attention`. Anything else throws.
 */
import type { APPLICATION_STATUSES } from "@/db/schema";
import { TRANSIENT_STATUSES } from "@/db/schema";

export type Status = (typeof APPLICATION_STATUSES)[number];
export type Actor = { kind: "system"; name: string } | { kind: "human"; email: string };

export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  received: ["queued", "needs_attention"],
  queued: ["parsing", "needs_attention"],
  parsing: ["researching", "needs_attention", "queued"],
  researching: ["scoring", "needs_attention", "queued"],
  scoring: ["scored", "needs_attention", "queued"],
  scored: ["in_review", "needs_attention", "queued"],
  needs_attention: ["queued", "in_review"],
  in_review: ["approved", "rejected", "on_hold", "queued"],
  on_hold: ["in_review", "approved", "rejected", "queued"],
  approved: ["outreach_drafted", "on_hold"],
  rejected: ["outreach_drafted", "closed", "in_review"],
  outreach_drafted: ["outreach_sent", "in_review"],
  outreach_sent: ["awaiting_reply", "escalated"],
  awaiting_reply: ["scheduling", "escalated", "closed"],
  scheduling: ["call_booked", "escalated", "awaiting_reply"],
  escalated: ["scheduling", "awaiting_reply", "in_review", "closed"],
  call_booked: ["scheduling", "closed"],
  closed: [],
};

/** Statuses that only a human may set (no auto-reject, no auto-advance). */
export const HUMAN_ONLY: ReadonlySet<Status> = new Set<Status>([
  "approved",
  "rejected",
  "on_hold",
  "outreach_sent",
  "closed",
]);
/** Exception: the scheduling agent may close a thread when the founder says "not interested" (§8.3). */
const SYSTEM_MAY_CLOSE_FROM: ReadonlySet<Status> = new Set<Status>(["awaiting_reply", "call_booked"]);

export class IllegalTransitionError extends Error {
  constructor(from: Status, to: Status, why: string) {
    super(`Illegal status transition ${from} → ${to}: ${why}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: Status, to: Status, actor: Actor, reason?: string | null): void {
  if (!TRANSITIONS[from].includes(to)) throw new IllegalTransitionError(from, to, "not an allowed edge");
  if (HUMAN_ONLY.has(to) && actor.kind !== "human") {
    const allowed = to === "closed" && SYSTEM_MAY_CLOSE_FROM.has(from);
    if (!allowed) throw new IllegalTransitionError(from, to, "only a human may set this status (R12)");
  }
  // outreach_sent additionally requires the human Approve & Send — enforced in the send path (Phase 8).
  if (to === "needs_attention" && !reason)
    throw new IllegalTransitionError(from, to, "needs_attention requires a reason");
}

export const STUCK_AFTER_MS = 30 * 60 * 1000;

/** Reconciler rule: a transient status older than 30 min → needs_attention with reason stuck_in_<state>. */
export function stuckReason(status: Status, statusChangedAt: Date, now = new Date()): string | null {
  if (!(TRANSIENT_STATUSES as readonly string[]).includes(status)) return null;
  return now.getTime() - statusChangedAt.getTime() > STUCK_AFTER_MS ? `stuck_in_${status}` : null;
}
