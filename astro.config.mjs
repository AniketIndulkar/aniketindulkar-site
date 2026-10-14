import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://aniketindulkar.dev',
  output: 'static',
  integrations: [
    sitemap({
      namespaces: {
        news: false,
        video: false,
        xhtml: false,
      },
    }),
  ],
});
