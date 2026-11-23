# Evidence map (BUILD_SPEC §7.2 · Lecture 4)

Written on paper first, then as code in `src/research/evidenceMap.ts` (a unit test fails if a field is missing here).
**The model extracts claims into these named fields. Code decides whether each field is answered** — never the model's self-confidence.

Definitions used below:
- *Self-authored* = deck, form, the applicant's own website, their LinkedIn. *Independent* = anything else.
- *Stale* = claim dated > 18 months ago; stale claims never count as sufficient.
- *Key number* (R1) = if missing, the scorer applies the **missing penalty** (default: criterion capped at 4/10, confidence downgraded) and writes `gaps.cost_of_absence`. It is never skipped.

| Field | Question | Data that answers it | Where it lives | Sufficient when (code check) | Fetch limit | If unanswered | Key? | Short-circuit? |
|---|---|---|---|---|---|---|---|---|
| `company_exists_independently` | Does the company exist outside its own deck? | Any non-applicant page naming it | Search grounding, MCA (if key), press, accelerators | ≥1 independent claim | 2 | Gap → integrity confidence capped low | – | no |
| `website_live` | Is the website live and about *this* company? | HTTP 200 + name-collision guard passes | `fetch_page(website)` | ≥1 web claim | 1 | Gap (reason recorded); no penalty alone | – | no |
| `product_description` | What does it do, for whom? | Product paragraph | Deck, form, site | ≥1 claim | 1 | sector_fit / path_to_market → not_enough_evidence | – | no |
| `customer_type` | Who pays? | Segment + buyer | Deck, form | ≥1 claim | 0 | Sector classification confidence low | – | no |
| `paying_customers_count` | How many *pay* today (not registered, not trial)? | Count + definition | Deck, form | ≥1 numeric claim | 0 | Missing penalty on path_to_market | **yes** | no |
| `revenue_or_mrr` | Revenue/MRR, gross or net? | Figure + period + definition | Deck, form | ≥1 numeric claim | 0 | Missing penalty on path_to_market + unit economics | **yes** | no |
| `growth_trend` | Growing, how fast? | ≥2 dated points of one metric | Deck charts, form | ≥2 numeric claims | 0 | Growth claims "unverified"; cannot raise score | – | no |
| `repeat_or_retention` | Do customers come back? | Repeat / 30–90d retention / churn | Deck, form | ≥1 numeric claim | 0 | Missing penalty on unit economics (R1, R9) | **yes** | no |
| `cac` | Cost to acquire a paying customer, by channel? | CAC + channel + sample size | Deck, form | ≥1 numeric claim | 0 | Missing penalty on unit economics | **yes** | no |
| `gross_margin` | Gross margin? | GM % | Deck, form | ≥1 numeric claim | 0 | Unit economics capped | – | no |
| `founder_backgrounds_verified` | Are stated backgrounds confirmed by someone else? | Employer/role/dates from an independent page | Company /about, press, talks, GitHub, ICAI/academic. **Never LinkedIn** | Every founder has ≥1 independent claim | 2 per founder | "Self-reported only" → founder_quality confidence capped **low** | – (confidence cap) | no |
| `founder_prior_work_evidence` | What has each founder actually built/done? (R2) | Shipped work, prior cos, groundwork | Deck, form, web | Every founder has ≥1 claim | 2 | Missing penalty on founder_quality ("team background") | **yes** | no |
| `team_size` | Team size, in-house vs outsourced? | Headcount + split | Deck, form | ≥1 numeric claim | 0 | Noted in founder_quality | – | no |
| `funding_history` | Prior rounds; current ask & valuation? | Rounds, ask, valuation | Form, deck, press | ≥1 claim | 1 | stage_fit / capital_structure confidence low | – | no |
| `competitors_named` | Who else does this (tests "no competitors")? | Named competitors from search | Search grounding (+ deck) | ≥1 web/search claim | 2 | Defensibility confidence low | – | no |
| `regulatory_exposure` | Licence / partner licence / rule-change dependency? (R8) | Licences, partners, pending rules | Deck, form, regulator/press | ≥1 claim | 1 | regulatory_dependency → not_enough_evidence + call question | – | no |
| `press_mentions` | Has anyone independent written about it? | Press/blog/awards | Search grounding | ≥1 web/search claim **or** a search ran and found nothing | 1 | No score effect; noted | – | no |
| `portfolio_overlap_candidates` | Overlap with ANY portfolio company? (R5) | Keyword + vector + LLM judge vs **full** list | DB | Check ran over the full list | 0 | Never unanswered — pipeline → needs_attention if it can't run | – | **yes → HOLD** (scoring continues, rec forced to hold) |

Loop stop conditions (code): `missing.isEmpty → sufficient`; `iteration ≥ MAX_RESEARCH_ITER (4)` or `fetches ≥ MAX_RESEARCH_FETCHES (8)` → `cap_reached`; daily budget hit → `budget`. Every field still missing at stop becomes a `gaps` row: what we tried, why missing, cost of absence.
