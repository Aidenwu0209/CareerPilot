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
import { check, pgTable, text, integer, unique, index } from 'drizzle-orm/pg-core';
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
}, (table) => ({
  createdIdx: index('users_created_at_idx').on(table.createdAt),
  statusIdx: index('users_status_idx').on(table.status),
}));

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

/** Versioned local password credentials. Plaintext passwords are never stored. */
export const passwordCredentials = pgTable(
  'password_credentials',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
    passwordHash: text('password_hash').notNull(),
    passwordVersion: integer('password_version').notNull().default(1),
    createdAt: integer('created_at').notNull().default(epochNow),
    updatedAt: integer('updated_at').notNull().default(epochNow),
  },
  (table) => ({
    userIdx: index('password_credentials_user_id_idx').on(table.userId),
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
    userUpdatedIdx: index('resumes_user_id_updated_at_idx').on(table.userId, table.updatedAt),
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
    resumeCreatedIdx: index('jd_analyses_resume_id_created_at_idx').on(table.resumeId, table.createdAt),
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
    resumeCreatedIdx: index('grammar_checks_resume_id_created_at_idx').on(table.resumeId, table.createdAt),
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
    userStatusIdx: index('interview_sessions_user_id_status_idx').on(table.userId, table.status),
    userCreatedIdx: index('interview_sessions_user_id_created_at_idx').on(table.userId, table.createdAt),
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
    roundCreatedIdx: index('interview_messages_round_id_created_at_idx').on(table.roundId, table.createdAt),
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
    family: text('family').notNull().default('other'),
    capabilities: text('capabilities').notNull().default('[]'),
    tier: text('tier').notNull().default('standard'),
    deliveryResolution: text('delivery_resolution').notNull().default('native'),
    upscalerUrl: text('upscaler_url'),
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
    familyIdx: index('ai_models_family_idx').on(table.family),
  }),
);

// ── ToC billing, subscriptions, refunds, and reconciliation ──

export const billingPlans = pgTable('billing_plans', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  kind: text('kind').notNull(),
  userLevel: text('user_level').notNull().default('free'),
  priceMinor: integer('price_minor').notNull(),
  currency: text('currency').notNull().default('cny'),
  credits: integer('credits').notNull(),
  billingInterval: text('billing_interval'),
  stripePriceId: text('stripe_price_id').unique(),
  active: integer('active').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  kindActiveIdx: index('billing_plans_kind_active_idx').on(table.kind, table.active),
  levelIdx: index('billing_plans_user_level_idx').on(table.userLevel),
}));

export const planModelAccess = pgTable('plan_model_access', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  planId: text('plan_id').notNull().references(() => billingPlans.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => aiModels.id, { onDelete: 'cascade' }),
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  planModelUnique: unique('plan_model_access_plan_id_model_id_unique').on(table.planId, table.modelId),
  planIdx: index('plan_model_access_plan_id_idx').on(table.planId),
  modelIdx: index('plan_model_access_model_id_idx').on(table.modelId),
}));

export const userEntitlements = pgTable('user_entitlements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId: text('plan_id').notNull().references(() => billingPlans.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('active'),
  provider: text('provider').notNull().default('stripe'),
  externalCustomerId: text('external_customer_id'),
  externalSubscriptionId: text('external_subscription_id').unique(),
  currentPeriodStart: integer('current_period_start'),
  currentPeriodEnd: integer('current_period_end'),
  cancelAtPeriodEnd: integer('cancel_at_period_end').notNull().default(0),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  userStatusIdx: index('user_entitlements_user_id_status_idx').on(table.userId, table.status),
  periodEndIdx: index('user_entitlements_period_end_idx').on(table.currentPeriodEnd),
}));

export const paymentOrders = pgTable('payment_orders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  accountId: text('account_id').notNull().references(() => creditAccounts.id, { onDelete: 'restrict' }),
  planId: text('plan_id').notNull().references(() => billingPlans.id, { onDelete: 'restrict' }),
  provider: text('provider').notNull().default('stripe'),
  providerOrderId: text('provider_order_id').unique(),
  providerPaymentId: text('provider_payment_id'),
  providerCustomerId: text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id'),
  status: text('status').notNull().default('pending'),
  amountMinor: integer('amount_minor').notNull(),
  paidMinor: integer('paid_minor').notNull().default(0),
  refundedMinor: integer('refunded_minor').notNull().default(0),
  currency: text('currency').notNull(),
  credits: integer('credits').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  metadata: text('metadata').notNull().default('{}'),
  paidAt: integer('paid_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  userCreatedIdx: index('payment_orders_user_id_created_at_idx').on(table.userId, table.createdAt),
  statusIdx: index('payment_orders_status_idx').on(table.status),
  providerPaymentIdx: index('payment_orders_provider_payment_id_idx').on(table.providerPaymentId),
  providerSubscriptionIdx: index('payment_orders_provider_subscription_id_idx').on(table.providerSubscriptionId),
}));

export const paymentRefunds = pgTable('payment_refunds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text('order_id').notNull().references(() => paymentOrders.id, { onDelete: 'restrict' }),
  providerRefundId: text('provider_refund_id').unique(),
  status: text('status').notNull().default('pending'),
  amountMinor: integer('amount_minor').notNull(),
  creditsReversed: integer('credits_reversed').notNull(),
  reason: text('reason').notNull().default('customer_request'),
  requestedBy: text('requested_by').references(() => users.id),
  failureReason: text('failure_reason'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  orderIdx: index('payment_refunds_order_id_idx').on(table.orderId),
  statusIdx: index('payment_refunds_status_idx').on(table.status),
}));

export const paymentWebhookEvents = pgTable('payment_webhook_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  status: text('status').notNull().default('processing'),
  payloadHash: text('payload_hash').notNull(),
  errorMessage: text('error_message'),
  processedAt: integer('processed_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  providerEventUnique: unique('payment_webhook_events_provider_event_id_unique').on(table.provider, table.eventId),
  statusCreatedIdx: index('payment_webhook_events_status_created_at_idx').on(table.status, table.createdAt),
}));

export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('running'),
  checkedCount: integer('checked_count').notNull().default(0),
  mismatchCount: integer('mismatch_count').notNull().default(0),
  startedBy: text('started_by'),
  summary: text('summary').notNull().default('{}'),
  startedAt: integer('started_at').notNull().default(epochNow),
  completedAt: integer('completed_at'),
}, (table) => ({
  providerStartedIdx: index('reconciliation_runs_provider_started_at_idx').on(table.provider, table.startedAt),
}));

export const reconciliationItems = pgTable('reconciliation_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').notNull().references(() => reconciliationRuns.id, { onDelete: 'cascade' }),
  orderId: text('order_id').references(() => paymentOrders.id, { onDelete: 'set null' }),
  issue: text('issue').notNull(),
  localValue: text('local_value'),
  providerValue: text('provider_value'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  runIdx: index('reconciliation_items_run_id_idx').on(table.runId),
  orderIdx: index('reconciliation_items_order_id_idx').on(table.orderId),
}));

// ── APM alert state and delivery audit ──

export const alertEvents = pgTable('alert_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fingerprint: text('fingerprint').notNull().unique(),
  source: text('source').notNull(),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('open'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  lastDeliveryStatus: text('last_delivery_status'),
  lastDeliveredAt: integer('last_delivered_at'),
  firstSeenAt: integer('first_seen_at').notNull().default(epochNow),
  lastSeenAt: integer('last_seen_at').notNull().default(epochNow),
  resolvedAt: integer('resolved_at'),
}, (table) => ({
  statusSeverityIdx: index('alert_events_status_severity_idx').on(table.status, table.severity),
  lastSeenIdx: index('alert_events_last_seen_at_idx').on(table.lastSeenAt),
}));

export const alertDeliveries = pgTable('alert_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  alertEventId: text('alert_event_id').notNull().references(() => alertEvents.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  destination: text('destination').notNull(),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  eventIdx: index('alert_deliveries_alert_event_id_idx').on(table.alertEventId),
  channelCreatedIdx: index('alert_deliveries_channel_created_at_idx').on(table.channel, table.createdAt),
}));

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

// ── Career development, occupation graph, and cited knowledge ──

export const careerProfiles = pgTable('career_profiles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  headline: text('headline').notNull().default(''),
  summary: text('summary').notNull().default(''),
  stage: text('stage').notNull().default('exploring'),
  completeness: integer('completeness').notNull().default(0),
  evidenceCoverage: integer('evidence_coverage').notNull().default(0),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  userIdx: index('career_profiles_user_id_idx').on(table.userId),
  stageIdx: index('career_profiles_stage_idx').on(table.stage),
}));

export const careerAbilities = pgTable('career_abilities', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  dimension: text('dimension').notNull(),
  score: integer('score'),
  confidence: integer('confidence'),
  evidenceCount: integer('evidence_count').notNull().default(0),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  userCodeUnique: unique('career_abilities_user_id_code_unique').on(table.userId, table.code),
  userIdx: index('career_abilities_user_id_idx').on(table.userId),
  userDimensionIdx: index('career_abilities_user_id_dimension_idx').on(table.userId, table.dimension),
}));

export const careerEvidence = pgTable('career_evidence', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  abilityCode: text('ability_code').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull().default(''),
  sourceUrl: text('source_url'),
  status: text('status').notNull().default('pending'),
  assessedScore: integer('assessed_score'),
  reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewReason: text('review_reason').notNull().default(''),
  reviewedAt: integer('reviewed_at'),
  occurredAt: integer('occurred_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  sourceAbilityUnique: unique('career_evidence_source_type_source_id_ability_code_unique').on(table.sourceType, table.sourceId, table.abilityCode),
  userIdx: index('career_evidence_user_id_idx').on(table.userId),
  userAbilityIdx: index('career_evidence_user_id_ability_code_idx').on(table.userId, table.abilityCode),
  statusIdx: index('career_evidence_status_idx').on(table.status),
  assessedScoreCheck: check('career_evidence_assessed_score_check', sql`${table.assessedScore} is null or (${table.assessedScore} between 0 and 100)`),
}));

export const occupations = pgTable('occupations', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  canonicalType: text('canonical_type').notNull().default('national_occupation'),
  jobFamily: text('job_family').notNull().default(''),
  industry: text('industry').notNull().default(''),
  cities: text('cities').notNull().default('[]'),
  educationLevels: text('education_levels').notNull().default('[]'),
  summary: text('summary').notNull(),
  description: text('description').notNull(),
  entryLevel: text('entry_level').notNull(),
  catalogVersion: text('catalog_version'),
  reviewStatus: text('review_status').notNull().default('reviewed'),
  scoringEligible: integer('scoring_eligible').notNull().default(1),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  categoryIdx: index('occupations_category_idx').on(table.category),
  activeIdx: index('occupations_active_idx').on(table.active),
  catalogIdx: index('occupations_catalog_version_idx').on(table.catalogVersion),
  familyIdx: index('occupations_job_family_idx').on(table.jobFamily),
  industryIdx: index('occupations_industry_idx').on(table.industry),
}));

export const careerCatalogVersions = pgTable('career_catalog_versions', {
  id: text('id').primaryKey(),
  version: text('version').notNull().unique(),
  schemaVersion: text('schema_version').notNull(),
  status: text('status').notNull().default('staged'),
  manifestHash: text('manifest_hash').notNull(),
  sourceDirectory: text('source_directory').notNull().default(''),
  metadata: text('metadata').notNull().default('{}'),
  activatedAt: integer('activated_at'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  statusIdx: index('career_catalog_versions_status_idx').on(table.status),
  createdIdx: index('career_catalog_versions_created_at_idx').on(table.createdAt),
}));

export const careerCatalogEntries = pgTable('career_catalog_entries', {
  id: text('id').primaryKey(),
  catalogVersionId: text('catalog_version_id').notNull().references(() => careerCatalogVersions.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  externalId: text('external_id').notNull(),
  payload: text('payload').notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  versionEntityUnique: unique('career_catalog_entries_version_entity_external_unique').on(table.catalogVersionId, table.entityType, table.externalId),
  versionTypeIdx: index('career_catalog_entries_version_type_idx').on(table.catalogVersionId, table.entityType),
}));

export const careerColleges = pgTable('career_colleges', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  sourceIds: text('source_ids').notNull().default('[]'),
  reviewStatus: text('review_status').notNull().default('pending'),
  active: integer('active').notNull().default(1),
}, (table) => ({
  versionCodeUnique: unique('career_colleges_catalog_version_code_unique').on(table.catalogVersion, table.code),
  codeIdx: index('career_colleges_code_idx').on(table.code),
}));

export const careerMajors = pgTable('career_majors', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  code: text('code').notNull(),
  collegeCode: text('college_code').notNull(),
  name: text('name').notNull(),
  degreeLevel: text('degree_level').notNull().default(''),
  currentlyRecruiting: integer('currently_recruiting').notNull().default(1),
  admissionYear: integer('admission_year'),
  sourceIds: text('source_ids').notNull().default('[]'),
  sourceExcerpt: text('source_excerpt').notNull().default(''),
  employmentText: text('employment_text').notNull().default(''),
  reviewStatus: text('review_status').notNull().default('pending'),
  active: integer('active').notNull().default(1),
}, (table) => ({
  versionCodeUnique: unique('career_majors_catalog_version_code_unique').on(table.catalogVersion, table.code),
  collegeIdx: index('career_majors_college_code_idx').on(table.collegeCode),
  nameIdx: index('career_majors_name_idx').on(table.name),
}));

export const occupationAliases = pgTable('occupation_aliases', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code),
  alias: text('alias').notNull(),
  sourceIds: text('source_ids').notNull().default('[]'),
  reviewStatus: text('review_status').notNull().default('pending'),
  active: integer('active').notNull().default(1),
}, (table) => ({
  versionOccupationAliasUnique: unique('occupation_aliases_version_occupation_alias_unique').on(table.catalogVersion, table.occupationCode, table.alias),
  aliasIdx: index('occupation_aliases_alias_idx').on(table.alias),
  occupationIdx: index('occupation_aliases_occupation_code_idx').on(table.occupationCode),
}));

export const majorOccupationEdges = pgTable('major_occupation_edges', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  majorCode: text('major_code').notNull(),
  occupationCode: text('occupation_code').references(() => occupations.code),
  proposedTitle: text('proposed_title'),
  relationType: text('relation_type').notNull(),
  sourceIds: text('source_ids').notNull().default('[]'),
  evidenceExcerpt: text('evidence_excerpt').notNull().default(''),
  reviewRequired: integer('review_required').notNull().default(0),
  reviewReason: text('review_reason').notNull().default(''),
  active: integer('active').notNull().default(1),
}, (table) => ({
  versionMajorOccupationUnique: unique('major_occupation_edges_version_major_occupation_relation_unique').on(table.catalogVersion, table.majorCode, table.occupationCode, table.relationType),
  majorIdx: index('major_occupation_edges_major_code_idx').on(table.majorCode),
  occupationIdx: index('major_occupation_edges_occupation_code_idx').on(table.occupationCode),
}));

export const careerSourceSnapshots = pgTable('career_source_snapshots', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  sourceId: text('source_id').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  publisher: text('publisher').notNull().default(''),
  sourceType: text('source_type').notNull().default(''),
  publishedAt: integer('published_at'),
  fetchedAt: integer('fetched_at'),
  contentHash: text('content_hash').notNull(),
  httpStatus: integer('http_status'),
  robotsStatus: text('robots_status').notNull().default('unknown'),
  licenseNotes: text('license_notes').notNull().default(''),
}, (table) => ({
  versionSourceUnique: unique('career_source_snapshots_version_source_unique').on(table.catalogVersion, table.sourceId),
  hashIdx: index('career_source_snapshots_content_hash_idx').on(table.contentHash),
}));

export const occupationRequirements = pgTable('occupation_requirements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  abilityCode: text('ability_code').notNull(),
  abilityName: text('ability_name').notNull(),
  dimension: text('dimension').notNull(),
  targetScore: integer('target_score').notNull(),
  weight: integer('weight').notNull().default(1),
  required: integer('required').notNull().default(1),
  description: text('description').notNull().default(''),
  educationLevel: text('education_level').notNull().default(''),
  experienceLevel: text('experience_level').notNull().default(''),
  region: text('region').notNull().default(''),
  sourceIds: text('source_ids').notNull().default('[]'),
  reviewStatus: text('review_status').notNull().default('reviewed'),
  catalogVersion: text('catalog_version'),
}, (table) => ({
  occupationAbilityUnique: unique('occupation_requirements_occupation_code_ability_code_unique').on(table.occupationCode, table.abilityCode),
  occupationIdx: index('occupation_requirements_occupation_code_idx').on(table.occupationCode),
  abilityIdx: index('occupation_requirements_ability_code_idx').on(table.abilityCode),
}));

export const occupationRelations = pgTable('occupation_relations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fromCode: text('from_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  toCode: text('to_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  relationType: text('relation_type').notNull(),
  description: text('description').notNull().default(''),
}, (table) => ({
  relationUnique: unique('occupation_relations_from_code_to_code_relation_type_unique').on(table.fromCode, table.toCode, table.relationType),
  fromIdx: index('occupation_relations_from_code_idx').on(table.fromCode),
  toIdx: index('occupation_relations_to_code_idx').on(table.toCode),
}));

export const careerKnowledgeDocuments = pgTable('career_knowledge_documents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  occupationCode: text('occupation_code').references(() => occupations.code, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  sourceLabel: text('source_label').notNull(),
  sourceUrl: text('source_url').notNull(),
  publishedAt: integer('published_at'),
  verifiedAt: integer('verified_at').notNull().default(epochNow),
  metadata: text('metadata').notNull().default('{}'),
  catalogVersion: text('catalog_version'),
  contentHash: text('content_hash').notNull().default(''),
}, (table) => ({
  occupationIdx: index('career_knowledge_documents_occupation_code_idx').on(table.occupationCode),
  sourceIdx: index('career_knowledge_documents_source_label_idx').on(table.sourceLabel),
}));

export const careerGoals = pgTable('career_goals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code),
  isPrimary: integer('is_primary').notNull().default(0),
  status: text('status').notNull().default('active'),
  targetDate: integer('target_date'),
  rationale: text('rationale').notNull().default(''),
  preferences: text('preferences').notNull().default('{}'),
  teacherConfirmationStatus: text('teacher_confirmation_status').notNull().default('unreviewed'),
  confirmedBy: text('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  userIdx: index('career_goals_user_id_idx').on(table.userId),
  userStatusIdx: index('career_goals_user_id_status_idx').on(table.userId, table.status),
  occupationIdx: index('career_goals_occupation_code_idx').on(table.occupationCode),
}));

export const careerTasks = pgTable('career_tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => careerGoals.id, { onDelete: 'set null' }),
  occupationCode: text('occupation_code').references(() => occupations.code, { onDelete: 'set null' }),
  abilityCode: text('ability_code'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  reason: text('reason').notNull().default(''),
  completionCriteria: text('completion_criteria').notNull().default(''),
  category: text('category').notNull().default('learn'),
  status: text('status').notNull().default('todo'),
  dueAt: integer('due_at'),
  completedAt: integer('completed_at'),
  assignedBy: text('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  userIdx: index('career_tasks_user_id_idx').on(table.userId),
  userStatusIdx: index('career_tasks_user_id_status_idx').on(table.userId, table.status),
  goalIdx: index('career_tasks_goal_id_idx').on(table.goalId),
  dueIdx: index('career_tasks_due_at_idx').on(table.dueAt),
}));

export const careerProfileSnapshots = pgTable('career_profile_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  abilities: text('abilities').notNull(),
  trigger: text('trigger').notNull().default('manual'),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  userVersionUnique: unique('career_profile_snapshots_user_id_version_unique').on(table.userId, table.version),
  userCreatedIdx: index('career_profile_snapshots_user_id_created_at_idx').on(table.userId, table.createdAt),
}));

export const careerGuidanceNotes = pgTable('career_guidance_notes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  teacherId: text('teacher_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  visibility: text('visibility').notNull().default('student'),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  userCreatedIdx: index('career_guidance_notes_user_id_created_at_idx').on(table.userId, table.createdAt),
  teacherIdx: index('career_guidance_notes_teacher_id_idx').on(table.teacherId),
}));

export const careerMatches = pgTable('career_matches', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => careerGoals.id, { onDelete: 'set null' }),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  score: integer('score'),
  evidenceCoverage: integer('evidence_coverage').notNull().default(0),
  knownWeight: integer('known_weight').notNull().default(0),
  totalWeight: integer('total_weight').notNull().default(0),
  breakdown: text('breakdown').notNull().default('[]'),
  citations: text('citations').notNull().default('[]'),
  algorithmVersion: text('algorithm_version').notNull().default('career-match-v1'),
  catalogVersion: text('catalog_version'),
  confidence: integer('confidence'),
  knownCoverage: integer('known_coverage').notNull().default(0),
  createdAt: integer('created_at').notNull().default(epochNow),
}, (table) => ({
  userOccupationIdx: index('career_matches_user_id_occupation_code_idx').on(table.userId, table.occupationCode),
  userCreatedIdx: index('career_matches_user_id_created_at_idx').on(table.userId, table.createdAt),
}));

export const educationRoleAssignments = pgTable('education_role_assignments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  orgUserRoleUnique: unique('education_role_assignments_organization_id_user_id_role_unique').on(table.organizationId, table.userId, table.role),
  orgRoleIdx: index('education_role_assignments_organization_id_role_idx').on(table.organizationId, table.role),
  userStatusIdx: index('education_role_assignments_user_id_status_idx').on(table.userId, table.status),
}));

export const teacherStudentAssignments = pgTable('teacher_student_assignments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  teacherUserId: text('teacher_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  studentUserId: text('student_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  accessLevel: text('access_level').notNull().default('guide'),
  createdAt: integer('created_at').notNull().default(epochNow),
  updatedAt: integer('updated_at').notNull().default(epochNow),
}, (table) => ({
  orgTeacherStudentUnique: unique('teacher_student_assignments_org_teacher_student_unique').on(table.organizationId, table.teacherUserId, table.studentUserId),
  teacherStatusIdx: index('teacher_student_assignments_teacher_user_id_status_idx').on(table.teacherUserId, table.status),
  studentStatusIdx: index('teacher_student_assignments_student_user_id_status_idx').on(table.studentUserId, table.status),
  orgStatusIdx: index('teacher_student_assignments_organization_id_status_idx').on(table.organizationId, table.status),
}));
