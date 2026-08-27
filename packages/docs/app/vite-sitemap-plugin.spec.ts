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
      const gettingStarted = pages.find((page) => page.path === "/docs/");

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
      expect(paths).toContain("/docs/");
      expect(paths).toContain("/docs/agent-web-surfaces/");
      expect(paths).toContain("/brand/");
      expect(paths).toContain("/about/");
      expect(paths).toContain("/contact/");
      expect(paths).toContain("/terms/");
      expect(paths).toContain("/apps/calendar/");
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
      const gettingStarted = pages.find((page) => page.path === "/docs/");

      // lastmod must be a valid Date regardless of whether git log returns a
      // commit timestamp or we fall back to fs mtime
      expect(gettingStarted?.lastmod).toBeInstanceOf(Date);
      expect(Number.isFinite((gettingStarted?.lastmod as Date).getTime())).toBe(
        true,
      );
    },
    AGENT_WEB_GENERATION_TIMEOUT_MS,
  );

  it("publishes substantial About and Contact Markdown mirrors", () => {
    for (const path of ["/about/", "/contact/"]) {
      const page = pages.find((candidate) => candidate.path === path);
      expect(page?.markdown?.length).toBeGreaterThan(500);
      expect(page?.markdownPath).toBeUndefined();
    }
  });

  it("omits redirected slugs, including stale translations of renamed docs", () => {
    const redirected = pages.filter((page) =>
      /\/docs\/(database|actions|server|client|routing)\/$/.test(page.path),
    );

    expect(redirected).toEqual([]);
  });

  // The twins are handed to agents verbatim, so a bare link in the body sends
  // them through a redirect and, for a translation, drops the locale.
  it("canonicalizes docs links inside the Markdown mirrors", () => {
    const withLinks = pages.filter(
      (page) => page.markdown?.includes("](/") && page.path.includes("/docs/"),
    );

    expect(withLinks.length).toBeGreaterThan(0);

    const bare: string[] = [];
    for (const page of withLinks) {
      // Fenced examples are literal samples and stay exactly as authored, so
      // scanning them would flag the very links the rewrite must not touch.
      const prose = page.markdown!.replace(/```[\s\S]*?(?:```|$)/g, "");
      for (const [, href] of prose.matchAll(/\]\((\/[a-zA-Z][^)\s]*)\)/g)) {
        if (!href.includes("/docs/")) continue;
        const path = href.split("#")[0]!;
        if (path.endsWith(".md")) continue;
        if (!path.endsWith("/") || path !== path.toLowerCase()) {
          bare.push(`${page.path} -> ${href}`);
        }
      }
    }

    expect(bare).toEqual([]);
  });
});
