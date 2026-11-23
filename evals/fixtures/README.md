# Eval fixtures — NEVER used in production code or prompts

`applicant_expectations.json` encodes BUILD_SPEC §3.2: what a good screener must surface for each of the 10 seed
applicants. They are **expectations, not verdicts**, and count as ground truth only after Riya confirms or edits
each item (`riya_confirmed`). A test (`src/guards.test.ts`) fails if anything under `src/` imports this folder or if
any prompt file mentions an applicant.
