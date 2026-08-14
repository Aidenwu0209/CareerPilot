CREATE INDEX "grammar_checks_resume_id_created_at_idx" ON "grammar_checks" USING btree ("resume_id","created_at");--> statement-breakpoint
CREATE INDEX "interview_messages_round_id_created_at_idx" ON "interview_messages" USING btree ("round_id","created_at");--> statement-breakpoint
CREATE INDEX "interview_sessions_user_id_status_idx" ON "interview_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "interview_sessions_user_id_created_at_idx" ON "interview_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "jd_analyses_resume_id_created_at_idx" ON "jd_analyses" USING btree ("resume_id","created_at");--> statement-breakpoint
CREATE INDEX "resumes_user_id_updated_at_idx" ON "resumes" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");