# Progress

## Phase 0 — Scaffold + pre-build decisions ✅ (code) · ⏳ waiting on Neon URLs

**Done**
- `docs/PREBUILD.md` — Nine Checks + 5 pre-build decisions; `docs/EVIDENCE_MAP.md` (paper) + `src/research/evidenceMap.ts` (code, tested).
- Next.js 15 (App Router, TS strict) + Tailwind v4, ESLint (+prettier), Prettier, Vitest.
- `src/env.ts` Zod env validation; `.env.example` with every variable; dev/test never resolve to the prod DB.
- Drizzle schema for the full §5 data model (37 tables, enums, indexes); first migration `drizzle/0000_init.sql` with `CREATE EXTENSION vector`; verified on in-memory Postgres + pgvector (`npm run db:verify`).
- `/api/health` — DB probe (connect + pgvector present); other integrations report `not_configured` until their phase.
- `CLAUDE.md`, `docs/` skeleton, `seed/` folders + README.

**Stubbed / not yet done**
- shadcn/ui components are added per page as needed from Phase 1 (only `cn()` util + deps so far).
- Migrations not yet applied to Neon (needs `DATABASE_URL_DEV` / `DATABASE_URL`).
- `/seed` is empty: the case PDFs have not been provided yet.

**Next (Phase 1)**: PDF extraction of memos/notes, thesis rules R1–R14, embeddings, `/memos` + `/notes`, AI wrapper via Portkey + Langfuse.

**Open questions**: see the Phase 0 summary in chat.
