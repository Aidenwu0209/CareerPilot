CREATE INDEX `auth_accounts_user_id_idx` ON `auth_accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_provider_provider_account_id_unique` ON `auth_accounts` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_session_id_idx` ON `chat_messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_session_id_created_at_idx` ON `chat_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_sessions_resume_id_idx` ON `chat_sessions` (`resume_id`);--> statement-breakpoint
CREATE INDEX `grammar_checks_resume_id_idx` ON `grammar_checks` (`resume_id`);--> statement-breakpoint
CREATE INDEX `interview_messages_round_id_idx` ON `interview_messages` (`round_id`);--> statement-breakpoint
CREATE INDEX `interview_rounds_session_id_idx` ON `interview_rounds` (`session_id`);--> statement-breakpoint
CREATE INDEX `interview_sessions_user_id_idx` ON `interview_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `interview_sessions_resume_id_idx` ON `interview_sessions` (`resume_id`);--> statement-breakpoint
CREATE INDEX `jd_analyses_resume_id_idx` ON `jd_analyses` (`resume_id`);--> statement-breakpoint
CREATE INDEX `resume_sections_resume_id_idx` ON `resume_sections` (`resume_id`);--> statement-breakpoint
CREATE INDEX `resume_sections_resume_id_sort_order_idx` ON `resume_sections` (`resume_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `resume_shares_resume_id_idx` ON `resume_shares` (`resume_id`);--> statement-breakpoint
CREATE INDEX `resumes_user_id_idx` ON `resumes` (`user_id`);--> statement-breakpoint
CREATE INDEX `resumes_share_token_idx` ON `resumes` (`share_token`);