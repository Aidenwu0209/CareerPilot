import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { resolveActiveContext } from '@/lib/auth/guards';
import { checkReportCompleteness } from '@/lib/career/ai-report-service';
import { db } from '@/lib/db';
import { careerReportVersions } from '@/lib/db/schema';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  const { id } = await params;
  const [report] = await db.select().from(careerReportVersions).where(and(
    eq(careerReportVersions.id, id), eq(careerReportVersions.userId, context.context.actor.userId),
  )).limit(1);
  if (!report) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json(checkReportCompleteness(report.markdown));
}
