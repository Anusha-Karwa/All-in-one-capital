import { Portkey } from "portkey-ai";
import { env, requireEnv } from "@/env";
import type { ChatResult, EmbedResult, Transport } from "./types";

/**
 * Portkey transport — every model call goes through the Portkey gateway (§9.1).
 * Retries: 4 attempts with exponential backoff on 429/5xx, configured inline unless PORTKEY_CONFIG_ID
 * points at a saved config (which should carry the same retry block + optional fallback + budget).
 */
export const DEFAULT_PORTKEY_CONFIG = {
  retry: { attempts: 4, on_status_codes: [429, 500, 502, 503, 504] },
  request_timeout: 90_000,
} as const;

type Headers = Record<string, string> | null | undefined;
const hdr = (h: Headers, k: string) => (h ? (h[k] ?? h[k.toLowerCase()]) : undefined);

export function portkeyTransport(): Transport {
  const e = env();
  const { PORTKEY_API_KEY, PORTKEY_VIRTUAL_KEY_GEMINI } = requireEnv(["PORTKEY_API_KEY", "PORTKEY_VIRTUAL_KEY_GEMINI"]);
  const client = (traceID?: string, metadata?: Record<string, string>) =>
    new Portkey({
      apiKey: PORTKEY_API_KEY,
      virtualKey: PORTKEY_VIRTUAL_KEY_GEMINI,
      config: e.PORTKEY_CONFIG_ID ?? DEFAULT_PORTKEY_CONFIG,
      traceID,
      metadata,
    });

  return {
    async chat(req, meta): Promise<ChatResult> {
      const pk = client(meta.traceId, { step: meta.step, prompt: meta.promptRef, app: meta.applicationId ?? "" });
      const res = await pk.chat.completions.create({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0,
        ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
      });
      const headers = (res as unknown as { getHeaders?: () => Headers }).getHeaders?.();
      const u = res.usage as
        | { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
        | undefined;
      return {
        text: String(res.choices?.[0]?.message?.content ?? ""),
        usage: {
          inputTokens: u?.prompt_tokens ?? 0,
          outputTokens: u?.completion_tokens ?? 0,
          cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
        },
        provider: hdr(headers, "x-portkey-provider") ?? "google",
        servedModel: String(res.model ?? req.model),
        portkeyRequestId: hdr(headers, "x-portkey-request-id"),
        retryCount: Number(hdr(headers, "x-portkey-retry-attempt-count") ?? 0),
      };
    },
    async embed(req, meta): Promise<EmbedResult> {
      const pk = client(meta.traceId, { step: meta.step, prompt: meta.promptRef, app: meta.applicationId ?? "" });
      const res = await pk.embeddings.create({ model: req.model, input: req.input, dimensions: req.dimensions });
      const headers = (res as unknown as { getHeaders?: () => Headers }).getHeaders?.();
      const data = (res as unknown as { data: { embedding: number[]; index: number }[] }).data;
      const u = (res as unknown as { usage?: { prompt_tokens?: number } }).usage;
      return {
        vectors: [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding),
        usage: { inputTokens: u?.prompt_tokens ?? 0, outputTokens: 0, cachedTokens: 0 },
        provider: hdr(headers, "x-portkey-provider") ?? "google",
        servedModel: String((res as unknown as { model?: string }).model ?? req.model),
        portkeyRequestId: hdr(headers, "x-portkey-request-id"),
        retryCount: Number(hdr(headers, "x-portkey-retry-attempt-count") ?? 0),
      };
    },
  };
}
