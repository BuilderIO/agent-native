// oracle-change(packages/docs/app/components/campaign/campaign.test.tsx): renamed here when campaign content became site content; its assertions moved with it.
import { trackEvent } from "@agent-native/core/client/analytics";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import {
  MemoryRouter,
  useLocation,
  type LoaderFunctionArgs,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ARTICLES_BASE,
  ARTICLES_PAGE_SIZE,
  USE_CASES_BASE,
  type ArticleEntry,
  type UseCaseEntry,
} from "../../../lib/site-content";
import { loadSiteContent } from "../../../lib/site-content.server";
import enUS from "../../i18n/en-US";
import jaJP from "../../i18n/ja-JP";
import { articlesListCopy } from "../../lib/articles-copy.server";
import * as localizedSiteContentRoute3 from "../../routes/$locale.articles.$slug";
import * as localizedSiteContentRoute2 from "../../routes/$locale.articles._index";
import * as localizedSiteContentRoute5 from "../../routes/$locale.articles.page.$page";
import * as localizedSiteContentRoute1 from "../../routes/$locale.use-cases.$slug";
import * as localizedSiteContentRoute0 from "../../routes/$locale.use-cases._index";
import {
  loader as articleLoader,
  meta as articleMeta,
} from "../../routes/articles.$slug";
import * as siteContentRoute2 from "../../routes/articles._index";
import { loader as articlesLoader } from "../../routes/articles._index";
import * as siteContentRoute5 from "../../routes/articles.page.$page";
import { loader as pageLoader } from "../../routes/articles.page.$page";
import * as siteContentRoute1 from "../../routes/use-cases.$slug";
import { loader as useCaseLoader } from "../../routes/use-cases.$slug";
import * as siteContentRoute0 from "../../routes/use-cases._index";
import CodeBlock from "../CodeBlock";
import { DOCS_LOCALES, sitePathForLocale } from "../docs-locale";
import { copyText } from "../website-redesign/ds/clipboard";
import { SnackbarProvider } from "../website-redesign/ds/snackbar";
import { ArticlePage, ArticlesList } from "./articles";
import { headingId, parseArticle, sanitizedMarkdown } from "./markdown";
import {
  newestArticles,
  publicArticle,
  safeHref,
  type Article,
} from "./public-content";
import { SiteContentCta, SiteContentView, CopyControl } from "./shared";
import { UseCasesIndex, type UseCaseIndexItem } from "./use-cases";

const articlesCopy = {
  title: enUS.siteContent.articles,
  description: enUS.siteContent.articlesIntro,
};

const currentLocale = vi.hoisted(() => ({ locale: "en-US" }));

afterEach(() => {
  cleanup();
  currentLocale.locale = "en-US";
  vi.mocked(trackEvent).mockClear();
  vi.mocked(copyText).mockReset();
  window.history.replaceState(null, "", "/");
});

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useLocale: () => currentLocale,
  useT:
    () =>
    (key: string, values: Record<string, unknown> = {}) => {
      const lookup = (path: string) =>
        path
          .split(".")
          .reduce<unknown>(
            (value, part) => (value as Record<string, unknown>)[part],
            enUS,
          );
      const value =
        typeof values.count === "number"
          ? lookup(
              `${key}_${new Intl.PluralRules("en-US").select(values.count)}`,
            )
          : lookup(key);
      if (typeof value !== "string")
        throw new Error(`Missing translation ${key}`);
      return value.replace(/{{(\w+)}}/g, (_, name: string) =>
        String(values[name]),
      );
    },
  useFormatters: () => ({
    formatDate: (date: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", options).format(date),
    formatList: (items: string[]) =>
      new Intl.ListFormat("en-US", { type: "conjunction" }).format(items),
  }),
}));
vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../website-redesign/ds/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("../../../lib/site-content.server", () => ({
  loadSiteContent: vi.fn(),
}));

const image = {
  dark: "https://example.com/test-dark.png",
  light: "https://example.com/test-light.png",
  alt: "Test screenshot",
};
const useCase: UseCaseEntry = {
  slug: "test-job",
  app: "clips",
  title: "Test use case",
  seo_title: "Test use case search title",
  meta_description: "Test description.",
  updated: "2026-01-01",
  hero: {
    body: "Test subhead.",
    button: { label: "Test app", url: "https://example.com/app" },
    image,
  },
  how_to: {
    heading: "Test how-to heading",
    steps: ["first", "second", "third"].map((step) => ({
      title: `Test ${step} step`,
      body: `Test ${step} step body.`,
      image,
    })),
  },
  features: {
    heading: "Test features heading",
    items: Array.from({ length: 6 }, (_, index) => ({
      title: `Test feature ${index + 1}`,
      body: `Test feature ${index + 1} body.`,
    })),
  },
  integrations: {
    heading: "Test integrations heading",
    cards: Array.from({ length: 3 }, (_, index) => ({
      title: `Test integration ${index + 1}`,
      logos: [{ name: "Test tool A" }, { name: "Test tool B" }],
      body: `Test integration ${index + 1} body.`,
    })),
  },
  faqs: {
    heading: "Test FAQ heading",
    items: [
      { q: "Test question one?", a: "Test answer one." },
      { q: "Test question two?", a: "Test answer two." },
      { q: "Test question three?", a: "Test answer three." },
    ],
  },
  translations: {},
};
const indexItem: UseCaseIndexItem = {
  slug: useCase.slug,
  app: useCase.app,
  title: useCase.title,
  subhead: useCase.hero.body,
};
const articleImage = {
  dark: "https://example.com/article-dark.png",
  light: "https://example.com/article-light.png",
  alt: "Test finished result",
};
const cta = {
  label: "Test app",
  url: "https://example.com/app",
  heading: "Test callout heading",
  prompt: "Test prompt to paste.",
};
const faqOne = { q: "Test FAQ one?", a: "Test answer one." };
const article: ArticleEntry = {
  slug: "test-article",
  type: "how-to-guide",
  title: "Test article",
  seo_title: "Test article search title",
  og_line: "Test share line",
  meta_description: "Test article description.",
  og_image: "https://example.com/test-og.png",
  published: "2026-01-01",
  updated: "2026-01-01",
  author: {
    name: "Test author",
    url: "https://example.com/test-author",
    same_as: ["https://example.com/test-author"],
  },
  app: "Clips",
  cta,
  use_case: "test-job",
  images: [articleImage],
  faqs: [faqOne, { q: "Test FAQ two?", a: "Test answer two." }],
  body: `Test intro paragraph.\n\n![${articleImage.alt}](${articleImage.dark})\n\n## Test heading\n\nTest **bold** paragraph with [safe](https://example.com) and [unsafe](javascript:alert(1)).\n\n### Test subheading\n\n1. Test step\n2. Test next step\n\n| Test column | Test value |\n| --- | --- |\n| A | B |\n\n\`\`\`text\nTest code\n\`\`\`\n\n## Frequently asked questions\n\n### Test FAQ one?\n\nTest **answer** one.\n\n### Test FAQ two?\n\nTest answer two.`,
  translations: {},
};
const args = (params: Record<string, string>) =>
  ({
    params,
    request: new Request("https://example.com/articles?utm_source=test"),
  }) as LoaderFunctionArgs;
function markup(node: React.ReactNode, entry = "/") {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[entry]}>
      <SnackbarProvider>{node}</SnackbarProvider>
    </MemoryRouter>,
  );
}
function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="location">
      {pathname}
      {search}
    </output>
  );
}
function renderSiteContent(node: React.ReactNode, entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SnackbarProvider>{node}</SnackbarProvider>
      <LocationProbe />
    </MemoryRouter>,
  );
}
// Fails the test, rather than passing undefined along, when an expected value is missing.
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined)
    throw new Error(`Expected ${what}`);
  return value;
}
function dom(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}
function schemas(document: Document): Record<string, unknown>[] {
  return [
    ...document.querySelectorAll('script[type="application/ld+json"]'),
  ].map((node) => JSON.parse(must(node.textContent, "JSON-LD text")));
}
// oracle-change: the original use-case template (old/new way, recipes, angles, stories, next jobs) was removed; its page, loader projection and frequency tag tests went with it, and every use-case page now renders through use-case-page.tsx.
// oracle-change: the articles index intro no longer links to the use cases (the user's copy decision, 2026-10-28), so the intro and navigation tests no longer expect that link.
// oracle-change: articles were rebuilt on one layout for every article type; topic and category pages, related resources, app screenshots and the 12-card list were removed, so their tests went with them and the new layout is tested below.
describe("public site content frontend", () => {
  it.each(DOCS_LOCALES)(
    "SSR renders a single intro paragraph with only articles linked for %s",
    (locale) => {
      currentLocale.locale = locale;
      const document = dom(markup(<UseCasesIndex items={[indexItem]} />));
      const header = document.querySelector("h1")?.parentElement;
      if (!header) throw new Error("No heading");
      expect(header.querySelectorAll("h1 ~ p")).toHaveLength(1);
      const intro = header.querySelector("h1 + p");
      if (!intro) throw new Error("No intro paragraph");
      expect(intro.textContent).toBe(
        "Pick the job you do again and again, or browse the articles for templates and how-tos.",
      );
      expect(intro.textContent).toBe(
        enUS.siteContent.useCasesIntro.replace("{{articles}}", "articles"),
      );
      expect(header.parentElement?.querySelectorAll(":scope > p")).toHaveLength(
        0,
      );
      expect(intro.querySelectorAll("a")).toHaveLength(1);
      const link = intro.querySelector("a");
      if (!link) throw new Error("No articles link");
      expect(link.textContent).toBe("articles");
      expect(link.getAttribute("href")).toBe(
        sitePathForLocale(ARTICLES_BASE, locale),
      );
      expect(link.classList.contains("site-content-inline-link")).toBe(true);
    },
  );

  it.each([
    ["2026-01-01", ["Published January 1, 2026"]],
    ["2026-02-03", ["Published January 1, 2026", "Updated February 3, 2026"]],
  ] as const)(
    "shows the published date, and the updated date only when it differs (%s)",
    (updated, labels) => {
      const document = dom(
        markup(
          <ArticlePage
            article={{ ...article, updated }}
            useCase={null}
            more={[]}
          />,
        ),
      );
      const times = [...document.querySelectorAll("time")];
      expect(times.map((time) => time.textContent)).toEqual(labels);
      expect(times.map((time) => time.getAttribute("dateTime"))).toEqual(
        labels.length === 1
          ? [article.published]
          : [article.published, updated],
      );
      const schema = must(schemas(document)[0], "the Article schema");
      expect(schema.datePublished).toBe(article.published);
      expect(schema.dateModified).toBe(updated);
    },
  );

  it("renders the H1 and a byline linking the author, with role, photo and read time", async () => {
    const item: Article = {
      ...article,
      author: {
        ...article.author,
        role: "Test editor",
        photo: "https://example.com/avatar.png",
      },
      body: `## Test heading\n\n${Array.from({ length: 201 }, () => "word").join(" ")}`,
    };
    window.history.replaceState(null, "", "/articles/test-article/");
    vi.mocked(copyText).mockResolvedValue(true);
    const view = renderSiteContent(
      <ArticlePage article={item} useCase={null} more={[]} />,
    );
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
      item.title,
    );
    expect(view.queryByRole("button", { name: "Copy page" })).toBeNull();
    const author = view.getByRole("link", { name: item.author.name });
    expect(author.getAttribute("href")).toBe(item.author.url);
    expect(author.getAttribute("rel")).toBe("author");
    expect(view.getByText("Test editor")).toBeDefined();
    const photo = must(
      view.container.querySelector(`img[src="${item.author.photo}"]`),
      "the author photo",
    );
    expect(photo.classList.contains("rounded-full")).toBe(true);
    expect(view.getByText("2 min read")).toBeDefined();
    const heading = view.getByRole("heading", { name: "Test heading" });
    expect(heading.id).toBe("test-heading");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy link" }));
    });
    expect(copyText).toHaveBeenCalledExactlyOnceWith(
      `${window.location.origin}/articles/test-article/#test-heading`,
    );
    expect(view.getByText(enUS.siteContent.copied)).toBeDefined();
  });

  it("renders the author's name as text when the author URL is unsafe", () => {
    const document = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            author: { name: "Test author", url: "javascript:alert(1)" },
          }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    expect(document.querySelector('a[rel="author"]')).toBeNull();
    expect(document.body.textContent).toContain("Test author");
  });

  it.each([true, false])(
    "keeps standalone page CopyControl feedback for copy success %s",
    async (success) => {
      vi.mocked(copyText).mockResolvedValue(success);
      const view = renderSiteContent(<CopyControl text="Test page markdown" />);
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Copy page" }));
      });
      expect(copyText).toHaveBeenCalledExactlyOnceWith("Test page markdown");
      expect(
        view.getByText(
          success ? enUS.siteContent.copied : enUS.siteContent.copyFailed,
        ),
      ).toBeDefined();
    },
  );

  it("emits Article with a Person author, FAQPage from faqs and an Articles breadcrumb", () => {
    const full = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            updated: "2026-02-03",
            author: {
              ...article.author,
              role: "Test editor",
              photo: "https://example.com/avatar.png",
            },
          }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    const [articleSchema, faqPage, breadcrumbs, ...rest] = schemas(full);
    expect(rest).toEqual([]);
    const url = "https://www.agent-native.com/articles/test-article/";
    expect(articleSchema).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      inLanguage: "en-US",
      description: article.meta_description,
      image: article.og_image,
      datePublished: "2026-01-01",
      dateModified: "2026-02-03",
      mainEntityOfPage: url,
      author: {
        "@type": "Person",
        name: article.author.name,
        url: article.author.url,
        sameAs: article.author.same_as,
        jobTitle: "Test editor",
        image: "https://example.com/avatar.png",
      },
      publisher: {
        "@type": "Organization",
        name: "Agent-Native",
        url: "https://www.agent-native.com",
        logo: {
          "@type": "ImageObject",
          url: "https://www.agent-native.com/favicon.svg",
        },
      },
    });
    expect(faqPage).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: article.faqs.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
    expect(breadcrumbs).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Articles",
          item: "https://www.agent-native.com/articles/",
        },
        { "@type": "ListItem", position: 2, name: article.title, item: url },
      ],
    });
    // Without a role, photo, same_as or faqs, the schema leaves those out.
    const minimal = schemas(
      dom(
        markup(
          <ArticlePage
            article={{
              ...article,
              author: { name: "Test author", url: article.author.url },
              faqs: [],
            }}
            useCase={null}
            more={[]}
          />,
        ),
      ),
    );
    expect(minimal.map((schema) => schema["@type"])).toEqual([
      "Article",
      "BreadcrumbList",
    ]);
    expect(must(minimal[0], "the Article schema").author).toEqual({
      "@type": "Person",
      name: "Test author",
      url: article.author.url,
    });
  });

  it("sorts article loaders newest first by updated date without mutating input", () => {
    const fixtures = [
      {
        ...article,
        slug: "test-newly-published",
        title: "Test newly published article",
        published: "2026-02-01",
        updated: "2026-02-01",
      },
      {
        ...article,
        slug: "test-recently-updated",
        title: "Test recently updated article",
        published: "2025-01-01",
        updated: "2026-03-01",
      },
      {
        ...article,
        slug: "test-old",
        title: "Test old article",
        published: "2025-06-01",
        updated: "2025-06-01",
      },
    ];
    const sourceOrder = fixtures.map((item) => item.slug);
    const expected = [
      "test-recently-updated",
      "test-newly-published",
      "test-old",
    ];
    expect(newestArticles(fixtures).map((item) => item.slug)).toEqual(expected);
    expect(fixtures.map((item) => item.slug)).toEqual(sourceOrder);
    vi.mocked(loadSiteContent).mockReturnValue({
      useCases: [useCase],
      articles: fixtures,
    });
    const list = articlesLoader();
    expect(list.articles.map((item) => item.slug)).toEqual(expected);
    const document = dom(markup(<ArticlesList {...list} />));
    expect(
      [...document.querySelectorAll(".grid h2")].map(
        (node) => node.textContent,
      ),
    ).toEqual(
      expected.map(
        (slug) =>
          must(
            fixtures.find((item) => item.slug === slug),
            slug,
          ).title,
      ),
    );
    expect(
      articleLoader(args({ slug: "test-old" })).more.map((item) => item.slug),
    ).toEqual(expected.slice(0, 2));
  });

  it("paginates the index at nine cards and rejects invalid pages", () => {
    expect(ARTICLES_PAGE_SIZE).toBe(9);
    const articles = Array.from({ length: 20 }, (_, index) => ({
      ...article,
      slug: `test-${index}`,
      updated: `2026-01-${String(index + 1).padStart(2, "0")}`,
    }));
    vi.mocked(loadSiteContent).mockReturnValue({
      useCases: [useCase],
      articles,
    });
    const newest = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => `test-${from - i}`);
    const first = articlesLoader();
    expect(first.articles.map((item) => item.slug)).toEqual(newest(19, 9));
    expect(first.hasMore).toBe(true);
    const second = pageLoader(args({ page: "2" }));
    expect(second.articles.map((item) => item.slug)).toEqual(newest(10, 9));
    expect(second.hasMore).toBe(true);
    const third = pageLoader(args({ page: "3" }));
    expect(third.articles.map((item) => item.slug)).toEqual([
      "test-1",
      "test-0",
    ]);
    expect(third.hasMore).toBe(false);
    for (const page of ["0", "-1", "2.5", "2abc", "4", "99999999999999999"]) {
      try {
        pageLoader(args({ page }));
        throw new Error("Expected page rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(Response);
        expect((error as Response).status).toBe(404);
      }
    }
    expect(() => articleLoader(args({ slug: "absent" }))).toThrow();
    const document = dom(markup(<ArticlesList {...first} />));
    expect(document.querySelectorAll(".grid > a")).toHaveLength(9);
    expect(
      document
        .querySelector(
          `a[href="${sitePathForLocale(`${ARTICLES_BASE}/page/2`)}"]`,
        )
        ?.textContent.trim(),
    ).toBe(enUS.siteContent.showMore);
    expect(
      dom(markup(<ArticlesList {...third} />)).body.textContent,
    ).not.toContain(enUS.siteContent.showMore);
  });

  it("permanently redirects page 1 to the locale-aware articles index", () => {
    for (const [params, location] of [
      [{ page: "1" }, "/articles/"],
      [{ page: "1", locale: "fr-fr" }, "/fr-fr/articles/"],
    ] as const) {
      try {
        pageLoader(args(params));
        throw new Error("Expected redirect");
      } catch (error) {
        expect(error).toBeInstanceOf(Response);
        expect((error as Response).status).toBe(301);
        expect((error as Response).headers.get("Location")).toBe(location);
      }
    }
  });

  it("recommends the three newest other articles under More articles", () => {
    const fixtures: ArticleEntry[] = [
      article,
      { ...article, slug: "older", updated: "2025-01-01" },
      { ...article, slug: "newest", updated: "2026-09-01" },
      { ...article, slug: "middle", updated: "2026-08-01" },
      { ...article, slug: "next", updated: "2026-07-01" },
    ];
    vi.mocked(loadSiteContent).mockReturnValue({
      useCases: [],
      articles: fixtures,
    });
    const data = articleLoader(args({ slug: article.slug }));
    expect(data.more.map((item) => item.slug)).toEqual([
      "newest",
      "middle",
      "next",
    ]);
    expect(fixtures.map((item) => item.slug)).toEqual([
      article.slug,
      "older",
      "newest",
      "middle",
      "next",
    ]);
    const document = dom(markup(<ArticlePage {...data} />));
    const section = must(
      [...document.querySelectorAll("section")].find(
        (node) => node.querySelector("h2")?.textContent === "More articles",
      ),
      "the More articles section",
    );
    expect(
      [...section.querySelectorAll(".grid > a")].map((card) =>
        card.getAttribute("href"),
      ),
    ).toEqual(
      data.more.map((item) =>
        sitePathForLocale(`${ARTICLES_BASE}/${item.slug}`),
      ),
    );
    const alone = dom(
      markup(<ArticlePage article={article} useCase={null} more={[]} />),
    );
    expect(
      [...alone.querySelectorAll("h2")].map((node) => node.textContent),
    ).not.toContain("More articles");
  });

  it("renders only real cards in an incomplete use-case grid", () => {
    const document = dom(markup(<UseCasesIndex items={[indexItem]} />));
    const grid = must(document.querySelector(".grid.gap-px"), "the card grid");
    expect(grid.children).toHaveLength(1);
    const card = must(grid.querySelector("a"), "a use-case card");
    expect(card.getAttribute("href")).toMatch(/^\/use-cases\//);
    expect(card.querySelector("h3")?.textContent).toBeTruthy();
    expect(grid.querySelectorAll("a")).toHaveLength(1);
  });

  it("renders each index card as one link with the share image, title, author and a short date", () => {
    const list = dom(
      markup(<ArticlesList articles={[article]} page={1} hasMore={false} />),
    );
    const cards = list.querySelectorAll(".grid > a");
    expect(cards).toHaveLength(1);
    const card = must(cards[0], "an article card");
    expect(card.getAttribute("href")).toBe(
      sitePathForLocale(`${ARTICLES_BASE}/${article.slug}`),
    );
    expect(card.querySelectorAll("a")).toHaveLength(0);
    expect(card.querySelector("img")?.getAttribute("src")).toBe(
      article.og_image,
    );
    expect(card.querySelector("h2")?.textContent).toBe(article.title);
    expect(card.textContent).toContain(article.meta_description);
    expect(card.textContent).toContain(article.author.name);
    expect(card.querySelector("time")?.textContent).toBe("Updated Jan 1, 2026");
    expect(card.querySelector("time")?.getAttribute("dateTime")).toBe(
      article.updated,
    );
    const [breadcrumbs, itemList, ...rest] = schemas(list);
    expect(rest).toEqual([]);
    expect(breadcrumbs).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, item: "https://www.agent-native.com/articles/" },
      ],
    });
    expect(itemList).toEqual({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          url: "https://www.agent-native.com/articles/test-article/",
          name: article.title,
        },
      ],
    });
  });

  it("uses router tracking parameters and emits only allowed tracking fields", () => {
    window.history.replaceState(
      null,
      "",
      "/?utm_source=test&utm_content=existing&audience=PRIVATE&internal=PRIVATE",
    );
    const entry =
      "/?utm_source=test&utm_content=existing&audience=PRIVATE&internal=PRIVATE";
    const articleView = renderSiteContent(
      <>
        <SiteContentView item={article} />
        <SiteContentCta item={article} location="inline" />
      </>,
      entry,
    );
    const articleLink = articleView.getByRole("link", { name: "Test app" });
    const url = new URL(articleLink.getAttribute("href") ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://example.com/app");
    expect(url.searchParams.get("job")).toBe("article-test-article");
    expect(url.searchParams.get("utm_source")).toBe("test");
    expect(url.searchParams.get("utm_content")).toBe("existing");
    expect(url.searchParams.has("audience")).toBe(false);
    articleLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(articleLink);
    expect(trackEvent).toHaveBeenCalledWith("article_view", {
      slug: "test-article",
      type: "how-to-guide",
      app: "Clips",
      use_case: "test-job",
    });
    expect(trackEvent).toHaveBeenCalledWith("article_cta_click", {
      slug: "test-article",
      app: "Clips",
      use_case: "test-job",
      location: "inline",
    });
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain(
      "PRIVATE",
    );
  });

  it("keeps private input outside route data and returns impersonal canonical article metadata", () => {
    const privateCase = {
      ...useCase,
      app: "clips" as const,
      audience: "PRIVATE",
      internal: "PRIVATE",
    };
    const privateArticle = {
      ...article,
      audience: "PRIVATE",
      internal: "PRIVATE",
    };
    const other = {
      ...privateArticle,
      slug: "test-other",
      updated: "2026-01-02",
    };
    vi.mocked(loadSiteContent).mockReturnValue({
      useCases: [privateCase],
      articles: [privateArticle, other],
    });
    const data = articleLoader(args({ slug: article.slug }));
    expect(data.more.map((item) => item.slug)).toEqual(["test-other"]);
    expect(data.useCase).toEqual({ slug: useCase.slug, title: useCase.title });
    expect(JSON.stringify(data)).not.toContain("PRIVATE");
    expect(JSON.stringify(articlesLoader())).not.toContain("PRIVATE");
    const metadata = articleMeta({ loaderData: data });
    expect(metadata).toContainEqual({
      title: `${article.seo_title} | Agent-Native`,
    });
    expect(metadata).toContainEqual({
      name: "description",
      content: article.meta_description,
    });
    expect(metadata).toContainEqual({
      property: "og:image",
      content: article.og_image,
    });
    expect(metadata).toContainEqual({
      tagName: "link",
      rel: "alternate",
      type: "text/markdown",
      href: "/articles/test-article.md",
    });
    expect(metadata).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://www.agent-native.com/articles/test-article/",
    });
    expect(metadata).toContainEqual({
      property: "og:type",
      content: "article",
    });
  });

  it("projects only the declared public article fields including nested values", () => {
    const contaminated = {
      ...article,
      audience: "PRIVATE",
      author: { ...article.author, internal: "PRIVATE" },
      cta: { ...cta, internal: "PRIVATE" },
      images: [{ ...articleImage, internal: "PRIVATE" }],
      faqs: [{ ...faqOne, internal: "PRIVATE" }],
    };
    const projected = publicArticle(contaminated);
    expect(JSON.stringify(projected)).not.toContain("PRIVATE");
    expect(projected.author).toEqual({ ...article.author });
    expect(projected.cta).toEqual(article.cta);
    expect(projected.images).toEqual([articleImage]);
    expect(projected.faqs).toEqual([faqOne]);
    expect(publicArticle({ ...article, cta: undefined }).cta).toBeUndefined();
  });

  it("renders semantic markdown and the last section as an FAQ without executable HTML", () => {
    const document = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            body: article.body.replace(
              "## Test heading",
              '<script>alert("bad")</script>\n\n## Test heading',
            ),
          }}
          useCase={useCase}
          more={[]}
        />,
      ),
    );
    expect(document.querySelector("h2#test-heading")?.textContent).toBe(
      "Test heading",
    );
    expect(document.querySelector("h3#test-subheading")?.textContent).toBe(
      "Test subheading",
    );
    expect(document.querySelectorAll("table th")).toHaveLength(2);
    expect(document.querySelectorAll("table td")).toHaveLength(2);
    expect(document.querySelector("pre")?.textContent).toContain("Test code");
    expect(document.querySelector("strong")?.textContent).toBe("bold");
    expect(
      document.querySelector('a[href="https://example.com"]')?.textContent,
    ).toBe("safe");
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(document.body.textContent).toContain("unsafe");
    expect(document.querySelectorAll("script:not([type])")).toHaveLength(0);
    expect(document.querySelector("button button")).toBeNull();
    const faq = must(
      document.querySelector(".site-content-article-faq section"),
      "the FAQ section",
    );
    const faqHeading = must(faq.querySelector("h2"), "the FAQ heading");
    expect(faqHeading.id).toBe("frequently-asked-questions");
    expect(
      faqHeading.parentElement?.querySelector('button[aria-label="Copy link"]'),
    ).not.toBeNull();
    expect(
      [...faq.querySelectorAll("h3")].map((node) => [
        node.id,
        node.textContent,
      ]),
    ).toEqual([
      ["test-faq-one", "Test FAQ one?"],
      ["test-faq-two", "Test FAQ two?"],
    ]);
    expect(faq.textContent).toContain("Test answer one.");
    expect(faq.textContent).toContain("Test answer two.");
    expect(faq.querySelector("strong")?.textContent).toBe("answer");
    // The questions are not rendered a second time as plain headings.
    expect(document.querySelectorAll("#test-faq-one")).toHaveLength(1);
    expect(
      document.querySelector(".docs-content > h2#frequently-asked-questions"),
    ).toBeNull();
  });

  it("renders a questions section that is not the last section as ordinary headings", () => {
    const document = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            body: `${article.body}\n\n## Test ending\n\nTest final paragraph.`,
          }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    expect(document.querySelector(".site-content-article-faq")).toBeNull();
    expect(
      document.querySelector("h2#frequently-asked-questions"),
    ).not.toBeNull();
    expect(document.querySelector("h3#test-faq-one")?.textContent).toBe(
      "Test FAQ one?",
    );
    expect(document.body.textContent).toContain("Test final paragraph.");
    expect(
      parseArticle(`${article.body}\n\n## Test ending\n\nTest final.`).faqs,
    ).toEqual([]);
  });

  it("scopes tables before and within the article FAQ without changing semantic headers", () => {
    const table =
      "| Test header | Test value |\n| --- | --- |\n| Test cell | Test body |";
    const document = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            body: `${table}\n\n## Frequently asked questions\n\n### Test question?\n\n${table}`,
          }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    expect(document.querySelectorAll("table")).toHaveLength(2);
    for (const cell of document.querySelectorAll("th, td")) {
      expect(
        cell.closest(".site-content-article-content .docs-content"),
      ).not.toBeNull();
    }
    expect(document.querySelectorAll("thead th")).toHaveLength(4);
    expect(document.querySelectorAll("tbody td")).toHaveLength(4);
  });

  it("shows a listed screenshot in both themes and opens it in a dialog when clicked", async () => {
    const unlisted = "https://example.com/unlisted.png";
    const view = renderSiteContent(
      <ArticlePage
        article={{
          ...article,
          body: `${article.body}\n\n![Test unlisted](${unlisted})`,
        }}
        useCase={null}
        more={[]}
      />,
    );
    const figures = view.container.querySelectorAll("figure");
    expect(figures).toHaveLength(1);
    const trigger = must(
      must(figures[0], "a figure").querySelector("button"),
      "the enlarge button",
    );
    const themed = (root: ParentNode) => ({
      dark: root.querySelector(".theme-img-dark")?.getAttribute("src"),
      light: root.querySelector(".theme-img-light")?.getAttribute("src"),
    });
    expect(themed(trigger)).toEqual({
      dark: articleImage.dark,
      light: articleImage.light,
    });
    expect(trigger.querySelector(".theme-img-dark")?.getAttribute("alt")).toBe(
      articleImage.alt,
    );
    expect(
      trigger.querySelector(".theme-img-light")?.getAttribute("aria-hidden"),
    ).toBe("true");
    // An image missing from `images` has no second theme, so it stays a plain image.
    const plain = must(
      view.container.querySelector(`img[src="${unlisted}"]`),
      "the unlisted image",
    );
    expect(plain.getAttribute("alt")).toBe("Test unlisted");
    expect(plain.closest("button, figure")).toBeNull();
    expect(view.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      view.getByRole("button", {
        name: new RegExp(enUS.siteContent.enlargeImage),
      }),
    );
    const dialog = await view.findByRole("dialog", { name: articleImage.alt });
    expect(themed(dialog)).toEqual({
      dark: articleImage.dark,
      light: articleImage.light,
    });
    fireEvent.click(
      view.getByRole("button", {
        name: new RegExp(enUS.siteContent.closeImage),
      }),
    );
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

    fireEvent.click(
      view.getByRole("button", {
        name: new RegExp(enUS.siteContent.enlargeImage),
      }),
    );
    await view.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  });

  it("places the callout after the intro and its image, and repeats it in the closing band", async () => {
    vi.mocked(copyText).mockResolvedValue(true);
    const view = renderSiteContent(
      <ArticlePage article={article} useCase={null} more={[]} />,
    );
    const inline = must(
      view.container.querySelector(".site-content-callout-inline"),
      "the inline callout",
    );
    expect(inline.previousElementSibling?.tagName).toBe("FIGURE");
    expect(
      inline.previousElementSibling?.previousElementSibling?.textContent,
    ).toBe("Test intro paragraph.");
    expect(inline.nextElementSibling?.id).toBe("test-heading");
    const band = must(
      [...view.container.querySelectorAll("section")].at(-1),
      "the closing band",
    );
    const closing = must(
      band.querySelector(".site-content-callout-band"),
      "the band callout",
    );
    expect(closing.querySelector("h2")?.textContent).toBe(cta.heading);
    expect(
      inline.querySelector(".site-content-callout-heading")?.textContent,
    ).toBe(cta.heading);
    for (const callout of [inline, closing]) {
      const link = must(callout.querySelector("a"), "the callout button");
      expect(link.textContent).toBe(cta.label);
      expect(new URL(must(link.getAttribute("href"), "an href")).origin).toBe(
        "https://example.com",
      );
      expect(callout.textContent).toContain(
        "Paste the prompt into the Clips prompt box.",
      );
    }
    const copies = view.getAllByRole("button", {
      name: enUS.siteContent.copyPrompt,
    });
    expect(copies).toHaveLength(2);
    const copy = must(copies[0], "a Copy prompt button");
    expect(inline.contains(copy)).toBe(true);
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(copyText).toHaveBeenCalledExactlyOnceWith(cta.prompt);
    expect(view.getByText(enUS.siteContent.copied)).toBeDefined();
    expect(trackEvent).toHaveBeenCalledWith("article_prompt_copy", {
      slug: article.slug,
      app: article.app,
      location: "inline",
    });
  });

  it("does not track a prompt copy that failed", async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    const view = renderSiteContent(
      <ArticlePage article={article} useCase={null} more={[]} />,
    );
    await act(async () => {
      fireEvent.click(
        must(
          view.getAllByRole("button", { name: enUS.siteContent.copyPrompt })[0],
          "a Copy prompt button",
        ),
      );
    });
    expect(view.getByText(enUS.siteContent.copyFailed)).toBeDefined();
    expect(trackEvent).not.toHaveBeenCalledWith(
      "article_prompt_copy",
      expect.objectContaining({ slug: article.slug }),
    );
  });

  const { heading: _heading, ...ctaWithoutHeading } = cta;
  const { cta: _cta, ...articleWithoutCta } = article;
  it.each([
    ["no heading", { ...article, cta: ctaWithoutHeading }],
    ["no cta", articleWithoutCta],
  ] as const)(
    "renders no callout, band or Copy prompt button with %s",
    (_label, item) => {
      const document = dom(
        markup(<ArticlePage article={item} useCase={null} more={[]} />),
      );
      expect(document.querySelector(".site-content-callout")).toBeNull();
      expect(document.body.textContent).not.toContain(
        enUS.siteContent.copyPrompt,
      );
      expect(
        document.querySelector('a[href^="https://example.com/app"]'),
      ).toBeNull();
    },
  );

  it("shows the callout without a Copy prompt button or hint when there is no prompt", () => {
    const { prompt: _prompt, ...ctaWithoutPrompt } = cta;
    const document = dom(
      markup(
        <ArticlePage
          article={{ ...article, cta: ctaWithoutPrompt }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    expect(document.querySelectorAll(".site-content-callout")).toHaveLength(2);
    expect(document.body.textContent).not.toContain(
      enUS.siteContent.copyPrompt,
    );
    expect(document.querySelector(".site-content-callout-hint")).toBeNull();
  });

  it("badges numbered ### steps and lists the steps of the first section with three or more", () => {
    const body = [
      "Test intro.",
      "## Test two steps",
      "### 1. Test lone first",
      "### 2. Test lone second",
      "## Test steps",
      "Test lead-in.",
      "### 1. Pull the numbers",
      "Test one.",
      "### 2. Check **each** one",
      "Test two.",
      "### 10. Build the slides",
      "Test three.",
      "### Not a step",
      "## Test more steps",
      "### 1. Test later first",
      "### 2. Test later second",
      "### 3. Test later third",
      "## Test questions",
      "### Test question?",
      "Test answer.",
    ].join("\n\n");
    const view = renderSiteContent(
      <ArticlePage
        article={{ ...article, body, faqs: [] }}
        useCase={null}
        more={[]}
      />,
    );
    const lists = view.container.querySelectorAll("ol.article-step-list");
    expect(lists).toHaveLength(1);
    const list = must(lists[0], "the step list");
    expect(list.previousElementSibling?.id).toBe("test-steps");
    expect(
      [...list.querySelectorAll("li > a")].map((link) => [
        link.getAttribute("href"),
        link.textContent,
      ]),
    ).toEqual([
      ["#1-pull-the-numbers", "Pull the numbers"],
      ["#2-check-each-one", "Check each one"],
      ["#10-build-the-slides", "Build the slides"],
    ]);
    for (const href of list.querySelectorAll("a")) {
      const target = document.getElementById(
        must(href.getAttribute("href"), "a step link href").slice(1),
      );
      expect(target?.tagName).toBe("H3");
    }
    const step = must(
      document.getElementById("2-check-each-one"),
      "the second step",
    );
    expect(step.querySelector(".article-step-number")?.textContent).toBe("02");
    expect(step.querySelector(".sr-only")?.textContent).toBe("2. ");
    // Later sections still badge their steps; only the first one gets a list.
    expect(
      document
        .getElementById("1-test-later-first")
        ?.querySelector(".article-step-number")?.textContent,
    ).toBe("01");
    expect(
      step.querySelector(".article-step-number")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(step.querySelector("strong")?.textContent).toBe("each");
    expect(
      document
        .getElementById("10-build-the-slides")
        ?.querySelector(".article-step-number")?.textContent,
    ).toBe("10");
    expect(
      view
        .getByRole("heading", { level: 3, name: "Not a step" })
        .querySelector(".article-step-number"),
    ).toBeNull();
  });

  it("links the article's use case when present", () => {
    currentLocale.locale = "fr-FR";
    const document = dom(
      markup(<ArticlePage article={article} useCase={useCase} more={[]} />),
    );
    const partOf = must(
      must(
        [...document.querySelectorAll("p")].find((paragraph) =>
          paragraph.textContent.startsWith("Part of:"),
        ),
        "the Part of line",
      ).querySelector("a"),
      "the use-case link",
    );
    expect(partOf.textContent).toBe(useCase.title);
    expect(partOf.getAttribute("href")).toBe(
      sitePathForLocale(`${USE_CASES_BASE}/${useCase.slug}`, "fr-FR"),
    );
    const without = dom(
      markup(<ArticlePage article={article} useCase={null} more={[]} />),
    );
    expect(without.body.textContent).not.toContain("Part of:");
    expect(without.querySelector('a[href*="/use-cases/"]')).toBeNull();
  });

  it.each(DOCS_LOCALES)(
    "renders one articles intro, with no links, for %s",
    (locale) => {
      currentLocale.locale = locale;
      const document = dom(
        markup(<ArticlesList articles={[article]} page={1} hasMore={false} />),
      );
      const header = must(
        must(document.querySelector("h1"), "the H1").parentElement,
        "the index header",
      );
      expect(header.querySelectorAll("h1 ~ p")).toHaveLength(1);
      const intro = must(header.querySelector("h1 + p"), "the index intro");
      expect(intro.textContent).toBe(enUS.siteContent.articlesIntro);
      expect(intro.querySelectorAll("a")).toHaveLength(0);
      expect(header.textContent).toBe(
        `${enUS.siteContent.articles}${intro.textContent}`,
      );
      expect(header.parentElement?.querySelectorAll(":scope > p")).toHaveLength(
        0,
      );
      expect(document.querySelector('a[href*="/topic/"]')).toBeNull();
    },
  );

  it.each(DOCS_LOCALES)(
    "preserves %s in every site content navigation surface without translating editorial content",
    (locale) => {
      currentLocale.locale = locale;
      const related = { ...article, slug: "test-related" };
      const nodes = [
        <UseCasesIndex items={[indexItem]} />,
        <ArticlesList
          articles={[article]}
          translatedSlugs={[article.slug]}
          page={1}
          hasMore
        />,
        <ArticlePage
          article={{
            ...article,
            body: `${article.body.replace("## Frequently", `[Internal article](${ARTICLES_BASE}/test-linked?source=test#details)\n\n## Frequently`)}`,
          }}
          useCase={useCase}
          more={[related]}
          translatedSlugs={[related.slug]}
        />,
        // Cards for articles without a page in this language link to English.
        <ArticlesList articles={[article]} page={1} hasMore={false} />,
      ];
      const documents = nodes.map((node) => dom(markup(node)));
      const path = (value: string) => sitePathForLocale(value, locale);
      for (const [index, hrefs] of [
        [0, [path(`${USE_CASES_BASE}/${useCase.slug}`)]],
        [
          1,
          [
            path(`${ARTICLES_BASE}/${article.slug}`),
            path(`${ARTICLES_BASE}/page/2`),
          ],
        ],
        [
          2,
          [
            path(ARTICLES_BASE),
            path(`${USE_CASES_BASE}/${useCase.slug}`),
            path(`${ARTICLES_BASE}/${related.slug}`),
            `${path(`${ARTICLES_BASE}/test-linked`)}?source=test#details`,
          ],
        ],
        [3, [`${ARTICLES_BASE}/${article.slug}/`]],
      ] as const) {
        for (const href of hrefs)
          expect(
            documents[index]?.querySelector(`a[href="${href}"]`),
            `surface ${index}: ${href}`,
          ).not.toBeNull();
      }
      if (locale !== "en-US")
        expect(
          documents[3]?.querySelector(
            `a[href="${path(`${ARTICLES_BASE}/${article.slug}`)}"]`,
          ),
        ).toBeNull();
      expect(documents[2]?.querySelector("nav a")?.getAttribute("href")).toBe(
        path(ARTICLES_BASE),
      );
      expect(documents[2]?.querySelector("h1")?.textContent).toBe(
        article.title,
      );
      const metadata = articleMeta({
        loaderData: {
          article,
          useCase: null,
          more: [],
          translatedSlugs: [],
          locales: ["en-US"],
        },
        params: { locale: locale.toLowerCase() },
      });
      const canonical = `https://www.agent-native.com${path(`${ARTICLES_BASE}/${article.slug}`)}`;
      expect(metadata).toContainEqual({
        tagName: "link",
        rel: "canonical",
        href: canonical,
      });
      expect(metadata).toContainEqual({
        property: "og:url",
        content: canonical,
      });
      expect(
        metadata.filter((entry) => "rel" in entry && entry.rel === "alternate"),
      ).toEqual([
        ...["en-US", "x-default"].map((hrefLang) => ({
          tagName: "link",
          rel: "alternate",
          hrefLang,
          href: `https://www.agent-native.com${ARTICLES_BASE}/${article.slug}/`,
        })),
        {
          tagName: "link",
          rel: "alternate",
          type: "text/markdown",
          href: `${sitePathForLocale(ARTICLES_BASE, locale)}${article.slug}.md`,
        },
      ]);
    },
  );

  it.each([true, false])(
    "CodeBlock calls onCopySuccess only after copyText succeeds (%s)",
    async (success) => {
      const prompt = "  Test prompt\n  ";
      let resolveCopy!: (value: boolean) => void;
      vi.mocked(copyText).mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve;
        }),
      );
      const onCopySuccess = vi.fn();
      const view = renderSiteContent(
        <CodeBlock code={prompt} lang="text" onCopySuccess={onCopySuccess} />,
      );
      fireEvent.click(view.getByRole("button", { name: "Copy code" }));
      expect(copyText).toHaveBeenCalledExactlyOnceWith(prompt.trim());
      expect(onCopySuccess).not.toHaveBeenCalled();
      expect(trackEvent).not.toHaveBeenCalled();
      await act(async () => {
        resolveCopy(success);
      });
      expect(onCopySuccess).toHaveBeenCalledTimes(success ? 1 : 0);
      if (success)
        expect(trackEvent).toHaveBeenCalledExactlyOnceWith("copy code block", {
          lang: "text",
          snippet: prompt.trim(),
        });
      else expect(trackEvent).not.toHaveBeenCalled();
    },
  );

  it("CodeBlock clears its copied-state timer on unmount", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(copyText).mockResolvedValue(true);
      const view = renderSiteContent(<CodeBlock code="echo hi" lang="text" />);
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Copy code" }));
      });
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  const filterItems: UseCaseIndexItem[] = [
    {
      ...indexItem,
      slug: "engineering-weekly",
      title: "Engineering weekly",
      roles: ["engineering"],
    },
    {
      ...indexItem,
      slug: "engineering-daily",
      title: "Engineering daily",
      roles: ["engineering"],
    },
    {
      ...indexItem,
      slug: "everyone-weekly",
      title: "Everyone weekly",
      roles: ["everyone"],
    },
    {
      ...indexItem,
      slug: "everyone-daily",
      title: "Everyone daily",
      roles: ["everyone"],
    },
    {
      ...indexItem,
      app: "content",
      slug: "marketing-weekly",
      title: "Marketing weekly",
      roles: ["marketing"],
    },
    { ...indexItem, slug: "untagged", title: "Untagged" },
  ];
  const visibleCardTitles = (view: ReturnType<typeof renderSiteContent>) =>
    view.getAllByRole("link").flatMap((link) => {
      const title = link.querySelector("h3")?.textContent;
      return title ? [title] : [];
    });

  it("filters by role, includes everyone, and updates the URL and filter events", () => {
    const view = renderSiteContent(
      <UseCasesIndex items={filterItems} />,
      "/use-cases?role=engineering&utm_source=keep",
    );
    expect(view.getByLabelText("Role").textContent).toBe("Engineering");
    expect(view.queryByLabelText("How often")).toBeNull();
    expect(visibleCardTitles(view)).toEqual([
      "Engineering weekly",
      "Engineering daily",
      "Everyone weekly",
      "Everyone daily",
    ]);
    expect(trackEvent).not.toHaveBeenCalled();
    fireEvent.click(view.getByLabelText("Role"));
    fireEvent.click(view.getByRole("option", { name: "Marketing" }));
    expect(visibleCardTitles(view)).toEqual([
      "Everyone weekly",
      "Everyone daily",
      "Marketing weekly",
    ]);
    expect(view.getByTestId("location").textContent).toBe(
      "/use-cases?role=marketing&utm_source=keep",
    );
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("index_filter", {
      role: "marketing",
    });
    expect(view.container.querySelectorAll(".grid.gap-px > div")).toHaveLength(
      filterItems.length,
    );
    expect(
      view.container.querySelectorAll(".grid.gap-px > div[hidden]"),
    ).toHaveLength(3);
  });

  it("shows an empty state and clears only the role parameter, restoring all cards", async () => {
    // Pages for everyone show under every role, so leave them out to reach an empty result.
    const items = filterItems.filter(
      (item) => !item.roles?.includes("everyone"),
    );
    const view = renderSiteContent(
      <UseCasesIndex items={items} />,
      "/use-cases?role=finance&utm_source=keep",
    );
    expect(visibleCardTitles(view)).toEqual([]);
    expect(
      view.getByText(enUS.siteContent.filterEmpty).getAttribute("role"),
    ).toBe("status");
    const clear = view.getByRole("link", {
      name: enUS.siteContent.filterClear,
    });
    expect(clear.getAttribute("href")).toBe("/use-cases?utm_source=keep");
    fireEvent.click(clear);
    await waitFor(() =>
      expect(view.queryByText(enUS.siteContent.filterEmpty)).toBeNull(),
    );
    expect(visibleCardTitles(view)).toEqual([
      "Engineering weekly",
      "Engineering daily",
      "Untagged",
      "Marketing weekly",
    ]);
    expect(view.getByLabelText("Role").textContent).toBe("All");
    expect(view.getByTestId("location").textContent).toBe(
      "/use-cases?utm_source=keep",
    );
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("index_filter", {
      role: "",
    });
  });

  it("treats an unknown role, and the retired frequency parameter, as unfiltered", () => {
    const view = renderSiteContent(
      <UseCasesIndex items={filterItems} />,
      "/use-cases?role=unknown&often=weekly",
    );
    expect(visibleCardTitles(view)).toEqual([
      "Engineering weekly",
      "Engineering daily",
      "Everyone weekly",
      "Everyone daily",
      "Untagged",
      "Marketing weekly",
    ]);
    expect(view.getByLabelText("Role").textContent).toBe("All");
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("renders every real article with its listed screenshots and frontmatter FAQs on the page", async () => {
    const actual = await vi.importActual<
      typeof import("../../../lib/site-content.server")
    >("../../../lib/site-content.server");
    const content = actual.loadSiteContent();
    expect(content.articles.length).toBeGreaterThan(0);
    vi.mocked(loadSiteContent).mockReturnValue(content);
    for (const item of content.articles) {
      const data = articleLoader(args({ slug: item.slug }));
      if (item.use_case)
        expect(data.useCase?.slug, item.slug).toBe(item.use_case);
      const document = dom(markup(<ArticlePage {...data} />));
      // Every screenshot in the body is listed in `images`, so each renders themed.
      const bodyImages = [
        ...item.body.matchAll(/^!\[[^\]]*\]\((\S+?)\)$/gm),
      ].map((match) => match[1]);
      expect(bodyImages, item.slug).toEqual(item.images.map((i) => i.dark));
      expect(
        [...document.querySelectorAll("figure .theme-img-light")].map((node) =>
          node.getAttribute("src"),
        ),
        item.slug,
      ).toEqual(item.images.map((i) => i.light));
      // The FAQPage schema must match the questions the page shows.
      expect(
        [...document.querySelectorAll(".site-content-article-faq h3")].map(
          (node) => node.textContent,
        ),
        item.slug,
      ).toEqual(item.faqs.map((faq) => faq.q));
      expect(document.querySelectorAll("h1"), item.slug).toHaveLength(1);
    }
  });

  it("redirects localized site content aliases to their English canonical pages", () => {
    const articles = Array.from(
      { length: ARTICLES_PAGE_SIZE + 1 },
      (_, index) => ({
        ...article,
        slug: `test-article-${index}`,
      }),
    );
    vi.mocked(loadSiteContent).mockReturnValue({
      useCases: [useCase],
      articles,
    });

    const aliases = [
      [localizedSiteContentRoute0.loader, { locale: "fr-fr" }, "/use-cases/"],
      [
        localizedSiteContentRoute1.loader,
        { locale: "fr-fr", slug: useCase.slug },
        `${USE_CASES_BASE}/${useCase.slug}/`,
      ],
      [localizedSiteContentRoute2.loader, { locale: "fr-fr" }, "/articles/"],
      [
        localizedSiteContentRoute3.loader,
        { locale: "fr-fr", slug: "test-article-0" },
        `${ARTICLES_BASE}/test-article-0/`,
      ],
      [
        localizedSiteContentRoute5.loader,
        { locale: "fr-fr", page: "1" },
        "/articles/",
      ],
      [
        localizedSiteContentRoute5.loader,
        { locale: "fr-fr", page: "2" },
        "/articles/page/2/",
      ],
    ] as const;

    for (const [loader, params, pathname] of aliases) {
      const response = loader(args(params)) as Response;
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe(
        `${pathname}?utm_source=test`,
      );
    }
    // Localized use-case pages and articles render when a translation exists (below).
    for (const alias of [
      localizedSiteContentRoute1,
      localizedSiteContentRoute2,
      localizedSiteContentRoute3,
      localizedSiteContentRoute5,
    ]) {
      expect(Object.keys(alias).sort()).toEqual(["default", "loader", "meta"]);
    }
    expect(Object.keys(localizedSiteContentRoute0)).toEqual(["loader"]);
  });

  it("serves a translated use-case page and redirects languages it lacks", () => {
    const { translations: _translations, ...english } = useCase;
    const german = {
      ...english,
      slug: "translated-page",
      app: "slides" as const,
      title: "Auf Deutsch",
    };
    vi.mocked(loadSiteContent).mockReturnValue({
      useCases: [
        {
          ...german,
          title: "In English",
          translations: { "de-DE": german },
        },
      ],
      articles: [],
    });
    const translated = localizedSiteContentRoute1.loader(
      args({ locale: "de-de", slug: "translated-page" }),
    ) as { page: { title: string }; locales: string[] };
    expect(translated.page.title).toBe("Auf Deutsch");
    expect(translated.locales).toEqual(["en-US", "de-DE"]);
    const original = useCaseLoader(args({ slug: "translated-page" }));
    if (original instanceof Response) throw new Error("Expected page data");
    expect(original.page).toEqual({ ...german, title: "In English" });
    expect(original.locales).toEqual(["en-US", "de-DE"]);
    expect(() => useCaseLoader(args({ slug: "missing-use-case" }))).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    const untranslated = localizedSiteContentRoute1.loader(
      args({ locale: "fr-fr", slug: "translated-page" }),
    ) as Response;
    expect(untranslated.status).toBe(301);
    expect(untranslated.headers.get("Location")).toBe(
      "/use-cases/translated-page/?utm_source=test",
    );
  });

  it("serves a translated article with hreflang, translated cards and English fallbacks", () => {
    const german: Article = {
      ...publicArticle(article),
      title: "Testartikel",
      seo_title: "Testartikel Suchtitel",
      meta_description: "Testbeschreibung.",
      og_image: "https://example.com/test-og-de.png",
      updated: "2026-01-02",
      body: "Testeinleitung.\n\n## Test Schritte\n\n### 1. Zahlen sammeln\n\nTesttext.\n\n### 2. Folien bauen\n\nTesttext.\n\n### 3. Teilen\n\nTesttext.\n\n## Häufige Fragen\n\n### Warum testen?\n\nTestantwort.",
    };
    const translated: ArticleEntry = {
      ...article,
      translations: { "de-DE": german },
    };
    const englishOnly: ArticleEntry = {
      ...article,
      slug: "test-english-only",
      updated: "2025-01-01",
    };
    vi.mocked(loadSiteContent).mockReturnValue({
      useCases: [useCase],
      articles: [translated, englishOnly],
    });
    const data = localizedSiteContentRoute3.loader(
      args({ locale: "de-de", slug: article.slug }),
    );
    if (data instanceof Response) throw new Error("Expected article data");
    expect(data.article.title).toBe("Testartikel");
    expect(data.locales).toEqual(["en-US", "de-DE"]);
    expect(data.more.map((item) => item.slug)).toEqual(["test-english-only"]);
    expect(data.translatedSlugs).toEqual([]);
    const english = articleLoader(args({ slug: article.slug }));
    expect(english.article.title).toBe(article.title);
    expect(english.locales).toEqual(["en-US", "de-DE"]);
    const site = "https://www.agent-native.com";
    const alternates = [
      ["en-US", `${site}/articles/test-article/`],
      ["de-DE", `${site}/de-de/articles/test-article/`],
      ["x-default", `${site}/articles/test-article/`],
    ].map(([hrefLang, href]) => ({
      tagName: "link",
      rel: "alternate",
      hrefLang,
      href,
    }));
    const metadata = localizedSiteContentRoute3.meta({
      loaderData: data,
      params: { locale: "de-de" },
    });
    expect(metadata).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: `${site}/de-de/articles/test-article/`,
    });
    expect(metadata).toContainEqual({
      title: "Testartikel Suchtitel | Agent-Native",
    });
    expect(metadata).toContainEqual({
      tagName: "link",
      rel: "alternate",
      type: "text/markdown",
      href: "/de-de/articles/test-article.md",
    });
    for (const meta of [metadata, articleMeta({ loaderData: english })])
      expect(meta.filter((tag) => "hrefLang" in tag)).toEqual(alternates);

    currentLocale.locale = "de-DE";
    const page = dom(markup(<ArticlePage {...data} />));
    expect(page.querySelector("h1")?.textContent).toBe("Testartikel");
    expect(page.getElementById("1-zahlen-sammeln")?.textContent).toContain(
      "Zahlen sammeln",
    );
    expect(page.querySelectorAll(".article-step-list li")).toHaveLength(3);
    expect(
      page.querySelector(".site-content-article-faq")?.textContent,
    ).toContain("Warum testen?");
    expect(
      page.querySelector('a[href="/articles/test-english-only/"]'),
    ).not.toBeNull();
    expect(
      schemas(page).find((schema) => schema["@type"] === "Article"),
    ).toMatchObject({
      inLanguage: "de-DE",
      mainEntityOfPage: `${site}/de-de/articles/test-article/`,
    });

    for (const [params, location] of [
      [{ locale: "fr-fr", slug: article.slug }, "/articles/test-article/"],
      [
        { locale: "de-de", slug: "test-english-only" },
        "/articles/test-english-only/",
      ],
    ] as const) {
      const response = localizedSiteContentRoute3.loader(args(params));
      if (!(response instanceof Response)) throw new Error("Expected redirect");
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe(
        `${location}?utm_source=test`,
      );
    }

    const index = localizedSiteContentRoute2.loader(args({ locale: "de-de" }));
    if (index instanceof Response) throw new Error("Expected index data");
    expect(
      index.articles.map((item) => [item.title, item.og_image, item.updated]),
    ).toEqual([
      ["Testartikel", "https://example.com/test-og-de.png", "2026-01-02"],
      [article.title, article.og_image, "2025-01-01"],
    ]);
    expect(index.translatedSlugs).toEqual([article.slug]);
    expect(index.locales).toEqual(["en-US", "de-DE"]);
    const grid = dom(markup(<ArticlesList {...index} />));
    for (const href of [
      "/de-de/articles/test-article/",
      "/articles/test-english-only/",
    ])
      expect(grid.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    expect(
      localizedSiteContentRoute2.meta({
        loaderData: index,
        params: { locale: "de-de" },
      }),
    ).toContainEqual({
      tagName: "link",
      rel: "alternate",
      hrefLang: "de-DE",
      href: `${site}/de-de/articles/`,
    });
    const untranslatedIndex = localizedSiteContentRoute2.loader(
      args({ locale: "fr-fr" }),
    );
    if (!(untranslatedIndex instanceof Response))
      throw new Error("Expected redirect");
    expect(untranslatedIndex.headers.get("Location")).toBe(
      "/articles/?utm_source=test",
    );
  });

  it("keeps letters and marks in heading ids for every script", () => {
    expect(
      [
        "1. 数字を集める",
        "第一步：收集数据",
        "1. اجمع الأرقامَ",
        "1. नंबर इकट्ठा करें",
      ].map(headingId),
    ).toEqual([
      "1-数字を集める",
      "第一步收集数据",
      "1-اجمع-الأرقامَ",
      "1-नंबर-इकट्ठा-करें",
    ]);
  });

  it("links a Hindi step list to heading ids that keep their vowel signs", () => {
    const steps = ["आउटलाइन से स्लाइड बनाएँ", "नंबर इकट्ठा करें", "डेक शेयर करें"];
    const document = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            body: `परिचय।\n\n## चरण\n\n${steps
              .map((step, index) => `### ${index + 1}. ${step}\n\nपाठ।`)
              .join("\n\n")}\n\n## प्रश्न\n\n### क्यों?\n\nउत्तर।`,
          }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    const links = [...document.querySelectorAll(".article-step-list a")].map(
      (link) => link.getAttribute("href"),
    );
    expect(links).toEqual([
      "#1-आउटलाइन-से-स्लाइड-बनाएँ",
      "#2-नंबर-इकट्ठा-करें",
      "#3-डेक-शेयर-करें",
    ]);
    for (const href of links)
      expect(
        document.getElementById(must(href, "a step link").slice(1)),
        String(href),
      ).not.toBeNull();
  });

  it("returns 404 for invalid localized site content routes or locale tags", () => {
    vi.mocked(loadSiteContent).mockReturnValue({
      useCases: [useCase],
      articles: [article],
    });
    const cases = [
      () =>
        localizedSiteContentRoute1.loader(
          args({ locale: "fr-fr", slug: "missing-use-case" }),
        ),
      () =>
        localizedSiteContentRoute3.loader(
          args({ locale: "fr-fr", slug: "missing-article" }),
        ),
      () =>
        localizedSiteContentRoute5.loader(args({ locale: "fr-fr", page: "0" })),
      () =>
        localizedSiteContentRoute5.loader(args({ locale: "fr-fr", page: "2" })),
      () => localizedSiteContentRoute0.loader(args({ locale: "xx-xx" })),
    ];
    for (const load of cases)
      expect(load).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("resolves catalog placeholders in index meta descriptions", () => {
    const descriptions = [
      siteContentRoute0.meta(),
      siteContentRoute2.meta({
        loaderData: {
          ...siteContentRoute2.articlesPageData([], 1, "en-US"),
          copy: articlesListCopy("en-US"),
        },
      }),
    ].map((meta) =>
      meta.find((tag) => "name" in tag && tag.name === "description"),
    );
    expect(descriptions).toEqual([
      {
        name: "description",
        content:
          "Pick the job you do again and again, or browse the articles for templates and how-tos.",
      },
      { name: "description", content: enUS.siteContent.articlesIntro },
    ]);
  });

  it("titles and describes a localized articles grid in its own language", () => {
    const meta = siteContentRoute2.meta({
      params: { locale: "ja-jp" },
      loaderData: {
        ...siteContentRoute2.articlesPageData([], 1, "ja-JP"),
        copy: articlesListCopy("ja-JP"),
      },
    });
    expect(meta).toContainEqual({
      title: `${jaJP.siteContent.articles} | Agent-Native`,
    });
    expect(meta).toContainEqual({
      name: "description",
      content: jaJP.siteContent.articlesIntro,
    });
    expect(jaJP.siteContent.articles).not.toBe(enUS.siteContent.articles);
  });

  it("uses locale-aware canonicals on indexes, use cases and pagination, with existing unknown-locale fallback", () => {
    const params = { locale: "fr-fr" };
    const cases = [
      [siteContentRoute0.meta({ params }), `${USE_CASES_BASE}/`],
      [
        siteContentRoute1.meta({
          params,
          loaderData: { page: useCase, locales: ["en-US"] },
        }),
        `${USE_CASES_BASE}/${useCase.slug}/`,
      ],
      [
        siteContentRoute2.meta({
          params,
          loaderData: {
            copy: articlesCopy,
            articles: [],
            translatedSlugs: [],
            page: 1,
            hasMore: false,
            locales: ["en-US"],
          },
        }),
        `${ARTICLES_BASE}/`,
      ],
      [
        siteContentRoute5.meta({
          params,
          loaderData: {
            copy: articlesCopy,
            articles: [],
            translatedSlugs: [],
            page: 2,
            hasMore: false,
            locales: ["en-US"],
          },
        }),
        `${ARTICLES_BASE}/page/2/`,
      ],
    ] as const;
    for (const [meta, path] of cases)
      expect(meta).toContainEqual({
        tagName: "link",
        rel: "canonical",
        href: `https://www.agent-native.com/fr-fr${path}`,
      });
    expect(siteContentRoute0.meta({ params: { locale: "unknown" } })).toEqual(
      siteContentRoute0.meta(),
    );
  });

  it("rejects unsafe URL forms while preserving their visible labels", () => {
    for (const href of [
      "/\\\\example.com",
      "/bad path",
      "/bad\\npath",
      "//example.com",
      "https://fake-user:fake-password@example.invalid",
      "https://example.com/\\\\bad",
      "javascript:alert(1)",
    ])
      expect(safeHref(href)).toBeUndefined();
    for (const href of [
      "/docs",
      "#test-heading",
      "../docs",
      "mailto:test@example.invalid",
      "https://example.com/docs",
    ])
      expect(safeHref(href)).toBe(href);
    const document = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            body: "[Test visible label](/\\\\example.com)",
          }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    expect(document.body.textContent).toContain("Test visible label");
    expect(document.querySelector('a[href="/\\\\example.com"]')).toBeNull();
  });

  it("keeps public markdown autolinks and code while excluding private frontmatter and raw HTML", () => {
    const body =
      "---\naudience: PRIVATE\ninternal: PRIVATE\n---\n\n<https://example.com>\n\n```html\n<div>Test code</div>\n```\n\n<script>alert(1)</script>";
    expect(sanitizedMarkdown(body)).toBe(
      "\n<https://example.com>\n\n```html\n<div>Test code</div>\n```\n\n",
    );
    const parsed = parseArticle(article.body);
    expect(parsed.faqTitle).toBe("Frequently asked questions");
    expect(parsed.faqs.map(({ q, a, id }) => ({ q, a, id }))).toEqual([
      { q: "Test FAQ one?", a: "Test answer one.", id: "test-faq-one" },
      { q: "Test FAQ two?", a: "Test answer two.", id: "test-faq-two" },
    ]);
    expect(parsed.after).toEqual([]);
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("//example.com")).toBeUndefined();
    expect(safeHref("/articles/test-article")).toBe("/articles/test-article");
  });
});
