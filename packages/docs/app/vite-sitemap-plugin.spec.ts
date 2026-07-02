import path from "path";
import { fileURLToPath } from "url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  SITE_URL,
  buildAgentWebPages,
  buildSitemapXml,
} from "./vite-sitemap-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const AGENT_WEB_GENERATION_TIMEOUT_MS = 60_000;

describe("docs agent web generation", () => {
  let pages: ReturnType<typeof buildAgentWebPages>;

  beforeAll(() => {
    pages = buildAgentWebPages(rootDir);
  }, AGENT_WEB_GENERATION_TIMEOUT_MS);

  it(
    "includes docs markdown mirrors with getting-started at /docs",
    () => {
      const gettingStarted = pages.find((page) => page.path === "/docs");

      expect(gettingStarted).toMatchObject({
        title: "Getting Started",
        markdownPath: "/docs/getting-started.md",
      });
      expect(gettingStarted?.markdown).toContain("# Getting Started");
    },
    AGENT_WEB_GENERATION_TIMEOUT_MS,
  );

  it(
    "generates public paths for docs and apps",
    () => {
      const paths = pages.map((page) => page.path);

      expect(paths).toContain("/");
      expect(paths).toContain("/docs");
      expect(paths).toContain("/docs/agent-web-surfaces");
      expect(paths).toContain("/terms");
      expect(paths).toContain("/apps/calendar");
    },
    AGENT_WEB_GENERATION_TIMEOUT_MS,
  );

  it("uses the production www canonical origin in sitemap entries", () => {
    const sitemap = buildSitemapXml(["/", "/docs"]);

    expect(SITE_URL).toBe("https://www.agent-native.com");
    expect(sitemap).toContain("<loc>https://www.agent-native.com/</loc>");
    expect(sitemap).toContain("<loc>https://www.agent-native.com/docs</loc>");
  });

  it(
    "derives lastmod from a Date (from git or mtime fallback)",
    () => {
      const gettingStarted = pages.find((page) => page.path === "/docs");

      // lastmod must be a valid Date regardless of whether git log returns a
      // commit timestamp or we fall back to fs mtime
      expect(gettingStarted?.lastmod).toBeInstanceOf(Date);
      expect(Number.isFinite((gettingStarted?.lastmod as Date).getTime())).toBe(
        true,
      );
    },
    AGENT_WEB_GENERATION_TIMEOUT_MS,
  );
});
