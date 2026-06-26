import { describe, expect, it } from "vitest";

import { normalizeAgentWebConfig } from "./config.js";
import {
  buildAgentWebStaticFiles,
  buildMarkdownResponseHeaders,
  buildRobotsTxt,
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
      description: "Agent-native framework docs.",
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
    expect(headers["x-markdown-tokens"]).toBe(
      String(estimateMarkdownTokens("# Docs\n\nContent")),
    );
    expect(headers.link).toContain('rel="llms-txt"');
  });
});
