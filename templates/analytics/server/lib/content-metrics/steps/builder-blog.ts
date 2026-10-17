import type { ActionRunContext } from "@agent-native/core/action";

import {
  listBuilderBlogArticles,
  type BuilderBlogArticle,
} from "../../../../actions/builder-blog-articles.js";
import type { ContentStep } from "../step.js";
import type { ContentItemInput } from "../store.js";

const BUILDER_BLOG_ORIGIN = "https://www.builder.io/blog/";
/** The feed pages 20,000 articles per call; this bounds the continuation loop. */
const MAX_FEED_CALLS = 10;

function authorName(author: BuilderBlogArticle["author"]): string | null {
  if (!author) return null;
  return author.name ?? author.handle ?? author.id;
}

export function builderBlogItem(article: BuilderBlogArticle): ContentItemInput {
  return {
    source: "builder_blog",
    externalId: article.id,
    url: `${BUILDER_BLOG_ORIGIN}${encodeURIComponent(article.handle)}`,
    title: article.title,
    author: authorName(article.author),
    authors: article.authors.map((author) => authorName(author)!),
    publishedAt: article.publishDate,
    metadata: {
      handle: article.handle,
      firstPublished: article.firstPublished,
      lastUpdated: article.lastUpdated,
      authorIds: article.authors.map((author) => author.id),
    },
  };
}

/** Every published Builder blog article with its authors. Writes no metrics. */
export const builderBlogStep: ContentStep = {
  id: "builder_blog",
  async run({ collection, signal }) {
    const context = {
      userEmail: collection.ownerEmail,
      orgId: collection.orgId,
      ...(signal ? { signal } : {}),
    } as ActionRunContext;

    const articles: BuilderBlogArticle[] = [];
    let offset: number | null = 0;
    for (let call = 0; offset !== null; call += 1) {
      if (call === MAX_FEED_CALLS) {
        throw new Error(
          `The Builder blog feed still had more articles after ${articles.length}; the article list would be incomplete.`,
        );
      }
      const page = await listBuilderBlogArticles({ offset }, context);
      articles.push(...page.articles);
      offset = page.truncated ? page.nextOffset : null;
    }

    return {
      items: articles.map(builderBlogItem),
      outcome: { rowCount: articles.length },
    };
  },
};
