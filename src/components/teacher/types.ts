export type TeacherQueueKind =
  | 'evidence_review'
  | 'goal_change'
  | 'overdue_task'
  | 'match_decline'
  | 'recent_progress'
  | 'follow_up';

export type TeacherStudentStatus = 'attention' | 'on_track' | 'progress';

export interface TeacherQueueSummary {
  kind: TeacherQueueKind;
  count: number;
}

export interface TeacherStudentSummary {
  id: string;
  name: string;
  program: string;
  cohort: string;
  targetJob: string | null;
  matchScore: number | null;
  evidenceCoverage: number | null;
  completedTaskCount: number;
  taskCount: number;
  status: TeacherStudentStatus;
  lastChange: string | null;
  pendingItemCount: number;
}

export interface TeacherWorkspaceView {
  queue: TeacherQueueSummary[];
  recentStudents: TeacherStudentSummary[];
}

export type EvidenceStatus = 'pending' | 'confirmed' | 'rejected';
export type EvidenceSourceType = 'resume' | 'interview' | 'project' | 'certificate' | 'teacher' | 'student';

export interface TeacherAbilityEvidence {
  id: string;
  title: string;
  excerpt: string;
  sourceType: EvidenceSourceType;
  sourceLabel: string;
  abilityName: string;
  status: EvidenceStatus;
  assessedScore?: number | null;
  reviewReason?: string;
  reviewedAt?: string | null;
  updatedAt: string;
}

export interface TeacherAbilityDimension {
  key: string;
  name: string;
  level: number | null;
  evidenceCount: number;
  change: number | null;
  updatedAt: string | null;
}

export interface TeacherCareerGoal {
  id: string;
  jobTitle: string;
  kind: 'primary' | 'alternative';
  targetDate: string | null;
  status: 'active' | 'pending_review' | 'archived';
}

export interface TeacherPathStage {
  id: string;
  title: string;
  description: string;
  status: 'completed' | 'current' | 'upcoming';
  milestone: string | null;
}

export interface TeacherGrowthTask {
  id: string;
  title: string;
  abilityName: string;
  dueDate: string | null;
  status: 'todo' | 'in_progress' | 'submitted' | 'completed' | 'overdue';
  completionCriteria: string;
  assignedBy: string;
}

export interface TeacherGuidanceRecord {
  id: string;
  content: string;
  visibility: 'student' | 'private';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  followUpStatus: 'new' | 'contacted' | 'waiting_student' | 'waiting_teacher' | 'scheduled' | 'resolved' | 'on_hold';
  nextFollowUpAt: string | null;
  authorName: string;
  createdAt: string;
}

export interface TeacherStudentDetail {
  id: string;
  name: string;
  program: string;
  cohort: string;
  targetJob: string | null;
  matchScore: number | null;
  evidenceCoverage: number | null;
  profileCompleteness: number | null;
  nextMilestone: string | null;
  status: TeacherStudentStatus;
  abilities: TeacherAbilityDimension[];
  evidence: TeacherAbilityEvidence[];
  goals: TeacherCareerGoal[];
  path: TeacherPathStage[];
  tasks: TeacherGrowthTask[];
  guidance: TeacherGuidanceRecord[];
}
