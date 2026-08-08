import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { Users, Cpu, Boxes, Building2, Coins } from 'lucide-react';

export default async function AdminPage() {
  const t = await getTranslations('admin');

  const cards = [
    { href: '/admin/users', icon: Users, title: t('sections.users.title'), description: t('sections.users.description') },
    { href: '/admin/credits/rules', icon: Coins, title: t('sections.creditRules.title'), description: t('sections.creditRules.description') },
    { href: '/admin/ai-providers', icon: Cpu, title: t('sections.aiProviders.title'), description: t('sections.aiProviders.description') },
    { href: '/admin/ai/models', icon: Boxes, title: t('sections.aiModels.title'), description: t('sections.aiModels.description') },
    { href: '/admin/organizations', icon: Building2, title: t('sections.organizations.title'), description: t('sections.organizations.description') },
  ] as const;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t('title')}
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {t('overview')}
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Icon className="h-8 w-8 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
              <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{card.title}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{card.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
