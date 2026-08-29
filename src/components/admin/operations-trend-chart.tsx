'use client';

import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function OperationsTrendChart({ data, locale }: { data: Array<{ date: string; operations: number; modelCalls: number; credits: number }>; locale: string }) {
  const [days, setDays] = useState('30');
  const visible = data.slice(-Number(days));
  const zh = locale.startsWith('zh');
  return <section className="rounded-xl border bg-card p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">{zh ? '运营趋势' : 'Operations trends'}</h2><p className="mt-1 text-sm text-muted-foreground">{zh ? '直接从明细表按 UTC 日实时聚合，不依赖快照任务。' : 'Aggregated live by UTC day from detail tables; no snapshot job required.'}</p></div><Tabs value={days} onValueChange={setDays}><TabsList><TabsTrigger value="7">7d</TabsTrigger><TabsTrigger value="14">14d</TabsTrigger><TabsTrigger value="30">30d</TabsTrigger></TabsList></Tabs></div><div className="mt-5 h-80" aria-label={zh ? '运营趋势折线图' : 'Operations trend line chart'}><ResponsiveContainer width="100%" height="100%"><LineChart data={visible} margin={{ left: 4, right: 16, top: 8, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(value) => value.slice(5)} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend /><Line type="monotone" dataKey="operations" name={zh ? 'AI 操作' : 'AI operations'} stroke="var(--chart-1)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="modelCalls" name={zh ? '模型调用' : 'Model calls'} stroke="var(--chart-2)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="credits" name={zh ? '净消耗积分' : 'Net credits'} stroke="var(--chart-3)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></section>;
}
