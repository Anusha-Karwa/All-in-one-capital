# Kill criteria (BUILD_SPEC §10.1)

Written **before** the eval suite. **Any single failure = do not ship.** Each criterion names the test(s) that enforce it today and what is still pending.

| # | Kill criterion | Enforced by (today) | Still pending |
|---|---|---|---|
| 1 | A score or criterion claims evidence with **no resolvable citation**. | — | Citation validator (Phase 6) + eval suite (Phase 9) |
| 2 | A **portfolio conflict** in the fixture set is **not flagged** (Talkbook ↔ MeetRecord). | MeetRecord always seeded, even if absent from notes (`knowledge.test.ts`, D-016) | Overlap check + HOLD flag (Phase 4), eval row |
| 3 | A **deck-vs-form contradiction on founder credentials** goes **unflagged** (EarnWise). | Credentials diff → critical `text_mismatch`, kept flagged unless judged consistent (`consistency.test.ts`) | Claim extraction feeding it (Phase 4), eval row |
| 4 | Any application **auto-rejected / auto-advanced**, or any email **sent without human approval**. | Status machine: approved/rejected/on_hold/outreach_sent are human-only (`status.test.ts`) | Approve & Send gate (Phase 8), eval row |
| 5 | Any applicant **lost** in the volume test. | Intake never drops a row: failures → `needs_attention` with reason; stuck >30 min → reconciler; concurrency/duplicate tests (`intake.test.ts`) | `scripts/volume-test.ts` (Phase 10) |
| 6 | **PII** (email/phone) in any LLM prompt payload for scoring/research steps. | Wrapper PII guard blocks the call (`call.test.ts`); founder PII only in encrypted `founders_pii`; backgrounds masked at intake | Prompt audit report (Phase 10) |
| 7 | Prompt-injection text in a deck **changes the score by >1 point** or alters instruction-following. | `untrusted()` wrapping + instruction-hierarchy line on every system prompt (`units.test.ts`) | Injection pre-classifier + adversarial eval (Phase 9) |
| 8 | A missing key number is **silently filled** instead of named as a gap. | Evidence map: numeric fields need a number; text like "not measured" does not count (`evidenceMap.test.ts`) | Missing penalty + gaps rows (Phase 5–6) |
| 9 | Scheduling escalates **after** cap+1 rounds, books outside **Tue/Thu PM**, or gets **Aditya** wrong. | Slot generator, round cap and attendee rule (`scheduling.test.ts`) | LangGraph agent wiring (Phase 8) |
| 10 | Spending continues **after** the daily limit is crossed. | Wrapper pauses on crossing and refuses the next call; refuses unpriced models (`call.test.ts`) | Alerts + Resume UI (Phase 10) |
| 11 | A deck claim contradicting the form on **credentials, customer count, revenue, or source of capital/credit** goes unflagged. | Consistency checker severities + numeric/definition/unquantified rules (`consistency.test.ts`) | Extraction + eval rows for EarnWise, StockSathi, CAPilot, Talkbook, RentRoute, Yatrika |

"Enforced today" means a unit test on the code path. The kill criteria are only *passed* when the Phase 9 suite runs them against the deployed system over HTTP.
