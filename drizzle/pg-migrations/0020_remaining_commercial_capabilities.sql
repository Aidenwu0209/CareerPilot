CREATE TABLE "analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step" text DEFAULT 'uploaded' NOT NULL,
	"steps" text DEFAULT '[]' NOT NULL,
	"input" text DEFAULT '{}' NOT NULL,
	"result" text DEFAULT '{}' NOT NULL,
	"error_code" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"expires_at" integer NOT NULL,
	"started_at" integer,
	"completed_at" integer,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_assessment_results" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assessment_type" text NOT NULL,
	"result_code" text NOT NULL,
	"answers" text DEFAULT '{}' NOT NULL,
	"dimension_scores" text DEFAULT '{}' NOT NULL,
	"matched_occupation_codes" text DEFAULT '[]' NOT NULL,
	"is_latest" integer DEFAULT 1 NOT NULL,
	"completed_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_check_ins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"check_in_date" text NOT NULL,
	"streak_count" integer NOT NULL,
	"task_ids_completed" text DEFAULT '[]' NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_check_ins_user_date_unique" UNIQUE("user_id","check_in_date")
);
--> statement-breakpoint
CREATE TABLE "career_feature_unlocks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"source" text NOT NULL,
	"business_ref_id" text NOT NULL,
	"expires_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_feature_unlocks_user_feature_ref_unique" UNIQUE("user_id","feature","business_ref_id")
);
--> statement-breakpoint
CREATE TABLE "career_report_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"completeness" text DEFAULT '{}' NOT NULL,
	"source_version_id" text,
	"ai_operation_id" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_report_versions_user_version_unique" UNIQUE("user_id","version")
);
--> statement-breakpoint
CREATE TABLE "career_streak_stats" (
	"user_id" text PRIMARY KEY NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"total_check_ins" integer DEFAULT 0 NOT NULL,
	"last_check_in_date" text,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"normalized_name" text NOT NULL,
	"name" text NOT NULL,
	"industry" text DEFAULT '' NOT NULL,
	"website" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "companies_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"source" text NOT NULL,
	"company_id" text NOT NULL,
	"occupation_code" text,
	"title" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"industry" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"skills" text DEFAULT '[]' NOT NULL,
	"salary_min_monthly" integer,
	"salary_max_monthly" integer,
	"salary_months" integer DEFAULT 12 NOT NULL,
	"source_url" text,
	"published_at" integer,
	"expires_at" integer,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "job_postings_source_external_unique" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "job_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"keywords" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "job_subscriptions_user_filter_unique" UNIQUE("user_id","keywords","city","frequency")
);
--> statement-breakpoint
CREATE TABLE "organization_discounts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_code" text DEFAULT '*' NOT NULL,
	"percent_off" integer NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"starts_at" integer,
	"ends_at" integer,
	"created_by" text NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "organization_discounts_org_plan_unique" UNIQUE("organization_id","plan_code")
);
--> statement-breakpoint
CREATE TABLE "organization_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"verified" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "organization_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_prefix" text NOT NULL,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" integer,
	"active" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "organization_invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "career_guidance_notes" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "career_guidance_notes" ADD COLUMN "follow_up_status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "career_guidance_notes" ADD COLUMN "next_follow_up_at" integer;--> statement-breakpoint
ALTER TABLE "career_guidance_notes" ADD COLUMN "updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "kind" text DEFAULT 'employer' NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_assessment_results" ADD CONSTRAINT "career_assessment_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_check_ins" ADD CONSTRAINT "career_check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_feature_unlocks" ADD CONSTRAINT "career_feature_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_report_versions" ADD CONSTRAINT "career_report_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_streak_stats" ADD CONSTRAINT "career_streak_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_subscriptions" ADD CONSTRAINT "job_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_discounts" ADD CONSTRAINT "organization_discounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_discounts" ADD CONSTRAINT "organization_discounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_runs_user_created_idx" ON "analysis_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "analysis_runs_status_expiry_idx" ON "analysis_runs" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "career_assessment_results_user_type_created_idx" ON "career_assessment_results" USING btree ("user_id","assessment_type","created_at");--> statement-breakpoint
CREATE INDEX "career_assessment_results_user_latest_idx" ON "career_assessment_results" USING btree ("user_id","is_latest");--> statement-breakpoint
CREATE INDEX "career_check_ins_user_created_idx" ON "career_check_ins" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "career_feature_unlocks_user_feature_idx" ON "career_feature_unlocks" USING btree ("user_id","feature","expires_at");--> statement-breakpoint
CREATE INDEX "career_report_versions_user_created_idx" ON "career_report_versions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "job_postings_active_industry_idx" ON "job_postings" USING btree ("active","industry");--> statement-breakpoint
CREATE INDEX "job_postings_occupation_code_idx" ON "job_postings" USING btree ("occupation_code");--> statement-breakpoint
CREATE INDEX "job_postings_salary_idx" ON "job_postings" USING btree ("salary_min_monthly","salary_max_monthly");--> statement-breakpoint
CREATE INDEX "job_subscriptions_user_active_idx" ON "job_subscriptions" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "organization_discounts_org_active_idx" ON "organization_discounts" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "organization_domains_organization_id_idx" ON "organization_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_invites_org_active_idx" ON "organization_invites" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "career_guidance_notes_teacher_follow_up_idx" ON "career_guidance_notes" USING btree ("teacher_id","follow_up_status","next_follow_up_at");