import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, resolveUser } from '@/lib/auth/helpers';
import { CareerNotFoundError, CareerValidationError } from './service';

export async function resolveCareerApiUser(request: NextRequest) {
  const user = await resolveUser(getUserIdFromRequest(request));
  if (!user) return null;
  return { id: user.id };
}

export function careerApiError(error: unknown, route: string): NextResponse {
  if (error instanceof CareerValidationError) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.message }, { status: 400 });
  }
  if (error instanceof CareerNotFoundError) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  console.error(`${route} error:`, error);
  return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
}

export function unauthorizedCareerResponse(): NextResponse {
  return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
}
