-- pgvector must exist before any vector(768) column is created.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."application_source" AS ENUM('form', 'upload', 'seed', 'warm_intro');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('received', 'queued', 'parsing', 'researching', 'scoring', 'scored', 'needs_attention', 'in_review', 'approved', 'rejected', 'on_hold', 'outreach_drafted', 'outreach_sent', 'awaiting_reply', 'scheduling', 'call_booked', 'escalated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."claim_source_type" AS ENUM('deck', 'form', 'web', 'search');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('low', 'med', 'high');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('deck', 'form', 'other');--> statement-breakpoint
CREATE TYPE "public"."email_kind" AS ENUM('invite', 'follow_up', 'reschedule', 'pass_note', 'confirmation');--> statement-breakpoint
CREATE TYPE "public"."eval_severity" AS ENUM('critical', 'high', 'low');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('evidenced', 'partial', 'not_enough_evidence');--> statement-breakpoint
CREATE TYPE "public"."fetch_failure_reason" AS ENUM('robots_disallowed', 'blocked_bot', 'rate_limited', 'login_wall', 'captcha', 'not_found', 'dns_fail', 'timeout', 'js_empty', 'non_text', 'geo_blocked', 'wrong_entity');--> statement-breakpoint
CREATE TYPE "public"."fetch_method" AS ENUM('plain', 'jina', 'search_grounding');--> statement-breakpoint
CREATE TYPE "public"."flag_type" AS ENUM('portfolio_conflict', 'stage_mismatch', 'sector_outside', 'contradiction', 'regulatory_dependency', 'capital_structure', 'injection_attempt', 'pii_in_text', 'budget_paused', 'deck_arithmetic_error', 'metric_definition', 'stale_data');--> statement-breakpoint
CREATE TYPE "public"."llm_call_status" AS ENUM('ok', 'error', 'cache_hit', 'blocked_budget', 'blocked_pii');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('unscheduled', 'pending_confirmation', 'confirmed', 'escalated', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."portfolio_added_by" AS ENUM('research', 'manual', 'notes');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('take_call', 'maybe', 'pass');--> statement-breakpoint
CREATE TYPE "public"."research_stop_reason" AS ENUM('sufficient', 'cap_reached', 'budget', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approve_call', 'reject', 'hold');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'low');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('partner', 'associate', 'admin');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_ref" varchar(32) NOT NULL,
	"company_name" text NOT NULL,
	"website" text,
	"sector_claimed" text,
	"sector_classified" text,
	"stage_claimed" text,
	"location" text,
	"incorporated" text,
	"amount_raising" text,
	"valuation" text,
	"source" "application_source" NOT NULL,
	"source_detail" text,
	"status" "application_status" DEFAULT 'received' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thesis_version_id" uuid,
	"prompt_bundle_version" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"langfuse_trace_id" text,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_public_ref_unique" UNIQUE("public_ref")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value_text" text,
	"value_num" real,
	"unit" text,
	"source_type" "claim_source_type" NOT NULL,
	"source_ref" text NOT NULL,
	"quote" varchar(300),
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" "confidence",
	"is_stale" boolean DEFAULT false NOT NULL,
	"extracted_by_prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"field" text NOT NULL,
	"claim_a_id" uuid NOT NULL,
	"claim_b_id" uuid NOT NULL,
	"severity" "severity" NOT NULL,
	"kind" text,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"langgraph_thread_id" text NOT NULL,
	"state" jsonb,
	"suppressed" boolean DEFAULT false NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scorecard_id" uuid NOT NULL,
	"criterion_key" text,
	"old_score" real,
	"new_score" real NOT NULL,
	"reason_line" varchar(200) NOT NULL,
	"corrector" text NOT NULL,
	"sector" text,
	"stage" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector(768),
	"superseded_by" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"reuse_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"definition" text NOT NULL,
	"what_good_looks_like" text,
	"what_bad_looks_like" text,
	"anchors" jsonb,
	"weight" real DEFAULT 1 NOT NULL,
	"is_gate" boolean DEFAULT false NOT NULL,
	"source_citations" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criterion_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scorecard_id" uuid NOT NULL,
	"thesis_kind" text NOT NULL,
	"criterion_key" text NOT NULL,
	"score" real,
	"evidence_status" "evidence_status" NOT NULL,
	"rationale" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_penalty_applied" boolean DEFAULT false NOT NULL,
	"similar_past_deals" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"filename" text,
	"blob_url" text,
	"storage_key" text,
	"page_count" integer,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_draft_id" uuid NOT NULL,
	"kind" "email_kind" NOT NULL,
	"summary" text NOT NULL,
	"before" text,
	"after" text,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" "email_kind" NOT NULL,
	"ai_draft" text NOT NULL,
	"final_text" text,
	"edit_diff" text,
	"edit_meaningful" boolean,
	"edit_judge_reason" text,
	"draft_rationale" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_run_id" uuid NOT NULL,
	"suite" text NOT NULL,
	"case_id" text NOT NULL,
	"severity" "eval_severity" NOT NULL,
	"hard" boolean NOT NULL,
	"passed" boolean NOT NULL,
	"actual" jsonb,
	"expected" jsonb,
	"judge_reasoning" text,
	"human_verdict" boolean,
	"trace_id" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite" text NOT NULL,
	"git_sha" text,
	"judge_model" text,
	"judge_same_family" boolean,
	"summary" jsonb,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"type" "flag_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"detail" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founders" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"role" text,
	"background_summary" text,
	"linkedin_url_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founders_pii" (
	"founder_id" varchar(16) PRIMARY KEY NOT NULL,
	"full_name_enc" text,
	"email_enc" text,
	"phone_enc" text,
	"linkedin_url_enc" text,
	"first_name_enc" text,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"fact_key" text NOT NULL,
	"value" text,
	"source_url" text,
	"quote" text,
	"retrieved_at" timestamp with time zone,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid,
	"field" text NOT NULL,
	"what_we_tried" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why_missing" text NOT NULL,
	"cost_of_absence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" text,
	"application_id" uuid,
	"step" text NOT NULL,
	"prompt_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"cost_inr" numeric(14, 4) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(18, 8) DEFAULT '0' NOT NULL,
	"status" "llm_call_status" NOT NULL,
	"error_type" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"portkey_request_id" text,
	"cache_key" varchar(64),
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_response_cache" (
	"cache_key" varchar(64) PRIMARY KEY NOT NULL,
	"output" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"attendees" text[] DEFAULT '{}'::text[] NOT NULL,
	"calendar_event_ids" jsonb,
	"meet_link" text,
	"status" "meeting_status" DEFAULT 'unscheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memo_sections" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"memo_id" integer NOT NULL,
	"section" text NOT NULL,
	"text" text NOT NULL,
	"page_ref" text,
	"embedding" vector(768)
);
--> statement-breakpoint
CREATE TABLE "memos" (
	"id" integer PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"sector" text NOT NULL,
	"stage" text,
	"source" text,
	"decision" text NOT NULL,
	"source_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"input_per_1m_usd" numeric(14, 4) NOT NULL,
	"output_per_1m_usd" numeric(14, 4) NOT NULL,
	"cached_input_per_1m_usd" numeric(14, 4),
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_chunks" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"note_id" integer NOT NULL,
	"chunk_no" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(768)
);
--> statement-breakpoint
CREATE TABLE "partner_notes" (
	"id" integer PRIMARY KEY NOT NULL,
	"title" text,
	"meeting_date" text,
	"source_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"one_liner" text,
	"sector" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector(768),
	"source_url" text,
	"added_by" "portfolio_added_by" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"sha" varchar(64) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"iteration" integer NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"intended_field" text,
	"outcome" text,
	"failure_reason" "fetch_failure_reason",
	"fields_filled" text[] DEFAULT '{}'::text[] NOT NULL,
	"fields_missing" text[] DEFAULT '{}'::text[] NOT NULL,
	"stop_reason" "research_stop_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"reviewer" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"thesis_version_id" uuid,
	"prompt_version" text,
	"model" text,
	"overall_score" real,
	"score_stated" real,
	"score_revealed" real,
	"recommendation" "recommendation",
	"confidence" "confidence",
	"primary_thesis_used" text,
	"primary_thesis_why" text,
	"case_for" text,
	"case_against" text,
	"questions_for_call" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrections_applied" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"daily_limit_inr" numeric(14, 4) DEFAULT '500' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"pause_reason" text,
	"alert_80_sent_on" text,
	"usd_inr_rate" numeric(14, 4) DEFAULT '84' NOT NULL,
	"models_per_step" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scoring_per_minute" integer DEFAULT 5 NOT NULL,
	"thresholds" jsonb DEFAULT '{"takeCall":7,"maybe":5}'::jsonb NOT NULL,
	"missing_penalty_cap" real DEFAULT 4 NOT NULL,
	"test_mode" boolean DEFAULT true NOT NULL,
	"riya_hourly_cost_inr" numeric(14, 4),
	"calendar_windows" jsonb DEFAULT '{"days":[2,4],"startHour":14,"endHour":18,"slotMinutes":30}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_rules" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"quote" text,
	"sectors" text[] DEFAULT '{}'::text[] NOT NULL,
	"stages" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thesis_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"criteria" jsonb,
	"weights" jsonb,
	"active_primary" boolean DEFAULT false NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"email" text PRIMARY KEY NOT NULL,
	"role" "user_role" NOT NULL,
	"google_refresh_token_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"url_hash" varchar(64) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_status" integer,
	"fetch_method" "fetch_method",
	"robots_allowed" boolean,
	"cleaned_text" text,
	"token_count" integer,
	"failure_reason" "fetch_failure_reason"
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_claim_a_id_claims_id_fk" FOREIGN KEY ("claim_a_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_claim_b_id_claims_id_fk" FOREIGN KEY ("claim_b_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_scorecard_id_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria" ADD CONSTRAINT "criteria_thesis_version_id_thesis_versions_id_fk" FOREIGN KEY ("thesis_version_id") REFERENCES "public"."thesis_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_scores" ADD CONSTRAINT "criterion_scores_scorecard_id_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_corrections" ADD CONSTRAINT "email_corrections_email_draft_id_email_drafts_id_fk" FOREIGN KEY ("email_draft_id") REFERENCES "public"."email_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders" ADD CONSTRAINT "founders_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders_pii" ADD CONSTRAINT "founders_pii_founder_id_founders_id_fk" FOREIGN KEY ("founder_id") REFERENCES "public"."founders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gaps" ADD CONSTRAINT "gaps_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memo_sections" ADD CONSTRAINT "memo_sections_memo_id_memos_id_fk" FOREIGN KEY ("memo_id") REFERENCES "public"."memos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_chunks" ADD CONSTRAINT "note_chunks_note_id_partner_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."partner_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_created_at_idx" ON "applications" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_idempotency_key_uq" ON "applications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "claims_application_id_idx" ON "claims" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "claims_field_idx" ON "claims" USING btree ("field");--> statement-breakpoint
CREATE INDEX "contradictions_application_id_idx" ON "contradictions" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "criteria_version_key_uq" ON "criteria" USING btree ("thesis_version_id","key");--> statement-breakpoint
CREATE INDEX "criterion_scores_scorecard_id_idx" ON "criterion_scores" USING btree ("scorecard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_pages_doc_page_uq" ON "document_pages" USING btree ("document_id","page_no");--> statement-breakpoint
CREATE INDEX "documents_application_id_idx" ON "documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "email_drafts_application_id_idx" ON "email_drafts" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "eval_results_run_idx" ON "eval_results" USING btree ("eval_run_id");--> statement-breakpoint
CREATE INDEX "flags_application_id_idx" ON "flags" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "founders_application_id_idx" ON "founders" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "gaps_application_id_idx" ON "gaps" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "llm_calls_application_id_idx" ON "llm_calls" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_cache_key_idx" ON "llm_calls" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "memo_sections_memo_id_idx" ON "memo_sections" USING btree ("memo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_name_version_uq" ON "prompt_versions" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "research_runs_application_id_idx" ON "research_runs" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "reviews_application_id_idx" ON "reviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "scorecards_application_id_idx" ON "scorecards" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_cache_url_hash_uq" ON "web_cache" USING btree ("url_hash");