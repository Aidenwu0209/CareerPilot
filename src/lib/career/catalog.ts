import occupationData from '../../../careerpilot-data/catalog/occupations.json';
import relationData from '../../../careerpilot-data/catalog/occupation_relations.json';
import requirementData from '../../../careerpilot-data/catalog/occupation_requirements.json';
import sourceData from '../../../careerpilot-data/catalog/sources.json';
import type {
  AbilityDimensionCode,
  OccupationDetail,
  OccupationRelationType,
} from '@/types/career';

export interface AbilityDefinition {
  code: string;
  name: string;
  dimension: AbilityDimensionCode;
}

export const DIMENSION_NAMES: Record<AbilityDimensionCode, string> = {
  domain_knowledge: '专业基础',
  professional_skills: '职业技能',
  project_practice: '项目与实践',
  general_competencies: '通用能力',
  job_readiness: '求职准备',
  growth_potential: '学习与发展潜力',
};

// General profile abilities remain useful before a student selects a target.
// Occupation-specific abilities are loaded from the active Chinese catalog.
export const ABILITY_CATALOG: AbilityDefinition[] = [
  { code: 'software_fundamentals', name: '软件工程基础', dimension: 'domain_knowledge' },
  { code: 'web_frontend', name: 'Web 前端基础', dimension: 'professional_skills' },
  { code: 'backend_engineering', name: '后端工程能力', dimension: 'professional_skills' },
  { code: 'database', name: '数据库能力', dimension: 'professional_skills' },
  { code: 'data_analysis', name: '数据分析能力', dimension: 'professional_skills' },
  { code: 'statistics', name: '统计学基础', dimension: 'domain_knowledge' },
  { code: 'machine_learning', name: '机器学习能力', dimension: 'professional_skills' },
  { code: 'product_discovery', name: '需求与产品分析', dimension: 'professional_skills' },
  { code: 'ux_research', name: '用户研究', dimension: 'professional_skills' },
  { code: 'visual_design', name: '视觉与交互设计', dimension: 'professional_skills' },
  { code: 'testing', name: '软件测试与质量', dimension: 'professional_skills' },
  { code: 'cloud_automation', name: '云平台与自动化', dimension: 'professional_skills' },
  { code: 'security', name: '信息安全能力', dimension: 'professional_skills' },
  { code: 'mobile_engineering', name: '移动应用开发', dimension: 'professional_skills' },
  { code: 'project_delivery', name: '项目交付', dimension: 'project_practice' },
  { code: 'problem_solving', name: '问题分析与解决', dimension: 'general_competencies' },
  { code: 'communication', name: '沟通协作', dimension: 'general_competencies' },
  { code: 'portfolio', name: '作品与成果证明', dimension: 'job_readiness' },
  { code: 'interview', name: '面试表达', dimension: 'job_readiness' },
  { code: 'career_exploration', name: '职业探索与目标感', dimension: 'growth_potential' },
  { code: 'continuous_learning', name: '持续学习', dimension: 'growth_potential' },
];

type CatalogOccupation = Omit<OccupationDetail, 'matchScore' | 'evidenceCoverage' | 'relatedOccupations'> & {
  relations: Array<{
    toCode: string;
    relationType: OccupationRelationType;
    description: string;
  }>;
};

type RawOccupation = (typeof occupationData.items)[number];
type RawRequirement = (typeof requirementData.items)[number];
type RawSource = (typeof sourceData.items)[number];

const sourceById = new Map<string, RawSource>(sourceData.items.map((source) => [source.id, source]));
const occupationNameByCode = new Map(occupationData.items.map((occupation) => [occupation.code, occupation.name]));

/**
 * Fresh local demo databases use the same committed Chinese-standard records
 * as the explicit catalog importer. This is demo-only seed material; product
 * reads never mutate or backfill the catalog.
 */
export const DEMO_OCCUPATIONS: CatalogOccupation[] = occupationData.items.map((occupation: RawOccupation) => ({
  code: occupation.code,
  name: occupation.name,
  category: occupation.category,
  summary: occupation.summary,
  description: occupation.description,
  entryLevel: occupation.entry_level,
  jobFamily: occupation.job_family,
  industry: occupation.industry,
  cities: occupation.cities,
  educationLevels: occupation.education_levels,
  catalogVersion: occupationData.catalog_version,
  canonicalType: 'china_national_occupation',
  reviewStatus: occupation.review_status,
  scoringEligible: occupation.scoring_eligible,
  aliases: [],
  majorMappings: [],
  requirements: requirementData.items
    .filter((requirement: RawRequirement) => requirement.occupation_code === occupation.code)
    .map((requirement: RawRequirement) => ({
      abilityCode: requirement.ability_code,
      abilityName: requirement.ability_name,
      dimension: requirement.dimension as AbilityDimensionCode,
      targetScore: requirement.target_score,
      weight: requirement.weight,
      required: requirement.required,
      description: requirement.description,
    })),
  relations: relationData.items
    .filter((relation) => relation.from_code === occupation.code)
    .map((relation) => ({
      toCode: relation.to_code,
      relationType: relation.relation_type as OccupationRelationType,
      description: relation.description,
    })),
  citations: occupation.source_ids.flatMap((sourceId) => {
    const source = sourceById.get(sourceId);
    if (!source) return [];
    return [{
      id: `demo:${occupation.code}:${source.id}`,
      title: source.title ?? occupation.name,
      sourceLabel: source.publisher,
      sourceUrl: source.url,
      excerpt: occupation.description.slice(0, 220),
      publishedAt: source.published_at,
      verifiedAt: source.fetched_at ?? occupationData.generated_at,
    }];
  }),
}));

export const DEMO_OCCUPATION_BY_CODE = new Map(
  DEMO_OCCUPATIONS.map((occupation) => [occupation.code, occupation]),
);

export const DEMO_OCCUPATION_NAME_BY_CODE = occupationNameByCode;
