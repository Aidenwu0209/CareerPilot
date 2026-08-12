CREATE TABLE `career_catalog_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_version_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`external_id` text NOT NULL,
	`payload` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`catalog_version_id`) REFERENCES `career_catalog_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `career_catalog_entries_version_type_idx` ON `career_catalog_entries` (`catalog_version_id`,`entity_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `career_catalog_entries_version_entity_external_unique` ON `career_catalog_entries` (`catalog_version_id`,`entity_type`,`external_id`);--> statement-breakpoint
CREATE TABLE `career_catalog_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`schema_version` text NOT NULL,
	`status` text DEFAULT 'staged' NOT NULL,
	`manifest_hash` text NOT NULL,
	`source_directory` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`activated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `career_catalog_versions_version_unique` ON `career_catalog_versions` (`version`);--> statement-breakpoint
CREATE INDEX `career_catalog_versions_status_idx` ON `career_catalog_versions` (`status`);--> statement-breakpoint
CREATE INDEX `career_catalog_versions_created_at_idx` ON `career_catalog_versions` (`created_at`);--> statement-breakpoint
CREATE TABLE `career_colleges` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_version` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`source_ids` text DEFAULT '[]' NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `career_colleges_code_idx` ON `career_colleges` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `career_colleges_catalog_version_code_unique` ON `career_colleges` (`catalog_version`,`code`);--> statement-breakpoint
CREATE TABLE `career_majors` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_version` text NOT NULL,
	`code` text NOT NULL,
	`college_code` text NOT NULL,
	`name` text NOT NULL,
	`degree_level` text DEFAULT '' NOT NULL,
	`currently_recruiting` integer DEFAULT true NOT NULL,
	`admission_year` integer,
	`source_ids` text DEFAULT '[]' NOT NULL,
	`source_excerpt` text DEFAULT '' NOT NULL,
	`employment_text` text DEFAULT '' NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `career_majors_college_code_idx` ON `career_majors` (`college_code`);--> statement-breakpoint
CREATE INDEX `career_majors_name_idx` ON `career_majors` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `career_majors_catalog_version_code_unique` ON `career_majors` (`catalog_version`,`code`);--> statement-breakpoint
CREATE TABLE `career_source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_version` text NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`publisher` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT '' NOT NULL,
	`published_at` integer,
	`fetched_at` integer,
	`content_hash` text NOT NULL,
	`http_status` integer,
	`robots_status` text DEFAULT 'unknown' NOT NULL,
	`license_notes` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `career_source_snapshots_content_hash_idx` ON `career_source_snapshots` (`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `career_source_snapshots_version_source_unique` ON `career_source_snapshots` (`catalog_version`,`source_id`);--> statement-breakpoint
CREATE TABLE `major_occupation_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_version` text NOT NULL,
	`major_code` text NOT NULL,
	`occupation_code` text,
	`proposed_title` text,
	`relation_type` text NOT NULL,
	`source_ids` text DEFAULT '[]' NOT NULL,
	`evidence_excerpt` text DEFAULT '' NOT NULL,
	`review_required` integer DEFAULT false NOT NULL,
	`review_reason` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`occupation_code`) REFERENCES `occupations`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `major_occupation_edges_major_code_idx` ON `major_occupation_edges` (`major_code`);--> statement-breakpoint
CREATE INDEX `major_occupation_edges_occupation_code_idx` ON `major_occupation_edges` (`occupation_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `major_occupation_edges_version_major_occupation_relation_unique` ON `major_occupation_edges` (`catalog_version`,`major_code`,`occupation_code`,`relation_type`);--> statement-breakpoint
CREATE TABLE `occupation_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_version` text NOT NULL,
	`occupation_code` text NOT NULL,
	`alias` text NOT NULL,
	`source_ids` text DEFAULT '[]' NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`occupation_code`) REFERENCES `occupations`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `occupation_aliases_alias_idx` ON `occupation_aliases` (`alias`);--> statement-breakpoint
CREATE INDEX `occupation_aliases_occupation_code_idx` ON `occupation_aliases` (`occupation_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `occupation_aliases_version_occupation_alias_unique` ON `occupation_aliases` (`catalog_version`,`occupation_code`,`alias`);--> statement-breakpoint
ALTER TABLE `career_knowledge_documents` ADD `catalog_version` text;--> statement-breakpoint
ALTER TABLE `career_knowledge_documents` ADD `content_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `career_matches` ADD `catalog_version` text;--> statement-breakpoint
ALTER TABLE `career_matches` ADD `confidence` integer;--> statement-breakpoint
ALTER TABLE `career_matches` ADD `known_coverage` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `occupation_requirements` ADD `education_level` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupation_requirements` ADD `experience_level` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupation_requirements` ADD `region` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupation_requirements` ADD `source_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupation_requirements` ADD `review_status` text DEFAULT 'reviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupation_requirements` ADD `catalog_version` text;--> statement-breakpoint
ALTER TABLE `occupations` ADD `canonical_type` text DEFAULT 'national_occupation' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupations` ADD `job_family` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupations` ADD `industry` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupations` ADD `cities` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupations` ADD `education_levels` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupations` ADD `catalog_version` text;--> statement-breakpoint
ALTER TABLE `occupations` ADD `review_status` text DEFAULT 'reviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE `occupations` ADD `scoring_eligible` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `occupations_catalog_version_idx` ON `occupations` (`catalog_version`);--> statement-breakpoint
CREATE INDEX `occupations_job_family_idx` ON `occupations` (`job_family`);--> statement-breakpoint
CREATE INDEX `occupations_industry_idx` ON `occupations` (`industry`);