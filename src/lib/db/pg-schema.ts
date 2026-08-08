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
  platformRole: text('platform_role').notNull().default('user'),
  status: text('status').notNull().default('active'),
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

// ── Commercial entities (ToB organizations and memberships) ──

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    seatLimit: integer('seat_limit').notNull().default(0),
    branding: text('branding').notNull().default('{}'),
    createdBy: text('created_by').notNull().references(() => users.id),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    createdByIdx: index('organizations_created_by_idx').on(table.createdBy),
    statusIdx: index('organizations_status_idx').on(table.status),
  }),
);

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    orgUserUnique: unique('organization_memberships_organization_id_user_id_unique').on(
      table.organizationId,
      table.userId,
    ),
    userIdx: index('organization_memberships_user_id_idx').on(table.userId),
    orgIdx: index('organization_memberships_organization_id_idx').on(table.organizationId),
    orgStatusIdx: index('organization_memberships_organization_id_status_idx').on(table.organizationId, table.status),
    userStatusIdx: index('organization_memberships_user_id_status_idx').on(table.userId, table.status),
    roleIdx: index('organization_memberships_role_idx').on(table.role),
  }),
);

// ── Credits: accounts, transactions (immutable ledger), and rules ──

export const creditAccounts = pgTable(
  'credit_accounts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    balance: integer('balance').notNull().default(0),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    ownerUnique: unique('credit_accounts_owner_type_owner_id_unique').on(table.ownerType, table.ownerId),
    ownerTypeIdx: index('credit_accounts_owner_type_idx').on(table.ownerType),
    ownerStatusIdx: index('credit_accounts_owner_type_status_idx').on(table.ownerType, table.status),
  }),
);

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id').notNull().references(() => creditAccounts.id, { onDelete: 'restrict' }),
    balanceBefore: integer('balance_before').notNull(),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: text('reason').notNull(),
    operatorId: text('operator_id'),
    businessRefId: text('business_ref_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    ruleSnapshot: text('rule_snapshot').default('{}'),
    note: text('note').notNull().default(''),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    accountIdempotencyUnique: unique('credit_transactions_account_id_idempotency_key_unique').on(
      table.accountId,
      table.idempotencyKey,
    ),
    accountIdx: index('credit_transactions_account_id_idx').on(table.accountId),
    accountCreatedIdx: index('credit_transactions_account_id_created_at_idx').on(table.accountId, table.createdAt),
    reasonIdx: index('credit_transactions_reason_idx').on(table.reason),
    businessRefIdx: index('credit_transactions_business_ref_id_idx').on(table.businessRefId),
  }),
);

export const creditRules = pgTable(
  'credit_rules',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    ruleType: text('rule_type').notNull(),
    value: integer('value').notNull().default(0),
    version: integer('version').notNull().default(1),
    active: integer('active').notNull().default(1),
    createdBy: text('created_by').references(() => users.id),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    ruleTypeActiveIdx: index('credit_rules_rule_type_active_idx').on(table.ruleType, table.active),
    ruleTypeVersionIdx: index('credit_rules_rule_type_version_idx').on(table.ruleType, table.version),
  }),
);

// ── AI providers and model catalog ──

export const aiProviders = pgTable(
  'ai_providers',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    type: text('type').notNull(),
    name: text('name').notNull(),
    baseUrl: text('base_url'),
    status: text('status').notNull().default('active'),
    encryptedCredentials: text('encrypted_credentials'),
    credentialVersion: integer('credential_version').notNull().default(1),
    lastValidatedAt: integer('last_validated_at'),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    typeIdx: index('ai_providers_type_idx').on(table.type),
    statusIdx: index('ai_providers_status_idx').on(table.status),
  }),
);

export const aiModels = pgTable(
  'ai_models',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    providerId: text('provider_id').notNull().references(() => aiProviders.id, { onDelete: 'cascade' }),
    modelIdentifier: text('model_identifier').notNull(),
    displayName: text('display_name').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    tier: text('tier').notNull().default('standard'),
    status: text('status').notNull().default('active'),
    visibility: text('visibility').notNull().default('public'),
    inputTokenLimit: integer('input_token_limit'),
    outputTokenLimit: integer('output_token_limit'),
    maxSteps: integer('max_steps'),
    fixedPrice: integer('fixed_price').default(0),
    tokenPriceInput: integer('token_price_input').default(0),
    tokenPriceOutput: integer('token_price_output').default(0),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    providerModelUnique: unique('ai_models_provider_id_model_identifier_unique').on(
      table.providerId,
      table.modelIdentifier,
    ),
    providerIdx: index('ai_models_provider_id_idx').on(table.providerId),
    statusIdx: index('ai_models_status_idx').on(table.status),
    tierIdx: index('ai_models_tier_idx').on(table.tier),
  }),
);

// ── AI operations, provider attempts, and credit holds ──

export const aiOperations = pgTable(
  'ai_operations',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    actorId: text('actor_id').notNull().references(() => users.id),
    billingAccountId: text('billing_account_id').notNull().references(() => creditAccounts.id),
    capability: text('capability').notNull(),
    status: text('status').notNull().default('pending'),
    idempotencyKey: text('idempotency_key').notNull(),
    finalSettlementId: text('final_settlement_id'),
    metadata: text('metadata').default('{}'),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    idempotencyUnique: unique('ai_operations_idempotency_key_unique').on(table.idempotencyKey),
    actorIdx: index('ai_operations_actor_id_idx').on(table.actorId),
    billingAccountIdx: index('ai_operations_billing_account_id_idx').on(table.billingAccountId),
    capabilityIdx: index('ai_operations_capability_idx').on(table.capability),
    statusIdx: index('ai_operations_status_idx').on(table.status),
    actorCapabilityIdx: index('ai_operations_actor_id_capability_idx').on(table.actorId, table.capability),
    createdIdx: index('ai_operations_created_at_idx').on(table.createdAt),
  }),
);

export const aiProviderAttempts = pgTable(
  'ai_provider_attempts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    operationId: text('operation_id').notNull().references(() => aiOperations.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull().references(() => aiModels.id),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').notNull().default('pending'),
    usage: text('usage').default('{}'),
    providerRequestId: text('provider_request_id'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    createdAt: integer('created_at').notNull().default(epochNow),
    completedAt: integer('completed_at'),
  },
  (table) => ({
    operationAttemptUnique: unique('ai_provider_attempts_operation_id_attempt_number_unique').on(
      table.operationId,
      table.attemptNumber,
    ),
    operationIdx: index('ai_provider_attempts_operation_id_idx').on(table.operationId),
    modelIdx: index('ai_provider_attempts_model_id_idx').on(table.modelId),
    statusIdx: index('ai_provider_attempts_status_idx').on(table.status),
  }),
);

export const creditHolds = pgTable(
  'credit_holds',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id').notNull().references(() => creditAccounts.id, { onDelete: 'restrict' }),
    operationId: text('operation_id').notNull().references(() => aiOperations.id, { onDelete: 'cascade' }),
    holdAmount: integer('hold_amount').notNull(),
    settledAmount: integer('settled_amount').notNull().default(0),
    status: text('status').notNull().default('active'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull().default(epochNow),
    settledAt: integer('settled_at'),
  },
  (table) => ({
    accountIdx: index('credit_holds_account_id_idx').on(table.accountId),
    operationIdx: index('credit_holds_operation_id_idx').on(table.operationId),
    statusIdx: index('credit_holds_status_idx').on(table.status),
    expiresIdx: index('credit_holds_expires_at_idx').on(table.expiresAt),
    accountStatusIdx: index('credit_holds_account_id_status_idx').on(table.accountId, table.status),
  }),
);

// ── Audit events and legal consent history (both immutable) ──

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    actorId: text('actor_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    tenantId: text('tenant_id'),
    requestId: text('request_id'),
    result: text('result').notNull().default('success'),
    summary: text('summary').notNull().default(''),
    ipAddress: text('ip_address'),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    actorIdx: index('audit_events_actor_id_idx').on(table.actorId),
    actionIdx: index('audit_events_action_idx').on(table.action),
    targetIdx: index('audit_events_target_type_target_id_idx').on(table.targetType, table.targetId),
    tenantIdx: index('audit_events_tenant_id_idx').on(table.tenantId),
    createdIdx: index('audit_events_created_at_idx').on(table.createdAt),
    actorCreatedIdx: index('audit_events_actor_id_created_at_idx').on(table.actorId, table.createdAt),
    tenantCreatedIdx: index('audit_events_tenant_id_created_at_idx').on(table.tenantId, table.createdAt),
  }),
);

export const legalConsents = pgTable(
  'legal_consents',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull().references(() => users.id),
    documentType: text('document_type').notNull(),
    version: text('version').notNull(),
    effectiveDate: integer('effective_date').notNull(),
    source: text('source').notNull(),
    ipAddress: text('ip_address'),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    userIdx: index('legal_consents_user_id_idx').on(table.userId),
    userDocIdx: index('legal_consents_user_id_document_type_idx').on(table.userId, table.documentType),
    docVersionIdx: index('legal_consents_document_type_version_idx').on(table.documentType, table.version),
    createdIdx: index('legal_consents_created_at_idx').on(table.createdAt),
  }),
);

// ── Email OTP (one-time password) storage ──

export const emailOtps = pgTable(
  'email_otps',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    ipAddress: text('ip_address'),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: integer('created_at').notNull().default(epochNow),
  },
  (table) => ({
    emailIdx: index('email_otps_email_idx').on(table.email),
    emailUsedIdx: index('email_otps_email_used_at_idx').on(table.email, table.usedAt),
    ipIdx: index('email_otps_ip_address_idx').on(table.ipAddress),
  }),
);
