import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { organizations, users } from './schema';

const now = sql`(unixepoch())`;
// Kept local to avoid extending the existing schema module cycle at runtime.
// matching-config.test.ts guards this database enum against the canonical JSON dimensions.
export const CAREER_DIMENSION_ENUM = [
  'domain_knowledge',
  'professional_skills',
  'project_practice',
  'general_competencies',
  'job_readiness',
  'growth_potential',
] as const;

export const careerProfiles = sqliteTable('career_profiles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  headline: text('headline').notNull().default(''),
  summary: text('summary').notNull().default(''),
  stage: text('stage', { enum: ['exploring', 'targeting', 'preparing', 'applying'] }).notNull().default('exploring'),
  completeness: integer('completeness').notNull().default(0),
  evidenceCoverage: integer('evidence_coverage').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userIdx: index('career_profiles_user_id_idx').on(table.userId),
  stageIdx: index('career_profiles_stage_idx').on(table.stage),
}));

export const careerAbilities = sqliteTable('career_abilities', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  dimension: text('dimension', { enum: CAREER_DIMENSION_ENUM }).notNull(),
  score: integer('score'),
  confidence: integer('confidence'),
  evidenceCount: integer('evidence_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userCodeUnique: unique('career_abilities_user_id_code_unique').on(table.userId, table.code),
  userIdx: index('career_abilities_user_id_idx').on(table.userId),
  userDimensionIdx: index('career_abilities_user_id_dimension_idx').on(table.userId, table.dimension),
}));

export const careerEvidence = sqliteTable('career_evidence', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  abilityCode: text('ability_code').notNull(),
  sourceType: text('source_type', { enum: ['resume', 'project', 'interview', 'certificate', 'course', 'teacher', 'task', 'manual'] }).notNull(),
  sourceId: text('source_id'),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull().default(''),
  sourceUrl: text('source_url'),
  status: text('status', { enum: ['pending', 'verified', 'rejected'] }).notNull().default('pending'),
  assessedScore: integer('assessed_score'),
  reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewReason: text('review_reason').notNull().default(''),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  sourceAbilityUnique: unique('career_evidence_source_type_source_id_ability_code_unique').on(table.sourceType, table.sourceId, table.abilityCode),
  userIdx: index('career_evidence_user_id_idx').on(table.userId),
  userAbilityIdx: index('career_evidence_user_id_ability_code_idx').on(table.userId, table.abilityCode),
  statusIdx: index('career_evidence_status_idx').on(table.status),
  assessedScoreCheck: check('career_evidence_assessed_score_check', sql`${table.assessedScore} is null or (${table.assessedScore} between 0 and 100)`),
}));

export const occupations = sqliteTable('occupations', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  canonicalType: text('canonical_type', { enum: ['china_national_occupation', 'national_occupation', 'standard_occupation', 'market_alias', 'unresolved_placeholder'] }).notNull().default('national_occupation'),
  jobFamily: text('job_family').notNull().default(''),
  industry: text('industry').notNull().default(''),
  cities: text('cities', { mode: 'json' }).notNull().default('[]'),
  educationLevels: text('education_levels', { mode: 'json' }).notNull().default('[]'),
  summary: text('summary').notNull(),
  description: text('description').notNull(),
  entryLevel: text('entry_level').notNull(),
  catalogVersion: text('catalog_version'),
  reviewStatus: text('review_status').notNull().default('reviewed'),
  scoringEligible: integer('scoring_eligible', { mode: 'boolean' }).notNull().default(true),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  categoryIdx: index('occupations_category_idx').on(table.category),
  activeIdx: index('occupations_active_idx').on(table.active),
  catalogIdx: index('occupations_catalog_version_idx').on(table.catalogVersion),
  familyIdx: index('occupations_job_family_idx').on(table.jobFamily),
  industryIdx: index('occupations_industry_idx').on(table.industry),
}));

export const careerCatalogVersions = sqliteTable('career_catalog_versions', {
  id: text('id').primaryKey(),
  version: text('version').notNull().unique(),
  schemaVersion: text('schema_version').notNull(),
  status: text('status', { enum: ['staged', 'active', 'archived', 'failed'] }).notNull().default('staged'),
  manifestHash: text('manifest_hash').notNull(),
  sourceDirectory: text('source_directory').notNull().default(''),
  metadata: text('metadata', { mode: 'json' }).notNull().default('{}'),
  activatedAt: integer('activated_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  statusIdx: index('career_catalog_versions_status_idx').on(table.status),
  createdIdx: index('career_catalog_versions_created_at_idx').on(table.createdAt),
}));

export const careerCatalogEntries = sqliteTable('career_catalog_entries', {
  id: text('id').primaryKey(),
  catalogVersionId: text('catalog_version_id').notNull().references(() => careerCatalogVersions.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  externalId: text('external_id').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  versionEntityUnique: unique('career_catalog_entries_version_entity_external_unique').on(table.catalogVersionId, table.entityType, table.externalId),
  versionTypeIdx: index('career_catalog_entries_version_type_idx').on(table.catalogVersionId, table.entityType),
}));

export const careerColleges = sqliteTable('career_colleges', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  sourceIds: text('source_ids', { mode: 'json' }).notNull().default('[]'),
  reviewStatus: text('review_status').notNull().default('pending'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (table) => ({
  versionCodeUnique: unique('career_colleges_catalog_version_code_unique').on(table.catalogVersion, table.code),
  codeIdx: index('career_colleges_code_idx').on(table.code),
}));

export const careerMajors = sqliteTable('career_majors', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  code: text('code').notNull(),
  collegeCode: text('college_code').notNull(),
  name: text('name').notNull(),
  degreeLevel: text('degree_level').notNull().default(''),
  currentlyRecruiting: integer('currently_recruiting', { mode: 'boolean' }).notNull().default(true),
  admissionYear: integer('admission_year'),
  sourceIds: text('source_ids', { mode: 'json' }).notNull().default('[]'),
  sourceExcerpt: text('source_excerpt').notNull().default(''),
  employmentText: text('employment_text').notNull().default(''),
  reviewStatus: text('review_status').notNull().default('pending'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (table) => ({
  versionCodeUnique: unique('career_majors_catalog_version_code_unique').on(table.catalogVersion, table.code),
  collegeIdx: index('career_majors_college_code_idx').on(table.collegeCode),
  nameIdx: index('career_majors_name_idx').on(table.name),
}));

export const occupationAliases = sqliteTable('occupation_aliases', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code),
  alias: text('alias').notNull(),
  sourceIds: text('source_ids', { mode: 'json' }).notNull().default('[]'),
  reviewStatus: text('review_status').notNull().default('pending'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (table) => ({
  versionOccupationAliasUnique: unique('occupation_aliases_version_occupation_alias_unique').on(table.catalogVersion, table.occupationCode, table.alias),
  aliasIdx: index('occupation_aliases_alias_idx').on(table.alias),
  occupationIdx: index('occupation_aliases_occupation_code_idx').on(table.occupationCode),
}));

export const majorOccupationEdges = sqliteTable('major_occupation_edges', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  majorCode: text('major_code').notNull(),
  occupationCode: text('occupation_code').references(() => occupations.code),
  proposedTitle: text('proposed_title'),
  relationType: text('relation_type', { enum: ['primary', 'adjacent', 'cross_major', 'stretch'] }).notNull(),
  sourceIds: text('source_ids', { mode: 'json' }).notNull().default('[]'),
  evidenceExcerpt: text('evidence_excerpt').notNull().default(''),
  reviewRequired: integer('review_required', { mode: 'boolean' }).notNull().default(false),
  reviewReason: text('review_reason').notNull().default(''),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (table) => ({
  versionMajorOccupationUnique: unique('major_occupation_edges_version_major_occupation_relation_unique').on(table.catalogVersion, table.majorCode, table.occupationCode, table.relationType),
  majorIdx: index('major_occupation_edges_major_code_idx').on(table.majorCode),
  occupationIdx: index('major_occupation_edges_occupation_code_idx').on(table.occupationCode),
}));

export const careerSourceSnapshots = sqliteTable('career_source_snapshots', {
  id: text('id').primaryKey(),
  catalogVersion: text('catalog_version').notNull(),
  sourceId: text('source_id').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  publisher: text('publisher').notNull().default(''),
  sourceType: text('source_type').notNull().default(''),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }),
  contentHash: text('content_hash').notNull(),
  httpStatus: integer('http_status'),
  robotsStatus: text('robots_status').notNull().default('unknown'),
  licenseNotes: text('license_notes').notNull().default(''),
}, (table) => ({
  versionSourceUnique: unique('career_source_snapshots_version_source_unique').on(table.catalogVersion, table.sourceId),
  hashIdx: index('career_source_snapshots_content_hash_idx').on(table.contentHash),
}));

export const occupationRequirements = sqliteTable('occupation_requirements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  abilityCode: text('ability_code').notNull(),
  abilityName: text('ability_name').notNull(),
  dimension: text('dimension', { enum: CAREER_DIMENSION_ENUM }).notNull(),
  targetScore: integer('target_score').notNull(),
  weight: integer('weight').notNull().default(1),
  required: integer('required', { mode: 'boolean' }).notNull().default(true),
  description: text('description').notNull().default(''),
  educationLevel: text('education_level').notNull().default(''),
  experienceLevel: text('experience_level').notNull().default(''),
  region: text('region').notNull().default(''),
  sourceIds: text('source_ids', { mode: 'json' }).notNull().default('[]'),
  reviewStatus: text('review_status').notNull().default('reviewed'),
  catalogVersion: text('catalog_version'),
}, (table) => ({
  occupationAbilityUnique: unique('occupation_requirements_occupation_code_ability_code_unique').on(table.occupationCode, table.abilityCode),
  occupationIdx: index('occupation_requirements_occupation_code_idx').on(table.occupationCode),
  abilityIdx: index('occupation_requirements_ability_code_idx').on(table.abilityCode),
}));

export const occupationRelations = sqliteTable('occupation_relations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fromCode: text('from_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  toCode: text('to_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  relationType: text('relation_type', { enum: ['progresses_to', 'transfers_to', 'related_to'] }).notNull(),
  description: text('description').notNull().default(''),
}, (table) => ({
  relationUnique: unique('occupation_relations_from_code_to_code_relation_type_unique').on(table.fromCode, table.toCode, table.relationType),
  fromIdx: index('occupation_relations_from_code_idx').on(table.fromCode),
  toIdx: index('occupation_relations_to_code_idx').on(table.toCode),
}));

export const careerKnowledgeDocuments = sqliteTable('career_knowledge_documents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  occupationCode: text('occupation_code').references(() => occupations.code, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  sourceLabel: text('source_label').notNull(),
  sourceUrl: text('source_url').notNull(),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }).notNull().default(now),
  metadata: text('metadata', { mode: 'json' }).notNull().default('{}'),
  catalogVersion: text('catalog_version'),
  contentHash: text('content_hash').notNull().default(''),
}, (table) => ({
  occupationIdx: index('career_knowledge_documents_occupation_code_idx').on(table.occupationCode),
  sourceIdx: index('career_knowledge_documents_source_label_idx').on(table.sourceLabel),
}));

export const careerGoals = sqliteTable('career_goals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['draft', 'active', 'achieved', 'archived'] }).notNull().default('active'),
  targetDate: integer('target_date', { mode: 'timestamp' }),
  rationale: text('rationale').notNull().default(''),
  preferences: text('preferences', { mode: 'json' }).notNull().default('{}'),
  teacherConfirmationStatus: text('teacher_confirmation_status', { enum: ['unreviewed', 'confirmed', 'needs_revision'] }).notNull().default('unreviewed'),
  confirmedBy: text('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userIdx: index('career_goals_user_id_idx').on(table.userId),
  userStatusIdx: index('career_goals_user_id_status_idx').on(table.userId, table.status),
  occupationIdx: index('career_goals_occupation_code_idx').on(table.occupationCode),
}));

export const careerTasks = sqliteTable('career_tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => careerGoals.id, { onDelete: 'set null' }),
  occupationCode: text('occupation_code').references(() => occupations.code, { onDelete: 'set null' }),
  abilityCode: text('ability_code'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  reason: text('reason').notNull().default(''),
  completionCriteria: text('completion_criteria').notNull().default(''),
  category: text('category', { enum: ['explore', 'learn', 'practice', 'portfolio', 'application'] }).notNull().default('learn'),
  status: text('status', { enum: ['todo', 'in_progress', 'completed', 'cancelled'] }).notNull().default('todo'),
  dueAt: integer('due_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  assignedBy: text('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userIdx: index('career_tasks_user_id_idx').on(table.userId),
  userStatusIdx: index('career_tasks_user_id_status_idx').on(table.userId, table.status),
  goalIdx: index('career_tasks_goal_id_idx').on(table.goalId),
  dueIdx: index('career_tasks_due_at_idx').on(table.dueAt),
}));

export const careerProfileSnapshots = sqliteTable('career_profile_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  abilities: text('abilities', { mode: 'json' }).notNull(),
  trigger: text('trigger').notNull().default('manual'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userVersionUnique: unique('career_profile_snapshots_user_id_version_unique').on(table.userId, table.version),
  userCreatedIdx: index('career_profile_snapshots_user_id_created_at_idx').on(table.userId, table.createdAt),
}));

export const careerGuidanceNotes = sqliteTable('career_guidance_notes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  teacherId: text('teacher_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  visibility: text('visibility', { enum: ['student', 'teacher_private', 'management'] }).notNull().default('student'),
  priority: text('priority', { enum: ['low', 'normal', 'high', 'urgent'] }).notNull().default('normal'),
  followUpStatus: text('follow_up_status', { enum: ['new', 'contacted', 'waiting_student', 'waiting_teacher', 'scheduled', 'resolved', 'on_hold'] }).notNull().default('new'),
  nextFollowUpAt: integer('next_follow_up_at', { mode: 'timestamp' }),
  content: text('content').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userCreatedIdx: index('career_guidance_notes_user_id_created_at_idx').on(table.userId, table.createdAt),
  teacherIdx: index('career_guidance_notes_teacher_id_idx').on(table.teacherId),
  followUpIdx: index('career_guidance_notes_teacher_follow_up_idx').on(table.teacherId, table.followUpStatus, table.nextFollowUpAt),
}));

export const careerMatches = sqliteTable('career_matches', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => careerGoals.id, { onDelete: 'set null' }),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  score: integer('score'),
  evidenceCoverage: integer('evidence_coverage').notNull().default(0),
  knownWeight: integer('known_weight').notNull().default(0),
  totalWeight: integer('total_weight').notNull().default(0),
  breakdown: text('breakdown', { mode: 'json' }).notNull().default('[]'),
  citations: text('citations', { mode: 'json' }).notNull().default('[]'),
  algorithmVersion: text('algorithm_version').notNull().default('career-match-v1'),
  catalogVersion: text('catalog_version'),
  confidence: integer('confidence'),
  knownCoverage: integer('known_coverage').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userOccupationIdx: index('career_matches_user_id_occupation_code_idx').on(table.userId, table.occupationCode),
  userCreatedIdx: index('career_matches_user_id_created_at_idx').on(table.userId, table.createdAt),
}));

export const educationRoleAssignments = sqliteTable('education_role_assignments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['student', 'teacher', 'counselor'] }).notNull(),
  status: text('status', { enum: ['active', 'removed'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  orgUserRoleUnique: unique('education_role_assignments_organization_id_user_id_role_unique').on(table.organizationId, table.userId, table.role),
  orgRoleIdx: index('education_role_assignments_organization_id_role_idx').on(table.organizationId, table.role),
  userStatusIdx: index('education_role_assignments_user_id_status_idx').on(table.userId, table.status),
}));

export const teacherStudentAssignments = sqliteTable('teacher_student_assignments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  teacherUserId: text('teacher_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  studentUserId: text('student_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
  accessLevel: text('access_level', { enum: ['view', 'guide', 'manage'] }).notNull().default('guide'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  orgTeacherStudentUnique: unique('teacher_student_assignments_org_teacher_student_unique').on(table.organizationId, table.teacherUserId, table.studentUserId),
  teacherStatusIdx: index('teacher_student_assignments_teacher_user_id_status_idx').on(table.teacherUserId, table.status),
  studentStatusIdx: index('teacher_student_assignments_student_user_id_status_idx').on(table.studentUserId, table.status),
  orgStatusIdx: index('teacher_student_assignments_organization_id_status_idx').on(table.organizationId, table.status),
}));

export const careerAssessmentResults = sqliteTable('career_assessment_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assessmentType: text('assessment_type', { enum: ['holland', 'mbti', 'work_values'] }).notNull(),
  resultCode: text('result_code').notNull(),
  answers: text('answers', { mode: 'json' }).notNull().default('{}'),
  dimensionScores: text('dimension_scores', { mode: 'json' }).notNull().default('{}'),
  matchedOccupationCodes: text('matched_occupation_codes', { mode: 'json' }).notNull().default('[]'),
  isLatest: integer('is_latest', { mode: 'boolean' }).notNull().default(true),
  completedAt: integer('completed_at', { mode: 'timestamp' }).notNull().default(now),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userTypeCreatedIdx: index('career_assessment_results_user_type_created_idx').on(table.userId, table.assessmentType, table.createdAt),
  userLatestIdx: index('career_assessment_results_user_latest_idx').on(table.userId, table.isLatest),
}));

export const careerCheckIns = sqliteTable('career_check_ins', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  checkInDate: text('check_in_date').notNull(),
  streakCount: integer('streak_count').notNull(),
  taskIdsCompleted: text('task_ids_completed', { mode: 'json' }).notNull().default('[]'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userDateUnique: unique('career_check_ins_user_date_unique').on(table.userId, table.checkInDate),
  userCreatedIdx: index('career_check_ins_user_created_idx').on(table.userId, table.createdAt),
}));

export const careerStreakStats = sqliteTable('career_streak_stats', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  currentStreak: integer('current_streak').notNull().default(0),
  longestStreak: integer('longest_streak').notNull().default(0),
  totalCheckIns: integer('total_check_ins').notNull().default(0),
  lastCheckInDate: text('last_check_in_date'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
});

export const jobSubscriptions = sqliteTable('job_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keywords: text('keywords').notNull(),
  city: text('city').notNull().default(''),
  frequency: text('frequency', { enum: ['daily', 'weekly'] }).notNull().default('weekly'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userFilterUnique: unique('job_subscriptions_user_filter_unique').on(table.userId, table.keywords, table.city, table.frequency),
  userActiveIdx: index('job_subscriptions_user_active_idx').on(table.userId, table.active),
}));

export const careerFeatureUnlocks = sqliteTable('career_feature_unlocks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  feature: text('feature', { enum: ['assessment_report', 'match_heatmap', 'full_path'] }).notNull(),
  source: text('source', { enum: ['credits', 'subscription', 'admin'] }).notNull(),
  businessRefId: text('business_ref_id').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userFeatureRefUnique: unique('career_feature_unlocks_user_feature_ref_unique').on(table.userId, table.feature, table.businessRefId),
  userFeatureIdx: index('career_feature_unlocks_user_feature_idx').on(table.userId, table.feature, table.expiresAt),
}));

export const careerReportVersions = sqliteTable('career_report_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  markdown: text('markdown').notNull(),
  status: text('status', { enum: ['draft', 'complete'] }).notNull().default('complete'),
  completeness: text('completeness', { mode: 'json' }).notNull().default('{}'),
  sourceVersionId: text('source_version_id'),
  aiOperationId: text('ai_operation_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userVersionUnique: unique('career_report_versions_user_version_unique').on(table.userId, table.version),
  userCreatedIdx: index('career_report_versions_user_created_idx').on(table.userId, table.createdAt),
}));

export const analysisRuns = sqliteTable('analysis_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'running', 'failed', 'completed', 'cancelled'] }).notNull().default('pending'),
  currentStep: text('current_step', { enum: ['uploaded', 'parsed', 'profiled', 'matched', 'pathed', 'reported'] }).notNull().default('uploaded'),
  steps: text('steps', { mode: 'json' }).notNull().default('[]'),
  input: text('input', { mode: 'json' }).notNull().default('{}'),
  result: text('result', { mode: 'json' }).notNull().default('{}'),
  errorCode: text('error_code'),
  retryCount: integer('retry_count').notNull().default(0),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userCreatedIdx: index('analysis_runs_user_created_idx').on(table.userId, table.createdAt),
  statusExpiryIdx: index('analysis_runs_status_expiry_idx').on(table.status, table.expiresAt),
}));

export const companies = sqliteTable('companies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  normalizedName: text('normalized_name').notNull().unique(),
  name: text('name').notNull(),
  industry: text('industry').notNull().default(''),
  website: text('website'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
});

export const jobPostings = sqliteTable('job_postings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  externalId: text('external_id').notNull(),
  source: text('source').notNull(),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  occupationCode: text('occupation_code').references(() => occupations.code, { onDelete: 'set null' }),
  title: text('title').notNull(),
  city: text('city').notNull().default(''),
  industry: text('industry').notNull().default(''),
  description: text('description').notNull().default(''),
  skills: text('skills', { mode: 'json' }).notNull().default('[]'),
  salaryMinMonthly: integer('salary_min_monthly'),
  salaryMaxMonthly: integer('salary_max_monthly'),
  salaryMonths: integer('salary_months').notNull().default(12),
  sourceUrl: text('source_url'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  sourceExternalUnique: unique('job_postings_source_external_unique').on(table.source, table.externalId),
  activeIndustryIdx: index('job_postings_active_industry_idx').on(table.active, table.industry),
  occupationIdx: index('job_postings_occupation_code_idx').on(table.occupationCode),
  salaryIdx: index('job_postings_salary_idx').on(table.salaryMinMonthly, table.salaryMaxMonthly),
}));
