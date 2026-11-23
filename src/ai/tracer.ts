import { Langfuse } from "langfuse";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { maskPii } from "./pii";
import type { Tracer } from "./types";

let lf: Langfuse | undefined;

export function langfuseClient(): Langfuse | undefined {
  const e = env();
  if (!e.LANGFUSE_PUBLIC_KEY || !e.LANGFUSE_SECRET_KEY) return undefined;
  lf ??= new Langfuse({
    publicKey: e.LANGFUSE_PUBLIC_KEY,
    secretKey: e.LANGFUSE_SECRET_KEY,
    baseUrl: e.LANGFUSE_HOST,
    environment: e.APP_ENV,
    // "send less, log less": mask PII in anything that reaches Langfuse (§9.4)
    mask: ({ data }) => (typeof data === "string" ? maskPii(data) : JSON.parse(maskPii(JSON.stringify(data ?? null)))),
  });
  return lf;
}

/** Langfuse tracer. Outside prod, missing keys → no-op with one warning; in prod they are required. */
export function langfuseTracer(): Tracer {
  const client = langfuseClient();
  if (!client) {
    if (env().APP_ENV === "prod") throw new Error("Langfuse keys are required in prod (every call must be traced)");
    logger.warn("Langfuse not configured — LLM generations will not be traced");
    return { generation() {} };
  }
  return {
    generation(g) {
      const end = new Date();
      client.generation({
        traceId: g.traceId,
        name: g.name,
        model: g.model,
        input: g.input,
        output: g.output,
        startTime: new Date(end.getTime() - g.latencyMs),
        endTime: end,
        level: g.level,
        statusMessage: g.statusMessage,
        usageDetails: { input: g.usage.inputTokens, output: g.usage.outputTokens, cached: g.usage.cachedTokens },
        costDetails: { total: g.costUsd },
        metadata: { prompt: g.promptRef, ...g.metadata },
      });
    },
  };
}

export async function flushTraces() {
  await lf?.flushAsync();
}
