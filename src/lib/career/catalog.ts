import type {
  AbilityDimensionCode,
  KnowledgeCitation,
  OccupationDetail,
  OccupationRelationType,
  OccupationRequirement,
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

const abilityByCode = new Map(ABILITY_CATALOG.map((ability) => [ability.code, ability]));

function requirement(
  abilityCode: string,
  targetScore: number,
  weight: number,
  description: string,
  required = true,
): OccupationRequirement {
  const ability = abilityByCode.get(abilityCode);
  if (!ability) throw new Error(`Unknown ability code: ${abilityCode}`);
  return {
    abilityCode,
    abilityName: ability.name,
    dimension: ability.dimension,
    targetScore,
    weight,
    required,
    description,
  };
}

const VERIFIED_AT = '2026-08-11T00:00:00.000Z';

function citation(
  code: string,
  title: string,
  sourceUrl: string,
  excerpt: string,
): KnowledgeCitation {
  return {
    id: `knowledge-${code}`,
    title,
    sourceLabel: 'O*NET OnLine（美国劳工部职业信息网络）',
    sourceUrl,
    excerpt,
    publishedAt: null,
    verifiedAt: VERIFIED_AT,
  };
}

type CatalogOccupation = Omit<OccupationDetail, 'matchScore' | 'evidenceCoverage' | 'relatedOccupations'> & {
  relations: Array<{
    toCode: string;
    relationType: OccupationRelationType;
    description: string;
  }>;
};

export const DEMO_OCCUPATIONS: CatalogOccupation[] = [
  {
    code: 'J-FE-001', name: '前端开发工程师', category: '软件与互联网',
    summary: '构建可访问、可靠且高性能的 Web 用户界面。',
    description: '负责将产品和交互设计转化为可维护的 Web 应用，并与后端、设计和测试协同交付。',
    entryLevel: '适合具备 Web 基础、至少一个可运行项目和基础工程化经验的学生。',
    requirements: [
      requirement('web_frontend', 72, 5, '掌握 HTML、CSS、JavaScript/TypeScript 与浏览器基础。'),
      requirement('software_fundamentals', 62, 3, '理解模块化、版本控制和基本数据结构。'),
      requirement('testing', 55, 2, '能够编写基础组件或端到端测试。'),
      requirement('project_delivery', 65, 4, '有从需求到部署的完整项目经历。'),
      requirement('problem_solving', 65, 3, '能定位界面、状态和性能问题。'),
      requirement('portfolio', 60, 2, '能用作品说明个人贡献和结果。'),
    ],
    relations: [
      { toCode: 'J-FS-001', relationType: 'progresses_to', description: '补足后端与数据库能力后可发展为全栈工程师。' },
      { toCode: 'J-UX-001', relationType: 'related_to', description: '对交互与用户研究感兴趣时可向 UX 方向迁移。' },
    ],
    citations: [citation('J-FE-001', 'Web Developers', 'https://www.onetonline.org/link/summary/15-1254.00', '职业任务包括开发、维护和测试网站或 Web 应用。')],
  },
  {
    code: 'J-BE-001', name: '后端开发工程师', category: '软件与互联网',
    summary: '设计服务端系统、接口、数据存储与可靠性机制。',
    description: '负责业务服务、API、数据库、性能和安全等服务端工程工作。',
    entryLevel: '适合具有编程基础、数据库知识和至少一个服务端项目的学生。',
    requirements: [
      requirement('backend_engineering', 72, 5, '掌握一种服务端语言、API 与并发基础。'),
      requirement('database', 68, 4, '能够设计数据模型并理解事务与索引。'),
      requirement('software_fundamentals', 68, 4, '具备数据结构、网络和软件工程基础。'),
      requirement('testing', 58, 2, '能够验证接口和关键业务逻辑。'),
      requirement('project_delivery', 65, 3, '有可运行服务和部署证据。'),
      requirement('problem_solving', 70, 4, '能分析日志、错误和性能瓶颈。'),
    ],
    relations: [
      { toCode: 'J-FS-001', relationType: 'progresses_to', description: '补足前端能力后可扩展为全栈工程师。' },
      { toCode: 'J-DO-001', relationType: 'transfers_to', description: '强化云平台和自动化能力后可转向 DevOps。' },
    ],
    citations: [citation('J-BE-001', 'Software Developers', 'https://www.onetonline.org/link/summary/15-1252.00', '职业任务包括分析需求、设计软件系统并改进现有系统。')],
  },
  {
    code: 'J-FS-001', name: '全栈开发工程师', category: '软件与互联网',
    summary: '贯通前端、后端与数据层，完成端到端产品交付。',
    description: '面向中小型产品或跨职能团队承担端到端开发、联调和部署。',
    entryLevel: '适合已经完成一个包含前后端和数据库的完整项目的学生。',
    requirements: [
      requirement('web_frontend', 65, 4, '能独立完成常见交互界面。'),
      requirement('backend_engineering', 65, 4, '能设计和实现常见业务 API。'),
      requirement('database', 60, 3, '能完成基础数据建模。'),
      requirement('project_delivery', 72, 5, '具备端到端交付和部署经验。'),
      requirement('problem_solving', 68, 4, '能跨层排查问题。'),
      requirement('continuous_learning', 65, 2, '能持续学习不同技术栈。'),
    ],
    relations: [
      { toCode: 'J-FE-001', relationType: 'related_to', description: '可聚焦用户界面与前端工程化。' },
      { toCode: 'J-BE-001', relationType: 'related_to', description: '可聚焦服务端架构与数据系统。' },
    ],
    citations: [citation('J-FS-001', 'Software Developers', 'https://www.onetonline.org/link/summary/15-1252.00', '软件开发工作覆盖需求分析、系统设计、实现、测试与维护。')],
  },
  {
    code: 'J-DA-001', name: '数据分析师', category: '数据与智能',
    summary: '将业务问题转化为数据分析并形成可行动结论。',
    description: '负责数据清洗、指标构建、分析可视化和结果沟通。',
    entryLevel: '适合具有统计基础、SQL/表格工具能力和分析项目的学生。',
    requirements: [
      requirement('data_analysis', 72, 5, '能够完成数据清洗、查询、可视化和解释。'),
      requirement('statistics', 62, 4, '理解描述统计和常见推断方法。'),
      requirement('database', 58, 3, '能使用 SQL 获取与组织数据。'),
      requirement('problem_solving', 68, 4, '能从业务问题定义分析路径。'),
      requirement('communication', 68, 4, '能清晰表达结论、限制和建议。'),
      requirement('portfolio', 60, 2, '有可复核的分析案例。'),
    ],
    relations: [
      { toCode: 'J-DS-001', relationType: 'progresses_to', description: '强化统计建模和机器学习后可发展为数据科学家。' },
      { toCode: 'J-PM-001', relationType: 'transfers_to', description: '强化产品和业务决策能力后可转向产品管理。' },
    ],
    citations: [citation('J-DA-001', 'Operations Research Analysts', 'https://www.onetonline.org/link/summary/15-2031.00', '职业工作包含收集分析数据、建立模型并向决策者提供建议。')],
  },
  {
    code: 'J-DS-001', name: '数据科学家', category: '数据与智能',
    summary: '利用统计、编程与机器学习解决复杂数据问题。',
    description: '负责数据探索、模型设计、实验评估和结果解释。',
    entryLevel: '适合具有统计、编程、机器学习基础和可复现实验项目的学生。',
    requirements: [
      requirement('statistics', 75, 5, '理解概率、统计推断和实验设计。'),
      requirement('data_analysis', 72, 4, '能完成数据质量检查和探索分析。'),
      requirement('machine_learning', 72, 5, '能训练、评估并解释基础模型。'),
      requirement('software_fundamentals', 62, 3, '能编写可复现、可维护的分析代码。'),
      requirement('problem_solving', 72, 4, '能将业务问题转化为可验证假设。'),
      requirement('project_delivery', 65, 3, '有包含数据、代码和评估的完整项目。'),
    ],
    relations: [
      { toCode: 'J-AI-001', relationType: 'transfers_to', description: '强化模型工程和产品集成后可转向 AI 应用工程。' },
      { toCode: 'J-DA-001', relationType: 'related_to', description: '数据分析是相邻且常见的入门方向。' },
    ],
    citations: [citation('J-DS-001', 'Data Scientists', 'https://www.onetonline.org/link/summary/15-2051.00', '职业工作包括将原始数据转化为有意义的信息，并使用建模与可视化方法。')],
  },
  {
    code: 'J-AI-001', name: 'AI 应用工程师', category: '数据与智能',
    summary: '将机器学习或大模型能力集成进可靠的应用系统。',
    description: '负责模型调用、数据流程、评估、检索增强和应用工程交付。',
    entryLevel: '适合具有软件开发、机器学习基础和 AI 应用项目的学生。',
    requirements: [
      requirement('machine_learning', 68, 4, '理解模型能力、评估与基本风险。'),
      requirement('backend_engineering', 68, 4, '能构建模型服务和业务接口。'),
      requirement('data_analysis', 62, 3, '能处理评估集和分析输出质量。'),
      requirement('software_fundamentals', 70, 4, '具备可靠的软件工程基础。'),
      requirement('project_delivery', 72, 5, '有真实可运行的 AI 应用与评估证据。'),
      requirement('continuous_learning', 72, 3, '能跟踪快速变化的模型与工具。'),
    ],
    relations: [
      { toCode: 'J-DS-001', relationType: 'related_to', description: '与数据科学在建模与评估上高度相关。' },
      { toCode: 'J-BE-001', relationType: 'related_to', description: '可靠 AI 应用需要扎实的服务端工程能力。' },
    ],
    citations: [citation('J-AI-001', 'Software Developers', 'https://www.onetonline.org/link/summary/15-1252.00', 'AI 应用工程仍以需求分析、软件设计、实现和维护等工程任务为基础。')],
  },
  {
    code: 'J-PM-001', name: '产品经理', category: '产品与设计',
    summary: '识别用户和业务问题，组织团队持续交付产品价值。',
    description: '负责用户需求、产品目标、优先级、方案协作和效果验证。',
    entryLevel: '适合具有用户研究、产品分析和跨团队项目经历的学生。',
    requirements: [
      requirement('product_discovery', 75, 5, '能进行需求分析、问题定义和优先级判断。'),
      requirement('ux_research', 62, 3, '能收集并验证用户需求。'),
      requirement('data_analysis', 58, 3, '能使用数据支持产品决策。'),
      requirement('communication', 75, 5, '能与设计、研发和业务清晰协作。'),
      requirement('project_delivery', 65, 4, '有推动方案落地和复盘的经历。'),
      requirement('career_exploration', 60, 2, '对行业和岗位边界有清楚认识。'),
    ],
    relations: [
      { toCode: 'J-UX-001', relationType: 'related_to', description: '用户研究和体验设计是高度相关方向。' },
      { toCode: 'J-DA-001', relationType: 'related_to', description: '数据分析可强化产品决策与效果评估。' },
    ],
    citations: [citation('J-PM-001', 'Marketing Managers', 'https://www.onetonline.org/link/summary/11-2021.00', '相邻职业任务包括识别需求、制定策略并协调跨职能活动。')],
  },
  {
    code: 'J-UX-001', name: '用户体验设计师', category: '产品与设计',
    summary: '基于用户研究设计清晰、可用且一致的数字体验。',
    description: '负责研究、信息架构、交互原型、可用性验证和设计协作。',
    entryLevel: '适合具有研究、交互设计和完整案例作品集的学生。',
    requirements: [
      requirement('ux_research', 72, 5, '能规划研究并从证据形成洞察。'),
      requirement('visual_design', 68, 4, '能完成信息层级、交互与视觉表达。'),
      requirement('product_discovery', 62, 3, '能将用户问题连接到产品目标。'),
      requirement('communication', 68, 4, '能阐明设计理由并处理反馈。'),
      requirement('portfolio', 75, 5, '作品集能呈现过程、个人贡献与结果。'),
      requirement('problem_solving', 65, 3, '能在限制条件下迭代方案。'),
    ],
    relations: [
      { toCode: 'J-PM-001', relationType: 'related_to', description: '可向用户研究或产品管理方向拓展。' },
      { toCode: 'J-FE-001', relationType: 'transfers_to', description: '补足前端工程能力后可转向设计工程或前端开发。' },
    ],
    citations: [citation('J-UX-001', 'Web and Digital Interface Designers', 'https://www.onetonline.org/link/summary/15-1255.00', '职业任务包括设计数字界面的布局、功能、导航和可用性。')],
  },
  {
    code: 'J-QA-001', name: '软件测试工程师', category: '软件与互联网',
    summary: '通过测试设计、自动化和质量分析降低软件交付风险。',
    description: '负责测试策略、用例、缺陷分析、自动化和质量反馈。',
    entryLevel: '适合具有软件基础、测试实践和自动化项目的学生。',
    requirements: [
      requirement('testing', 75, 5, '掌握测试设计、缺陷管理和自动化基础。'),
      requirement('software_fundamentals', 62, 3, '理解软件结构和开发流程。'),
      requirement('problem_solving', 70, 4, '能复现、隔离和描述问题。'),
      requirement('project_delivery', 60, 3, '有参与版本验证或质量改进的经历。'),
      requirement('communication', 65, 3, '能清晰沟通风险与复现步骤。'),
      requirement('continuous_learning', 58, 2, '能学习新的测试工具和系统。'),
    ],
    relations: [
      { toCode: 'J-DO-001', relationType: 'transfers_to', description: '强化自动化和交付流水线后可转向 DevOps。' },
      { toCode: 'J-FE-001', relationType: 'related_to', description: '具备前端基础有助于 Web 自动化测试。' },
    ],
    citations: [citation('J-QA-001', 'Software Quality Assurance Analysts and Testers', 'https://www.onetonline.org/link/summary/15-1253.00', '职业任务包括识别软件问题、设计测试并记录缺陷。')],
  },
  {
    code: 'J-DO-001', name: 'DevOps 工程师', category: '云计算与运维',
    summary: '通过云平台、自动化和可观测性提高软件交付可靠性。',
    description: '负责持续交付、基础设施自动化、监控、故障响应和开发协作。',
    entryLevel: '适合具有 Linux、网络、脚本、云平台和部署实践的学生。',
    requirements: [
      requirement('cloud_automation', 75, 5, '能使用云平台、容器和自动化流水线。'),
      requirement('backend_engineering', 58, 3, '理解服务运行方式和接口依赖。'),
      requirement('security', 58, 3, '理解权限、密钥和基础安全控制。'),
      requirement('problem_solving', 75, 5, '能结合日志和指标处理故障。'),
      requirement('project_delivery', 68, 4, '有部署、监控或自动化交付证据。'),
      requirement('communication', 62, 2, '能在故障和变更中跨团队协作。'),
    ],
    relations: [
      { toCode: 'J-BE-001', relationType: 'related_to', description: '服务端基础有助于理解生产系统。' },
      { toCode: 'J-CS-001', relationType: 'transfers_to', description: '强化安全运营能力后可转向云安全或安全工程。' },
    ],
    citations: [citation('J-DO-001', 'Network and Computer Systems Administrators', 'https://www.onetonline.org/link/summary/15-1244.00', '相邻职业任务包含安装、配置、维护系统并监控其可用性。')],
  },
  {
    code: 'J-CS-001', name: '信息安全分析师', category: '网络与安全',
    summary: '识别安全风险，实施控制并响应信息系统安全事件。',
    description: '负责风险分析、安全监控、漏洞治理、事件响应和安全沟通。',
    entryLevel: '适合具有网络、操作系统、安全基础和实验实践的学生。',
    requirements: [
      requirement('security', 78, 5, '掌握网络、系统和应用安全基础。'),
      requirement('software_fundamentals', 62, 3, '理解程序、网络与系统运行机制。'),
      requirement('cloud_automation', 58, 2, '理解云环境与自动化控制。'),
      requirement('problem_solving', 75, 5, '能分析异常、威胁和事件证据。'),
      requirement('project_delivery', 65, 3, '有靶场、审计或防护项目证据。'),
      requirement('continuous_learning', 70, 3, '能持续跟进漏洞、攻防和治理知识。'),
    ],
    relations: [
      { toCode: 'J-DO-001', relationType: 'related_to', description: '云基础设施和运营能力与安全工作密切相关。' },
      { toCode: 'J-BE-001', relationType: 'related_to', description: '服务端工程基础有助于应用安全分析。' },
    ],
    citations: [citation('J-CS-001', 'Information Security Analysts', 'https://www.onetonline.org/link/summary/15-1212.00', '职业任务包括规划、实施和监控保护信息系统的安全措施。')],
  },
  {
    code: 'J-MO-001', name: '移动应用开发工程师', category: '软件与互联网',
    summary: '设计和实现稳定、易用的 iOS、Android 或跨端应用。',
    description: '负责移动端界面、状态、网络、性能、测试与发布。',
    entryLevel: '适合具有移动开发基础和至少一个可安装应用项目的学生。',
    requirements: [
      requirement('mobile_engineering', 75, 5, '掌握至少一种移动端技术栈及平台规范。'),
      requirement('software_fundamentals', 65, 4, '具备编程、数据结构和软件设计基础。'),
      requirement('testing', 58, 2, '能验证关键交互和设备兼容性。'),
      requirement('project_delivery', 70, 5, '有可安装、可演示的应用成果。'),
      requirement('problem_solving', 68, 3, '能处理网络、状态和性能问题。'),
      requirement('portfolio', 62, 2, '能展示产品效果和个人贡献。'),
    ],
    relations: [
      { toCode: 'J-FE-001', relationType: 'related_to', description: '跨端框架和界面工程与前端方向相关。' },
      { toCode: 'J-FS-001', relationType: 'progresses_to', description: '补足服务端能力后可承担移动产品端到端开发。' },
    ],
    citations: [citation('J-MO-001', 'Software Developers', 'https://www.onetonline.org/link/summary/15-1252.00', '移动应用开发属于软件设计、实现、测试与维护的工程工作。')],
  },
];

export const DEMO_OCCUPATION_BY_CODE = new Map(
  DEMO_OCCUPATIONS.map((occupation) => [occupation.code, occupation]),
);
