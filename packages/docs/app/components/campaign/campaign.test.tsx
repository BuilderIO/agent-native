import { trackEvent } from "@agent-native/core/client/analytics";
import { cleanup, fireEvent, render } from "@testing-library/react";
// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, type LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import * as campaignRoute1 from "../../routes/use-cases.$slug";
import { loader as useCaseLoader } from "../../routes/use-cases.$slug";
import * as campaignRoute0 from "../../routes/use-cases._index";
import { DOCS_LOCALES, sitePathForLocale } from "../docs-locale";
import { TEMPLATE_SCREENSHOTS } from "../template-screenshots";
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
  category: "clips",
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
function markup(node: React.ReactNode) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SnackbarProvider>{node}</SnackbarProvider>
    </MemoryRouter>,
  );
}
function dom(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("public campaign frontend", () => {
  const stack = {
    heading: "Test tools you use today",
    items: [
      {
        tool: "Test recorder + editor",
        used_for: "Capture & trim <clips>",
        breaks: "Copy/paste loses the original context.",
      },
      {
        tool: "Test notes",
        used_for: "Save the exact wording.",
        breaks: "The agent cannot see the source.",
      },
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
    const table = document.querySelector("table")!;
    expect(table).not.toBeNull();
    const section = table.closest("section")!;
    expect(section.querySelector("h2")?.textContent).toBe(stack.heading);
    expect(section.textContent).toContain("What it replaces");
    expect(
      [...table.querySelectorAll("th")].map((cell) => cell.textContent),
    ).toEqual(["What you use", "For", "Where it breaks"]);
    expect(
      [...table.querySelectorAll("th")].every(
        (cell) => cell.getAttribute("scope") === "col",
      ),
    ).toBe(true);
    expect(
      [...table.querySelectorAll("tbody tr")].map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent),
      ),
    ).toEqual(
      stack.items.map(({ tool, used_for, breaks }) => [tool, used_for, breaks]),
    );
    expect(section.querySelectorAll(":scope > p")).toHaveLength(1);
    expect(section.querySelector(":scope > p")?.textContent).toBe(stack.in_app);
    expect(table.parentElement?.classList.contains("overflow-x-auto")).toBe(
      true,
    );
    expect(table.parentElement?.classList.contains("docs-content")).toBe(true);
    expect(
      section.previousElementSibling?.querySelector("#how-it-works"),
    ).not.toBeNull();
    expect(section.nextElementSibling?.tagName).toBe("FIGURE");
    expect(
      section.nextElementSibling?.nextElementSibling?.textContent,
    ).toContain("Test question one?");
    expect(document.querySelector("time")).toBeNull();
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
        items: stack.items.map((item) => ({ ...item, internal: "PRIVATE" })),
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
    "adds only the articles word link below the existing intro for %s",
    (locale) => {
      currentLocale.locale = locale;
      const document = dom(markup(<UseCasesIndex items={[useCase]} />));
      const intro = [...document.querySelectorAll("p")].find(
        (node) => node.textContent === enUS.campaign.useCasesIntro,
      )!;
      const browse = intro.parentElement!.nextElementSibling!;
      expect(browse.textContent).toBe(
        "Or browse the articles for templates and how-tos.",
      );
      expect(browse.querySelectorAll("a")).toHaveLength(1);
      const link = browse.querySelector("a")!;
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
      categoryLoader(args({ category: "clips" })),
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
        expect(row.classList.contains("sm:grid-cols-[7rem_1fr]")).toBe(true);
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
        <ArticlesList articles={[article]} page={1} hasMore={false} />,
        categories.length + 1,
      ],
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
      expect(
        [...grid.children].every(
          (node) => node.tagName === "A" && node.querySelector("h3"),
        ),
      ).toBe(true);
    }
  });
  it("hydrates tracking parameters only on the client and emits only allowed campaign fields", () => {
    window.history.replaceState(
      null,
      "",
      "/?utm_source=test&utm_content=existing&audience=PRIVATE&internal=PRIVATE",
    );
    const caseView = render(
      <>
        <CampaignView item={useCase} />
        <CampaignCta item={useCase} location="hero" />
      </>,
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
    });
    expect(trackEvent).toHaveBeenCalledWith("use_case_cta_click", {
      slug: "test-job",
      job_id: "test-job",
      app: "clips",
      location: "hero",
    });
    caseView.unmount();
    const articleView = render(
      <>
        <CampaignView item={article} />
        <CampaignCta item={article} location="inline" />
      </>,
    );
    const articleLink = articleView.getByRole("link", { name: "Test app" });
    articleLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(articleLink);
    expect(trackEvent).toHaveBeenCalledWith("article_view", {
      slug: "test-article",
      use_case: "test-job",
      job_id: "test-job",
      category: "clips",
    });
    expect(trackEvent).toHaveBeenCalledWith("article_cta_click", {
      slug: "test-article",
      use_case: "test-job",
      job_id: "test-job",
      category: "clips",
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
      category: "clips" as const,
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
    const second = pageLoader(args({ page: "2" }));
    expect(second.articles.map((item) => item.slug)).toEqual([
      "test-1",
      "test-0",
    ]);
    expect(second.hasMore).toBe(false);
    for (const page of ["0", "-1", "2.5", "2abc", "3", "99999999999999999"]) {
      try {
        pageLoader(args({ page }));
        throw new Error("Expected page rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(Response);
        expect((error as Response).status).toBe(404);
      }
    }
    expect(categoryLoader(args({ category: "clips" })).articles).toHaveLength(
      14,
    );
    expect(() => categoryLoader(args({ category: "plan" }))).toThrow();
    expect(() => articleLoader(args({ slug: "absent" }))).toThrow();
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
      category: "clips" as const,
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
      related_resources: [
        { label: "Test link", url: "/docs", internal: "PRIVATE" },
      ],
    };
    const projectedCase = publicUseCase(contaminatedCase);
    const projectedArticle = publicArticle(contaminatedArticle);
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

  it("renders All articles and related-card category, title and full metadata", () => {
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
    expect(card.querySelector("h3")?.textContent).toBe(
      `${CATEGORY_NAMES[related.category]}${related.title}`,
    );
    expect(card.textContent).toContain(related.meta_description);
    expect(
      page.querySelector(
        `a[href="${sitePathForLocale(`${USE_CASES_BASE}/${useCase.slug}`)}"]`,
      )?.textContent,
    ).toBe(useCase.title);
  });

  it("renders six All topics cards without a duplicate Articles eyebrow", () => {
    currentLocale.locale = "fr-FR";
    const document = dom(
      markup(<ArticlesList articles={[article]} page={1} hasMore={false} />),
    );
    const header = document.querySelector("h1")!.parentElement!;
    expect(header.textContent).toBe(
      `${enUS.campaign.articles}${enUS.campaign.articlesIntro}`,
    );
    const topics = [...document.querySelectorAll("section")].find(
      (section) => section.querySelector("h2")?.textContent === "All topics",
    )!;
    const cards = [...topics.querySelectorAll("a")];
    expect(cards).toHaveLength(6);
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual([
      ...categories.map((category) => CATEGORY_NAMES[category]),
      "Use cases",
    ]);
    expect(cards[5].getAttribute("href")).toBe(
      sitePathForLocale(USE_CASES_BASE, "fr-FR"),
    );
    expect(cards[5].querySelector("h3 + div")?.textContent).toBe(
      "Pages for recurring jobs, by app",
    );
    const category = dom(
      markup(
        <ArticlesList
          articles={[article]}
          category="clips"
          page={1}
          hasMore={false}
        />,
      ),
    );
    expect(category.querySelector("h1")?.textContent).toBe("Clips");
    expect(category.body.textContent).not.toContain("All topics");
  });

  it.each([
    { categories: ["clips", "clips"], heading: "More Clips articles" },
    { categories: ["clips", "design"], heading: "More articles" },
    { categories: ["design"], heading: "More articles" },
  ] as const)(
    "uses '$heading' for recommendations $categories",
    ({ categories, heading }) => {
      const document = dom(
        markup(
          <ArticlePage
            article={article}
            useCase={null}
            more={categories.map((category, index) => ({
              ...article,
              slug: `related-${index}`,
              category,
            }))}
          />,
        ),
      );
      const headings = [...document.querySelectorAll("h2")].map(
        (heading) => heading.textContent,
      );
      expect(headings).toContain(heading);
      expect(headings).not.toContain(
        heading === "More articles" ? "More Clips articles" : "More articles",
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

  it("keeps article closing CTA content aligned in one compact block without changing use-case actions", () => {
    const page = dom(
      markup(<ArticlePage article={article} useCase={null} more={[]} />),
    );
    const band = [...page.querySelectorAll("section")].at(-1)!;
    const content = band.firstElementChild!;
    const stack = content.firstElementChild!;
    expect(content.classList.contains("py-10")).toBe(true);
    expect(content.classList.contains("pb-16")).toBe(false);
    expect(stack.classList.contains("items-start")).toBe(true);
    expect([...stack.children].map((element) => element.tagName)).toEqual([
      "H2",
      "P",
      "A",
    ]);
    expect(stack.querySelector("h2")?.textContent).toBe(
      article.cta_band_heading,
    );
    expect(stack.querySelector("p")?.textContent).toBe(
      article.cta_band_subhead,
    );
    expect(stack.querySelector("a")?.textContent).toBe(article.cta_label);
    expect(band.querySelector(".template-detail-cta-actions")).toBeNull();
    const casePage = dom(markup(<UseCasePage item={useCase} articles={[]} />));
    const caseBand = [...casePage.querySelectorAll("section")].at(-1)!;
    expect(
      caseBand.querySelector(".template-detail-cta-actions"),
    ).not.toBeNull();
    expect(caseBand.children[1].classList.contains("pb-16")).toBe(true);
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

  it.each(categories)(
    "uses existing dark/light %s app screenshots with fixed framing in heroes and inline markers",
    (app) => {
      const appKey = app === "plans" ? "plan" : app;
      for (const item of [
        { ...useCase, app },
        { ...article, category: app },
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
            article={{ ...article, category: app }}
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
            ...categories.map((category) =>
              path(`${ARTICLES_BASE}/category/${category}`),
            ),
          ],
        ],
        [
          3,
          [
            path(ARTICLES_BASE),
            path(`${ARTICLES_BASE}/category/clips`),
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

  it("reexports the existing public route contracts for all six locale aliases", () => {
    for (const [route, localized] of [
      [campaignRoute0, localizedCampaignRoute0],
      [campaignRoute1, localizedCampaignRoute1],
      [campaignRoute2, localizedCampaignRoute2],
      [campaignRoute3, localizedCampaignRoute3],
      [campaignRoute4, localizedCampaignRoute4],
      [campaignRoute5, localizedCampaignRoute5],
    ]) {
      expect(localized.default).toBe(route.default);
      expect(localized.loader).toBe(route.loader);
      expect(localized.meta).toBe(route.meta);
    }
  });

  it("uses locale-aware canonicals on indexes, use cases, categories and pagination, with existing unknown-locale fallback", () => {
    const params = { locale: "fr-fr" };
    const cases = [
      [campaignRoute0.meta({ params }), `${USE_CASES_BASE}/`],
      [
        campaignRoute1.meta({
          params,
          loaderData: { item: useCase, articles: [] },
        }),
        `${USE_CASES_BASE}/${useCase.slug}/`,
      ],
      [campaignRoute2.meta({ params }), `${ARTICLES_BASE}/`],
      [
        campaignRoute4.meta({
          params,
          loaderData: {
            articles: [],
            category: "clips",
            page: 1,
            hasMore: false,
          },
        }),
        `${ARTICLES_BASE}/category/clips/`,
      ],
      [
        campaignRoute5.meta({
          params,
          loaderData: { articles: [], page: 2, hasMore: false },
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
