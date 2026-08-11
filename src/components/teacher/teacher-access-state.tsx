import { LockKeyhole, UserRoundX } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface TeacherAccessStateProps {
  title: string;
  description: string;
  actionLabel: string;
  actionHref?: string;
  kind?: 'denied' | 'unconfigured';
}

export function TeacherAccessState({
  title,
  description,
  actionLabel,
  actionHref = '/dashboard',
  kind = 'denied',
}: TeacherAccessStateProps) {
  const Icon = kind === 'unconfigured' ? UserRoundX : LockKeyhole;

  return (
    <Card className="mx-auto mt-12 max-w-lg text-center">
      <CardHeader className="items-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <CardTitle className="mt-2 text-xl">{title}</CardTitle>
        <CardDescription className="max-w-sm leading-6">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
