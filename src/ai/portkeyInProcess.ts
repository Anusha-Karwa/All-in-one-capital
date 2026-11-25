/**
 * Portkey's open-source gateway, running inside this app (DECISIONS D-042).
 * Requests are handed straight to the gateway's Hono app — no network hop to a gateway service, no public
 * endpoint. The gateway then calls Google with retries/backoff per the x-portkey-config header.
 */
import { DEFAULT_PORTKEY_CONFIG } from "./portkeyConfig";

type GatewayApp = { fetch(request: Request): Response | Promise<Response> };
let appPromise: Promise<GatewayApp> | undefined;

async function gateway(): Promise<GatewayApp> {
  appPromise ??= import("@portkey-gateway").then((m) => m.default as GatewayApp);
  return appPromise;
}

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface GatewayCall {
  path: "/v1/chat/completions" | "/v1/embeddings";
  body: unknown;
  geminiKey: string;
  traceId?: string;
  metadata?: Record<string, string>;
}

/** POST through the in-process gateway. Provider is always google; custom hosts are never set. */
export async function gatewayPost<T>({
  path,
  body,
  geminiKey,
  traceId,
  metadata,
}: GatewayCall): Promise<{ json: T; headers: Record<string, string> }> {
  const app = await gateway();
  const res = await app.fetch(
    new Request(`http://portkey-gateway.internal${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-portkey-provider": "google",
        authorization: `Bearer ${geminiKey}`,
        "x-portkey-config": JSON.stringify(DEFAULT_PORTKEY_CONFIG),
        ...(traceId ? { "x-portkey-trace-id": traceId } : {}),
        ...(metadata ? { "x-portkey-metadata": JSON.stringify(metadata) } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  const headers = Object.fromEntries(res.headers.entries());
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GatewayError(res.status || 502, `gateway returned non-JSON (${res.status})`);
  }
  if (!res.ok) {
    const err =
      (json as { error?: { message?: string }; message?: string })?.error?.message ??
      (json as { message?: string })?.message;
    throw new GatewayError(res.status, `gateway ${res.status}: ${String(err ?? "error").slice(0, 300)}`);
  }
  return { json: json as T, headers };
}
