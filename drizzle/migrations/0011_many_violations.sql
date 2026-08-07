CREATE TABLE `ai_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`billing_account_id` text NOT NULL,
	`capability` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`idempotency_key` text NOT NULL,
	`final_settlement_id` text,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`billing_account_id`) REFERENCES `credit_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_operations_actor_id_idx` ON `ai_operations` (`actor_id`);--> statement-breakpoint
CREATE INDEX `ai_operations_billing_account_id_idx` ON `ai_operations` (`billing_account_id`);--> statement-breakpoint
CREATE INDEX `ai_operations_capability_idx` ON `ai_operations` (`capability`);--> statement-breakpoint
CREATE INDEX `ai_operations_status_idx` ON `ai_operations` (`status`);--> statement-breakpoint
CREATE INDEX `ai_operations_actor_id_capability_idx` ON `ai_operations` (`actor_id`,`capability`);--> statement-breakpoint
CREATE INDEX `ai_operations_created_at_idx` ON `ai_operations` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_operations_idempotency_key_unique` ON `ai_operations` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `ai_provider_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`model_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`usage` text DEFAULT '{}',
	`provider_request_id` text,
	`error_message` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	CHECK (`attempt_number` >= 1),
	FOREIGN KEY (`operation_id`) REFERENCES `ai_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `ai_models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_provider_attempts_operation_id_idx` ON `ai_provider_attempts` (`operation_id`);--> statement-breakpoint
CREATE INDEX `ai_provider_attempts_model_id_idx` ON `ai_provider_attempts` (`model_id`);--> statement-breakpoint
CREATE INDEX `ai_provider_attempts_status_idx` ON `ai_provider_attempts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_attempts_operation_id_attempt_number_unique` ON `ai_provider_attempts` (`operation_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `credit_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`hold_amount` integer NOT NULL,
	`settled_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`settled_at` integer,
	CHECK (`hold_amount` >= 0),
	CHECK (`settled_amount` >= 0),
	FOREIGN KEY (`account_id`) REFERENCES `credit_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operation_id`) REFERENCES `ai_operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_holds_account_id_idx` ON `credit_holds` (`account_id`);--> statement-breakpoint
CREATE INDEX `credit_holds_operation_id_idx` ON `credit_holds` (`operation_id`);--> statement-breakpoint
CREATE INDEX `credit_holds_status_idx` ON `credit_holds` (`status`);--> statement-breakpoint
CREATE INDEX `credit_holds_expires_at_idx` ON `credit_holds` (`expires_at`);--> statement-breakpoint
CREATE INDEX `credit_holds_account_id_status_idx` ON `credit_holds` (`account_id`,`status`);