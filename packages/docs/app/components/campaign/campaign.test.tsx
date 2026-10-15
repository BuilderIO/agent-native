import { trackEvent } from "@agent-native/core/client/analytics";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
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
import * as campaignRoute3 from "../../routes/articles.$slug";
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
  publicUseCase,
  safeHref,
  type Article,
  type UseCase,
} from "./public-content";
import { CampaignCta, CampaignScreenshot, CampaignView } from "./shared";
import { UseCasePage, UseCasesIndex } from "./use-cases";

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
      const value = key
        .split(".")
        .reduce<unknown>(
          (value, part) => (value as Record<string, unknown>)[part],
          enUS,
        );
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

const useCase: UseCase = {
  slug: "test-job",
  job_id: "test-job",
  app: "clips",
  title: "Test use case",
  subhead: "Test subhead.",
  meta_description: "Test description.",
  cta_label: "Test app",
  secondary_cta_label: "Test steps",
  app_cta_url: "https://example.com/app",
  screenshot_alt: "Test screenshot",

  old_way: { heading: "Test old heading", body: "Test old body." },
  replaces: ["Test tool A", "Test tool B"],
  story: undefined,
  new_way: {
    heading: "Test new heading",
    steps: ["Test first step.", "Test second step."],
  },
  faqs: [
    { q: "Test question one?", a: "Test answer one." },
    { q: "Test question two?", a: "Test answer two." },
  ],
  cta_band_heading: "Test band",
  cta_band_subhead: "Test band subhead.",
  updated: "2026-01-01",
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
const recipe: NonNullable<UseCase["recipes"]>[number] = {
  id: "test-recipe",
  title: "Test recipe",
  when: "Test when",
  do: "Test action",
  prompt: "  Test prompt\n  ",
  you_get: "Test output",
  save: "Test saved artifact",
  how_often: "Test frequency",
};
const angle: NonNullable<UseCase["angles"]>[number] = {
  id: "engineering",
  audience: "Test engineers",
  title: "Test engineering title",
  subhead: "Test engineering subhead",
  old_way_body: "Test engineering old body",
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
function expectRecipeSlots(
  card: Element,
  recipe: NonNullable<UseCase["recipes"]>[number],
) {
  const slots = [
    ["campaign-recipe-tag", "DIV"],
    ["campaign-recipe-title", "H3"],
    ["campaign-recipe-when", "P"],
    ["campaign-recipe-do", "DL"],
    ...(recipe.prompt ? [["campaign-recipe-prompt", "DIV"]] : []),
    ["campaign-recipe-result", "DL"],
    ...(recipe.save ? [["campaign-recipe-footer", "DL"]] : []),
  ];
  expect([...card.children].map((node) => node.tagName)).toEqual(
    slots.map(([, tag]) => tag),
  );
  for (const [index, [className]] of slots.entries())
    expect(card.children[index].classList.contains(className)).toBe(true);
  expect(card.querySelector(".campaign-recipe-empty")).toBeNull();
  expect(card.querySelector(":scope > [aria-hidden]")).toBeNull();
  expect(
    card.querySelectorAll(":scope > .campaign-recipe-prompt"),
  ).toHaveLength(recipe.prompt ? 1 : 0);
  expect(
    card.querySelectorAll(":scope > .campaign-recipe-footer"),
  ).toHaveLength(recipe.save ? 1 : 0);
}

describe("public campaign frontend", () => {
  const stack = {
    heading: "Test tools you use today",
    items: [
      { text: "**Test recorder + editor** captures & trims <clips>." },
      { text: "**Test notes** save the exact wording, but lose the source." },
    ],
    in_app: "Keep the recording, transcript, and next action in one app.",
  };

  it("SSR renders the verbatim replacement stack between old/new and story/FAQs", () => {
    const document = dom(
      markup(
        <UseCasePage
          item={{
            ...useCase,
            todays_stack: stack,
            story: {
              quote: "Test story",
              name: "Test person",
              role: "Test role",
              used_before: ["Test tool"],
            },
          }}
          articles={[]}
        />,
      ),
    );
    const list = [...document.querySelectorAll("section > ul")].find(
      (node) =>
        node.closest("section")?.querySelector("h2")?.textContent ===
        stack.heading,
    )!;
    expect(list).toBeDefined();
    const section = list.closest("section")!;
    expect(section.classList.contains("campaign-stack-section")).toBe(true);
    expect(list.classList.contains("campaign-stack-list")).toBe(true);
    expect(list.classList.contains("list-disc")).toBe(true);
    expect(section.querySelector("h2")?.textContent).toBe(stack.heading);
    expect(section.textContent).toContain("What it replaces");
    expect(document.querySelector("table, thead, tbody, th, td")).toBeNull();
    expect([...list.children].map((node) => node.tagName)).toEqual([
      "LI",
      "LI",
    ]);
    expect([...list.children].map((node) => node.textContent)).toEqual(
      stack.items.map(({ text }) => text.replaceAll("**", "")),
    );
    expect(
      [...list.querySelectorAll("strong")].map((node) => node.textContent),
    ).toEqual(["Test recorder + editor", "Test notes"]);
    for (const heading of ["What you use", "For", "Where it breaks"])
      expect(section.textContent).not.toContain(heading);
    expect(section.querySelectorAll(":scope > p")).toHaveLength(1);
    expect(section.querySelector(":scope > p")?.textContent).toBe(stack.in_app);
    for (const panel of [
      document.querySelector("#how-it-works")!,
      [...document.querySelectorAll("h2")]
        .find((node) => node.textContent === useCase.old_way.heading)!
        .closest(".campaign-section")!,
    ]) {
      for (const className of ["flex", "flex-col", "gap-[var(--spacing-6)]"])
        expect(panel.classList.contains(className)).toBe(true);
      expect(
        [...panel.classList].some((name) => name.startsWith("space-y-")),
      ).toBe(false);
    }
    expect(
      section.previousElementSibling?.querySelector("#how-it-works"),
    ).not.toBeNull();
    expect(section.nextElementSibling?.tagName).toBe("FIGURE");
    expect(
      section.nextElementSibling?.nextElementSibling?.textContent,
    ).toContain("Test question one?");
    expect(document.querySelector("time")).toBeNull();
  });

  it("interprets only paired bold spans and keeps all other stack markup literal", () => {
    const literal =
      '<img src=x onerror="alert(1)"> <script>alert(1)</script> <a href="https://example.com">HTML link</a> [Markdown link](javascript:alert(1)) <em>HTML emphasis</em> *emphasis* <code>HTML code</code> `code` <https://example.com> **unterminated';
    const bold =
      "<script>bold is still text</script> [bold link](https://example.com)";
    const document = dom(
      markup(
        <UseCasePage
          item={{
            ...useCase,
            todays_stack: {
              ...stack,
              items: [
                {
                  text: `Before **first** between **${bold}** after ${literal}`,
                },
              ],
            },
          }}
          articles={[]}
        />,
      ),
    );
    const item = document.querySelector("section > ul > li")!;
    expect(item.textContent).toBe(
      `Before first between ${bold} after ${literal}`,
    );
    expect([...item.children].map((node) => node.tagName)).toEqual([
      "STRONG",
      "STRONG",
    ]);
    expect(
      [...item.querySelectorAll("strong")].map((node) => node.textContent),
    ).toEqual(["first", bold]);
    expect(item.querySelector("a, img, script, em, code")).toBeNull();
    expect(item.innerHTML).toContain("&lt;script&gt;");
    expect(item.innerHTML).toContain("&lt;img");
  });

  it("does not invent a replacement section when the optional stack is absent", () => {
    const document = dom(markup(<UseCasePage item={useCase} articles={[]} />));
    expect(document.querySelector("table")).toBeNull();
    expect(document.body.textContent).not.toContain("What it replaces");
  });

  it("allowlists every nested replacement stack field in public loader data", () => {
    const contaminated = {
      ...useCase,
      todays_stack: {
        ...stack,
        internal: "PRIVATE",
        items: stack.items.map((item) => ({
          ...item,
          tool: "PRIVATE-OLD-TOOL",
          used_for: "PRIVATE-OLD-USE",
          breaks: "PRIVATE-OLD-BREAKS",
          unknown: "PRIVATE-UNKNOWN",
          internal: "PRIVATE",
        })),
      },
    };
    expect(publicUseCase(contaminated).todays_stack).toEqual(stack);
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [contaminated],
      articles: [],
    });
    const data = useCaseLoader(args({ slug: useCase.slug }));
    expect(data.item.todays_stack).toEqual(stack);
    expect(JSON.stringify(data)).not.toContain("PRIVATE");
    expect(publicUseCase(useCase).todays_stack).toBeUndefined();
  });

  it.each(DOCS_LOCALES)(
    "SSR renders a single intro paragraph with only articles linked for %s",
    (locale) => {
      currentLocale.locale = locale;
      const document = dom(markup(<UseCasesIndex items={[useCase]} />));
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
    "uses the actual updated date with published fallback (%s) without changing JSON-LD dates",
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
        `Updated ${new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(date))}`,
      );
      const schema = JSON.parse(
        document.querySelector('script[type="application/ld+json"]')!
          .textContent!,
      );
      expect(schema.datePublished).toBe(article.published);
      expect(schema.dateModified).toBe(date);
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
      useCaseLoader(args({ slug: useCase.slug })).articles.map(
        (item) => item.slug,
      ),
    ).toEqual(expected);
    expect(
      articleLoader(args({ slug: fixtures[0].slug })).more.map(
        (item) => item.slug,
      ),
    ).toEqual(expected.slice(0, 2));
  });

  it("renders only real cards in incomplete use-case, topic, go-deeper and more-article grids", () => {
    const pages = [
      [<UseCasesIndex items={[useCase]} />, 1],
      [<UseCasePage item={useCase} articles={[article]} />, 1],
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
    const caseView = renderCampaign(
      <>
        <CampaignView item={useCase} />
        <CampaignCta item={useCase} location="hero" />
      </>,
      entry,
    );
    const link = caseView.getByRole("link", { name: "Test app" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.searchParams.get("job")).toBe("test-job");
    expect(url.searchParams.get("utm_source")).toBe("test");
    expect(url.searchParams.get("utm_content")).toBe("existing");
    expect(url.searchParams.has("audience")).toBe(false);
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(trackEvent).toHaveBeenCalledWith("use_case_view", {
      slug: "test-job",
      job_id: "test-job",
      app: "clips",
      angle: "base",
    });
    expect(trackEvent).toHaveBeenCalledWith("use_case_cta_click", {
      slug: "test-job",
      job_id: "test-job",
      app: "clips",
      location: "hero",
      angle: "base",
    });
    caseView.unmount();
    const articleView = renderCampaign(
      <>
        <CampaignView item={article} />
        <CampaignCta item={article} location="inline" />
      </>,
      entry,
    );
    const articleLink = articleView.getByRole("link", { name: "Test app" });
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
        for (const loader of [categoryLoader, localizedCampaignRoute4.loader]) {
          const response = loader(args(params));
          expect(response.status).toBe(301);
          expect(response.headers.get("Location")).toBe(
            sitePathForLocale(ARTICLES_BASE, locale),
          );
        }
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
    vi.mocked(loadCampaignContent).mockReturnValue({ useCases: [], articles });
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
      pageLoader(args({ page: "1" })),
      topicLoader(args({ topic: article.topic })),
    ]) {
      expect(JSON.stringify(list)).not.toContain("PRIVATE");
      for (const item of list.articles)
        expect(item).not.toHaveProperty("category");
    }
    expect(
      JSON.stringify(useCaseLoader(args({ slug: useCase.slug }))),
    ).not.toContain("PRIVATE");
    const metadata = articleMeta({ loaderData: data });
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
  it("projects only the declared public fields including nested values", () => {
    const contaminatedCase = {
      ...useCase,
      audience: "PRIVATE",
      internal: "PRIVATE",
      old_way: { ...useCase.old_way, internal: "PRIVATE" },
    };
    const contaminatedArticle = {
      ...article,
      audience: "PRIVATE",
      internal: "PRIVATE",
      category: "PRIVATE-LEGACY",
      related_resources: [
        { label: "Test link", url: "/docs", internal: "PRIVATE" },
      ],
    };
    const projectedCase = publicUseCase(contaminatedCase);
    const projectedArticle = publicArticle(contaminatedArticle);
    expect(projectedArticle.topic).toBe(article.topic);
    expect(projectedArticle.apps).toEqual(article.apps);
    expect(projectedArticle).not.toHaveProperty("category");
    expect(JSON.stringify([projectedCase, projectedArticle])).not.toContain(
      "PRIVATE",
    );
  });

  it("SSR renders every use-case answer and exactly matching FAQ schema", () => {
    const document = dom(markup(<UseCasePage item={useCase} articles={[]} />));
    const schemas = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ].map((node) => JSON.parse(node.textContent!));
    expect(schemas[0]).toMatchObject({
      "@type": "WebPage",
      name: useCase.title,
      dateModified: useCase.updated,
    });
    expect(
      schemas[1].mainEntity.map(
        (entry: { name: string; acceptedAnswer: { text: string } }) => ({
          q: entry.name,
          a: entry.acceptedAnswer.text,
        }),
      ),
    ).toEqual(useCase.faqs);
    for (const { q, a } of useCase.faqs) {
      expect(document.body.textContent).toContain(q);
      expect(document.body.textContent).toContain(a);
    }
    expect(document.querySelector("#how-it-works ol")?.textContent).toBe(
      "Test first step.Test second step.",
    );
    expect(document.querySelector(".theme-img-dark")?.getAttribute("src")).toBe(
      TEMPLATE_SCREENSHOTS.clips.dark,
    );
    expect(document.body.textContent).not.toContain("Go deeper");
    const cta = document.querySelector('a[href^="https://example.com/app"]')!;
    expect(new URL(cta.getAttribute("href")!).searchParams.get("job")).toBe(
      "test-job",
    );
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

  it("SSR renders identical compact left-aligned closing CTA blocks for articles and use cases", () => {
    const pages = [
      [<ArticlePage article={article} useCase={null} more={[]} />, article],
      [<UseCasePage item={useCase} articles={[]} />, useCase],
    ] as const;
    const bands = pages.map(([page, item]) => {
      const document = dom(markup(page));
      const band = [...document.querySelectorAll("section")].at(-1)!;
      const content = band.firstElementChild!;
      const stack = content.firstElementChild!;
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
      expect(stack.children[0].querySelector("h2")?.textContent).toBe(
        item.cta_band_heading,
      );
      expect(stack.children[1].textContent).toBe(item.cta_band_subhead);
      expect(stack.children[2].textContent).toBe(item.cta_label);
      expect(band.querySelectorAll("a")).toHaveLength(1);
      expect(band.querySelector(".template-detail-cta-actions")).toBeNull();
      return band;
    });
    expect(bands[0].outerHTML).toBe(bands[1].outerHTML);
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
    "uses existing dark/light %s app screenshots with fixed framing in heroes and inline markers",
    (app) => {
      const appKey = app === "plans" ? "plan" : app;
      for (const item of [
        { ...useCase, app },
        { ...article, apps: [app] },
      ]) {
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
        <UseCasesIndex items={[useCase]} />,
        <UseCasePage item={useCase} articles={[article]} />,
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
        [1, [path(`${ARTICLES_BASE}/${article.slug}`)]],
        [
          2,
          [
            path(`${ARTICLES_BASE}/${article.slug}`),
            path(`${ARTICLES_BASE}/page/2`),
            path(USE_CASES_BASE),
            path(`${ARTICLES_BASE}/topic/${article.topic}`),
          ],
        ],
        [
          3,
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
            documents[index].querySelector(`a[href="${href}"]`),
            `surface ${index}: ${href}`,
          ).not.toBeNull();
      }
      expect(documents[3].querySelector("nav a:last-child")?.textContent).toBe(
        ARTICLE_TOPICS[article.topic].name,
      );
      expect(
        documents[3].querySelector("nav a:last-child")?.getAttribute("href"),
      ).toBe(path(`${ARTICLES_BASE}/topic/${article.topic}`));
      expect(documents[3].querySelector("h1")?.textContent).toBe(article.title);
      expect(documents[3].body.textContent).toContain("Test final paragraph.");
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
    },
  );

  it("projects all new workflow fields and strips nested private data from the item and next-job loader data", () => {
    const fields = {
      recipes: [recipe],
      connects_to: ["Test calendar"],
      next_jobs: ["test-next"],
      frequency: "weekly" as const,
      how_often_label: "Every week",
      roles: ["engineering" as const],
      angles: [angle],
    };
    const contaminated = {
      ...useCase,
      ...fields,
      internal: "PRIVATE",
      recipes: [{ ...recipe, internal: "PRIVATE", audience: "PRIVATE" }],
      angles: [{ ...angle, internal: "PRIVATE", strategy: "PRIVATE" }],
    };
    const next = {
      ...contaminated,
      slug: "test-next",
      job_id: "test-next-job",
    };
    expect(publicUseCase(contaminated)).toMatchObject(fields);
    expect(publicUseCase(contaminated).recipes).toEqual([recipe]);
    expect(publicUseCase(contaminated).angles).toEqual([angle]);
    expect(JSON.stringify(publicUseCase(contaminated))).not.toContain(
      "PRIVATE",
    );
    vi.mocked(loadCampaignContent).mockReturnValue({
      useCases: [contaminated, next, { ...useCase, slug: "unrelated" }],
      articles: [],
    });
    const data = useCaseLoader(args({ slug: useCase.slug }));
    expect(data.item).toEqual(publicUseCase(contaminated));
    expect(data.useCases).toEqual([publicUseCase(next)]);
    expect(JSON.stringify(data)).not.toContain("PRIVATE");
    for (const field of Object.keys(fields)) {
      expect(publicUseCase(useCase)[field as keyof UseCase]).toBeUndefined();
    }
  });

  it.each([
    { query: "engineering", expected: angle },
    { query: "unknown", expected: undefined },
    { query: undefined, expected: undefined },
  ])(
    "SSR selects angle $query while keeping base metadata, schema and canonical",
    ({ query, expected }) => {
      const item = { ...useCase, angles: [angle] };
      vi.mocked(loadCampaignContent).mockReturnValue({
        useCases: [item],
        articles: [],
      });
      const entry = `/use-cases/${item.slug}?utm_source=router&utm_source=second&utm_content=visitor&gclid=click&internal=PRIVATE${query ? `&angle=${query}` : ""}`;
      const data = useCaseLoader({
        ...args({ slug: item.slug }),
        request: new Request(`https://example.com${entry}`),
      });
      window.history.replaceState(null, "", "/?utm_source=window&angle=window");
      const document = dom(markup(<UseCasePage {...data} />, entry));
      expect(document.querySelector("h1")?.textContent).toBe(
        expected?.title ?? item.title,
      );
      expect(document.body.textContent).toContain(
        expected?.subhead ?? item.subhead,
      );
      expect(document.body.textContent).toContain(
        expected?.old_way_body ?? item.old_way.body,
      );
      if (expected) {
        expect(document.body.textContent).not.toContain(item.subhead);
        expect(document.body.textContent).not.toContain(item.old_way.body);
      } else {
        expect(document.body.textContent).not.toContain(angle.subhead);
        expect(document.body.textContent).not.toContain(angle.old_way_body);
      }
      const schema = JSON.parse(
        document.querySelector('script[type="application/ld+json"]')!
          .textContent!,
      );
      expect(schema).toMatchObject({
        name: item.title,
        description: item.meta_description,
      });
      const meta = campaignRoute1.meta({ loaderData: data });
      expect(meta).toContainEqual({ title: `${item.title} | Agent-Native` });
      expect(meta).toContainEqual({
        name: "description",
        content: item.meta_description,
      });
      expect(meta).toContainEqual({
        tagName: "link",
        rel: "canonical",
        href: `https://www.agent-native.com/use-cases/${item.slug}/`,
      });
      expect(meta).toContainEqual({
        property: "og:title",
        content: item.title,
      });
      const ctas = document.querySelectorAll(
        'a[href^="https://example.com/app"]',
      );
      expect(ctas).toHaveLength(2);
      for (const cta of ctas) {
        const params = new URL(cta.getAttribute("href")!).searchParams;
        expect(params.get("job")).toBe(item.job_id);
        expect(params.get("angle")).toBe(expected?.id ?? null);
        expect(params.getAll("utm_source")).toEqual(["router", "second"]);
        expect(params.get("utm_content")).toBe("visitor");
        expect(params.get("gclid")).toBe("click");
        expect(params.has("internal")).toBe(false);
      }
      expect(trackEvent).not.toHaveBeenCalled();
    },
  );

  it("falls back to the base old-way body when a valid angle omits its optional override", () => {
    const { old_way_body: _body, ...minimalAngle } = angle;
    const document = dom(
      markup(
        <UseCasePage
          item={{ ...useCase, angles: [minimalAngle] }}
          articles={[]}
        />,
        "/?angle=engineering",
      ),
    );
    expect(document.querySelector("h1")?.textContent).toBe(angle.title);
    expect(document.body.textContent).toContain(angle.subhead);
    expect(document.body.textContent).toContain(useCase.old_way.body);
  });

  it.each(["engineering", "unknown", ""])(
    "tracks only a validated angle or base for views and CTA clicks (%s)",
    (query) => {
      const item = { ...useCase, angles: [angle] };
      const view = renderCampaign(
        <>
          <CampaignView item={item} />
          <CampaignCta item={item} location="hero" />
        </>,
        `/?angle=${query}&audience=PRIVATE`,
      );
      const link = view.getByRole("link", { name: item.cta_label });
      link.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(link);
      const selected = query === angle.id ? angle.id : "base";
      expect(trackEvent).toHaveBeenCalledTimes(2);
      expect(trackEvent).toHaveBeenNthCalledWith(1, "use_case_view", {
        slug: item.slug,
        job_id: item.job_id,
        app: item.app,
        angle: selected,
      });
      expect(trackEvent).toHaveBeenNthCalledWith(2, "use_case_cta_click", {
        slug: item.slug,
        job_id: item.job_id,
        app: item.app,
        angle: selected,
        location: "hero",
      });
      expect(
        new URL(link.getAttribute("href")!).searchParams.get("angle"),
      ).toBe(selected === "base" ? null : selected);
      expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain(
        "PRIVATE",
      );
    },
  );

  it("renders ordered recipes with optional prompt/save and connections without inventing absent sections", () => {
    const { prompt: _prompt, save: _save, ...minimalRecipe } = recipe;
    const second = { ...minimalRecipe, id: "second", title: "Second recipe" };
    const document = dom(
      markup(
        <UseCasePage
          item={{
            ...useCase,
            recipes: [recipe, second],
            connects_to: ["Test calendar", "Test CRM"],
          }}
          articles={[]}
        />,
      ),
    );
    const grid = document.querySelector("section .campaign-recipes-grid")!;
    for (const className of ["grid", "md:grid-cols-2", "lg:grid-cols-3"])
      expect(grid.classList.contains(className)).toBe(true);
    const recipes = [...grid.querySelectorAll(":scope > article")];
    expect(
      recipes.map((node) => node.querySelector("h3")?.textContent),
    ).toEqual([recipe.title, second.title]);
    for (const [index, item] of [recipe, second].entries()) {
      const card = recipes[index];
      expect(card.classList.contains("campaign-recipe-card")).toBe(true);
      expectRecipeSlots(card, item);
      const [tag, title, when, action] = [...card.children];
      const output = card.querySelector(":scope > .campaign-recipe-result")!;
      expect(
        tag
          .querySelector(".campaign-frequency-tag")
          ?.getAttribute("aria-label"),
      ).toBe(`How often: ${item.how_often}`);
      expect(title.textContent).toBe(item.title);
      expect(when.textContent).toBe(item.when);
      expect(when.classList.contains("campaign-body")).toBe(true);
      expect(action.querySelector("dt")?.textContent).toBe("Do");
      expect(action.querySelector("dd")?.textContent).toBe(item.do);
      expect(output.querySelector("dt")?.textContent).toBe("You get");
      expect(output.querySelector("dd")?.textContent).toBe(item.you_get);
      expect(
        [...card.querySelectorAll("dt")].map((node) => node.textContent),
      ).toEqual(
        index === 0
          ? ["Do", "You get", "Save for next time"]
          : ["Do", "You get"],
      );
      expect(card.textContent).not.toMatch(/How often|When/);
    }
    const footer = recipes[0].lastElementChild!;
    expect(footer.classList.contains("border-t")).toBe(true);
    expect(footer.querySelector("dt")?.textContent).toBe("Save for next time");
    expect(footer.querySelector("dd")?.textContent).toBe(recipe.save);
    expect(recipes[0].querySelector("pre code")?.textContent).toBe(
      recipe.prompt!.trim(),
    );
    expect(recipes[0].children).toHaveLength(7);
    expect(recipes[1].children).toHaveLength(5);
    expect(
      recipes[1].querySelector("pre, code, button, .code-block"),
    ).toBeNull();
    expect(recipes[1].textContent).not.toContain("Save for next time");
    expect(recipes[1].textContent).not.toContain(recipe.save);
    expect(document.querySelector("#how-it-works")?.textContent).toContain(
      "Works with: Test calendar, Test CRM",
    );
    const absent = dom(
      markup(
        <UseCasePage
          item={{
            ...useCase,
            recipes: [],
            connects_to: [],
            next_jobs: ["unknown"],
          }}
          articles={[]}
        />,
      ),
    );
    expect(absent.querySelectorAll("article")).toHaveLength(0);
    expect(absent.body.textContent).not.toContain("Ways to use");
    expect(absent.body.textContent).not.toContain("Works with:");
    expect(absent.body.textContent).not.toContain("What to do next");
  });

  it.each([
    { prompt: recipe.prompt, save: undefined },
    { prompt: undefined, save: recipe.save },
    { prompt: recipe.prompt, save: recipe.save },
    { prompt: undefined, save: undefined },
  ])(
    "renders recipe prompt and saved artifact independently (%#)",
    ({ prompt, save }) => {
      const document = dom(
        markup(
          <UseCasePage
            item={{ ...useCase, recipes: [{ ...recipe, prompt, save }] }}
            articles={[]}
          />,
        ),
      );
      const rendered = document.querySelector("article")!;
      expect(rendered.querySelectorAll(".code-block")).toHaveLength(
        prompt ? 1 : 0,
      );
      expect(
        [...rendered.querySelectorAll("dt")].map((node) => node.textContent),
      ).toEqual(
        save ? ["Do", "You get", "Save for next time"] : ["Do", "You get"],
      );
      expect(rendered.querySelector("h3 + p")?.textContent).toBe(recipe.when);
      expect(
        rendered.querySelector(".campaign-frequency-tag")?.textContent,
      ).toBe(recipe.how_often);
      expectRecipeSlots(rendered, { ...recipe, prompt, save });
      expect(rendered.children).toHaveLength(
        5 + Number(!!prompt) + Number(!!save),
      );
      if (prompt) {
        expect(
          rendered.querySelector(".campaign-recipe-prompt pre code")
            ?.textContent,
        ).toBe(prompt.trim());
      } else {
        expect(rendered.querySelector("pre, code, button")).toBeNull();
      }
      const footer = rendered.querySelector(":scope > .campaign-recipe-footer");
      if (save) {
        expect(footer?.classList.contains("border-t")).toBe(true);
        expect(footer?.querySelector("dd")?.textContent).toBe(save);
      } else {
        expect(footer).toBeNull();
        expect(rendered.textContent).not.toContain("Save for next time");
        expect(rendered.textContent).not.toContain(recipe.save);
      }
    },
  );

  it.each([true, false])(
    "CodeBlock calls onCopySuccess only after copyText succeeds (%s)",
    async (success) => {
      let resolveCopy!: (value: boolean) => void;
      vi.mocked(copyText).mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve;
        }),
      );
      const onCopySuccess = vi.fn();
      const view = renderCampaign(
        <CodeBlock
          code={recipe.prompt!}
          lang="text"
          onCopySuccess={onCopySuccess}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Copy code" }));
      expect(copyText).toHaveBeenCalledExactlyOnceWith(recipe.prompt!.trim());
      expect(onCopySuccess).not.toHaveBeenCalled();
      expect(trackEvent).not.toHaveBeenCalled();
      await act(async () => {
        resolveCopy(success);
      });
      expect(onCopySuccess).toHaveBeenCalledTimes(success ? 1 : 0);
      if (success)
        expect(trackEvent).toHaveBeenCalledExactlyOnceWith("copy code block", {
          lang: "text",
          snippet: recipe.prompt!.trim(),
        });
      else expect(trackEvent).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "emits recipe_copy only for successful prompt copies (%s)",
    async (success) => {
      vi.mocked(copyText).mockResolvedValue(success);
      const view = renderCampaign(
        <UseCasePage item={{ ...useCase, recipes: [recipe] }} articles={[]} />,
      );
      vi.mocked(trackEvent).mockClear();
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Copy code" }));
      });
      expect(copyText).toHaveBeenCalledExactlyOnceWith(recipe.prompt!.trim());
      const recipeEvents = vi
        .mocked(trackEvent)
        .mock.calls.filter(([name]) => name === "recipe_copy");
      expect(recipeEvents).toEqual(
        success
          ? [
              [
                "recipe_copy",
                {
                  slug: useCase.slug,
                  job_id: useCase.job_id,
                  recipe_id: recipe.id,
                },
              ],
            ]
          : [],
      );
      if (!success) expect(trackEvent).not.toHaveBeenCalled();
    },
  );

  it("SSR uses the same accessible clock tag above index titles, in the hero and atop recipes", () => {
    const item = {
      ...useCase,
      how_often_label: "Every week",
      recipes: [recipe],
    };
    const index = dom(
      markup(
        <UseCasesIndex items={[item, { ...useCase, slug: "untagged" }]} />,
      ),
    );
    const page = dom(markup(<UseCasePage item={item} articles={[]} />));
    const card = index.querySelector(".grid a")!;
    const indexTag = card.querySelector(".campaign-frequency-tag")!;
    const pageTags = [...page.querySelectorAll(".campaign-frequency-tag")];
    expect(index.querySelectorAll(".campaign-frequency-tag")).toHaveLength(1);
    expect(pageTags).toHaveLength(2);
    const [heroTag, recipeTag] = pageTags;
    for (const [tag, text] of [
      [indexTag, item.how_often_label],
      [heroTag, item.how_often_label],
      [recipeTag, recipe.how_often],
    ] as const) {
      expect(tag.tagName).toBe("SPAN");
      expect(tag.textContent).toBe(text);
      expect(tag.getAttribute("aria-label")).toBe(`How often: ${text}`);
      expect(tag.querySelectorAll("svg")).toHaveLength(1);
      const icon = tag.querySelector("svg")!;
      expect(icon.classList.contains("tabler-icon-clock")).toBe(true);
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("width")).toBe("14");
      expect(icon.getAttribute("height")).toBe("14");
    }
    expect(indexTag.outerHTML).toBe(heroTag.outerHTML);
    expect(indexTag.parentElement?.nextElementSibling?.tagName).toBe("H3");
    expect(card.querySelector("h3")?.textContent).toBe(item.title);
    expect(heroTag.closest("article")).toBeNull();
    expect(
      heroTag.compareDocumentPosition(page.querySelector("h1")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(recipeTag.closest("article")?.querySelector("h3")?.textContent).toBe(
      recipe.title,
    );
    expect(recipeTag.parentElement?.nextElementSibling?.textContent).toBe(
      recipe.title,
    );
    const absent = dom(markup(<UseCasePage item={useCase} articles={[]} />));
    expect(absent.querySelector(".campaign-frequency-tag")).toBeNull();
  });

  it("SSR labels Next and Articles sections and keeps next-job and deeper-article descriptions verbatim", () => {
    const next = {
      ...useCase,
      slug: "test-next",
      title: "Test next job",
      subhead: "Test next-job description, kept verbatim.",
    };
    const document = dom(
      markup(
        <UseCasePage
          item={{ ...useCase, next_jobs: [next.slug] }}
          articles={[article]}
          useCases={[next]}
        />,
      ),
    );
    for (const [eyebrow, heading, title, description, href] of [
      [
        "Next",
        "What to do next",
        next.title,
        next.subhead,
        `${USE_CASES_BASE}/${next.slug}`,
      ],
      [
        "Articles",
        "Go deeper",
        article.title,
        article.meta_description,
        `${ARTICLES_BASE}/${article.slug}`,
      ],
    ]) {
      const h2 = [...document.querySelectorAll("h2")].find(
        (node) => node.textContent === heading,
      )!;
      expect(h2.previousElementSibling?.textContent).toBe(eyebrow);
      const section = h2.closest("section")!;
      expect(section.querySelectorAll("h2")).toHaveLength(1);
      expect(
        h2.parentElement?.parentElement?.classList.contains("campaign-section"),
      ).toBe(true);
      const card = section.querySelector("a")!;
      expect(card.getAttribute("href")).toBe(sitePathForLocale(href));
      expect(card.querySelector("h3")?.textContent).toBe(title);
      expect(card.querySelector("h3 + div")?.textContent).toBe(description);
    }
  });

  it("resolves next jobs in declared order, skips unknown jobs, localizes links and tracks clicks", () => {
    currentLocale.locale = "fr-FR";
    const first = { ...useCase, slug: "test-first", title: "First next job" };
    const second = {
      ...useCase,
      slug: "test-second",
      title: "Second next job",
    };
    const view = renderCampaign(
      <UseCasePage
        item={{ ...useCase, next_jobs: [second.slug, "unknown", first.slug] }}
        articles={[]}
        useCases={[first, second, { ...useCase, slug: "unrelated" }]}
      />,
    );
    const heading = view.getByRole("heading", { name: "What to do next" });
    const section = heading.closest("section")!;
    const links = within(section).getAllByRole("link");
    expect(links.map((link) => link.querySelector("h3")?.textContent)).toEqual([
      second.title,
      first.title,
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      [second, first].map((item) =>
        sitePathForLocale(`${USE_CASES_BASE}/${item.slug}`, "fr-FR"),
      ),
    );
    expect(section.textContent).not.toContain("unknown");
    vi.mocked(trackEvent).mockClear();
    links[0].addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(links[0]);
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("next_job_click", {
      from_slug: useCase.slug,
      to_slug: second.slug,
    });
  });

  const filterItems: UseCase[] = [
    {
      ...useCase,
      slug: "engineering-weekly",
      title: "Engineering weekly",
      roles: ["engineering"],
      frequency: "weekly",
      how_often_label: "Every engineering week",
    },
    {
      ...useCase,
      slug: "engineering-daily",
      title: "Engineering daily",
      roles: ["engineering"],
      frequency: "daily",
    },
    {
      ...useCase,
      slug: "everyone-weekly",
      title: "Everyone weekly",
      roles: ["everyone"],
      frequency: "weekly",
    },
    {
      ...useCase,
      slug: "everyone-daily",
      title: "Everyone daily",
      roles: ["everyone"],
      frequency: "daily",
    },
    {
      ...useCase,
      app: "content",
      slug: "marketing-weekly",
      title: "Marketing weekly",
      roles: ["marketing"],
      frequency: "weekly",
    },
    { ...useCase, slug: "untagged", title: "Untagged" },
  ];
  const visibleCardTitles = (view: ReturnType<typeof renderCampaign>) =>
    view.getAllByRole("link").flatMap((link) => {
      const title = link.querySelector("h3")?.textContent;
      return title ? [title] : [];
    });

  it("combines role and frequency, includes everyone, and updates URL selections and filter events", () => {
    const view = renderCampaign(
      <UseCasesIndex items={filterItems} />,
      "/use-cases?role=engineering&often=weekly&utm_source=keep",
    );
    expect(view.getByLabelText("Role").textContent).toBe("Engineering");
    expect(view.getByLabelText("How often").textContent).toBe("Weekly");
    expect(visibleCardTitles(view)).toEqual([
      "Engineering weekly",
      "Everyone weekly",
    ]);
    expect(view.getByText("Every engineering week")).toBeDefined();
    expect(trackEvent).not.toHaveBeenCalled();
    fireEvent.click(view.getByLabelText("How often"));
    fireEvent.click(view.getByRole("option", { name: "Daily" }));
    expect(visibleCardTitles(view)).toEqual([
      "Engineering daily",
      "Everyone daily",
    ]);
    expect(view.getByLabelText("How often").textContent).toBe("Daily");
    expect(view.getByTestId("location").textContent).toBe(
      "/use-cases?role=engineering&often=daily&utm_source=keep",
    );
    expect(trackEvent).toHaveBeenLastCalledWith("index_filter", {
      role: "engineering",
      often: "daily",
    });
    fireEvent.click(view.getByLabelText("Role"));
    fireEvent.click(view.getByRole("option", { name: "Marketing" }));
    expect(visibleCardTitles(view)).toEqual(["Everyone daily"]);
    expect(view.getByTestId("location").textContent).toBe(
      "/use-cases?role=marketing&often=daily&utm_source=keep",
    );
    expect(trackEvent).toHaveBeenLastCalledWith("index_filter", {
      role: "marketing",
      often: "daily",
    });
    fireEvent.click(view.getByLabelText("How often"));
    fireEvent.click(view.getByRole("option", { name: "Weekly" }));
    expect(visibleCardTitles(view)).toEqual([
      "Everyone weekly",
      "Marketing weekly",
    ]);
    expect(trackEvent).toHaveBeenCalledTimes(3);
    expect(trackEvent).toHaveBeenLastCalledWith("index_filter", {
      role: "marketing",
      often: "weekly",
    });
    expect(view.container.querySelectorAll(".grid.gap-px > div")).toHaveLength(
      filterItems.length,
    );
    expect(
      view.container.querySelectorAll(".grid.gap-px > div[hidden]"),
    ).toHaveLength(4);
  });

  it.each([
    {
      search: "role=engineering",
      titles: [
        "Engineering weekly",
        "Engineering daily",
        "Everyone weekly",
        "Everyone daily",
      ],
    },
    {
      search: "often=weekly",
      titles: ["Engineering weekly", "Everyone weekly", "Marketing weekly"],
    },
  ])(
    "applies an individual filter without requiring the other ($search)",
    ({ search, titles }) => {
      const view = renderCampaign(
        <UseCasesIndex items={filterItems} />,
        `/use-cases?${search}`,
      );
      expect(visibleCardTitles(view)).toEqual(titles);
      expect(trackEvent).not.toHaveBeenCalled();
    },
  );

  it("shows an empty state and clears only filter parameters, restoring all cards", async () => {
    const view = renderCampaign(
      <UseCasesIndex items={filterItems} />,
      "/use-cases?role=finance&often=occasional&utm_source=keep",
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
      "Everyone weekly",
      "Everyone daily",
      "Untagged",
      "Marketing weekly",
    ]);
    expect(view.getByLabelText("Role").textContent).toBe("All");
    expect(view.getByLabelText("How often").textContent).toBe("Any");
    expect(view.getByTestId("location").textContent).toBe(
      "/use-cases?utm_source=keep",
    );
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith("index_filter", {
      role: "",
      often: "",
    });
  });

  it("treats unknown role and frequency parameters as unfiltered", () => {
    const view = renderCampaign(
      <UseCasesIndex items={filterItems} />,
      "/use-cases?role=unknown&often=monthly",
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
    expect(view.getByLabelText("How often").textContent).toBe("Any");
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it.each(["engineering", "product", "marketing"] as const)(
    "filters the real dictation use case by its engineering/product roles in the %s UI",
    async (role) => {
      const actual = await vi.importActual<
        typeof import("../../../lib/campaign-content.server")
      >("../../../lib/campaign-content.server");
      const { useCases } = actual.loadCampaignContent();
      const dictation = useCases.find(
        (item) => item.slug === "dictate-instead-of-typing",
      )!;
      expect(dictation).toBeDefined();
      expect(dictation.roles).toEqual(["engineering", "product"]);
      expect(dictation.frequency).toBe("daily");
      const view = renderCampaign(
        <UseCasesIndex items={useCases} />,
        `/use-cases?role=${role}&often=daily`,
      );
      expect(view.getByLabelText("Role").textContent).toBe(
        {
          engineering: "Engineering",
          product: "Product",
          marketing: "Marketing",
        }[role],
      );
      expect(view.getByLabelText("How often").textContent).toBe("Daily");
      const card = view.container.querySelector(
        `a[href="${sitePathForLocale(`${USE_CASES_BASE}/${dictation.slug}`)}"]`,
      )!;
      expect(card.querySelector("h3")?.textContent).toBe(dictation.title);
      expect(card.closest("[hidden]") !== null).toBe(role === "marketing");
      expect(visibleCardTitles(view).includes(dictation.title)).toBe(
        role !== "marketing",
      );
      expect(trackEvent).not.toHaveBeenCalled();
    },
  );

  it("loads both real meeting next jobs and SSR renders their cards in declared order", async () => {
    const actual = await vi.importActual<
      typeof import("../../../lib/campaign-content.server")
    >("../../../lib/campaign-content.server");
    const content = actual.loadCampaignContent();
    vi.mocked(loadCampaignContent).mockReturnValue(content);
    const data = useCaseLoader(args({ slug: "ai-meeting-notes" }));
    const expected = ["crm-and-call-questions", "dictate-instead-of-typing"];
    expect(data.item.next_jobs).toEqual(expected);
    expect(data.useCases.map((item) => item.slug).sort()).toEqual(
      [...expected].sort(),
    );
    const document = dom(markup(<UseCasePage {...data} />));
    const recipes = [...document.querySelectorAll(".campaign-recipe-card")];
    expect(data.item.recipes!.map((recipe) => recipe.prompt)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(data.item.recipes!.map((recipe) => !!recipe.save)).toEqual([
      true,
      false,
      false,
    ]);
    expect(recipes.map((card) => card.children.length)).toEqual([6, 5, 5]);
    expect(document.querySelector(".campaign-recipe-empty")).toBeNull();
    for (const [index, card] of recipes.entries()) {
      expectRecipeSlots(card, data.item.recipes![index]);
      expect(
        card.querySelector(".campaign-recipe-prompt, pre, code, button"),
      ).toBeNull();
    }
    expect(document.querySelectorAll(".campaign-recipe-footer")).toHaveLength(
      1,
    );
    expect(
      recipes[0].querySelector(".campaign-recipe-footer dd")?.textContent,
    ).toBe(data.item.recipes![0].save);
    for (const card of recipes.slice(1))
      expect(card.textContent).not.toContain("Save for next time");
    const section = [...document.querySelectorAll("section")].find(
      (node) => node.querySelector("h2")?.textContent === "What to do next",
    )!;
    const cards = [...section.querySelectorAll("a")];
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(
      expected.map((slug) => sitePathForLocale(`${USE_CASES_BASE}/${slug}`)),
    );
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual(
      expected.map(
        (slug) => content.useCases.find((item) => item.slug === slug)!.title,
      ),
    );
    const crm = useCaseLoader(args({ slug: "crm-and-call-questions" }));
    expect(crm.item.slug).toBe("crm-and-call-questions");
    expect(
      dom(markup(<UseCasePage {...crm} />)).querySelector("h1")?.textContent,
    ).toBe(crm.item.title);
  });

  it("SSR renders all fifteen real replacement lists and only present recipe slots without tables or column headings", async () => {
    const actual = await vi.importActual<
      typeof import("../../../lib/campaign-content.server")
    >("../../../lib/campaign-content.server");
    const { useCases } = actual.loadCampaignContent();
    expect(useCases).toHaveLength(15);
    for (const item of useCases) {
      const document = dom(markup(<UseCasePage item={item} articles={[]} />));
      expect(document.querySelector("table, th, td"), item.slug).toBeNull();
      const stack = item.todays_stack!;
      expect(stack, item.slug).toBeDefined();
      const section = [...document.querySelectorAll("section")].find(
        (node) => node.querySelector("h2")?.textContent === stack.heading,
      )!;
      expect(section.classList.contains("campaign-stack-section")).toBe(true);
      const list = section.querySelector(":scope > ul")!;
      expect(list.classList.contains("campaign-stack-list")).toBe(true);
      expect(list.classList.contains("list-disc")).toBe(true);
      expect(list.nextElementSibling?.tagName).toBe("P");
      expect(section.querySelector(":scope > p")?.textContent).toBe(
        stack.in_app,
      );
      expect(
        [...section.querySelectorAll(":scope > ul > li")].map(
          (node) => node.textContent,
        ),
      ).toEqual(stack.items.map(({ text }) => text.replaceAll("**", "")));
      for (const entry of stack.items)
        expect(Object.keys(entry)).toEqual(["text"]);
      for (const label of ["What you use", "For", "Where it breaks"])
        expect(section.textContent).not.toContain(label);
      const cards = [...document.querySelectorAll(".campaign-recipe-card")];
      expect(cards, item.slug).toHaveLength(3);
      for (const [index, card] of cards.entries()) {
        const recipe = item.recipes![index];
        expectRecipeSlots(card, recipe);
        expect(
          card.children[0].querySelector(".campaign-frequency-tag")
            ?.textContent,
        ).toBe(recipe.how_often);
        expect(card.children[1].textContent).toBe(recipe.title);
        expect(card.children[2].textContent).toBe(recipe.when);
        expect(
          [...card.querySelectorAll("dt")].map((node) => node.textContent),
        ).toEqual(
          recipe.save
            ? ["Do", "You get", "Save for next time"]
            : ["Do", "You get"],
        );
        expect(card.querySelector(".campaign-recipe-do dd")?.textContent).toBe(
          recipe.do,
        );
        expect(
          card.querySelector(".campaign-recipe-result dd")?.textContent,
        ).toBe(recipe.you_get);
        if (recipe.prompt) {
          expect(card.querySelector("pre code")?.textContent).toBe(
            recipe.prompt.trim(),
          );
        } else {
          expect(
            card.querySelector("pre, code, button, .code-block"),
          ).toBeNull();
        }
        if (recipe.save) {
          expect(
            card.querySelector(".campaign-recipe-footer dd")?.textContent,
          ).toBe(recipe.save);
        } else {
          expect(card.textContent).not.toContain("Save for next time");
        }
      }
    }
  });

  it("SSR includes all fifteen real use-case cards despite filters and renders Content screenshots", async () => {
    const actual = await vi.importActual<
      typeof import("../../../lib/campaign-content.server")
    >("../../../lib/campaign-content.server");
    const { useCases } = actual.loadCampaignContent();
    expect(useCases).toHaveLength(15);
    const document = dom(
      markup(
        <UseCasesIndex items={useCases} />,
        "/use-cases?role=engineering&often=daily",
      ),
    );
    const wrappers = [...document.querySelectorAll(".grid.gap-px > div")];
    expect(wrappers).toHaveLength(15);
    expect(document.querySelectorAll("[hidden]")).toHaveLength(0);
    const cards = wrappers.map(
      (wrapper) => wrapper.querySelector(":scope > a")!,
    );
    expect(cards.map((card) => card.getAttribute("href")).sort()).toEqual(
      useCases
        .map((item) => sitePathForLocale(`${USE_CASES_BASE}/${item.slug}`))
        .sort(),
    );
    expect(
      cards.map((card) => card.querySelector("h3")?.textContent).sort(),
    ).toEqual(useCases.map((item) => item.title).sort());
    const content = useCases.find((item) => item.app === "content")!;
    expect(content).toBeDefined();
    const page = dom(markup(<UseCasePage item={content} articles={[]} />));
    expect(page.querySelector(".theme-img-dark")?.getAttribute("src")).toBe(
      TEMPLATE_SCREENSHOTS.content.dark,
    );
    expect(page.querySelector(".theme-img-dark")?.getAttribute("alt")).toBe(
      content.screenshot_alt,
    );
    expect(page.querySelector(".theme-img-light")?.getAttribute("src")).toBe(
      TEMPLATE_SCREENSHOTS.content.light,
    );
    expect(page.querySelectorAll("article")).toHaveLength(3);
    expect(categories).toEqual([
      "clips",
      "design",
      "slides",
      "plans",
      "analytics",
    ]);
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
        null,
        "design",
        "clips",
        "design",
        "plan",
        "analytics",
        "slides",
        "clips",
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

  it("reexports the existing public route contracts for all six locale aliases", () => {
    for (const [route, localized] of [
      [campaignRoute0, localizedCampaignRoute0],
      [campaignRoute1, localizedCampaignRoute1],
      [campaignRoute2, localizedCampaignRoute2],
      [campaignRoute3, localizedCampaignRoute3],
      [topicRoute, localizedTopicRoute],
      [campaignRoute5, localizedCampaignRoute5],
    ]) {
      expect(localized.default).toBe(route.default);
      expect(localized.loader).toBe(route.loader);
      expect(localized.meta).toBe(route.meta);
    }
  });

  it("uses locale-aware canonicals on indexes, use cases, topics and pagination, with existing unknown-locale fallback", () => {
    const params = { locale: "fr-fr" };
    const cases = [
      [campaignRoute0.meta({ params }), `${USE_CASES_BASE}/`],
      [
        campaignRoute1.meta({
          params,
          loaderData: { item: useCase, articles: [], useCases: [] },
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
