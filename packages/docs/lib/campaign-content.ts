import matter from "gray-matter";
import { z } from "zod";

import { ARTICLE_TOPICS, type ArticleTopic } from "./article-topics";

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
export const ARTICLES_PAGE_SIZE = 12;

const text = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected nonempty text");
const slug = text.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const app = z.enum([...categories, "content"]);
const topic = z.enum(
  Object.keys(ARTICLE_TOPICS) as [ArticleTopic, ...ArticleTopic[]],
);
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
const common = {
  slug,
  job_id: text,
  title: text,
  meta_description: text,
  app_cta_url: appUrl,
  cta_label: text,
  screenshot_alt: text,
  cta_band_heading: text,
  cta_band_subhead: text,
};
const useCaseSchema = z.object({
  ...common,
  app,
  subhead: text,
  secondary_cta_label: text,
  old_way: z.object({ heading: text, body: text }),
  replaces: z.array(text).optional(),
  new_way: z.object({ heading: text, steps: z.array(text).min(1) }),
  todays_stack: z
    .object({
      heading: text,
      items: z.array(z.object({ text })),
      in_app: text,
    })
    .optional(),
  recipes: z
    .array(
      z.object({
        id: slug,
        title: text,
        when: text,
        steps: z.array(text).min(1).max(4),
        prompt: text.optional(),
        result: text,
        tip: text.optional(),
        how_often: text,
      }),
    )
    .optional(),
  next_jobs: z.array(slug).optional(),
  connects_to: z.array(text).optional(),
  frequency: z
    .enum(["daily", "weekly", "per-project", "occasional"])
    .optional(),
  how_often_label: text.optional(),
  roles: z
    .array(
      z.enum([
        "engineering",
        "product",
        "design",
        "marketing",
        "revops",
        "sales",
        "founders",
        "finance",
        "everyone",
      ]),
    )
    .optional(),
  angles: z
    .array(
      z.object({
        id: slug,
        audience: text,
        title: text,
        subhead: text,
        old_way_body: text.optional(),
      }),
    )
    .optional(),
  story: z
    .object({
      quote: text,
      name: text,
      role: text,
      used_before: z
        .union([text, z.array(text)])
        .transform((value) => (typeof value === "string" ? [value] : value)),
    })
    .nullish()
    .transform((value) => value ?? undefined),
  faqs: z.array(z.object({ q: text, a: text })),
  updated: date,
});
const articleSchema = z.object({
  ...common,
  use_case: slug.optional(),
  screenshot_alt: text.optional(),
  topic,
  apps: z.array(app).optional(),
  published: date,
  updated: date.optional(),
  author: text,
  author_role: text.optional(),
  author_avatar: safeUrl.optional(),
  related_resources: z.array(z.object({ label: text, url: safeUrl })),
  related: z.array(slug).optional(),
  body: text,
});
export type PublicUseCase = z.infer<typeof useCaseSchema>;
export type PublicArticle = z.infer<typeof articleSchema>;
export type CampaignContent = {
  useCases: PublicUseCase[];
  articles: PublicArticle[];
};
export type CampaignSources = {
  useCases: Record<string, string>;
  articles: Record<string, string>;
};

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

export function parseCampaignContent(
  sources: CampaignSources,
): CampaignContent {
  const useCases = parseFiles(sources.useCases, useCaseSchema, false);
  const bySlug = new Map(useCases.map((item) => [item.slug, item]));
  const articles = parseFiles(sources.articles, articleSchema, true)
    .map((article) => {
      const linked = article.use_case
        ? bySlug.get(article.use_case)
        : undefined;
      if (linked && linked.job_id !== article.job_id)
        throw new Error(
          `[campaign-content] ${article.slug}: invalid content (job_id does not match use_case)`,
        );
      return article;
    })
    .sort(
      (a, b) =>
        b.published.localeCompare(a.published) || a.slug.localeCompare(b.slug),
    );
  return { useCases, articles };
}

export function articleMarkdown(article: PublicArticle): string {
  return `# ${article.title}\n\n${article.body}\n`;
}
