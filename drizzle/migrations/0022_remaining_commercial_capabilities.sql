CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_step` text DEFAULT 'uploaded' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`result` text DEFAULT '{}' NOT NULL,
	`error_code` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analysis_runs_user_created_idx` ON `analysis_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analysis_runs_status_expiry_idx` ON `analysis_runs` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `career_assessment_results` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`assessment_type` text NOT NULL,
	`result_code` text NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`dimension_scores` text DEFAULT '{}' NOT NULL,
	`matched_occupation_codes` text DEFAULT '[]' NOT NULL,
	`is_latest` integer DEFAULT true NOT NULL,
	`completed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `career_assessment_results_user_type_created_idx` ON `career_assessment_results` (`user_id`,`assessment_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `career_assessment_results_user_latest_idx` ON `career_assessment_results` (`user_id`,`is_latest`);--> statement-breakpoint
CREATE TABLE `career_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`check_in_date` text NOT NULL,
	`streak_count` integer NOT NULL,
	`task_ids_completed` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `career_check_ins_user_created_idx` ON `career_check_ins` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `career_check_ins_user_date_unique` ON `career_check_ins` (`user_id`,`check_in_date`);--> statement-breakpoint
CREATE TABLE `career_feature_unlocks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`feature` text NOT NULL,
	`source` text NOT NULL,
	`business_ref_id` text NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `career_feature_unlocks_user_feature_idx` ON `career_feature_unlocks` (`user_id`,`feature`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `career_feature_unlocks_user_feature_ref_unique` ON `career_feature_unlocks` (`user_id`,`feature`,`business_ref_id`);--> statement-breakpoint
CREATE TABLE `career_report_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`markdown` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`completeness` text DEFAULT '{}' NOT NULL,
	`source_version_id` text,
	`ai_operation_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `career_report_versions_user_created_idx` ON `career_report_versions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `career_report_versions_user_version_unique` ON `career_report_versions` (`user_id`,`version`);--> statement-breakpoint
CREATE TABLE `career_streak_stats` (
	`user_id` text PRIMARY KEY NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`total_check_ins` integer DEFAULT 0 NOT NULL,
	`last_check_in_date` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_name` text NOT NULL,
	`name` text NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`website` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_normalized_name_unique` ON `companies` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `job_postings` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`source` text NOT NULL,
	`company_id` text NOT NULL,
	`occupation_code` text,
	`title` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`salary_min_monthly` integer,
	`salary_max_monthly` integer,
	`salary_months` integer DEFAULT 12 NOT NULL,
	`source_url` text,
	`published_at` integer,
	`expires_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`occupation_code`) REFERENCES `occupations`(`code`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_postings_active_industry_idx` ON `job_postings` (`active`,`industry`);--> statement-breakpoint
CREATE INDEX `job_postings_occupation_code_idx` ON `job_postings` (`occupation_code`);--> statement-breakpoint
CREATE INDEX `job_postings_salary_idx` ON `job_postings` (`salary_min_monthly`,`salary_max_monthly`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_postings_source_external_unique` ON `job_postings` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `job_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`keywords` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`frequency` text DEFAULT 'weekly' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_subscriptions_user_active_idx` ON `job_subscriptions` (`user_id`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_subscriptions_user_filter_unique` ON `job_subscriptions` (`user_id`,`keywords`,`city`,`frequency`);--> statement-breakpoint
CREATE TABLE `organization_discounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`plan_code` text DEFAULT '*' NOT NULL,
	`percent_off` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `organization_discounts_org_active_idx` ON `organization_discounts` (`organization_id`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_discounts_org_plan_unique` ON `organization_discounts` (`organization_id`,`plan_code`);--> statement-breakpoint
CREATE TABLE `organization_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`domain` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_domains_domain_unique` ON `organization_domains` (`domain`);--> statement-breakpoint
CREATE INDEX `organization_domains_organization_id_idx` ON `organization_domains` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organization_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_prefix` text NOT NULL,
	`max_uses` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invites_code_hash_unique` ON `organization_invites` (`code_hash`);--> statement-breakpoint
CREATE INDEX `organization_invites_org_active_idx` ON `organization_invites` (`organization_id`,`active`);--> statement-breakpoint
ALTER TABLE `career_guidance_notes` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `career_guidance_notes` ADD `follow_up_status` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `career_guidance_notes` ADD `next_follow_up_at` integer;--> statement-breakpoint
ALTER TABLE `career_guidance_notes` ADD `updated_at` integer DEFAULT (unixepoch()) NOT NULL;--> statement-breakpoint
CREATE INDEX `career_guidance_notes_teacher_follow_up_idx` ON `career_guidance_notes` (`teacher_id`,`follow_up_status`,`next_follow_up_at`);--> statement-breakpoint
ALTER TABLE `organizations` ADD `kind` text DEFAULT 'employer' NOT NULL;