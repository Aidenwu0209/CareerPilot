import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { createAnalysisRun, listAnalysisRuns } from '@/lib/career/analysis-pipeline';

export async function GET() {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  return NextResponse.json({ runs: await listAnalysisRuns(context.context.actor.userId) });
}

export async function POST(request: NextRequest) {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  const body = await request.json().catch(() => null) as { modelId?: string; locale?: string } | null;
  if (!body?.modelId) return NextResponse.json({ error: 'MODEL_REQUIRED' }, { status: 400 });
  const run = await createAnalysisRun(context.context.actor.userId, { modelId: body.modelId, locale: body.locale?.startsWith('zh') ? 'zh-CN' : 'en' });
  return NextResponse.json({ run }, { status: 201 });
}
