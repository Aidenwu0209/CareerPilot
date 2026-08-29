import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { advanceAnalysisRun, getAnalysisRun } from '@/lib/career/analysis-pipeline';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  const run = await getAnalysisRun(context.context.actor.userId, (await params).id);
  return run ? NextResponse.json({ run }) : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  const body = await request.json().catch(() => ({})) as { retry?: boolean };
  try { return NextResponse.json({ run: await advanceAnalysisRun(context.context, (await params).id, body.retry === true) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'RUN_FAILED' }, { status: 409 }); }
}
