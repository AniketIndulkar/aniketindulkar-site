import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const writing = defineCollection({
  loader: glob({
    base: './src/content/writing',
    pattern: '**/*.{md,mdx}',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    topics: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    series: z
      .object({
        id: z.string(),
        title: z.string(),
        order: z.number().int().nonnegative(),
      })
      .optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing };
