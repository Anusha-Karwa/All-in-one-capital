# /seed — case inputs (PDFs are git-ignored; imported into the DB by scripts)

| Folder | Expected files | Used by |
|---|---|---|
| `case/` | `MESA_T2_Case 03_All in Capital.pdf` (Part A brief), `Case 04_All In Capital_Prototype to Production.pdf` (Part B brief) | Reference only |
| `memos/` | `MESA_T2_Case 03_Deal Memos.pdf` — 12 memos (6 invested, 6 passed) | Phase 1 → `memos`, `memo_sections` |
| `notes/` | `MESA_T2_Case 03_Partner Meeting Notes.pdf` — 5 partner meetings | Phase 1 → `partner_notes`, `note_chunks`, `thesis_rules`, MeetRecord in `portfolio_companies` |
| `applications/` | `<Company>_Deck.pdf` + `<Company>_Form.pdf` for StockSathi, CAPilot, CareCorner, EarnWise, GrainKind, Pumpwise, RentRoute, Settlr, Talkbook, Yatrika | Phase 3 bulk import |
| `lectures/` | L4 Scraping & Agent Loops, L6 Agents with Tools, L7 Evals, L8 Prototype→Production | Reference only |

The §3.2 verified findings are **eval fixtures only** (`evals/fixtures/applicant_expectations.json`) and must never appear in a production prompt.
