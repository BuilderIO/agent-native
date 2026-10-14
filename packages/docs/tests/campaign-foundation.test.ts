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
  screenshot_brief: "Capture the workflow",
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  it("accepts null stories as absent and normalizes used_before strings to lists", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  it("rejects relative screenshot URLs and preserves original public text", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      parseCampaignContent(
        sources({
          "sample.yaml": yaml({
            ...useCase,
            screenshot_url: "/images/sample.png",
          }),
        }),
      ).useCases,
    ).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("absolute HTTP(S) URL"),
    );
    const item = parseCampaignContent(
      sources({
        "sample.yaml": yaml({
          ...useCase,
          title: " Sample ",
          screenshot_url: "https://example.com/image.png",
        }),
      }),
    ).useCases[0];
    expect(item.title).toBe(" Sample ");
    expect(item.screenshot_url).toBe("https://example.com/image.png");
    expect(parseCampaignContent(sources()).articles[0].body).toBe(
      "\nPublic article body.",
    );
  });

  it("validates all nine use cases and eight articles through bundled and disk loaders", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bundled = loadCampaignContent();
    const disk = loadCampaignContentFromDisk(
      new URL("..", import.meta.url).pathname,
    );
    expect(bundled.useCases).toHaveLength(9);
    expect(bundled.articles).toHaveLength(8);
    expect(bundled).toEqual(disk);
    expect(error).not.toHaveBeenCalled();
    const serialized = JSON.stringify(bundled);
    expect(serialized).not.toMatch(/"(?:audience|internal)":/);
    expect(bundled.useCases.every((item) => item.story === undefined)).toBe(
      true,
    );
  });

  it("normalizes YAML dates and rejects impossible dates", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  it("allows an absent matching use case and retains missing/TODO screenshots with warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const content = parseCampaignContent(
      sources(
        {},
        { "sample.md": markdown({ ...article, screenshot_url: "TODO" }) },
      ),
    );
    expect(content.articles).toHaveLength(1);
    expect(content.articles[0].screenshot_url).toBe("TODO");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("retaining content"),
    );
    parseCampaignContent(sources());
    expect(warn).toHaveBeenCalledTimes(3);
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
      vi.spyOn(console, "warn").mockImplementation(() => {});
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
        "?utm_source=a&utm_source=b&utm_content=custom&gclid=1&gclid=2&msclkid=m&fbclid=f&ignored=no&job=attacker",
      ),
    );
    expect(url.searchParams.getAll("utm_source")).toEqual(["a", "b"]);
    expect(url.searchParams.getAll("gclid")).toEqual(["1", "2"]);
    expect(url.searchParams.get("utm_content")).toBe("custom");
    expect(url.searchParams.get("msclkid")).toBe("m");
    expect(url.searchParams.get("fbclid")).toBe("f");
    expect(url.searchParams.get("job")).toBe("new-job");
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
