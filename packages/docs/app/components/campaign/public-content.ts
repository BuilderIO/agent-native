import type { PublicArticle } from "../../../lib/campaign-content";
import { sitePathForLocale } from "../docs-locale";

export type Article = PublicArticle;

// Project nested objects as well: additions to the content source must not widen the public loader contract.
export function publicArticle(item: Article): Article {
  return {
    slug: item.slug,
    use_case: item.use_case,
    job_id: item.job_id,
    title: item.title,
    meta_description: item.meta_description,
    topic: item.topic,
    apps: item.apps,
    published: item.published,
    updated: item.updated,
    author: item.author,
    author_role: item.author_role,
    author_avatar: item.author_avatar,
    app_cta_url: item.app_cta_url,
    cta_label: item.cta_label,
    screenshot_alt: item.screenshot_alt,
    cta_band_heading: item.cta_band_heading,
    cta_band_subhead: item.cta_band_subhead,
    related_resources: item.related_resources.map(({ label, url }) => ({
      label,
      url,
    })),
    related: item.related,
    body: item.body,
  };
}

export function newestArticles<
  T extends { published: string; updated?: string },
>(articles: T[]): T[] {
  return [...articles].sort((a, b) =>
    (b.updated ?? b.published).localeCompare(a.updated ?? a.published),
  );
}

export function campaignHref(href: string, locale: unknown): string {
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
