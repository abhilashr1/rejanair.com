import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { site } from '../config/site';
import { getPostSlug, sortPostsDescending } from '../utils/posts';

export async function GET(context) {
  const posts = sortPostsDescending(await getCollection('posts'));

  return rss({
    title: site.title,
    description: site.description,
    site: context.site ?? site.url,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      link: `/blog/${getPostSlug(post)}/`,
      content: post.body,
    })),
  });
}
