'use client';

import { Search, UserRoundSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TeacherStudentStatus, TeacherStudentSummary } from './types';

export interface TeacherStudentListProps {
  students: TeacherStudentSummary[];
  initialStatus?: string;
  copy: {
    searchLabel: string;
    searchPlaceholder: string;
    statusLabel: string;
    targetLabel: string;
    allStatuses: string;
    allTargets: string;
    status: Record<TeacherStudentStatus, string>;
    noTarget: string;
    matchScore: string;
    evidenceCoverage: string;
    taskProgress: string;
    pendingItems: string;
    openStudent: string;
    emptyTitle: string;
    emptyDescription: string;
    clearFilters: string;
  };
}

export function TeacherStudentList({ students, initialStatus, copy }: TeacherStudentListProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(initialStatus ?? 'all');
  const [target, setTarget] = useState('all');
  const targets = useMemo(
    () => Array.from(new Set(students.map((student) => student.targetJob).filter((value): value is string => Boolean(value)))),
    [students],
  );

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return students.filter((student) => {
      const matchesQuery =
        !normalizedQuery ||
        [student.name, student.program, student.cohort, student.targetJob ?? ''].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery),
        );
      const matchesStatus = status === 'all' || student.status === status;
      const matchesTarget = target === 'all' || student.targetJob === target;
      return matchesQuery && matchesStatus && matchesTarget;
    });
  }, [query, status, students, target]);

  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setTarget('all');
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_12rem_14rem]">
        <div className="space-y-2 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="teacher-student-search">{copy.searchLabel}</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input
              id="teacher-student-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              className="pl-9"
            />
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="teacher-student-status">{copy.statusLabel}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="teacher-student-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.allStatuses}</SelectItem>
              {(Object.keys(copy.status) as TeacherStudentStatus[]).map((value) => (
                <SelectItem key={value} value={value}>{copy.status[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="teacher-student-target">{copy.targetLabel}</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id="teacher-student-target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.allTargets}</SelectItem>
              {targets.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredStudents.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center px-6 py-12 text-center">
            <UserRoundSearch aria-hidden="true" className="size-9 text-zinc-400" />
            <h2 className="mt-4 font-semibold text-zinc-950 dark:text-zinc-50">{copy.emptyTitle}</h2>
            <p className="mt-1 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.emptyDescription}</p>
            <Button type="button" variant="outline" className="mt-5" onClick={clearFilters}>{copy.clearFilters}</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredStudents.map((student) => (
            <Card key={student.id} className="gap-4 overflow-hidden py-5 shadow-none">
              <CardContent className="space-y-5 px-5">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold text-zinc-950 dark:text-zinc-50">{student.name}</h2>
                      <Badge variant={student.status === 'attention' ? 'destructive' : 'secondary'}>{copy.status[student.status]}</Badge>
                    </div>
                    <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">{student.program} · {student.cohort}</p>
                  </div>
                  {student.pendingItemCount > 0 && (
                    <Badge variant="outline" className="w-fit shrink-0 tabular-nums">
                      {copy.pendingItems.replace('{count}', String(student.pendingItemCount))}
                    </Badge>
                  )}
                </div>

                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{copy.targetLabel}</p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{student.targetJob ?? copy.noTarget}</p>
                </div>

                <dl className="grid grid-cols-3 gap-2">
                  <div className="min-w-0 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                    <dt className="truncate text-xs text-zinc-500 dark:text-zinc-400">{copy.matchScore}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{student.matchScore === null ? '—' : `${student.matchScore}%`}</dd>
                  </div>
                  <div className="min-w-0 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                    <dt className="truncate text-xs text-zinc-500 dark:text-zinc-400">{copy.evidenceCoverage}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{student.evidenceCoverage === null ? '—' : `${student.evidenceCoverage}%`}</dd>
                  </div>
                  <div className="min-w-0 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                    <dt className="truncate text-xs text-zinc-500 dark:text-zinc-400">{copy.taskProgress}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{student.completedTaskCount}/{student.taskCount}</dd>
                  </div>
                </dl>

                <Button asChild className="w-full sm:w-auto">
                  <Link href={`/teacher/students/${student.id}`}>{copy.openStudent}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
