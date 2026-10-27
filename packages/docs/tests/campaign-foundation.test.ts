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
const useCase = {
  ...common,
  app: "clips",
  subhead: "Sample workflow",
  secondary_cta_label: "Read",
  old_way: {
    heading: "Before",
    body: "Manual work",
    internal: "PRIVATE-NESTED",
  },
  new_way: { heading: "After", steps: ["Start"] },
  faqs: [{ q: "Why?", a: "Time" }],
  updated: "2026-09-01",
  audience: "PRIVATE-AUDIENCE",
  internal: { strategy: "PRIVATE-STRATEGY" },
};
const todaysStack = {
  heading: "Tools today",
  items: [{ text: "**A doc** keeps notes, but they get lost." }],
  in_app: "Keep the notes together.",
};
const recipe = {
  id: "sample-recipe",
  title: "Draft a summary",
  when: "After a meeting",
  steps: ["Open the meeting", "Ask for a summary"],
  prompt: "Summarize the meeting",
  result: "A summary",
  tip: "Keep the summary",
  how_often: "Every meeting",
};
const angle = {
  id: "engineering",
  audience: "Engineers",
  title: "Engineering workflow",
  subhead: "Share the technical details",
  old_way_body: "Manual engineering notes",
};
const optionalFields = {
  recipes: [recipe],
  connects_to: ["Calendar", "CRM"],
  next_jobs: ["next-job"],
  frequency: "weekly",
  how_often_label: "Every week",
  roles: ["engineering", "everyone"],
  angles: [angle],
};
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

  it("accepts missing or valid todays_stack without adding defaults", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const absent = parseCampaignContent(sources()).useCases[0];
    expect(absent).toBeDefined();
    expect(absent).not.toHaveProperty("todays_stack");
    for (const stack of [todaysStack, { ...todaysStack, items: [] }]) {
      const content = parseCampaignContent(
        sources({ "sample.yaml": yaml({ ...useCase, todays_stack: stack }) }),
      );
      expect(content.useCases).toHaveLength(1);
      expect(content.useCases[0].todays_stack).toEqual(stack);
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("strips unknown fields from todays_stack and its items", () => {
    const content = parseCampaignContent(
      sources({
        "sample.yaml": yaml({
          ...useCase,
          todays_stack: {
            ...todaysStack,
            internal: "PRIVATE-STACK",
            items: todaysStack.items.map((item) => ({
              ...item,
              tool: "PRIVATE-OLD-TOOL",
              used_for: "PRIVATE-OLD-USE",
              breaks: "PRIVATE-OLD-BREAKS",
              unknown: "PRIVATE-UNKNOWN",
              internal: { strategy: "PRIVATE-TOOL" },
            })),
          },
        }),
      }),
    );
    expect(content.useCases).toHaveLength(1);
    expect(content.useCases[0].todays_stack).toEqual(todaysStack);
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
  });

  it.each([
    null,
    "Tools",
    {},
    { ...todaysStack, heading: undefined },
    { ...todaysStack, heading: "   " },
    { ...todaysStack, heading: 1 },
    { ...todaysStack, in_app: undefined },
    { ...todaysStack, in_app: "" },
    { ...todaysStack, in_app: false },
    { ...todaysStack, items: undefined },
    { ...todaysStack, items: "A doc" },
    { ...todaysStack, items: [null] },
    ...[undefined, "", " \t ", null, 1, false, {}, []].map((text) => ({
      ...todaysStack,
      items: [{ text }],
    })),
    { ...todaysStack, items: ["A doc"] },
    { ...todaysStack, items: [{ tool: "A doc" }] },
    {
      ...todaysStack,
      items: [
        { tool: "A doc", used_for: "Taking notes", breaks: "Notes get lost" },
      ],
    },
  ])("throws on malformed todays_stack explicitly (%#)", (stack) => {
    expect(() =>
      parseCampaignContent(
        sources({ "sample.yaml": yaml({ ...useCase, todays_stack: stack }) }),
      ),
    ).toThrow(/sample\.yaml: invalid content \(todays_stack/);
  });

  it("accepts absent and populated optional workflow fields without inventing defaults", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const absent = parseCampaignContent(sources()).useCases[0];
    for (const key of Object.keys(optionalFields))
      expect(absent).not.toHaveProperty(key);
    const populated = parseCampaignContent(
      sources({
        "sample.yaml": yaml({ ...useCase, ...optionalFields }),
      }),
    ).useCases[0];
    expect(populated).toMatchObject(optionalFields);
    const { prompt: _prompt, tip: _tip, ...minimalRecipe } = recipe;
    const { old_way_body: _oldWay, ...minimalAngle } = angle;
    const minimal = parseCampaignContent(
      sources({
        "sample.yaml": yaml({
          ...useCase,
          recipes: [minimalRecipe],
          angles: [minimalAngle],
        }),
      }),
    ).useCases[0];
    expect(minimal.recipes).toEqual([minimalRecipe]);
    expect(minimal.angles).toEqual([minimalAngle]);
    const emptyArrays = {
      recipes: [],
      connects_to: [],
      next_jobs: [],
      roles: [],
      angles: [],
    };
    expect(
      parseCampaignContent(
        sources({
          "sample.yaml": yaml({ ...useCase, ...emptyArrays }),
        }),
      ).useCases[0],
    ).toMatchObject(emptyArrays);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4])("accepts recipes with %i nonempty steps", (count) => {
    const steps = Array.from(
      { length: count },
      (_, index) => ` Step ${index + 1} `,
    );
    const content = parseCampaignContent(
      sources({
        "sample.yaml": yaml({ ...useCase, recipes: [{ ...recipe, steps }] }),
      }),
    );
    expect(content.useCases).toHaveLength(1);
    expect(content.useCases[0].recipes).toEqual([{ ...recipe, steps }]);
  });

  it.each(["daily", "weekly", "per-project", "occasional"])(
    "accepts frequency %s",
    (frequency) => {
      expect(
        parseCampaignContent(
          sources({
            "sample.yaml": yaml({ ...useCase, frequency }),
          }),
        ).useCases[0].frequency,
      ).toBe(frequency);
    },
  );

  it("accepts every configured role and strips private nested recipe and angle properties", () => {
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
    const content = parseCampaignContent(
      sources({
        "sample.yaml": yaml({
          ...useCase,
          ...optionalFields,
          roles,
          recipes: [
            {
              ...recipe,
              internal: "PRIVATE-RECIPE",
              audience: "PRIVATE-RECIPE-AUDIENCE",
              do: "PRIVATE-LEGACY-ACTION",
              you_get: "PRIVATE-LEGACY-RESULT",
              save: "PRIVATE-LEGACY-SAVE",
            },
          ],
          angles: [
            {
              ...angle,
              internal: "PRIVATE-ANGLE",
              strategy: "PRIVATE-STRATEGY",
            },
          ],
        }),
      }),
    );
    expect(content.useCases[0]).toMatchObject({ ...optionalFields, roles });
    expect(content.useCases[0].recipes).toEqual([recipe]);
    expect(content.useCases[0].angles).toEqual([angle]);
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
  });

  it.each([
    ...Object.keys(optionalFields).flatMap((field) =>
      [null, 42, {}].map((value) => ({ field, value })),
    ),
    { field: "recipes", value: "recipe" },
    ...["id", "title", "when", "result", "how_often"].flatMap((key) =>
      [undefined, "  ", 3].map((value) => ({
        field: "recipes",
        value: [{ ...recipe, [key]: value }],
      })),
    ),
    ...["prompt", "tip"].flatMap((key) =>
      [" ", null, 3].map((value) => ({
        field: "recipes",
        value: [{ ...recipe, [key]: value }],
      })),
    ),
    ...[
      undefined,
      null,
      "Ask for a summary",
      {},
      [],
      Array.from({ length: 5 }, () => "A step"),
      ...[undefined, "", " \t ", null, 3, false, {}, []].map((step) => [step]),
      ["Valid step", " "],
    ].map((steps) => ({
      field: "recipes",
      value: [{ ...recipe, steps }],
    })),
    {
      field: "recipes",
      value: [
        {
          ...recipe,
          steps: undefined,
          result: undefined,
          do: "Legacy action",
          you_get: "Legacy output",
          save: "Legacy artifact",
        },
      ],
    },
    { field: "recipes", value: [{ ...recipe, id: "Invalid ID" }] },
    { field: "recipes", value: [null] },
    { field: "connects_to", value: [""] },
    { field: "connects_to", value: [1] },
    { field: "next_jobs", value: ["Invalid job"] },
    { field: "next_jobs", value: [1] },
    { field: "frequency", value: "monthly" },
    { field: "frequency", value: "" },
    { field: "how_often_label", value: " " },
    { field: "roles", value: ["admin"] },
    { field: "roles", value: [1] },
    { field: "angles", value: [null] },
    ...["id", "audience", "title", "subhead"].flatMap((key) =>
      [undefined, " ", 3].map((value) => ({
        field: "angles",
        value: [{ ...angle, [key]: value }],
      })),
    ),
    { field: "angles", value: [{ ...angle, id: "Invalid ID" }] },
    ...[" ", null, 3].map((value) => ({
      field: "angles",
      value: [{ ...angle, old_way_body: value }],
    })),
  ])(
    "throws on malformed $field (%#) even alongside valid siblings",
    ({ field, value }) => {
      let message = "";
      try {
        parseCampaignContent(
          sources(
            {
              "sample.yaml": yaml({ ...useCase, [field]: value }),
              "valid.yaml": yaml({ ...useCase, slug: "valid" }),
            },
            {},
          ),
        );
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(`sample.yaml: invalid content (${field}`);
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

  it("accepts null stories as absent and normalizes used_before strings to lists", () => {
    const absent = parseCampaignContent(
      sources({ "sample.yaml": yaml({ ...useCase, story: null }) }),
    ).useCases[0];
    expect(absent).toBeDefined();
    expect(absent.story).toBeUndefined();
    expect(JSON.parse(JSON.stringify(absent))).not.toHaveProperty("story");
    for (const used_before of ["Manual notes", ["Manual notes"]]) {
      const item = parseCampaignContent(
        sources({
          "sample.yaml": yaml({
            ...useCase,
            story: {
              quote: "Useful",
              name: "Writer",
              role: "Founder",
              used_before,
              internal: "PRIVATE-STORY",
            },
          }),
        }),
      ).useCases[0];
      expect(item.story?.used_before).toEqual(["Manual notes"]);
      expect(JSON.stringify(item)).not.toContain("PRIVATE");
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
      expect(item.screenshot_alt).toBe("Sample image");
    }
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
    // Every old-template page was replaced by a new-style page, which its old address redirects to.
    expect(bundled.useCases).toEqual([]);
    expect(bundled.useCasePages.map((page) => page.slug).sort()).toEqual([
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
        bundled.useCasePages.map((page) => page.slug),
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
    expect(bundled.useCases.every((item) => item.story === undefined)).toBe(
      true,
    );
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

  it("throws on invalid files, filename mismatches, unsafe URLs and mismatched jobs without leaking input", () => {
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
          "sample.yaml": yaml({ ...useCase, app_cta_url: "javascript:evil()" }),
        }),
      ),
    ).toThrow(/sample\.yaml: invalid content \(app_cta_url/);
    expect(() =>
      parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, job_id: "wrong" }),
        }),
      ),
    ).toThrow("sample: invalid content (job_id does not match use_case)");
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
        useCasePages: [],
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
