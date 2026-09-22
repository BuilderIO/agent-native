import { describe, expect, it } from "vitest";

import { normalizeAgentWebConfig } from "./config.js";
import {
  buildAgentWebStaticFiles,
  buildMarkdownResponseHeaders,
  buildRobotsTxt,
  buildPageJsonLd,
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

  // A site whose canonical URLs carry a trailing slash must advertise that
  // exact form. Stripping it made every sitemap entry point at a redirect.
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

  // The Markdown twin is an asset path derived from the route, so it must not
  // inherit the route's trailing slash.
  it("derives the markdown twin without the route trailing slash", () => {
    expect(markdownFilePathForPage("/about/")).toBe("about.md");
    expect(markdownFilePathForPage("/about")).toBe("about.md");
    expect(markdownFilePathForPage("/")).toBe("index.md");
  });

  // Breadcrumb entries are page URLs, so a bare crumb under a slash-terminated
  // page points structured data at a redirect.
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
