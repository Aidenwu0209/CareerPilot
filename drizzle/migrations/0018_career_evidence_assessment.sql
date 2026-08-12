PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_career_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ability_code` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`title` text NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`source_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`assessed_score` integer,
	`reviewed_by` text,
	`review_reason` text DEFAULT '' NOT NULL,
	`reviewed_at` integer,
	`occurred_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "career_evidence_assessed_score_check" CHECK("__new_career_evidence"."assessed_score" is null or ("__new_career_evidence"."assessed_score" between 0 and 100))
);
--> statement-breakpoint
INSERT INTO `__new_career_evidence`("id", "user_id", "ability_code", "source_type", "source_id", "title", "excerpt", "source_url", "status", "assessed_score", "reviewed_by", "review_reason", "reviewed_at", "occurred_at", "created_at") SELECT "id", "user_id", "ability_code", "source_type", "source_id", "title", "excerpt", "source_url", "status", NULL, "reviewed_by", "review_reason", "reviewed_at", "occurred_at", "created_at" FROM `career_evidence`;--> statement-breakpoint
DROP TABLE `career_evidence`;--> statement-breakpoint
ALTER TABLE `__new_career_evidence` RENAME TO `career_evidence`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `career_evidence_user_id_idx` ON `career_evidence` (`user_id`);--> statement-breakpoint
CREATE INDEX `career_evidence_user_id_ability_code_idx` ON `career_evidence` (`user_id`,`ability_code`);--> statement-breakpoint
CREATE INDEX `career_evidence_status_idx` ON `career_evidence` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `career_evidence_source_type_source_id_ability_code_unique` ON `career_evidence` (`source_type`,`source_id`,`ability_code`);
