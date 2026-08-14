'use client';

import NextLink from 'next/link';
import { useLinkStatus } from 'next/link';
import { useRef } from 'react';
import { useLocale } from 'next-intl';
import { useSession } from 'next-auth/react';
import { buildLoginRedirect } from '@/lib/auth/login-redirect';

export function ProductEntryLink({
  children,
  className,
  onClick,
  targetPath = '/dashboard',
  pendingLabel,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  targetPath?: string;
  pendingLabel?: string;
}) {
  const locale = useLocale();
  const { data: session } = useSession();
  const navigationStarted = useRef(false);
  const href = session?.user
    ? `/${locale}${targetPath}`
    : buildLoginRedirect(locale, targetPath);

  return (
    <NextLink
      href={href}
      className={className}
      onClick={(event) => {
        if (navigationStarted.current) {
          event.preventDefault();
          return;
        }
        navigationStarted.current = true;
        onClick?.();
      }}
    >
      <ProductEntryLabel pendingLabel={pendingLabel}>{children}</ProductEntryLabel>
    </NextLink>
  );
}

function ProductEntryLabel({ children, pendingLabel }: { children: React.ReactNode; pendingLabel?: string }) {
  const { pending } = useLinkStatus();
  return <>{pending && pendingLabel ? pendingLabel : children}</>;
}
