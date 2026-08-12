import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { submitCareerEvidence } from '@/lib/career/service';

const evidenceSchema = z.object({
  occupationCode: z.string().trim().min(1).max(64),
  abilityCode: z.string().trim().min(1).max(128),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(2).max(2000),
  sourceUrl: z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:', {
    message: 'sourceUrl must use HTTPS.',
  }).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const parsed = evidenceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ evidence: await submitCareerEvidence(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return careerApiError(error, 'POST /api/career/evidence');
  }
}
