import { resolveBuilderCredential } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readBuilderCmsContentEntries } from "./_builder-cms-read-client";

vi.mock("@agent-native/core/server", () => ({
  resolveBuilderCredential: vi.fn(),
}));

const resolveBuilderCredentialMock = vi.mocked(resolveBuilderCredential);

describe("Builder CMS read client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BUILDER_CONTENT_API_HOST;
    delete process.env.BUILDER_CMS_API_HOST;
    delete process.env.BUILDER_CMS_MCP_ENDPOINT;
    delete process.env.BUILDER_CMS_MCP_SEARCH_TEXT;
    delete process.env.BUILDER_CMS_READ_LIMIT;
  });

  it("does not call Builder when the public key is not configured", async () => {
    resolveBuilderCredentialMock.mockResolvedValue(null);
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "unconfigured",
      entries: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads Builder content through the Content API when credentials exist", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.href).toContain(
        "https://cdn.test.builder.io/api/v3/content/blog_article",
      );
      expect(input.searchParams.get("apiKey")).toBe("public-key");
      expect(input.searchParams.get("limit")).toBe("20");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
      });
      expect(init?.headers).not.toHaveProperty("authorization");
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "builder-entry-1",
              lastUpdated: "2026-06-08T12:00:00.000Z",
              data: {
                title: "Builder title",
                url: "/blog/builder-title",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "live",
      entries: [
        {
          id: "builder-entry-1",
          model: "blog_article",
          title: "Builder title",
          urlPath: "/blog/builder-title",
          updatedAt: "2026-06-08T12:00:00.000Z",
        },
      ],
    });
  });
});
