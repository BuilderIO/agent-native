import { resolveBuilderCredential } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { builderBlocksHash, builderEntryBlocks } from "../shared/builder-mdx";
import {
  builderCmsListEntryFields,
  listBuilderCmsModels,
  readBuilderCmsContentEntry,
  readBuilderCmsContentEntries,
  readBuilderCmsEntryLiveState,
  readBuilderCmsModelFields,
  summarizeBuilderCmsEntryFidelity,
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

  it("summarizes bounded rich-content fidelity without returning article text", () => {
    const fidelity = summarizeBuilderCmsEntryFidelity({
      id: "entry-1",
      model: "agent-native-blog-article-test",
      title: "Fixture",
      urlPath: "/blog/fixture",
      updatedAt: "2026-07-14T00:00:00.000Z",
      sourceValues: {},
      rawEntry: {
        id: "entry-1",
        model: "agent-native-blog-article-test",
        data: {
          blocks: [
            {
              component: {
                name: "Text",
                options: {
                  text: '<h2>Heading</h2><ul><li>One</li><li>Two</li></ul><p><a href="https://www.youtube.com/watch?v=test">Watch</a></p><table><tbody><tr><td>Cell</td></tr></tbody></table><blockquote>Quote</blockquote><code>const x = 1</code>',
                },
              },
            },
            {
              component: {
                name: "Image",
                options: { image: "https://example.com/a.jpg" },
              },
            },
            {
              component: {
                name: "Video",
                options: { video: "https://example.com/a.mp4" },
              },
            },
          ],
        },
      },
    } as Parameters<typeof summarizeBuilderCmsEntryFidelity>[0]);

    expect(fidelity).toEqual({
      topLevelBlockCount: 3,
      componentCount: 3,
      textBlockCount: 1,
      imageBlockCount: 1,
      htmlImageCount: 0,
      markdownImageSyntaxCount: 0,
      videoBlockCount: 1,
      headingCount: 1,
      unorderedListCount: 1,
      orderedListCount: 0,
      listItemCount: 2,
      linkCount: 1,
      tableCount: 1,
      escapedTableMarkupCount: 0,
      codeCount: 1,
      blockquoteCount: 1,
      escapedBlockquoteMarkupCount: 0,
      hasYouTubeLink: true,
    });
  });

  it("builds additive list projections without reintroducing heavy body fields", () => {
    const fields = builderCmsListEntryFields([
      "topics",
      "data.tags",
      "data.customModelField",
      "data.published",
      "data.Status",
      "data.status",
      "data.tags",
      "data.blocks",
      "DATA.BLOCKS",
      "data.blocks.children",
      "data.blocksString",
      "data.BlocksString",
      "sys.sync_state",
      "bad,field",
    ]).split(",");

    expect(fields).toEqual(
      expect.arrayContaining([
        "data.title",
        "data.topics",
        "data.tags",
        "data.customModelField",
        "data.published",
        "data.Status",
        "data.status",
      ]),
    );
    expect(fields).not.toContain("data.blocks");
    expect(fields).not.toContain("data.blocks.children");
    expect(fields).not.toContain("data.blocksString");
    expect(fields).not.toContain("DATA.BLOCKS");
    expect(fields).not.toContain("data.BlocksString");
    expect(fields).not.toContain("sys.sync_state");
    expect(fields.filter((field) => field === "data.tags")).toHaveLength(1);
    expect(fields).toContain("published");
    expect(fields).toContain("data.published");
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

  it("keeps unconfigured model-field discovery as an empty-field fallback", async () => {
    resolveBuilderCredentialMock.mockResolvedValue(null);
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsModelFields({
        model: "blog-article",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when production model discovery returns an error state", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PRIVATE_KEY" ? "private-key" : null,
    );
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("Builder unavailable", {
        status: 503,
      }),
    );

    await expect(
      readBuilderCmsModelFields({
        model: "blog-article",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Builder MCP request failed with HTTP 503.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
                          {
                            name: "author",
                            type: "reference",
                            model: "author",
                            required: true,
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
      {
        name: "author",
        type: "reference",
        model: "author",
        required: true,
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
      expect(input.searchParams.get("includeUnpublished")).toBe("true");
      expect(input.searchParams.get("cachebust")).toBe("true");
      expect(input.searchParams.get("limit")).toBe("100");
      expect(input.searchParams.get("offset")).toBe("0");
      expect(input.searchParams.get("fields")).toContain("data.title");
      expect(input.searchParams.get("fields")).toContain("data.topics");
      expect(input.searchParams.get("fields")).toContain("data.tags");
      expect(input.searchParams.get("fields")).toContain(
        "data.customModelField",
      );
      expect(input.searchParams.get("fields")).not.toContain("data.blocks");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
      });
      expect(init?.headers).not.toHaveProperty("authorization");
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "builder-entry-1",
              published: "draft",
              lastUpdated: "2026-06-08T12:00:00.000Z",
              data: {
                title: "Builder title",
                url: "/blog/builder-title",
                topics: ["AI", "CMS"],
                tags: ["Agents"],
                customModelField: "Preserved",
                Status: "Editorial",
                status: "published",
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
        fieldPaths: [
          "data.topics",
          "data.tags",
          "data.customModelField",
          "data.Status",
          "data.status",
          "data.blocks",
        ],
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
          rawEntry: { published: "draft" },
          sourceValues: {
            "data.topics": ["AI", "CMS"],
            "data.tags": ["Agents"],
            "data.customModelField": "Preserved",
            "data.Status": "Editorial",
            "data.status": "published",
          },
        },
      ],
    });
  });

  it("performs authenticated, cachebusted raw fidelity reads without projection or enrichment", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) => {
      if (key === "BUILDER_PUBLIC_KEY") return "public-key";
      if (key === "BUILDER_PRIVATE_KEY") return "private-key";
      return null;
    });
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.searchParams.get("includeUnpublished")).toBe("true");
      expect(input.searchParams.get("noCache")).toBe("true");
      expect(Number(input.searchParams.get("cachebust"))).toBeGreaterThan(0);
      expect(input.searchParams.get("enrich")).toBe("false");
      expect(input.searchParams.has("fields")).toBe(false);
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        authorization: "Bearer private-key",
      });
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "builder-entry-raw",
              published: "draft",
              data: {
                title: "Raw title",
                blocks: [{ id: "block-1" }],
                author: {
                  "@type": "@builder.io/core:Reference",
                  id: "author-1",
                },
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await readBuilderCmsContentEntries({
      model: "blog-article",
      rawData: true,
      requirePrivateKey: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.entries[0]?.rawEntry?.data).toEqual({
      title: "Raw title",
      blocks: [{ id: "block-1" }],
      author: {
        "@type": "@builder.io/core:Reference",
        id: "author-1",
      },
    });
  });

  it("fails closed before a required authenticated fidelity read", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntries({
        model: "blog-article",
        rawData: true,
        requirePrivateKey: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "unconfigured",
      entries: [],
      progress: { readMode: "none" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps an empty unpublished-inclusive Content API result authoritative", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) => {
      if (key === "BUILDER_PUBLIC_KEY") return "public-key";
      if (key === "BUILDER_PRIVATE_KEY") return "private-key";
      return null;
    });
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.pathname).toBe(
        "/api/v3/content/agent-native-blog-article-test",
      );
      expect(input.searchParams.get("includeUnpublished")).toBe("true");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        authorization: "Bearer private-key",
      });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });

    await expect(
      readBuilderCmsContentEntries({
        model: "agent-native-blog-article-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "live",
      entries: [],
      progress: {
        readMode: "builder-api",
        partial: false,
        hasMore: false,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("requests mapped model fields through Builder MCP list reads", async () => {
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
                    content: [
                      {
                        id: "builder-entry-mcp",
                        lastUpdated: "2026-06-08T12:00:00.000Z",
                        data: {
                          title: "MCP title",
                          topics: ["AI"],
                          tags: ["CMS"],
                          customModelField: "MCP preserved",
                        },
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

    const result = await readBuilderCmsContentEntries({
      model: "blog_article",
      fieldPaths: [
        "topics",
        "data.tags",
        "data.customModelField",
        "data.blocksString",
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.entries[0]?.sourceValues).toMatchObject({
      "data.topics": ["AI"],
      "data.tags": ["CMS"],
      "data.customModelField": "MCP preserved",
    });
    const [, request] = fetchImpl.mock.calls[2] as [string, RequestInit];
    const fields = JSON.parse(String(request.body)).params.arguments.fields;
    expect(fields).toContain("data.topics");
    expect(fields).toContain("data.tags");
    expect(fields).toContain("data.customModelField");
    expect(fields).not.toContain("data.blocks");
    expect(fields).not.toContain("data.blocksString");
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
    for (const [input] of fetchImpl.mock.calls) {
      const fields = (input as URL).searchParams.get("fields") ?? "";
      expect(fields).toContain("data.title");
      expect(fields).not.toContain("data.blocks");
      expect(fields).not.toContain("data.blocksString");
    }
  });

  it("keeps row-list reads metadata-only but fetches blocks for single-entry hydration", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const fetchImpl = vi.fn(async (input: URL) => {
      const fields = input.searchParams.get("fields") ?? "";
      const isSingleEntry = input.pathname.endsWith(
        "/api/v3/content/blog_article/builder-entry-1",
      );
      if (isSingleEntry) {
        expect(fields).toContain("data.blocks");
        return new Response(
          JSON.stringify({
            id: "builder-entry-1",
            lastUpdated: "2026-06-08T12:00:00.000Z",
            data: {
              title: "Builder title",
              url: "/blog/builder-title",
              blocks: [
                {
                  "@type": "@builder.io/sdk:Element",
                  "@version": 2,
                  id: "text-1",
                  component: {
                    name: "Text",
                    options: { text: "<p>Hydrated body.</p>" },
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      expect(fields).toContain("data.title");
      expect(fields).not.toContain("data.blocks");
      expect(fields).not.toContain("data.blocksString");
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

    const listResult = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const entryResult = await readBuilderCmsContentEntry({
      model: "blog_article",
      entryId: "builder-entry-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(listResult.entries[0]?.rawEntry?.data?.blocks).toBeUndefined();
    expect(entryResult?.rawEntry?.data?.blocks).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses the hydration body representation for uncached live preflight hashes", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const canonicalBlocks = [
      {
        "@type": "@builder.io/sdk:Element",
        "@version": 2,
        id: "text-1",
        component: {
          name: "Text",
          options: { text: "<p>Canonical enriched body.</p>" },
        },
      },
    ];
    const fetchImpl = vi.fn(async (input: URL) => {
      const fields = input.searchParams.get("fields") ?? "";
      const hasCanonicalBodyProjection =
        input.searchParams.get("enrich") === "true" &&
        input.searchParams.get("noCache") === "true" &&
        fields.includes("data.blocks") &&
        fields.includes("data.blocksString");
      return new Response(
        JSON.stringify({
          id: "builder-entry-1",
          published: "draft",
          lastUpdated: 1_786_000_000_000,
          data: {
            title: "Builder title",
            blocks: hasCanonicalBodyProjection
              ? canonicalBlocks
              : [
                  {
                    ...canonicalBlocks[0],
                    component: {
                      name: "Text",
                      options: { text: "<p>Alternate default projection.</p>" },
                    },
                  },
                ],
          },
        }),
        { status: 200 },
      );
    });

    const hydrated = await readBuilderCmsContentEntry({
      model: "blog_article",
      entryId: "builder-entry-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const live = await readBuilderCmsEntryLiveState({
      model: "blog_article",
      entryId: "builder-entry-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(hydrated).not.toBeNull();
    const baselineHash = builderBlocksHash(
      builderEntryBlocks(hydrated!.rawEntry!),
    );
    expect(live).toMatchObject({
      exists: true,
      published: "draft",
      lastUpdated: 1_786_000_000_000,
      blocksHash: baselineHash,
      id: "builder-entry-1",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [input] of fetchImpl.mock.calls) {
      expect(input.searchParams.get("enrich")).toBe("true");
      expect(input.searchParams.get("noCache")).toBe("true");
      expect(input.searchParams.get("cachebust")).toMatch(/^\d+$/);
      expect(input.searchParams.get("fields")).toContain("data.blocks");
      expect(input.searchParams.get("fields")).toContain("data.blocksString");
    }
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

  it("continues a 597-entry Content API source from offset 500 without a zero-sized request", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const entries = Array.from({ length: 597 }, (_, index) => ({
      id: `builder-entry-${index + 1}`,
      data: { title: `Builder title ${index + 1}` },
    }));
    const requests: Array<{ limit: number; offset: number }> = [];
    const fetchImpl = vi.fn(async (input: URL) => {
      const limit = Number(input.searchParams.get("limit"));
      const offset = Number(input.searchParams.get("offset"));
      requests.push({ limit, offset });
      return new Response(
        JSON.stringify({ results: entries.slice(offset, offset + limit) }),
        { status: 200 },
      );
    });

    const result = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 500,
      offset: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(requests).toEqual([{ limit: 100, offset: 500 }]);
    expect(result.entries).toHaveLength(97);
    expect(result.progress).toMatchObject({
      startOffset: 500,
      nextOffset: 597,
      fetchedEntryCount: 597,
      hasMore: false,
      partial: false,
    });
  });

  it("reads all 597 Content API entries across six non-empty pages", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PUBLIC_KEY" ? "public-key" : null,
    );
    const entries = Array.from({ length: 597 }, (_, index) => ({
      id: `builder-entry-${index + 1}`,
      data: { title: `Builder title ${index + 1}` },
    }));
    const requests: Array<{ limit: number; offset: number }> = [];
    const fetchImpl = vi.fn(async (input: URL) => {
      const limit = Number(input.searchParams.get("limit"));
      const offset = Number(input.searchParams.get("offset"));
      requests.push({ limit, offset });
      return new Response(
        JSON.stringify({ results: entries.slice(offset, offset + limit) }),
        { status: 200 },
      );
    });

    const result = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 1_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(requests.map((request) => request.offset)).toEqual([
      0, 100, 200, 300, 400, 500,
    ]);
    expect(requests.every((request) => request.limit > 0)).toBe(true);
    expect(result.entries).toHaveLength(597);
    expect(result.progress).toMatchObject({
      nextOffset: 597,
      fetchedEntryCount: 597,
      hasMore: false,
      partial: false,
    });
  });

  it("continues a 597-entry MCP source from offset 500", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PRIVATE_KEY" ? "private-key" : null,
    );
    const entries = Array.from({ length: 597 }, (_, index) => ({
      id: `builder-entry-${index + 1}`,
      data: { title: `Builder title ${index + 1}` },
    }));
    const pageRequests: Array<{ limit: number; offset: number }> = [];
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        method: string;
        params?: {
          name?: string;
          arguments?: { limit?: number; offset?: number };
        };
      };
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
          headers: { "mcp-session-id": "session-597" },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
        });
      }
      const limit = Number(body.params?.arguments?.limit);
      const offset = Number(body.params?.arguments?.offset);
      pageRequests.push({ limit, offset });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  content: entries.slice(offset, offset + limit),
                }),
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const result = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 500,
      offset: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(pageRequests).toEqual([{ limit: 100, offset: 500 }]);
    expect(result.entries).toHaveLength(97);
    expect(result.progress).toMatchObject({
      startOffset: 500,
      nextOffset: 597,
      fetchedEntryCount: 597,
      hasMore: false,
      partial: false,
      readMode: "mcp",
    });
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
