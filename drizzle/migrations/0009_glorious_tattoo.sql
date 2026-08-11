CREATE TABLE `credit_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CHECK (`balance` >= 0)
);
--> statement-breakpoint
CREATE INDEX `credit_accounts_owner_type_idx` ON `credit_accounts` (`owner_type`);--> statement-breakpoint
CREATE INDEX `credit_accounts_owner_type_status_idx` ON `credit_accounts` (`owner_type`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_accounts_owner_type_owner_id_unique` ON `credit_accounts` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `credit_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_type` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CHECK (`value` >= 0),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credit_rules_rule_type_active_idx` ON `credit_rules` (`rule_type`,`active`);--> statement-breakpoint
CREATE INDEX `credit_rules_rule_type_version_idx` ON `credit_rules` (`rule_type`,`version`);--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`balance_before` integer NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reason` text NOT NULL,
	`operator_id` text,
	`business_ref_id` text,
	`idempotency_key` text NOT NULL,
	`rule_snapshot` text DEFAULT '{}',
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CHECK (`balance_before` >= 0),
	CHECK (`balance_after` >= 0),
	FOREIGN KEY (`account_id`) REFERENCES `credit_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `credit_transactions_account_id_idx` ON `credit_transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `credit_transactions_account_id_created_at_idx` ON `credit_transactions` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `credit_transactions_reason_idx` ON `credit_transactions` (`reason`);--> statement-breakpoint
CREATE INDEX `credit_transactions_business_ref_id_idx` ON `credit_transactions` (`business_ref_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_transactions_account_id_idempotency_key_unique` ON `credit_transactions` (`account_id`,`idempotency_key`);--> statement-breakpoint
-- Immutability triggers: prevent UPDATE and DELETE on credit_transactions
CREATE TRIGGER `credit_transactions_no_update` BEFORE UPDATE ON `credit_transactions`
BEGIN
  SELECT RAISE(ABORT, 'credit_transactions is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `credit_transactions_no_delete` BEFORE DELETE ON `credit_transactions`
BEGIN
  SELECT RAISE(ABORT, 'credit_transactions is immutable');
END;
