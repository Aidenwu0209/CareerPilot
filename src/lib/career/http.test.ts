import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ resolveActiveContext: vi.fn() }));
vi.mock('@/lib/auth/guards', () => ({ resolveActiveContext: mocks.resolveActiveContext }));
vi.mock('server-only', () => ({}));

import { careerApiError, resolveCareerApiUser } from './http';

beforeEach(() => mocks.resolveActiveContext.mockReset());

describe('career API active-account guard', () => {
  it('returns the authenticated active actor', async () => {
    mocks.resolveActiveContext.mockResolvedValue({ ok: true, context: { actor: { userId: 'active-user' } } });
    await expect(resolveCareerApiUser(new NextRequest('http://localhost/api/career/overview')))
      .resolves.toEqual({ id: 'active-user' });
  });

  it('preserves suspended-account 403 response and never reads a client fingerprint', async () => {
    mocks.resolveActiveContext.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'ACCOUNT_SUSPENDED' }, { status: 403 }),
    });
    try {
      await resolveCareerApiUser(new NextRequest('http://localhost/api/career/overview', {
        headers: { 'x-fingerprint': 'attacker-controlled' },
      }));
      throw new Error('Expected access denial');
    } catch (error) {
      const response = careerApiError(error, 'test');
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'ACCOUNT_SUSPENDED' });
    }
    expect(mocks.resolveActiveContext).toHaveBeenCalledWith();
  });
});
