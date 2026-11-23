/**
 * THE LLM wrapper (BUILD_SPEC §9.1). Every model call in the codebase goes through `callModel` or `embed`.
 *
 * Order of operations for each call:
 *   1. render the versioned prompt (src/prompts/<name>.v<N>.md)
 *   2. PII guard on the outgoing text → block + record `blocked_pii`
 *   3. response cache (sha256 of prompt@version + model + normalised input) → reuse, cost 0
 *   4. pause / daily-limit check → BudgetPausedError (caller moves the application to needs_attention: budget_paused)
 *   5. price lookup → PriceMissingError (a model we can't price can't be budgeted)
 *   6. call through Portkey (retries/backoff configured there)
 *   7. Zod validation, ONE repair retry
 *   8. llm_calls row (tokens, cost, latency, retries, Portkey request id) + Langfuse generation tagged name@version
 *   9. post-call budget accounting: 80% alert, 100% → pause
 */
import { createHash } from "node:crypto";
import type { ZodType } from "zod";
import { EMBEDDING_DIM } from "@/db/schema";
import { env } from "@/env";
import { computeCost } from "./cost";
import { BudgetPausedError, LlmOutputInvalidError, PiiBlockedError, PriceMissingError } from "./errors";
import { scanPii } from "./pii";
import { loadPrompt, renderPrompt } from "./prompts";
import type { AiDeps, ChatMessage, LlmCallRecord, BudgetState } from "./types";

export type ModelTier = "fast" | "smart";

export interface CallModelArgs<T> {
  step: string;
  promptName: string;
  promptVersion?: number;
  /** Explicit model id; otherwise resolved from env by tier. */
  model?: string;
  tier?: ModelTier;
  vars: Record<string, string>;
  schema: ZodType<T>;
  applicationId?: string | null;
  traceId?: string;
  isTest?: boolean;
  useCache?: boolean;
  temperature?: number;
}

export interface CallModelResult<T> {
  output: T;
  cacheHit: boolean;
  costInr: number;
  promptRef: string;
  model: string;
}

export function resolveModel(tier: ModelTier = "fast"): string {
  const e = env();
  const m = tier === "smart" ? e.GEMINI_MODEL_SMART : e.GEMINI_MODEL_FAST;
  if (!m) throw new Error(`GEMINI_MODEL_${tier === "smart" ? "SMART" : "FAST"} is not set`);
  return m;
}

export function cacheKeyFor(promptRef: string, model: string, input: unknown): string {
  return createHash("sha256")
    .update(`${promptRef}|${model}|${stableStringify(input)}`)
    .digest("hex");
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object")
    return JSON.stringify(typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export function parseJsonLoose(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(t);
}

const zeroUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

async function assertBudget(deps: AiDeps, base: Omit<LlmCallRecord, "status">): Promise<BudgetState> {
  const b = await deps.store.budget();
  if (b.paused) {
    await deps.store.recordCall({ ...base, status: "blocked_budget", errorType: "paused" });
    throw new BudgetPausedError(b.pauseReason ?? "paused");
  }
  if (b.spentTodayInr >= b.dailyLimitInr) {
    const reason = `daily limit ₹${b.dailyLimitInr} reached (spent ₹${b.spentTodayInr.toFixed(2)})`;
    await deps.store.pause(reason);
    await deps.onBudgetEvent?.({
      kind: "limit_reached",
      spentTodayInr: b.spentTodayInr,
      dailyLimitInr: b.dailyLimitInr,
    });
    await deps.store.recordCall({ ...base, status: "blocked_budget", errorType: "daily_limit" });
    throw new BudgetPausedError(reason);
  }
  return b;
}

async function afterSpend(deps: AiDeps, before: BudgetState, costInr: number) {
  const after = before.spentTodayInr + costInr;
  const limit = before.dailyLimitInr;
  if (before.spentTodayInr < 0.8 * limit && after >= 0.8 * limit && after < limit) {
    await deps.onBudgetEvent?.({ kind: "threshold_80", spentTodayInr: after, dailyLimitInr: limit });
  }
  if (after >= limit) {
    await deps.store.pause(`daily limit ₹${limit} reached (spent ₹${after.toFixed(2)})`);
    await deps.onBudgetEvent?.({ kind: "limit_reached", spentTodayInr: after, dailyLimitInr: limit });
  }
}

export async function callModel<T>(args: CallModelArgs<T>, deps: AiDeps): Promise<CallModelResult<T>> {
  const now = deps.now ?? Date.now;
  const prompt = loadPrompt(args.promptName, args.promptVersion, deps.promptsDir);
  const promptRef = `${prompt.name}@v${prompt.version}`;
  const { system, user } = renderPrompt(prompt, args.vars);
  const model = args.model ?? resolveModel(args.tier);
  const base: Omit<LlmCallRecord, "status"> = {
    traceId: args.traceId ?? null,
    applicationId: args.applicationId ?? null,
    step: args.step,
    promptName: prompt.name,
    promptVersion: `v${prompt.version}`,
    model,
    provider: "portkey",
    ...zeroUsage,
    latencyMs: 0,
    costInr: 0,
    costUsd: 0,
    retryCount: 0,
    isTest: args.isTest ?? false,
  };

  // 2. PII guard
  const pii = scanPii(`${system}\n${user}`);
  if (pii.length) {
    await deps.store.recordCall({ ...base, status: "blocked_pii", errorType: pii.join(",") });
    deps.tracer.generation({
      traceId: args.traceId,
      name: args.step,
      promptRef,
      model,
      input: "[blocked: PII]",
      output: null,
      usage: zeroUsage,
      costUsd: 0,
      latencyMs: 0,
      level: "ERROR",
      statusMessage: `pii_in_text: ${pii.join(",")}`,
    });
    throw new PiiBlockedError(pii);
  }

  // 3. response cache
  const cacheKey = cacheKeyFor(promptRef, model, { system, user });
  if (args.useCache !== false) {
    const hit = await deps.store.cacheGet(cacheKey);
    if (hit !== undefined) {
      const parsed = args.schema.safeParse(hit);
      if (parsed.success) {
        await deps.store.recordCall({ ...base, status: "cache_hit", cacheKey });
        deps.tracer.generation({
          traceId: args.traceId,
          name: args.step,
          promptRef,
          model,
          input: { system, user },
          output: hit,
          usage: zeroUsage,
          costUsd: 0,
          latencyMs: 0,
          level: "DEFAULT",
          metadata: { cache_hit: true },
        });
        return { output: parsed.data, cacheHit: true, costInr: 0, promptRef, model };
      }
    }
  }

  // 4–5. budget + price
  let budget = await assertBudget(deps, { ...base, cacheKey });
  const price = await deps.store.price(model);
  if (!price) {
    await deps.store.recordCall({ ...base, status: "error", errorType: "price_missing", cacheKey });
    throw new PriceMissingError(model);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let totalInr = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) budget = await assertBudget(deps, { ...base, cacheKey }); // repair is a new call: re-check
    const t0 = now();
    let res;
    try {
      res = await deps.transport.chat(
        { model, messages, json: true, temperature: args.temperature },
        { traceId: args.traceId, step: args.step, promptRef, applicationId: args.applicationId },
      );
    } catch (err) {
      const latencyMs = now() - t0;
      const errorType = errorTypeOf(err);
      await deps.store.recordCall({ ...base, status: "error", errorType, latencyMs, cacheKey });
      deps.tracer.generation({
        traceId: args.traceId,
        name: args.step,
        promptRef,
        model,
        input: { system, user },
        output: null,
        usage: zeroUsage,
        costUsd: 0,
        latencyMs,
        level: "ERROR",
        statusMessage: errorType,
      });
      throw err;
    }
    const latencyMs = now() - t0;
    const cost = computeCost(price, res.usage, budget.usdInr);
    totalInr += cost.inr;

    let output: unknown;
    let issues: string | null = null;
    try {
      const parsed = args.schema.safeParse(parseJsonLoose(res.text));
      if (parsed.success) output = parsed.data;
      else issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch (e) {
      issues = `not valid JSON (${(e as Error).message})`;
    }

    await deps.store.recordCall({
      ...base,
      step: attempt === 0 ? args.step : `${args.step}:repair`,
      model: res.servedModel || model,
      provider: res.provider,
      ...res.usage,
      latencyMs,
      costInr: cost.inr,
      costUsd: cost.usd,
      status: issues ? "error" : "ok",
      errorType: issues ? "schema_invalid" : null,
      retryCount: res.retryCount,
      portkeyRequestId: res.portkeyRequestId ?? null,
      cacheKey,
    });
    deps.tracer.generation({
      traceId: args.traceId,
      name: attempt === 0 ? args.step : `${args.step}:repair`,
      promptRef,
      model: res.servedModel || model,
      input: messages,
      output: res.text,
      usage: res.usage,
      costUsd: cost.usd,
      latencyMs,
      level: issues ? "WARNING" : "DEFAULT",
      statusMessage: issues ?? undefined,
      metadata: { portkey_request_id: res.portkeyRequestId, retries: res.retryCount },
    });
    await afterSpend(deps, budget, cost.inr);

    if (!issues) {
      await deps.store.cacheSet(cacheKey, output);
      return { output: output as T, cacheHit: false, costInr: totalInr, promptRef, model };
    }
    if (attempt === 1) throw new LlmOutputInvalidError(promptRef, issues);
    messages.push(
      { role: "assistant", content: res.text },
      {
        role: "user",
        content: `Your previous reply did not match the required JSON schema: ${issues}. Reply again with ONLY the corrected JSON object.`,
      },
    );
  }
  throw new Error("unreachable");
}

export interface EmbedArgs {
  step: string;
  texts: string[];
  model?: string;
  applicationId?: string | null;
  traceId?: string;
  isTest?: boolean;
}

/** Embeddings through the same gate: PII guard, budget, price, Portkey, llm_calls row, trace. */
export async function embed(args: EmbedArgs, deps: AiDeps): Promise<number[][]> {
  if (!args.texts.length) return [];
  const now = deps.now ?? Date.now;
  const model = args.model ?? env().GEMINI_EMBEDDING_MODEL;
  if (!model) throw new Error("GEMINI_EMBEDDING_MODEL is not set");
  const promptRef = "embed@v1";
  const base: Omit<LlmCallRecord, "status"> = {
    traceId: args.traceId ?? null,
    applicationId: args.applicationId ?? null,
    step: args.step,
    promptName: "embed",
    promptVersion: "v1",
    model,
    provider: "portkey",
    ...zeroUsage,
    latencyMs: 0,
    costInr: 0,
    costUsd: 0,
    retryCount: 0,
    isTest: args.isTest ?? false,
  };
  const pii = scanPii(args.texts.join("\n"));
  if (pii.length) {
    await deps.store.recordCall({ ...base, status: "blocked_pii", errorType: pii.join(",") });
    throw new PiiBlockedError(pii);
  }
  const budget = await assertBudget(deps, base);
  const price = await deps.store.price(model);
  if (!price) {
    await deps.store.recordCall({ ...base, status: "error", errorType: "price_missing" });
    throw new PriceMissingError(model);
  }
  const t0 = now();
  let res;
  try {
    res = await deps.transport.embed(
      { model, input: args.texts, dimensions: EMBEDDING_DIM },
      { traceId: args.traceId, step: args.step, promptRef, applicationId: args.applicationId },
    );
  } catch (err) {
    await deps.store.recordCall({ ...base, status: "error", errorType: errorTypeOf(err), latencyMs: now() - t0 });
    throw err;
  }
  const latencyMs = now() - t0;
  const cost = computeCost(price, res.usage, budget.usdInr);
  const bad = res.vectors.findIndex((v) => v.length !== EMBEDDING_DIM);
  const status = res.vectors.length !== args.texts.length || bad >= 0 ? "error" : "ok";
  await deps.store.recordCall({
    ...base,
    model: res.servedModel || model,
    provider: res.provider,
    ...res.usage,
    latencyMs,
    costInr: cost.inr,
    costUsd: cost.usd,
    status,
    errorType: status === "error" ? "embedding_shape" : null,
    retryCount: res.retryCount,
    portkeyRequestId: res.portkeyRequestId ?? null,
  });
  deps.tracer.generation({
    traceId: args.traceId,
    name: args.step,
    promptRef,
    model: res.servedModel || model,
    input: `${args.texts.length} texts`,
    output: `${res.vectors.length} vectors`,
    usage: res.usage,
    costUsd: cost.usd,
    latencyMs,
    level: status === "ok" ? "DEFAULT" : "ERROR",
  });
  await afterSpend(deps, budget, cost.inr);
  if (status === "error") {
    throw new Error(`Embedding shape mismatch: expected ${args.texts.length}×${EMBEDDING_DIM}`);
  }
  return res.vectors;
}

export function errorTypeOf(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 429) return "rate_limited";
  if (typeof status === "number" && status >= 500) return `upstream_${status}`;
  if (typeof status === "number") return `http_${status}`;
  return (err as Error)?.name ?? "unknown";
}
