CREATE TABLE "ai_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"billing_account_id" text NOT NULL,
	"capability" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"final_settlement_id" text,
	"metadata" text DEFAULT '{}',
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "ai_operations_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ai_provider_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"model_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"usage" text DEFAULT '{}',
	"provider_request_id" text,
	"error_message" text,
	"duration_ms" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"completed_at" integer,
	CONSTRAINT "ai_provider_attempts_operation_id_attempt_number_unique" UNIQUE("operation_id","attempt_number")
);
--> statement-breakpoint
CREATE TABLE "credit_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"hold_amount" integer NOT NULL,
	"settled_amount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"settled_at" integer
);
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_billing_account_id_credit_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_attempts" ADD CONSTRAINT "ai_provider_attempts_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_attempts" ADD CONSTRAINT "ai_provider_attempts_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_operations_actor_id_idx" ON "ai_operations" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "ai_operations_billing_account_id_idx" ON "ai_operations" USING btree ("billing_account_id");--> statement-breakpoint
CREATE INDEX "ai_operations_capability_idx" ON "ai_operations" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "ai_operations_status_idx" ON "ai_operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_operations_actor_id_capability_idx" ON "ai_operations" USING btree ("actor_id","capability");--> statement-breakpoint
CREATE INDEX "ai_operations_created_at_idx" ON "ai_operations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_provider_attempts_operation_id_idx" ON "ai_provider_attempts" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "ai_provider_attempts_model_id_idx" ON "ai_provider_attempts" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "ai_provider_attempts_status_idx" ON "ai_provider_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_holds_account_id_idx" ON "credit_holds" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credit_holds_operation_id_idx" ON "credit_holds" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "credit_holds_status_idx" ON "credit_holds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_holds_expires_at_idx" ON "credit_holds" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "credit_holds_account_id_status_idx" ON "credit_holds" USING btree ("account_id","status");--> statement-breakpoint
-- CHECK constraints for non-negative amounts and positive attempt numbers
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_hold_amount_non_negative" CHECK ("hold_amount" >= 0);--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_settled_amount_non_negative" CHECK ("settled_amount" >= 0);--> statement-breakpoint
ALTER TABLE "ai_provider_attempts" ADD CONSTRAINT "ai_provider_attempts_attempt_number_positive" CHECK ("attempt_number" >= 1);