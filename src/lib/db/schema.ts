import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  fingerprint: text('fingerprint').unique(),
  authType: text('auth_type', { enum: ['oauth', 'fingerprint', 'email'] }).notNull(),
  platformRole: text('platform_role', { enum: ['super_admin', 'user'] }).notNull().default('user'),
  status: text('status', { enum: ['active', 'suspended', 'deleted'] }).notNull().default('active'),
  settings: text('settings', { mode: 'json' }).default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  createdIdx: index('users_created_at_idx').on(table.createdAt),
  statusIdx: index('users_status_idx').on(table.status),
}));

export const authAccounts = sqliteTable('auth_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenType: text('token_type'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  providerAccountUnique: unique('auth_accounts_provider_provider_account_id_unique').on(table.provider, table.providerAccountId),
  userIdx: index('auth_accounts_user_id_idx').on(table.userId),
}));

/**
 * Local password credentials are deliberately separated from users and OAuth
 * account metadata. Only a versioned scrypt hash is stored; plaintext
 * passwords never reach the database or user-data exports.
 */
export const passwordCredentials = sqliteTable('password_credentials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  passwordVersion: integer('password_version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userIdx: index('password_credentials_user_id_idx').on(table.userId),
}));

export const resumes = sqliteTable('resumes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull().default('未命名简历'),
  template: text('template').notNull().default('classic'),
  themeConfig: text('theme_config', { mode: 'json' }).default('{}'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  language: text('language').notNull().default('zh'),
  shareToken: text('share_token'),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  sharePassword: text('share_password'),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userIdx: index('resumes_user_id_idx').on(table.userId),
  userUpdatedIdx: index('resumes_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  shareTokenIdx: index('resumes_share_token_idx').on(table.shareToken),
}));

export const resumeSections = sqliteTable('resume_sections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
  content: text('content', { mode: 'json' }).notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  resumeIdx: index('resume_sections_resume_id_idx').on(table.resumeId),
  resumeSortIdx: index('resume_sections_resume_id_sort_order_idx').on(table.resumeId, table.sortOrder),
}));

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('新对话'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  resumeIdx: index('chat_sessions_resume_id_idx').on(table.resumeId),
}));

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }).default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  sessionIdx: index('chat_messages_session_id_idx').on(table.sessionId),
  sessionCreatedIdx: index('chat_messages_session_id_created_at_idx').on(table.sessionId, table.createdAt),
}));

export const resumeShares = sqliteTable('resume_shares', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  label: text('label').notNull().default(''),
  password: text('password'),
  viewCount: integer('view_count').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  resumeIdx: index('resume_shares_resume_id_idx').on(table.resumeId),
}));

export const jdAnalyses = sqliteTable('jd_analyses', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  jobDescription: text('job_description').notNull(),
  result: text('result', { mode: 'json' }).notNull(),
  overallScore: integer('overall_score').notNull(),
  atsScore: integer('ats_score').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  resumeIdx: index('jd_analyses_resume_id_idx').on(table.resumeId),
  resumeCreatedIdx: index('jd_analyses_resume_id_created_at_idx').on(table.resumeId, table.createdAt),
}));

export const grammarChecks = sqliteTable('grammar_checks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  result: text('result', { mode: 'json' }).notNull(),
  score: integer('score').notNull(),
  issueCount: integer('issue_count').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  resumeIdx: index('grammar_checks_resume_id_idx').on(table.resumeId),
  resumeCreatedIdx: index('grammar_checks_resume_id_created_at_idx').on(table.resumeId, table.createdAt),
}));

export {
  interviewSessions,
  interviewRounds,
  interviewMessages,
  interviewReports,
} from './schema-interview';

export {
  organizations,
  organizationMemberships,
  organizationDomains,
  organizationInvites,
  organizationDiscounts,
} from './schema-commercial';

export {
  creditAccounts,
  creditTransactions,
  creditRules,
} from './schema-credits';

export {
  aiProviders,
  aiModels,
} from './schema-ai-providers';

export {
  billingPlans,
  planModelAccess,
  userEntitlements,
  paymentOrders,
  paymentRefunds,
  paymentWebhookEvents,
  reconciliationRuns,
  reconciliationItems,
} from './schema-billing';

export {
  alertEvents,
  alertDeliveries,
} from './schema-observability';

export {
  aiOperations,
  aiProviderAttempts,
  creditHolds,
} from './schema-ai-operations';

export {
  auditEvents,
  legalConsents,
} from './schema-audit';

export {
  emailOtps,
} from './schema-email-otp';

export {
  supportTickets,
} from './schema-support';

export {
  careerProfiles,
  careerAbilities,
  careerEvidence,
  occupations,
  careerCatalogVersions,
  careerCatalogEntries,
  careerColleges,
  careerMajors,
  occupationAliases,
  majorOccupationEdges,
  careerSourceSnapshots,
  occupationRequirements,
  occupationRelations,
  careerKnowledgeDocuments,
  careerGoals,
  careerTasks,
  careerProfileSnapshots,
  careerGuidanceNotes,
  careerMatches,
  educationRoleAssignments,
  teacherStudentAssignments,
  careerAssessmentResults,
  careerCheckIns,
  careerStreakStats,
  jobSubscriptions,
  careerFeatureUnlocks,
  careerReportVersions,
  analysisRuns,
  companies,
  jobPostings,
} from './schema-career';
