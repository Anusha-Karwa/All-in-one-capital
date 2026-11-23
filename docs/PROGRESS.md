# Progress

## Phase 0 — Scaffold ✅
Next.js 15 + TS strict + Tailwind v4 + shadcn/ui, Zod env, `.env.example`, full §5 schema (37 tables) + pgvector migration, `/api/health`, PREBUILD / EVIDENCE_MAP / DECISIONS / DATA_SOURCES docs, CLAUDE.md.
Still open: migrations not applied to Neon (no `DATABASE_URL[_DEV]` yet).

## Phase 1 — Knowledge base + AI layer 🟡 code done & tested · waiting on seed PDFs + keys

**Done**
- **AI wrapper** `src/ai/call.ts` (§9.1): prompt files with versions, PII guard, response cache, pause + daily-limit kill switch (pre-call and post-call), price-required, Portkey transport with retries, Zod + one repair retry, `llm_calls` ledger, Langfuse generations tagged `name@vN`, 80%/100% budget events. `embed()` through the same gate. Docs: `docs/AI_LAYER.md`.
- **Knowledge base**: PDF text per page (`unpdf`); memo parser (12 memos × 4 sections, verifies decision words, reports every missing memo/section); notes parser (meetings + ~150-word chunks); rules R1–R14 with code-found verbatim citations or "unverified"; MeetRecord seeded from Meeting 4; idempotent importer; separate embedding pass.
- **Pages**: `/memos`, `/notes` (rules with sources, keyword + semantic search with explicit fallback), nav + TEST MODE banner.
- **Scripts**: `kb:import`, `prices:set`, `prompts:sync`, `db:verify`.
- **Local mode**: `pglite://` DB URLs (D-011). Verified: synthetic PDFs → import → embed → `/memos`, `/notes` render from a production build.
- Tests: 69 passing (wrapper incl. kill-switch / PII / cache / repair / 429 / unpriced; parsers; importer idempotency; embedding pass).

**Not yet verified against reality (blocked)**
- Parsers are tuned on synthetic text — the real memo/notes PDFs may use different headings. `kb:import` prints every parse issue; I'll adjust the heading patterns on first real run.
- No live Portkey/Gemini/Langfuse call has been made yet (no keys). First live check: `npm run kb:import` embedding pass, then compare `llm_calls` cost with Portkey's log.
- `/api/health` reports Portkey/Langfuse as `configured_unprobed` once keys exist; a live probe comes with the first real call.

**Next (Phase 2)**: fund research job (needs grounding — Phase 1 keys), stated thesis v1, revealed thesis v1 from memos, `/thesis`, `/portfolio`.
