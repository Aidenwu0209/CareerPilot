import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { resolveActiveContext } from '@/lib/auth/guards';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { generateResumeInputSchema, type GenerateResumeOutput } from '@/lib/ai/generate-resume-schema';
import { executeAiOperation } from '@/lib/ai/gateway';
import { buildModel, getJsonOptions } from '@/lib/ai/model-builder';
import { warnLegacyByok } from '@/lib/ai/legacy-detect';

const SECTION_TITLES: Record<string, Record<string, string>> = {
  zh: {
    personal_info: '个人信息',
    summary: '个人简介',
    work_experience: '工作经历',
    education: '教育背景',
    skills: '专业技能',
    projects: '项目经历',
  },
  en: {
    personal_info: 'Personal Information',
    summary: 'Professional Summary',
    work_experience: 'Work Experience',
    education: 'Education',
    skills: 'Skills',
    projects: 'Projects',
  },
};

function getSystemPrompt(language: string): string {
  const lang = language === 'en' ? 'English' : 'Simplified Chinese';

  return `You are a professional resume writer. Generate a complete, realistic, and professional resume in ${lang}.

Resume generation guidelines:
- Generate realistic and professional content that would be appropriate for the given job title and experience level
- Use concrete, quantifiable achievements (e.g., "Increased performance by 40%", "Led a team of 8 engineers")
- Create believable company names, institution names, and project names
- Use strong action verbs to start bullet points (e.g., "Spearheaded", "Architected", "Optimized")
- Dates should be in YYYY-MM format
- For personal_info, generate a plausible name, email, phone, and location — do NOT use obviously fake data like "John Doe" or "jane@example.com"
- Skills should be organized into relevant categories (e.g., "Programming Languages", "Frameworks", "Tools")
- The number of work experience items should scale with years of experience (1-2 for junior, 2-3 for mid, 3-4 for senior)
- Include 1-2 education entries
- Include 2-3 project entries with realistic technologies
- Each work experience and project should have 3-5 highlight bullet points
- CRITICAL: You are a JSON API. Your entire response must be a single valid JSON object starting with { and ending with }. Do NOT use markdown syntax. Do NOT wrap in code fences. Do NOT add any text before or after the JSON.`;
}

import { extractJson } from '@/lib/ai/extract-json';
import { normalizeSectionContent } from '@/lib/resume/normalize-content';
import { z } from 'zod/v4';

const generateResumeOutputSchema = z.object({
  personal_info: z.any(),
  summary: z.any(),
  work_experience: z.any(),
  education: z.any(),
  skills: z.any(),
  projects: z.any(),
});

export async function POST(request: NextRequest) {
  await warnLegacyByok(request);
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const parsed = generateResumeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { jobTitle, yearsOfExperience, skills, industry, experience, template, language } = parsed.data;
  const lang = language || 'zh';

  const skillsContext = skills && skills.length > 0
    ? `\nKey skills to incorporate: ${skills.join(', ')}`
    : '';
  const industryContext = industry
    ? `\nIndustry: ${industry}`
    : '';
  const experienceContext = experience
    ? `\n\nThe candidate provided the following work experience description. Parse this into structured work_experience items, and use it to inform the summary, skills, and projects sections:\n---\n${experience}\n---`
    : '';

  const promptText = `Generate a complete resume for a ${jobTitle} ${yearsOfExperience === 0 ? 'at entry level (fresh graduate / no prior experience)' : `with ${yearsOfExperience} years of experience`}.${skillsContext}${industryContext}${experienceContext}

Return a JSON object with these exact top-level keys: personal_info, summary, work_experience, education, skills, projects.

The structure must be:
- personal_info: { fullName, jobTitle, email, phone, location, website?, linkedin?, github? }
- summary: { text }
- work_experience: { items: [{ company, position, location?, startDate, endDate (null if current), current, description, highlights: string[] }] }
- education: { items: [{ institution, degree, field, location?, startDate, endDate, gpa?, highlights: string[] }] }
- skills: { categories: [{ name, skills: string[] }] }
- projects: { items: [{ name, url?, startDate?, endDate?, description, technologies: string[], highlights: string[] }] }

Respond with JSON only.`;

  // Execute through unified gateway
  const result = await executeAiOperation({
    context: ctx.context,
    modelId: 'generate-resume-default',
    capability: 'text',
    businessCapability: 'generate_resume',
    idempotencyKey: `gen-resume-${ctx.context.actor.userId}-${Date.now()}`,
    dispatch: async (gwCtx) => {
      const model = buildModel(gwCtx);
      const jsonOpts = getJsonOptions(gwCtx.providerType);

      // Retry without JSON mode if the provider rejects it
      try {
        const aiResult = await generateText({
          model,
          maxOutputTokens: 16384,
          system: getSystemPrompt(lang),
          prompt: promptText,
          providerOptions: jsonOpts,
        });
        return { text: aiResult.text, usage: aiResult.usage };
      } catch (err) {
        if (Object.keys(jsonOpts).length > 0) {
          const aiResult = await generateText({
            model,
            maxOutputTokens: 16384,
            system: getSystemPrompt(lang),
            prompt: promptText,
            providerOptions: {},
          });
          return { text: aiResult.text, usage: aiResult.usage };
        }
        throw err;
      }
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status }
    );
  }

  const generatedData: GenerateResumeOutput = extractJson(result.data.text, generateResumeOutputSchema) as GenerateResumeOutput;

  // Create a new resume in the database
  const resumeTitle = lang === 'zh'
    ? `${jobTitle} - AI生成简历`
    : `${jobTitle} - AI Generated Resume`;

  const newResume = await resumeRepository.create({
    userId: ctx.context.actor.userId,
    title: resumeTitle,
    template: template || 'classic',
    language: lang,
  });

  if (!newResume) {
    return NextResponse.json({ error: 'Failed to create resume' }, { status: 500 });
  }

  // Create sections
  const titles = SECTION_TITLES[lang] || SECTION_TITLES.zh;
  const sectionTypes = ['personal_info', 'summary', 'work_experience', 'education', 'skills', 'projects'] as const;

  for (let i = 0; i < sectionTypes.length; i++) {
    const type = sectionTypes[i];
    const content = generatedData[type];

    await resumeRepository.createSection({
      resumeId: newResume.id,
      type,
      title: titles[type],
      sortOrder: i,
      content: normalizeSectionContent(type, content),
    });
  }

  const completeResume = await resumeRepository.findById(newResume.id);

  return NextResponse.json({
    resumeId: newResume.id,
    title: resumeTitle,
    sections: completeResume?.sections || [],
  });
}
