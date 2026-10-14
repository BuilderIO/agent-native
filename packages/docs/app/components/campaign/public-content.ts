export interface UseCase {
  slug: string;
  job_id: string;
  app: string;
  title: string;
  subhead: string;
  meta_description: string;
  cta_label: string;
  secondary_cta_label: string;
  app_cta_url: string;
  screenshot_url?: string;
  screenshot_alt: string;
  screenshot_brief: string;
  old_way: { heading: string; body: string };
  replaces?: string[];
  new_way: { heading: string; steps: string[] };
  story?: { quote: string; name: string; role: string; used_before: string[] };
  faqs: { q: string; a: string }[];
  cta_band_heading: string;
  cta_band_subhead: string;
  updated: string;
}

export interface Article {
  slug: string;
  use_case: string;
  job_id: string;
  title: string;
  meta_description: string;
  category: string;
  published: string;
  updated?: string;
  author: string;
  author_role?: string;
  author_avatar?: string;
  app_cta_url: string;
  cta_label: string;
  screenshot_url?: string;
  screenshot_alt: string;
  screenshot_brief: string;
  cta_band_heading: string;
  cta_band_subhead: string;
  related_resources: { label: string; url: string }[];
  related?: string[];
  body: string;
}

export const appNames: Record<string, string> = {
  clips: "Clips",
  design: "Design",
  slides: "Slides",
  plans: "Plans",
  plan: "Plans",
  analytics: "Analytics",
};
export const categories = [
  "clips",
  "design",
  "slides",
  "plans",
  "analytics",
] as const;

// Project nested objects as well: additions to the content source must not widen the public loader contract.
export function publicUseCase(item: UseCase): UseCase {
  return {
    slug: item.slug,
    job_id: item.job_id,
    app: item.app,
    title: item.title,
    subhead: item.subhead,
    meta_description: item.meta_description,
    cta_label: item.cta_label,
    secondary_cta_label: item.secondary_cta_label,
    app_cta_url: item.app_cta_url,
    screenshot_url: item.screenshot_url,
    screenshot_alt: item.screenshot_alt,
    screenshot_brief: item.screenshot_brief,
    old_way: { heading: item.old_way.heading, body: item.old_way.body },
    replaces: item.replaces,
    new_way: { heading: item.new_way.heading, steps: item.new_way.steps },
    story: item.story
      ? {
          quote: item.story.quote,
          name: item.story.name,
          role: item.story.role,
          used_before: item.story.used_before,
        }
      : undefined,
    faqs: item.faqs.map(({ q, a }) => ({ q, a })),
    cta_band_heading: item.cta_band_heading,
    cta_band_subhead: item.cta_band_subhead,
    updated: item.updated,
  };
}

export function publicArticle(item: Article): Article {
  return {
    slug: item.slug,
    use_case: item.use_case,
    job_id: item.job_id,
    title: item.title,
    meta_description: item.meta_description,
    category: item.category,
    published: item.published,
    updated: item.updated,
    author: item.author,
    author_role: item.author_role,
    author_avatar: item.author_avatar,
    app_cta_url: item.app_cta_url,
    cta_label: item.cta_label,
    screenshot_url: item.screenshot_url,
    screenshot_alt: item.screenshot_alt,
    screenshot_brief: item.screenshot_brief,
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

export function newestArticles<T extends { published: string }>(
  articles: T[],
): T[] {
  return [...articles].sort((a, b) => b.published.localeCompare(a.published));
}

export function safeHref(href: string): string | undefined {
  if (/^(https?:\/\/|mailto:|\/[^/]|#)/i.test(href) || href === "/")
    return href;
  if (
    !/^[a-z][a-z\d+.-]*:/i.test(href) &&
    !href.startsWith("//") &&
    !/[\u0000-\u0020\\]/.test(href)
  )
    return href;
  return undefined;
}
