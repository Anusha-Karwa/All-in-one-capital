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

## Pulled forward (pure code, no keys) ✅
Built ahead of their phases because they need no API keys. Each is unit-tested; none has run on the real seed files yet.

| Area | Spec | What exists | Waiting on |
|---|---|---|---|
| Arithmetic checker | §7.5 | `src/research/numericChecks.ts`: Indian units, product/quotient/sum, formula vs cross-check thresholds; all §3.2 cases that have numbers (EarnWise, GrainKind, Settlr flagged; CAPilot, RentRoute, Yatrika, Talkbook-teams not) | 4 `it.todo` rows need deck figures (Pumpwise, StockSathi, CareCorner, Talkbook TAM) |
| Consistency checker | §3.2 | `src/research/consistency.ts`: value mismatch, gross/net & paying/registered/trial/target definitions, unquantified claims, text diffs (unjudged), severities per kill criterion 11 | Claim extraction (Phase 4, keys) to feed it; LLM judge for text diffs |
| PII | §5, §9.4 | AES-256-GCM `founders_pii`, keyed hashes, background masking + `pii_in_text` flag | `PII_ENCRYPTION_KEY` |
| Lifecycle | §4 | Transition whitelist, human-only statuses, stuck reconciler (`npm run reconcile`) | Inngest cron |
| Intake | §9.5, §11, §12 | Direct-to-Blob uploads via `POST /api/uploads` (D-033) + `POST /api/applications` (Zod, consent, honeypot, 5/min limit, PDF checks, idempotency incl. concurrent duplicates), `/apply`, `/apply/thanks`, `/privacy` (draft), Inbox table, document parsing, `npm run seed:apps` | Blob token, Inngest keys, seed PDFs. Vercel body limit fixed (D-033); a real-Blob round trip needs the token |
| Scheduling rules | §8.3, R11 | Tue/Thu 14–18 IST slots, 2-business-day / 14-day window, busy/rejected exclusion, Aditya iff deeptech, 48h follow-up/escalate, counter-proposal cap | LangGraph + Google (Phase 8) |
| Retry table | §8.4 | `src/agent/retryPolicy.ts` + `runWithPolicy` | Tools (Phase 8) |
| Evals | §10.1 | `evals/KILL_CRITERIA.md` (what enforces each today), `evals/fixtures/applicant_expectations.json` (§3.2, `riya_confirmed: false`), guard tests keeping fixtures out of `src/` and prompts | Phase 9 harness |
| Prod safety | — | Middleware blocks internal pages in prod until auth; health fails in prod without DB | Auth (Phase 8) |

Verified live (production build, local DB): submit → 201 `APP-2026-0001`; duplicate → same ref; missing consent → 400; honeypot → 202 dropped; 6th request/min → 429; inbox lists it; in `APP_ENV=prod` internal pages → 503 while `/apply` stays up.

Tests: 169 passing + 4 todo.

### Upload size fix (D-033) ✅
Browser uploads PDFs straight to private Vercel Blob; the API receives only references. Verified: unit tests (path rules, token constraints, Vercel `handleUpload` issuing/refusing tokens offline, server re-validation, cleanup, honeypot, rate limit, multipart fallback) and a headless-Chromium run of `/apply` against a production build (token 200 → Blob PUT with client token → 487-byte JSON submit → thanks page). Not yet verified: a round trip against a real Blob store (needs `BLOB_READ_WRITE_TOKEN`).
