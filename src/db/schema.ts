/**
 * All In Capital — Inbound Screening Agent: data model (BUILD_SPEC §5).
 *
 * PII rule: founder personal data lives ONLY in `founders_pii` (encrypted columns).
 * Everything sent to an LLM references `founder_id` (F-xxxx) and `application_id`.
 *
 * Money: numeric(14,4) INR + USD. Times: timestamptz, stored UTC, displayed Asia/Kolkata.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

/** Embedding dimension. Gemini embedding output is requested at this size (see docs/DECISIONS.md). */
export const EMBEDDING_DIM = 768;

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 14, scale: 4 });
const embedding = () => vector("embedding", { dimensions: EMBEDDING_DIM });

// ─────────────────────────────────────────── enums

export const APPLICATION_STATUSES = [
  "received",
  "queued",
  "parsing",
  "researching",
  "scoring",
  "scored",
  "needs_attention",
  "in_review",
  "approved",
  "rejected",
  "on_hold",
  "outreach_drafted",
  "outreach_sent",
  "awaiting_reply",
  "scheduling",
  "call_booked",
  "escalated",
  "closed",
] as const;
export const applicationStatus = pgEnum("application_status", APPLICATION_STATUSES);

/** Transient states watched by the stuck-job reconciler (>30 min → needs_attention: stuck_in_<state>). */
export const TRANSIENT_STATUSES = ["received", "queued", "parsing", "researching", "scoring"] as const;

export const applicationSource = pgEnum("application_source", ["form", "upload", "seed", "warm_intro"]);
export const documentKind = pgEnum("document_kind", ["deck", "form", "other"]);
export const claimSourceType = pgEnum("claim_source_type", ["deck", "form", "web", "search"]);
export const severity = pgEnum("severity", ["critical", "high", "low"]);
export const evalSeverity = pgEnum("eval_severity", ["critical", "high", "low"]);
export const fetchMethod = pgEnum("fetch_method", ["plain", "jina", "search_grounding"]);
export const fetchFailureReason = pgEnum("fetch_failure_reason", [
  "robots_disallowed",
  "blocked_bot",
  "rate_limited",
  "login_wall",
  "captcha",
  "not_found",
  "dns_fail",
  "timeout",
  "js_empty",
  "non_text",
  "geo_blocked",
  "wrong_entity",
]);
export const researchStopReason = pgEnum("research_stop_reason", ["sufficient", "cap_reached", "budget", "blocked"]);
export const recommendation = pgEnum("recommendation", ["take_call", "maybe", "pass"]);
export const confidence = pgEnum("confidence", ["low", "med", "high"]);
export const evidenceStatus = pgEnum("evidence_status", ["evidenced", "partial", "not_enough_evidence"]);
export const flagType = pgEnum("flag_type", [
  "portfolio_conflict",
  "stage_mismatch",
  "sector_outside",
  "contradiction",
  "regulatory_dependency",
  "capital_structure",
  "injection_attempt",
  "pii_in_text",
  "budget_paused",
  "deck_arithmetic_error",
  "metric_definition",
  "stale_data",
]);
export const reviewDecision = pgEnum("review_decision", ["approve_call", "reject", "hold"]);
export const emailKind = pgEnum("email_kind", ["invite", "follow_up", "reschedule", "pass_note", "confirmation"]);
export const meetingStatus = pgEnum("meeting_status", [
  "unscheduled",
  "pending_confirmation",
  "confirmed",
  "escalated",
  "cancelled",
]);
export const userRole = pgEnum("user_role", ["partner", "associate", "admin"]);
export const portfolioAddedBy = pgEnum("portfolio_added_by", ["research", "manual", "notes"]);
export const llmCallStatus = pgEnum("llm_call_status", ["ok", "error", "cache_hit", "blocked_budget", "blocked_pii"]);

// ─────────────────────────────────────────── intake

export const applications = pgTable(
  "applications",
  {
    id: id(),
    publicRef: varchar("public_ref", { length: 32 }).notNull().unique(), // APP-2026-0001
    companyName: text("company_name").notNull(),
    website: text("website"),
    sectorClaimed: text("sector_claimed"),
    sectorClassified: text("sector_classified"), // system's own classification, shown next to the claim
    stageClaimed: text("stage_claimed"),
    location: text("location"),
    incorporated: text("incorporated"),
    amountRaising: text("amount_raising"),
    valuation: text("valuation"),
    source: applicationSource("source").notNull(),
    sourceDetail: text("source_detail"), // e.g. "warm intro via a Fund I founder"
    status: applicationStatus("status").notNull().default("received"),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    thesisVersionId: uuid("thesis_version_id"),
    promptBundleVersion: text("prompt_bundle_version"),
    priority: integer("priority").notNull().default(0),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    isTest: boolean("is_test").notNull().default(false),
    langfuseTraceId: text("langfuse_trace_id"),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("applications_status_idx").on(t.status),
    index("applications_created_at_idx").on(t.createdAt),
    uniqueIndex("applications_idempotency_key_uq").on(t.idempotencyKey),
  ],
);

export const founders = pgTable(
  "founders",
  {
    id: varchar("id", { length: 16 }).primaryKey(), // F-1042
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    role: text("role"),
    backgroundSummary: text("background_summary"), // non-PII, e.g. "CA, 4 yrs GST practice"
    linkedinUrlHash: varchar("linkedin_url_hash", { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index("founders_application_id_idx").on(t.applicationId)],
);

/** Encrypted (AES-256-GCM, PII_ENCRYPTION_KEY). Never joined into LLM prompts. */
export const foundersPii = pgTable("founders_pii", {
  founderId: varchar("founder_id", { length: 16 })
    .primaryKey()
    .references(() => founders.id, { onDelete: "cascade" }),
  fullNameEnc: text("full_name_enc"),
  emailEnc: text("email_enc"),
  phoneEnc: text("phone_enc"),
  linkedinUrlEnc: text("linkedin_url_enc"),
  firstNameEnc: text("first_name_enc"), // injected into emails AFTER generation, via template variable
  retentionUntil: timestamp("retention_until", { withTimezone: true }),
  createdAt: createdAt(),
});

export const documents = pgTable(
  "documents",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: documentKind("kind").notNull(),
    filename: text("filename"),
    blobUrl: text("blob_url"),
    storageKey: text("storage_key"),
    pageCount: integer("page_count"),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("documents_application_id_idx").on(t.applicationId)],
);

export const documentPages = pgTable(
  "document_pages",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNo: integer("page_no").notNull(),
    text: text("text").notNull(),
  },
  (t) => [uniqueIndex("document_pages_doc_page_uq").on(t.documentId, t.pageNo)],
);

// ─────────────────────────────────────────── evidence

export const claims = pgTable(
  "claims",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    field: text("field").notNull(), // EvidenceField (src/research/evidenceMap.ts)
    valueText: text("value_text"),
    valueNum: real("value_num"),
    unit: text("unit"),
    sourceType: claimSourceType("source_type").notNull(),
    sourceRef: text("source_ref").notNull(), // "deck p.4" | "form: Team size" | URL
    quote: varchar("quote", { length: 300 }),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    confidence: confidence("confidence"),
    isStale: boolean("is_stale").notNull().default(false),
    extractedByPromptVersion: text("extracted_by_prompt_version"),
    createdAt: createdAt(),
  },
  (t) => [index("claims_application_id_idx").on(t.applicationId), index("claims_field_idx").on(t.field)],
);

export const contradictions = pgTable(
  "contradictions",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    claimAId: uuid("claim_a_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    claimBId: uuid("claim_b_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    severity: severity("severity").notNull(),
    kind: text("kind"), // value_mismatch | metric_definition | unquantified | credential
    explanation: text("explanation").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("contradictions_application_id_idx").on(t.applicationId)],
);

export const webCache = pgTable(
  "web_cache",
  {
    id: id(),
    url: text("url").notNull(),
    urlHash: varchar("url_hash", { length: 64 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    httpStatus: integer("http_status"),
    fetchMethod: fetchMethod("fetch_method"),
    robotsAllowed: boolean("robots_allowed"),
    cleanedText: text("cleaned_text"),
    tokenCount: integer("token_count"),
    failureReason: fetchFailureReason("failure_reason"),
  },
  (t) => [uniqueIndex("web_cache_url_hash_uq").on(t.urlHash)],
);

export const researchRuns = pgTable(
  "research_runs",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    iteration: integer("iteration").notNull(),
    action: text("action").notNull(), // search_web | fetch_page | stop
    target: text("target"),
    intendedField: text("intended_field"),
    outcome: text("outcome"),
    failureReason: fetchFailureReason("failure_reason"),
    fieldsFilled: text("fields_filled")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    fieldsMissing: text("fields_missing")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    stopReason: researchStopReason("stop_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("research_runs_application_id_idx").on(t.applicationId)],
);

export const gaps = pgTable(
  "gaps",
  {
    id: id(),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }), // null = fund-level gap
    field: text("field").notNull(), // evidence field or criterion key
    whatWeTried: jsonb("what_we_tried").$type<string[]>().notNull().default([]),
    whyMissing: text("why_missing").notNull(),
    costOfAbsence: text("cost_of_absence").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("gaps_application_id_idx").on(t.applicationId)],
);

// ─────────────────────────────────────────── fund knowledge

export const fundProfile = pgTable("fund_profile", {
  id: id(),
  version: integer("version").notNull(),
  factKey: text("fact_key").notNull(), // stated_thesis | sectors | stage | cheque_size | ownership_target | geography | anti_thesis | ...
  value: text("value"), // null → see gaps (fund-level)
  sourceUrl: text("source_url"),
  quote: text("quote"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
  accepted: boolean("accepted").notNull().default(false),
  createdAt: createdAt(),
});

export const portfolioCompanies = pgTable("portfolio_companies", {
  id: id(),
  name: text("name").notNull(),
  aliases: text("aliases")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  oneLiner: text("one_liner"),
  sector: text("sector"),
  keywords: text("keywords")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  embedding: embedding(),
  sourceUrl: text("source_url"), // or "seed:notes#meeting-4"
  addedBy: portfolioAddedBy("added_by").notNull(),
  createdAt: createdAt(),
});

export const thesisVersions = pgTable("thesis_versions", {
  id: id(),
  label: text("label").notNull(), // stated_public_v1 | revealed_from_memos_v1
  kind: text("kind").notNull(), // stated | revealed
  criteria: jsonb("criteria"),
  weights: jsonb("weights").$type<Record<string, number>>(),
  activePrimary: boolean("active_primary").notNull().default(false),
  accepted: boolean("accepted").notNull().default(false),
  createdBy: text("created_by"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const criteria = pgTable(
  "criteria",
  {
    id: id(),
    thesisVersionId: uuid("thesis_version_id")
      .notNull()
      .references(() => thesisVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    definition: text("definition").notNull(),
    whatGoodLooksLike: text("what_good_looks_like"),
    whatBadLooksLike: text("what_bad_looks_like"),
    anchors: jsonb("anchors").$type<Record<"0" | "3" | "5" | "7" | "10", string>>(),
    weight: real("weight").notNull().default(1),
    isGate: boolean("is_gate").notNull().default(false),
    sourceCitations: jsonb("source_citations").$type<string[]>().notNull().default([]),
  },
  (t) => [uniqueIndex("criteria_version_key_uq").on(t.thesisVersionId, t.key)],
);

export const thesisRules = pgTable("thesis_rules", {
  id: varchar("id", { length: 32 }).primaryKey(), // R1..R14, L-xxx for learned
  text: text("text").notNull(),
  source: text("source").notNull(), // "notes:meeting-3" | "memo:4" | "correction:<id>"
  quote: text("quote"),
  sectors: text("sectors")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`), // empty = global
  stages: text("stages")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const memos = pgTable("memos", {
  id: integer("id").primaryKey(), // memo #1..#12
  company: text("company").notNull(),
  sector: text("sector").notNull(),
  stage: text("stage"),
  source: text("source"),
  decision: text("decision").notNull(), // INVESTED | PASSED
  sourceRef: text("source_ref").notNull(), // seed file + page
  createdAt: createdAt(),
});

export const memoSections = pgTable(
  "memo_sections",
  {
    id: varchar("id", { length: 32 }).primaryKey(), // M3.founder
    memoId: integer("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    section: text("section").notNull(), // what_it_does | founder_assessment | risks | why_decision
    text: text("text").notNull(),
    pageRef: text("page_ref"),
    embedding: embedding(),
  },
  (t) => [index("memo_sections_memo_id_idx").on(t.memoId)],
);

export const partnerNotes = pgTable("partner_notes", {
  id: integer("id").primaryKey(), // meeting #1..#5
  title: text("title"),
  meetingDate: text("meeting_date"),
  sourceRef: text("source_ref").notNull(),
  createdAt: createdAt(),
});

export const noteChunks = pgTable("note_chunks", {
  id: varchar("id", { length: 32 }).primaryKey(), // N4.c2
  noteId: integer("note_id")
    .notNull()
    .references(() => partnerNotes.id, { onDelete: "cascade" }),
  chunkNo: integer("chunk_no").notNull(),
  text: text("text").notNull(),
  embedding: embedding(),
});

// ─────────────────────────────────────────── scoring

export const scorecards = pgTable(
  "scorecards",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    thesisVersionId: uuid("thesis_version_id"),
    promptVersion: text("prompt_version"),
    model: text("model"),
    overallScore: real("overall_score"), // computed in code, never by the model
    scoreStated: real("score_stated"),
    scoreRevealed: real("score_revealed"),
    recommendation: recommendation("recommendation"), // always labelled a recommendation in UI
    confidence: confidence("confidence"),
    primaryThesisUsed: text("primary_thesis_used"),
    primaryThesisWhy: text("primary_thesis_why"),
    caseFor: text("case_for"),
    caseAgainst: text("case_against"),
    questionsForCall: jsonb("questions_for_call").$type<string[]>().notNull().default([]),
    correctionsApplied: jsonb("corrections_applied").$type<string[]>().notNull().default([]),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("scorecards_application_id_idx").on(t.applicationId)],
);

export const criterionScores = pgTable(
  "criterion_scores",
  {
    id: id(),
    scorecardId: uuid("scorecard_id")
      .notNull()
      .references(() => scorecards.id, { onDelete: "cascade" }),
    thesisKind: text("thesis_kind").notNull(), // stated | revealed
    criterionKey: text("criterion_key").notNull(),
    score: real("score"),
    evidenceStatus: evidenceStatus("evidence_status").notNull(),
    rationale: text("rationale"),
    citations: jsonb("citations").$type<string[]>().notNull().default([]),
    missingPenaltyApplied: boolean("missing_penalty_applied").notNull().default(false),
    similarPastDeals: jsonb("similar_past_deals").$type<string[]>().notNull().default([]),
  },
  (t) => [index("criterion_scores_scorecard_id_idx").on(t.scorecardId)],
);

export const flags = pgTable(
  "flags",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: flagType("type").notNull(),
    severity: severity("severity").notNull(),
    detail: text("detail").notNull(),
    citations: jsonb("citations").$type<string[]>().notNull().default([]),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("flags_application_id_idx").on(t.applicationId)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    reviewer: text("reviewer").notNull(),
    decision: reviewDecision("decision").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("reviews_application_id_idx").on(t.applicationId)],
);

export const corrections = pgTable("corrections", {
  id: id(),
  scorecardId: uuid("scorecard_id")
    .notNull()
    .references(() => scorecards.id, { onDelete: "cascade" }),
  criterionKey: text("criterion_key"), // null = overall
  oldScore: real("old_score"),
  newScore: real("new_score").notNull(),
  reasonLine: varchar("reason_line", { length: 200 }).notNull(),
  corrector: text("corrector").notNull(),
  sector: text("sector"),
  stage: text("stage"),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  embedding: embedding(),
  supersededBy: uuid("superseded_by"),
  active: boolean("active").notNull().default(true),
  reuseCount: integer("reuse_count").notNull().default(0),
  createdAt: createdAt(),
});

// ─────────────────────────────────────────── outreach

export const emailDrafts = pgTable(
  "email_drafts",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: emailKind("kind").notNull(),
    aiDraft: text("ai_draft").notNull(),
    finalText: text("final_text"),
    editDiff: text("edit_diff"),
    editMeaningful: boolean("edit_meaningful"),
    editJudgeReason: text("edit_judge_reason"),
    draftRationale: text("draft_rationale"), // hidden: which email corrections were applied and why
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    promptVersion: text("prompt_version"),
    createdAt: createdAt(),
  },
  (t) => [index("email_drafts_application_id_idx").on(t.applicationId)],
);

export const emailCorrections = pgTable("email_corrections", {
  id: id(),
  emailDraftId: uuid("email_draft_id")
    .notNull()
    .references(() => emailDrafts.id, { onDelete: "cascade" }),
  kind: emailKind("kind").notNull(),
  summary: text("summary").notNull(),
  before: text("before"),
  after: text("after"),
  embedding: embedding(),
  createdAt: createdAt(),
});

export const conversations = pgTable("conversations", {
  id: id(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  langgraphThreadId: text("langgraph_thread_id").notNull(),
  state: jsonb("state"),
  suppressed: boolean("suppressed").notNull().default(false),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const meetings = pgTable("meetings", {
  id: id(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  start: timestamp("start", { withTimezone: true }).notNull(),
  end: timestamp("end", { withTimezone: true }).notNull(),
  attendees: text("attendees")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`), // role labels, not emails
  calendarEventIds: jsonb("calendar_event_ids").$type<Record<string, string>>(),
  meetLink: text("meet_link"),
  status: meetingStatus("status").notNull().default("unscheduled"),
  createdAt: createdAt(),
});

// ─────────────────────────────────────────── ops: cost, prompts, settings

export const llmCalls = pgTable(
  "llm_calls",
  {
    id: id(),
    traceId: text("trace_id"),
    applicationId: uuid("application_id"),
    step: text("step").notNull(),
    promptName: text("prompt_name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    costInr: money("cost_inr").notNull().default("0"),
    // 8 dp: a single embedding call can cost ~$0.00002, which 4 dp would round to zero (DECISIONS D-012)
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    status: llmCallStatus("status").notNull(),
    errorType: text("error_type"),
    retryCount: integer("retry_count").notNull().default(0),
    portkeyRequestId: text("portkey_request_id"),
    cacheKey: varchar("cache_key", { length: 64 }),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("llm_calls_application_id_idx").on(t.applicationId),
    index("llm_calls_created_at_idx").on(t.createdAt),
    index("llm_calls_cache_key_idx").on(t.cacheKey),
  ],
);

/** Response cache for the AI wrapper: identical (prompt@version, model, normalized input) → reuse, cost 0. */
export const llmResponseCache = pgTable("llm_response_cache", {
  cacheKey: varchar("cache_key", { length: 64 }).primaryKey(),
  output: jsonb("output").notNull(),
  createdAt: createdAt(),
});

export const modelPrices = pgTable("model_prices", {
  id: serial("id").primaryKey(),
  model: text("model").notNull(),
  inputPer1mUsd: money("input_per_1m_usd").notNull(),
  outputPer1mUsd: money("output_per_1m_usd").notNull(),
  cachedInputPer1mUsd: money("cached_input_per_1m_usd"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
});

/** Single-row settings table (id = 1). Runtime-editable; env provides first-boot defaults. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  dailyLimitInr: money("daily_limit_inr").notNull().default("500"),
  paused: boolean("paused").notNull().default(false),
  pauseReason: text("pause_reason"),
  alert80SentOn: text("alert_80_sent_on"), // yyyy-mm-dd IST, so the 80% alert fires once per day
  usdInrRate: money("usd_inr_rate").notNull().default("84"),
  modelsPerStep: jsonb("models_per_step").$type<Record<string, string>>().notNull().default({}),
  scoringPerMinute: integer("scoring_per_minute").notNull().default(5),
  thresholds: jsonb("thresholds")
    .$type<{ takeCall: number; maybe: number }>()
    .notNull()
    .default({ takeCall: 7, maybe: 5 }),
  missingPenaltyCap: real("missing_penalty_cap").notNull().default(4),
  testMode: boolean("test_mode").notNull().default(true),
  riyaHourlyCostInr: money("riya_hourly_cost_inr"),
  calendarWindows: jsonb("calendar_windows")
    .$type<{ days: number[]; startHour: number; endHour: number; slotMinutes: number }>()
    .notNull()
    .default({ days: [2, 4], startHour: 14, endHour: 18, slotMinutes: 30 }),
  updatedAt: updatedAt(),
});

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: id(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    sha: varchar("sha", { length: 64 }).notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("prompt_versions_name_version_uq").on(t.name, t.version)],
);

export const evalRuns = pgTable("eval_runs", {
  id: id(),
  suite: text("suite").notNull(),
  gitSha: text("git_sha"),
  judgeModel: text("judge_model"),
  judgeSameFamily: boolean("judge_same_family"),
  summary: jsonb("summary"),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evalResults = pgTable(
  "eval_results",
  {
    id: id(),
    evalRunId: uuid("eval_run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    suite: text("suite").notNull(),
    caseId: text("case_id").notNull(),
    severity: evalSeverity("severity").notNull(),
    hard: boolean("hard").notNull(),
    passed: boolean("passed").notNull(),
    actual: jsonb("actual"),
    expected: jsonb("expected"),
    judgeReasoning: text("judge_reasoning"),
    humanVerdict: boolean("human_verdict"), // blind audit (/evals/audit)
    traceId: text("trace_id"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("eval_results_run_idx").on(t.evalRunId)],
);

export const users = pgTable("users", {
  email: text("email").primaryKey(),
  role: userRole("role").notNull(),
  googleRefreshTokenEnc: text("google_refresh_token_enc"),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actor: text("actor").notNull(),
    action: text("action").notNull(), // approve | send | correct | change_thesis | unpause | ...
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_at_idx").on(t.createdAt)],
);
