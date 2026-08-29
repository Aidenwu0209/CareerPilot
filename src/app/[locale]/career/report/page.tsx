import { setRequestLocale } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { listCareerReportVersions } from '@/lib/career/ai-report-service';
import { CareerPageHeader } from '@/components/career/career-shell';
import { CareerReportWorkspace } from '@/components/career/career-report-workspace';

export default async function CareerReportPage({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, context] = await Promise.all([params, resolveServerContext()]);
  setRequestLocale(locale);
  if (!context) return redirectToLogin('/career/report');
  const reports = await listCareerReportVersions(context.actor.userId);
  const zh = locale.startsWith('zh');
  return <div className="space-y-6 sm:space-y-8"><CareerPageHeader eyebrow={zh ? 'AI 职业报告' : 'AI career report'} title={zh ? '生成、润色并追踪你的职业规划版本' : 'Generate, polish, and track your career plan'} description={zh ? '所有模型调用均通过托管 AI 网关，积分预扣、结算和失败释放会留下可审计记录。' : 'Every model call uses the managed AI gateway with auditable credit holds, settlement, and failure release.'} /><CareerReportWorkspace initialReports={reports} locale={locale} /></div>;
}
