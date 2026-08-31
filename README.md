# aniketindulkar.dev

Aniket Indulkar's personal engineering site: a focused home for technical writing and, over time, projects, open-source work, speaking, and an about section.

## Tech stack

- [Astro](https://astro.build/) with static site generation
- TypeScript
- Plain CSS
- No client-side framework or runtime JavaScript
- npm

## Local development

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

Astro prints the local URL in the terminal (normally `http://localhost:4321`).

## Production build

Create the static production site in `dist/`:

```sh
npm run build
```

Run Astro's TypeScript and content checks with:

```sh
npm run check
```

## Cloudflare Pages

Create a Cloudflare Pages project connected to this repository and use:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`
- Node.js version: `22.19.0` (pinned in `.node-version`)

The canonical site URL is configured as `https://aniketindulkar.dev` in `astro.config.mjs`.

## Before publishing

The GitHub and LinkedIn profile URLs are configured in `src/pages/index.astro`. The SVG favicon in `public/favicon.svg` is intentionally simple and can be replaced later with a final brand mark. The bespoke social preview is stored at `public/og.png`.

## Writing

Published articles live in `src/content/writing/` as Markdown files with typed frontmatter. The writing archive at `/writing` and individual article routes are generated automatically at build time.

To add an article, create a Markdown file with this frontmatter:

```yaml
---
title: Article title
description: A concise search and social description.
publishedDate: 2026-08-31
topics:
  - Android
  - Performance
draft: false
---
```

Set `draft: true` to keep an article out of production routes. Article-specific diagrams and images belong under `public/images/writing/<article-slug>/`.

## Future sections

The project is ready to grow through Astro's file-based routes. The writing section is live; future sections can be added under `src/pages/` for:

- `/projects`
- `/about`
- `/speaking`

Shared page structure belongs in `src/layouts/`, reusable interface elements in `src/components/`, and global design foundations in `src/styles/`.
