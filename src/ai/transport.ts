import { Portkey } from "portkey-ai";
import { env, MissingEnvError } from "@/env";
import type { ChatResult, EmbedResult, Transport } from "./types";

/**
 * Portkey transport — every model call goes through a Portkey gateway (§9.1, Case 04 Task 3).
 *
 * Two modes (DECISIONS D-037):
 *  - self-hosted: Portkey's open-source gateway deployed in our Vercel team (`gateway/`), reached at
 *    PORTKEY_GATEWAY_URL with a shared secret; the Gemini key travels per request. Used because Portkey's
 *    hosted sign-ups are closed.
 *  - hosted: app.portkey.ai with PORTKEY_API_KEY + PORTKEY_VIRTUAL_KEY_GEMINI (switch by setting those).
 * Both: retry 4× with exponential backoff on 429/5xx, done by the gateway (not by us).
 */
export const DEFAULT_PORTKEY_CONFIG = {
  retry: { attempts: 4, on_status_codes: [429, 500, 502, 503, 504] },
  request_timeout: 90_000,
} as const;

export type GatewayMode = "self_hosted" | "hosted";

export function gatewayMode(e = env()): GatewayMode | null {
  if (e.PORTKEY_API_KEY && e.PORTKEY_VIRTUAL_KEY_GEMINI) return "hosted";
  if (e.PORTKEY_GATEWAY_URL && e.PORTKEY_GATEWAY_SECRET && e.GEMINI_API_KEY) return "self_hosted";
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

export function portkeyTransport(): Transport {
  const e = env();
  const mode = gatewayMode(e);
  if (!mode)
    throw new MissingEnvError([
      "PORTKEY_GATEWAY_URL + PORTKEY_GATEWAY_SECRET + GEMINI_API_KEY (self-hosted) or PORTKEY_API_KEY + PORTKEY_VIRTUAL_KEY_GEMINI (hosted)",
    ]);

  const client = (traceID?: string, metadata?: Record<string, string>) =>
    mode === "hosted"
      ? new Portkey({
          apiKey: e.PORTKEY_API_KEY,
          virtualKey: e.PORTKEY_VIRTUAL_KEY_GEMINI,
          config: e.PORTKEY_CONFIG_ID ?? DEFAULT_PORTKEY_CONFIG,
          traceID,
          metadata,
        })
      : new Portkey({
          baseURL: `${e.PORTKEY_GATEWAY_URL!.replace(/\/+$/, "")}/v1`,
          provider: "google",
          Authorization: `Bearer ${e.GEMINI_API_KEY}`,
          config: DEFAULT_PORTKEY_CONFIG,
          traceID,
          metadata,
        });
  const opts = mode === "self_hosted" ? { extraHeaders: { "x-gateway-secret": e.PORTKEY_GATEWAY_SECRET! } } : undefined;
  const provider = mode === "self_hosted" ? "portkey-oss:google" : "portkey:google";
  const headersOf = (res: unknown) => (res as { getHeaders?: () => HeaderMap }).getHeaders?.();

  return {
    async chat(req, meta): Promise<ChatResult> {
      const pk = client(meta.traceId, { step: meta.step, prompt: meta.promptRef, app: meta.applicationId ?? "" });
      const res = await pk.chat.completions.create(
        {
          model: req.model,
          messages: req.messages,
          temperature: req.temperature ?? 0,
          ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
        },
        undefined,
        opts,
      );
      const h = headersOf(res);
      return {
        text: String(res.choices?.[0]?.message?.content ?? ""),
        usage: billableUsage(res.usage as ChatUsage | undefined),
        provider,
        servedModel: String(res.model ?? req.model),
        portkeyRequestId: portkeyHeader(h, "request-id") ?? (portkeyHeader(h, "trace-id") || undefined),
        retryCount: Number(portkeyHeader(h, "retry-attempt-count") ?? 0),
      };
    },
    async embed(req, meta): Promise<EmbedResult> {
      const pk = client(meta.traceId, { step: meta.step, prompt: meta.promptRef, app: meta.applicationId ?? "" });
      // One text per request: the gateway's Google mapping merges an input array into ONE embedding.
      const results = await mapLimit(req.input, 4, async (text) => {
        const res = await pk.embeddings.create(
          { model: req.model, input: text, dimensions: req.dimensions } as never,
          undefined,
          opts as never,
        );
        const r = res as unknown as {
          data: { embedding: number[] }[];
          model?: string;
          usage?: { prompt_tokens?: number };
        };
        if (r.data?.length !== 1) throw new Error(`expected 1 embedding, got ${r.data?.length ?? 0}`);
        const reported = r.usage?.prompt_tokens ?? -1;
        return {
          vector: truncateNormalize(r.data[0].embedding, req.dimensions),
          tokens: reported > 0 ? reported : estimateTokens(text),
          model: r.model,
          h: headersOf(res),
        };
      });
      return {
        vectors: results.map((x) => x.vector),
        usage: { inputTokens: results.reduce((s, x) => s + x.tokens, 0), outputTokens: 0, cachedTokens: 0 },
        provider,
        servedModel: String(results[0]?.model ?? req.model),
        portkeyRequestId: portkeyHeader(results[0]?.h, "request-id"),
        retryCount: results.reduce((s, x) => s + Number(portkeyHeader(x.h, "retry-attempt-count") ?? 0), 0),
      };
    },
  };
}
