'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Operation { method: string; path: string; summary: string; tag: string; source: string; secured: boolean }

export function OpenApiExplorer() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [info, setInfo] = useState<{ title: string; version: string; description: string } | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/openapi.json').then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).then((document) => {
      setInfo(document.info);
      setOperations(Object.entries(document.paths).flatMap(([path, pathItem]) => Object.entries(pathItem as Record<string, Record<string, unknown>>)
        .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method))
        .map(([method, operation]) => ({
          method: method.toUpperCase(), path, summary: String(operation.summary ?? ''),
          tag: String((operation.tags as string[] | undefined)?.[0] ?? 'Other'),
          source: String(operation['x-source-file'] ?? ''), secured: !Array.isArray(operation.security) || operation.security.length > 0,
        }))));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Failed to load OpenAPI document'));
  }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? operations.filter((operation) => `${operation.method} ${operation.path} ${operation.tag} ${operation.summary}`.toLowerCase().includes(needle)) : operations;
  }, [operations, query]);
  const groups = useMemo(() => Object.entries(Object.groupBy(filtered, (operation) => operation.tag)).sort(([a], [b]) => a.localeCompare(b)), [filtered]);
  return <main className="mx-auto min-h-screen max-w-6xl px-4 py-10 sm:px-6">
    <header className="border-b pb-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-brand">OpenAPI 3.1</p><h1 className="mt-2 text-3xl font-bold">{info?.title ?? 'CareerPilot API Reference'}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{info?.description ?? 'Loading API contract…'}</p></div><a href="/openapi.json" download className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">Download JSON · v{info?.version ?? '…'}</a></div>
      <label className="relative mt-6 block"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search method, path, or tag" /></label>
    </header>
    {error ? <p role="alert" className="mt-8 text-red-600">{error}</p> : <div className="mt-8 space-y-8">{groups.map(([tag, items]) => <section key={tag}><h2 className="text-xl font-semibold">{tag} <span className="text-sm font-normal text-muted-foreground">({items?.length ?? 0})</span></h2><div className="mt-3 space-y-2">{items?.map((operation) => <details key={`${operation.method}-${operation.path}`} className="rounded-lg border bg-card"><summary className="flex cursor-pointer list-none items-center gap-3 p-4"><Badge className="w-16 justify-center font-mono" variant={operation.method === 'GET' ? 'secondary' : 'default'}>{operation.method}</Badge><code className="min-w-0 flex-1 truncate text-sm">{operation.path}</code>{operation.secured ? <Badge variant="outline">auth</Badge> : <Badge variant="outline">public</Badge>}</summary><div className="border-t px-4 py-3 text-sm text-muted-foreground"><p>{operation.summary}</p><p className="mt-1 font-mono text-xs">Source: {operation.source}</p></div></details>)}</div></section>)}</div>}
  </main>;
}
