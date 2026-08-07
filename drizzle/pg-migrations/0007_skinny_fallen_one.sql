CREATE TABLE "credit_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "credit_accounts_owner_type_owner_id_unique" UNIQUE("owner_type","owner_id")
);
--> statement-breakpoint
CREATE TABLE "credit_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_type" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"balance_before" integer NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"operator_id" text,
	"business_ref_id" text,
	"idempotency_key" text NOT NULL,
	"rule_snapshot" text DEFAULT '{}',
	"note" text DEFAULT '' NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "credit_transactions_account_id_idempotency_key_unique" UNIQUE("account_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "credit_rules" ADD CONSTRAINT "credit_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_account_id_credit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_accounts_owner_type_idx" ON "credit_accounts" USING btree ("owner_type");--> statement-breakpoint
CREATE INDEX "credit_accounts_owner_type_status_idx" ON "credit_accounts" USING btree ("owner_type","status");--> statement-breakpoint
CREATE INDEX "credit_rules_rule_type_active_idx" ON "credit_rules" USING btree ("rule_type","active");--> statement-breakpoint
CREATE INDEX "credit_rules_rule_type_version_idx" ON "credit_rules" USING btree ("rule_type","version");--> statement-breakpoint
CREATE INDEX "credit_transactions_account_id_idx" ON "credit_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_account_id_created_at_idx" ON "credit_transactions" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_transactions_reason_idx" ON "credit_transactions" USING btree ("reason");--> statement-breakpoint
CREATE INDEX "credit_transactions_business_ref_id_idx" ON "credit_transactions" USING btree ("business_ref_id");--> statement-breakpoint
-- CHECK constraints for non-negative balances and values
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_balance_non_negative" CHECK ("balance" >= 0);--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_balance_before_non_negative" CHECK ("balance_before" >= 0);--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_balance_after_non_negative" CHECK ("balance_after" >= 0);--> statement-breakpoint
ALTER TABLE "credit_rules" ADD CONSTRAINT "credit_rules_value_non_negative" CHECK ("value" >= 0);--> statement-breakpoint
-- Immutability: prevent UPDATE and DELETE on credit_transactions
CREATE OR REPLACE FUNCTION prevent_credit_transaction_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'credit_transactions is immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "credit_transactions_no_update"
  BEFORE UPDATE ON "credit_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_transaction_modification();--> statement-breakpoint
CREATE TRIGGER "credit_transactions_no_delete"
  BEFORE DELETE ON "credit_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_transaction_modification();