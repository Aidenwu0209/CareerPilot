CREATE TABLE "career_abilities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"dimension" text NOT NULL,
	"score" integer,
	"confidence" integer,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_abilities_user_id_code_unique" UNIQUE("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "career_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ability_code" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"source_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"review_reason" text DEFAULT '' NOT NULL,
	"reviewed_at" integer,
	"occurred_at" integer,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_evidence_source_type_source_id_ability_code_unique" UNIQUE("source_type","source_id","ability_code")
);
--> statement-breakpoint
CREATE TABLE "career_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"occupation_code" text NOT NULL,
	"is_primary" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"target_date" integer,
	"rationale" text DEFAULT '' NOT NULL,
	"preferences" text DEFAULT '{}' NOT NULL,
	"teacher_confirmation_status" text DEFAULT 'unreviewed' NOT NULL,
	"confirmed_by" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_guidance_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"visibility" text DEFAULT 'student' NOT NULL,
	"content" text NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_knowledge_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"occupation_code" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source_label" text NOT NULL,
	"source_url" text NOT NULL,
	"published_at" integer,
	"verified_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" text,
	"occupation_code" text NOT NULL,
	"score" integer,
	"evidence_coverage" integer DEFAULT 0 NOT NULL,
	"known_weight" integer DEFAULT 0 NOT NULL,
	"total_weight" integer DEFAULT 0 NOT NULL,
	"breakdown" text DEFAULT '[]' NOT NULL,
	"citations" text DEFAULT '[]' NOT NULL,
	"algorithm_version" text DEFAULT 'career-match-v1' NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_profile_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"abilities" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_profile_snapshots_user_id_version_unique" UNIQUE("user_id","version")
);
--> statement-breakpoint
CREATE TABLE "career_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"stage" text DEFAULT 'exploring' NOT NULL,
	"completeness" integer DEFAULT 0 NOT NULL,
	"evidence_coverage" integer DEFAULT 0 NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "career_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "career_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" text,
	"occupation_code" text,
	"ability_code" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"completion_criteria" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'learn' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"due_at" integer,
	"completed_at" integer,
	"assigned_by" text,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "education_role_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "education_role_assignments_organization_id_user_id_role_unique" UNIQUE("organization_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "occupation_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"from_code" text NOT NULL,
	"to_code" text NOT NULL,
	"relation_type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "occupation_relations_from_code_to_code_relation_type_unique" UNIQUE("from_code","to_code","relation_type")
);
--> statement-breakpoint
CREATE TABLE "occupation_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"occupation_code" text NOT NULL,
	"ability_code" text NOT NULL,
	"ability_name" text NOT NULL,
	"dimension" text NOT NULL,
	"target_score" integer NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"required" integer DEFAULT 1 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "occupation_requirements_occupation_code_ability_code_unique" UNIQUE("occupation_code","ability_code")
);
--> statement-breakpoint
CREATE TABLE "occupations" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"entry_level" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_student_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"teacher_user_id" text NOT NULL,
	"student_user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_level" text DEFAULT 'guide' NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now())::integer NOT NULL,
	CONSTRAINT "teacher_student_assignments_org_teacher_student_unique" UNIQUE("organization_id","teacher_user_id","student_user_id")
);
--> statement-breakpoint
ALTER TABLE "career_abilities" ADD CONSTRAINT "career_abilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_evidence" ADD CONSTRAINT "career_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_evidence" ADD CONSTRAINT "career_evidence_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_goals" ADD CONSTRAINT "career_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_goals" ADD CONSTRAINT "career_goals_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_goals" ADD CONSTRAINT "career_goals_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_guidance_notes" ADD CONSTRAINT "career_guidance_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_guidance_notes" ADD CONSTRAINT "career_guidance_notes_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_knowledge_documents" ADD CONSTRAINT "career_knowledge_documents_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_matches" ADD CONSTRAINT "career_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_matches" ADD CONSTRAINT "career_matches_goal_id_career_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."career_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_matches" ADD CONSTRAINT "career_matches_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_profile_snapshots" ADD CONSTRAINT "career_profile_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_tasks" ADD CONSTRAINT "career_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_tasks" ADD CONSTRAINT "career_tasks_goal_id_career_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."career_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_tasks" ADD CONSTRAINT "career_tasks_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_tasks" ADD CONSTRAINT "career_tasks_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education_role_assignments" ADD CONSTRAINT "education_role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education_role_assignments" ADD CONSTRAINT "education_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_relations" ADD CONSTRAINT "occupation_relations_from_code_occupations_code_fk" FOREIGN KEY ("from_code") REFERENCES "public"."occupations"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_relations" ADD CONSTRAINT "occupation_relations_to_code_occupations_code_fk" FOREIGN KEY ("to_code") REFERENCES "public"."occupations"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_requirements" ADD CONSTRAINT "occupation_requirements_occupation_code_occupations_code_fk" FOREIGN KEY ("occupation_code") REFERENCES "public"."occupations"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_student_assignments" ADD CONSTRAINT "teacher_student_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_student_assignments" ADD CONSTRAINT "teacher_student_assignments_teacher_user_id_users_id_fk" FOREIGN KEY ("teacher_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_student_assignments" ADD CONSTRAINT "teacher_student_assignments_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_abilities_user_id_idx" ON "career_abilities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "career_abilities_user_id_dimension_idx" ON "career_abilities" USING btree ("user_id","dimension");--> statement-breakpoint
CREATE INDEX "career_evidence_user_id_idx" ON "career_evidence" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "career_evidence_user_id_ability_code_idx" ON "career_evidence" USING btree ("user_id","ability_code");--> statement-breakpoint
CREATE INDEX "career_evidence_status_idx" ON "career_evidence" USING btree ("status");--> statement-breakpoint
CREATE INDEX "career_goals_user_id_idx" ON "career_goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "career_goals_user_id_status_idx" ON "career_goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "career_goals_occupation_code_idx" ON "career_goals" USING btree ("occupation_code");--> statement-breakpoint
CREATE INDEX "career_guidance_notes_user_id_created_at_idx" ON "career_guidance_notes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "career_guidance_notes_teacher_id_idx" ON "career_guidance_notes" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "career_knowledge_documents_occupation_code_idx" ON "career_knowledge_documents" USING btree ("occupation_code");--> statement-breakpoint
CREATE INDEX "career_knowledge_documents_source_label_idx" ON "career_knowledge_documents" USING btree ("source_label");--> statement-breakpoint
CREATE INDEX "career_matches_user_id_occupation_code_idx" ON "career_matches" USING btree ("user_id","occupation_code");--> statement-breakpoint
CREATE INDEX "career_matches_user_id_created_at_idx" ON "career_matches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "career_profile_snapshots_user_id_created_at_idx" ON "career_profile_snapshots" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "career_profiles_user_id_idx" ON "career_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "career_profiles_stage_idx" ON "career_profiles" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "career_tasks_user_id_idx" ON "career_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "career_tasks_user_id_status_idx" ON "career_tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "career_tasks_goal_id_idx" ON "career_tasks" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "career_tasks_due_at_idx" ON "career_tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "education_role_assignments_organization_id_role_idx" ON "education_role_assignments" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "education_role_assignments_user_id_status_idx" ON "education_role_assignments" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "occupation_relations_from_code_idx" ON "occupation_relations" USING btree ("from_code");--> statement-breakpoint
CREATE INDEX "occupation_relations_to_code_idx" ON "occupation_relations" USING btree ("to_code");--> statement-breakpoint
CREATE INDEX "occupation_requirements_occupation_code_idx" ON "occupation_requirements" USING btree ("occupation_code");--> statement-breakpoint
CREATE INDEX "occupation_requirements_ability_code_idx" ON "occupation_requirements" USING btree ("ability_code");--> statement-breakpoint
CREATE INDEX "occupations_category_idx" ON "occupations" USING btree ("category");--> statement-breakpoint
CREATE INDEX "occupations_active_idx" ON "occupations" USING btree ("active");--> statement-breakpoint
CREATE INDEX "teacher_student_assignments_teacher_user_id_status_idx" ON "teacher_student_assignments" USING btree ("teacher_user_id","status");--> statement-breakpoint
CREATE INDEX "teacher_student_assignments_student_user_id_status_idx" ON "teacher_student_assignments" USING btree ("student_user_id","status");--> statement-breakpoint
CREATE INDEX "teacher_student_assignments_organization_id_status_idx" ON "teacher_student_assignments" USING btree ("organization_id","status");