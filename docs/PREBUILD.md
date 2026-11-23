# Pre-build decisions (Lecture 4)

Written before code. Sources: Case 03 / Case 04 briefs and partner notes as summarised in BUILD_SPEC §1, §3.1. Where a number isn't in the case, it is marked **TBD (Kushal)** rather than invented.

## The Nine Checks

### Kill switches — if any is "no", don't build
| Check | Answer | Evidence |
|---|---|---|
| **Problem real?** | Yes | Riya spends ~30 min per inbound application, >19 working days a quarter; Fund II announcement expected to bring ~100 applications in a single day. |
| **Workflow repeated?** | Yes | Every inbound application goes through the same read → assess against thesis → decide-on-call → email → schedule loop. |
| **Input available?** | Yes, partially | Deck + form for each application; 12 historical deal memos; 5 partner meetings. **Not** available: a published rubric, ownership target, exclusion list, verifiable founder backgrounds for `.example` applicants → these become named gaps, not invented inputs. |

### Sizing — is it worth it?
| Check | Answer |
|---|---|
| **Output valuable?** | A criterion-by-criterion read with sources and named gaps lets partners spend their time on the call, not the triage. Promising applicants get a call booked without email ping-pong. |
| **Impact measurable?** | Yes: minutes of Riya time per application (baseline 30), time-from-application-to-first-call, backtest agreement with the 12 past decisions, % of claims with resolvable citations, cost per application. |
| **ROI worth it?** | Target cost per application is a small fraction of 30 min of associate time. Exact ROI needs Riya's hourly cost (**TBD (Kushal)** — editable in `/settings`). The `/costs` page computes it live. |

### Boundary — where the system must stop
| Check | Answer |
|---|---|
| **Failure risk OK?** | Yes, because the system never decides: no auto-reject, no auto-advance (R12), no email sent without human approval. Worst realistic failure = a misleading score that a human reads; mitigated by citations, gaps, kill criteria and the trust contract. |
| **Judgment protected?** | Yes. Founder defensiveness (R4), deeptech second calls (R11), portfolio-conflict resolution (R5) and every advance/reject stay human. Scores are labelled *recommendations*. |
| **Owner clear?** | Riya owns daily review and email approval; Kushal owns the thesis, the trust-contract thresholds and the "Resume" after a spend pause; admin owns keys and deploy. |

## The 5 pre-build decisions

1. **Outcome definition.** For every application in a week's intake: a scorecard against the active thesis (stated **and** revealed), each criterion with evidence status and citations that resolve to a real source, named gaps with cost of absence, flags (conflict, contradiction, stage, sector, regulatory, capital structure), a recommendation (`take_call|maybe|pass`) with confidence, and questions for the call. For approved ones: an approved email sent and a call on the calendar.
2. **Workflow change for Riya.** Before: open deck, read, check form, Google the founders, write notes, decide, email, chase, schedule (~30 min + scheduling back-and-forth). After: open the Inbox sorted by recommendation → read the scorecard and flags (target ≤ 5 min, **TBD after pilot**) → approve/hold/reject with a note, or correct a score with one line of why → edit and approve the drafted email → the agent handles replies and booking, escalating to her on ambiguity or after 2 counter-proposals.
3. **Kill criterion.** See `evals/KILL_CRITERIA.md` (written in Phase 9 — the 11 kill criteria in BUILD_SPEC §10.1). Any single failure = do not ship. Headline: an uncited claim, a missed portfolio conflict, a missed credential contradiction, any auto-decision or unapproved email, a lost application, PII in a scoring prompt, or spend after the daily limit.
4. **Baseline.** 30 min of associate time per application; >19 working days per quarter on triage; scheduling effort not measured in the case (**gap** — we will log emails per booked call from day 1 so there is a baseline).
5. **90-day measurement plan.**
   - *Days 0–30 (shadow):* system scores every inbound; Riya still triages manually without looking first; compare. Track agreement, corrections per scorecard, citation-validation failures, cost/app, p95 latency.
   - *Days 31–60 (assisted):* Riya triages from the scorecard; log review minutes per application (timer in the UI), corrections with reasons, time-to-first-call, emails-per-booking, escalation rate.
   - *Days 61–90 (review):* re-run backtest + eval suite; report against the trust contract thresholds; Kushal decides go / extend shadow / stop.
   - Stop early if any kill criterion fires in production.

## Evidence map
Drafted before code: see `docs/EVIDENCE_MAP.md` (mirrored as code in `src/research/evidenceMap.ts`).
