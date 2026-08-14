import type { CareerMatchResult, CareerOverview, CareerPath } from '@/types/career';
import { assessmentLabel, type AssessmentLocale, type CareerSelfAssessment } from './self-assessment';

export type CareerReportData = {
  overview: CareerOverview;
  path: CareerPath;
  match: CareerMatchResult | null;
  assessment: CareerSelfAssessment | null;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!);
const value = (score: number | null, unknown: string) => score == null ? unknown : `${score}%`;

export function buildCareerReportMarkdown(data: CareerReportData, locale: string): string {
  const lang: AssessmentLocale = locale.startsWith('zh') ? 'zh' : 'en';
  const zh = lang === 'zh';
  const { overview, path, match, assessment } = data;
  const lines = [
    `# ${zh ? 'CareerPilot 职业规划报告' : 'CareerPilot Career Planning Report'}`,
    '', `${zh ? '生成时间' : 'Generated'}: ${new Date(overview.generatedAt).toLocaleString(locale)}`, '',
    `## ${zh ? '职业目标' : 'Career goal'}`,
    overview.primaryGoal ? `- ${overview.primaryGoal.occupationName}` : `- ${zh ? '尚未设置' : 'Not set'}`,
    overview.primaryGoal?.rationale ? `- ${zh ? '选择理由' : 'Rationale'}: ${overview.primaryGoal.rationale}` : '', '',
    `## ${zh ? '核心指标' : 'Core indicators'}`,
    `- ${zh ? '就业准备度' : 'Readiness'}: ${value(overview.indicators.readiness, zh ? '证据不足' : 'Insufficient evidence')}`,
    `- ${zh ? '岗位匹配度' : 'Occupation match'}: ${value(overview.indicators.match, zh ? '证据不足' : 'Insufficient evidence')}`,
    `- ${zh ? '画像完整度' : 'Profile completeness'}: ${overview.indicators.profileCompleteness}%`,
    `- ${zh ? '证据覆盖率' : 'Evidence coverage'}: ${overview.indicators.evidenceCoverage}%`, '',
  ];
  if (assessment?.completedAt) {
    lines.push(`## ${zh ? '自我认知参考' : 'Self-awareness reference'}`,
      `- ${zh ? '兴趣方向' : 'Interest themes'}: ${assessment.results.interestCodes.map((code) => assessmentLabel(code, lang)).join(' · ')}`,
      `- ${zh ? '性格偏好' : 'Personality preference'}: ${assessment.results.personalityType ?? '—'}`,
      `- ${zh ? '工作价值观' : 'Work values'}: ${assessment.results.valueCodes.map((code) => assessmentLabel(code, lang)).join(' · ')}`,
      `- ${zh ? '学习偏好' : 'Learning preferences'}: ${assessment.results.learningCodes.map((code) => assessmentLabel(code, lang)).join(' · ')}`, '');
  }
  lines.push(`## ${zh ? '成长路径' : 'Growth path'}`);
  if (!path.stages.length) lines.push(`- ${zh ? '设置目标后生成成长路径。' : 'Set a goal to generate a growth path.'}`);
  for (const stage of path.stages) {
    lines.push(`### ${stage.title}`, stage.description);
    for (const task of stage.tasks) lines.push(`- [${task.status === 'completed' ? 'x' : ' '}] ${task.title}`);
  }
  if (match) {
    lines.push('', `## ${zh ? '匹配解释' : 'Match explanation'}`,
      `- ${zh ? '评分状态' : 'Scoring status'}: ${match.scoringStatus}`,
      `- ${zh ? '匹配分' : 'Match score'}: ${value(match.score, zh ? '证据不足' : 'Insufficient evidence')}`,
      `- ${zh ? '算法版本' : 'Algorithm version'}: ${match.algorithmVersion}`);
    for (const item of match.priorityGaps ?? []) lines.push(`- ${item.abilityName}: ${item.action}`);
  }
  lines.push('', `> ${zh ? '说明：自我认知问卷仅用于职业探索，不是心理诊断；岗位匹配基于可核验证据，不等同于职业资格或录用结论。' : 'Note: The self-awareness questionnaire supports career exploration and is not a psychological diagnosis. Matching is evidence-based and is not a qualification or hiring decision.'}`);
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

export function buildCareerReportHtml(data: CareerReportData, locale: string): string {
  const markdown = buildCareerReportMarkdown(data, locale);
  const body = markdown.split('\n').map((line) => {
    if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith('### ')) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
    if (line.startsWith('> ')) return `<aside>${escapeHtml(line.slice(2))}</aside>`;
    if (line.startsWith('- ')) return `<p class="item">${escapeHtml(line.slice(2))}</p>`;
    return line ? `<p>${escapeHtml(line)}</p>` : '<div class="space"></div>';
  }).join('');
  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:18mm}body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans SC",sans-serif;color:#18181b;font-size:12px;line-height:1.65}h1{font-size:26px;color:#2563eb;margin:0 0 20px}h2{font-size:18px;border-bottom:1px solid #d4d4d8;padding-bottom:6px;margin:22px 0 10px}h3{font-size:14px;margin:14px 0 4px}.item{margin:3px 0;padding-left:10px}.space{height:5px}aside{margin-top:24px;padding:12px;background:#f4f4f5;border-left:4px solid #3b82f6;color:#52525b}
  </style></head><body>${body}</body></html>`;
}
