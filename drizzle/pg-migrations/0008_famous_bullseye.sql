CREATE TABLE "ai_models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_identifier" text NOT NULL,
	"display_name" text NOT NULL,
	"capabilities" text DEFAULT '[]' NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"input_token_limit" integer,
	"output_token_limit" integer,
	"max_steps" integer,
	"fixed_price" integer DEFAULT 0,
	"token_price_input" integer DEFAULT 0,
	"token_price_output" integer DEFAULT 0,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "ai_models_fixed_price_check" CHECK ("fixed_price" >= 0),
	CONSTRAINT "ai_models_token_price_input_check" CHECK ("token_price_input" >= 0),
	CONSTRAINT "ai_models_token_price_output_check" CHECK ("token_price_output" >= 0),
	CONSTRAINT "ai_models_provider_id_model_identifier_unique" UNIQUE("provider_id","model_identifier")
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"encrypted_credentials" text,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"last_validated_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_models_provider_id_idx" ON "ai_models" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "ai_models_status_idx" ON "ai_models" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_models_tier_idx" ON "ai_models" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "ai_providers_type_idx" ON "ai_providers" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ai_providers_status_idx" ON "ai_providers" USING btree ("status");