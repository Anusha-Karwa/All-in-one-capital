import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let exporter: InMemorySpanExporter;

beforeEach(async () => {
  vi.resetModules();
  exporter = new InMemorySpanExporter();
  const t = await import("./tracer");
  t.initLangfuse({ exporter, force: true });
});
afterEach(() => vi.unstubAllEnvs());

const attrs = (s: { attributes: Record<string, unknown> }) => s.attributes;

describe("Langfuse v6 tracer (OTel)", () => {
  it("exports a generation with model, prompt version, usage, cost — PII masked — under the run's trace id", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    const t = await import("./tracer");
    const tracer = t.langfuseTracer();
    tracer.generation({
      traceId: "screen:APP-2026-0007:run1",
      name: "extract_claims_deck",
      promptRef: "extract_claims_deck@v2",
      model: "gemini-3.7-flash",
      input: "Founder email priya@acme.in, phone +91 98765 43210; TAM ₹14,400 Cr",
      output: '{"claims":[]}',
      usage: { inputTokens: 120, outputTokens: 69, cachedTokens: 0 },
      costUsd: 0.00042,
      latencyMs: 900,
      level: "DEFAULT",
    });
    await t.flushTraces();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const a = attrs(spans[0]);
    const all = JSON.stringify(a);
    expect(spans[0].name).toBe("extract_claims_deck");
    expect(all).toContain("generation");
    expect(all).toContain("gemini-3.7-flash");
    expect(all).toContain("extract_claims_deck@v2");
    expect(all).toContain("0.00042");
    expect(all).toContain("TAM ₹14,400 Cr"); // business data kept
    expect(all).not.toMatch(/priya@acme\.in|98765/); // PII masked before export
    expect(spans[0].spanContext().traceId).toBe(await t.langfuseTraceId("screen:APP-2026-0007:run1"));
    expect(
      spans[0].endTime[0] * 1e3 +
        spans[0].endTime[1] / 1e6 -
        (spans[0].startTime[0] * 1e3 + spans[0].startTime[1] / 1e6),
    ).toBeGreaterThanOrEqual(899);
  });

  it("two calls from the same run share one trace; different runs don't", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    const t = await import("./tracer");
    const base = {
      promptRef: "p@v1",
      model: "m",
      input: "x",
      output: "y",
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
      costUsd: 0,
      latencyMs: 1,
      level: "DEFAULT" as const,
    };
    const tracer = t.langfuseTracer();
    tracer.generation({ ...base, traceId: "screen:A:1", name: "a" });
    tracer.generation({ ...base, traceId: "screen:A:1", name: "b" });
    tracer.generation({ ...base, traceId: "screen:B:1", name: "c" });
    await t.flushTraces();
    const ids = exporter.getFinishedSpans().map((s) => s.spanContext().traceId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("error generations carry level + status message", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    const t = await import("./tracer");
    t.langfuseTracer().generation({
      traceId: "r",
      name: "score",
      promptRef: "score@v1",
      model: "m",
      input: null,
      output: null,
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
      costUsd: 0,
      latencyMs: 0,
      level: "ERROR",
      statusMessage: "rate_limited",
    });
    await t.flushTraces();
    const all = JSON.stringify(attrs(exporter.getFinishedSpans()[0]));
    expect(all).toContain("ERROR");
    expect(all).toContain("rate_limited");
  });

  it("maskForExport masks nested PII and leaves other data", async () => {
    const { maskForExport } = await import("./tracer");
    expect(maskForExport({ a: "mail x@y.com", b: [1, "ok"] })).toEqual({ a: "mail [email]", b: [1, "ok"] });
    expect(maskForExport(null)).toBeNull();
  });
});
