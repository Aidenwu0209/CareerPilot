CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`admin_reply` text,
	`replied_by_user_id` text,
	`replied_at` integer,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replied_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `support_tickets_user_id_created_at_idx` ON `support_tickets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_status_updated_at_idx` ON `support_tickets` (`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `email_otps` ADD `purpose` text DEFAULT 'login' NOT NULL;--> statement-breakpoint
CREATE INDEX `email_otps_email_purpose_created_at_idx` ON `email_otps` (`email`,`purpose`,`created_at`);