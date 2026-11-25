import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";
import { billableUsage, estimateTokens, gatewayMode, portkeyHeader, truncateNormalize } from "./transport";

describe("transport helpers", () => {
  it("counts Gemini reasoning tokens as billable output (observed: completion 5, reasoning 64, total 77)", () => {
    const u = billableUsage({
      prompt_tokens: 8,
      completion_tokens: 5,
      total_tokens: 77,
      completion_tokens_details: { reasoning_tokens: 64 },
    });
    expect(u).toEqual({ inputTokens: 8, outputTokens: 69, cachedTokens: 0 });
  });
  it("does not double count when a provider already includes reasoning in completion_tokens", () => {
    const u = billableUsage({
      prompt_tokens: 10,
      completion_tokens: 50,
      total_tokens: 60,
      completion_tokens_details: { reasoning_tokens: 40 },
    });
    expect(u.outputTokens).toBe(50);
  });
  it("handles missing usage", () => {
    expect(billableUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  });

  it("reads Portkey headers with or without the x-portkey- prefix (the SDK strips it)", () => {
    expect(portkeyHeader({ "retry-attempt-count": "2" }, "retry-attempt-count")).toBe("2");
    expect(portkeyHeader({ "x-portkey-retry-attempt-count": "3" }, "retry-attempt-count")).toBe("3");
    expect(portkeyHeader(undefined, "request-id")).toBeUndefined();
  });

  it("truncates Matryoshka embeddings to 768 and re-normalises to unit length", () => {
    const v = Array.from({ length: 3072 }, (_, i) => Math.sin(i + 1));
    const t = truncateNormalize(v, 768);
    expect(t).toHaveLength(768);
    expect(Math.hypot(...t)).toBeCloseTo(1, 10);
    // direction preserved: proportional to the first 768 originals
    expect(t[5] / t[7]).toBeCloseTo(v[5] / v[7], 10);
    expect(() => truncateNormalize([1, 2], 768)).toThrow();
  });

  it("estimates embedding tokens (~4 chars/token)", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("")).toBe(1);
  });

  it("uses hosted Portkey when its keys exist, else the in-process OSS gateway, else nothing", () => {
    expect(gatewayMode(parseEnv({ GEMINI_API_KEY: "k" }))).toBe("in_process");
    expect(gatewayMode(parseEnv({ GEMINI_API_KEY: "k", PORTKEY_API_KEY: "p", PORTKEY_VIRTUAL_KEY_GEMINI: "v" }))).toBe(
      "hosted",
    );
    expect(gatewayMode(parseEnv({}))).toBeNull();
  });
});
