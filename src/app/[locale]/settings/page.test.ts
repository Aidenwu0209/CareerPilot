import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect }));

import SettingsPage from './page';

describe('localized settings route', () => {
  beforeEach(() => {
    redirect.mockReset();
  });

  it.each(['zh', 'en'])('redirects /%s/settings to the localized account page', async (locale) => {
    await SettingsPage({ params: Promise.resolve({ locale }) });

    expect(redirect).toHaveBeenCalledWith(`/${locale}/account`);
  });
});
