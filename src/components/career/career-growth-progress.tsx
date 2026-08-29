'use client';

import { useState } from 'react';
import { BellRing, Check, Flame, Loader2, Target } from 'lucide-react';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/http/client';
import { useRouter } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type GrowthProgress = {
  streak: { currentStreak: number; longestStreak: number; totalCheckIns: number; checkedInToday: boolean };
  indicators: { readiness: number | null; match: number | null; taskCompletion: number; assessmentCompletion: number };
  assessments: Array<{ type: string; completed: boolean }>;
  milestones: Array<{ code: string; achieved: boolean }>;
  activeJobSubscriptions: number;
};

export function CareerGrowthProgress({ initial, locale }: { initial: GrowthProgress; locale: string }) {
  const zh = locale.startsWith('zh');
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [working, setWorking] = useState(false);
  const [keywords, setKeywords] = useState('');
  const [city, setCity] = useState('');

  async function checkIn() {
    setWorking(true);
    try {
      const streak = await fetchJson<GrowthProgress['streak'] & { checkedInToday: boolean }>('/api/career/check-in', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }), retry: 0,
      });
      setProgress((current) => ({ ...current, streak }));
      toast.success(zh ? '今日打卡完成' : 'Checked in for today');
    } catch {
      toast.error(zh ? '打卡失败，请稍后重试。' : 'Check-in failed. Try again.');
    } finally { setWorking(false); }
  }

  async function subscribe() {
    if (!keywords.trim()) return;
    setWorking(true);
    try {
      const result = await fetchJson<{ subscriptions: unknown[] }>('/api/career/job-subscriptions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords, city, frequency: 'weekly' }), retry: 0,
      });
      setProgress((current) => ({ ...current, activeJobSubscriptions: result.subscriptions.length }));
      setKeywords(''); setCity('');
      toast.success(zh ? '岗位订阅已创建' : 'Job alert created');
      router.refresh();
    } catch {
      toast.error(zh ? '订阅创建失败或已存在。' : 'The alert could not be created or already exists.');
    } finally { setWorking(false); }
  }

  const metricLabels = zh
    ? { readiness: '准备度', match: '匹配度', taskCompletion: '任务完成率', assessmentCompletion: '测评完成率' }
    : { readiness: 'Readiness', match: 'Match', taskCompletion: 'Task completion', assessmentCompletion: 'Assessment completion' };
  return (
    <section aria-labelledby="growth-progress-heading" className="space-y-4">
      <div><h2 id="growth-progress-heading" className="text-lg font-semibold">{zh ? '职业成长进度' : 'Career growth progress'}</h2><p className="mt-1 text-sm text-muted-foreground">{zh ? '把测评、目标、任务与连续行动汇总在一起。' : 'Your assessments, goals, tasks, and consistent action in one place.'}</p></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Flame className="h-5 w-5 text-orange-500" />{zh ? '每日打卡' : 'Daily check-in'}</CardTitle></CardHeader><CardContent>
          <div className="grid grid-cols-3 gap-2 text-center"><div><p className="text-2xl font-semibold">{progress.streak.currentStreak}</p><p className="text-xs text-muted-foreground">{zh ? '当前连续' : 'Current'}</p></div><div><p className="text-2xl font-semibold">{progress.streak.longestStreak}</p><p className="text-xs text-muted-foreground">{zh ? '最长连续' : 'Longest'}</p></div><div><p className="text-2xl font-semibold">{progress.streak.totalCheckIns}</p><p className="text-xs text-muted-foreground">{zh ? '累计' : 'Total'}</p></div></div>
          <Button className="mt-5 w-full" variant={progress.streak.checkedInToday ? 'secondary' : 'default'} disabled={working || progress.streak.checkedInToday} onClick={checkIn}>{working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{progress.streak.checkedInToday ? (zh ? '今日已打卡' : 'Checked in today') : (zh ? '完成今日打卡' : 'Check in')}</Button>
        </CardContent></Card>
        <Card className="shadow-none lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="h-5 w-5 text-brand" />{zh ? '成长指标' : 'Growth indicators'}</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(Object.keys(progress.indicators) as Array<keyof typeof progress.indicators>).map((key) => <div key={key} className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{metricLabels[key]}</p><p className="mt-1 text-xl font-semibold">{progress.indicators[key] ?? '—'}{progress.indicators[key] !== null ? '%' : ''}</p></div>)}
          <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-4">{progress.assessments.map((item) => <Badge key={item.type} variant={item.completed ? 'default' : 'outline'}>{item.completed ? '✓ ' : ''}{item.type === 'holland' ? 'Holland' : item.type === 'mbti' ? 'MBTI' : (zh ? '工作价值观' : 'Work values')}</Badge>)}</div>
        </CardContent></Card>
      </div>
      <Card className="shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-5 w-5 text-brand" />{zh ? '岗位订阅' : 'Job alerts'}<Badge variant="secondary">{progress.activeJobSubscriptions}</Badge></CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]"><Input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder={zh ? '关键词，如：数据分析' : 'Keywords, e.g. data analyst'} /><Input value={city} onChange={(event) => setCity(event.target.value)} placeholder={zh ? '城市（可选）' : 'City (optional)'} /><Button disabled={working || !keywords.trim()} onClick={subscribe}>{zh ? '每周订阅' : 'Weekly alert'}</Button></CardContent></Card>
    </section>
  );
}
