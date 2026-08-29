export type AssessmentLocale = 'zh' | 'en';

export type CareerSelfAssessment = {
  version: 1;
  answers: Record<string, number>;
  completedAt: string | null;
  updatedAt: string;
  results: {
    interestCodes: string[];
    personalityType: string | null;
    valueCodes: string[];
    learningCodes: string[];
  };
};

type Copy = { zh: string; en: string };

export type AssessmentQuestion = {
  id: string;
  section: 'interests' | 'personality' | 'values' | 'learning';
  code: string;
  prompt: Copy;
  left?: Copy;
  right?: Copy;
};

const statement = (id: string, section: AssessmentQuestion['section'], code: string, zh: string, en: string): AssessmentQuestion => ({
  id, section, code, prompt: { zh, en },
});

export const CAREER_ASSESSMENT_QUESTIONS: AssessmentQuestion[] = [
  statement('interest-r', 'interests', 'realistic', '我喜欢动手操作、制作或解决现场问题。', 'I enjoy hands-on work, making things, or solving practical problems.'),
  statement('interest-i', 'interests', 'investigative', '我喜欢分析数据、研究原因和验证假设。', 'I enjoy analyzing data, investigating causes, and testing hypotheses.'),
  statement('interest-a', 'interests', 'artistic', '我喜欢创作、表达和探索不同的呈现方式。', 'I enjoy creating, expressing ideas, and exploring new forms.'),
  statement('interest-s', 'interests', 'social', '我喜欢帮助、教学或支持他人成长。', 'I enjoy helping, teaching, or supporting others to grow.'),
  statement('interest-e', 'interests', 'enterprising', '我喜欢推动决策、说服他人或带领项目。', 'I enjoy influencing decisions, persuading others, or leading projects.'),
  statement('interest-c', 'interests', 'conventional', '我喜欢清晰流程、准确记录和有序执行。', 'I enjoy clear processes, accurate records, and organized execution.'),
  statement('interest-r-2', 'interests', 'realistic', '我愿意使用工具、设备或材料完成具体成果。', 'I like using tools, equipment, or materials to produce tangible results.'),
  statement('interest-r-3', 'interests', 'realistic', '比起抽象讨论，我更喜欢处理真实场景中的问题。', 'I prefer solving problems in real settings over abstract discussion.'),
  statement('interest-r-4', 'interests', 'realistic', '我对工程、制造、户外或技术操作类活动感兴趣。', 'Engineering, manufacturing, outdoor, or technical activities interest me.'),
  statement('interest-r-5', 'interests', 'realistic', '看到一个方案被实际建成或运行会让我有成就感。', 'Seeing a plan built or put into operation gives me satisfaction.'),
  statement('interest-i-2', 'interests', 'investigative', '遇到复杂问题时，我会主动查找资料并比较证据。', 'With complex problems, I actively research and compare evidence.'),
  statement('interest-i-3', 'interests', 'investigative', '我享受发现规律、建立模型或解释现象。', 'I enjoy finding patterns, building models, or explaining phenomena.'),
  statement('interest-i-4', 'interests', 'investigative', '我愿意长时间专注于需要推理的任务。', 'I am willing to focus for a long time on tasks that require reasoning.'),
  statement('interest-i-5', 'interests', 'investigative', '科学、数据或研究类工作会激发我的好奇心。', 'Science, data, or research work stimulates my curiosity.'),
  statement('interest-a-2', 'interests', 'artistic', '我喜欢用文字、视觉、音乐或产品表达想法。', 'I like expressing ideas through writing, visuals, music, or products.'),
  statement('interest-a-3', 'interests', 'artistic', '我倾向于寻找不止一种解决方式。', 'I tend to look for more than one way to solve a problem.'),
  statement('interest-a-4', 'interests', 'artistic', '开放、允许试验的任务比固定流程更吸引我。', 'Open-ended tasks that allow experimentation appeal to me more than fixed routines.'),
  statement('interest-a-5', 'interests', 'artistic', '创造有辨识度的作品会让我感到满足。', 'Creating distinctive work gives me satisfaction.'),
  statement('interest-s-2', 'interests', 'social', '我愿意倾听他人的困难并提供支持。', 'I am willing to listen to other people’s difficulties and support them.'),
  statement('interest-s-3', 'interests', 'social', '解释知识或帮助别人理解会让我有成就感。', 'Explaining knowledge or helping someone understand feels rewarding.'),
  statement('interest-s-4', 'interests', 'social', '我关注团队氛围和成员的感受。', 'I pay attention to team climate and how members feel.'),
  statement('interest-s-5', 'interests', 'social', '教育、医疗、咨询或公共服务类工作吸引我。', 'Education, healthcare, counseling, or public service work appeals to me.'),
  statement('interest-e-2', 'interests', 'enterprising', '我喜欢为一个想法争取资源和支持。', 'I enjoy securing resources and support for an idea.'),
  statement('interest-e-3', 'interests', 'enterprising', '在不确定情况下，我愿意做决定并承担结果。', 'I am willing to decide under uncertainty and own the outcome.'),
  statement('interest-e-4', 'interests', 'enterprising', '我享受谈判、展示或推动合作达成。', 'I enjoy negotiating, presenting, or moving a partnership forward.'),
  statement('interest-e-5', 'interests', 'enterprising', '商业、管理或创业机会会激发我的行动力。', 'Business, management, or entrepreneurial opportunities energize me.'),
  statement('interest-c-2', 'interests', 'conventional', '我擅长把复杂任务拆成清晰步骤。', 'I am good at turning complex work into clear steps.'),
  statement('interest-c-3', 'interests', 'conventional', '核对细节并减少错误会让我感到安心。', 'Checking details and reducing errors gives me confidence.'),
  statement('interest-c-4', 'interests', 'conventional', '我喜欢维护表格、档案、预算或标准流程。', 'I like maintaining records, spreadsheets, budgets, or standard procedures.'),
  statement('interest-c-5', 'interests', 'conventional', '明确规则和可预期的工作节奏适合我。', 'Clear rules and a predictable work rhythm suit me.'),
  { id: 'personality-ei', section: 'personality', code: 'IE', prompt: { zh: '恢复精力时，我更偏向……', en: 'To recharge, I tend to prefer…' }, left: { zh: '独处与深入思考（I）', en: 'Solitude and reflection (I)' }, right: { zh: '交流与共同活动（E）', en: 'Interaction and shared activity (E)' } },
  { id: 'personality-sn', section: 'personality', code: 'SN', prompt: { zh: '理解信息时，我更依赖……', en: 'When understanding information, I rely more on…' }, left: { zh: '事实与具体经验（S）', en: 'Facts and concrete experience (S)' }, right: { zh: '模式与未来可能（N）', en: 'Patterns and future possibilities (N)' } },
  { id: 'personality-tf', section: 'personality', code: 'TF', prompt: { zh: '做决定时，我通常先考虑……', en: 'When deciding, I usually consider first…' }, left: { zh: '逻辑与一致标准（T）', en: 'Logic and consistent criteria (T)' }, right: { zh: '价值与对人的影响（F）', en: 'Values and impact on people (F)' } },
  { id: 'personality-jp', section: 'personality', code: 'JP', prompt: { zh: '面对任务时，我更舒服的方式是……', en: 'With tasks, I am more comfortable…' }, left: { zh: '先计划并尽早确定（J）', en: 'Planning and deciding early (J)' }, right: { zh: '保留选择并灵活调整（P）', en: 'Keeping options open and adapting (P)' } },
  { id: 'personality-ei-2', section: 'personality', code: 'IE', prompt: { zh: '形成想法时，我更常……', en: 'When forming ideas, I more often…' }, left: { zh: '先在心里想清楚（I）', en: 'Think it through internally first (I)' }, right: { zh: '边交流边形成想法（E）', en: 'Develop ideas through conversation (E)' } },
  { id: 'personality-ei-3', section: 'personality', code: 'IE', prompt: { zh: '参加活动后，我通常……', en: 'After a group event, I usually…' }, left: { zh: '需要安静时间恢复（I）', en: 'Need quiet time to recover (I)' }, right: { zh: '因互动而更有能量（E）', en: 'Feel energized by the interaction (E)' } },
  { id: 'personality-sn-2', section: 'personality', code: 'SN', prompt: { zh: '学习新内容时，我更喜欢……', en: 'When learning something new, I prefer…' }, left: { zh: '具体步骤和实例（S）', en: 'Concrete steps and examples (S)' }, right: { zh: '整体概念和关联（N）', en: 'Big-picture concepts and connections (N)' } },
  { id: 'personality-sn-3', section: 'personality', code: 'SN', prompt: { zh: '描述事情时，我更关注……', en: 'When describing something, I focus more on…' }, left: { zh: '已经发生的细节（S）', en: 'Details of what actually happened (S)' }, right: { zh: '可能意味着什么（N）', en: 'What it might mean or become (N)' } },
  { id: 'personality-tf-2', section: 'personality', code: 'TF', prompt: { zh: '处理分歧时，我更先……', en: 'When handling disagreement, I first…' }, left: { zh: '分析观点是否合理（T）', en: 'Analyze whether the argument is sound (T)' }, right: { zh: '理解各方感受与需要（F）', en: 'Understand people’s feelings and needs (F)' } },
  { id: 'personality-tf-3', section: 'personality', code: 'TF', prompt: { zh: '评价方案时，我更看重……', en: 'When evaluating a plan, I value more…' }, left: { zh: '客观原则与效率（T）', en: 'Objective principles and efficiency (T)' }, right: { zh: '价值一致与关系影响（F）', en: 'Value alignment and relational impact (F)' } },
  { id: 'personality-jp-2', section: 'personality', code: 'JP', prompt: { zh: '安排一周时，我更倾向……', en: 'When arranging a week, I prefer…' }, left: { zh: '提前确定计划（J）', en: 'Settling the plan in advance (J)' }, right: { zh: '根据情况再决定（P）', en: 'Deciding as circumstances develop (P)' } },
  { id: 'personality-jp-3', section: 'personality', code: 'JP', prompt: { zh: '临近截止日期时，我通常……', en: 'As a deadline approaches, I usually…' }, left: { zh: '大部分工作已经完成（J）', en: 'Have most work completed (J)' }, right: { zh: '仍在根据新信息调整（P）', en: 'Am still adapting to new information (P)' } },
  statement('value-growth', 'values', 'growth', '持续学习和获得新挑战对我很重要。', 'Continuous learning and new challenges matter to me.'),
  statement('value-impact', 'values', 'impact', '工作能产生可见的社会或用户价值对我很重要。', 'Creating visible value for users or society matters to me.'),
  statement('value-autonomy', 'values', 'autonomy', '拥有自主空间和决策权对我很重要。', 'Autonomy and decision-making freedom matter to me.'),
  statement('value-stability', 'values', 'stability', '稳定预期、保障和清晰边界对我很重要。', 'Predictability, security, and clear boundaries matter to me.'),
  statement('value-recognition', 'values', 'recognition', '成果被认可并获得发展机会对我很重要。', 'Recognition and advancement opportunities matter to me.'),
  statement('value-growth-2', 'values', 'growth', '工作能持续扩展我的能力边界对我很重要。', 'It matters that work continually expands my capabilities.'),
  statement('value-growth-3', 'values', 'growth', '我希望组织提供明确的学习和晋升空间。', 'I want an organization to provide clear learning and advancement opportunities.'),
  statement('value-growth-4', 'values', 'growth', '有难度但能成长的任务比重复任务更吸引我。', 'Challenging work that helps me grow appeals more than repetitive work.'),
  statement('value-impact-2', 'values', 'impact', '我希望能清楚看到自己的工作帮助了谁。', 'I want to see clearly who benefits from my work.'),
  statement('value-impact-3', 'values', 'impact', '即使回报相近，我也更愿意选择有意义的工作。', 'With similar rewards, I prefer work that feels meaningful.'),
  statement('value-autonomy-2', 'values', 'autonomy', '我希望能自主选择完成任务的方法。', 'I want freedom to choose how I complete my work.'),
  statement('value-autonomy-3', 'values', 'autonomy', '被信任并对结果负责比频繁被监督更适合我。', 'Being trusted and accountable suits me better than close supervision.'),
  statement('value-stability-2', 'values', 'stability', '稳定收入和可持续的工作节奏对我很重要。', 'Stable income and a sustainable work rhythm matter to me.'),
  statement('value-stability-3', 'values', 'stability', '我看重清晰制度、福利和长期保障。', 'I value clear policies, benefits, and long-term security.'),
  statement('value-recognition-2', 'values', 'recognition', '我希望优秀表现能得到及时、具体的反馈。', 'I want strong performance to receive timely, specific feedback.'),
  statement('value-recognition-3', 'values', 'recognition', '承担更大责任并获得相应认可对我很重要。', 'Taking greater responsibility and receiving recognition matters to me.'),
  statement('learning-visual', 'learning', 'visual', '图表、示例和可视化演示能帮助我学得更快。', 'Charts, examples, and visual demonstrations help me learn faster.'),
  statement('learning-practice', 'learning', 'practice', '亲自练习和做项目能帮助我学得更快。', 'Hands-on practice and projects help me learn faster.'),
  statement('learning-reading', 'learning', 'reading', '阅读并整理文字笔记能帮助我学得更快。', 'Reading and organizing written notes help me learn faster.'),
  statement('learning-social', 'learning', 'discussion', '讨论、讲解给别人听和及时反馈能帮助我学得更快。', 'Discussion, teaching others, and timely feedback help me learn faster.'),
];

const rankingLabels: Record<string, Copy> = {
  realistic: { zh: '实践操作', en: 'Practical' }, investigative: { zh: '研究分析', en: 'Investigative' },
  artistic: { zh: '创意表达', en: 'Creative' }, social: { zh: '助人协作', en: 'Social' },
  enterprising: { zh: '影响推动', en: 'Enterprising' }, conventional: { zh: '秩序执行', en: 'Organized' },
  growth: { zh: '成长挑战', en: 'Growth' }, impact: { zh: '价值影响', en: 'Impact' },
  autonomy: { zh: '自主空间', en: 'Autonomy' }, stability: { zh: '稳定保障', en: 'Stability' },
  recognition: { zh: '认可发展', en: 'Recognition' }, visual: { zh: '视觉示例', en: 'Visual' },
  practice: { zh: '实践项目', en: 'Hands-on' }, reading: { zh: '阅读笔记', en: 'Reading' },
  discussion: { zh: '讨论反馈', en: 'Discussion' },
};

export function assessmentLabel(code: string, locale: AssessmentLocale): string {
  return rankingLabels[code]?.[locale] ?? code;
}

export function scoreAssessmentDimensions(section: AssessmentQuestion['section'], answers: Record<string, number>) {
  const groups = new Map<string, number[]>();
  for (const question of CAREER_ASSESSMENT_QUESTIONS.filter((item) => item.section === section)) {
    const value = answers[question.id];
    if (!Number.isFinite(value)) continue;
    groups.set(question.code, [...(groups.get(question.code) ?? []), value]);
  }
  return Object.fromEntries([...groups].map(([code, values]) => [
    code,
    Math.round(((values.reduce((sum, value) => sum + value, 0) / values.length) - 1) * 25),
  ]));
}

function topCodes(section: AssessmentQuestion['section'], answers: Record<string, number>, count: number) {
  return Object.entries(scoreAssessmentDimensions(section, answers))
    .map(([code, score]) => ({ code, score }))
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, count)
    .filter((item) => item.score > 0)
    .map((item) => item.code);
}

export function scoreSelfAssessment(answers: Record<string, number>): CareerSelfAssessment['results'] {
  const bySection = (section: AssessmentQuestion['section']) => CAREER_ASSESSMENT_QUESTIONS.filter((item) => item.section === section);
  const personalityDimensions = scoreAssessmentDimensions('personality', answers);
  const personalityType = bySection('personality').every((item) => answers[item.id])
    ? ['IE', 'SN', 'TF', 'JP'].map((code) => {
        const [left, right] = code.split('');
        return (personalityDimensions[code] ?? 50) <= 50 ? left : right;
      }).join('')
    : null;
  return {
    interestCodes: topCodes('interests', answers, 3),
    personalityType,
    valueCodes: topCodes('values', answers, 3),
    learningCodes: topCodes('learning', answers, 2),
  };
}

export function isAssessmentComplete(answers: Record<string, number>): boolean {
  return CAREER_ASSESSMENT_QUESTIONS.every((question) => Number.isInteger(answers[question.id]) && answers[question.id] >= 1 && answers[question.id] <= 5);
}
