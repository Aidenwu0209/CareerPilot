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
  { id: 'personality-ei', section: 'personality', code: 'IE', prompt: { zh: '恢复精力时，我更偏向……', en: 'To recharge, I tend to prefer…' }, left: { zh: '独处与深入思考（I）', en: 'Solitude and reflection (I)' }, right: { zh: '交流与共同活动（E）', en: 'Interaction and shared activity (E)' } },
  { id: 'personality-sn', section: 'personality', code: 'SN', prompt: { zh: '理解信息时，我更依赖……', en: 'When understanding information, I rely more on…' }, left: { zh: '事实与具体经验（S）', en: 'Facts and concrete experience (S)' }, right: { zh: '模式与未来可能（N）', en: 'Patterns and future possibilities (N)' } },
  { id: 'personality-tf', section: 'personality', code: 'TF', prompt: { zh: '做决定时，我通常先考虑……', en: 'When deciding, I usually consider first…' }, left: { zh: '逻辑与一致标准（T）', en: 'Logic and consistent criteria (T)' }, right: { zh: '价值与对人的影响（F）', en: 'Values and impact on people (F)' } },
  { id: 'personality-jp', section: 'personality', code: 'JP', prompt: { zh: '面对任务时，我更舒服的方式是……', en: 'With tasks, I am more comfortable…' }, left: { zh: '先计划并尽早确定（J）', en: 'Planning and deciding early (J)' }, right: { zh: '保留选择并灵活调整（P）', en: 'Keeping options open and adapting (P)' } },
  statement('value-growth', 'values', 'growth', '持续学习和获得新挑战对我很重要。', 'Continuous learning and new challenges matter to me.'),
  statement('value-impact', 'values', 'impact', '工作能产生可见的社会或用户价值对我很重要。', 'Creating visible value for users or society matters to me.'),
  statement('value-autonomy', 'values', 'autonomy', '拥有自主空间和决策权对我很重要。', 'Autonomy and decision-making freedom matter to me.'),
  statement('value-stability', 'values', 'stability', '稳定预期、保障和清晰边界对我很重要。', 'Predictability, security, and clear boundaries matter to me.'),
  statement('value-recognition', 'values', 'recognition', '成果被认可并获得发展机会对我很重要。', 'Recognition and advancement opportunities matter to me.'),
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

function topCodes(questions: AssessmentQuestion[], answers: Record<string, number>, count: number) {
  return questions
    .map((question) => ({ code: question.code, score: answers[question.id] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, count)
    .filter((item) => item.score > 0)
    .map((item) => item.code);
}

export function scoreSelfAssessment(answers: Record<string, number>): CareerSelfAssessment['results'] {
  const bySection = (section: AssessmentQuestion['section']) => CAREER_ASSESSMENT_QUESTIONS.filter((item) => item.section === section);
  const personalityType = bySection('personality').every((item) => answers[item.id])
    ? bySection('personality').map((item) => {
        const score = answers[item.id];
        const [left, right] = item.code.split('');
        return score <= 3 ? left : right;
      }).join('')
    : null;
  return {
    interestCodes: topCodes(bySection('interests'), answers, 3),
    personalityType,
    valueCodes: topCodes(bySection('values'), answers, 3),
    learningCodes: topCodes(bySection('learning'), answers, 2),
  };
}

export function isAssessmentComplete(answers: Record<string, number>): boolean {
  return CAREER_ASSESSMENT_QUESTIONS.every((question) => Number.isInteger(answers[question.id]) && answers[question.id] >= 1 && answers[question.id] <= 5);
}
