'use client';

import { useEffect, useState } from 'react';
import { WifiOff, X } from 'lucide-react';
import { useOffline } from 'next/offline';
import { useLocale } from 'next-intl';

export function NetworkStatusBanner() {
  const frameworkOffline = useOffline();
  const locale = useLocale();
  const [browserOffline, setBrowserOffline] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setBrowserOffline(!navigator.onLine);
    const failed = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setRequestError(detail?.message ?? 'Request failed');
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('careerpilot:request-error', failed);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('careerpilot:request-error', failed);
    };
  }, []);

  const offline = frameworkOffline || browserOffline;
  if (!offline && !requestError) return null;
  const zh = locale.startsWith('zh');

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[100] flex min-h-10 items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950 shadow-sm"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {offline
          ? zh ? '网络已断开；未完成的页面操作会在恢复连接后继续。' : 'You are offline. Pending page actions will continue after reconnection.'
          : zh ? `请求未完成：${requestError}。请检查网络后重试。` : `Request did not complete: ${requestError}. Check the connection and retry.`}
      </span>
      {!offline ? (
        <button type="button" onClick={() => setRequestError(null)} className="rounded p-1 hover:bg-black/10" aria-label={zh ? '关闭' : 'Dismiss'}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
