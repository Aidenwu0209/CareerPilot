/** Dependency-free runtime codes shared by types, configuration and database schemas. */
export const CAREER_DIMENSIONS = [
  'domain_knowledge',
  'professional_skills',
  'project_practice',
  'general_competencies',
  'job_readiness',
  'growth_potential',
] as const;

export type AbilityDimensionCode = (typeof CAREER_DIMENSIONS)[number];
