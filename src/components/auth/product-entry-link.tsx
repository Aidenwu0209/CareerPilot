'use client';

import NextLink from 'next/link';
import { useLocale } from 'next-intl';
import { useSession } from 'next-auth/react';
import { buildLoginRedirect } from '@/lib/auth/login-redirect';

export function ProductEntryLink({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const locale = useLocale();
  const { data: session } = useSession();
  const href = session?.user
    ? `/${locale}/dashboard`
    : buildLoginRedirect(locale, '/dashboard');

  return (
    <NextLink href={href} className={className} onClick={onClick}>
      {children}
    </NextLink>
  );
}
