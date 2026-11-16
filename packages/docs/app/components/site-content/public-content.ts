import type { ArticleEntry, PublicArticle } from "../../../lib/site-content";
import { sitePathForLocale } from "../docs-locale";

export type Article = PublicArticle;

// Project nested objects as well: additions to the content source must not widen the public loader contract.
export function publicArticle(item: Article): Article {
  const { name, url, same_as, role, photo, bio } = item.author;
  return {
    slug: item.slug,
    type: item.type,
    title: item.title,
    seo_title: item.seo_title,
    og_line: item.og_line,
    meta_description: item.meta_description,
    og_image: item.og_image,
    published: item.published,
    updated: item.updated,
    author: { name, url, same_as, role, photo, bio },
    app: item.app,
    cta: item.cta
      ? {
          label: item.cta.label,
          url: item.cta.url,
          heading: item.cta.heading,
          prompt: item.cta.prompt,
        }
      : undefined,
    use_case: item.use_case,
    images: item.images.map(({ dark, light, alt }) => ({ dark, light, alt })),
    faqs: item.faqs.map(({ q, a }) => ({ q, a })),
    body: item.body,
  };
}

/** Newest first, by the date each article was last updated. */
export function newestArticles<T extends { updated: string }>(
  articles: T[],
): T[] {
  return [...articles].sort((a, b) => b.updated.localeCompare(a.updated));
}

/**
 * Cards for a list of articles in one language: each translated card where
 * one exists, the English card otherwise, and the slugs that have a page in
 * that language (only those cards may link to it).
 */
export function articleCards(articles: ArticleEntry[], locale: string) {
  const translatedSlugs: string[] = [];
  const cards = articles.map((entry) => {
    const translation = entry.translations[locale];
    if (!translation) return publicArticle(entry);
    translatedSlugs.push(entry.slug);
    return publicArticle(translation);
  });
  return { articles: cards, translatedSlugs };
}

export function siteContentHref(href: string, locale: unknown): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const suffixIndex = href.search(/[?#]/);
  const path = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : href.slice(suffixIndex);
  return `${sitePathForLocale(path, locale)}${suffix}`;
}

export function safeHref(href: string): string | undefined {
  if (!href || /[\s\\\u0000-\u001f\u007f]/.test(href) || href.startsWith("//"))
    return undefined;
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      return url.username || url.password ? undefined : href;
    } catch {
      // coercion-ok: an unparseable URL is rejected as unsafe; callers branch on undefined.
      return undefined;
    }
  }
  if (/^(mailto:|\/|#)/i.test(href)) return href;
  return /^[a-z][a-z\d+.-]*:/i.test(href) ? undefined : href;
}
