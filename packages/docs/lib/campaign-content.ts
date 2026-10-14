import matter from "gray-matter";
import { z } from "zod";

export const USE_CASES_BASE = "/use-cases";
export const ARTICLES_BASE = "/articles";
export const CATEGORY_NAMES = {
  clips: "Clips",
  design: "Design",
  slides: "Slides",
  plans: "Plans",
  analytics: "Analytics",
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
const category = z.enum(categories);
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
const screenshot = z.string().optional();
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
  screenshot_url: screenshot,
  screenshot_alt: text,
  screenshot_brief: text,
  cta_band_heading: text,
  cta_band_subhead: text,
};
const useCaseSchema = z.object({
  ...common,
  app: category,
  subhead: text,
  secondary_cta_label: text,
  old_way: z.object({ heading: text, body: text }),
  replaces: z.array(text).optional(),
  new_way: z.object({ heading: text, steps: z.array(text).min(1) }),
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
  use_case: slug,
  category,
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

function validateScreenshot(value: string | undefined, filename: string): void {
  if (!value?.trim() || /^TODO\b/i.test(value)) {
    console.warn(
      `[campaign-content] ${filename}: screenshot_url missing or TODO; retaining content`,
    );
  } else if (!isSafeCampaignUrl(value) || !/^https?:\/\//.test(value)) {
    throw new Error("screenshot_url must be an absolute HTTP(S) URL or TODO");
  }
}

function parseFiles<T extends { slug: string; screenshot_url?: string }>(
  sources: Record<string, string>,
  schema: z.ZodType<T>,
  markdown: boolean,
): T[] {
  return Object.entries(sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([filename, raw]) => {
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
        validateScreenshot(result.screenshot_url, filename);
        return [result];
      } catch (error) {
        // Log only validation paths/messages, never private frontmatter or YAML excerpts.
        const message =
          error instanceof z.ZodError
            ? error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")
            : error instanceof Error &&
                /^(slug must match|screenshot_url must)/.test(error.message)
              ? error.message
              : "Unable to parse campaign content";
        console.error(
          `[campaign-content] ${filename}: invalid content skipped (${message})`,
        );
        return [];
      }
    });
}

export function parseCampaignContent(
  sources: CampaignSources,
): CampaignContent {
  const useCases = parseFiles(sources.useCases, useCaseSchema, false);
  const bySlug = new Map(useCases.map((item) => [item.slug, item]));
  const articles = parseFiles(sources.articles, articleSchema, true)
    .filter((article) => {
      const linked = bySlug.get(article.use_case);
      if (!linked || linked.job_id === article.job_id) return true;
      console.error(
        `[campaign-content] ${article.slug}: job_id does not match use_case; article skipped`,
      );
      return false;
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
