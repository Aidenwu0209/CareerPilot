import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { CareerGoalRequiredError, CareerNotFoundError, CareerValidationError } from './service';

class CareerAccessDeniedError extends Error {
  constructor(readonly response: NextResponse) {
    super('Career API access denied.');
    this.name = 'CareerAccessDeniedError';
  }
}

export async function resolveCareerApiUser(request: NextRequest) {
  // Never trust a client-provided fingerprint here. The central active-context
  // guard resolves product sessions and only reads the demo cookie when the
  // server is explicitly running in demo mode.
  void request;
  const context = await resolveActiveContext();
  if (context === null) return null;
  if (!context.ok) throw new CareerAccessDeniedError(context.response);
  return { id: context.context.actor.userId };
}

export function careerApiError(error: unknown, route: string): NextResponse {
  if (error instanceof CareerAccessDeniedError) return error.response;
  if (error instanceof CareerGoalRequiredError) {
    return NextResponse.json({ error: 'GOAL_REQUIRED', message: error.message }, { status: 409 });
  }
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
