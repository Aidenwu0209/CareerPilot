CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`tenant_id` text,
	`request_id` text,
	`result` text DEFAULT 'success' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_events_actor_id_idx` ON `audit_events` (`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`);--> statement-breakpoint
CREATE INDEX `audit_events_target_type_target_id_idx` ON `audit_events` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_events_tenant_id_idx` ON `audit_events` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `audit_events_created_at_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_id_created_at_idx` ON `audit_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_tenant_id_created_at_idx` ON `audit_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `legal_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_type` text NOT NULL,
	`version` text NOT NULL,
	`effective_date` integer NOT NULL,
	`source` text NOT NULL,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `legal_consents_user_id_idx` ON `legal_consents` (`user_id`);--> statement-breakpoint
CREATE INDEX `legal_consents_user_id_document_type_idx` ON `legal_consents` (`user_id`,`document_type`);--> statement-breakpoint
CREATE INDEX `legal_consents_document_type_version_idx` ON `legal_consents` (`document_type`,`version`);--> statement-breakpoint
CREATE INDEX `legal_consents_created_at_idx` ON `legal_consents` (`created_at`);--> statement-breakpoint
-- Immutability triggers: prevent UPDATE and DELETE on audit_events
CREATE TRIGGER `audit_events_no_update` BEFORE UPDATE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'audit_events is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `audit_events_no_delete` BEFORE DELETE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'audit_events is immutable');
END;--> statement-breakpoint
-- Immutability triggers: prevent UPDATE and DELETE on legal_consents
CREATE TRIGGER `legal_consents_no_update` BEFORE UPDATE ON `legal_consents`
BEGIN
  SELECT RAISE(ABORT, 'legal_consents is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `legal_consents_no_delete` BEFORE DELETE ON `legal_consents`
BEGIN
  SELECT RAISE(ABORT, 'legal_consents is immutable');
END;