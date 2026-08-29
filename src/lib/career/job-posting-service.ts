import 'server-only';

import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { companies, jobPostings } from '@/lib/db/schema';
import { getCareerProfile } from './service';

export function parseMonthlySalary(value: string): { min: number | null; max: number | null; months: number } {
  const normalized = value.trim().toLowerCase().replace(/[,，]/g, '');
  const months = Number(normalized.match(/[·x×*](1[2-6])\s*薪/)?.[1] ?? 12);
  const range = normalized.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*(k|千|万|w)?/i);
  if (!range) return { min: null, max: null, months };
  const unit = range[3] ?? '';
  const factor = unit === '万' || unit === 'w' ? 10_000 : unit === 'k' || unit === '千' ? 1_000 : 1;
  let min = Math.round(Number(range[1]) * factor);
  let max = Math.round(Number(range[2]) * factor);
  if (/年|annual|year/.test(normalized)) { min = Math.round(min / 12); max = Math.round(max / 12); }
  return { min, max, months };
}

export function normalizeSkillList(value: string | string[]): string[] {
  const values = Array.isArray(value) ? value : value.split(/[、,，;；|/]/);
  return [...new Set(values.map((item) => item.trim()).filter(Boolean).map((item) => item.slice(0, 80)))];
}

export async function listJobRecommendations(userId: string, options: { industry?: string; sort?: 'match' | 'salary' | 'skills'; limit?: number } = {}) {
  const now = new Date();
  const rows = await db.select({ posting: jobPostings, companyName: companies.name })
    .from(jobPostings).innerJoin(companies, eq(companies.id, jobPostings.companyId))
    .where(and(
      eq(jobPostings.active, true),
      options.industry ? eq(jobPostings.industry, options.industry) : undefined,
      or(isNull(jobPostings.expiresAt), gte(jobPostings.expiresAt, now)),
    )).orderBy(desc(jobPostings.publishedAt)).limit(Math.max(1, Math.min(options.limit ?? 100, 200)));
  const profile = await getCareerProfile(userId);
  const knownSkills = new Set(profile.dimensions.flatMap((dimension) => dimension.abilities)
    .filter((ability) => (ability.score ?? 0) >= 50)
    .flatMap((ability) => [ability.code.toLowerCase(), ability.name.toLowerCase()]));
  const items: Array<typeof jobPostings.$inferSelect & {
    companyName: string;
    skills: string[];
    hitSkills: string[];
    missingSkills: string[];
    skillScore: number;
    matchScore: number;
  }> = rows.map((row: { posting: typeof jobPostings.$inferSelect; companyName: string }) => {
    const skills = normalizeSkillList(row.posting.skills as string[]);
    const hitSkills = skills.filter((skill) => [...knownSkills].some((known) => skill.toLowerCase().includes(known) || known.includes(skill.toLowerCase())));
    const missingSkills = skills.filter((skill) => !hitSkills.includes(skill));
    const skillScore = skills.length ? Math.round(hitSkills.length / skills.length * 100) : 50;
    const occupationBoost = row.posting.occupationCode && profile.dimensions.some((dimension) => dimension.score !== null) ? 10 : 0;
    return { ...row.posting, companyName: row.companyName, skills, hitSkills, missingSkills, skillScore, matchScore: Math.min(100, skillScore + occupationBoost) };
  });
  const sort = options.sort ?? 'match';
  return items.sort((a, b) => sort === 'salary'
    ? (b.salaryMaxMonthly ?? b.salaryMinMonthly ?? 0) - (a.salaryMaxMonthly ?? a.salaryMinMonthly ?? 0)
    : sort === 'skills' ? b.skillScore - a.skillScore
      : b.matchScore - a.matchScore || b.skillScore - a.skillScore);
}

export async function importJobPosting(input: {
  source: string; externalId: string; company: string; industry?: string; title: string; city?: string;
  description?: string; skills?: string | string[]; salary?: string; occupationCode?: string; sourceUrl?: string;
  publishedAt?: string; expiresAt?: string;
}) {
  const normalizedName = input.company.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalizedName || !input.externalId.trim() || !input.source.trim() || !input.title.trim()) throw new Error('INVALID_JOB_ROW');
  await db.insert(companies).values({ id: crypto.randomUUID(), normalizedName, name: input.company.trim(), industry: input.industry?.trim() ?? '' } as never)
    .onConflictDoUpdate({ target: companies.normalizedName, set: { name: input.company.trim(), industry: input.industry?.trim() ?? '', updatedAt: new Date() } });
  const [company] = await db.select().from(companies).where(eq(companies.normalizedName, normalizedName)).limit(1);
  const salary = parseMonthlySalary(input.salary ?? '');
  const values = {
    id: crypto.randomUUID(), source: input.source.trim(), externalId: input.externalId.trim(), companyId: company.id,
    occupationCode: input.occupationCode?.trim() || null, title: input.title.trim(), city: input.city?.trim() ?? '',
    industry: input.industry?.trim() ?? '', description: input.description?.trim() ?? '', skills: normalizeSkillList(input.skills ?? []),
    salaryMinMonthly: salary.min, salaryMaxMonthly: salary.max, salaryMonths: salary.months,
    sourceUrl: input.sourceUrl?.trim() || null, publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, active: true, updatedAt: new Date(),
  };
  const updateValues = {
    companyId: values.companyId, occupationCode: values.occupationCode, title: values.title,
    city: values.city, industry: values.industry, description: values.description, skills: values.skills,
    salaryMinMonthly: values.salaryMinMonthly, salaryMaxMonthly: values.salaryMaxMonthly, salaryMonths: values.salaryMonths,
    sourceUrl: values.sourceUrl, publishedAt: values.publishedAt, expiresAt: values.expiresAt,
    active: values.active, updatedAt: values.updatedAt,
  };
  await db.insert(jobPostings).values(values as never).onConflictDoUpdate({
    target: [jobPostings.source, jobPostings.externalId], set: updateValues as never,
  });
}
