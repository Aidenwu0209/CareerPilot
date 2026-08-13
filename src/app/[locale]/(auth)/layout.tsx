import { Link } from '@/i18n/routing';
import { CareerPilotLogo } from '@/components/layout/careerpilot-logo';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-50 px-4 dark:bg-zinc-950">
      {/* Quiet blue ambience aligned with the product brand */}
      <div
        className="absolute right-[8%] top-[6%] h-[620px] w-[620px] rounded-full opacity-20 blur-[125px] dark:opacity-[0.09]"
        style={{ background: 'radial-gradient(circle, #60a5fa, transparent 70%)' }}
      />
      <div
        className="absolute -bottom-24 left-[4%] h-[520px] w-[520px] rounded-full opacity-15 blur-[125px] dark:opacity-[0.07]"
        style={{ background: 'radial-gradient(circle, #38bdf8, transparent 70%)' }}
      />
      <div
        className="absolute left-[38%] top-[58%] h-[320px] w-[320px] rounded-full opacity-10 blur-[110px] dark:opacity-[0.05]"
        style={{ background: 'radial-gradient(circle, #bae6fd, transparent 70%)' }}
      />

      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle, #71717a 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Logo - top left */}
      <div className="absolute left-6 top-6 z-20">
        <Link href="/" aria-label="CareerPilot" className="transition-opacity hover:opacity-80">
          <CareerPilotLogo />
        </Link>
      </div>

      {/* Glass card */}
      <div className="relative z-10 my-20 w-full max-w-[440px]">
        <div className="rounded-2xl border border-blue-100/80 bg-white/90 p-8 shadow-2xl shadow-blue-950/8 backdrop-blur-xl sm:p-10 dark:border-blue-950/70 dark:bg-zinc-900/90 dark:shadow-black/25">
          {children}
        </div>
      </div>
    </div>
  );
}
