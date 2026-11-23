import { describe, expect, it } from "vitest";
import { backoffMs, RETRY_TABLE, ruleFor, runWithPolicy, ToolFailure } from "./retryPolicy";

const noSleep = async () => {};
const failing = (tool: string, failure: string, succeedOn?: number) => {
  let n = 0;
  return async () => {
    n++;
    if (succeedOn && n >= succeedOn) return "ok";
    throw new ToolFailure(tool, failure);
  };
};

describe("retry table (D12)", () => {
  it.each(RETRY_TABLE.map((r) => [r.tool, r.failure, r.maxRetries, r.onExhaust] as const))(
    "%s / %s → %i retries then %s",
    async (tool, failure, max, action) => {
      const r = await runWithPolicy(failing(tool, failure), noSleep);
      expect(r).toMatchObject({ ok: false, action, attempts: max + 1 });
    },
  );

  it("book_meeting permission revoked aborts immediately — zero retries", async () => {
    let calls = 0;
    const r = await runWithPolicy(async () => {
      calls++;
      throw new ToolFailure("book_meeting", "permission_revoked");
    }, noSleep);
    expect(calls).toBe(1);
    expect(r).toMatchObject({ ok: false, action: "escalate" });
  });

  it("transient failure that recovers on retry succeeds", async () => {
    expect(await runWithPolicy(failing("send_email", "timeout", 3), noSleep)).toEqual({
      ok: true,
      value: "ok",
      attempts: 3,
    });
  });

  it("unknown failures are not retried blindly", async () => {
    await expect(runWithPolicy(failing("send_email", "weird"), noSleep)).rejects.toThrow(/No retry rule/);
    expect(() => ruleFor("x", "y")).toThrow();
  });

  it("backoff is 1s, 2s, 4s plus ≤250ms jitter", () => {
    expect([0, 1, 2].map((a) => backoffMs(a, () => 0))).toEqual([1000, 2000, 4000]);
    expect(backoffMs(0, () => 0.999)).toBeLessThan(1250);
  });
});
