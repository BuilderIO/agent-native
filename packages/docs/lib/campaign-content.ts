import matter from "gray-matter";
import { z } from "zod";

import {
  DEFAULT_DOCS_LOCALE,
  DOCS_LOCALES,
} from "../app/components/docs-locale";

export const USE_CASES_BASE = "/use-cases";
export const ARTICLES_BASE = "/articles";
export const CATEGORY_NAMES = {
  clips: "Clips",
  design: "Design",
  slides: "Slides",
  plans: "Plans",
  analytics: "Analytics",
  content: "Content",
} as const;
export const categories = [
  "clips",
  "design",
  "slides",
  "plans",
  "analytics",
] as const;
// The articles index is a 3×3 grid of cards.
export const ARTICLES_PAGE_SIZE = 9;

const text = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected nonempty text");
const slug = text.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const app = z.enum([...categories, "content"]);
export function isSafeCampaignUrl(value: string): boolean {
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    // coercion-ok: an unparseable URL fails validation, which the schema reports as an error.
    return false;
  }
}
const safeUrl = text.refine(
  isSafeCampaignUrl,
  "Expected a safe HTTP(S) or root-relative URL",
);
const appUrl = safeUrl.refine(
  (value) => /^https?:\/\//.test(value),
  "Expected an absolute app URL",
);
const date = z.preprocess(
  (value) =>
    value instanceof Date && Number.isFinite(value.getTime())
      ? value.toISOString().slice(0, 10)
      : value,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    }, "Expected a valid ISO calendar date"),
);
// Who a page is for; the use-cases index filters by it.
const role = z.enum([
  "engineering",
  "product",
  "design",
  "marketing",
  "revops",
  "sales",
  "founders",
  "finance",
  "everyone",
]);
// An article as the content factory writes it (its how-to-guide skill's references/site-template.md).
const articleImage = z.object({ dark: safeUrl, light: safeUrl, alt: text });
const articleSchema = z.object({
  slug,
  type: z.enum(["how-to-guide"]),
  title: text,
  seo_title: text,
  og_line: text,
  meta_description: text,
  og_image: safeUrl,
  published: date,
  updated: date,
  author: z.object({
    name: text,
    url: safeUrl,
    same_as: z.array(safeUrl).optional(),
    role: text.optional(),
    photo: safeUrl.optional(),
    bio: text.optional(),
  }),
  app: text.optional(),
  cta: z
    .object({
      label: text,
      url: appUrl,
      heading: text.optional(),
      prompt: text.optional(),
    })
    .optional(),
  use_case: slug.optional(),
  images: z.array(articleImage),
  faqs: z.array(z.object({ q: text, a: text })),
  body: text,
});

const themedImage = z.object({ dark: safeUrl, light: safeUrl, alt: text });
// Use-case pages, written by Content Factory.
const useCaseSchema = z.object({
  slug,
  app,
  roles: z.array(role).min(1).optional(),
  title: text,
  seo_title: text,
  meta_description: text,
  updated: date,
  hero: z.object({
    body: text,
    button: z.object({ label: text, url: appUrl }),
    image: themedImage,
  }),
  how_to: z.object({
    heading: text,
    steps: z
      .array(z.object({ title: text, body: text, image: themedImage }))
      .min(3)
      .max(4),
  }),
  features: z.object({
    heading: text,
    items: z.array(z.object({ title: text, body: text })).length(6),
  }),
  integrations: z.object({
    heading: text,
    cards: z
      .array(
        z.object({
          title: text,
          // A logo's src is its CDN link; without one the page uses the
          // apps' built-in logo for that tool.
          logos: z
            .array(
              z.object({
                name: text,
                src: safeUrl.optional(),
                // A black-only logo, inverted on the dark theme.
                mono: z.boolean().optional(),
              }),
            )
            .min(2)
            .max(6),
          // The MCP card: its logos are examples, and the page adds a "+".
          more: z.boolean().optional(),
          body: text,
        }),
      )
      .length(3),
  }),
  other_uses: z
    .object({
      heading: text,
      cards: z
        .array(z.object({ title: text, url: safeUrl, body: text }))
        .min(1)
        .max(3),
    })
    .optional(),
  faqs: z.object({
    heading: text,
    items: z
      .array(z.object({ q: text, a: text }))
      .min(3)
      .max(6),
  }),
});
export type UseCase = z.infer<typeof useCaseSchema>;
/** A use-case page in English, with its translations keyed by locale ("de-DE"). */
export type UseCaseEntry = UseCase & {
  translations: Partial<Record<string, UseCase>>;
};
export type PublicArticle = z.infer<typeof articleSchema>;
/** An article in English, with its translations keyed by locale ("de-DE"). */
export type ArticleEntry = PublicArticle & {
  translations: Partial<Record<string, PublicArticle>>;
};
export type CampaignContent = {
  useCases: UseCaseEntry[];
  articles: ArticleEntry[];
};
export type CampaignSources = {
  useCases: Record<string, string>;
  /** content/use-cases/<locale>/<slug>.yaml: translations of the pages. */
  useCaseTranslations?: Record<string, string>;
  articles: Record<string, string>;
  /** content/articles/<locale>/<slug>.md: translations of the articles. */
  articleTranslations?: Record<string, string>;
};
const LOCALE_FOLDER = /\/([a-z]{2}-[A-Z]{2})\/[^/]+\.(?:yaml|md)$/;
const TRANSLATED_LOCALES: readonly string[] = DOCS_LOCALES.filter(
  (locale) => locale !== DEFAULT_DOCS_LOCALE,
);

function parseFiles<T extends { slug: string }>(
  sources: Record<string, string>,
  schema: z.ZodType<T>,
  markdown: boolean,
): T[] {
  return Object.entries(sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filename, raw]) => {
      try {
        const parsed = matter(markdown ? raw : `---\n${raw}\n---\n`);
        const result = schema.parse(
          markdown ? { ...parsed.data, body: parsed.content } : parsed.data,
        );
        const fileSlug = filename
          .split("/")
          .pop()
          ?.replace(/\.(?:yaml|md)$/, "");
        if (result.slug !== fileSlug)
          throw new Error(`slug must match filename ${fileSlug}`);
        return result;
      } catch (error) {
        // Report only validation paths/messages, never private frontmatter or YAML excerpts.
        const message =
          error instanceof z.ZodError
            ? error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")
            : error instanceof Error && /^slug must match/.test(error.message)
              ? error.message
              : "Unable to parse campaign content";
        throw new Error(
          `[campaign-content] ${filename}: invalid content (${message})`,
        );
      }
    });
}

// A translation that matches nothing must fail the build: dropping it would
// ship a page that silently stays English.
function attachTranslations<T extends { slug: string }>(
  entries: (T & { translations: Partial<Record<string, T>> })[],
  sources: Record<string, string>,
  schema: z.ZodType<T>,
  markdown: boolean,
  /** What a translation must share with its English entry besides the slug. */
  matchKey: (item: T) => string,
  rule: string,
): void {
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  const files = Object.keys(sources).sort((a, b) => a.localeCompare(b));
  parseFiles(sources, schema, markdown).forEach((translation, index) => {
    const file = files[index];
    const locale = file && LOCALE_FOLDER.exec(file)?.[1];
    const entry = bySlug.get(translation.slug);
    if (
      !locale ||
      !TRANSLATED_LOCALES.includes(locale) ||
      !entry ||
      matchKey(entry) !== matchKey(translation)
    )
      throw new Error(
        `[campaign-content] ${file}: invalid content (a translation must sit in a site locale folder and match ${rule})`,
      );
    entry.translations[locale] = translation;
  });
}

export function parseCampaignContent(
  sources: CampaignSources,
): CampaignContent {
  const useCases = parseFiles(sources.useCases, useCaseSchema, false).map(
    (page): UseCaseEntry => ({ ...page, translations: {} }),
  );
  attachTranslations(
    useCases,
    sources.useCaseTranslations ?? {},
    useCaseSchema,
    false,
    (page) => page.app,
    "an English page's slug and app",
  );
  const articles = parseFiles(sources.articles, articleSchema, true)
    .sort(
      (a, b) =>
        b.updated.localeCompare(a.updated) || a.slug.localeCompare(b.slug),
    )
    .map((article): ArticleEntry => ({ ...article, translations: {} }));
  attachTranslations(
    articles,
    sources.articleTranslations ?? {},
    articleSchema,
    true,
    (article) => JSON.stringify([article.type, article.app ?? null]),
    "an English article's slug, type and app",
  );
  return { useCases, articles };
}

/** The other languages at least one article is translated into, in site order. */
export function translatedArticleLocales(articles: ArticleEntry[]): string[] {
  return TRANSLATED_LOCALES.filter((locale) =>
    articles.some((article) => article.translations[locale]),
  );
}

export function articleMarkdown(article: PublicArticle): string {
  return `# ${article.title}\n\n${article.body}\n`;
}
