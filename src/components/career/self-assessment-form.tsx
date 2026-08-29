'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, LockKeyhole, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/routing';
import { fetchJson } from '@/lib/http/client';
import {
  assessmentLabel,
  CAREER_ASSESSMENT_QUESTIONS,
  isAssessmentComplete,
  scoreSelfAssessment,
  type AssessmentLocale,
  type CareerSelfAssessment,
} from '@/lib/career/self-assessment';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const sectionCopy = {
  interests: { zh: ['职业兴趣（Holland 方向）', '你愿意投入精力的活动类型'], en: ['Career interests (Holland themes)', 'Activities that naturally hold your attention'] },
  personality: { zh: ['性格偏好（MBTI 维度参考）', '选择更接近你的自然倾向'], en: ['Personality preferences (MBTI dimensions)', 'Choose the tendency that feels more natural'] },
  values: { zh: ['工作价值观', '你希望工作长期满足的需要'], en: ['Work values', 'Needs you want your work to meet over time'] },
  learning: { zh: ['学习偏好', '帮助你更高效成长的方式'], en: ['Learning preferences', 'Ways that help you learn effectively'] },
} as const;

type AssessmentAccess = {
  freeAssessmentQuestionLimit: number;
  features: { assessment_report: { unlocked: boolean; priceCredits: number } };
};

export function SelfAssessmentForm({ initial, locale, access }: { initial: CareerSelfAssessment | null; locale: string; access: AssessmentAccess }) {
  const lang: AssessmentLocale = locale.startsWith('zh') ? 'zh' : 'en';
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>(initial?.answers ?? {});
  const [saving, setSaving] = useState(false);
  const completed = isAssessmentComplete(answers);
  const results = useMemo(() => scoreSelfAssessment(answers), [answers]);
  const zh = lang === 'zh';
  const unlocked = access.features.assessment_report.unlocked;
  const [unlocking, setUnlocking] = useState(false);

  async function unlock() {
    setUnlocking(true);
    try {
      await fetchJson('/api/career/access', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feature: 'assessment_report' }), retry: 0,
      });
      toast.success(zh ? '深度测评已解锁' : 'Full assessment unlocked');
      router.refresh();
    } catch {
      toast.error(zh ? '积分不足，请先充值或选择订阅套餐。' : 'Insufficient credits. Top up or choose a subscription.');
    } finally {
      setUnlocking(false);
    }
  }

  async function save(complete: boolean) {
    if (complete && !completed) {
      toast.error(zh ? '请完成全部题目后再生成结果。' : 'Complete every question before generating results.');
      return;
    }
    setSaving(true);
    try {
      await fetchJson('/api/career/assessment', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers, complete }),
        retry: 1,
      });
      toast.success(complete ? (zh ? '测评结果已保存' : 'Assessment saved') : (zh ? '进度已保存，可稍后续做' : 'Progress saved for later'));
      router.refresh();
    } catch {
      toast.error(zh ? '保存失败，请检查网络后重试。' : 'Save failed. Check your connection and retry.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {(Object.keys(sectionCopy) as Array<keyof typeof sectionCopy>).map((section) => {
        const questions = CAREER_ASSESSMENT_QUESTIONS.filter((item) => item.section === section);
        const [title, description] = sectionCopy[section][lang];
        return (
          <Card key={section} className="gap-0 py-0 shadow-none">
            <CardContent className="p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
              <div className="mt-5 space-y-6">
                {questions.map((question, index) => {
                  const globalIndex = CAREER_ASSESSMENT_QUESTIONS.findIndex((item) => item.id === question.id);
                  if (!unlocked && globalIndex >= access.freeAssessmentQuestionLimit) return null;
                  return (
                  <fieldset key={question.id} className="space-y-3">
                    <legend className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
                      {index + 1}. {question.prompt[lang]}
                    </legend>
                    {question.left && question.right ? (
                      <div>
                        <div className="mb-2 flex justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                          <span>{question.left[lang]}</span><span className="text-right">{question.right[lang]}</span>
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          {[1, 2, 3, 4, 5].map((value) => (
                            <label key={value} className="cursor-pointer">
                              <input className="peer sr-only" type="radio" name={question.id} value={value} checked={answers[question.id] === value} onChange={() => setAnswers((current) => ({ ...current, [question.id]: value }))} />
                              <span className="flex h-10 items-center justify-center rounded-md border border-zinc-200 text-sm peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white dark:border-zinc-700">{value}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-5 gap-2" aria-label={zh ? '1 表示非常不同意，5 表示非常同意' : '1 strongly disagree, 5 strongly agree'}>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <label key={value} className="cursor-pointer text-center">
                            <input className="peer sr-only" type="radio" name={question.id} value={value} checked={answers[question.id] === value} onChange={() => setAnswers((current) => ({ ...current, [question.id]: value }))} />
                            <span className="flex h-10 items-center justify-center rounded-md border border-zinc-200 text-sm peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white dark:border-zinc-700">{value}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {!unlocked ? (
        <Card className="border-brand/25 bg-brand/5 shadow-none">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><LockKeyhole className="h-5 w-5" /></span>
              <div><p className="font-semibold">{zh ? '继续完整测评并生成深度报告' : 'Continue the full assessment and generate your report'}</p><p className="mt-1 text-sm text-muted-foreground">{zh ? `前 ${access.freeAssessmentQuestionLimit} 题免费；解锁将扣除 ${access.features.assessment_report.priceCredits} 积分。订阅用户无需单独解锁。` : `The first ${access.freeAssessmentQuestionLimit} questions are free. Unlocking costs ${access.features.assessment_report.priceCredits} credits; subscriptions include access.`}</p></div>
            </div>
            <Button type="button" onClick={unlock} disabled={unlocking} className="shrink-0">
              {unlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}{zh ? '一键解锁' : 'Unlock'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {initial?.completedAt ? (
        <Card className="border-emerald-200 bg-emerald-50/60 shadow-none dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardContent>
            <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-5 w-5" />{zh ? '你的自我认知摘要' : 'Your self-awareness summary'}</div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-zinc-500">{zh ? '兴趣方向' : 'Interest themes'}</dt><dd className="mt-1 font-medium">{results.interestCodes.map((code) => assessmentLabel(code, lang)).join(' · ')}</dd></div>
              <div><dt className="text-zinc-500">{zh ? '性格偏好' : 'Personality preference'}</dt><dd className="mt-1 font-medium">{results.personalityType ?? '—'}</dd></div>
              <div><dt className="text-zinc-500">{zh ? '工作价值观' : 'Work values'}</dt><dd className="mt-1 font-medium">{results.valueCodes.map((code) => assessmentLabel(code, lang)).join(' · ')}</dd></div>
              <div><dt className="text-zinc-500">{zh ? '学习偏好' : 'Learning preferences'}</dt><dd className="mt-1 font-medium">{results.learningCodes.map((code) => assessmentLabel(code, lang)).join(' · ')}</dd></div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" variant="outline" disabled={saving || Object.keys(answers).length === 0} onClick={() => save(false)}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {zh ? '保存进度' : 'Save progress'}
        </Button>
        <Button type="button" disabled={saving || !completed || !unlocked} onClick={() => save(true)} className="bg-brand hover:bg-brand-hover">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {initial?.completedAt ? (zh ? '更新测评结果' : 'Update results') : (zh ? '完成并生成结果' : 'Complete and view results')}
        </Button>
      </div>
    </div>
  );
}
