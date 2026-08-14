import { NextRequest, NextResponse } from 'next/server';
import { getCareerMatch, getCareerOverview, getCareerPath } from '@/lib/career/service';
import { getCareerSelfAssessment } from '@/lib/career/self-assessment-service';
import { buildCareerReportHtml, buildCareerReportMarkdown } from '@/lib/career/report';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { generatePdf } from '@/lib/pdf/generate-pdf';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const url = new URL(request.url);
    const format = url.searchParams.get('format') === 'markdown' ? 'markdown' : 'pdf';
    const locale = url.searchParams.get('locale')?.startsWith('zh') ? 'zh-CN' : 'en';
    const [overview, path, assessment] = await Promise.all([
      getCareerOverview(user.id), getCareerPath(user.id), getCareerSelfAssessment(user.id),
    ]);
    const match = overview.primaryGoal ? await getCareerMatch(user.id, overview.primaryGoal.occupationCode) : null;
    const data = { overview, path, match, assessment };
    const filename = `careerpilot-career-report-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'markdown') {
      return new NextResponse(buildCareerReportMarkdown(data, locale), {
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${filename}.md"` },
      });
    }
    const pdf = await generatePdf(buildCareerReportHtml(data, locale));
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${filename}.pdf"` },
    });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/report/export');
  }
}
