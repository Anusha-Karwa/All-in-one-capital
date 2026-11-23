# Data sources — order of preference (BUILD_SPEC §7.1)

1. **Applicant's own documents** — deck and form. Self-authored: useful, never independent.
2. **Official / structured sources** — e.g. MCA company-registration lookups via a provider, *only if a provider key is configured*. Otherwise → named gap "registration unverified".
3. **Search grounding** — Gemini Google Search grounding (Tavily as optional second provider). Discovery only; results carry URL + snippet.
4. **Public web scraping** — only if `robots.txt` allows; per-host delay ≥1 s + jitter, 1 concurrent request per host, 10 s timeout, cache 7 days.

**Never:** log-in walls (LinkedIn, paywalls), CAPTCHAs, session-based scraping. LinkedIn URLs are stored (hashed in `founders`, encrypted in `founders_pii`) and treated as *self-reported, unverified*.

Applicant websites in the seed set are `*.example` placeholders → lookups will fail by design; each failure becomes a gap with a reason (`dns_fail`, …) and its cost.

Every fact about All In Capital itself that isn't in `/seed` is researched at runtime and stored with `source_url` + `retrieved_at`; anything not found is a fund-level gap.
