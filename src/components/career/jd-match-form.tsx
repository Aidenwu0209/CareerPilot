'use client';

import { useEffect, useState } from 'react';
import { ClipboardPaste, Loader2, SearchCheck } from 'lucide-react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/routing';
import { fetchJson } from '@/lib/http/client';
import type { CareerJdMatchResult } from '@/types/career';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const DRAFT_KEY = 'careerpilot:career-jd-draft';

export function JdMatchForm() {
  const locale = useLocale();
  const zh = locale.startsWith('zh');
  const [jd, setJd] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CareerJdMatchResult | null>(null);

  useEffect(() => setJd(localStorage.getItem(DRAFT_KEY) ?? ''), []);
  useEffect(() => { if (jd) localStorage.setItem(DRAFT_KEY, jd); }, [jd]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = await fetchJson<{ result: CareerJdMatchResult }>('/api/career/jd-match', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobDescription: jd }),
      });
      setResult(payload.result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (zh ? 'JD 解析失败' : 'JD analysis failed'));
    } finally { setLoading(false); }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-brand/10 p-2 text-brand"><ClipboardPaste className="h-5 w-5" /></span>
        <div><h2 className="font-semibold">{zh ? '粘贴任意招聘 JD' : 'Paste any job description'}</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{zh ? '系统会映射到最接近的中国标准岗位，再用你的已核验证据计算匹配；低置信度会明确提示。' : 'We map the JD to the closest reviewed occupation, then compare it with your verified evidence. Low confidence is shown explicitly.'}</p></div>
      </div>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <Textarea value={jd} onChange={(event) => setJd(event.target.value)} rows={8} maxLength={20000} placeholder={zh ? '请粘贴岗位名称、职责、技能要求、经验与学历要求（至少 40 字）…' : 'Paste the title, responsibilities, skills, experience, and education requirements (at least 40 characters)…'} />
        <div className="flex items-center justify-between gap-3"><span className="text-xs text-zinc-400">{jd.length}/20,000</span><Button type="submit" disabled={loading || jd.trim().length < 40} className="bg-brand hover:bg-brand-hover">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}{loading ? (zh ? '正在解析…' : 'Analyzing…') : (zh ? '解析并匹配' : 'Analyze and match')}</Button></div>
      </form>
      {result ? (
        <div className="mt-5 rounded-lg border border-brand/20 bg-brand/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs text-zinc-500">{zh ? '推断标准岗位' : 'Inferred occupation'} · {result.confidence.toUpperCase()}</p><h3 className="mt-1 font-semibold">{result.occupation.name}</h3></div><span className="text-2xl font-semibold tabular-nums text-brand">{result.match.score == null ? '—' : `${result.match.score}%`}</span></div>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{zh ? '命中词' : 'Matched terms'}：{[...result.matchedTerms, ...result.requirementTerms].join('、') || (zh ? '仅根据岗位类别推断' : 'Inferred from occupation category')}</p>
          {result.alternatives.length ? <p className="mt-2 text-xs text-zinc-500">{zh ? '可能的其他岗位' : 'Possible alternatives'}：{result.alternatives.map((item) => item.name).join('、')}</p> : null}
          <Button asChild variant="outline" size="sm" className="mt-4"><Link href={`/career/matching?occupationCode=${encodeURIComponent(result.occupation.code)}`}>{zh ? '查看完整证据解释' : 'View full evidence explanation'}</Link></Button>
        </div>
      ) : null}
    </section>
  );
}
