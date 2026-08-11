CREATE TABLE `organization_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organization_memberships_user_id_idx` ON `organization_memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `organization_memberships_organization_id_idx` ON `organization_memberships` (`organization_id`);--> statement-breakpoint
CREATE INDEX `organization_memberships_organization_id_status_idx` ON `organization_memberships` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `organization_memberships_user_id_status_idx` ON `organization_memberships` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `organization_memberships_role_idx` ON `organization_memberships` (`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_memberships_organization_id_user_id_unique` ON `organization_memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`seat_limit` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_created_by_idx` ON `organizations` (`created_by`);--> statement-breakpoint
CREATE INDEX `organizations_status_idx` ON `organizations` (`status`);