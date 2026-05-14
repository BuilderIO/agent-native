import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  SITE_URL,
  buildAgentWebPages,
  buildSitemapPaths,
  buildSitemapXml,
} from "./vite-sitemap-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

describe("docs agent web generation", () => {
  it("includes docs markdown mirrors with getting-started at /docs", () => {
    const pages = buildAgentWebPages(rootDir);
    const gettingStarted = pages.find((page) => page.path === "/docs");

    expect(gettingStarted).toMatchObject({
      title: "Getting Started",
      markdownPath: "/docs/getting-started.md",
    });
    expect(gettingStarted?.markdown).toContain("# Getting Started");
  });

  it("generates public paths for docs and templates", () => {
    const paths = buildSitemapPaths(rootDir);

    expect(paths).toContain("/");
    expect(paths).toContain("/docs");
    expect(paths).toContain("/docs/agent-web-surfaces");
    expect(paths).toContain("/templates/calendar");
  });

  it("uses the production www canonical origin in sitemap entries", () => {
    const sitemap = buildSitemapXml(["/", "/docs"]);

    expect(SITE_URL).toBe("https://www.agent-native.com");
    expect(sitemap).toContain("<loc>https://www.agent-native.com/</loc>");
    expect(sitemap).toContain("<loc>https://www.agent-native.com/docs</loc>");
  });
});
