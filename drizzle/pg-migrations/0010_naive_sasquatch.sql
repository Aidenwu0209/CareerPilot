CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"tenant_id" text,
	"request_id" text,
	"result" text DEFAULT 'success' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"ip_address" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"document_type" text NOT NULL,
	"version" text NOT NULL,
	"effective_date" integer NOT NULL,
	"source" text NOT NULL,
	"ip_address" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_consents" ADD CONSTRAINT "legal_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_events_target_type_target_id_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_id_idx" ON "audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_id_created_at_idx" ON "audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "legal_consents_user_id_idx" ON "legal_consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "legal_consents_user_id_document_type_idx" ON "legal_consents" USING btree ("user_id","document_type");--> statement-breakpoint
CREATE INDEX "legal_consents_document_type_version_idx" ON "legal_consents" USING btree ("document_type","version");--> statement-breakpoint
CREATE INDEX "legal_consents_created_at_idx" ON "legal_consents" USING btree ("created_at");--> statement-breakpoint
-- Immutability: trigger functions for audit_events and legal_consents
CREATE OR REPLACE FUNCTION prevent_audit_events_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON "audit_events" EXECUTE FUNCTION prevent_audit_events_modification();--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON "audit_events" EXECUTE FUNCTION prevent_audit_events_modification();--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_legal_consents_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'legal_consents is immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER legal_consents_no_update BEFORE UPDATE ON "legal_consents" EXECUTE FUNCTION prevent_legal_consents_modification();--> statement-breakpoint
CREATE TRIGGER legal_consents_no_delete BEFORE DELETE ON "legal_consents" EXECUTE FUNCTION prevent_legal_consents_modification();