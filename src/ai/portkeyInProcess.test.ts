/**
 * Runs Portkey's real open-source gateway code (gateway/vendor) in-process with Google faked at the fetch layer.
 * Proves Case 04 Task 3 ("every model call through Portkey, automatic retries switched on") and the §8.4 retry rows.
 */
import { existsSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const VENDORED = existsSync("gateway/vendor/src/index.ts");
const realFetch = globalThis.fetch;
let googleCalls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
let script: (Response | (() => Response))[] = [];

const googleChat = (text: string) =>
  Response.json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 5, thoughtsTokenCount: 64, totalTokenCount: 77 },
    modelVersion: "gemini-3.7-flash",
  });

type TransportMod = typeof import("./transport");
type CallMod = typeof import("./call");
let transport: TransportMod;
let call: CallMod;

// Load Portkey's gateway source ONCE (cold transform is slow under a parallel test run), with the env it needs.
beforeAll(async () => {
  if (!VENDORED) return;
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  transport = await import("./transport");
  call = await import("./call");
  await import("@portkey-gateway");
}, 120_000);

beforeEach(() => {
  googleCalls = [];
  script = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
    googleCalls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const next = script.shift();
    if (!next) throw new Error("unexpected extra Google call");
    return typeof next === "function" ? next() : next;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe.skipIf(!VENDORED)("Portkey OSS gateway, in-process (run `npm run gateway:vendor` first)", () => {
  it("routes a chat call through the gateway to Google with the key, and bills reasoning tokens", async () => {
    script = [googleChat('{"ok":true}')];
    const { portkeyTransport } = transport;
    const r = await portkeyTransport().chat(
      { model: "gemini-3.7-flash", messages: [{ role: "user", content: "hi" }], json: true },
      { step: "t", promptRef: "t@v1" },
    );
    expect(r.text).toBe('{"ok":true}');
    expect(r.provider).toBe("portkey-oss:google");
    expect(r.usage).toEqual({ inputTokens: 8, outputTokens: 69, cachedTokens: 0 });
    expect(r.retryCount).toBe(0);
    expect(googleCalls).toHaveLength(1);
    expect(googleCalls[0].url).toContain("gemini-3.7-flash");
    expect(JSON.stringify(googleCalls[0])).toContain("test-gemini-key");
  });

  it("RETRIES: Google 503 once → Portkey retries automatically and succeeds (retry count recorded)", async () => {
    script = [
      () =>
        new Response(JSON.stringify({ error: { code: 503, message: "overloaded", status: "UNAVAILABLE" } }), {
          status: 503,
        }),
      googleChat("recovered"),
    ];
    const { portkeyTransport } = transport;
    const r = await portkeyTransport().chat(
      { model: "gemini-3.7-flash", messages: [{ role: "user", content: "hi" }], json: false },
      { step: "t", promptRef: "t@v1" },
    );
    expect(r.text).toBe("recovered");
    expect(googleCalls).toHaveLength(2);
    expect(r.retryCount).toBe(1);
  }, 20_000);

  it("does NOT retry a permanent error (400) and surfaces its status", async () => {
    script = [
      () =>
        new Response(JSON.stringify({ error: { code: 400, message: "bad request", status: "INVALID_ARGUMENT" } }), {
          status: 400,
        }),
    ];
    const { portkeyTransport } = transport;
    const { errorTypeOf } = call;
    const err = await portkeyTransport()
      .chat(
        { model: "gemini-3.7-flash", messages: [{ role: "user", content: "hi" }], json: false },
        { step: "t", promptRef: "t@v1" },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(errorTypeOf(err)).toBe("http_400");
    expect(googleCalls).toHaveLength(1);
  });

  it("embeddings: one Google call per text, vectors truncated + normalised to 768", async () => {
    const values = (seed: number) => Array.from({ length: 3072 }, (_, i) => Math.sin(i * seed + 1));
    script = [Response.json({ embedding: { values: values(1) } }), Response.json({ embedding: { values: values(2) } })];
    const { portkeyTransport } = transport;
    const r = await portkeyTransport().embed(
      { model: "gemini-embedding-001", input: ["a b c d", "e f g h"], dimensions: 768 },
      { step: "t", promptRef: "embed@v1" },
    );
    expect(googleCalls).toHaveLength(2);
    expect(r.vectors).toHaveLength(2);
    expect(r.vectors[0]).toHaveLength(768);
    expect(Math.hypot(...r.vectors[0])).toBeCloseTo(1, 8);
    expect(r.vectors[0][0]).not.toBe(r.vectors[1][0]);
  });
});
