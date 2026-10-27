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

import { ARTICLE_TOPICS, getArticleTopics } from "../../../lib/article-topics";
import {
  ARTICLES_BASE,
  USE_CASES_BASE,
  CATEGORY_NAMES,
  categories,
  type UseCaseEntry,
} from "../../../lib/campaign-content";
import { loadCampaignContent } from "../../../lib/campaign-content.server";
import enUS from "../../i18n/en-US";
import * as localizedCampaignRoute3 from "../../routes/$locale.articles.$slug";
import * as localizedCampaignRoute2 from "../../routes/$locale.articles._index";
import * as localizedCampaignRoute4 from "../../routes/$locale.articles.category.$category";
import * as localizedCampaignRoute5 from "../../routes/$locale.articles.page.$page";
import * as localizedTopicRoute from "../../routes/$locale.articles.topic.$topic";
import * as localizedCampaignRoute1 from "../../routes/$locale.use-cases.$slug";
import * as localizedCampaignRoute0 from "../../routes/$locale.use-cases._index";
import {
  loader as articleLoader,
  meta as articleMeta,
} from "../../routes/articles.$slug";
import * as campaignRoute2 from "../../routes/articles._index";
import { loader as articlesLoader } from "../../routes/articles._index";
import * as campaignRoute4 from "../../routes/articles.category.$category";
import { loader as categoryLoader } from "../../routes/articles.category.$category";
import * as campaignRoute5 from "../../routes/articles.page.$page";
import { loader as pageLoader } from "../../routes/articles.page.$page";
import * as topicRoute from "../../routes/articles.topic.$topic";
import { loader as topicLoader } from "../../routes/articles.topic.$topic";
import * as campaignRoute1 from "../../routes/use-cases.$slug";
import { loader as useCaseLoader } from "../../routes/use-cases.$slug";
import * as campaignRoute0 from "../../routes/use-cases._index";
import CodeBlock from "../CodeBlock";
import { DOCS_LOCALES, sitePathForLocale } from "../docs-locale";
import { TEMPLATE_SCREENSHOTS } from "../template-screenshots";
import { copyText } from "../website-redesign/ds/clipboard";
import { SnackbarProvider } from "../website-redesign/ds/snackbar";
import { ArticlePage, ArticlesList } from "./articles";
import { parseArticle, sanitizedMarkdown } from "./markdown";
import {
  newestArticles,
  publicArticle,
  safeHref,
  type Article,
} from "./public-content";
import {
  CampaignCta,
  CampaignScreenshot,
  CampaignView,
  CopyControl,
} from "./shared";
import { UseCasesIndex, type UseCaseIndexItem } from "./use-cases";

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
vi.mock("../../../lib/campaign-content.server", () => ({
  loadCampaignContent: vi.fn(),
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
const article: Article = {
  slug: "test-article",
  use_case: "test-job",
  job_id: "test-job",
  title: "Test article",
  meta_description: "Test article description.",
  topic: "coding-agents",
  apps: ["clips"],
  published: "2026-01-01",
  author: "Test author",
  app_cta_url: "https://example.com/app",
  cta_label: "Test app",
  screenshot_alt: "Test screenshot",

  cta_band_heading: "Test band",
  cta_band_subhead: "Test band subhead.",
  related_resources: [],
  body: "## Test heading\n\nTest **bold** paragraph with [safe](https://example.com) and [unsafe](javascript:alert(1)).\n\n### Test subheading\n\n1. Test step\n2. Test next step\n\n| Test column | Test value |\n| --- | --- |\n| A | B |\n\n```text\nTest code\n```\n\n<!-- screenshot -->\n\n<!-- try-it -->\n\n## Frequently asked questions\n\n### Test FAQ one?\n\nTest **answer** one.\n\n### Test FAQ two?\n\nTest answer two.\n\n## Test ending\n\nTest final paragraph.",
};
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
function renderCampaign(node: React.ReactNode, entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SnackbarProvider>{node}</SnackbarProvider>
      <LocationProbe />
    </MemoryRouter>,
  );
}
function dom(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

// oracle-change: the original use-case template (old/new way, recipes, angles, stories, next jobs) was removed; its page, loader projection and frequency tag tests went with it, and every use-case page now renders through use-case-page.tsx.
describe("public campaign frontend", () => {
  it.each(DOCS_LOCALES)(
    "SSR renders a single intro paragraph with only articles linked for %s",
    (locale) => {
      currentLocale.locale = locale;
      const document = dom(markup(<UseCasesIndex items={[indexItem]} />));
      const header = document.querySelector("h1")!.parentElement!;
      expect(header.querySelectorAll("h1 ~ p")).toHaveLength(1);
      const intro = header.querySelector("h1 + p")!;
      expect(intro.textContent).toBe(
        "Pick the job you do again and again, or browse the articles for templates and how-tos.",
      );
      expect(intro.textContent).toBe(
        enUS.campaign.useCasesIntro.replace("{{articles}}", "articles"),
      );
      expect(header.parentElement?.querySelectorAll(":scope > p")).toHaveLength(
        0,
      );
      expect(intro.querySelectorAll("a")).toHaveLength(1);
      const link = intro.querySelector("a")!;
      expect(link.textContent).toBe("articles");
      expect(link.getAttribute("href")).toBe(
        sitePathForLocale(ARTICLES_BASE, locale),
      );
      expect(link.classList.contains("campaign-inline-link")).toBe(true);
    },
  );

  it.each([undefined, "2026-02-03"])(
    "labels the actual updated date or the published fallback (%s) without changing JSON-LD dates",
    (updated) => {
      const document = dom(
        markup(
          <ArticlePage
            article={{ ...article, updated }}
            useCase={null}
            more={[]}
          />,
        ),
      );
      const date = updated ?? article.published;
      const time = document.querySelector("time")!;
      expect(time.getAttribute("dateTime")).toBe(date);
      expect(time.textContent).toBe(
        `${updated ? "Updated" : "Published"} ${new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(date))}`,
      );
      const schema = JSON.parse(
        document.querySelector('script[type="application/ld+json"]')!
          .textContent!,
      );
      expect(schema.datePublished).toBe(article.published);
      expect(schema.dateModified).toBe(date);
    },
  );

  it("omits article page copying while preserving the byline and working heading copy controls", async () => {
    const item = {
      ...article,
      author_avatar: "https://example.com/avatar.png",
      author_role: "Test editor",
      updated: "2026-02-03",
      body: `## Test heading\n\n${Array.from({ length: 201 }, () => "word").join(" ")}`,
    };
    window.history.replaceState(null, "", "/articles/test-article/");
    vi.mocked(copyText).mockResolvedValue(true);
    const view = renderCampaign(
      <ArticlePage article={item} useCase={null} more={[]} />,
    );
    expect(view.queryByRole("button", { name: "Copy page" })).toBeNull();
    expect(view.getByText(item.author).textContent).toBe(item.author);
    expect(view.getByText(item.author_role).textContent).toBe(item.author_role);
    const avatar = view.getByRole("img", { name: item.author });
    expect(avatar.getAttribute("src")).toBe(item.author_avatar);
    expect(avatar.classList.contains("rounded-full")).toBe(true);
    const time = view.container.querySelector("time")!;
    expect(time.getAttribute("dateTime")).toBe(item.updated);
    expect(time.textContent).toBe("Updated February 3, 2026");
    expect(view.getByText("2 min read")).toBeDefined();
    const heading = view.getByRole("heading", { name: "Test heading" });
    expect(heading.id).toBe("test-heading");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy link" }));
    });
    expect(copyText).toHaveBeenCalledExactlyOnceWith(
      `${window.location.origin}/articles/test-article/#test-heading`,
    );
    expect(view.getByText(enUS.campaign.copied)).toBeDefined();
  });

  it.each([true, false])(
    "keeps standalone page CopyControl feedback for copy success %s",
    async (success) => {
      vi.mocked(copyText).mockResolvedValue(success);
      const view = renderCampaign(<CopyControl text="Test page markdown" />);
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Copy page" }));
      });
      expect(copyText).toHaveBeenCalledExactlyOnceWith("Test page markdown");
      expect(
        view.getByText(
          success ? enUS.campaign.copied : enUS.campaign.copyFailed,
        ),
      ).toBeDefined();
    },
  );

  it("sorts every article loader by updated-or-published date and keeps stable ties without mutating input", () => {
    const fixtures = [
      {
        ...article,
        slug: "test-newly-published",
        title: "Test newly published article",
        published: "2026-02-01",
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
        slug: "test-tie",
        title: "Test tied article",
        published: "2026-03-01",
      },
    ];
    const sourceOrder = fixtures.map((item) => item.slug);
    const expected = [
      "test-recently-updated",
      "test-tie",
      "test-newly-published",
    ];
    expect(newestArticles(fixtures).map((item) => item.slug)).toEqual(expected);
    expect(fixtures.map((item) => item.slug)).toEqual(sourceOrder);
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [useCase],
      articles: fixtures,
    });
    const lists = [
      articlesLoader(),
      topicLoader(args({ topic: article.topic })),
    ];
    for (const list of lists) {
      expect(list.articles.map((item) => item.slug)).toEqual(expected);
      const document = dom(markup(<ArticlesList {...list} />));
      expect(document.querySelectorAll("time")).toHaveLength(0);
      expect(
        [...document.querySelectorAll("article h2")].map(
          (node) => node.textContent,
        ),
      ).toEqual(
        expected.map(
          (slug) => fixtures.find((item) => item.slug === slug)!.title,
        ),
      );
      for (const row of document.querySelectorAll("article > a")) {
        expect([...row.children].map((node) => node.tagName)).toEqual([
          "SPAN",
          "H2",
        ]);
        expect(row.classList.contains("sm:grid-cols-[1fr_2fr]")).toBe(true);
      }
    }
    expect(
      articleLoader(args({ slug: fixtures[0].slug })).more.map(
        (item) => item.slug,
      ),
    ).toEqual(expected.slice(0, 2));
  });

  it("renders only real cards in incomplete use-case and more-article grids", () => {
    const pages = [
      [<UseCasesIndex items={[indexItem]} />, 1],
      [
        <ArticlePage
          article={article}
          useCase={null}
          more={[{ ...article, slug: "test-more" }]}
        />,
        1,
      ],
    ] as const;
    for (const [page, count] of pages) {
      const document = dom(markup(page));
      const grid = document.querySelector(".grid.gap-px")!;
      expect(grid.children).toHaveLength(count);
      const cards = [...grid.children].map((node) =>
        node.tagName === "A" ? node : node.querySelector(":scope > a"),
      );
      expect(cards).toHaveLength(count);
      for (const card of cards) {
        expect(card?.getAttribute("href")).toMatch(/^\/(use-cases|articles)\//);
        expect(card?.querySelector("h3")?.textContent).toBeTruthy();
      }
      expect(grid.querySelectorAll("a")).toHaveLength(count);
    }
  });
  it("uses router tracking parameters and emits only allowed campaign fields", () => {
    window.history.replaceState(
      null,
      "",
      "/?utm_source=test&utm_content=existing&audience=PRIVATE&internal=PRIVATE",
    );
    const entry =
      "/?utm_source=test&utm_content=existing&audience=PRIVATE&internal=PRIVATE";
    const articleView = renderCampaign(
      <>
        <CampaignView item={article} />
        <CampaignCta item={article} location="inline" />
      </>,
      entry,
    );
    const articleLink = articleView.getByRole("link", { name: "Test app" });
    const url = new URL(articleLink.getAttribute("href") ?? "");
    expect(url.searchParams.get("job")).toBe("test-job");
    expect(url.searchParams.get("utm_source")).toBe("test");
    expect(url.searchParams.get("utm_content")).toBe("existing");
    expect(url.searchParams.has("audience")).toBe(false);
    articleLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(articleLink);
    expect(trackEvent).toHaveBeenCalledWith("article_view", {
      slug: "test-article",
      use_case: "test-job",
      job_id: "test-job",
      topic: article.topic,
    });
    expect(trackEvent).toHaveBeenCalledWith("article_cta_click", {
      slug: "test-article",
      use_case: "test-job",
      job_id: "test-job",
      topic: article.topic,
      location: "inline",
    });
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain(
      "PRIVATE",
    );
  });
  const args = (params: Record<string, string>) =>
    ({
      params,
      request: new Request("https://example.com/articles?utm_source=test"),
    }) as LoaderFunctionArgs;

  it("bounds published-date pagination and rejects invalid routes", () => {
    const articles = Array.from({ length: 14 }, (_, index) => ({
      ...article,

      slug: `test-${index}`,
      published: `2026-01-${String(index + 1).padStart(2, "0")}`,
    }));
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [{ ...useCase, app: "clips" }],
      articles,
    });
    const first = articlesLoader();
    expect(first.articles.map((item) => item.slug)).toEqual(
      Array.from({ length: 12 }, (_, i) => `test-${13 - i}`),
    );
    expect(first.hasMore).toBe(true);
    expect(first.topics).toEqual(getArticleTopics(articles));
    const second = pageLoader(args({ page: "2" }));
    expect(second.articles.map((item) => item.slug)).toEqual([
      "test-1",
      "test-0",
    ]);
    expect(second.hasMore).toBe(false);
    expect(second.topics).toEqual(getArticleTopics(articles));
    for (const page of ["0", "-1", "2.5", "2abc", "3", "99999999999999999"]) {
      try {
        pageLoader(args({ page }));
        throw new Error("Expected page rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(Response);
        expect((error as Response).status).toBe(404);
      }
    }
    expect(topicLoader(args({ topic: article.topic })).articles).toHaveLength(
      14,
    );
    for (const topic of ["clips", "unknown", "", "metrics"]) {
      expect(() => topicLoader(args({ topic }))).toThrow(
        expect.objectContaining({ status: 404 }),
      );
    }
    expect(() => articleLoader(args({ slug: "absent" }))).toThrow();
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

  it("prioritizes same-topic recommendations, then newest remaining articles, capped at three", () => {
    const fixtures: Article[] = [
      article,
      { ...article, slug: "older-same", published: "2025-01-01" },
      {
        ...article,
        slug: "new-other",
        topic: "metrics",
        published: "2026-09-01",
      },
      {
        ...article,
        slug: "updated-same",
        published: "2024-01-01",
        updated: "2026-08-01",
      },
      {
        ...article,
        slug: "old-other",
        topic: "prototyping",
        published: "2026-07-01",
      },
    ];
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [],
      articles: fixtures,
    });
    expect(
      articleLoader(args({ slug: article.slug })).more.map((item) => item.slug),
    ).toEqual(["updated-same", "older-same", "new-other"]);
    expect(fixtures.map((item) => item.slug)).toEqual([
      article.slug,
      "older-same",
      "new-other",
      "updated-same",
      "old-other",
    ]);
  });

  it.each([undefined, ...DOCS_LOCALES.map((locale) => locale.toLowerCase())])(
    "permanently redirects old categories to the locale-aware articles index (%s)",
    (locale) => {
      for (const category of [...categories, "content", "unknown"]) {
        const params = { category, ...(locale ? { locale } : {}) };
        const response = categoryLoader(args(params));
        expect(response.status).toBe(301);
        expect(response.headers.get("Location")).toBe(
          sitePathForLocale(ARTICLES_BASE, locale),
        );
      }
      expect(Object.keys(campaignRoute4)).toEqual(["loader"]);
      expect(Object.keys(localizedCampaignRoute4)).toEqual(["loader"]);
    },
  );

  it.each(DOCS_LOCALES)(
    "uses configured topic metadata and canonical for %s",
    (locale) => {
      vi.mocked(loadCampaignContent).mockReturnValue({
        useCases: [],
        articles: [article],
      });
      const loaderData = topicLoader(args({ topic: article.topic }));
      const metadata = topicRoute.meta({
        loaderData,
        params: { locale: locale.toLowerCase() },
      });
      const config = ARTICLE_TOPICS[article.topic];
      expect(metadata).toContainEqual({
        title: `${config.name} | Agent-Native`,
      });
      expect(metadata).toContainEqual({
        name: "description",
        content: config.description,
      });
      expect(metadata).toContainEqual({
        tagName: "link",
        rel: "canonical",
        href: `https://www.agent-native.com${sitePathForLocale(`${ARTICLES_BASE}/topic/${article.topic}`, locale)}`,
      });
    },
  );

  it("returns full-dataset topic counts on both index pages even when a topic is absent from the visible page", () => {
    const articles: Article[] = Array.from({ length: 13 }, (_, index) => ({
      ...article,
      slug: `test-${index}`,
      published: "2026-02-01",
    }));
    articles.push({
      ...article,
      slug: "older-metrics",
      topic: "metrics",
      published: "2025-01-01",
    });
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [],
      articles,
    });
    const expected = getArticleTopics(articles);
    expect(expected.map(({ count }) => count)).toEqual([13, 1]);
    for (const data of [articlesLoader(), pageLoader(args({ page: "2" }))]) {
      expect(data.topics).toEqual(expected);
    }
    expect(
      articlesLoader().articles.some((item) => item.topic === "metrics"),
    ).toBe(false);
  });

  it("discovers each populated configured topic without app-specific lists or route branches", () => {
    for (const topic of Object.keys(
      ARTICLE_TOPICS,
    ) as (keyof typeof ARTICLE_TOPICS)[]) {
      const item = { ...article, topic };
      vi.mocked(loadCampaignContent).mockReturnValue({
        useCases: [],
        articles: [item],
      });
      const data = topicLoader(args({ topic }));
      expect(data.topic).toBe(topic);
      expect(data.articles).toEqual([publicArticle(item)]);
      expect(data.topics).toEqual(getArticleTopics([item]));
      const document = dom(markup(<ArticlesList {...articlesLoader()} />));
      expect(
        [...document.querySelectorAll('li > a[href*="/topic/"]')].map((link) =>
          link.getAttribute("href"),
        ),
      ).toEqual([sitePathForLocale(`${ARTICLES_BASE}/topic/${topic}`)]);
    }
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
      category: "PRIVATE-LEGACY",
      audience: "PRIVATE",
      internal: "PRIVATE",
    };
    const other = {
      ...privateArticle,
      slug: "test-other",
      published: "2026-01-02",
    };
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [privateCase],
      articles: [privateArticle, other],
    });
    const data = articleLoader(args({ slug: article.slug }));
    expect(data.more.map((item) => item.slug)).toEqual(["test-other"]);
    expect(JSON.stringify(data)).not.toContain("PRIVATE");
    for (const list of [
      articlesLoader(),
      topicLoader(args({ topic: article.topic })),
    ]) {
      expect(JSON.stringify(list)).not.toContain("PRIVATE");
      for (const item of list.articles)
        expect(item).not.toHaveProperty("category");
    }
    const metadata = articleMeta({ loaderData: data });
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
    const contaminatedArticle = {
      ...article,
      audience: "PRIVATE",
      internal: "PRIVATE",
      category: "PRIVATE-LEGACY",
      related_resources: [
        { label: "Test link", url: "/docs", internal: "PRIVATE" },
      ],
    };
    const projectedArticle = publicArticle(contaminatedArticle);
    expect(projectedArticle.topic).toBe(article.topic);
    expect(projectedArticle.apps).toEqual(article.apps);
    expect(projectedArticle).not.toHaveProperty("category");
    expect(JSON.stringify(projectedArticle)).not.toContain("PRIVATE");
  });

  it("renders semantic markdown, markers and matching article FAQ schema without executable HTML", () => {
    const document = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            body: article.body + '\n\n<script>alert("bad")</script>',
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
    for (const id of [
      "frequently-asked-questions",
      "test-faq-one",
      "test-faq-two",
    ]) {
      const heading = document.getElementById(id)!;
      expect(["H2", "H3"]).toContain(heading.tagName);
      const copy = heading.parentElement!.querySelector(
        'button[aria-label="Copy link"]',
      )!;
      expect(copy).not.toBeNull();
      expect(copy.closest("button[aria-expanded]")).toBeNull();
      expect(copy.classList.contains("group-hover:opacity-100")).toBe(true);
    }
    expect(document.querySelectorAll("table th")).toHaveLength(2);
    expect(document.querySelectorAll("table td")).toHaveLength(2);
    expect(document.querySelector("pre")?.textContent).toContain("Test code");
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(document.querySelectorAll("script:not([type])")).toHaveLength(0);
    expect(document.querySelector("button button")).toBeNull();
    expect(document.body.textContent).toContain("Test answer one.");
    expect(document.body.textContent).toContain("Test answer two.");
    expect(document.body.textContent).toContain("Test final paragraph.");
    const schemas = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ].map((node) => JSON.parse(node.textContent!));
    expect(schemas[0]).toMatchObject({
      "@type": "Article",
      headline: article.title,
      author: { name: article.author },
      articleSection: ARTICLE_TOPICS[article.topic].name,
    });
    expect(
      schemas[1].mainEntity.map(
        (entry: { name: string; acceptedAnswer: { text: string } }) => [
          entry.name,
          entry.acceptedAnswer.text,
        ],
      ),
    ).toEqual([
      ["Test FAQ one?", "Test answer one."],
      ["Test FAQ two?", "Test answer two."],
    ]);
  });

  it("renders All articles and related-card topic, title and full metadata", () => {
    const list = dom(
      markup(<ArticlesList articles={[article]} page={1} hasMore={false} />),
    );
    expect(
      [...list.querySelectorAll("h2")].map((heading) => heading.textContent),
    ).toContain("All articles");
    expect(
      list.querySelector(
        `a[href="${sitePathForLocale(`${ARTICLES_BASE}/${article.slug}`)}"]`,
      ),
    ).not.toBeNull();
    const related = {
      ...article,
      slug: "test-related",
      title: "Test related article",
      meta_description: "Test related metadata, kept verbatim.",
    };
    const page = dom(
      markup(
        <ArticlePage article={article} useCase={useCase} more={[related]} />,
      ),
    );
    const card = page.querySelector(
      `a[href="${sitePathForLocale(`${ARTICLES_BASE}/${related.slug}`)}"]`,
    )!;
    expect(card.querySelector("h3")?.textContent).toBe(related.title);
    expect(card.querySelector(".campaign-label")?.textContent).toBe(
      ARTICLE_TOPICS[related.topic].name,
    );
    expect(card.querySelector("h3")!.previousElementSibling?.textContent).toBe(
      ARTICLE_TOPICS[related.topic].name,
    );
    expect(card.textContent).toContain(related.meta_description);
    expect(
      page.querySelector(
        `a[href="${sitePathForLocale(`${USE_CASES_BASE}/${useCase.slug}`)}"]`,
      )?.textContent,
    ).toBe(useCase.title);
  });

  it.each(DOCS_LOCALES)(
    "renders one articles intro with only use cases linked and semantic topic summaries for %s",
    (locale) => {
      currentLocale.locale = locale;
      const document = dom(
        markup(<ArticlesList articles={[article]} page={1} hasMore={false} />),
      );
      const header = document.querySelector("h1")!.parentElement!;
      expect(header.querySelectorAll("h1 ~ p")).toHaveLength(1);
      const intro = header.querySelector("h1 + p")!;
      expect(intro.textContent).toBe(
        "Practical answers about recurring work with AI agents. For step-by-step pages on a single job, browse the use cases.",
      );
      expect(intro.querySelectorAll("a")).toHaveLength(1);
      expect(intro.querySelector("a")?.textContent).toBe("use cases");
      expect(intro.querySelector("a")?.getAttribute("href")).toBe(
        sitePathForLocale(USE_CASES_BASE, locale),
      );
      expect(header.textContent).toBe(
        `${enUS.campaign.articles}${intro.textContent}`,
      );
      expect(header.parentElement?.querySelectorAll(":scope > p")).toHaveLength(
        0,
      );
      const section = [...document.querySelectorAll("section")].find(
        (node) => node.querySelector("h2")?.textContent === "All topics",
      )!;
      const list = section.querySelector("ul")!;
      expect(list.classList.contains("lg:columns-2")).toBe(true);
      expect(list.classList.contains("grid")).toBe(false);
      expect(list.classList.contains("gap-px")).toBe(false);
      expect([...list.children].map((node) => node.tagName)).toEqual(["LI"]);
      expect(
        section.querySelector(".grid.gap-px > a, .grid.gap-px > div"),
      ).toBeNull();
      const link = list.querySelector("li > a")!;
      expect(link.getAttribute("href")).toBe(
        sitePathForLocale(`${ARTICLES_BASE}/topic/${article.topic}`, locale),
      );
      expect(link.querySelector("h3")?.textContent).toBe(
        ARTICLE_TOPICS[article.topic].name,
      );
      expect(link.querySelector("p")?.textContent).toBe(
        ARTICLE_TOPICS[article.topic].description,
      );
      expect(link.querySelector(".campaign-label")?.textContent).toBe(
        "1 article",
      );
      expect(
        document.querySelector("article .campaign-label")?.textContent,
      ).toBe(ARTICLE_TOPICS[article.topic].name);
      const topic = dom(
        markup(
          <ArticlesList
            articles={[article]}
            topic={article.topic}
            page={1}
            hasMore={false}
          />,
        ),
      );
      expect(topic.querySelector("h1")?.textContent).toBe(
        ARTICLE_TOPICS[article.topic].name,
      );
      expect(topic.body.textContent).not.toContain("All topics");
    },
  );

  it("uses supplied full-dataset topic summaries instead of recounting the current page", () => {
    const summaries = getArticleTopics([
      article,
      article,
      { ...article, topic: "metrics" },
    ]);
    const document = dom(
      markup(
        <ArticlesList
          articles={[article]}
          topics={summaries}
          page={2}
          hasMore={false}
        />,
      ),
    );
    const section = [...document.querySelectorAll("section")].find(
      (node) => node.querySelector("h2")?.textContent === "All topics",
    )!;
    expect(
      [...section.querySelectorAll("li .campaign-label")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["2 articles", "1 article"]);
  });

  it("does not list configured topics that have no articles or create routes for them", () => {
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [],
      articles: [],
    });
    const data = articlesLoader();
    expect(data.topics).toEqual([]);
    const document = dom(markup(<ArticlesList {...data} />));
    expect(document.querySelectorAll('a[href*="/topic/"]')).toHaveLength(0);
    for (const topic of Object.keys(ARTICLE_TOPICS)) {
      expect(() => topicLoader(args({ topic }))).toThrow(
        expect.objectContaining({ status: 404 }),
      );
    }
  });

  it.each([
    {
      topics: ["coding-agents", "coding-agents"],
      heading: "More on Working with coding agents",
    },
    { topics: ["coding-agents", "prototyping"], heading: "More articles" },
    { topics: ["prototyping"], heading: "More articles" },
  ] as const)(
    "uses '$heading' for recommendations $topics",
    ({ topics, heading }) => {
      const document = dom(
        markup(
          <ArticlePage
            article={article}
            useCase={null}
            more={topics.map((topic, index) => ({
              ...article,
              slug: `related-${index}`,
              topic,
            }))}
          />,
        ),
      );
      const headings = [...document.querySelectorAll("h2")].map(
        (heading) => heading.textContent,
      );
      expect(headings).toContain(heading);
      expect(headings).not.toContain(
        heading === "More articles"
          ? "More on Working with coding agents"
          : "More articles",
      );
    },
  );

  it("prepends the localized use-case resource and keeps resource labels and URLs intact", () => {
    currentLocale.locale = "fr-FR";
    const resources = [
      { label: "Test internal resource", url: "/docs?source=test#details" },
      { label: "Test external resource", url: "https://example.com/resource" },
    ];
    const document = dom(
      markup(
        <ArticlePage
          article={{ ...article, related_resources: resources }}
          useCase={useCase}
          more={[]}
        />,
      ),
    );
    const section = [...document.querySelectorAll("section")].find(
      (section) =>
        section.querySelector("h2")?.textContent === "Related resources",
    )!;
    expect(section.classList.contains("docs-content")).toBe(true);
    expect(section.querySelector("h2")?.getAttribute("class")).toBeNull();
    const links = [...section.querySelectorAll("li a")];
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      [
        useCase.title,
        sitePathForLocale(`${USE_CASES_BASE}/${useCase.slug}`, "fr-FR"),
      ],
      [
        resources[0].label,
        `${sitePathForLocale("/docs", "fr-FR")}?source=test#details`,
      ],
      [resources[1].label, resources[1].url],
    ]);
    for (const link of links) {
      expect(link.classList.contains("campaign-inline-link")).toBe(true);
      expect(link.classList.contains("text-[var(--docs-accent)]")).toBe(true);
    }
    const partOf = [...document.querySelectorAll("p")]
      .find((paragraph) => paragraph.textContent?.startsWith("Part of:"))!
      .querySelector("a")!;
    expect(partOf.getAttribute("href")).toBe(links[0].getAttribute("href"));
    expect(partOf.classList.contains("campaign-inline-link")).toBe(true);
    expect(partOf.classList.contains("text-[var(--docs-accent)]")).toBe(true);
  });

  it.each([true, false])(
    "shows Related resources with only a use case: %s",
    (hasUseCase) => {
      const document = dom(
        markup(
          <ArticlePage
            article={article}
            useCase={hasUseCase ? useCase : null}
            more={[]}
          />,
        ),
      );
      const section = [...document.querySelectorAll("section")].find(
        (section) =>
          section.querySelector("h2")?.textContent === "Related resources",
      );
      if (hasUseCase) {
        expect(section?.querySelectorAll("li")).toHaveLength(1);
        expect(section?.querySelector("a")?.textContent).toBe(useCase.title);
      } else {
        expect(section).toBeUndefined();
      }
    },
  );

  it("SSR renders a compact left-aligned closing CTA block for articles", () => {
    const document = dom(
      markup(<ArticlePage article={article} useCase={null} more={[]} />),
    );
    const band = [...document.querySelectorAll("section")].at(-1);
    const content = band?.firstElementChild;
    const stack = content?.firstElementChild;
    if (!band || !content || !stack) throw new Error("Expected a CTA band");
    expect(content.classList.contains("campaign-section")).toBe(true);
    expect(content.classList.contains("pb-16")).toBe(false);
    expect(stack.classList.contains("flex-col")).toBe(true);
    expect(stack.classList.contains("items-start")).toBe(true);
    expect(stack.classList.contains("text-start")).toBe(true);
    expect([...stack.children].map((element) => element.tagName)).toEqual([
      "DIV",
      "P",
      "A",
    ]);
    expect(stack.children.item(0)?.querySelector("h2")?.textContent).toBe(
      article.cta_band_heading,
    );
    expect(stack.children.item(1)?.textContent).toBe(article.cta_band_subhead);
    expect(stack.children.item(2)?.textContent).toBe(article.cta_label);
    expect(band.querySelectorAll("a")).toHaveLength(1);
    expect(band.querySelector(".template-detail-cta-actions")).toBeNull();
  });

  it("scopes tables before, within and after article FAQs without changing semantic headers", () => {
    const table =
      "| Test header | Test value |\n| --- | --- |\n| Test cell | Test body |";
    const document = dom(
      markup(
        <ArticlePage
          article={{
            ...article,
            body: `${table}\n\n## Frequently asked questions\n\n### Test question?\n\n${table}\n\n## Test ending\n\n${table}`,
          }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    expect(document.querySelectorAll("table")).toHaveLength(3);
    for (const cell of document.querySelectorAll("th, td")) {
      expect(
        cell.closest(".campaign-article-content .docs-content"),
      ).not.toBeNull();
    }
    expect(document.querySelectorAll("thead th")).toHaveLength(6);
    expect(document.querySelectorAll("tbody td")).toHaveLength(6);
  });

  it.each([...categories, "content"] as const)(
    "uses existing dark/light %s app screenshots with fixed framing in article heroes and inline markers",
    (app) => {
      const appKey = app === "plans" ? "plan" : app;
      for (const item of [{ ...article, apps: [app] }]) {
        const document = dom(markup(<CampaignScreenshot item={item} />));
        const frame = document.querySelector(".docs-image-frame")!;
        expect(frame.classList.contains("relative")).toBe(true);
        expect(frame.classList.contains("aspect-[1200/750]")).toBe(true);
        const dark = frame.querySelector(".theme-img-dark")!;
        const light = frame.querySelector(".theme-img-light")!;
        expect(dark.getAttribute("src")).toBe(
          TEMPLATE_SCREENSHOTS[appKey].dark,
        );
        expect(light.getAttribute("src")).toBe(
          TEMPLATE_SCREENSHOTS[appKey].light,
        );
        expect(dark.getAttribute("alt")).toBe(item.screenshot_alt);
        expect(light.getAttribute("alt")).toBe("");
        expect(light.getAttribute("aria-hidden")).toBe("true");
        expect(dark.getAttribute("sizes")).toBe(
          "(max-width: 767px) 100vw, 1200px",
        );
        expect(dark.getAttribute("style")).toBe(
          appKey === "design" || appKey === "slides"
            ? `transform:scaleX(${15 / 14})`
            : null,
        );
        expect(frame.querySelector("div[aria-hidden]")).not.toBeNull();
      }
      const document = dom(
        markup(
          <ArticlePage
            article={{ ...article, apps: [app] }}
            useCase={null}
            more={[]}
          />,
        ),
      );
      expect(
        document
          .querySelector(".docs-image-frame .theme-img-dark")
          ?.getAttribute("src"),
      ).toBe(TEMPLATE_SCREENSHOTS[appKey].dark);
    },
  );

  it.each([undefined, []])(
    "renders no article screenshot without apps (%j)",
    (apps) => {
      const {
        use_case: _useCase,
        screenshot_alt: _alt,
        ...standalone
      } = article;
      const item: Article = { ...standalone, topic: "agentic-apps", apps };
      expect(markup(<CampaignScreenshot item={item} />)).toBe("");
      const document = dom(
        markup(<ArticlePage article={item} useCase={null} more={[]} />),
      );
      expect(document.querySelector("figure, .docs-image-frame")).toBeNull();
      expect(document.body.textContent).not.toContain("Part of:");
      expect(document.querySelector('a[href*="/use-cases/"]')).toBeNull();
      const ctas = [...document.querySelectorAll("a")].filter(
        (link) => link.textContent === item.cta_label,
      );
      expect(ctas).toHaveLength(2);
      expect(ctas[0].closest(".campaign-article-content")).not.toBeNull();
      const band = [...document.querySelectorAll("section")].at(-1)!;
      expect(band.querySelector("h2")?.textContent).toBe(item.cta_band_heading);
      expect(band.contains(ctas[1])).toBe(true);
      for (const cta of ctas) {
        const url = new URL(cta.getAttribute("href")!);
        expect(`${url.origin}${url.pathname}`).toBe(item.app_cta_url);
        expect(url.searchParams.get("job")).toBe(item.job_id);
      }
    },
  );

  it("uses only the first article app for screenshots, independently of topic", () => {
    const document = dom(
      markup(
        <CampaignScreenshot
          item={{ ...article, topic: "metrics", apps: ["design", "clips"] }}
        />,
      ),
    );
    expect(document.querySelectorAll("figure")).toHaveLength(1);
    expect(document.querySelector(".theme-img-dark")?.getAttribute("src")).toBe(
      TEMPLATE_SCREENSHOTS.design.dark,
    );
    expect(
      document.querySelector(".theme-img-light")?.getAttribute("src"),
    ).toBe(TEMPLATE_SCREENSHOTS.design.light);
  });

  it.each(DOCS_LOCALES)(
    "preserves %s in every campaign navigation surface without translating editorial content",
    (locale) => {
      currentLocale.locale = locale;
      const related = { ...article, slug: "test-related" };
      const nodes = [
        <UseCasesIndex items={[indexItem]} />,
        <ArticlesList articles={[article]} page={1} hasMore />,
        <ArticlePage
          article={{
            ...article,
            body: `${article.body}\n\n[Internal article](${ARTICLES_BASE}/test-linked?source=test#details)`,
            related_resources: [
              {
                label: "Test resource",
                url: `${USE_CASES_BASE}/test-resource`,
              },
            ],
          }}
          useCase={useCase}
          more={[related]}
        />,
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
            path(USE_CASES_BASE),
            path(`${ARTICLES_BASE}/topic/${article.topic}`),
          ],
        ],
        [
          2,
          [
            path(ARTICLES_BASE),
            path(`${ARTICLES_BASE}/topic/${article.topic}`),
            path(`${USE_CASES_BASE}/${useCase.slug}`),
            path(`${ARTICLES_BASE}/${related.slug}`),
            path(`${USE_CASES_BASE}/test-resource`),
            `${path(`${ARTICLES_BASE}/test-linked`)}?source=test#details`,
          ],
        ],
      ] as const) {
        for (const href of hrefs)
          expect(
            documents[index]?.querySelector(`a[href="${href}"]`),
            `surface ${index}: ${href}`,
          ).not.toBeNull();
      }
      expect(documents[2]?.querySelector("nav a:last-child")?.textContent).toBe(
        ARTICLE_TOPICS[article.topic].name,
      );
      expect(
        documents[2]?.querySelector("nav a:last-child")?.getAttribute("href"),
      ).toBe(path(`${ARTICLES_BASE}/topic/${article.topic}`));
      expect(documents[2]?.querySelector("h1")?.textContent).toBe(
        article.title,
      );
      expect(documents[2]?.body.textContent).toContain("Test final paragraph.");
      const metadata = articleMeta({
        loaderData: { article, useCase: null, more: [] },
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
      const view = renderCampaign(
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
  const visibleCardTitles = (view: ReturnType<typeof renderCampaign>) =>
    view.getAllByRole("link").flatMap((link) => {
      const title = link.querySelector("h3")?.textContent;
      return title ? [title] : [];
    });

  it("filters by role, includes everyone, and updates the URL and filter events", () => {
    const view = renderCampaign(
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
    const view = renderCampaign(
      <UseCasesIndex items={items} />,
      "/use-cases?role=finance&utm_source=keep",
    );
    expect(visibleCardTitles(view)).toEqual([]);
    expect(view.getByText(enUS.campaign.filterEmpty).getAttribute("role")).toBe(
      "status",
    );
    const clear = view.getByRole("link", { name: enUS.campaign.filterClear });
    expect(clear.getAttribute("href")).toBe("/use-cases?utm_source=keep");
    fireEvent.click(clear);
    await waitFor(() =>
      expect(view.queryByText(enUS.campaign.filterEmpty)).toBeNull(),
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
    const view = renderCampaign(
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

  it.each([
    {
      useCaseSlug: "ai-prototype-generator",
      slug: "how-to-turn-a-design-brief-into-a-prototype-with-ai",
      oldSlug: "what-goes-in-a-design-brief",
      title: "How do you turn a design brief into a prototype with AI?",
    },
    {
      useCaseSlug: "ai-pitch-deck-maker",
      slug: "how-to-make-a-pitch-deck-with-ai",
      oldSlug: "what-should-a-startup-pitch-deck-include",
      title: "How do you make a pitch deck with AI?",
    },
  ])(
    "links article $slug to $useCaseSlug and rejects the deleted article route",
    async ({ useCaseSlug, slug, oldSlug, title }) => {
      const actual = await vi.importActual<
        typeof import("../../../lib/campaign-content.server")
      >("../../../lib/campaign-content.server");
      vi.mocked(loadCampaignContent).mockReturnValue(
        actual.loadCampaignContent(),
      );
      for (const locale of DOCS_LOCALES) {
        currentLocale.locale = locale;
        const params = { locale: locale.toLowerCase() };
        expect(() => articleLoader(args({ ...params, slug: oldSlug }))).toThrow(
          expect.objectContaining({ status: 404 }),
        );
        const articleData = articleLoader(args({ ...params, slug }));
        expect(articleData.article.title).toBe(title);
        expect(articleData.useCase?.slug).toBe(useCaseSlug);
      }
    },
  );

  it("links an article to its use-case page", async () => {
    const actual = await vi.importActual<
      typeof import("../../../lib/campaign-content.server")
    >("../../../lib/campaign-content.server");
    const content = actual.loadCampaignContent();
    vi.mocked(loadCampaignContent).mockReturnValue(content);
    const page = content.useCases.find(
      (item) => item.slug === "ai-meeting-notes",
    );
    if (!page) throw new Error("Expected the ai-meeting-notes page");
    const data = articleLoader(
      args({ slug: "how-to-use-ai-to-take-meeting-notes" }),
    );
    expect(data.useCase).toEqual({ slug: page.slug, title: page.title });
  });

  it.each(DOCS_LOCALES)(
    "SSR renders real article topics, counts and preserved screenshots for %s",
    async (locale) => {
      currentLocale.locale = locale;
      const actual = await vi.importActual<
        typeof import("../../../lib/campaign-content.server")
      >("../../../lib/campaign-content.server");
      const { articles } = actual.loadCampaignContent();
      const document = dom(
        markup(<ArticlesList articles={articles} page={1} hasMore={false} />),
      );
      expect(
        [...document.querySelectorAll("li .campaign-label")].map(
          (node) => node.textContent,
        ),
      ).toEqual([
        "2 articles",
        "3 articles",
        "2 articles",
        "2 articles",
        "1 article",
        "1 article",
      ]);
      expect(
        [...document.querySelectorAll("article .campaign-label")].map(
          (node) => node.textContent,
        ),
      ).toEqual(articles.map((item) => ARTICLE_TOPICS[item.topic].name));
      const expectedApps = [
        null,
        "plan",
        "slides",
        "design",
        "clips",
        null,
        "design",
        "clips",
        "plan",
        "analytics",
        "clips",
      ] as const;
      expect(articles).toHaveLength(expectedApps.length);
      for (const [index, item] of articles.entries()) {
        const screenshot = dom(markup(<CampaignScreenshot item={item} />));
        const app = expectedApps[index];
        if (app === null) {
          expect(screenshot.querySelector("figure, img"), item.slug).toBeNull();
        } else {
          expect(
            screenshot.querySelector(".theme-img-dark")?.getAttribute("src"),
            item.slug,
          ).toBe(TEMPLATE_SCREENSHOTS[app].dark);
          expect(
            screenshot.querySelector(".theme-img-light")?.getAttribute("src"),
            item.slug,
          ).toBe(TEMPLATE_SCREENSHOTS[app].light);
        }
      }
      expect(CATEGORY_NAMES.content).toBe("Content");
      expect(CATEGORY_NAMES.clips).toBe("Clips");
    },
  );

  it("redirects localized campaign aliases to their English canonical pages", () => {
    const articles = Array.from({ length: 13 }, (_, index) => ({
      ...article,
      slug: `test-article-${index}`,
    }));
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [useCase],
      articles,
    });

    const aliases = [
      [localizedCampaignRoute0.loader, { locale: "fr-fr" }, "/use-cases/"],
      [
        localizedCampaignRoute1.loader,
        { locale: "fr-fr", slug: useCase.slug },
        `${USE_CASES_BASE}/${useCase.slug}/`,
      ],
      [localizedCampaignRoute2.loader, { locale: "fr-fr" }, "/articles/"],
      [
        localizedCampaignRoute3.loader,
        { locale: "fr-fr", slug: articles[0]!.slug },
        `${ARTICLES_BASE}/${articles[0]!.slug}/`,
      ],
      [
        localizedCampaignRoute4.loader,
        { locale: "fr-fr", category: "clips" },
        "/articles/",
      ],
      [
        localizedCampaignRoute5.loader,
        { locale: "fr-fr", page: "1" },
        "/articles/",
      ],
      [
        localizedCampaignRoute5.loader,
        { locale: "fr-fr", page: "2" },
        "/articles/page/2/",
      ],
      [
        localizedTopicRoute.loader,
        { locale: "fr-fr", topic: article.topic },
        `${ARTICLES_BASE}/topic/${article.topic}/`,
      ],
    ] as const;

    for (const [loader, params, pathname] of aliases) {
      const response = loader(args(params)) as Response;
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe(
        `${pathname}?utm_source=test`,
      );
    }
    // Localized use-case pages render when a translation exists (below).
    expect(Object.keys(localizedCampaignRoute1).sort()).toEqual([
      "default",
      "loader",
      "meta",
    ]);
    for (const alias of [
      localizedCampaignRoute0,
      localizedCampaignRoute2,
      localizedCampaignRoute3,
      localizedCampaignRoute4,
      localizedCampaignRoute5,
      localizedTopicRoute,
    ]) {
      expect(Object.keys(alias)).toEqual(["loader"]);
    }
  });

  it("serves a translated use-case page and redirects languages it lacks", () => {
    const { translations: _translations, ...english } = useCase;
    const german = {
      ...english,
      slug: "translated-page",
      app: "slides" as const,
      title: "Auf Deutsch",
    };
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [
        {
          ...german,
          title: "In English",
          translations: { "de-DE": german },
        },
      ],
      articles: [],
    });
    const translated = localizedCampaignRoute1.loader(
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
    const untranslated = localizedCampaignRoute1.loader(
      args({ locale: "fr-fr", slug: "translated-page" }),
    ) as Response;
    expect(untranslated.status).toBe(301);
    expect(untranslated.headers.get("Location")).toBe(
      "/use-cases/translated-page/?utm_source=test",
    );
  });

  it("returns 404 for invalid localized campaign routes or locale tags", () => {
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [useCase],
      articles: [article],
    });
    const cases = [
      () =>
        localizedCampaignRoute1.loader(
          args({ locale: "fr-fr", slug: "missing-use-case" }),
        ),
      () =>
        localizedCampaignRoute3.loader(
          args({ locale: "fr-fr", slug: "missing-article" }),
        ),
      () =>
        localizedTopicRoute.loader(
          args({ locale: "fr-fr", topic: "missing-topic" }),
        ),
      () =>
        localizedCampaignRoute5.loader(args({ locale: "fr-fr", page: "0" })),
      () =>
        localizedCampaignRoute5.loader(args({ locale: "fr-fr", page: "2" })),
      () => localizedCampaignRoute0.loader(args({ locale: "xx-xx" })),
    ];
    for (const load of cases)
      expect(load).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("resolves catalog placeholders in index meta descriptions", () => {
    const descriptions = [campaignRoute0.meta(), campaignRoute2.meta()].map(
      (meta) => meta.find((tag) => "name" in tag && tag.name === "description"),
    );
    expect(descriptions).toEqual([
      {
        name: "description",
        content:
          "Pick the job you do again and again, or browse the articles for templates and how-tos.",
      },
      {
        name: "description",
        content: expect.not.stringContaining("{{"),
      },
    ]);
  });

  it("uses locale-aware canonicals on indexes, use cases, topics and pagination, with existing unknown-locale fallback", () => {
    const params = { locale: "fr-fr" };
    const cases = [
      [campaignRoute0.meta({ params }), `${USE_CASES_BASE}/`],
      [
        campaignRoute1.meta({
          params,
          loaderData: { page: useCase, locales: ["en-US"] },
        }),
        `${USE_CASES_BASE}/${useCase.slug}/`,
      ],
      [campaignRoute2.meta({ params }), `${ARTICLES_BASE}/`],
      [
        topicRoute.meta({
          params,
          loaderData: {
            articles: [],
            topic: article.topic,
            topics: getArticleTopics([article]),
            page: 1,
            hasMore: false,
          },
        }),
        `${ARTICLES_BASE}/topic/${article.topic}/`,
      ],
      [
        campaignRoute5.meta({
          params,
          loaderData: { articles: [], topics: [], page: 2, hasMore: false },
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
    expect(campaignRoute0.meta({ params: { locale: "unknown" } })).toEqual(
      campaignRoute0.meta(),
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

  it("does not invent screenshot or inline CTA markers", () => {
    const document = dom(
      markup(
        <ArticlePage
          article={{ ...article, body: "Test plain paragraph." }}
          useCase={null}
          more={[]}
        />,
      ),
    );
    expect(document.querySelectorAll("figure")).toHaveLength(0);
    expect(
      document.querySelectorAll('a[href^="https://example.com/app"]'),
    ).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Part of:");
  });

  it("keeps public markdown autolinks and code while excluding private frontmatter and raw HTML", () => {
    const body =
      "---\naudience: PRIVATE\ninternal: PRIVATE\n---\n\n<https://example.com>\n\n```html\n<div>Test code</div>\n```\n\n<script>alert(1)</script>";
    expect(sanitizedMarkdown(body)).toBe(
      "\n<https://example.com>\n\n```html\n<div>Test code</div>\n```\n\n",
    );
    expect(
      parseArticle(article.body).faqs.map(({ q, a }) => ({ q, a })),
    ).toEqual([
      { q: "Test FAQ one?", a: "Test answer one." },
      { q: "Test FAQ two?", a: "Test answer two." },
    ]);
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("//example.com")).toBeUndefined();
    expect(safeHref("/articles/test-article")).toBe("/articles/test-article");
  });
});
