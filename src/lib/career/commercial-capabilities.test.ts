import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));

import { checkReportCompleteness } from './ai-report-service';
import { dateKey } from './growth-service';
import { normalizeSkillList, parseMonthlySalary } from './job-posting-service';

describe('remaining commercial capability helpers', () => {
  it('accepts complete Chinese and English career report structures', () => {
    const zh = '# 报告\n## 职业目标\n## 核心指标\n## 自我测评\n## 成长路径\n## 人岗匹配\n## 行动建议';
    const en = '# Report\n## Career goal\n## Readiness metrics\n## Self assessment\n## Growth roadmap\n## Job match and gaps\n## Next actions';
    expect(checkReportCompleteness(zh).complete).toBe(true);
    expect(checkReportCompleteness(en).complete).toBe(true);
    expect(checkReportCompleteness('# Report\n## Goal').missingSections.length).toBeGreaterThan(0);
  });

  it('normalizes common salary and skill formats deterministically', () => {
    expect(parseMonthlySalary('15-25K·14薪')).toEqual({ min: 15_000, max: 25_000, months: 14 });
    expect(parseMonthlySalary('18-30万/年')).toEqual({ min: 15_000, max: 25_000, months: 12 });
    expect(normalizeSkillList('TypeScript、React, TypeScript')).toEqual(['TypeScript', 'React']);
  });

  it('calculates a stable local calendar key with UTC fallback', () => {
    const now = new Date('2026-08-30T16:30:00.000Z');
    expect(dateKey(now, 'Asia/Shanghai')).toBe('2026-08-31');
    expect(dateKey(now, 'not/a-timezone')).toBe('2026-08-30');
  });
});
