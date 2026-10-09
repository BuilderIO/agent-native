import { describe, expect, it } from "vitest";

import { normalizeAgentWebConfig } from "./config.js";
import {
  buildAgentWebStaticFiles,
  buildMarkdownResponseHeaders,
  buildRobotsTxt,
  buildPageJsonLd,
  buildSitemapIndexXml,
  buildSitemapXml,
  estimateMarkdownTokens,
  markdownFilePathForPage,
} from "./generator.js";

const config = normalizeAgentWebConfig(
  { discoverable: true, crawlerPolicy: "discoverable-no-training" },
  { hasPublicRoutes: true },
);

describe("agent web generators", () => {
  it("builds policy-aware robots.txt with absolute sitemap", () => {
    const robots = buildRobotsTxt({
      siteUrl: "https://www.agent-native.com",
      config,
    });

    expect(robots).toContain("# training: disallow");
    expect(robots).toContain("User-agent: GPTBot");
    expect(robots).toContain("Disallow: /");
    expect(robots).toContain("# userTriggered: allow");
    expect(robots).toContain("User-agent: ChatGPT-User");
    expect(robots).toContain(
      "Sitemap: https://www.agent-native.com/sitemap.xml",
    );
  });

  it("builds an absolute sitemap with lastmod", () => {
    const sitemap = buildSitemapXml(
      [
        {
          path: "/docs",
          title: "Docs",
          lastmod: new Date("2026-05-14T12:00:00Z"),
        },
      ],
      "https://www.agent-native.com",
    );

    expect(sitemap).toContain("<loc>https://www.agent-native.com/docs</loc>");
    expect(sitemap).toContain("<lastmod>2026-05-14</lastmod>");
  });

  it("keeps a single urlset sitemap.xml without sitemapGroup", () => {
    const pages = [
      { path: "/", title: "Home", lastmod: "2026-05-01" },
      { path: "/es-es/docs/", title: "Docs", lastmod: "2026-05-02" },
    ];
    const files = buildAgentWebStaticFiles({
      siteName: "Agent-Native",
      siteUrl: "https://www.agent-native.com",
      config,
      pages,
    });

    expect(files.map((file) => file.path)).toEqual([
      "robots.txt",
      "sitemap.xml",
      "llms.txt",
      "llms-full.txt",
    ]);
    expect(files.find((file) => file.path === "sitemap.xml")?.content).toBe(
      buildSitemapXml(pages, "https://www.agent-native.com"),
    );
  });

  it("splits sitemap.xml into an index and one urlset per sitemapGroup", () => {
    const pages = [
      { path: "/", title: "Home", lastmod: "2026-05-01" },
      { path: "/docs/", title: "Docs", lastmod: "2026-05-03T09:00:00Z" },
      { path: "/es-es/docs/", title: "Docs ES", lastmod: "2026-04-20" },
      { path: "/de-de/docs/", title: "Docs DE" },
    ];
    const files = buildAgentWebStaticFiles({
      siteName: "Agent-Native",
      siteUrl: "https://www.agent-native.com/",
      config,
      pages,
      sitemapGroup: (page) =>
        page.path.split("/")[1]?.match(/^[a-z]{2}-[a-z]{2}$/)?.[0] ?? "EN-US",
    });
    const byPath = new Map(files.map((file) => [file.path, file.content]));

    expect(files.map((file) => file.path)).toEqual([
      "robots.txt",
      "sitemap.xml",
      "sitemaps/en-us.xml",
      "sitemaps/de-de.xml",
      "sitemaps/es-es.xml",
      "llms.txt",
      "llms-full.txt",
    ]);
    expect(byPath.get("sitemap.xml"))
      .toBe(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://www.agent-native.com/sitemaps/en-us.xml</loc>
    <lastmod>2026-05-03</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.agent-native.com/sitemaps/de-de.xml</loc>
  </sitemap>
  <sitemap>
    <loc>https://www.agent-native.com/sitemaps/es-es.xml</loc>
    <lastmod>2026-04-20</lastmod>
  </sitemap>
</sitemapindex>
`);
    expect(byPath.get("sitemaps/en-us.xml")).toBe(
      buildSitemapXml(pages.slice(0, 2), "https://www.agent-native.com/"),
    );
    expect(byPath.get("sitemaps/es-es.xml")).toBe(
      buildSitemapXml([pages[2]!], "https://www.agent-native.com/"),
    );
    expect(byPath.get("sitemaps/de-de.xml")).toBe(
      buildSitemapXml([pages[3]!], "https://www.agent-native.com/"),
    );
  });

  it("uses the newest parseable page lastmod for each sitemap index entry", () => {
    const index = buildAgentWebStaticFiles({
      siteName: "Agent-Native",
      siteUrl: "https://www.agent-native.com",
      config,
      pages: [
        { path: "/a", title: "A", lastmod: new Date("2026-03-10T23:00:00Z") },
        { path: "/b", title: "B", lastmod: "not a date" },
        { path: "/c", title: "C", lastmod: "2026-03-09" },
        { path: "/d", title: "D" },
      ],
      sitemapGroup: () => "all",
    }).find((file) => file.path === "sitemap.xml")?.content;

    expect(index).toContain(
      "<loc>https://www.agent-native.com/sitemaps/all.xml</loc>\n    <lastmod>2026-03-10</lastmod>",
    );
    expect(index?.match(/<lastmod>/g)).toHaveLength(1);
  });

  it("builds a sitemap index with escaped absolute locations", () => {
    expect(
      buildSitemapIndexXml(
        [
          { path: "/sitemaps/a&b.xml", lastmod: "2026-01-02" },
          { path: "/sitemaps/c.xml" },
        ],
        "https://example.com/",
      ),
    ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemaps/a&amp;b.xml</loc>
    <lastmod>2026-01-02</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemaps/c.xml</loc>
  </sitemap>
</sitemapindex>
`);
  });

  it.each(["", "../en-us", "en/us", "en_us", "-en", "en.xml"])(
    "throws when sitemapGroup returns the unsafe key %j",
    (key) => {
      expect(() =>
        buildAgentWebStaticFiles({
          siteName: "Agent-Native",
          siteUrl: "https://www.agent-native.com",
          config,
          pages: [{ path: "/docs/", title: "Docs" }],
          sitemapGroup: () => key,
        }),
      ).toThrow(
        `sitemapGroup returned ${JSON.stringify(key)} for /docs/; sitemap group keys must match`,
      );
    },
  );

  it("builds llms files and Markdown mirrors from one page list", () => {
    const files = buildAgentWebStaticFiles({
      siteName: "Agent-Native",
      siteUrl: "https://www.agent-native.com",
      description: "Agent-Native framework docs.",
      config,
      pages: [
        {
          path: "/docs",
          title: "Getting Started",
          description: "Start building.",
          markdown: "# Getting Started\n\nHello agents.\n",
          markdownPath: "/docs/getting-started.md",
        },
      ],
    });

    const byPath = new Map(files.map((file) => [file.path, file.content]));
    expect(byPath.get("llms.txt")).toContain(
      "https://www.agent-native.com/docs/getting-started.md",
    );
    expect(byPath.get("llms-full.txt")).toContain("Hello agents.");
    expect(byPath.get("docs/getting-started.md")).toBe(
      "# Getting Started\n\nHello agents.\n",
    );
  });

  it("supports custom Markdown paths and response headers", () => {
    expect(markdownFilePathForPage("/docs", "/docs/getting-started.md")).toBe(
      "docs/getting-started.md",
    );

    const headers = buildMarkdownResponseHeaders({
      siteUrl: "https://www.agent-native.com",
      pagePath: "/docs",
      markdown: "# Docs\n\nContent",
    });

    expect(headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(headers.vary).toBe("Accept, Accept-Encoding");
    expect(headers["x-markdown-tokens"]).toBe(
      String(estimateMarkdownTokens("# Docs\n\nContent")),
    );
    expect(headers.link).toContain('rel="llms-txt"');
  });

  it("lists developer resources in both llms files", () => {
    const files = buildAgentWebStaticFiles({
      siteName: "Agent-Native",
      siteUrl: "https://www.agent-native.com",
      config,
      whenToUse: [
        "Use Agent-Native when an agent and UI share actions and state.",
      ],
      pages: [],
      developerResources: [
        {
          title: "OpenAPI specification",
          url: "/openapi.json",
          description: "Typed HTTP operations.",
        },
        {
          title: "CLI",
          url: "https://www.npmjs.com/package/@agent-native/core",
        },
      ],
    });

    const byPath = new Map(files.map((file) => [file.path, file.content]));
    expect(byPath.get("llms.txt")).toContain("## Developer resources");
    expect(byPath.get("llms.txt")).toContain("## When to use this");
    expect(byPath.get("llms.txt")).toContain(
      "https://www.agent-native.com/openapi.json",
    );
    expect(byPath.get("llms-full.txt")).toContain(
      "https://www.npmjs.com/package/@agent-native/core",
    );
  });

  it("preserves a trailing slash in advertised page URLs", () => {
    const sitemap = buildSitemapXml(
      [{ path: "/docs/actions-overview/", title: "Actions" }],
      "https://www.agent-native.com",
    );

    expect(sitemap).toContain(
      "<loc>https://www.agent-native.com/docs/actions-overview/</loc>",
    );
  });

  it("keeps bare page paths bare", () => {
    const sitemap = buildSitemapXml(
      [{ path: "/docs/actions-overview", title: "Actions" }],
      "https://www.agent-native.com",
    );

    expect(sitemap).toContain(
      "<loc>https://www.agent-native.com/docs/actions-overview</loc>",
    );
  });

  it("derives the markdown twin without the route trailing slash", () => {
    expect(markdownFilePathForPage("/about/")).toBe("about.md");
    expect(markdownFilePathForPage("/about")).toBe("about.md");
    expect(markdownFilePathForPage("/")).toBe("index.md");
  });

  it("gives breadcrumb items the page's trailing slash", () => {
    const jsonLd = buildPageJsonLd({
      siteName: "Agent-Native",
      siteUrl: "https://www.agent-native.com",
      page: { path: "/docs/actions-overview/", title: "Actions" },
    });

    const urls = JSON.stringify(jsonLd).match(
      /https:\/\/www\.agent-native\.com\/docs[^"]*/g,
    );

    expect(urls).not.toBeNull();
    expect(urls!.filter((url) => !url.endsWith("/"))).toEqual([]);
  });

  it("leaves breadcrumbs bare for a bare page path", () => {
    const jsonLd = buildPageJsonLd({
      siteName: "Agent-Native",
      siteUrl: "https://www.agent-native.com",
      page: { path: "/docs/actions-overview", title: "Actions" },
    });

    expect(JSON.stringify(jsonLd)).toContain(
      '"https://www.agent-native.com/docs/actions-overview"',
    );
  });
});
