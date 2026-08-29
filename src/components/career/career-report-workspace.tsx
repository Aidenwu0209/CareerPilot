'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Sparkles, WandSparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Report = { id: string; version: number; title: string; markdown: string; status: string; completeness: unknown; createdAt: string | Date };
type Model = { id: string; displayName: string; capabilities: string[]; family: string };

export function CareerReportWorkspace({ initialReports, locale }: { initialReports: Report[]; locale: string }) {
  const zh = locale.startsWith('zh');
  const [reports, setReports] = useState(initialReports);
  const [selectedId, setSelectedId] = useState(initialReports[0]?.id ?? '');
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState('');
  const [working, setWorking] = useState(false);
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;

  useEffect(() => {
    void fetch('/api/ai/models').then(async (response) => response.ok ? response.json() : { models: [] }).then((body) => {
      const textModels = (body.models as Model[]).filter((model) => model.capabilities.includes('text'));
      setModels(textModels); setModelId((current) => current || textModels[0]?.id || '');
    });
  }, []);

  async function run(mode: 'generate' | 'polish') {
    if (!modelId || (mode === 'polish' && !selected)) return;
    setWorking(true);
    try {
      const response = await fetch('/api/career/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelId, locale, mode, sourceVersionId: mode === 'polish' ? selected?.id : undefined }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error);
      setReports((current) => [body.report, ...current]); setSelectedId(body.report.id);
      toast.success(mode === 'polish' ? (zh ? '已生成润色版本' : 'Polished version created') : (zh ? 'AI 职业报告已生成' : 'AI career report generated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (zh ? '生成失败' : 'Generation failed'));
    } finally { setWorking(false); }
  }

  async function check() {
    if (!selected) return;
    const response = await fetch(`/api/career/reports/${selected.id}/check`);
    const result = await response.json();
    if (result.complete) toast.success(zh ? '完整性检查通过' : 'Completeness check passed');
    else toast.error(zh ? `仍缺少 ${result.missingSections?.length ?? 0} 个章节` : `${result.missingSections?.length ?? 0} section(s) are still missing`);
  }

  return <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
    <aside className="space-y-4">
      <Card className="shadow-none"><CardHeader><CardTitle className="text-base">{zh ? '生成设置' : 'Generation'}</CardTitle></CardHeader><CardContent className="space-y-3"><Select value={modelId} onValueChange={setModelId}><SelectTrigger aria-label={zh ? '选择文本模型' : 'Select text model'}><SelectValue placeholder={zh ? '选择模型' : 'Choose a model'} /></SelectTrigger><SelectContent>{models.map((model) => <SelectItem key={model.id} value={model.id}>{model.displayName}</SelectItem>)}</SelectContent></Select><Button className="w-full" disabled={working || !modelId} onClick={() => run('generate')}>{working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{zh ? '生成新报告' : 'Generate report'}</Button></CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle className="text-base">{zh ? '版本历史' : 'Version history'}</CardTitle></CardHeader><CardContent className="space-y-2">{reports.length ? reports.map((report) => <button key={report.id} type="button" onClick={() => setSelectedId(report.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${selected?.id === report.id ? 'border-brand bg-brand/5' : 'hover:bg-muted/50'}`}><span className="font-medium">v{report.version} · {report.title}</span><span className="mt-1 block text-xs text-muted-foreground">{report.status}</span></button>) : <p className="text-sm text-muted-foreground">{zh ? '尚未生成 AI 报告。' : 'No AI report yet.'}</p>}</CardContent></Card>
    </aside>
    <Card className="min-w-0 shadow-none"><CardHeader className="flex-row items-center justify-between gap-3"><CardTitle>{selected?.title ?? (zh ? '职业规划报告' : 'Career planning report')}</CardTitle><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!selected || working} onClick={() => run('polish')}><WandSparkles className="h-4 w-4" />{zh ? 'AI 润色' : 'Polish'}</Button><Button size="sm" variant="outline" disabled={!selected} onClick={check}><CheckCircle2 className="h-4 w-4" />{zh ? '检查完整性' : 'Check'}</Button></div></CardHeader><CardContent>{selected ? <article className="ai-markdown prose prose-zinc max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.markdown}</ReactMarkdown></article> : <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">{zh ? '选择托管文本模型后生成第一版报告。' : 'Choose a managed text model to generate your first report.'}</div>}</CardContent></Card>
  </div>;
}
