# Portkey gateway (open source, in-process)

Case 04 Task 3: "Route every model call through Portkey, with automatic retries switched on."
Portkey's hosted sign-ups were closed, so the screener runs **Portkey's open-source AI gateway**
(MIT, github.com/Portkey-AI/gateway, pinned **v1.15.2**) **inside the app**: `src/ai/portkeyInProcess.ts`
hands each request to the gateway's Hono app via `app.fetch()`. No separate service, no public endpoint.
See `docs/DECISIONS.md` D-037/D-042.

- `vendor.sh` downloads the pinned release into `gateway/vendor` (git-ignored). It runs in `vercel-build`;
  locally run `npm run gateway:vendor` once.
- Imported as `@portkey-gateway` (alias in `next.config.ts` and `vitest.config.mts`; type shim in
  `src/types/portkey-gateway.d.ts`) so TypeScript never type-checks Portkey's source with our strict settings.
- Every request is built by our transport: provider `google` only, no custom host, retry
  `{attempts: 4, on_status_codes: [429,500,502,503,504]}`.
- Hosted Portkey replaces this by setting `PORTKEY_API_KEY` + `PORTKEY_VIRTUAL_KEY_GEMINI`.

Gateway quirks handled by the transport: Google embeddings merge an input array into one vector and ignore
`dimensions` (we send one text per request and truncate + normalise to 768); reasoning tokens are reported outside
`completion_tokens` (we bill `total − prompt`).
