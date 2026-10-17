export type AppStatus = 'live' | 'testing' | 'planned';

export interface AppEntry {
  /** Short display name. The store subtitle belongs in `tagline`. */
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

/** Array order is deliberate curation, not recency. */
export const apps: AppEntry[] = [
  {
    name: 'Learnt',
    icon: '/images/apps/learnt.png',
    tagline: 'Log what you learned today. Review it later. Everything stays on your phone.',
    description:
      'A daily learning journal that turns one line a day into spaced-repetition flashcards and weekly quizzes generated from your own notes, so there is nothing to author and no decks to build. The optional evening recap and grammar cleanup run on a model downloaded to the device, which keeps the feature working with no network and no text leaving the phone.',
    status: 'live',
    platform: 'Android',
    category: 'Productivity',
    href: 'https://play.google.com/store/apps/details?id=dev.novanest.learnt',
    storeLabel: 'Google Play',
    features: ['Spaced repetition', 'On-device AI', 'Offline first', 'No account'],
  },
  {
    name: 'Curio',
    icon: '/images/apps/curio.png',
    tagline: 'Rate movies, food and places in offline collections with notes and photos.',
    description:
      'A collection journal for rating and ranking the things you care about. Each collection defines its own rating dimensions with per-dimension weights, so rankings recompute as you tune what matters, and every entry gets a score breakdown and a radar chart. Collections export to a single portable backup file that carries the photos with it.',
    status: 'live',
    platform: 'Android',
    category: 'Productivity',
    href: 'https://play.google.com/store/apps/details?id=dev.novanest.curio',
    storeLabel: 'Google Play',
    features: ['Weighted ratings', 'Radar charts', 'Portable backups', 'Offline first'],
  },
  {
    name: 'Ahead',
    icon: '/images/apps/ahead.png',
    tagline: 'Count down to trips and plans, then keep the memory.',
    description:
      'A countdown app for the days worth looking forward to, and a record of them afterwards. The home-screen widgets roll over at midnight on their own, so the day count stays correct without the app ever being opened. Once a day has been lived it moves to a Past tab that keeps the notes and photos from it.',
    status: 'live',
    platform: 'Android',
    category: 'Productivity',
    href: 'https://play.google.com/store/apps/details?id=dev.novanest.ahead',
    storeLabel: 'Google Play',
    features: ['Resizable widgets', 'Midnight rollover', 'Offline first', 'No account'],
  },
  {
    name: 'Ember',
    icon: '/images/apps/ember.png',
    tagline: 'Offline Pomodoro timer for study and deep work, with stats, widgets and no ads.',
    description:
      'A focus timer that stays accurate with the screen off, driven from its ongoing notification, a resizable widget or a Quick Settings tile. Session history rolls up into weekly, monthly and yearly focus time with daily goals and streaks, and the whole history exports as CSV. Optional Do Not Disturb access silences interruptions for the length of a session.',
    status: 'live',
    platform: 'Android',
    category: 'Productivity',
    href: 'https://play.google.com/store/apps/details?id=dev.novanest.ember',
    storeLabel: 'Google Play',
    features: ['Quick Settings tile', 'CSV export', 'Offline first', 'Goals and streaks'],
  },

  // Next app: add an entry with status 'testing' and no `href`. The card then
  // renders without a store link, so it is safe to publish before the listing
  // goes public.
];

export const statusLabels: Record<AppStatus, string> = {
  live: 'Live',
  testing: 'In testing',
  planned: 'In development',
};

export const liveApps = apps.filter((app) => app.status === 'live' && app.href);
