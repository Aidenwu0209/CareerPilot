import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { organizations, users } from './schema';

const now = sql`(unixepoch())`;

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
  dimension: text('dimension', { enum: ['domain_knowledge', 'professional_skills', 'project_practice', 'general_competencies', 'job_readiness', 'growth_potential'] }).notNull(),
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
}));

export const occupations = sqliteTable('occupations', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  summary: text('summary').notNull(),
  description: text('description').notNull(),
  entryLevel: text('entry_level').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  categoryIdx: index('occupations_category_idx').on(table.category),
  activeIdx: index('occupations_active_idx').on(table.active),
}));

export const occupationRequirements = sqliteTable('occupation_requirements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  occupationCode: text('occupation_code').notNull().references(() => occupations.code, { onDelete: 'cascade' }),
  abilityCode: text('ability_code').notNull(),
  abilityName: text('ability_name').notNull(),
  dimension: text('dimension', { enum: ['domain_knowledge', 'professional_skills', 'project_practice', 'general_competencies', 'job_readiness', 'growth_potential'] }).notNull(),
  targetScore: integer('target_score').notNull(),
  weight: integer('weight').notNull().default(1),
  required: integer('required', { mode: 'boolean' }).notNull().default(true),
  description: text('description').notNull().default(''),
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
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
}, (table) => ({
  userCreatedIdx: index('career_guidance_notes_user_id_created_at_idx').on(table.userId, table.createdAt),
  teacherIdx: index('career_guidance_notes_teacher_id_idx').on(table.teacherId),
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
