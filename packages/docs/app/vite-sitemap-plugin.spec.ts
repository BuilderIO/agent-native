import fs from "node:fs";
import os from "node:os";
import path from "path";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DOCS_LOCALES } from "./components/docs-locale";
import {
  SITE_URL,
  buildAgentWebPages,
  buildSitemapXml,
  sitemapPlugin,
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
      expect(paths).toContain("/legal/");
      expect(paths).toContain("/terms/");
      expect(paths).toContain("/privacy/");
      expect(paths).toContain("/legal/acceptable-use/");
      expect(paths).toContain("/legal/ai-terms/");
      expect(paths).toContain("/legal/platform-rules/");
      expect(paths).toContain("/legal/takedown/");
      expect(paths).toContain("/legal/law-enforcement/");
      expect(paths).toContain("/es-es/legal/");
      expect(paths).toContain("/es-es/terms/");
      expect(paths).toContain("/es-es/privacy/");
      expect(paths).toContain("/es-es/legal/acceptable-use/");
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

  describe("generated files", () => {
    let outputRoot: string;
    let clientDir: string;

    beforeAll(() => {
      outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-web-"));
      clientDir = path.join(outputRoot, "build", "client");
      fs.mkdirSync(clientDir, { recursive: true });
      runSitemapPluginBuild(outputRoot);
    }, AGENT_WEB_GENERATION_TIMEOUT_MS);

    afterAll(() => {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    });

    it("includes standalone Chat app creation guidance in generated llms.txt", () => {
      const llms = fs.readFileSync(path.join(clientDir, "llms.txt"), "utf8");
      expect(llms).toContain(
        "npx --yes @agent-native/core@latest create <name> --standalone --template chat",
      );
      expect(llms).toContain(
        "read AGENTS.md and the `build-an-app` and `adding-a-feature` skills",
      );
    });

    it("publishes a sitemap index with one sitemap per locale", () => {
      const locales = DOCS_LOCALES.map((locale) => locale.toLowerCase());
      const index = fs.readFileSync(
        path.join(clientDir, "sitemap.xml"),
        "utf8",
      );

      expect(index).toContain(
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      );
      expect(locsIn(index)).toEqual([
        `${SITE_URL}/sitemap-en-us.xml`,
        ...locales
          .filter((locale) => locale !== "en-us")
          .sort()
          .map((locale) => `${SITE_URL}/sitemap-${locale}.xml`),
      ]);
      expect(
        fs
          .readdirSync(clientDir)
          .filter((file) => /^sitemap-.+\.xml$/.test(file))
          .sort(),
      ).toEqual(locales.map((locale) => `sitemap-${locale}.xml`).sort());
    });

    it("lists every page in exactly one per-locale sitemap", () => {
      const locales = DOCS_LOCALES.map((locale) => locale.toLowerCase());
      const urlsByLocale = new Map(
        locales.map((locale) => [
          locale,
          locsIn(
            fs.readFileSync(
              path.join(clientDir, `sitemap-${locale}.xml`),
              "utf8",
            ),
          ),
        ]),
      );

      expect(Array.from(urlsByLocale.values()).flat().sort()).toEqual(
        pages.map((page) => `${SITE_URL}${page.path}`).sort(),
      );
      expect(urlsByLocale.get("en-us")).toEqual(
        expect.arrayContaining([
          `${SITE_URL}/`,
          `${SITE_URL}/docs/`,
          `${SITE_URL}/apps/`,
        ]),
      );
      for (const [locale, urls] of urlsByLocale) {
        expect(urls.length).toBeGreaterThan(0);
        for (const url of urls) {
          const firstSegment = new URL(url).pathname.split("/")[1]!;
          expect(locales.includes(firstSegment) ? firstSegment : "en-us").toBe(
            locale,
          );
        }
      }
    });
  });

  it("localizes legal links in localized Markdown mirrors", () => {
    const privacy = pages.find((page) => page.path === "/es-es/privacy/");
    const terms = pages.find((page) => page.path === "/es-es/terms/");

    expect(privacy?.markdown).toContain(
      "# Agent-Native Privacy Policy\n\nUpdated September 3, 2026\nEffective date: September 3, 2026",
    );
    expect(terms?.markdown).toContain("/es-es/legal/acceptable-use/");
    expect(terms?.markdown).not.toContain("](/legal/acceptable-use)");
  });

  it("keeps public legal Markdown mirrors free of commercial branding", () => {
    const legalPages = pages.filter((page) =>
      /\/(?:legal(?:\/|$)|privacy\/|terms\/)/.test(page.path),
    );

    expect(legalPages.length).toBeGreaterThan(0);
    for (const page of legalPages) {
      expect(page.markdown).not.toMatch(/builder(?:\.io)?/i);
    }
  });

  it("omits redirected slugs, including stale translations of renamed docs", () => {
    const redirected = pages.filter((page) =>
      /\/docs\/(database|actions|server|client|routing)\/$/.test(page.path),
    );

    expect(redirected).toEqual([]);
  });

  it("canonicalizes docs links inside the Markdown mirrors", () => {
    const withLinks = pages.filter(
      (page) => page.markdown?.includes("](/") && page.path.includes("/docs/"),
    );

    expect(withLinks.length).toBeGreaterThan(0);

    const bare: string[] = [];
    for (const page of withLinks) {
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

function runSitemapPluginBuild(outputRoot: string) {
  const plugin = sitemapPlugin();
  const configResolved = plugin.configResolved;
  const resolveConfig =
    typeof configResolved === "function"
      ? configResolved
      : configResolved?.handler;
  resolveConfig?.call({} as never, { root: outputRoot } as never);

  const closeBundleHook = plugin.closeBundle;
  const closeBundle =
    typeof closeBundleHook === "function"
      ? closeBundleHook
      : closeBundleHook?.handler;
  if (!closeBundle) {
    throw new Error("Agent Web plugin has no closeBundle hook");
  }
  closeBundle.call({ info: () => {} } as never);
}

function locsIn(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]!);
}
