# Decisions log

Ambiguities in BUILD_SPEC resolved toward the safer option. One line of rationale each.

| # | Date | Decision | Rationale |
|---|---|---|---|
| D-001 | 2026-11-23 | Env vars are optional at boot; each module calls `requireEnv([...])` at the point of use. | Lets each phase run with only its keys, while failing loudly and by name when a key is missing. |
| D-002 | 2026-11-23 | `APP_ENV` (dev/test/prod) selects the DB: only `prod` reads `DATABASE_URL`; everything else reads `DATABASE_URL_DEV`; drizzle-kit migrates dev unless `APP_ENV=prod`. | Tests and local work can never touch prod by accident (spec §2 environments). |
| D-003 | 2026-11-23 | Embeddings stored as `vector(768)`; Gemini embedding requested with output dimensionality 768. | Spec fixes 768; current Gemini embedding models default higher but support reduced dims. |
| D-004 | 2026-11-23 | `founder_backgrounds_verified` missing → **confidence** cap (low), not a score cap. The "team background" key number (score penalty) is `founder_prior_work_evidence`. | Spec's own row says "cap confidence = low"; most pre-seed founders can't be independently verified, and capping every founder score would flatten all scores. |
| D-005 | 2026-11-23 | Added flag types `deck_arithmetic_error`, `metric_definition`, `stale_data`, and fetch failure `wrong_entity` to the spec's enums. | Spec requires these behaviours (§3.2, §7.4, §7.5) but omits them from the enum lists. |
| D-006 | 2026-11-23 | `criterion_scores.thesis_kind` (stated/revealed) column — one scorecard holds both theses' criterion rows. | Spec §6.4 requires both scores per scorecard; avoids two scorecards per run. |
| D-007 | 2026-11-23 | Seed PDFs are git-ignored; they are imported into the DB by scripts. | Case material may be confidential; the DB is the source of truth after import. |
| D-008 | 2026-11-23 | Migrations are verified in CI/local against in-memory Postgres (PGlite + pgvector) via `npm run db:verify`. | Proves the SQL is valid without touching Neon. |
| D-009 | 2026-11-23 | Added `users` table (staff allow-list + encrypted Google refresh token) and `llm_response_cache`. | Needed by §2 auth/roles and §9.1 response cache; not listed in §5. |
| D-010 | 2026-11-23 | zod v4, vitest v5, Next 15.5, Tailwind v4 (current majors at scaffold time). | Latest stable at build time; spec fixes the libraries, not versions. |
