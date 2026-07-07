import { resolveBuilderCredential } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listBuilderCmsModels,
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
} from "./_builder-cms-read-client";

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

  it("does not call Builder when model discovery credentials are not configured", async () => {
    resolveBuilderCredentialMock.mockResolvedValue(null);
    const fetchImpl = vi.fn();

    await expect(
      listBuilderCmsModels({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "unconfigured",
      models: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lists Builder models through the MCP read endpoint", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PRIVATE_KEY" ? "private-key" : null,
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
          headers: { "mcp-session-id": "session-1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    models: [
                      {
                        id: "model-blog",
                        name: "blog-article",
                        displayName: "Blog Article",
                        kind: "component",
                        fields: [
                          { name: "title", type: "text", required: true },
                        ],
                      },
                      {
                        id: "model-test",
                        name: "agent-native-blog-article-test",
                        displayName: "Agent Native Blog Article Test",
                        kind: "component",
                        fields: [
                          { name: "title", type: "text", required: false },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      listBuilderCmsModels({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "live",
      models: [
        {
          id: "model-test",
          name: "agent-native-blog-article-test",
          displayName: "Agent Native Blog Article Test",
          kind: "component",
          fields: [{ name: "title", type: "text", required: false }],
        },
        {
          id: "model-blog",
          name: "blog-article",
          displayName: "Blog Article",
          kind: "component",
          fields: [{ name: "title", type: "text", required: true }],
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [, listInit] = fetchImpl.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(String(listInit.body))).toMatchObject({
      method: "tools/call",
      params: {
        name: "list_builder_models",
        arguments: {},
      },
    });
  });

  it("returns Builder model fields for a selected model", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PRIVATE_KEY" ? "private-key" : null,
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
          headers: { "mcp-session-id": "session-1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    models: [
                      {
                        id: "model-blog",
                        name: "blog-article",
                        displayName: "Blog Article",
                        kind: "component",
                        fields: [
                          { name: "title", type: "text", required: true },
                          { name: "handle", type: "string", required: false },
                          {
                            name: "topics",
                            label: "Topics",
                            type: "list",
                            inputType: "tags",
                            options: [
                              {
                                label: "Headless CMS",
                                value: "headless-cms",
                              },
                              "Governance &amp; Security",
                            ],
                          },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsModelFields({
        model: "blog-article",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual([
      { name: "title", type: "text", required: true },
      { name: "handle", type: "string", required: false },
      {
        name: "topics",
        label: "Topics",
        type: "list",
        inputType: "tags",
        options: ["Headless CMS", "Governance &amp; Security"],
        required: false,
      },
    ]);
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
      expect(input.searchParams.get("limit")).toBe("100");
      expect(input.searchParams.get("offset")).toBe("0");
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

  it("paginates Builder content through the Content API up to the read limit", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const entries = Array.from({ length: 120 }, (_, index) => ({
      id: `builder-entry-${index + 1}`,
      lastUpdated: "2026-06-08T12:00:00.000Z",
      data: {
        title: `Builder title ${index + 1}`,
        url: `/blog/builder-title-${index + 1}`,
      },
    }));
    const fetchImpl = vi.fn(async (input: URL) => {
      const limit = Number(input.searchParams.get("limit"));
      const offset = Number(input.searchParams.get("offset"));
      return new Response(
        JSON.stringify({
          results: entries.slice(offset, offset + limit),
        }),
        { status: 200 },
      );
    });

    const result = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 120,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe("live");
    expect(result.entries).toHaveLength(120);
    expect(result.entries[0]).toMatchObject({ id: "builder-entry-1" });
    expect(result.entries[119]).toMatchObject({ id: "builder-entry-120" });
    expect(
      fetchImpl.mock.calls.map(([input]) =>
        (input as URL).searchParams.get("offset"),
      ),
    ).toEqual(["0", "100"]);
  });

  it("can return an initial partial Builder Content API page for fast refresh", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const entries = Array.from({ length: 250 }, (_, index) => ({
      id: `builder-entry-${index + 1}`,
      lastUpdated: "2026-06-08T12:00:00.000Z",
      data: {
        title: `Builder title ${index + 1}`,
        url: `/blog/builder-title-${index + 1}`,
      },
    }));
    const fetchImpl = vi.fn(async (input: URL) => {
      const limit = Number(input.searchParams.get("limit"));
      const offset = Number(input.searchParams.get("offset"));
      return new Response(
        JSON.stringify({
          results: entries.slice(offset, offset + limit),
        }),
        { status: 200 },
      );
    });

    const result = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 250,
      maxPages: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.state).toBe("live");
    expect(result.entries).toHaveLength(100);
    expect(result.progress).toMatchObject({
      requestedLimit: 250,
      startOffset: 0,
      nextOffset: 100,
      fetchedEntryCount: 100,
      hasMore: true,
      partial: true,
      readMode: "builder-api",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transient Content API failures", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
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
        ),
      );

    const result = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.state).toBe("live");
    expect(result.entries).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
