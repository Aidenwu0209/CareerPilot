import { z } from 'zod/v4';
import { MAX_PROMPT_LENGTH, MAX_SHORT_TEXT_LENGTH, MAX_ARRAY_LENGTH } from '@/lib/validation/input-limits';

// Input schema for generate-resume API
export const generateResumeInputSchema = z.object({
  jobTitle: z.string().min(1).max(MAX_SHORT_TEXT_LENGTH).describe('The target job title, e.g. "Frontend Engineer"'),
  yearsOfExperience: z.number().min(0).max(50).optional().default(0).describe('Years of professional experience'),
  skills: z.array(z.string().max(MAX_SHORT_TEXT_LENGTH)).max(MAX_ARRAY_LENGTH).optional().describe('Optional list of skills to include'),
  industry: z.string().max(MAX_SHORT_TEXT_LENGTH).optional().describe('Optional industry context, e.g. "fintech", "healthcare"'),
  experience: z.string().max(MAX_PROMPT_LENGTH).optional().describe('Optional free-text work experience description for AI to parse and incorporate'),
  template: z.string().optional().describe('Template to use for the generated resume'),
  language: z.enum(['zh', 'en']).optional().default('zh').describe('Language for the generated resume'),
});

export type GenerateResumeInput = z.infer<typeof generateResumeInputSchema>;

// Output schema for the AI generation response
export const generateResumeOutputSchema = z.object({
  personal_info: z.object({
    fullName: z.string(),
    jobTitle: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    website: z.string().optional(),
    linkedin: z.string().optional(),
    github: z.string().optional(),
  }),
  summary: z.object({
    text: z.string(),
  }),
  work_experience: z.object({
    items: z.array(z.object({
      company: z.string(),
      position: z.string(),
      location: z.string().optional(),
      startDate: z.string(),
      endDate: z.string().nullable(),
      current: z.boolean(),
      description: z.string(),
      highlights: z.array(z.string()),
    })),
  }),
  education: z.object({
    items: z.array(z.object({
      institution: z.string(),
      degree: z.string(),
      field: z.string(),
      location: z.string().optional(),
      startDate: z.string(),
      endDate: z.string(),
      gpa: z.string().optional(),
      highlights: z.array(z.string()),
    })),
  }),
  skills: z.object({
    categories: z.array(z.object({
      name: z.string(),
      skills: z.array(z.string()),
    })),
  }),
  projects: z.object({
    items: z.array(z.object({
      name: z.string(),
      url: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      description: z.string(),
      technologies: z.array(z.string()),
      highlights: z.array(z.string()),
    })),
  }),
});

export type GenerateResumeOutput = z.infer<typeof generateResumeOutputSchema>;
