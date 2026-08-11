export const CAREER_DIMENSIONS = [
  'domain_knowledge',
  'professional_skills',
  'project_practice',
  'general_competencies',
  'job_readiness',
  'growth_potential',
] as const;

export type AbilityDimensionCode = (typeof CAREER_DIMENSIONS)[number];

export type CareerStage = 'exploring' | 'targeting' | 'preparing' | 'applying';
export type EvidenceStatus = 'pending' | 'verified' | 'rejected';
export type CareerGoalStatus = 'draft' | 'active' | 'achieved' | 'archived';
export type CareerTaskStatus = 'todo' | 'in_progress' | 'completed' | 'cancelled';
export type CareerTaskCategory = 'explore' | 'learn' | 'practice' | 'portfolio' | 'application';
export type OccupationRelationType = 'progresses_to' | 'transfers_to' | 'related_to';

export interface CareerEvidence {
  id: string;
  abilityCode: string;
  sourceType: 'resume' | 'project' | 'interview' | 'certificate' | 'course' | 'teacher' | 'task' | 'manual';
  sourceId: string | null;
  title: string;
  excerpt: string;
  sourceUrl: string | null;
  status: EvidenceStatus;
  reviewReason: string;
  reviewedAt: string | null;
  occurredAt: string | null;
  createdAt: string;
}

export interface CareerAbility {
  code: string;
  name: string;
  dimension: AbilityDimensionCode;
  score: number | null;
  status: 'known' | 'unknown';
  confidence: number | null;
  evidenceCount: number;
  evidence: CareerEvidence[];
  updatedAt: string;
}

export interface CareerDimension {
  code: AbilityDimensionCode;
  name: string;
  score: number | null;
  status: 'known' | 'unknown';
  abilities: CareerAbility[];
}

export interface CareerProfile {
  userId: string;
  headline: string;
  summary: string;
  stage: CareerStage;
  completeness: number;
  evidenceCoverage: number;
  dimensions: CareerDimension[];
  updatedAt: string;
}

export interface AbilityChange {
  abilityCode: string;
  abilityName: string;
  dimension: AbilityDimensionCode;
  fromScore: number | null;
  toScore: number | null;
  delta: number | null;
  reason: string;
  changedAt: string;
}

export interface KnowledgeCitation {
  id: string;
  title: string;
  sourceLabel: string;
  sourceUrl: string;
  excerpt: string;
  publishedAt: string | null;
  verifiedAt: string;
}

export interface OccupationRequirement {
  abilityCode: string;
  abilityName: string;
  dimension: AbilityDimensionCode;
  targetScore: number;
  weight: number;
  required: boolean;
  description: string;
}

export interface RelatedOccupation {
  code: string;
  name: string;
  relationType: OccupationRelationType;
  description: string;
}

export interface OccupationSummary {
  code: string;
  name: string;
  category: string;
  summary: string;
  matchScore: number | null;
  evidenceCoverage?: number;
}

export interface OccupationDetail extends OccupationSummary {
  description: string;
  entryLevel: string;
  requirements: OccupationRequirement[];
  relatedOccupations: RelatedOccupation[];
  citations: KnowledgeCitation[];
}

export interface CareerGoal {
  id: string;
  userId: string;
  occupationCode: string;
  occupationName: string;
  isPrimary: boolean;
  status: CareerGoalStatus;
  targetDate: string | null;
  rationale: string;
  preferences: {
    industries?: string[];
    cities?: string[];
    organizationTypes?: string[];
  };
  teacherConfirmationStatus: 'unreviewed' | 'confirmed' | 'needs_revision';
  createdAt: string;
  updatedAt: string;
}

export interface CareerTask {
  id: string;
  userId: string;
  goalId: string | null;
  occupationCode: string | null;
  abilityCode: string | null;
  title: string;
  description: string;
  reason: string;
  completionCriteria: string;
  category: CareerTaskCategory;
  status: CareerTaskStatus;
  dueAt: string | null;
  completedAt: string | null;
  assignedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuidanceNote {
  id: string;
  teacherId: string;
  teacherName: string;
  visibility: 'student' | 'teacher_private' | 'management';
  content: string;
  createdAt: string;
}

export interface CareerIndicators {
  readiness: number | null;
  match: number | null;
  profileCompleteness: number;
  evidenceCoverage: number;
}

export interface CareerOverview {
  profile: CareerProfile;
  primaryGoal: CareerGoal | null;
  indicators: CareerIndicators;
  abilityChanges: AbilityChange[];
  nextTasks: CareerTask[];
  latestGuidance: GuidanceNote[];
  generatedAt: string;
}

export interface CareerPathStage {
  id: string;
  title: string;
  description: string;
  order: number;
  status: 'locked' | 'current' | 'completed';
  targetDate: string | null;
  tasks: CareerTask[];
}

export interface CareerPath {
  goal: CareerGoal | null;
  stages: CareerPathStage[];
  currentStageIndex: number;
  updatedAt: string;
}

export interface AbilityMatchBreakdown {
  abilityCode: string;
  abilityName: string;
  dimension: AbilityDimensionCode;
  targetScore: number;
  actualScore: number | null;
  status: 'met' | 'gap' | 'unknown';
  weightedScore: number | null;
}

export interface OccupationMatch {
  occupationCode: string;
  score: number | null;
  evidenceCoverage: number;
  knownWeight: number;
  totalWeight: number;
  breakdown: AbilityMatchBreakdown[];
  citations: KnowledgeCitation[];
  algorithmVersion: 'career-match-v1';
  generatedAt: string;
}

export interface CareerMatchBreakdownItem {
  dimension: AbilityDimensionCode;
  abilityCode: string;
  abilityName: string;
  requirement: {
    targetScore: number;
    weight: number;
    required: boolean;
    description: string;
  };
  studentScore: number | null;
  studentEvidence: CareerEvidence[];
  state: 'met' | 'gap' | 'unknown';
  gap: number | null;
  action: string;
}

export interface CareerMatchResult {
  occupation: OccupationSummary;
  score: number | null;
  evidenceCoverage: number;
  knownWeight: number;
  totalWeight: number;
  dimensionBreakdown: CareerMatchBreakdownItem[];
  citations: KnowledgeCitation[];
  algorithmVersion: 'career-match-v1';
  generatedAt: string;
}

export interface CareerGoalInput {
  occupationCode: string;
  isPrimary?: boolean;
  targetDate?: string | null;
  rationale?: string;
  preferences?: CareerGoal['preferences'];
}

export interface CareerTaskInput {
  goalId?: string | null;
  occupationCode?: string | null;
  abilityCode?: string | null;
  title: string;
  description?: string;
  reason?: string;
  completionCriteria?: string;
  category?: CareerTaskCategory;
  dueAt?: string | null;
  assignedBy?: string | null;
}

export interface KnowledgeSearchResult {
  occupationCode: string | null;
  content: string;
  citation: KnowledgeCitation;
  relevance: number;
}

export interface CareerMaterialSyncResult {
  processedSources: number;
  evidenceCreated: number;
  abilitiesLinked: number;
  warnings: string[];
  syncedAt: string;
}
