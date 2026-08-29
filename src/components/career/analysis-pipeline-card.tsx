'use client';

import { useEffect, useState } from 'react';
import { Check, Circle, Loader2, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Step = { code: string; status: 'pending' | 'running' | 'completed' | 'failed'; errorCode: string | null };
type Run = { id: string; status: 'pending' | 'running' | 'failed' | 'completed' | 'cancelled'; steps: Step[] | string; errorCode: string | null };
type Model = { id: string; displayName: string; capabilities: string[] };
const codes = ['uploaded', 'parsed', 'profiled', 'matched', 'pathed', 'reported'];

function normalize(run: Run | null): Run | null {
  if (!run) return null;
  return { ...run, steps: typeof run.steps === 'string' ? JSON.parse(run.steps) : run.steps };
}

export function AnalysisPipelineCard({ initialRun, locale }: { initialRun: Run | null; locale: string }) {
  const zh = locale.startsWith('zh');
  const [run, setRun] = useState<Run | null>(normalize(initialRun));
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState('');
  const [working, setWorking] = useState(false);
  const labels: Record<string, string> = zh
    ? { uploaded: '简历就绪', parsed: '材料解析', profiled: '画像更新', matched: '岗位匹配', pathed: '路径生成', reported: '报告生成' }
    : { uploaded: 'Resume ready', parsed: 'Parse materials', profiled: 'Update profile', matched: 'Match role', pathed: 'Build path', reported: 'Generate report' };

  useEffect(() => { void fetch('/api/ai/models').then((response) => response.json()).then((body) => { const available = (body.models ?? []).filter((model: Model) => model.capabilities.includes('text')); setModels(available); setModelId(available[0]?.id ?? ''); }).catch(() => undefined); }, []);

  async function advance(current: Run, retry = false) {
    let next = current; let shouldRetry = retry;
    while (!['completed', 'cancelled'].includes(next.status)) {
      const response = await fetch(`/api/career/analysis-runs/${next.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ retry: shouldRetry }) });
      const body = await response.json(); shouldRetry = false;
      if (!response.ok) throw new Error(body.error ?? 'RUN_FAILED');
      next = normalize(body.run)!; setRun(next);
      if (next.status === 'failed') break;
    }
    return next;
  }

  async function start() {
    if (!modelId) return; setWorking(true);
    try {
      const response = await fetch('/api/career/analysis-runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId, locale }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      const created = normalize(body.run)!; setRun(created);
      const completed = await advance(created);
      if (completed.status === 'completed') toast.success(zh ? '一键分析已完成' : 'One-click analysis completed');
      else toast.error(zh ? `分析停在：${completed.errorCode}` : `Analysis stopped: ${completed.errorCode}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'RUN_FAILED'); } finally { setWorking(false); }
  }

  async function retry() {
    if (!run) return; setWorking(true);
    try { const result = await advance(run, true); if (result.status === 'completed') toast.success(zh ? '重试后已完成' : 'Completed after retry'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'RUN_FAILED'); } finally { setWorking(false); }
  }

  async function resume() {
    if (!run) return; setWorking(true);
    try { const result = await advance(run); if (result.status === 'completed') toast.success(zh ? '分析已继续并完成' : 'Analysis resumed and completed'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'RUN_FAILED'); } finally { setWorking(false); }
  }

  const steps = run ? run.steps as Step[] : codes.map((code) => ({ code, status: 'pending' as const, errorCode: null }));
  return <Card className="border-brand/20 shadow-none"><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-brand" />{zh ? '一键职业分析' : 'One-click career analysis'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{zh ? '六个阶段逐步落库；刷新页面后仍可继续查看或重试。' : 'Six persisted stages remain visible and retryable after refresh.'}</p></div><div className="flex gap-2">{run?.status === 'pending' ? <Button variant="outline" size="sm" onClick={resume} disabled={working}><RotateCcw className="h-4 w-4" />{zh ? '继续分析' : 'Resume'}</Button> : null}{run?.status === 'failed' ? <Button variant="outline" size="sm" onClick={retry} disabled={working}><RotateCcw className="h-4 w-4" />{zh ? '从失败阶段重试' : 'Retry failed step'}</Button> : null}</div></CardHeader><CardContent className="space-y-5"><ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{steps.map((step) => <li key={step.code} className="rounded-lg border p-3 text-xs"><span className="flex items-center gap-2 font-medium">{step.status === 'completed' ? <Check className="h-4 w-4 text-emerald-600" /> : step.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : step.status === 'failed' ? <XCircle className="h-4 w-4 text-destructive" /> : <Circle className="h-4 w-4 text-muted-foreground" />}{labels[step.code] ?? step.code}</span>{step.errorCode ? <span className="mt-1 block break-words text-destructive">{step.errorCode}</span> : null}</li>)}</ol><div className="flex flex-col gap-2 sm:flex-row"><Select value={modelId} onValueChange={setModelId}><SelectTrigger className="sm:w-64" aria-label={zh ? '报告生成模型' : 'Report model'}><SelectValue placeholder={zh ? '选择模型' : 'Choose model'} /></SelectTrigger><SelectContent>{models.map((model) => <SelectItem key={model.id} value={model.id}>{model.displayName}</SelectItem>)}</SelectContent></Select><Button disabled={working || !modelId || run?.status === 'running'} onClick={start}>{working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{zh ? '开始新分析' : 'Start new analysis'}</Button></div></CardContent></Card>;
}
