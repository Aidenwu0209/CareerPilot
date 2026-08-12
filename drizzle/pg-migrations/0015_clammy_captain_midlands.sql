CREATE TABLE "career_catalog_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_catalog_entries_version_entity_external_unique" UNIQUE("catalog_version_id","entity_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "career_catalog_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"schema_version" text NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"manifest_hash" text NOT NULL,
	"source_directory" text DEFAULT '' NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"activated_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_catalog_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "career_colleges" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"source_ids" text DEFAULT '[]' NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "career_colleges_catalog_version_code_unique" UNIQUE("catalog_version","code")
);
--> statement-breakpoint
CREATE TABLE "career_majors" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version" text NOT NULL,
	"code" text NOT NULL,
	"college_code" text NOT NULL,
	"name" text NOT NULL,
	"degree_level" text DEFAULT '' NOT NULL,
	"currently_recruiting" integer DEFAULT 1 NOT NULL,
	"admission_year" integer,
	"source_ids" text DEFAULT '[]' NOT NULL,
	"source_excerpt" text DEFAULT '' NOT NULL,
	"employment_text" text DEFAULT '' NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "career_majors_catalog_version_code_unique" UNIQUE("catalog_version","code")
);
--> statement-breakpoint
CREATE TABLE "career_source_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version" text NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT '' NOT NULL,
	"published_at" integer,
	"fetched_at" integer,
	"content_hash" text NOT NULL,
	"http_status" integer,
	"robots_status" text DEFAULT 'unknown' NOT NULL,
	"license_notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "career_source_snapshots_version_source_unique" UNIQUE("catalog_version","source_id")
);
--> statement-breakpoint
CREATE TABLE "major_occupation_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version" text NOT NULL,
	"major_code" text NOT NULL,
	"occupation_code" text,
	"proposed_title" text,
	"relation_type" text NOT NULL,
	"source_ids" text DEFAULT '[]' NOT NULL,
	"evidence_excerpt" text DEFAULT '' NOT NULL,
	"review_required" integer DEFAULT 0 NOT NULL,
	"review_reason" text DEFAULT '' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "major_occupation_edges_version_major_occupation_relation_unique" UNIQUE("catalog_version","major_code","occupation_code","relation_type")
);
--> statement-breakpoint
CREATE TABLE "occupation_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version" text NOT NULL,
	"occupation_code" text NOT NULL,
	"alias" text NOT NULL,
	"source_ids" text DEFAULT '[]' NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "occupation_aliases_version_occupation_alias_unique" UNIQUE("catalog_version","occupation_code","alias")
);
--> statement-breakpoint
ALTER TABLE "career_knowledge_documents" ADD COLUMN "catalog_version" text;--> statement-breakpoint
ALTER TABLE "career_knowledge_documents" ADD COLUMN "content_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "career_matches" ADD COLUMN "catalog_version" text;--> statement-breakpoint
ALTER TABLE "career_matches" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "career_matches" ADD COLUMN "known_coverage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "occupation_requirements" ADD COLUMN "education_level" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupation_requirements" ADD COLUMN "experience_level" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupation_requirements" ADD COLUMN "region" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupation_requirements" ADD COLUMN "source_ids" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupation_requirements" ADD COLUMN "review_status" text DEFAULT 'reviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupation_requirements" ADD COLUMN "catalog_version" text;--> statement-breakpoint
ALTER TABLE "occupations" ADD COLUMN "canonical_type" text DEFAULT 'national_occupation' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupations" ADD COLUMN "job_family" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupations" ADD COLUMN "industry" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupations" ADD COLUMN "cities" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupations" ADD COLUMN "education_levels" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupations" ADD COLUMN "catalog_version" text;--> statement-breakpoint
ALTER TABLE "occupations" ADD COLUMN "review_status" text DEFAULT 'reviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "occupations" ADD COLUMN "scoring_eligible" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "career_catalog_entries" ADD CONSTRAINT "career_catalog_entries_catalog_version_id_career_catalog_versions_id_fk" FOREIGN KEY ("catalog_version_id") REFERENCES "public"."career_catalog_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "major_occupation_edges" ADD CONSTRAINT "major_occupation_edges_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_aliases" ADD CONSTRAINT "occupation_aliases_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_catalog_entries_version_type_idx" ON "career_catalog_entries" USING btree ("catalog_version_id","entity_type");--> statement-breakpoint
CREATE INDEX "career_catalog_versions_status_idx" ON "career_catalog_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "career_catalog_versions_created_at_idx" ON "career_catalog_versions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "career_colleges_code_idx" ON "career_colleges" USING btree ("code");--> statement-breakpoint
CREATE INDEX "career_majors_college_code_idx" ON "career_majors" USING btree ("college_code");--> statement-breakpoint
CREATE INDEX "career_majors_name_idx" ON "career_majors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "career_source_snapshots_content_hash_idx" ON "career_source_snapshots" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "major_occupation_edges_major_code_idx" ON "major_occupation_edges" USING btree ("major_code");--> statement-breakpoint
CREATE INDEX "major_occupation_edges_occupation_code_idx" ON "major_occupation_edges" USING btree ("occupation_code");--> statement-breakpoint
CREATE INDEX "occupation_aliases_alias_idx" ON "occupation_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "occupation_aliases_occupation_code_idx" ON "occupation_aliases" USING btree ("occupation_code");--> statement-breakpoint
CREATE INDEX "occupations_catalog_version_idx" ON "occupations" USING btree ("catalog_version");--> statement-breakpoint
CREATE INDEX "occupations_job_family_idx" ON "occupations" USING btree ("job_family");--> statement-breakpoint
CREATE INDEX "occupations_industry_idx" ON "occupations" USING btree ("industry");