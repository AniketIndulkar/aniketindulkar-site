export type AppStatus = 'live' | 'testing' | 'planned';

export interface AppEntry {
  /** Short display name. Keep the store subtitle in `tagline`, not here. */
  name: string;
  tagline: string;
  description: string;
  status: AppStatus;
  platform: string;
  category: string;
  /** Public store listing. Omit while an app is in closed testing. */
  href?: string;
  storeLabel?: string;
  /**
   * Optional icon under /public, e.g. '/images/apps/learnt.png'.
   * When absent the card falls back to a typographic mark, so a
   * missing file never renders as a broken image.
   */
  icon?: string;
  features: string[];
}

export const apps: AppEntry[] = [
  {
    name: 'Learnt',
    tagline: 'Log what you learned today. Review it later. Everything stays on your phone.',
    description:
      'A daily learning journal that turns one line a day into spaced-repetition flashcards and weekly quizzes generated from your own notes, with nothing to author and no decks to build. There is no account, no sync and no server: logs never leave the device, and the optional evening recap and grammar cleanup run on an on-device model.',
    status: 'live',
    platform: 'Android',
    category: 'Productivity',
    href: 'https://play.google.com/store/apps/details?id=dev.novanest.learnt',
    storeLabel: 'Google Play',
    // icon: '/images/apps/learnt.png',
    features: ['Spaced repetition', 'On-device AI', 'Offline first', 'No account'],
  },

  // Next app: uncomment and fill in once it reaches open testing.
  // A `testing` entry renders without a store link, so it is safe to
  // publish before the listing is public.
  //
  // {
  //   name: '',
  //   tagline: '',
  //   description: '',
  //   status: 'testing',
  //   platform: 'Android',
  //   category: '',
  //   features: [],
  // },
];

export const statusLabels: Record<AppStatus, string> = {
  live: 'Live',
  testing: 'In testing',
  planned: 'In development',
};
