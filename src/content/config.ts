import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  schema: z.object({
    layout: z.string().optional(),
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    author: z.string().optional(),
  }),
});

export const collections = { posts };
