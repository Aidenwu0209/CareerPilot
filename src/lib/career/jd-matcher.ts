import type { OccupationDetail, OccupationSummary } from '@/types/career';

const normalized = (value: string) => value.toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();

function englishTokens(value: string): string[] {
  return [...new Set(normalized(value).match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [])];
}

export type RankedOccupation = { occupation: OccupationSummary; score: number; matchedTerms: string[] };

export function rankOccupationsFromJd(jd: string, occupations: OccupationSummary[]): RankedOccupation[] {
  const haystack = normalized(jd);
  const jdTokens = new Set(englishTokens(jd));
  return occupations.map((occupation) => {
    const primary = [occupation.name, ...(occupation.aliases ?? [])].filter(Boolean);
    const secondary = [occupation.category, occupation.jobFamily, occupation.industry].filter((item): item is string => Boolean(item));
    const matchedTerms: string[] = [];
    let score = 0;
    for (const term of primary) {
      if (term.length >= 2 && haystack.includes(normalized(term))) { score += term === occupation.name ? 10 : 7; matchedTerms.push(term); }
    }
    for (const term of secondary) {
      if (term.length >= 2 && haystack.includes(normalized(term))) { score += 3; matchedTerms.push(term); }
    }
    const sourceTokens = englishTokens(`${occupation.name} ${(occupation.aliases ?? []).join(' ')} ${occupation.summary}`);
    const tokenMatches = sourceTokens.filter((token) => jdTokens.has(token));
    score += Math.min(tokenMatches.length, 6);
    matchedTerms.push(...tokenMatches);
    return { occupation, score, matchedTerms: [...new Set(matchedTerms)].slice(0, 10) };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.occupation.name.localeCompare(b.occupation.name, 'zh-CN'));
}

export function extractRequirementTerms(jd: string, occupation: OccupationDetail): string[] {
  const haystack = normalized(jd);
  return occupation.requirements.flatMap((requirement) => {
    const candidates = [requirement.abilityName, ...englishTokens(requirement.description)];
    return candidates.filter((term) => normalized(term).length >= 2 && haystack.includes(normalized(term)));
  }).filter((term, index, all) => all.indexOf(term) === index).slice(0, 12);
}
