import { Portkey } from "portkey-ai";
import { env, MissingEnvError } from "@/env";
import { DEFAULT_PORTKEY_CONFIG } from "./portkeyConfig";
import { gatewayPost } from "./portkeyInProcess";
import type { ChatResult, EmbedResult, Transport } from "./types";

export { DEFAULT_PORTKEY_CONFIG };

/**
 * Portkey transport — every model call goes through a Portkey gateway (§9.1, Case 04 Task 3).
 *
 * Modes (DECISIONS D-037, D-042):
 *  - in_process (default): Portkey's open-source gateway (MIT, pinned v1.15.2, `gateway/`) runs inside this app;
 *    requests are handed to it in memory and it calls Gemini with retries. Used because hosted sign-ups are closed.
 *  - hosted: app.portkey.ai via the `portkey-ai` SDK, when PORTKEY_API_KEY + PORTKEY_VIRTUAL_KEY_GEMINI are set.
 * Both: retry 4× with exponential backoff on 429/5xx, performed by the gateway (not by us).
 */
export type GatewayMode = "in_process" | "hosted";

export function gatewayMode(e = env()): GatewayMode | null {
  if (e.PORTKEY_API_KEY && e.PORTKEY_VIRTUAL_KEY_GEMINI) return "hosted";
  if (e.GEMINI_API_KEY) return "in_process";
  return null;
}

type HeaderMap = Record<string, string> | null | undefined;
/** The SDK strips the `x-portkey-` prefix from response headers; raw HTTP keeps it. Accept both. */
export function portkeyHeader(h: HeaderMap, name: string): string | undefined {
  if (!h) return undefined;
  const k = name.toLowerCase();
  return h[k] ?? h[`x-portkey-${k}`] ?? h[name];
}

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/**
 * Billable usage. Gemini "thinking" models bill hidden reasoning tokens as output, but the gateway reports
 * them outside completion_tokens (e.g. completion 5, reasoning 64, total 77). Output = everything that isn't
 * prompt, so cost and the daily kill switch see the real spend.
 */
export function billableUsage(u: ChatUsage | undefined) {
  const prompt = Math.max(0, u?.prompt_tokens ?? 0);
  const completion = Math.max(0, u?.completion_tokens ?? 0);
  const reasoning = Math.max(0, u?.completion_tokens_details?.reasoning_tokens ?? 0);
  const total = u?.total_tokens ?? 0;
  const outputTokens = Math.max(
    completion + (total >= prompt + completion + reasoning ? reasoning : 0),
    total - prompt,
    completion,
  );
  return { inputTokens: prompt, outputTokens, cachedTokens: Math.max(0, u?.prompt_tokens_details?.cached_tokens ?? 0) };
}

/**
 * Matryoshka-trained embeddings (gemini-embedding-001) may be truncated to their first `dims` values and then
 * L2-normalised — Google's documented way to get smaller vectors. Needed because the gateway ignores `dimensions`.
 */
export function truncateNormalize(v: number[], dims: number): number[] {
  if (v.length < dims) throw new Error(`embedding has ${v.length} dims, need ${dims}`);
  const cut = v.slice(0, dims);
  const norm = Math.sqrt(cut.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? cut.map((x) => x / norm) : cut;
}

/** Rough token estimate (~4 chars/token) for embeddings, whose usage the gateway doesn't report. */
export const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  model?: string;
  usage?: ChatUsage;
}
interface EmbedResponse {
  data?: { embedding: number[] }[];
  model?: string;
  usage?: { prompt_tokens?: number };
}
type Sent<T> = { json: T; headers: HeaderMap };

export function portkeyTransport(): Transport {
  const e = env();
  const mode = gatewayMode(e);
  if (!mode)
    throw new MissingEnvError([
      "GEMINI_API_KEY (in-process Portkey gateway) or PORTKEY_API_KEY + PORTKEY_VIRTUAL_KEY_GEMINI (hosted)",
    ]);
  const provider = mode === "in_process" ? "portkey-oss:google" : "portkey:google";

  /** One request through whichever gateway is configured. */
  async function send<T>(
    kind: "chat" | "embed",
    body: Record<string, unknown>,
    traceId?: string,
    metadata?: Record<string, string>,
  ): Promise<Sent<T>> {
    if (mode === "in_process") {
      const r = await gatewayPost<T>({
        path: kind === "chat" ? "/v1/chat/completions" : "/v1/embeddings",
        body,
        geminiKey: e.GEMINI_API_KEY!,
        traceId,
        metadata,
      });
      return { json: r.json, headers: r.headers };
    }
    const pk = new Portkey({
      apiKey: e.PORTKEY_API_KEY,
      virtualKey: e.PORTKEY_VIRTUAL_KEY_GEMINI,
      config: e.PORTKEY_CONFIG_ID ?? DEFAULT_PORTKEY_CONFIG,
      traceID: traceId,
      metadata,
    });
    const res =
      kind === "chat" ? await pk.chat.completions.create(body as never) : await pk.embeddings.create(body as never);
    return { json: res as unknown as T, headers: (res as unknown as { getHeaders?: () => HeaderMap }).getHeaders?.() };
  }

  return {
    async chat(req, meta): Promise<ChatResult> {
      const { json, headers } = await send<ChatResponse>(
        "chat",
        {
          model: req.model,
          messages: req.messages,
          temperature: req.temperature ?? 0,
          ...(req.json ? { response_format: { type: "json_object" } } : {}),
        },
        meta.traceId,
        { step: meta.step, prompt: meta.promptRef, app: meta.applicationId ?? "" },
      );
      return {
        text: String(json.choices?.[0]?.message?.content ?? ""),
        usage: billableUsage(json.usage),
        provider,
        servedModel: String(json.model ?? req.model),
        portkeyRequestId: portkeyHeader(headers, "request-id") ?? (portkeyHeader(headers, "trace-id") || undefined),
        retryCount: Number(portkeyHeader(headers, "retry-attempt-count") ?? 0),
      };
    },
    async embed(req, meta): Promise<EmbedResult> {
      // One text per request: the gateway's Google mapping merges an input array into ONE embedding.
      const results = await mapLimit(req.input, 4, async (text) => {
        const { json, headers } = await send<EmbedResponse>(
          "embed",
          { model: req.model, input: text, dimensions: req.dimensions },
          meta.traceId,
          {
            step: meta.step,
            prompt: meta.promptRef,
          },
        );
        if (json.data?.length !== 1) throw new Error(`expected 1 embedding, got ${json.data?.length ?? 0}`);
        const reported = json.usage?.prompt_tokens ?? -1;
        return {
          vector: truncateNormalize(json.data[0].embedding, req.dimensions),
          tokens: reported > 0 ? reported : estimateTokens(text),
          model: json.model,
          headers,
        };
      });
      return {
        vectors: results.map((x) => x.vector),
        usage: { inputTokens: results.reduce((s, x) => s + x.tokens, 0), outputTokens: 0, cachedTokens: 0 },
        provider,
        servedModel: String(results[0]?.model ?? req.model),
        portkeyRequestId: portkeyHeader(results[0]?.headers, "request-id"),
        retryCount: results.reduce((s, x) => s + Number(portkeyHeader(x.headers, "retry-attempt-count") ?? 0), 0),
      };
    },
  };
}
