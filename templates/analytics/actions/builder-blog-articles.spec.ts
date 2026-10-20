import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAnalyticsProviderCredential: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string) => {
    throw new Error(message);
  },
}));

vi.mock("../server/lib/provider-credentials", () => ({
  BUILDER_ANALYTICS_CREDENTIAL_KEYS: ["BUILDER_PUBLIC_KEY"],
  resolveAnalyticsProviderCredential: mocks.resolveAnalyticsProviderCredential,
}));

const { default: builderBlogArticles } =
  await import("./builder-blog-articles");

describe("builder-blog-articles", () => {
  beforeEach(() => {
    mocks.resolveAnalyticsProviderCredential.mockReset();
    mocks.resolveAnalyticsProviderCredential.mockResolvedValue({
      value: "fake-builder-key",
      key: "BUILDER_PUBLIC_KEY",
      provider: "builder",
      source: "analytics_local",
    });
    vi.restoreAllMocks();
  });

  it("fetches only metadata, paginates until requested handles are found, and normalizes dates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "article-1",
                name: "First article",
                createdDate: 1787756652014,
                firstPublished: 1787756659179,
                data: { handle: "first-article", date: 1787767200000 },
              },
              ...Array.from({ length: 99 }, (_, index) => ({
                id: `other-${index}`,
                data: { handle: `other-${index}` },
              })),
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "article-2",
                name: "Second article",
                firstPublished: "2026-08-20T12:00:00Z",
                data: { handle: "second-article" },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = (await builderBlogArticles.run(
      { handles: ["first-article", "second-article"] },
      { userEmail: "ada@example.com", orgId: "org-1" } as any,
    )) as any;

    expect(result.total).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.nextOffset).toBeNull();
    expect(result.articles).toEqual([
      expect.objectContaining({
        id: "article-1",
        handle: "first-article",
        publishDate: "2026-08-26T18:00:00.000Z",
      }),
      expect.objectContaining({
        id: "article-2",
        handle: "second-article",
        publishDate: "2026-08-20T12:00:00.000Z",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(firstUrl.origin + firstUrl.pathname).toBe(
      "https://cdn.builder.io/api/v3/content/blog-article",
    );
    expect(firstUrl.searchParams.get("fields")).toContain("data.handle");
    expect(firstUrl.searchParams.get("fields")).toContain("data.date");
    expect(firstUrl.searchParams.get("limit")).toBe("100");
    expect(firstUrl.searchParams.get("offset")).toBe("0");
  });

  it("resolves the primary author and every credited author in one batched read", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "article-1",
                name: "Co-written",
                data: {
                  handle: "co-written",
                  author: { id: "author-a", model: "blog-author" },
                  authors: [
                    { author: { id: "author-a", model: "blog-author" } },
                    { author: { id: "author-b", model: "blog-author" } },
                  ],
                },
              },
              {
                id: "article-2",
                name: "Former author",
                data: {
                  handle: "former-author",
                  author: { id: "author-gone", model: "blog-author" },
                },
              },
              { id: "article-3", name: "No author", data: { handle: "none" } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "author-a",
                name: "Ada",
                data: { fullName: "Ada Example", handle: "ada-example" },
              },
              { id: "author-b", name: "Grace", data: {} },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = (await builderBlogArticles.run({}, {
      userEmail: "ada@example.com",
      orgId: "org-1",
    } as any)) as any;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const authorUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(authorUrl.origin + authorUrl.pathname).toBe(
      "https://cdn.builder.io/api/v3/content/blog-author",
    );
    expect(JSON.parse(authorUrl.searchParams.get("query.id.$in")!)).toEqual([
      "author-a",
      "author-b",
      "author-gone",
    ]);

    const [coWritten, former, none] = result.articles;
    expect(coWritten.author).toEqual({
      id: "author-a",
      name: "Ada Example",
      handle: "ada-example",
    });
    expect(coWritten.authors).toEqual([
      { id: "author-a", name: "Ada Example", handle: "ada-example" },
      { id: "author-b", name: "Grace", handle: null },
    ]);
    expect(former.author).toEqual({
      id: "author-gone",
      name: null,
      handle: null,
    });
    expect(none.author).toBeNull();
    expect(none.authors).toEqual([]);
  });

  it("keeps direct and wrapped references in both author fields", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "article-1",
                data: {
                  handle: "mixed",
                  author: [
                    { id: "a", model: "blog-author" },
                    { author: { id: "b" } },
                  ],
                  authors: [
                    { id: "c", model: "blog-author" },
                    { author: { id: "a" } },
                  ],
                },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
    const result = await builderBlogArticles.run({}, {
      userEmail: "ada@example.com",
      orgId: "org-1",
    } as any);
    expect(result.articles[0].author?.id).toBe("a");
    expect(result.articles[0].authors.map((author) => author.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails loudly when the author lookup fails instead of returning nameless authors", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "article-1",
                data: { handle: "a", author: { id: "author-a" } },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("nope", { status: 503 }));

    await expect(
      builderBlogArticles.run({}, {
        userEmail: "ada@example.com",
        orgId: "org-1",
      } as any),
    ).rejects.toThrow("Builder Content API (blog authors) returned HTTP 503.");
  });

  it("exposes a continuation when the bounded feed is still full at the page cap", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const offset = new URL(String(input)).searchParams.get("offset");
        return new Response(
          JSON.stringify({
            results: Array.from({ length: 100 }, (_, index) => ({
              id: `article-${offset}-${index}`,
              data: { handle: `article-${offset}-${index}` },
            })),
          }),
          { status: 200 },
        );
      });

    const result = (await builderBlogArticles.run({}, {
      userEmail: "ada@example.com",
      orgId: "org-1",
    } as any)) as any;

    expect(fetchMock).toHaveBeenCalledTimes(200);
    expect(result.total).toBe(20_000);
    expect(result.truncated).toBe(true);
    expect(result.nextOffset).toBe(20_000);
  });
});
