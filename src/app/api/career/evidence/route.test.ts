import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { submitCareerEvidence } = vi.hoisted(() => ({ submitCareerEvidence: vi.fn() }));

vi.mock('@/lib/career/http', () => ({
  resolveCareerApiUser: vi.fn(async () => ({ id: 'student-1' })),
  unauthorizedCareerResponse: vi.fn(),
  careerApiError: vi.fn((error: unknown) => Response.json({ error: String(error) }, { status: 500 })),
}));

vi.mock('@/lib/career/service', () => ({ submitCareerEvidence }));

import { POST } from './route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/career/evidence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => submitCareerEvidence.mockReset());

describe('POST /api/career/evidence', () => {
  it('rejects non-HTTPS source URLs before writing evidence', async () => {
    for (const sourceUrl of ['javascript:alert(1)', 'data:text/plain,test', 'http://example.com/evidence']) {
      const response = await POST(request({
        occupationCode: '15-1252.00',
        abilityCode: 'onet_skill_2_a_2_a',
        title: '软件项目复盘',
        description: '说明本人贡献与验证结果。',
        sourceUrl,
      }));
      expect(response.status).toBe(400);
    }
    expect(submitCareerEvidence).not.toHaveBeenCalled();
  });

  it('passes only the strict unscored submission contract to the service', async () => {
    const body = {
      occupationCode: '15-1252.00',
      abilityCode: 'onet_skill_2_a_2_a',
      title: '软件项目复盘',
      description: '说明本人贡献与验证结果。',
      sourceUrl: 'https://example.com/evidence',
    };
    submitCareerEvidence.mockResolvedValue({ id: 'evidence-1', ...body, status: 'pending', assessedScore: null });
    const response = await POST(request(body));
    expect(response.status).toBe(201);
    expect(submitCareerEvidence).toHaveBeenCalledWith('student-1', body);
    await expect(response.json()).resolves.toMatchObject({ evidence: { status: 'pending', assessedScore: null } });
  });
});
