import type { ModelPrice, Usage } from "./cost";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TransportMeta {
  traceId?: string;
  step: string;
  promptRef: string; // name@vN
  applicationId?: string | null;
}

export interface ChatResult {
  text: string;
  usage: Usage;
  provider: string;
  /** Model the provider actually served (may differ from requested if a Portkey fallback fired). */
  servedModel: string;
  portkeyRequestId?: string;
  retryCount: number;
}

export interface EmbedResult {
  vectors: number[][];
  usage: Usage;
  provider: string;
  servedModel: string;
  portkeyRequestId?: string;
  retryCount: number;
}

/** The ONLY thing that talks to a model provider. Default: Portkey (src/ai/transport.ts). */
export interface Transport {
  chat(
    req: { model: string; messages: ChatMessage[]; json: boolean; temperature?: number },
    meta: TransportMeta,
  ): Promise<ChatResult>;
  embed(req: { model: string; input: string[]; dimensions: number }, meta: TransportMeta): Promise<EmbedResult>;
}

export interface LlmCallRecord {
  traceId?: string | null;
  applicationId?: string | null;
  step: string;
  promptName: string;
  promptVersion: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
  costInr: number;
  costUsd: number;
  status: "ok" | "error" | "cache_hit" | "blocked_budget" | "blocked_pii";
  errorType?: string | null;
  retryCount: number;
  portkeyRequestId?: string | null;
  cacheKey?: string | null;
  isTest: boolean;
}

export interface BudgetState {
  paused: boolean;
  pauseReason: string | null;
  dailyLimitInr: number;
  spentTodayInr: number;
  usdInr: number;
}

/** Persistence the wrapper needs. Default: Postgres via Drizzle (src/ai/store.ts). */
export interface AiStore {
  budget(): Promise<BudgetState>;
  pause(reason: string): Promise<void>;
  price(model: string): Promise<ModelPrice | null>;
  cacheGet(key: string): Promise<unknown | undefined>;
  cacheSet(key: string, output: unknown): Promise<void>;
  recordCall(r: LlmCallRecord): Promise<void>;
}

export interface GenerationTrace {
  traceId?: string;
  name: string; // step
  promptRef: string; // name@vN
  model: string;
  input: unknown;
  output: unknown;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  level: "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
  metadata?: Record<string, unknown>;
}

/** Observability sink. Default: Langfuse (src/ai/tracer.ts); a no-op when keys are absent outside prod. */
export interface Tracer {
  generation(g: GenerationTrace): void;
}

export type BudgetEvent = { kind: "threshold_80" | "limit_reached"; spentTodayInr: number; dailyLimitInr: number };

export interface AiDeps {
  transport: Transport;
  store: AiStore;
  tracer: Tracer;
  now?: () => number;
  /** Override the prompts directory (tests). */
  promptsDir?: string;
  /** Hook for alerts (wired to email/Slack in Phase 10). */
  onBudgetEvent?: (e: BudgetEvent) => void | Promise<void>;
}
