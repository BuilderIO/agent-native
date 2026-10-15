import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCampaignCtaUrl } from "../app/lib/campaign-links";
import { campaignMeta } from "../app/lib/campaign-seo";
import { buildCampaignPages } from "../app/vite-sitemap-plugin";
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
  items: [
    { tool: "A doc", used_for: "Taking notes", breaks: "Notes get lost" },
  ],
  in_app: "Keep the notes together.",
};
const recipe = {
  id: "sample-recipe",
  title: "Draft a summary",
  when: "After a meeting",
  do: "Ask for a summary",
  prompt: "Summarize the meeting",
  you_get: "A summary",
  save: "Keep the summary",
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
  category: "clips",
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
    ...["tool", "used_for", "breaks"].flatMap((field) =>
      [undefined, " \t ", 1].map((value) => ({
        ...todaysStack,
        items: [{ ...todaysStack.items[0], [field]: value }],
      })),
    ),
  ])("skips malformed todays_stack explicitly (%#)", (stack) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = parseCampaignContent(
      sources({ "sample.yaml": yaml({ ...useCase, todays_stack: stack }) }),
    );
    expect(content.useCases).toEqual([]);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/invalid content skipped \(todays_stack/),
    );
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
    const { prompt: _prompt, save: _save, ...minimalRecipe } = recipe;
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
    ...["id", "title", "when", "do", "you_get", "how_often"].flatMap((key) =>
      [undefined, "  ", 3].map((value) => ({
        field: "recipes",
        value: [{ ...recipe, [key]: value }],
      })),
    ),
    ...["prompt", "save"].flatMap((key) =>
      [" ", null, 3].map((value) => ({
        field: "recipes",
        value: [{ ...recipe, [key]: value }],
      })),
    ),
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
    "logs and skips malformed $field (%#) without discarding valid siblings",
    ({ field, value }) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const content = parseCampaignContent(
        sources(
          {
            "sample.yaml": yaml({ ...useCase, [field]: value }),
            "valid.yaml": yaml({ ...useCase, slug: "valid" }),
          },
          {},
        ),
      );
      expect(content.useCases.map((item) => item.slug)).toEqual(["valid"]);
      expect(error).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(
          `sample.yaml: invalid content skipped (${field}`,
        ),
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain("PRIVATE");
    },
  );

  it("allows Content use cases without adding a Content article category", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = parseCampaignContent(
      sources(
        { "sample.yaml": yaml({ ...useCase, app: "content" }) },
        { "sample.md": markdown({ ...article, category: "content" }) },
      ),
    );
    expect(content.useCases[0].app).toBe("content");
    expect(content.articles).toEqual([]);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("invalid content skipped (category"),
    );
    const paths = buildCampaignPages(content).map((page) => page.path);
    expect(paths).toContain("/use-cases/sample/");
    expect(paths).not.toContain("/articles/category/content/");
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

  it("validates all fourteen use cases and eight articles through bundled and disk loaders without warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bundled = loadCampaignContent();
    const disk = loadCampaignContentFromDisk(
      new URL("..", import.meta.url).pathname,
    );
    expect(bundled.useCases).toHaveLength(14);
    expect(bundled.articles).toHaveLength(8);
    expect(
      bundled.useCases.map((item) => [
        item.slug,
        item.todays_stack?.heading,
        item.todays_stack?.items.length,
      ]),
    ).toEqual([
      ["ai-meeting-notes", "Four places one meeting ends up", 4],
      ["bug-reports-with-console-logs", "Four tools for one bug", 4],
      ["crm-and-call-questions", "Four tools for one pipeline review", 4],
      [
        "design-brief-to-prototype",
        "From brief to something clickable, today",
        3,
      ],
      ["dictate-instead-of-typing", "Where your words go today", 3],
      ["find-where-users-drop-off", "Three tools for one drop-off question", 3],
      ["landing-page-prototypes", "How a launch page usually gets made", 3],
      [
        "see-what-your-coding-agent-plans",
        "Where an agent's plan lives today",
        3,
      ],
      ["spec-your-coding-agent-builds-from", "Where a spec lives today", 3],
      ["startup-kpi-dashboard", "Four tools for one set of numbers", 4],
      ["startup-pitch-deck", "What goes into a pitch deck today", 4],
      [
        "understand-what-your-coding-agent-changed",
        "How a change gets reviewed today",
        3,
      ],
      ["weekly-marketing-report", "Four tools for one weekly report", 4],
      ["wireframe-before-agent-builds", "How a screen gets described today", 3],
    ]);
    const slugs = bundled.useCases.map((item) => item.slug);
    for (const item of bundled.useCases) {
      expect(item.recipes, item.slug).toHaveLength(3);
      expect(
        new Set(item.recipes!.map((recipe) => recipe.id)).size,
        item.slug,
      ).toBe(3);
      expect(item.next_jobs?.length, item.slug).toBeGreaterThan(0);
      for (const next of item.next_jobs!) {
        expect(slugs, `${item.slug} → ${next}`).toContain(next);
        expect(next).not.toBe(item.slug);
      }
    }
    expect(
      bundled.useCases.find(
        (item) => item.slug === "spec-your-coding-agent-builds-from",
      )?.app,
    ).toBe("content");
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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // A block YAML scalar exercises gray-matter's Date parser rather than JSON strings.
    const dated = `slug: sample\nupdated: 2026-09-01\n${Object.entries(useCase)
      .filter(([key]) => !["slug", "updated"].includes(key))
      .map(([key, value]) => `${key}: ${yaml(value)}`)
      .join("\n")}`;
    expect(
      parseCampaignContent(sources({ "sample.yaml": dated })).useCases[0]
        .updated,
    ).toBe("2026-09-01");
    expect(
      parseCampaignContent(
        sources({ "sample.yaml": yaml({ ...useCase, updated: "2026-02-30" }) }),
      ).useCases,
    ).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("invalid content skipped"),
    );
  });

  it("skips invalid files, filename mismatches, unsafe URLs and mismatched jobs explicitly", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      parseCampaignContent(sources({ "wrong.yaml": yaml(useCase) })).useCases,
    ).toEqual([]);
    expect(
      parseCampaignContent(sources({ "sample.yaml": "[broken" })).useCases,
    ).toEqual([]);
    expect(
      parseCampaignContent(
        sources({
          "sample.yaml": yaml({ ...useCase, app_cta_url: "javascript:evil()" }),
        }),
      ).useCases,
    ).toEqual([]);
    expect(
      parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, job_id: "wrong" }),
        }),
      ).articles,
    ).toEqual([]);
    expect(error).toHaveBeenCalledTimes(4);
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

  it("includes categories, pagination at twelve, supplied dates and safe article mirrors", () => {
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
        "/articles/category/clips/",
        "/articles/category/clips/page/2/",
        "/articles/category/analytics/",
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
