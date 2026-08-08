CREATE TABLE `alert_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`alert_event_id` text NOT NULL,
	`channel` text NOT NULL,
	`destination` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`alert_event_id`) REFERENCES `alert_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_deliveries_alert_event_id_idx` ON `alert_deliveries` (`alert_event_id`);--> statement-breakpoint
CREATE INDEX `alert_deliveries_channel_created_at_idx` ON `alert_deliveries` (`channel`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `alert_deliveries_id_channel_unique` ON `alert_deliveries` (`id`,`channel`);--> statement-breakpoint
CREATE TABLE `alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`source` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`last_delivery_status` text,
	`last_delivered_at` integer,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_events_fingerprint_unique` ON `alert_events` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `alert_events_status_severity_idx` ON `alert_events` (`status`,`severity`);--> statement-breakpoint
CREATE INDEX `alert_events_last_seen_at_idx` ON `alert_events` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `billing_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`user_level` text DEFAULT 'free' NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text DEFAULT 'cny' NOT NULL,
	`credits` integer NOT NULL,
	`billing_interval` text,
	`stripe_price_id` text,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_plans_code_unique` ON `billing_plans` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_plans_stripe_price_id_unique` ON `billing_plans` (`stripe_price_id`);--> statement-breakpoint
CREATE INDEX `billing_plans_kind_active_idx` ON `billing_plans` (`kind`,`active`);--> statement-breakpoint
CREATE INDEX `billing_plans_user_level_idx` ON `billing_plans` (`user_level`);--> statement-breakpoint
CREATE TABLE `payment_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`provider_order_id` text,
	`provider_payment_id` text,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount_minor` integer NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`refunded_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`credits` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `credit_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_orders_provider_order_id_unique` ON `payment_orders` (`provider_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_orders_idempotency_key_unique` ON `payment_orders` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `payment_orders_user_id_created_at_idx` ON `payment_orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_orders_status_idx` ON `payment_orders` (`status`);--> statement-breakpoint
CREATE INDEX `payment_orders_provider_payment_id_idx` ON `payment_orders` (`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `payment_orders_provider_subscription_id_idx` ON `payment_orders` (`provider_subscription_id`);--> statement-breakpoint
CREATE TABLE `payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider_refund_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount_minor` integer NOT NULL,
	`credits_reversed` integer NOT NULL,
	`reason` text DEFAULT 'customer_request' NOT NULL,
	`requested_by` text,
	`failure_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_refunds_provider_refund_id_unique` ON `payment_refunds` (`provider_refund_id`);--> statement-breakpoint
CREATE INDEX `payment_refunds_order_id_idx` ON `payment_refunds` (`order_id`);--> statement-breakpoint
CREATE INDEX `payment_refunds_status_idx` ON `payment_refunds` (`status`);--> statement-breakpoint
CREATE TABLE `payment_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`payload_hash` text NOT NULL,
	`error_message` text,
	`processed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_webhook_events_status_created_at_idx` ON `payment_webhook_events` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_webhook_events_provider_event_id_unique` ON `payment_webhook_events` (`provider`,`event_id`);--> statement-breakpoint
CREATE TABLE `plan_model_access` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`model_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `ai_models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_model_access_plan_id_idx` ON `plan_model_access` (`plan_id`);--> statement-breakpoint
CREATE INDEX `plan_model_access_model_id_idx` ON `plan_model_access` (`model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_model_access_plan_id_model_id_unique` ON `plan_model_access` (`plan_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `reconciliation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`order_id` text,
	`issue` text NOT NULL,
	`local_value` text,
	`provider_value` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `reconciliation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reconciliation_items_run_id_idx` ON `reconciliation_items` (`run_id`);--> statement-breakpoint
CREATE INDEX `reconciliation_items_order_id_idx` ON `reconciliation_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `reconciliation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`checked_count` integer DEFAULT 0 NOT NULL,
	`mismatch_count` integer DEFAULT 0 NOT NULL,
	`started_by` text,
	`summary` text DEFAULT '{}' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `reconciliation_runs_provider_started_at_idx` ON `reconciliation_runs` (`provider`,`started_at`);--> statement-breakpoint
CREATE TABLE `user_entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`external_customer_id` text,
	`external_subscription_id` text,
	`current_period_start` integer,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_entitlements_external_subscription_id_unique` ON `user_entitlements` (`external_subscription_id`);--> statement-breakpoint
CREATE INDEX `user_entitlements_user_id_status_idx` ON `user_entitlements` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `user_entitlements_period_end_idx` ON `user_entitlements` (`current_period_end`);--> statement-breakpoint
ALTER TABLE `ai_models` ADD `family` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_models` ADD `delivery_resolution` text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_models` ADD `upscaler_url` text;--> statement-breakpoint
CREATE INDEX `ai_models_family_idx` ON `ai_models` (`family`);