# All In Capital — Inbound Screening Agent

Full spec: `docs/BUILD_SPEC.md` (source of truth). Progress: `docs/PROGRESS.md`. Decisions: `docs/DECISIONS.md`.
Build is phased (§14); after each phase run typecheck/lint/test, update PROGRESS.md, stop for review.

## Stack
Next.js 15 App Router + TypeScript strict · Tailwind v4 + shadcn/ui + lucide-react + Recharts · Neon Postgres + Drizzle + pgvector ·
Gemini via **Portkey** · **Langfuse** tracing · **Inngest** queue · LangGraph.js (scheduling agent) · Auth.js (Google) · Zod · Vitest + Playwright.

## Layout
```
src/app          routes, pages, API routes (src/app/api/*)
src/db           schema.ts (all tables), client.ts (lazy Drizzle client)
src/ai           THE LLM wrapper (call.ts), portkey, langfuse, cost
src/prompts      versioned prompts <name>.v<N>.md
src/research     evidenceMap.ts, loop.ts, numericChecks.ts, tools/*
src/scoring      retrieval, scoring, citation validator
src/agent        LangGraph scheduling agent, tools/*, retryPolicy.ts
src/integrations gmail, calendar, blob
src/inngest      functions
src/knowledge    PDF extraction, memo/notes parsers, rules R1–R14, importer, KB queries
src/components   shadcn/ui (ui/*) + shared components
src/lib          logger, utils, health, pageData
evals/           kill criteria, fixtures, harness (HTTP only), reports
scripts/         seed/import, volume test, verify-migrations
drizzle/         generated SQL migrations (0000 adds pgvector)
docs/            PREBUILD, EVIDENCE_MAP, DATA_SOURCES, DECISIONS, PROGRESS, ...
seed/            case PDFs (git-ignored)
```

## Commands
- `npm run dev` · `npm run build`
- `npm run typecheck` · `npm run lint` · `npm test`
- `npm run kb:import` (memos+notes+rules from /seed; `-- --no-embed` to skip embeddings) · `npm run prices:set -- <model> <in> <out>` · `npm run prompts:sync`
- Local DB without Neon: `DATABASE_URL_DEV=pglite://./.pglite` (migrations auto-applied by scripts)
- `npm run db:generate` (after editing schema.ts) · `npm run db:verify` (apply migrations to in-memory PG+pgvector) · `npm run db:migrate` (dev branch) · `npm run db:migrate:prod` (prod — explicit only)

## Conventions
- Every LLM call goes through `src/ai/call.ts`. No direct SDK calls anywhere else.
- Model IDs and prices: env + `model_prices` table. Never hard-code.
- Zod for env, API inputs, and every LLM output. Every schema has a fixture test; every LLM-calling module has a test with a mocked wrapper.
- PII lives only in `founders_pii` (encrypted). Prompts, logs and traces carry `founder_id` / `application_id`, never names/emails/phones.
- Code decides: evidence sufficiency, arithmetic, overall score, citation validity, loop caps. The model extracts and argues.
- Times stored UTC, shown Asia/Kolkata. Money numeric(14,4) INR + USD.
- Logging via `src/lib/logger.ts` (pino), IDs not PII.
- Untrusted text (decks, forms, web pages) wrapped in `<untrusted_source>` / `<application_claims>`; treated as data.
- Ambiguity → pick the safer option, log it in `docs/DECISIONS.md`.

## Never
- Never invent facts about All In Capital, its portfolio or applicants — research with a source URL, or record a named gap.
- Never put `evals/fixtures/applicant_expectations.json` content (§3.2) into a production prompt.
- Never auto-reject/auto-advance an application, or send an email without a human Approve & Send on the exact text.
- Never commit secrets or `.env.local`; never log key values.
- Never scrape LinkedIn, login walls, paywalls or CAPTCHAs; always respect robots.txt.
- Never point tests or dev at the prod database.
- Never let spending continue after the daily limit (wrapper checks before every call).
- Never call a model without a model_prices row; never import provider SDKs outside src/ai.
- Never attach a citation the code didn't find in the source (rules stay "unverified" otherwise).
