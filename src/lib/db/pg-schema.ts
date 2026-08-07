/**
 * PostgreSQL production schema — the authoritative source for production migrations.
 *
 * This file defines all core and interview entities with proper:
 * - Foreign keys with cascade rules
 * - Unique constraints (single and compound)
 * - Secondary indexes for common query patterns
 *
 * Runtime code still imports table objects from schema.ts (SQLite types) for
 * query building; this file is consumed by drizzle-kit for PG migration generation.
 *
 * SQLite remains as a development-only adapter and is NOT the production migration source.
 */
import { pgTable, text, integer, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const epochNow = sql`extract(epoch from now())::integer`;

// ── Core entities ──

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  fingerprint: text('fingerprint').unique(),
  authType: text('auth_type').notNull(),
  settings: text('settings').default('{}'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
});

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull().references(() => users.id),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenType: text('token_type'),
    expiresAt: integer('expires_at'),
    scope: text('scope'),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    providerAccountUnique: unique('auth_accounts_provider_provider_account_id_unique').on(
      table.provider,
      table.providerAccountId,
    ),
    userIdx: index('auth_accounts_user_id_idx').on(table.userId),
  }),
);

export const resumes = pgTable(
  'resumes',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull().references(() => users.id),
    title: text('title').notNull().default('未命名简历'),
    template: text('template').notNull().default('classic'),
    themeConfig: text('theme_config').default('{}'),
    isDefault: integer('is_default').notNull().default(0),
    language: text('language').notNull().default('zh'),
    shareToken: text('share_token'),
    isPublic: integer('is_public').notNull().default(0),
    sharePassword: text('share_password'),
    viewCount: integer('view_count').notNull().default(0),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    userIdx: index('resumes_user_id_idx').on(table.userId),
    shareTokenIdx: index('resumes_share_token_idx').on(table.shareToken),
  }),
);

export const resumeSections = pgTable(
  'resume_sections',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    visible: integer('visible').notNull().default(1),
    content: text('content').notNull().default('{}'),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    resumeIdx: index('resume_sections_resume_id_idx').on(table.resumeId),
    resumeSortIdx: index('resume_sections_resume_id_sort_order_idx').on(table.resumeId, table.sortOrder),
  }),
);

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('新对话'),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    resumeIdx: index('chat_sessions_resume_id_idx').on(table.resumeId),
  }),
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    metadata: text('metadata').default('{}'),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    sessionIdx: index('chat_messages_session_id_idx').on(table.sessionId),
    sessionCreatedIdx: index('chat_messages_session_id_created_at_idx').on(table.sessionId, table.createdAt),
  }),
);

export const resumeShares = pgTable(
  'resume_shares',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    label: text('label').notNull().default(''),
    password: text('password'),
    viewCount: integer('view_count').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    resumeIdx: index('resume_shares_resume_id_idx').on(table.resumeId),
  }),
);

export const jdAnalyses = pgTable(
  'jd_analyses',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
    jobDescription: text('job_description').notNull(),
    result: text('result').notNull(),
    overallScore: integer('overall_score').notNull(),
    atsScore: integer('ats_score').notNull(),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    resumeIdx: index('jd_analyses_resume_id_idx').on(table.resumeId),
  }),
);

export const grammarChecks = pgTable(
  'grammar_checks',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
    result: text('result').notNull(),
    score: integer('score').notNull(),
    issueCount: integer('issue_count').notNull(),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    resumeIdx: index('grammar_checks_resume_id_idx').on(table.resumeId),
  }),
);

// ── Interview simulation tables ──

export const interviewSessions = pgTable(
  'interview_sessions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull().references(() => users.id),
    resumeId: text('resume_id').references(() => resumes.id),
    jobDescription: text('job_description').notNull(),
    jobTitle: text('job_title').notNull().default(''),
    selectedInterviewers: text('selected_interviewers').notNull().default('[]'),
    currentRound: integer('current_round').notNull().default(0),
    status: text('status').notNull().default('preparing'),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    userIdx: index('interview_sessions_user_id_idx').on(table.userId),
    resumeIdx: index('interview_sessions_resume_id_idx').on(table.resumeId),
  }),
);

export const interviewRounds = pgTable(
  'interview_rounds',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text('session_id').notNull().references(() => interviewSessions.id, { onDelete: 'cascade' }),
    interviewerType: text('interviewer_type').notNull(),
    interviewerConfig: text('interviewer_config').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('pending'),
    questionCount: integer('question_count').notNull().default(0),
    maxQuestions: integer('max_questions').notNull().default(10),
    summary: text('summary'),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    sessionIdx: index('interview_rounds_session_id_idx').on(table.sessionId),
  }),
);

export const interviewMessages = pgTable(
  'interview_messages',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    roundId: text('round_id').notNull().references(() => interviewRounds.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    metadata: text('metadata').default('{}'),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    roundIdx: index('interview_messages_round_id_idx').on(table.roundId),
  }),
);

export const interviewReports = pgTable(
  'interview_reports',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text('session_id').notNull().references(() => interviewSessions.id, { onDelete: 'cascade' }).unique(),
    overallScore: integer('overall_score').notNull(),
    dimensionScores: text('dimension_scores').notNull(),
    roundEvaluations: text('round_evaluations').notNull(),
    overallFeedback: text('overall_feedback').notNull(),
    improvementPlan: text('improvement_plan').notNull(),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
);
