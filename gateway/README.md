# Self-hosted Portkey gateway

Portkey's open-source AI gateway (MIT, pinned to **v1.15.2**) wrapped with a shared-secret guard and deployed as
a separate Vercel project (`allin-portkey-gateway`). The screener calls it through the `portkey-ai` SDK
(`src/ai/transport.ts`, self-hosted mode) with retry `{attempts: 4, on_status_codes: [429,500,502,503,504]}`.

Why: Portkey's hosted sign-ups were closed; Case 04 Task 3 requires every model call to go through Portkey with
automatic retries. Hosted Portkey can replace this at any time by setting `PORTKEY_API_KEY` +
`PORTKEY_VIRTUAL_KEY_GEMINI` on the screener (hosted mode wins). See `docs/DECISIONS.md` D-037.

| Env var (gateway project) | Purpose |
|---|---|
| `GATEWAY_SECRET` | required on every request as `x-gateway-secret` |

Guard rules (`src/index.ts`): secret required; only provider `google`; custom hosts refused (no SSRF).

Local run: `npm install && npm run vendor && GATEWAY_SECRET=dev npm run dev`.

Known gateway limitations handled in the screener's transport:
- Google embeddings: an input array is merged into ONE embedding and `dimensions` is ignored → the screener sends
  one text per request and truncates + re-normalises to 768 (Matryoshka).
- Gemini reasoning tokens are reported outside `completion_tokens` → the screener bills `total − prompt`.
