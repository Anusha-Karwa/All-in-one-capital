/**
 * Evidence map (BUILD_SPEC §7.2, Lecture 4).
 *
 * One row per question the scorer needs. The model only EXTRACTS claims into these named
 * fields; CODE decides whether a field is sufficiently answered (`isSufficient`). The model's
 * self-reported confidence is never used to stop research.
 *
 * Human-readable twin: docs/EVIDENCE_MAP.md (keep in sync — a test checks every field is documented).
 */

export const EVIDENCE_FIELDS = [
  "company_exists_independently",
  "website_live",
  "product_description",
  "customer_type",
  "paying_customers_count",
  "revenue_or_mrr",
  "growth_trend",
  "repeat_or_retention",
  "cac",
  "gross_margin",
  "founder_backgrounds_verified",
  "founder_prior_work_evidence",
  "team_size",
  "funding_history",
  "competitors_named",
  "regulatory_exposure",
  "press_mentions",
  "portfolio_overlap_candidates",
] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

export type SourceType = "deck" | "form" | "web" | "search";

/** Minimal view of a `claims` row needed for sufficiency checks. */
export interface EvidenceClaim {
  field: EvidenceField;
  sourceType: SourceType;
  sourceRef: string;
  valueText?: string | null;
  valueNum?: number | null;
  /** For per-founder fields: the founder id (F-xxxx) the claim is about. */
  subjectId?: string | null;
  /** True when the source was written by the applicant (deck, form, their own website, their LinkedIn). */
  selfAuthored: boolean;
  isStale?: boolean;
}

export interface EvidenceContext {
  claims: EvidenceClaim[];
  founderIds: string[];
  /** Set by the portfolio conflict step once it has compared against the FULL portfolio list. */
  portfolioCheckRanOverFullList: boolean;
  /** Set once the research loop has run ≥1 search for this field (absence after searching is itself evidence). */
  searchedFields: ReadonlySet<EvidenceField>;
}

export type Criterion =
  | "sector_fit"
  | "stage_fit"
  | "founder_market_fit"
  | "founder_quality_evidence"
  | "owns_core_risk"
  | "path_to_market"
  | "unit_economics_fluency"
  | "capital_structure_fit"
  | "regulatory_dependency"
  | "defensibility"
  | "portfolio_conflict"
  | "integrity_consistency";

export interface EvidenceRow {
  field: EvidenceField;
  question: string;
  data: string;
  whereItLives: string;
  /** Human description of the code check below. */
  sufficientWhen: string;
  isSufficient: (ctx: EvidenceContext) => boolean;
  /** Max fetches the research loop may spend on this field (0 = never research on the web). */
  fetchLimit: number;
  ifUnanswered: string;
  /** Criteria whose score/confidence this field affects (used for gaps.cost_of_absence). */
  feeds: Criterion[];
  /** R1: a missing key number DRAGS the score (missing penalty) — it is never skipped. */
  isKeyNumber: boolean;
  shortCircuit: string | null;
}

// ─── helpers (pure)

const forField = (ctx: EvidenceContext, f: EvidenceField) => ctx.claims.filter((c) => c.field === f && !c.isStale);
const hasAny = (ctx: EvidenceContext, f: EvidenceField) => forField(ctx, f).length > 0;
const hasNumber = (ctx: EvidenceContext, f: EvidenceField) =>
  forField(ctx, f).some((c) => typeof c.valueNum === "number" && Number.isFinite(c.valueNum));
const hasIndependent = (ctx: EvidenceContext, f: EvidenceField) => forField(ctx, f).some((c) => !c.selfAuthored);
const everyFounder = (ctx: EvidenceContext, f: EvidenceField, pred: (c: EvidenceClaim) => boolean) =>
  ctx.founderIds.length > 0 &&
  ctx.founderIds.every((fid) => forField(ctx, f).some((c) => c.subjectId === fid && pred(c)));

// ─── the map

export const EVIDENCE_MAP: readonly EvidenceRow[] = [
  {
    field: "company_exists_independently",
    question: "Does the company exist outside its own deck?",
    data: "Any page not written by the applicant naming the company (registry, press, customer, accelerator)",
    whereItLives: "Search grounding, MCA lookup (if provider key), press, accelerator pages",
    sufficientWhen: "≥1 non-self-authored claim",
    isSufficient: (c) => hasIndependent(c, "company_exists_independently"),
    fetchLimit: 2,
    ifUnanswered: "Gap: existence unverified → integrity_consistency confidence capped at low",
    feeds: ["integrity_consistency"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "website_live",
    question: "Is the stated website live and about this company?",
    data: "HTTP 200 + page text mentioning the company (name-collision guard passes)",
    whereItLives: "fetch_page(website)",
    sufficientWhen: "≥1 web claim for this field",
    isSufficient: (c) => forField(c, "website_live").some((x) => x.sourceType === "web"),
    fetchLimit: 1,
    ifUnanswered: "Gap: website not reachable (reason recorded) → no penalty on its own; noted in integrity",
    feeds: ["integrity_consistency"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "product_description",
    question: "What does it actually do, for whom?",
    data: "One-paragraph product description",
    whereItLives: "Deck, form, website",
    sufficientWhen: "≥1 claim from any source",
    isSufficient: (c) => hasAny(c, "product_description"),
    fetchLimit: 1,
    ifUnanswered: "Gap: product unclear → sector_fit and path_to_market marked not_enough_evidence",
    feeds: ["sector_fit", "path_to_market"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "customer_type",
    question: "Who pays — consumer, SMB, enterprise?",
    data: "Customer segment + buyer",
    whereItLives: "Deck, form",
    sufficientWhen: "≥1 claim from any source",
    isSufficient: (c) => hasAny(c, "customer_type"),
    fetchLimit: 0,
    ifUnanswered: "Gap → sector classification confidence low",
    feeds: ["sector_fit", "path_to_market"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "paying_customers_count",
    question: "How many customers pay today (not registered, not on trial)?",
    data: "Count of paying customers, with definition",
    whereItLives: "Deck, form (cross-checked by consistency checker)",
    sufficientWhen: "≥1 numeric claim",
    isSufficient: (c) => hasNumber(c, "paying_customers_count"),
    fetchLimit: 0,
    ifUnanswered: "Missing key number → missing penalty on path_to_market (R1)",
    feeds: ["path_to_market"],
    isKeyNumber: true,
    shortCircuit: null,
  },
  {
    field: "revenue_or_mrr",
    question: "What is revenue / MRR, and is it gross or net?",
    data: "Revenue or MRR figure + period + gross/net definition",
    whereItLives: "Deck, form",
    sufficientWhen: "≥1 numeric claim",
    isSufficient: (c) => hasNumber(c, "revenue_or_mrr"),
    fetchLimit: 0,
    ifUnanswered: "Missing key number → missing penalty on path_to_market + unit_economics_fluency (R1)",
    feeds: ["path_to_market", "unit_economics_fluency"],
    isKeyNumber: true,
    shortCircuit: null,
  },
  {
    field: "growth_trend",
    question: "Is it growing, and how fast?",
    data: "≥2 dated data points of the same metric",
    whereItLives: "Deck charts, form",
    sufficientWhen: "≥2 numeric claims",
    isSufficient: (c) => forField(c, "growth_trend").filter((x) => typeof x.valueNum === "number").length >= 2,
    fetchLimit: 0,
    ifUnanswered: "Gap → growth claims treated as unverified; must not raise score",
    feeds: ["path_to_market"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "repeat_or_retention",
    question: "Do customers come back (cohort repeat / 30-90 day retention / logo churn)?",
    data: "Repeat or retention % with window",
    whereItLives: "Deck, form",
    sufficientWhen: "≥1 numeric claim",
    isSufficient: (c) => hasNumber(c, "repeat_or_retention"),
    fetchLimit: 0,
    ifUnanswered: "Missing key number → missing penalty on unit_economics_fluency (R1, R9; Petalry)",
    feeds: ["unit_economics_fluency", "defensibility"],
    isKeyNumber: true,
    shortCircuit: null,
  },
  {
    field: "cac",
    question: "What does it cost to acquire a (paying) customer, by channel?",
    data: "CAC figure, ideally per channel, with sample size",
    whereItLives: "Deck, form",
    sufficientWhen: "≥1 numeric claim",
    isSufficient: (c) => hasNumber(c, "cac"),
    fetchLimit: 0,
    ifUnanswered: "Missing key number → missing penalty on unit_economics_fluency (R1)",
    feeds: ["unit_economics_fluency"],
    isKeyNumber: true,
    shortCircuit: null,
  },
  {
    field: "gross_margin",
    question: "What is gross margin?",
    data: "Gross margin %",
    whereItLives: "Deck, form",
    sufficientWhen: "≥1 numeric claim",
    isSufficient: (c) => hasNumber(c, "gross_margin"),
    fetchLimit: 0,
    ifUnanswered: "Gap → unit_economics_fluency capped (consumer brands: key number per R9)",
    feeds: ["unit_economics_fluency"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "founder_backgrounds_verified",
    question: "Are the founders' stated backgrounds confirmed by someone other than the founder?",
    data: "Employer / role / dates from an independent page",
    whereItLives:
      "Company site /about, press, conference talks, GitHub, ICAI/academic pages. NOT LinkedIn (never scraped).",
    sufficientWhen: "Every founder has ≥1 non-self-authored claim",
    isSufficient: (c) => everyFounder(c, "founder_backgrounds_verified", (x) => !x.selfAuthored),
    fetchLimit: 2, // per founder
    ifUnanswered: "Mark 'self-reported only' → founder_quality_evidence confidence capped at low",
    feeds: ["founder_quality_evidence", "founder_market_fit", "integrity_consistency"],
    isKeyNumber: false, // unverified → confidence cap, not score cap (see DECISIONS D-004)
    shortCircuit: null,
  },
  {
    field: "founder_prior_work_evidence",
    question: "What has each founder actually built or done (evidence, not pedigree — R2)?",
    data: "Shipped products, prior companies, field groundwork, publications",
    whereItLives: "Deck, form, independent web pages",
    sufficientWhen: "Every founder has ≥1 claim",
    isSufficient: (c) => everyFounder(c, "founder_prior_work_evidence", () => true),
    fetchLimit: 2,
    ifUnanswered: "Missing key item ('team background', §6.5) → missing penalty on founder_quality_evidence",
    feeds: ["founder_quality_evidence", "founder_market_fit"],
    isKeyNumber: true,
    shortCircuit: null,
  },
  {
    field: "team_size",
    question: "How big is the team, and who is in-house vs outsourced?",
    data: "Headcount with in-house/contract split",
    whereItLives: "Deck, form",
    sufficientWhen: "≥1 numeric claim",
    isSufficient: (c) => hasNumber(c, "team_size"),
    fetchLimit: 0,
    ifUnanswered: "Gap → noted in founder_quality_evidence",
    feeds: ["founder_quality_evidence"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "funding_history",
    question: "What have they raised before, and what are they raising now (amount, valuation)?",
    data: "Prior rounds + current ask + valuation",
    whereItLives: "Form, deck, press",
    sufficientWhen: "≥1 claim from any source",
    isSufficient: (c) => hasAny(c, "funding_history"),
    fetchLimit: 1,
    ifUnanswered: "Gap → stage_fit and capital_structure_fit confidence low",
    feeds: ["stage_fit", "capital_structure_fit"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "competitors_named",
    question: "Who else does this, per an independent search (tests 'we have no competitors')?",
    data: "Named competitors from web search",
    whereItLives: "Search grounding, deck competition slide",
    sufficientWhen: "≥1 claim from web/search",
    isSufficient: (c) =>
      forField(c, "competitors_named").some((x) => x.sourceType === "web" || x.sourceType === "search"),
    fetchLimit: 2,
    ifUnanswered: "Gap: competition only self-reported → defensibility confidence low",
    feeds: ["defensibility"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "regulatory_exposure",
    question: "Does the business depend on a licence, a partner's licence, or a rule change (R8)?",
    data: "Licences held/needed, partner dependency, pending regulation",
    whereItLives: "Deck, form, regulator/press pages",
    sufficientWhen: "≥1 claim from any source",
    isSufficient: (c) => hasAny(c, "regulatory_exposure"),
    fetchLimit: 1,
    ifUnanswered: "Gap → regulatory_dependency not_enough_evidence (question for the call)",
    feeds: ["regulatory_dependency", "owns_core_risk"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "press_mentions",
    question: "Has anyone independent written about it?",
    data: "Press / blog / award mentions",
    whereItLives: "Search grounding",
    sufficientWhen: "≥1 web/search claim, OR a search was run and found nothing (absence is recorded as a fact)",
    isSufficient: (c) =>
      forField(c, "press_mentions").some((x) => x.sourceType === "web" || x.sourceType === "search") ||
      c.searchedFields.has("press_mentions"),
    fetchLimit: 1,
    ifUnanswered: "Gap → no effect on score; noted under integrity",
    feeds: ["integrity_consistency"],
    isKeyNumber: false,
    shortCircuit: null,
  },
  {
    field: "portfolio_overlap_candidates",
    question: "Does it overlap any company in the FULL portfolio list (R5)?",
    data: "Keyword + vector similarity vs every portfolio_companies row, LLM judge on candidates",
    whereItLives: "DB (portfolio_companies)",
    sufficientWhen: "The overlap check ran over the full portfolio list",
    isSufficient: (c) => c.portfolioCheckRanOverFullList,
    fetchLimit: 0,
    ifUnanswered: "Never left unanswered — pipeline fails to needs_attention if the check cannot run",
    feeds: ["portfolio_conflict"],
    isKeyNumber: false,
    shortCircuit: "Overlap ≥ threshold → HOLD flag (scoring continues; recommendation forced to hold)",
  },
];

export const EVIDENCE_ROW: Readonly<Record<EvidenceField, EvidenceRow>> = Object.fromEntries(
  EVIDENCE_MAP.map((r) => [r.field, r]),
) as Record<EvidenceField, EvidenceRow>;

/** Code decides "enough". Returns the fields still missing, in evidence-map order. */
export function codeCheckMissing(ctx: EvidenceContext): EvidenceField[] {
  return EVIDENCE_MAP.filter((r) => !r.isSufficient(ctx)).map((r) => r.field);
}

/** Missing fields the research loop could still try on the web (fetchLimit > 0). */
export function researchableMissing(ctx: EvidenceContext): EvidenceField[] {
  return codeCheckMissing(ctx).filter((f) => EVIDENCE_ROW[f].fetchLimit > 0);
}

/** Key numbers (R1) that are missing → must produce a missing penalty, never be skipped. */
export function missingKeyNumbers(ctx: EvidenceContext): EvidenceField[] {
  return codeCheckMissing(ctx).filter((f) => EVIDENCE_ROW[f].isKeyNumber);
}
