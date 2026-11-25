/**
 * Langfuse tracing (Case 04 Task 4) via Langfuse's current OpenTelemetry SDK (v6).
 *
 * The legacy `langfuse` package used the v3 ingestion API, which Langfuse Cloud shut down on 2026-11-16
 * (HTTP 410) — traces were silently dropped. See DECISIONS D-043.
 *
 * - Isolated tracer provider (setLangfuseTracerProvider) so nothing else's OpenTelemetry setup is affected.
 * - Our trace ids (e.g. "screen:APP-2026-0001:<run>") map deterministically to W3C trace ids, so every step and
 *   model call of one application run lands in one Langfuse trace.
 * - Everything is PII-masked before export ("send less, log less").
 */
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { createTraceId, setLangfuseTracerProvider, startObservation } from "@langfuse/tracing";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { maskPii } from "./pii";
import type { GenerationTrace, Tracer } from "./types";

let processor: LangfuseSpanProcessor | undefined;
const pending = new Set<Promise<unknown>>();

export function maskForExport(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") return maskPii(data);
  try {
    return JSON.parse(maskPii(JSON.stringify(data)));
  } catch {
    return "[unserialisable]";
  }
}

/** Initialise the isolated Langfuse tracer provider. `exporter` is for tests. Returns false when not configured. */
export function initLangfuse(opts: { exporter?: SpanExporter; force?: boolean } = {}): boolean {
  if (processor && !opts.force) return true;
  const e = env();
  if (!opts.exporter && (!e.LANGFUSE_PUBLIC_KEY || !e.LANGFUSE_SECRET_KEY)) return false;
  processor = new LangfuseSpanProcessor({
    publicKey: e.LANGFUSE_PUBLIC_KEY,
    secretKey: e.LANGFUSE_SECRET_KEY,
    baseUrl: e.LANGFUSE_HOST,
    environment: e.APP_ENV,
    exporter: opts.exporter,
    mask: ({ data }) => maskForExport(data),
    // Serverless functions can be frozen right after responding: export each span immediately (D-043).
    flushAt: 1,
  });
  setLangfuseTracerProvider(
    new NodeTracerProvider({
      resource: resourceFromAttributes({ "service.name": "allin-screener" }),
      spanProcessors: [processor],
    }),
  );
  return true;
}

/** W3C trace id for one of our trace ids (deterministic), or a random one. */
export async function langfuseTraceId(ourTraceId?: string): Promise<string> {
  return createTraceId(ourTraceId ?? "");
}

const randomSpanId = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

async function recordGeneration(g: GenerationTrace): Promise<void> {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(0, g.latencyMs));
  const traceId = await langfuseTraceId(g.traceId);
  const gen = startObservation(
    g.name,
    {
      model: g.model,
      input: g.input,
      version: g.promptRef, // prompt name@version (Task 4: record which prompt version produced each run)
      metadata: { prompt: g.promptRef, our_trace_id: g.traceId ?? null, ...g.metadata },
    },
    { asType: "generation", startTime: start, parentSpanContext: { traceId, spanId: randomSpanId(), traceFlags: 1 } },
  );
  gen
    .update({
      output: g.output,
      usageDetails: {
        input: g.usage.inputTokens,
        output: g.usage.outputTokens,
        ...(g.usage.cachedTokens ? { input_cached: g.usage.cachedTokens } : {}),
      },
      costDetails: { total: g.costUsd },
      level: g.level,
      ...(g.statusMessage ? { statusMessage: g.statusMessage } : {}),
    })
    .end(end);
}

/** Langfuse tracer. Outside prod, missing keys → no-op with one warning; in prod they are required. */
export function langfuseTracer(): Tracer {
  if (!initLangfuse()) {
    if (env().APP_ENV === "prod") throw new Error("Langfuse keys are required in prod (every call must be traced)");
    logger.warn("Langfuse not configured — LLM generations will not be traced");
    return { generation() {} };
  }
  return {
    generation(g) {
      const p = recordGeneration(g).catch((err) =>
        logger.warn({ err: (err as Error).message }, "langfuse generation failed"),
      );
      pending.add(p);
      void p.finally(() => pending.delete(p));
    },
  };
}

/** Flush buffered spans (call before a serverless function returns, and at the end of scripts). */
export async function flushTraces(): Promise<void> {
  await Promise.all([...pending]);
  await processor?.forceFlush();
}
