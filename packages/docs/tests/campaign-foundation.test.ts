import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCampaignCtaUrl } from "../app/lib/campaign-links";
import { campaignMeta } from "../app/lib/campaign-seo";
import { buildCampaignPages } from "../app/vite-sitemap-plugin";
import {
  ARTICLE_TOPICS,
  getArticleTopics,
  type ArticleTopic,
  type ArticleTopicSummary,
} from "../lib/article-topics";
import { articleMarkdown, parseCampaignContent } from "../lib/campaign-content";
import { loadCampaignContentFromDisk } from "../lib/campaign-content-node";
import { loadCampaignContent } from "../lib/campaign-content.server";

const common = {
  slug: "sample",
  job_id: "sample-job",
  title: "Sample",
  meta_description: "Sample description",
  app_cta_url: "https://example.com/app?existing=1",
  cta_label: "Try",
  screenshot_alt: "Sample image",
  cta_band_heading: "Try the workflow",
  cta_band_subhead: "Start here",
};
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
const article = {
  ...common,
  use_case: "sample",
  topic: "coding-agents",
  apps: ["clips"],
  published: "2026-09-02",
  author: "Writer",
  related_resources: [
    { label: "Docs", url: "/docs/", internal: "PRIVATE-LINK" },
  ],
  audience: "PRIVATE-AUDIENCE",
  internal: "PRIVATE-STRATEGY",
};
const yaml = (value: unknown) => JSON.stringify(value);
const markdown = (value: unknown, body = "Public article body.") =>
  `---\n${yaml(value)}\n---\n\n${body}`;
function sources(
  useCases = { "sample.yaml": yaml(useCase) },
  articles = { "sample.md": markdown(article) },
) {
  return { useCases, articles };
}

afterEach(() => vi.restoreAllMocks());

describe("campaign content", () => {
  it("strips private and unknown fields recursively, including Markdown mirrors", () => {
    const content = parseCampaignContent(sources());
    expect(content.useCases).toHaveLength(1);
    expect(content.articles).toHaveLength(1);
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
    expect(articleMarkdown(content.articles[0])).toBe(
      "# Sample\n\n\nPublic article body.\n",
    );
    expect(JSON.stringify(buildCampaignPages(content))).not.toContain(
      "PRIVATE",
    );
  });

  // oracle-change: the original use-case schema (todays_stack, recipes, angles, frequency, stories, job_id matching) was removed with its template; roles is the only one of its fields the new page schema keeps.
  it("accepts absent roles without inventing a default, and every configured role", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseCampaignContent(sources()).useCases[0]).not.toHaveProperty(
      "roles",
    );
    const content = parseCampaignContent(
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
        parseCampaignContent(
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
    const content = parseCampaignContent(
      sources(
        { "sample.yaml": yaml({ ...useCase, app: "content" }) },
        { "sample.md": markdown({ ...article, apps: ["content"] }) },
      ),
    );
    expect(content.useCases[0].app).toBe("content");
    expect(content.articles[0].apps).toEqual(["content"]);
    expect(error).not.toHaveBeenCalled();
    const paths = buildCampaignPages(content).map((page) => page.path);
    expect(paths).toContain("/use-cases/sample/");
    expect(paths.some((path) => path.includes("/category/"))).toBe(false);
  });

  it.each(Object.keys(ARTICLE_TOPICS) as ArticleTopic[])(
    "accepts the configured article topic %s",
    (topic) => {
      const content = parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({
            ...article,
            topic,
            category: "unknown-legacy-category",
          }),
        }),
      );
      expect(content.articles[0].topic).toBe(topic);
      expect(content.articles[0]).not.toHaveProperty("category");
    },
  );

  it.each([undefined, null, "", "clips", "unknown", [], 1])(
    "throws on an absent or invalid required article topic (%j)",
    (topic) => {
      expect(() =>
        parseCampaignContent(
          sources(undefined, {
            "sample.md": markdown({ ...article, topic, category: "clips" }),
            "valid.md": markdown({ ...article, slug: "valid" }),
          }),
        ),
      ).toThrow(/sample\.md: invalid content \(topic/);
    },
  );

  it.each([
    undefined,
    [],
    ["clips"],
    ["design"],
    ["plans"],
    ["analytics"],
    ["slides"],
    ["content"],
    ["clips", "design", "plans", "analytics", "slides", "content"],
  ])(
    "accepts optional article apps without inventing defaults (%j)",
    (apps) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const content = parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, apps }),
        }),
      );
      expect(content.articles).toHaveLength(1);
      if (apps === undefined)
        expect(content.articles[0]).not.toHaveProperty("apps");
      else expect(content.articles[0].apps).toEqual(apps);
      expect(error).not.toHaveBeenCalled();
    },
  );

  it("accepts a standalone article without a use case or screenshot alt", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { use_case: _useCase, screenshot_alt: _alt, ...standalone } = article;
    const content = parseCampaignContent(
      sources(
        {},
        {
          "sample.md": markdown({
            ...standalone,
            topic: "agentic-apps",
            apps: [],
          }),
        },
      ),
    );
    expect(content.articles).toHaveLength(1);
    expect(content.articles[0]).toMatchObject({
      slug: article.slug,
      title: article.title,
      topic: "agentic-apps",
      apps: [],
      body: "\nPublic article body.",
    });
    expect(content.articles[0]).not.toHaveProperty("use_case");
    expect(content.articles[0]).not.toHaveProperty("screenshot_alt");
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "clips",
    {},
    ["unknown"],
    ["plan"],
    ["clips", "unknown"],
    [1],
    [null],
  ])("throws on invalid article apps (%j)", (apps) => {
    expect(() =>
      parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, apps }),
        }),
      ),
    ).toThrow(/sample\.md: invalid content \(apps/);
  });

  it("summarizes only populated configured topics, in configuration order, without mutating input", () => {
    const topics = Object.keys(ARTICLE_TOPICS) as ArticleTopic[];
    const fixtures = [
      { topic: topics[1] },
      { topic: topics[0] },
      { topic: topics[1] },
    ];
    const original = structuredClone(fixtures);
    const summaries: ArticleTopicSummary[] = getArticleTopics(fixtures);
    expect(summaries).toEqual([
      { slug: topics[0], ...ARTICLE_TOPICS[topics[0]], count: 1 },
      { slug: topics[1], ...ARTICLE_TOPICS[topics[1]], count: 2 },
    ]);
    expect(getArticleTopics([])).toEqual([]);
    expect(fixtures).toEqual(original);
    for (const slug of topics) {
      expect(getArticleTopics([{ topic: slug }])).toEqual([
        { slug, ...ARTICLE_TOPICS[slug], count: 1 },
      ]);
      const content = parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, topic: slug }),
        }),
      );
      const paths = buildCampaignPages(content).map((page) => page.path);
      expect(paths).toContain(`/articles/topic/${slug}/`);
      expect(
        paths.filter((path) => path.startsWith("/articles/topic/")),
      ).toEqual([`/articles/topic/${slug}/`]);
    }
  });

  it("does not validate or project removed screenshot fields and preserves original public text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const removed = {
      screenshot_url: { internal: "PRIVATE-SCREENSHOT" },
      screenshot_brief: null,
    };
    const content = parseCampaignContent(
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
    expect(content.articles[0].screenshot_alt).toBe("Sample image");
    expect(JSON.stringify(content)).not.toContain("PRIVATE-SCREENSHOT");
    expect(content.useCases[0].title).toBe(" Sample ");
    expect(content.articles[0].body).toBe("\nPublic article body.");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("validates every use case and eleven articles through bundled and disk loaders without warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bundled = loadCampaignContent();
    const disk = loadCampaignContentFromDisk(
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
    expect(bundled.articles).toHaveLength(11);
    expect(
      bundled.articles.map(({ slug, topic, apps }) => ({ slug, topic, apps })),
    ).toEqual([
      {
        slug: "can-people-and-an-ai-agent-edit-the-same-document",
        topic: "agentic-apps",
        apps: [],
      },
      {
        slug: "how-do-you-add-skills-to-claude-code-and-codex",
        topic: "coding-agents",
        apps: ["plans"],
      },
      {
        slug: "how-to-make-a-pitch-deck-with-ai",
        topic: "presentations",
        apps: ["slides"],
      },
      {
        slug: "how-to-turn-a-design-brief-into-a-prototype-with-ai",
        topic: "prototyping",
        apps: ["design"],
      },
      {
        slug: "how-to-use-ai-to-take-meeting-notes",
        topic: "meetings-and-notes",
        apps: ["clips"],
      },
      {
        slug: "what-is-an-agent-native-app",
        topic: "agentic-apps",
        apps: [],
      },
      {
        slug: "how-do-you-build-a-landing-page-with-ai",
        topic: "prototyping",
        apps: ["design"],
      },
      {
        slug: "how-to-write-a-bug-report",
        topic: "coding-agents",
        apps: ["clips"],
      },
      {
        slug: "what-goes-in-a-technical-design-document",
        topic: "coding-agents",
        apps: ["plans"],
      },
      {
        slug: "what-should-a-saas-metrics-dashboard-include",
        topic: "metrics",
        apps: ["analytics"],
      },
      {
        slug: "what-should-you-look-for-in-dictation-software",
        topic: "meetings-and-notes",
        apps: ["clips"],
      },
    ]);
    for (const item of bundled.articles) {
      expect(item).not.toHaveProperty("category");
      if (item.topic === "agentic-apps") {
        expect(item).not.toHaveProperty("use_case");
        expect(item).not.toHaveProperty("screenshot_alt");
      }
    }
    expect(
      bundled.articles.find(
        (item) =>
          item.slug === "how-do-you-add-skills-to-claude-code-and-codex",
      )?.use_case,
    ).toBe("visual-plan-mode");
    expect(
      getArticleTopics(bundled.articles).map(({ count }) => count),
    ).toEqual([2, 3, 2, 2, 1, 1]);
    for (const item of bundled.articles) {
      if (!item.use_case) continue;
      expect(
        bundled.useCases.map((page) => page.slug),
        item.slug,
      ).toContain(item.use_case);
    }
    expect(bundled).toEqual(disk);
    expect(warn).not.toHaveBeenCalled();
    for (const item of [...bundled.useCases, ...bundled.articles]) {
      expect(item).not.toHaveProperty("screenshot_url");
      expect(item).not.toHaveProperty("screenshot_brief");
    }
    expect(error).not.toHaveBeenCalled();
    const serialized = JSON.stringify(bundled);
    expect(serialized).not.toMatch(/"internal":/);
    for (const item of [...bundled.useCases, ...bundled.articles]) {
      expect(item).not.toHaveProperty("audience");
    }
  });

  it("normalizes YAML dates and rejects impossible dates", () => {
    // A block YAML scalar exercises gray-matter's Date parser rather than JSON strings.
    const dated = `slug: sample\nupdated: 2026-09-01\n${Object.entries(useCase)
      .filter(([key]) => !["slug", "updated"].includes(key))
      .map(([key, value]) => `${key}: ${yaml(value)}`)
      .join("\n")}`;
    expect(
      parseCampaignContent(sources({ "sample.yaml": dated })).useCases[0]
        .updated,
    ).toBe("2026-09-01");
    expect(() =>
      parseCampaignContent(
        sources({ "sample.yaml": yaml({ ...useCase, updated: "2026-02-30" }) }),
      ),
    ).toThrow(/sample\.yaml: invalid content \(updated/);
  });

  it("throws on invalid files, filename mismatches and unsafe URLs without leaking input", () => {
    expect(() =>
      parseCampaignContent(sources({ "wrong.yaml": yaml(useCase) })),
    ).toThrow("wrong.yaml: invalid content (slug must match filename wrong)");
    expect(() =>
      parseCampaignContent(
        sources({ "sample.yaml": "title: PRIVATE-SECRET\n[broken" }),
      ),
    ).toThrow(
      "sample.yaml: invalid content (Unable to parse campaign content)",
    );
    try {
      parseCampaignContent(
        sources({ "sample.yaml": "title: PRIVATE-SECRET\n[broken" }),
      );
    } catch (error) {
      expect((error as Error).message).not.toContain("PRIVATE-SECRET");
    }
    expect(() =>
      parseCampaignContent(
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
    expect(() =>
      parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({
            ...article,
            app_cta_url: "javascript:evil()",
          }),
        }),
      ),
    ).toThrow(/sample\.md: invalid content \(app_cta_url/);
  });

  it("allows an absent matching use case and valid content without screenshot warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = parseCampaignContent(
      sources({}, { "sample.md": markdown(article) }),
    );
    expect(content.articles).toHaveLength(1);
    const complete = parseCampaignContent(sources());
    expect(complete.useCases).toHaveLength(1);
    expect(complete.articles).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("throws on unreadable/missing source directories rather than reporting empty content", () => {
    expect(() =>
      loadCampaignContentFromDisk("/missing-campaign-content"),
    ).toThrow("Unable to enumerate/read");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "campaign-content-"));
    try {
      fs.mkdirSync(path.join(root, "content", "use-cases"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(root, "content", "articles"));
      expect(loadCampaignContentFromDisk(root)).toEqual({
        useCases: [],
        articles: [],
      });
      fs.writeFileSync(
        path.join(root, "content", "use-cases", "sample.yaml"),
        yaml(useCase),
      );
      expect(loadCampaignContentFromDisk(root).useCases).toHaveLength(1);
      const read = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("Unreadable");
      });
      expect(() => loadCampaignContentFromDisk(root)).toThrow(
        "Unable to enumerate/read",
      );
      read.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes only populated topics, index pagination at twelve, supplied dates and safe article mirrors", () => {
    const content = parseCampaignContent(sources());
    content.articles = Array.from({ length: 13 }, (_, index) => ({
      ...content.articles[0],
      slug: `article-${index}`,
    }));
    const pages = buildCampaignPages(content);
    expect(pages.map((page) => page.path)).toEqual(
      expect.arrayContaining([
        "/use-cases/",
        "/use-cases/sample/",
        "/articles/",
        "/articles/page/2/",
        "/articles/topic/coding-agents/",
      ]),
    );
    expect(
      pages.find((page) => page.path === "/use-cases/sample/")?.lastmod,
    ).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(
      pages.find((page) => page.path === "/articles/article-0/")?.markdownPath,
    ).toBe("/articles/article-0.md");
    expect(
      pages.find((page) => page.path === "/articles/page/2/")?.markdown,
    ).toContain("article-12");
    expect(pages.map((page) => page.path)).not.toContain("/articles/page/1/");
    expect(pages.some((page) => page.path.includes("/category/"))).toBe(false);
    expect(pages.some((page) => /\/topic\/[^/]+\/page\//.test(page.path))).toBe(
      false,
    );
    expect(pages.some((page) => page.path.includes("/topic/metrics/"))).toBe(
      false,
    );
    const topic = pages.find(
      (page) => page.path === "/articles/topic/coding-agents/",
    )!;
    expect(topic.markdown?.match(/^- \[/gm)).toHaveLength(13);
    expect(topic.markdown).toContain("article-12");
  });
});

describe("campaign CTA and SEO", () => {
  it("preserves duplicate incoming tracking values, destination state and hash, and sets the job", () => {
    const url = new URL(
      buildCampaignCtaUrl(
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
        buildCampaignCtaUrl("https://example.com/", "job", ""),
      ).searchParams.get("utm_content"),
    ).toBe("job");
    expect(
      new URL(
        buildCampaignCtaUrl("https://example.com/?utm_content=dest", "job", ""),
      ).searchParams.get("utm_content"),
    ).toBe("job");
    expect(
      new URL(
        buildCampaignCtaUrl(
          "https://example.com/",
          "job",
          "?utm_content=&utm_content=second",
        ),
      ).searchParams.getAll("utm_content"),
    ).toEqual(["", "second"]);
    expect(() => buildCampaignCtaUrl("javascript:evil()", "job", "")).toThrow();
  });

  it("uses www canonical origin and the existing title-aware OG endpoint", () => {
    const meta = campaignMeta(
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
      campaignMeta("Title", "Description", "//evil.example"),
    ).toThrow();
  });
});
