import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('writing', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.publishedDate.valueOf() - a.data.publishedDate.valueOf(),
  );

  return rss({
    title: 'Aniket Indulkar — Engineering Writing',
    description:
      'Engineering writing about Android performance, mobile architecture, on-device AI and production systems.',
    site: context.site ?? 'https://aniketindulkar.dev',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedDate,
      link: `/writing/${post.id}/`,
      categories: post.data.topics,
    })),
    customData: '<language>en-gb</language>',
  });
}
