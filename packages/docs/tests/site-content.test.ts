// oracle-change(packages/docs/tests/campaign-foundation.test.ts): renamed here when campaign content became site content; its assertions moved with it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSiteContentCtaUrl } from "../app/lib/site-content-links";
import { siteContentMeta } from "../app/lib/site-content-seo";
import { buildSiteContentPages } from "../app/vite-sitemap-plugin";
import {
  ARTICLE_TYPES,
  ARTICLES_PAGE_SIZE,
  articleMarkdown,
  parseSiteContent,
} from "../lib/site-content";
import { loadSiteContentFromDisk } from "../lib/site-content-node";
import { loadSiteContent } from "../lib/site-content.server";

const image = {
  dark: "https://example.com/dark.png",
  light: "https://example.com/light.png",
  alt: "Sample image",
};
const useCase = {
  slug: "sample",
  app: "clips",
  title: "Sample",
  seo_title: "Sample search title",
  meta_description: "Sample description",
  updated: "2026-09-01",
  hero: {
    body: "Sample workflow",
    button: { label: "Try", url: "https://example.com/app?existing=1" },
    image,
    internal: "PRIVATE-NESTED",
  },
  how_to: {
    heading: "How it works",
    steps: [1, 2, 3].map((step) => ({
      title: `Step ${step}`,
      body: "Start",
      image,
    })),
  },
  features: {
    heading: "Features",
    items: Array.from({ length: 6 }, (_, index) => ({
      title: `Feature ${index + 1}`,
      body: "Saves time",
    })),
  },
  integrations: {
    heading: "Integrations",
    cards: Array.from({ length: 3 }, (_, index) => ({
      title: `Card ${index + 1}`,
      logos: [{ name: "Slack" }, { name: "Linear" }],
      body: "Connects",
    })),
  },
  faqs: {
    heading: "FAQs",
    items: [
      { q: "Why?", a: "Time" },
      { q: "How?", a: "Ask" },
      { q: "When?", a: "Weekly" },
    ],
  },
  audience: "PRIVATE-AUDIENCE",
  internal: { strategy: "PRIVATE-STRATEGY" },
};
const roles = [
  "engineering",
  "product",
  "design",
  "marketing",
  "revops",
  "sales",
  "founders",
  "finance",
  "everyone",
];
// A complete how-to guide article.
const article = {
  slug: "sample",
  type: "how-to-guide",
  title: "Sample",
  seo_title: "Sample search title",
  og_line: "Sample share line",
  meta_description: "Sample description",
  og_image: "https://example.com/og.png",
  published: "2026-09-02",
  updated: "2026-09-02",
  author: {
    name: "Writer",
    url: "https://example.com/writer",
    same_as: ["https://example.com/writer"],
    internal: "PRIVATE-AUTHOR",
  },
  app: "Clips",
  cta: {
    label: "Try",
    url: "https://example.com/app?existing=1",
    heading: "Try the workflow",
    prompt: "Read this guide and help me.",
    internal: "PRIVATE-CTA",
  },
  use_case: "sample",
  images: [{ ...image, internal: "PRIVATE-IMAGE" }],
  faqs: [{ q: "Why?", a: "Time", internal: "PRIVATE-FAQ" }],
  audience: "PRIVATE-AUDIENCE",
  internal: "PRIVATE-STRATEGY",
};
const yaml = (value: unknown) => JSON.stringify(value);
const markdown = (value: unknown, body = "Public article body.") =>
  `---\n${yaml(value)}\n---\n\n${body}`;
function sources(
  useCases: Record<string, string> = { "sample.yaml": yaml(useCase) },
  articles: Record<string, string> = { "sample.md": markdown(article) },
) {
  return { useCases, articles };
}
function articleError(value: unknown): string {
  try {
    parseSiteContent(
      sources(undefined, {
        "sample.md": markdown(value),
        "valid.md": markdown({ ...article, slug: "valid" }),
      }),
    );
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

afterEach(() => vi.restoreAllMocks());

// oracle-change: articles were rebuilt as how-to guides; the topic, category, apps, screenshot and related-resource fields were removed from the schema, so their tests went with them and the new schema is tested here.
describe("site content", () => {
  it("strips private and unknown fields recursively, including Markdown mirrors", () => {
    const content = parseSiteContent(sources());
    expect(content.useCases).toHaveLength(1);
    expect(content.articles).toHaveLength(1);
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
    expect(articleMarkdown(content.articles[0])).toBe(
      "# Sample\n\n\nPublic article body.\n",
    );
    expect(JSON.stringify(buildSiteContentPages(content))).not.toContain(
      "PRIVATE",
    );
  });

  // oracle-change: the original use-case schema (todays_stack, recipes, angles, frequency, stories, job_id matching) was removed with its template; roles is the only one of its fields the new page schema keeps.
  it("accepts absent roles without inventing a default, and every configured role", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseSiteContent(sources()).useCases[0]).not.toHaveProperty("roles");
    const content = parseSiteContent(
      sources({ "sample.yaml": yaml({ ...useCase, roles }) }),
    );
    expect(content.useCases[0].roles).toEqual(roles);
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
    expect(error).not.toHaveBeenCalled();
  });

  it.each([null, 42, {}, ["admin"], [1]])(
    "throws on malformed roles (%j) even alongside valid siblings",
    (value) => {
      let message = "";
      try {
        parseSiteContent(
          sources(
            {
              "sample.yaml": yaml({ ...useCase, roles: value }),
              "valid.yaml": yaml({ ...useCase, slug: "valid" }),
            },
            {},
          ),
        );
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("sample.yaml: invalid content (roles");
      expect(message).not.toContain("PRIVATE");
    },
  );

  it("accepts Content as a use-case app and article app without creating an app category page", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = parseSiteContent(
      sources(
        { "sample.yaml": yaml({ ...useCase, app: "content" }) },
        { "sample.md": markdown({ ...article, app: "Content" }) },
      ),
    );
    expect(content.useCases[0].app).toBe("content");
    expect(content.articles[0].app).toBe("Content");
    expect(error).not.toHaveBeenCalled();
    const paths = buildSiteContentPages(content).map((page) => page.path);
    expect(paths).toContain("/use-cases/sample/");
    expect(paths.some((path) => /\/(category|topic)\//.test(path))).toBe(false);
  });

  it("keeps every field of a full guide, including nested author, cta, images and faqs", () => {
    const [parsed] = parseSiteContent(sources()).articles;
    expect(parsed).toEqual({
      slug: "sample",
      type: "how-to-guide",
      title: "Sample",
      seo_title: "Sample search title",
      og_line: "Sample share line",
      meta_description: "Sample description",
      og_image: "https://example.com/og.png",
      published: "2026-09-02",
      updated: "2026-09-02",
      author: {
        name: "Writer",
        url: "https://example.com/writer",
        same_as: ["https://example.com/writer"],
      },
      app: "Clips",
      cta: {
        label: "Try",
        url: "https://example.com/app?existing=1",
        heading: "Try the workflow",
        prompt: "Read this guide and help me.",
      },
      use_case: "sample",
      images: [image],
      faqs: [{ q: "Why?", a: "Time" }],
      body: "\nPublic article body.",
      translations: {},
    });
  });

  it("accepts a guide with no app, call to action, use case or optional author fields without inventing them", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app: _app, cta: _cta, use_case: _useCase, ...standalone } = article;
    const [parsed] = parseSiteContent(
      sources(
        {},
        {
          "sample.md": markdown({
            ...standalone,
            author: { name: "Writer", url: "/about/" },
            images: [],
            faqs: [],
          }),
        },
      ),
    ).articles;
    expect(parsed.author).toEqual({ name: "Writer", url: "/about/" });
    for (const key of ["app", "cta", "use_case"])
      expect(parsed).not.toHaveProperty(key);
    expect(parsed.images).toEqual([]);
    expect(parsed.faqs).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    "how-to-guide",
    "beginners-guide",
    "definition",
    "listicle",
    "pillar-page",
  ])("accepts the %s article type", (type) => {
    const [parsed] = parseSiteContent(
      sources({}, { "sample.md": markdown({ ...article, type }) }),
    ).articles;
    expect(parsed.type).toBe(type);
  });

  it("accepts a call to action without a callout heading or prompt", () => {
    const [parsed] = parseSiteContent(
      sources(undefined, {
        "sample.md": markdown({
          ...article,
          cta: { label: "Try", url: "https://example.com/app" },
        }),
      }),
    ).articles;
    expect(parsed.cta).toEqual({
      label: "Try",
      url: "https://example.com/app",
    });
  });

  it.each([
    ["type", { type: undefined }],
    ["type", { type: "article" }],
    ["seo_title", { seo_title: undefined }],
    ["og_line", { og_line: " " }],
    ["og_image", { og_image: undefined }],
    ["og_image", { og_image: "javascript:evil()" }],
    ["updated", { updated: undefined }],
    ["published", { published: "2026-02-30" }],
    ["author", { author: "Writer" }],
    ["author.url", { author: { name: "Writer" } }],
    ["author.url", { author: { name: "Writer", url: "//evil.example" } }],
    [
      "author.same_as.0",
      { author: { ...article.author, same_as: ["javascript:evil()"] } },
    ],
    ["cta.label", { cta: { url: "https://example.com/app" } }],
    ["cta.url", { cta: { label: "Try", url: "/relative-app" } }],
    ["cta.url", { cta: { label: "Try", url: "javascript:evil()" } }],
    ["images", { images: undefined }],
    ["images.0.light", { images: [{ dark: image.dark, alt: image.alt }] }],
    ["images.0.alt", { images: [{ dark: image.dark, light: image.light }] }],
    ["faqs", { faqs: undefined }],
    ["faqs.0.a", { faqs: [{ q: "Why?" }] }],
    ["use_case", { use_case: "Not A Slug" }],
  ] as const)(
    "rejects an invalid or missing %s without leaking input",
    (field, override) => {
      const message = articleError({ ...article, ...override });
      expect(message).toContain(`sample.md: invalid content (${field}:`);
      expect(message).not.toContain("PRIVATE");
      expect(message).not.toContain("valid.md");
    },
  );

  it("drops the old article format's fields instead of carrying them forward", () => {
    const [parsed] = parseSiteContent(
      sources(undefined, {
        "sample.md": markdown({
          ...article,
          job_id: "PRIVATE-JOB",
          topic: "coding-agents",
          apps: ["clips"],
          app_cta_url: "https://example.com/app",
          screenshot_alt: "PRIVATE-ALT",
          related_resources: [{ label: "Docs", url: "/docs/" }],
        }),
      }),
    ).articles;
    for (const key of [
      "job_id",
      "topic",
      "apps",
      "app_cta_url",
      "screenshot_alt",
      "related_resources",
    ])
      expect(parsed).not.toHaveProperty(key);
  });

  it("sorts articles newest first by updated date, then by slug", () => {
    const content = parseSiteContent(
      sources(
        {},
        {
          "b-tie.md": markdown({
            ...article,
            slug: "b-tie",
            published: "2026-01-01",
            updated: "2026-05-01",
          }),
          "a-tie.md": markdown({
            ...article,
            slug: "a-tie",
            published: "2026-01-01",
            updated: "2026-05-01",
          }),
          "newly-published.md": markdown({
            ...article,
            slug: "newly-published",
            published: "2026-04-01",
            updated: "2026-04-01",
          }),
          "recently-updated.md": markdown({
            ...article,
            slug: "recently-updated",
            published: "2025-01-01",
            updated: "2026-06-01",
          }),
        },
      ),
    );
    expect(content.articles.map((item) => item.slug)).toEqual([
      "recently-updated",
      "a-tie",
      "b-tie",
      "newly-published",
    ]);
  });

  it("does not validate or project removed screenshot fields and preserves original public text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const removed = {
      screenshot_url: { internal: "PRIVATE-SCREENSHOT" },
      screenshot_brief: null,
    };
    const content = parseSiteContent(
      sources(
        { "sample.yaml": yaml({ ...useCase, ...removed, title: " Sample " }) },
        { "sample.md": markdown({ ...article, ...removed }) },
      ),
    );
    expect(content.useCases).toHaveLength(1);
    expect(content.articles).toHaveLength(1);
    for (const item of [...content.useCases, ...content.articles]) {
      expect(item).not.toHaveProperty("screenshot_url");
      expect(item).not.toHaveProperty("screenshot_brief");
    }
    expect(JSON.stringify(content)).not.toContain("PRIVATE-SCREENSHOT");
    expect(content.useCases[0].title).toBe(" Sample ");
    expect(content.articles[0].body).toBe("\nPublic article body.");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("validates every use case and article through bundled and disk loaders without warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bundled = loadSiteContent();
    const disk = loadSiteContentFromDisk(
      fileURLToPath(new URL("..", import.meta.url)),
    );
    expect(bundled.useCases.map((page) => page.slug).sort()).toEqual([
      "ai-bug-reporting-tool",
      "ai-dictation",
      "ai-funnel-analysis",
      "ai-kpi-dashboard",
      "ai-meeting-notes",
      "ai-pitch-deck-maker",
      "ai-prototype-generator",
      "ai-sales-analytics",
      "ask-your-database",
      "landing-page-prototypes",
      "specs-for-coding-agents",
      "ui-planning",
      "visual-plan-mode",
      "visually-recap-agent-changes",
      "weekly-marketing-report",
    ]);
    expect(bundled.articles.map((item) => item.slug)).toContain(
      "qbr-presentation",
    );
    for (const item of bundled.articles) {
      expect(ARTICLE_TYPES, item.slug).toContain(item.type);
      if (item.use_case)
        expect(
          bundled.useCases.map((page) => page.slug),
          item.slug,
        ).toContain(item.use_case);
    }
    expect(bundled).toEqual(disk);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const serialized = JSON.stringify(bundled);
    expect(serialized).not.toMatch(/"internal":/);
    for (const item of [...bundled.useCases, ...bundled.articles]) {
      expect(item).not.toHaveProperty("audience");
      expect(item).not.toHaveProperty("screenshot_url");
    }
  });

  it("normalizes YAML dates and rejects impossible dates", () => {
    // A block YAML scalar exercises gray-matter's Date parser rather than JSON strings.
    const dated = `slug: sample\nupdated: 2026-09-01\n${Object.entries(useCase)
      .filter(([key]) => !["slug", "updated"].includes(key))
      .map(([key, value]) => `${key}: ${yaml(value)}`)
      .join("\n")}`;
    expect(
      parseSiteContent(sources({ "sample.yaml": dated })).useCases[0].updated,
    ).toBe("2026-09-01");
    expect(() =>
      parseSiteContent(
        sources({ "sample.yaml": yaml({ ...useCase, updated: "2026-02-30" }) }),
      ),
    ).toThrow(/sample\.yaml: invalid content \(updated/);
    const articleYaml = `---\n${Object.entries(article)
      .filter(([key]) => !["published", "updated"].includes(key))
      .map(([key, value]) => `${key}: ${yaml(value)}`)
      .join("\n")}\npublished: 2026-09-02\nupdated: 2026-10-28\n---\n\nBody.`;
    const [parsed] = parseSiteContent(
      sources(undefined, { "sample.md": articleYaml }),
    ).articles;
    expect([parsed.published, parsed.updated]).toEqual([
      "2026-09-02",
      "2026-10-28",
    ]);
  });

  it("throws on invalid files, filename mismatches and unsafe URLs without leaking input", () => {
    expect(() =>
      parseSiteContent(sources({ "wrong.yaml": yaml(useCase) })),
    ).toThrow("wrong.yaml: invalid content (slug must match filename wrong)");
    expect(() =>
      parseSiteContent(sources(undefined, { "wrong.md": markdown(article) })),
    ).toThrow("wrong.md: invalid content (slug must match filename wrong)");
    expect(() =>
      parseSiteContent(
        sources({ "sample.yaml": "title: PRIVATE-SECRET\n[broken" }),
      ),
    ).toThrow("sample.yaml: invalid content (Unable to parse site content)");
    try {
      parseSiteContent(
        sources({ "sample.yaml": "title: PRIVATE-SECRET\n[broken" }),
      );
    } catch (error) {
      expect((error as Error).message).not.toContain("PRIVATE-SECRET");
    }
    expect(() =>
      parseSiteContent(
        sources({
          "sample.yaml": yaml({
            ...useCase,
            hero: {
              ...useCase.hero,
              button: { label: "Try", url: "javascript:evil()" },
            },
          }),
        }),
      ),
    ).toThrow(/sample\.yaml: invalid content \(hero\.button\.url/);
  });

  it("allows an absent matching use case and valid content without screenshot warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = parseSiteContent(
      sources({}, { "sample.md": markdown(article) }),
    );
    expect(content.articles).toHaveLength(1);
    const complete = parseSiteContent(sources());
    expect(complete.useCases).toHaveLength(1);
    expect(complete.articles).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("throws on unreadable/missing source directories rather than reporting empty content", () => {
    expect(() => loadSiteContentFromDisk("/missing-site-content")).toThrow(
      "Unable to enumerate/read",
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-content-"));
    try {
      fs.mkdirSync(path.join(root, "content", "use-cases"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(root, "content", "articles"));
      expect(loadSiteContentFromDisk(root)).toEqual({
        useCases: [],
        articles: [],
      });
      fs.writeFileSync(
        path.join(root, "content", "use-cases", "sample.yaml"),
        yaml(useCase),
      );
      expect(loadSiteContentFromDisk(root).useCases).toHaveLength(1);
      fs.mkdirSync(path.join(root, "content", "articles", "de-DE"));
      fs.writeFileSync(
        path.join(root, "content", "articles", "sample.md"),
        markdown(article),
      );
      fs.writeFileSync(
        path.join(root, "content", "articles", "de-DE", "sample.md"),
        markdown({ ...article, title: "Beispiel" }),
      );
      expect(
        loadSiteContentFromDisk(root).articles[0]?.translations["de-DE"]?.title,
      ).toBe("Beispiel");
      const read = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("Unreadable");
      });
      expect(() => loadSiteContentFromDisk(root)).toThrow(
        "Unable to enumerate/read",
      );
      read.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("attaches article translations from site locale folders and rejects mismatches", () => {
    const german = { ...article, title: "Beispiel", updated: "2026-09-03" };
    const content = parseSiteContent({
      ...sources(),
      articleTranslations: {
        "articles/de-DE/sample.md": markdown(german, "Deutscher Text."),
      },
    });
    const entry = content.articles.at(0);
    if (!entry) throw new Error("Expected the English article");
    expect(entry.title).toBe("Sample");
    expect(Object.keys(entry.translations)).toEqual(["de-DE"]);
    expect(entry.translations["de-DE"]).toMatchObject({
      slug: "sample",
      title: "Beispiel",
      body: "\nDeutscher Text.",
    });
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
    for (const [file, value] of [
      ["articles/de-DE/other.md", { ...german, slug: "other" }],
      ["articles/de-DE/sample.md", { ...german, app: "Slides" }],
      ["articles/de-DE/sample.md", { ...german, app: undefined }],
      ["articles/xx-XX/sample.md", german],
      ["articles/en-US/sample.md", german],
      ["articles/sample.md", german],
    ] as const)
      expect(
        () =>
          parseSiteContent({
            ...sources(),
            articleTranslations: { [file]: markdown(value) },
          }),
        file,
      ).toThrow(
        `${file}: invalid content (a translation must sit in a site locale folder and match an English article's slug, type and app)`,
      );
    expect(() =>
      parseSiteContent({
        ...sources(),
        articleTranslations: {
          "articles/de-DE/sample.md": markdown({ ...german, type: "guide" }),
        },
      }),
    ).toThrow(/de-DE\/sample\.md: invalid content \(type/);
  });

  it("paginates the index at nine, with supplied dates, safe article mirrors and no topic pages", () => {
    expect(ARTICLES_PAGE_SIZE).toBe(9);
    const content = parseSiteContent(sources());
    content.articles = Array.from({ length: 10 }, (_, index) => ({
      ...content.articles[0],
      slug: `article-${index}`,
    }));
    const pages = buildSiteContentPages(content);
    const paths = pages.map((page) => page.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/use-cases/",
        "/use-cases/sample/",
        "/articles/",
        "/articles/page/2/",
      ]),
    );
    expect(
      pages.find((page) => page.path === "/use-cases/sample/")?.lastmod,
    ).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(
      pages.find((page) => page.path === "/articles/article-0/")?.markdownPath,
    ).toBe("/articles/article-0.md");
    const index = pages.find((page) => page.path === "/articles/");
    if (!index) throw new Error("Expected the articles index");
    expect(index.markdown?.match(/^- \[/gm)).toHaveLength(9);
    expect(index.markdown).not.toContain("article-9/");
    const second = pages.find((page) => page.path === "/articles/page/2/");
    if (!second) throw new Error("Expected the second index page");
    expect(second.markdown?.match(/^- \[/gm)).toHaveLength(1);
    expect(second.markdown).toContain("(/articles/article-9/)");
    expect(paths).not.toContain("/articles/page/1/");
    expect(paths).not.toContain("/articles/page/3/");
    expect(paths.some((path) => /\/(category|topic)\//.test(path))).toBe(false);
  });
});

describe("site content CTA and SEO", () => {
  it("preserves duplicate incoming tracking values, destination state and hash, and sets the job", () => {
    const url = new URL(
      buildSiteContentCtaUrl(
        "https://example.com/?existing=1&utm_source=old&job=old#open",
        "new-job",
        "?utm_source=a&utm_source=b&utm_content=custom&gclid=1&gclid=2&msclkid=m&fbclid=f&angle=engineering&ignored=no&job=attacker",
      ),
    );
    expect(url.searchParams.getAll("utm_source")).toEqual(["a", "b"]);
    expect(url.searchParams.getAll("gclid")).toEqual(["1", "2"]);
    expect(url.searchParams.get("utm_content")).toBe("custom");
    expect(url.searchParams.get("msclkid")).toBe("m");
    expect(url.searchParams.get("fbclid")).toBe("f");
    expect(url.searchParams.get("job")).toBe("new-job");
    expect(url.searchParams.get("angle")).toBe("engineering");
    expect(url.searchParams.get("existing")).toBe("1");
    expect(url.searchParams.has("ignored")).toBe(false);
    expect(url.hash).toBe("#open");
  });

  it("overrides destination utm_content unless the visitor supplies it, preserving empty and duplicate values", () => {
    expect(
      new URL(
        buildSiteContentCtaUrl("https://example.com/", "job", ""),
      ).searchParams.get("utm_content"),
    ).toBe("job");
    expect(
      new URL(
        buildSiteContentCtaUrl(
          "https://example.com/?utm_content=dest",
          "job",
          "",
        ),
      ).searchParams.get("utm_content"),
    ).toBe("job");
    expect(
      new URL(
        buildSiteContentCtaUrl(
          "https://example.com/",
          "job",
          "?utm_content=&utm_content=second",
        ),
      ).searchParams.getAll("utm_content"),
    ).toEqual(["", "second"]);
    expect(() =>
      buildSiteContentCtaUrl("javascript:evil()", "job", ""),
    ).toThrow();
  });

  it("uses www canonical origin and the existing title-aware OG endpoint", () => {
    const meta = siteContentMeta(
      "Sample",
      "Description",
      "/articles/sample/",
      "article",
    );
    expect(meta).toContainEqual({ title: "Sample | Agent-Native" });
    expect(meta).toContainEqual({ property: "og:title", content: "Sample" });
    expect(meta).toContainEqual({
      property: "og:description",
      content: "Description",
    });
    expect(meta).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://www.agent-native.com/articles/sample/",
    });
    expect(meta).toContainEqual({ property: "og:type", content: "article" });
    expect(meta).toContainEqual({
      name: "robots",
      content: "index, max-image-preview:large",
    });
    expect(meta).toContainEqual({ name: "twitter:title", content: "Sample" });
    const image = meta.find(
      (item) => "property" in item && item.property === "og:image",
    );
    expect(
      image && "content" in image
        ? new URL(image.content as string).searchParams.get("title")
        : undefined,
    ).toBe("Sample");
    expect(() =>
      siteContentMeta("Title", "Description", "//evil.example"),
    ).toThrow();
  });

  it("uses a supplied share image for og:image instead of the title endpoint", () => {
    const meta = siteContentMeta(
      "Sample",
      "Description",
      "/articles/sample/",
      "article",
      undefined,
      "https://example.com/og.png",
    );
    expect(meta).toContainEqual({
      property: "og:image",
      content: "https://example.com/og.png",
    });
    expect(JSON.stringify(meta)).not.toContain("title=Sample");
  });
});
