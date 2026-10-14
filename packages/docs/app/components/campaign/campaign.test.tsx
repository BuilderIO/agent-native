import { trackEvent } from "@agent-native/core/client/analytics";
import { cleanup, fireEvent, render } from "@testing-library/react";
// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, type LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadCampaignContent } from "../../../lib/campaign-content";
import enUS from "../../i18n/en-US";
import {
  loader as articleLoader,
  meta as articleMeta,
} from "../../routes/articles.$slug";
import { loader as articlesLoader } from "../../routes/articles._index";
import { loader as categoryLoader } from "../../routes/articles.category.$category";
import { loader as pageLoader } from "../../routes/articles.page.$page";
import { loader as useCaseLoader } from "../../routes/use-cases.$slug";
import { SnackbarProvider } from "../website-redesign/ds/snackbar";
import { ArticlePage } from "./articles";
import { parseArticle, sanitizedMarkdown } from "./markdown";
import {
  publicArticle,
  publicUseCase,
  safeHref,
  type Article,
  type UseCase,
} from "./public-content";
import { CampaignCta, CampaignView } from "./shared";
import { UseCasePage } from "./use-cases";

afterEach(() => {
  cleanup();
  vi.mocked(trackEvent).mockClear();
  window.history.replaceState(null, "", "/");
});

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
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
vi.mock("../../../lib/campaign-content", () => ({
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
  screenshot_brief: "Test screenshot brief.",
  old_way: { heading: "Test old heading", body: "Test old body." },
  replaces: ["Test tool A", "Test tool B"],
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
  screenshot_brief: "Test screenshot brief.",
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
      href: "https://www.agent-native.com/articles/test-article",
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
    expect(document.body.textContent).toContain("Screenshot TODO");
    expect(document.body.textContent).toContain(useCase.screenshot_brief);
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
