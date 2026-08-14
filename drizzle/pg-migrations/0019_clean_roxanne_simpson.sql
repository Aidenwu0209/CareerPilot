CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"admin_reply" text,
	"replied_by_user_id" text,
	"replied_at" integer,
	"closed_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_otps" ADD COLUMN "purpose" text DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_replied_by_user_id_users_id_fk" FOREIGN KEY ("replied_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_status_updated_at_idx" ON "support_tickets" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "email_otps_email_purpose_created_at_idx" ON "email_otps" USING btree ("email","purpose","created_at");