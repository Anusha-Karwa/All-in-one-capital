# AI call layer (BUILD_SPEC §9.1)

Every model call goes through `src/ai/call.ts` → `callModel()` (chat/JSON) or `embed()`. Provider SDKs can't be imported elsewhere (ESLint, D-019).

## What happens on each call
1. Render `src/prompts/<name>.v<N>.md` (latest unless pinned). Missing/unknown `{{vars}}` throw. The instruction-hierarchy line is appended to every system prompt.
2. **PII guard** (`src/ai/pii.ts`): email / Indian phone / Aadhaar / PAN in the outgoing text → call blocked, `llm_calls.status = blocked_pii`, trace shows `[blocked: PII]` (never the PII).
3. **Response cache**: sha256(prompt@version + model + whitespace-normalised input). Hit → `cache_hit`, ₹0.
4. **Kill switch**: `settings.paused` or today's (IST) spend ≥ `daily_limit_inr` → `BudgetPausedError`; reaching the limit sets `paused = true`. Only an admin "Resume" clears it (Phase 10).
5. **Price**: no `model_prices` row → `PriceMissingError` (D-013). Add prices with `npm run prices:set -- <model> <in$/1M> <out$/1M> [cached$/1M]` from the provider's pricing page.
6. **Portkey** (`src/ai/transport.ts`) with retry `{attempts: 4, on_status_codes: [429,500,502,503,504]}` (exponential backoff is Portkey's), 90 s timeout. If `PORTKEY_CONFIG_ID` is set, that saved config is used instead — it should contain the same retry block, plus optional fallback model and a budget limit (the second, independent brake, §9.6).
7. **Zod** validation; one repair retry with the validation errors.
8. **Ledger + trace**: `llm_calls` row (tokens, cached tokens, latency, cost ₹/$ via `model_prices` × `settings.usd_inr_rate`, Portkey request id, retry count) and a Langfuse generation named by step, tagged `prompt: name@vN`.
9. **Post-call**: crossing 80% of the limit fires a `threshold_80` event; crossing 100% pauses.

## Suggested Portkey config (create in the Portkey UI, put its id in `PORTKEY_CONFIG_ID`)
```json
{
  "retry": { "attempts": 4, "on_status_codes": [429, 500, 502, 503, 504] },
  "request_timeout": 90000,
  "strategy": { "mode": "fallback" },
  "targets": [
    { "virtual_key": "<gemini virtual key>" },
    { "virtual_key": "<gemini virtual key>", "override_params": { "model": "<fallback model id>" } }
  ]
}
```
Set a budget limit on the Gemini virtual key in Portkey as well.

## Known exception (Phase 5)
Gemini Google-Search grounding may not be available through Portkey's OpenAI-compatible route. If so, it will be called with `@google/genai` **inside `src/ai/`**, with manual backoff, still writing `llm_calls` + a Langfuse generation. This will be documented here when built.
