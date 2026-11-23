import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES } from "@/db/schema";
import {
  assertTransition,
  IllegalTransitionError,
  STUCK_AFTER_MS,
  stuckReason,
  TRANSITIONS,
  type Status,
} from "./status";

const sys = { kind: "system", name: "pipeline" } as const;
const riya = { kind: "human", email: "riya@fund.test" } as const;

describe("status lifecycle", () => {
  it("defines edges for every status and only to known statuses", () => {
    for (const s of APPLICATION_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined();
      for (const t of TRANSITIONS[s]) expect(APPLICATION_STATUSES).toContain(t);
    }
  });

  it("every status can reach a resting state (nothing can be stranded)", () => {
    const resting = new Set<Status>(["scored", "needs_attention", "in_review", "closed", "call_booked"]);
    for (const s of APPLICATION_STATUSES) {
      const seen = new Set<Status>([s]);
      const q: Status[] = [s];
      while (q.length)
        for (const t of TRANSITIONS[q.shift()!])
          if (!seen.has(t)) {
            seen.add(t);
            q.push(t);
          }
      expect(
        [...seen].some((x) => resting.has(x)),
        s,
      ).toBe(true);
    }
  });

  it("the pipeline reaches scored, never approved/rejected (KILL-4)", () => {
    for (const [from, to] of [
      ["received", "queued"],
      ["queued", "parsing"],
      ["parsing", "researching"],
      ["researching", "scoring"],
      ["scoring", "scored"],
    ] as const)
      expect(() => assertTransition(from, to, sys)).not.toThrow();
    for (const to of ["approved", "rejected", "on_hold"] as const) {
      expect(() => assertTransition("in_review", to, sys)).toThrow(IllegalTransitionError);
      expect(() => assertTransition("in_review", to, riya)).not.toThrow();
    }
  });

  it("no shortcut from scored straight to approved, even for a human", () => {
    expect(() => assertTransition("scored", "approved", riya)).toThrow(/not an allowed edge/);
  });

  it("system can't send outreach; can close only after a founder reply", () => {
    expect(() => assertTransition("outreach_drafted", "outreach_sent", sys)).toThrow();
    expect(() => assertTransition("awaiting_reply", "closed", sys)).not.toThrow();
    expect(() => assertTransition("escalated", "closed", sys)).toThrow();
  });

  it("needs_attention must carry a reason", () => {
    expect(() => assertTransition("parsing", "needs_attention", sys)).toThrow(/reason/);
    expect(() => assertTransition("parsing", "needs_attention", sys, "budget_paused")).not.toThrow();
  });

  it("reconciler: transient >30 min is stuck; exactly 30 min is not; resting states never", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    expect(stuckReason("researching", new Date(now.getTime() - STUCK_AFTER_MS - 1), now)).toBe("stuck_in_researching");
    expect(stuckReason("researching", new Date(now.getTime() - STUCK_AFTER_MS), now)).toBeNull();
    expect(stuckReason("scored", new Date(0), now)).toBeNull();
    expect(stuckReason("in_review", new Date(0), now)).toBeNull();
  });
});
