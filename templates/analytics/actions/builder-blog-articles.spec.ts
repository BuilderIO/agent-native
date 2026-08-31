import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAnalyticsProviderCredential: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("../server/lib/provider-credentials", () => ({
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
});
