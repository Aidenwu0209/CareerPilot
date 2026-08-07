CREATE TABLE "email_otps" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"ip_address" text,
	"expires_at" integer NOT NULL,
	"used_at" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_otps_email_idx" ON "email_otps" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_otps_email_used_at_idx" ON "email_otps" USING btree ("email","used_at");--> statement-breakpoint
CREATE INDEX "email_otps_ip_address_idx" ON "email_otps" USING btree ("ip_address");