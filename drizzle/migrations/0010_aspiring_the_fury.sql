CREATE TABLE `ai_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_identifier` text NOT NULL,
	`display_name` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`tier` text DEFAULT 'standard' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`input_token_limit` integer,
	`output_token_limit` integer,
	`max_steps` integer,
	`fixed_price` integer DEFAULT 0,
	`token_price_input` integer DEFAULT 0,
	`token_price_output` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CHECK (`fixed_price` >= 0),
	CHECK (`token_price_input` >= 0),
	CHECK (`token_price_output` >= 0),
	FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_models_provider_id_idx` ON `ai_models` (`provider_id`);--> statement-breakpoint
CREATE INDEX `ai_models_status_idx` ON `ai_models` (`status`);--> statement-breakpoint
CREATE INDEX `ai_models_tier_idx` ON `ai_models` (`tier`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_models_provider_id_model_identifier_unique` ON `ai_models` (`provider_id`,`model_identifier`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`encrypted_credentials` text,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`last_validated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_providers_type_idx` ON `ai_providers` (`type`);--> statement-breakpoint
CREATE INDEX `ai_providers_status_idx` ON `ai_providers` (`status`);