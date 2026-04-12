import type { CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export function getPostSlug(post: Post) {
  return post.id
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/\.md$/, '')
    .toLowerCase();
}

export function isPaper(post: Post) {
  return post.data.tags.includes('paper');
}

export function sortPostsDescending(posts: Post[]) {
  return [...posts].sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
}

export function excerptFromBody(body: string) {
  const withoutCodeBlocks = body.replace(/```[\s\S]*?```/g, '');
  const plainText = withoutCodeBlocks
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plainText.length <= 220) {
    return plainText;
  }

  return `${plainText.slice(0, 217).trimEnd()}...`;
}
