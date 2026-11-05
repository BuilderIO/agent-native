import fs from "node:fs";
import os from "node:os";
import path from "path";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ARTICLES_BASE,
  ARTICLES_PAGE_SIZE,
  USE_CASES_BASE,
  articleMarkdown,
  type ArticleEntry,
} from "../lib/site-content";
import { loadSiteContentFromDisk } from "../lib/site-content-node";
import { DOCS_LOCALES, sitePathForLocale } from "./components/docs-locale";
import {
  SITE_URL,
  buildAgentWebPages,
  buildSiteContentPages,
  buildPrerenderPaths,
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

  // oracle-change: article topic pages were removed with the articles rebuild; these tests now check the article pages and that no topic or category page is published.
  it("generates untranslated site content pages and markdown mirrors only at English canonical paths", () => {
    const content = loadSiteContentFromDisk(rootDir);
    const article = content.articles[0];
    if (!article) throw new Error("Expected at least one article");
    const siteContentPages = buildSiteContentPages({
      ...content,
      articles: Array.from({ length: ARTICLES_PAGE_SIZE + 1 }, (_, index) => ({
        ...article,
        slug: `test-${index}`,
        translations: {},
      })),
    });
    const paths = siteContentPages.map((page) => page.path);
    for (const path of [
      `${USE_CASES_BASE}/`,
      `${ARTICLES_BASE}/`,
      `${ARTICLES_BASE}/test-0/`,
      `${ARTICLES_BASE}/page/2/`,
    ]) {
      expect(paths).toContain(path);
      for (const locale of DOCS_LOCALES.filter((locale) => locale !== "en-US"))
        expect(paths).not.toContain(sitePathForLocale(path, locale));
    }
    const index = siteContentPages.find(
      (page) => page.path === `${ARTICLES_BASE}/`,
    )!;
    expect(index.markdown).toContain(`](${ARTICLES_BASE}/test-0/)`);
    expect(index.markdown).not.toContain(
      `](${ARTICLES_BASE}/test-${ARTICLES_PAGE_SIZE}/)`,
    );
    const second = siteContentPages.find(
      (page) => page.path === `${ARTICLES_BASE}/page/2/`,
    )!;
    expect(second.markdown).toContain(
      `](${ARTICLES_BASE}/test-${ARTICLES_PAGE_SIZE}/)`,
    );
    const detail = siteContentPages.find(
      (page) => page.path === `${ARTICLES_BASE}/test-0/`,
    )!;
    expect(detail.title).toBe(article.title);
    expect(detail.description).toBe(article.meta_description);
    expect(detail.markdownPath).toBe(`${ARTICLES_BASE}/test-0.md`);
    expect(paths.some((path) => /\/(topic|category)\//.test(path))).toBe(false);
    expect(new Set(paths).size).toBe(paths.length);
    const mirrors = siteContentPages.flatMap((page) =>
      page.markdownPath ? [page.markdownPath] : [],
    );
    expect(new Set(mirrors).size).toBe(mirrors.length);
  });

  it("publishes every real article page with its Markdown mirror, and no topic pages, localized only where translated", () => {
    const content = loadSiteContentFromDisk(rootDir);
    expect(content.articles.length).toBeGreaterThan(0);
    const siteContentPages = buildSiteContentPages(content);
    const index = siteContentPages.find(
      (page) => page.path === `${ARTICLES_BASE}/`,
    )!;
    expect(index.markdown?.match(/^- \[/gm)).toHaveLength(
      Math.min(content.articles.length, ARTICLES_PAGE_SIZE),
    );
    for (const article of content.articles.slice(0, ARTICLES_PAGE_SIZE)) {
      expect(index.markdown).toContain(
        `- [${article.title}](${ARTICLES_BASE}/${article.slug}/)`,
      );
      const detail = siteContentPages.find(
        (page) => page.path === `${ARTICLES_BASE}/${article.slug}/`,
      )!;
      expect(detail).toEqual({
        path: `${ARTICLES_BASE}/${article.slug}/`,
        title: article.title,
        description: article.meta_description,
        lastmod: new Date(`${article.updated}T00:00:00Z`),
        markdown: articleMarkdown(article),
        markdownPath: `${ARTICLES_BASE}/${article.slug}.md`,
      });
    }
    // Only translated use-case pages and articles have localized addresses.
    const localizedArticlePaths = new Set(
      content.articles.flatMap((article) =>
        Object.keys(article.translations).map((locale) =>
          sitePathForLocale(`${ARTICLES_BASE}/${article.slug}/`, locale),
        ),
      ),
    );
    for (const locale of DOCS_LOCALES.filter((locale) => locale !== "en-US"))
      for (const page of siteContentPages.filter(
        (page) =>
          page.path.startsWith(`/${locale.toLowerCase()}/`) &&
          !page.path.includes("/use-cases/"),
      ))
        expect(
          localizedArticlePaths.has(page.path) ||
            (page.path.startsWith(sitePathForLocale(ARTICLES_BASE, locale)) &&
              content.articles.some((article) => article.translations[locale])),
          page.path,
        ).toBe(true);
    expect(
      siteContentPages.some((page) => /\/(topic|category)\//.test(page.path)),
    ).toBe(false);
  });

  it("publishes only the articles index when no articles are present", () => {
    const pages = buildSiteContentPages({
      useCases: [],
      articles: [],
    });
    expect(pages.some((page) => /\/(topic|category)\//.test(page.path))).toBe(
      false,
    );
    expect(
      pages
        .map((page) => page.path)
        .filter((path) => path.startsWith(`${ARTICLES_BASE}/`)),
    ).toEqual([`${ARTICLES_BASE}/`]);
    expect(pages.some((page) => page.path.startsWith("/fr-fr/"))).toBe(false);
  });

  it("lists translated articles, their Markdown mirrors and localized grids only for languages that have them", () => {
    const original = loadSiteContentFromDisk(rootDir).articles[0];
    if (!original) throw new Error("Expected at least one article");
    const { translations: _translations, ...english } = original;
    const german = {
      ...english,
      title: "Testartikel",
      meta_description: "Testbeschreibung.",
      updated: "2026-10-01",
    };
    const articles: ArticleEntry[] = [
      {
        ...original,
        slug: "test-translated",
        translations: { "de-DE": { ...german, slug: "test-translated" } },
      },
      { ...original, slug: "test-english-only", translations: {} },
    ];
    const pages = buildSiteContentPages({ useCases: [], articles });
    const translated = pages.find(
      (page) => page.path === "/de-de/articles/test-translated/",
    );
    expect(translated).toMatchObject({
      title: "Testartikel",
      description: "Testbeschreibung.",
      lastmod: new Date("2026-10-01T00:00:00Z"),
      markdownPath: "/de-de/articles/test-translated.md",
    });
    expect(translated?.markdown).toMatch(/^# Testartikel\n/);
    const grid = pages.find((page) => page.path === "/de-de/articles/");
    expect(grid?.markdown).toContain(
      "- [Testartikel](/de-de/articles/test-translated/)",
    );
    expect(grid?.markdown).toContain(
      `- [${original.title}](/articles/test-english-only/)`,
    );
    const localized = pages
      .map((page) => page.path)
      .filter(
        (path) => !path.startsWith("/articles/") && path !== "/use-cases/",
      );
    expect(localized).toEqual([
      "/de-de/articles/",
      "/de-de/articles/test-translated/",
    ]);
    expect(buildSitemapXml(pages.map((page) => page.path))).toContain(
      `<loc>${SITE_URL}/de-de/articles/test-translated/</loc>`,
    );
  });

  it("dates article sitemap entries by their updated date and the index by the newest one", () => {
    const original = loadSiteContentFromDisk(rootDir).articles[0];
    if (!original) throw new Error("Expected at least one article");
    const articles: ArticleEntry[] = [
      {
        ...original,
        slug: "older-published",
        published: "2025-01-01",
        updated: "2026-09-01",
      },
      {
        ...original,
        slug: "newer-published",
        published: "2026-08-01",
        updated: "2026-08-01",
      },
    ];
    const pages = buildSiteContentPages({
      useCases: [],
      articles,
    });
    const index = pages.find((page) => page.path === `${ARTICLES_BASE}/`)!;
    expect(index.lastmod).toEqual(new Date("2026-09-01T00:00:00Z"));
    for (const article of articles) {
      const detail = pages.find(
        (page) => page.path === `${ARTICLES_BASE}/${article.slug}/`,
      )!;
      expect(detail.lastmod).toEqual(new Date(`${article.updated}T00:00:00Z`));
    }
    const xml = buildSitemapXml([index.path]);
    expect(xml).toContain(`<loc>${SITE_URL}${index.path}</loc>`);
  });

  it(
    "prerenders every published canonical site content sitemap page",
    () => {
      const prerenderPaths = new Set(buildPrerenderPaths());
      const siteContentPages = buildSiteContentPages(
        loadSiteContentFromDisk(rootDir),
      );
      for (const page of siteContentPages)
        expect(prerenderPaths.has(page.path)).toBe(true);
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

    it("lists each article in the English sitemap, and in a language's sitemap only when it's translated", () => {
      const { articles } = loadSiteContentFromDisk(rootDir);
      const paths = [
        `${ARTICLES_BASE}/`,
        ...articles.map((article) => `${ARTICLES_BASE}/${article.slug}/`),
      ];
      // oracle-change: articles now have translations (2026-10-28), so a language's sitemap lists the ones translated into it.
      const englishUrls = locsIn(
        fs.readFileSync(path.join(clientDir, "sitemap-en-us.xml"), "utf8"),
      );
      for (const path of paths) {
        expect(englishUrls).toContain(`${SITE_URL}${path}`);
        expect(pages.find((page) => page.path === path)?.markdown).toBeTruthy();
      }
      for (const locale of DOCS_LOCALES.filter(
        (locale) => locale !== "en-US",
      )) {
        const urls = locsIn(
          fs.readFileSync(
            path.join(clientDir, `sitemap-${locale.toLowerCase()}.xml`),
            "utf8",
          ),
        );
        const translated = articles.filter(
          (article) => article.translations[locale],
        );
        for (const article of articles) {
          const url = `${SITE_URL}${sitePathForLocale(`${ARTICLES_BASE}/${article.slug}/`, locale)}`;
          if (article.translations[locale]) expect(urls).toContain(url);
          else expect(urls).not.toContain(url);
        }
        const index = `${SITE_URL}${sitePathForLocale(`${ARTICLES_BASE}/`, locale)}`;
        if (translated.length) expect(urls).toContain(index);
        else expect(urls).not.toContain(index);
      }
    });

    it("publishes article sitemap entries and English Markdown twins without topic pages or deleted articles", () => {
      const { articles } = loadSiteContentFromDisk(rootDir);
      // A sample of the articles removed in the rebuild, and their topic pages.
      const removed = [
        "what-is-an-agent-native-app",
        "how-to-make-a-pitch-deck-with-ai",
        "how-to-use-ai-to-take-meeting-notes",
        "topic/agentic-apps",
      ];
      const sitemap = fs.readFileSync(
        path.join(clientDir, "sitemap-en-us.xml"),
        "utf8",
      );
      const urls = locsIn(sitemap);
      const base = `${ARTICLES_BASE}/`;
      for (const article of articles) {
        const detailPath = `${base}${article.slug}/`;
        const markdownPath = `${base}${article.slug}.md`;
        const detail = pages.find((page) => page.path === detailPath)!;
        expect(urls).toContain(`${SITE_URL}${detailPath}`);
        expect(detail).toMatchObject({ title: article.title, markdownPath });
        const markdown = fs.readFileSync(
          path.join(clientDir, markdownPath),
          "utf8",
        );
        expect(markdown).toBe(detail.markdown);
        expect(markdown.startsWith(`# ${article.title}\n`)).toBe(true);
        expect(markdown).not.toMatch(
          /^(audience|internal|og_line|author|cta):/m,
        );
      }
      expect(urls.some((url) => url.includes("/topic/"))).toBe(false);
      for (const slug of removed) {
        expect(sitemap).not.toContain(`${base}${slug}`);
        expect(pages.some((page) => page.path.includes(slug))).toBe(false);
        expect(fs.existsSync(path.join(clientDir, `${base}${slug}.md`))).toBe(
          false,
        );
      }
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
