import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { generateCareerReport, listCareerReportVersions } from '@/lib/career/ai-report-service';

export const maxDuration = 60;

export async function GET() {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  return NextResponse.json({ reports: await listCareerReportVersions(context.context.actor.userId) });
}

export async function POST(request: NextRequest) {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  const body = await request.json().catch(() => null) as { modelId?: string; locale?: string; mode?: 'generate' | 'polish'; sourceVersionId?: string } | null;
  if (!body?.modelId || !['generate', 'polish', undefined].includes(body.mode)) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  const result = await generateCareerReport({
    context: context.context, modelId: body.modelId,
    locale: body.locale?.startsWith('zh') ? 'zh-CN' : 'en',
    mode: body.mode ?? 'generate', sourceVersionId: body.sourceVersionId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  return NextResponse.json({ report: result.data, operationId: result.operationId }, { status: 201 });
}
