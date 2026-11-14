import { ActionContractError } from "@agent-native/core/action";
import { resolveBuilderRequestAuthorization } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { builderBlocksHash, builderEntryBlocks } from "../shared/builder-mdx";
import {
  builderCmsListEntryFields,
  BuilderCmsContentEntryReadError,
  listBuilderCmsModels,
  readBuilderCmsContentEntry,
  readBuilderCmsContentEntryResult,
  readBuilderCmsContentEntries,
  readBuilderCmsEntryLiveState,
  readBuilderCmsModelFields,
  summarizeBuilderCmsEntryFidelity,
} from "./_builder-cms-read-client";

vi.mock("@agent-native/core/server", () => ({
  BUILDER_CONTENT_READ_SCOPE: "builder:content:read",
  BUILDER_OAUTH_RESOURCE: "https://api.builder.io",
  resolveBuilderRequestAuthorization: vi.fn(),
  BUILDER_PUBLISH_MCP_RESOURCE: "https://mcp.builder.io/mcp/publish",
}));

const resolveBuilderRequestAuthorizationMock = vi.mocked(
  resolveBuilderRequestAuthorization,
);

function usePublishAuthorization(token = "publish-oauth-token") {
  resolveBuilderRequestAuthorizationMock.mockImplementation(async (input) =>
    input?.oauthResource === "publish"
      ? {
          token,
          authorization: `Bearer ${token}`,
          source: "oauth",
          oauthResource: "publish",
        }
      : null,
  );
}

describe("Builder CMS read client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BUILDER_CONTENT_API_HOST;
    delete process.env.BUILDER_CMS_API_HOST;
    delete process.env.BUILDER_CMS_MCP_ENDPOINT;
    delete process.env.BUILDER_CMS_MCP_SEARCH_TEXT;
    delete process.env.BUILDER_CMS_READ_LIMIT;
    // Like core, a caller that leaves room for deploy keys gets one, so a
    // Source read that stops passing legacyCredentialKeys: [] fails here.
    resolveBuilderRequestAuthorizationMock.mockImplementation(async (input) =>
      input?.legacyCredentialKeys?.length === 0
        ? null
        : {
            token: "deploy-key",
            authorization: "Bearer deploy-key",
            source: "legacy",
          },
    );
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
    // The Builder status reads Builder's own autosave flag from every read.
    expect(fields).toContain("meta.hasAutosaves");
    expect(fields.filter((field) => field === "data.tags")).toHaveLength(1);
    expect(fields).toContain("published");
    expect(fields).toContain("data.published");
  });

  it("does not call Builder when the public key is not configured", async () => {
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

  it("lists Builder models with OAuth-only request authorization", async () => {
    process.env.BUILDER_CMS_MCP_ENDPOINT = "https://attacker.example.com/mcp";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
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
                        id: "model-test",
                        name: "agent-native-blog-article-test",
                        displayName: "Agent-Native Blog Article Test",
                        kind: "component",
                        fields: [],
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
      models: [{ id: "model-test" }],
    });
    // oracle-change: the public-key Content API and private-key MCP read lanes are gone, so their tests went with them.
    for (const [input] of resolveBuilderRequestAuthorizationMock.mock.calls) {
      expect(input).toMatchObject({ legacyCredentialKeys: [] });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.every(
        ([input]) => String(input) === "https://mcp.builder.io/mcp/publish",
      ),
    ).toBe(true);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        authorization: "Bearer oauth-access-token",
      }),
    });
  });

  it("lists models through the scoped general API grant", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.href).toBe(
        "https://cdn.builder.io/api/v1/models?apiKey=selected-space-key",
      );
      expect(init?.headers).toMatchObject({
        authorization: "Bearer general-oauth-token",
      });
      return new Response(
        JSON.stringify({
          models: [
            {
              id: "model-1",
              name: "blog_article",
              displayName: "Blog article",
              fields: [],
            },
          ],
        }),
        { status: 200 },
      );
    });

    await expect(
      listBuilderCmsModels({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ state: "live", models: [{ id: "model-1" }] });
    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
      oauthResource: "general",
      requiredScope: "builder:content:read",
      legacyCredentialKeys: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks for a Builder reconnect when cdn rejects the OAuth grant", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
      oauthConnectionId: "content-connection-1",
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(
      listBuilderCmsModels({
        expectedSourceSpace: "selected-space-key",
        expectedSourceConnectionId: "content-connection-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      models: [],
      message: expect.stringContaining("Reconnect Builder.io in Settings"),
    });
    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("leaves archived models out of general API discovery", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: [
              { id: "model-1", name: "blog_article", fields: [] },
              {
                id: "model-2",
                name: "old_article",
                archived: true,
                fields: [],
              },
              {
                id: "model-3",
                name: "landing_page",
                archived: false,
                fields: [],
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const result = await listBuilderCmsModels({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe("live");
    expect(result.models.map((model) => model.id).sort()).toEqual([
      "model-1",
      "model-3",
    ]);
  });

  it.each([null, { data: [] }, { models: "not-an-array" }, { models: [{}] }])(
    "rejects malformed general API model responses: %j",
    async (payload) => {
      resolveBuilderRequestAuthorizationMock.mockResolvedValue({
        token: "general-oauth-token",
        authorization: "Bearer general-oauth-token",
        source: "oauth",
        oauthResource: "general",
        oauthSelectedPublicKey: "selected-space-key",
      });
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify(payload), { status: 200 }),
      );

      await expect(
        listBuilderCmsModels({
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).resolves.toMatchObject({
        state: "error",
        models: [],
        message: expect.stringMatching(/malformed|models array/),
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves a valid empty general API model catalog", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    await expect(
      listBuilderCmsModels({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ state: "live", models: [] });
  });

  it("enumerates raw draft-inclusive entries through query-data", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      if (input.pathname === "/api/v1/models") {
        return new Response(
          JSON.stringify({
            models: [
              {
                id: "model-uuid",
                name: "blog_article",
                displayName: "Blog article",
                fields: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(input.pathname).toBe("/api/v1/query-data");
      expect(
        Object.fromEntries(
          Array.from(input.searchParams).filter(
            ([key]) => key !== "noCache" && key !== "cachebust",
          ),
        ),
      ).toEqual({
        apiKey: "selected-space-key",
        "query.modelId": "model-uuid",
        "sort.id": "1",
        offset: fetchImpl.mock.calls.length === 2 ? "0" : "1",
        limit: fetchImpl.mock.calls.length === 2 ? "3" : "2",
        fetchTotalCount: "true",
      });
      expect(input.searchParams.get("noCache")).toBe("true");
      expect(input.searchParams.get("cachebust")).toMatch(/^\d+$/);
      expect(input.searchParams.has("published")).toBe(false);
      expect(init?.headers).toMatchObject({
        authorization: "Bearer general-oauth-token",
      });
      const firstPage = fetchImpl.mock.calls.length === 2;
      return new Response(
        JSON.stringify(
          firstPage
            ? {
                results: [
                  {
                    id: "draft-1",
                    modelId: "model-uuid",
                    published: "draft",
                    data: { title: "Draft", unknown: { preserved: true } },
                  },
                  {
                    id: "published-1",
                    modelId: "model-uuid",
                    published: "published",
                    data: { title: "Published" },
                  },
                ],
                totalCount: 3,
              }
            : {
                results: [
                  {
                    id: "published-1",
                    modelId: "model-uuid",
                    published: "published",
                    data: { title: "Published" },
                  },
                  {
                    id: "z-draft-2",
                    modelId: "model-uuid",
                    published: "draft",
                    data: { title: "Second draft" },
                  },
                ],
                totalCount: 3,
              },
        ),
        { status: 200 },
      );
    });

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        rawData: true,
        limit: 3,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "live",
      entries: [
        { id: "draft-1", rawEntry: { data: { unknown: { preserved: true } } } },
        { id: "published-1" },
        { id: "z-draft-2" },
      ],
      progress: {
        hasMore: false,
        partial: false,
        nextCursor: "z-draft-2",
        readMode: "builder-api",
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects a later page when an entry before it was replaced between pages", async () => {
    let queryCalls = 0;
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) => {
      if (input.pathname === "/api/v1/models") {
        return new Response(
          JSON.stringify({
            models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
          }),
          { status: 200 },
        );
      }
      queryCalls += 1;
      // After the first page, entry-1 is deleted and entry-5 added: the count
      // holds while every later entry shifts one place earlier.
      const offset = Number(input.searchParams.get("offset"));
      const limit = Number(input.searchParams.get("limit"));
      const ids =
        queryCalls === 1
          ? ["entry-1", "entry-2"]
          : ["entry-2", "entry-3", "entry-4", "entry-5"].slice(
              offset,
              offset + limit,
            );
      return new Response(
        JSON.stringify({
          results: ids.map((id) => ({ id, modelId: "model-uuid", data: {} })),
          totalCount: 4,
        }),
        { status: 200 },
      );
    });

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        limit: 4,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      message: expect.stringContaining("changed before the saved cursor"),
    });
  });

  it("rejects a refresh continuation when an entry is inserted before its saved cursor", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) => {
      if (input.pathname === "/api/v1/models") {
        return new Response(
          JSON.stringify({
            models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
          }),
          { status: 200 },
        );
      }
      const continuation = input.searchParams.get("offset") === "1";
      return new Response(
        JSON.stringify(
          continuation
            ? {
                results: [
                  { id: "entry-2", modelId: "model-uuid", data: {} },
                  { id: "entry-3", modelId: "model-uuid", data: {} },
                ],
                totalCount: 4,
              }
            : {
                results: [
                  { id: "entry-1", modelId: "model-uuid", data: {} },
                  { id: "entry-2", modelId: "model-uuid", data: {} },
                ],
                totalCount: 3,
              },
        ),
        { status: 200 },
      );
    });
    const fetch = fetchImpl as unknown as typeof globalThis.fetch;

    const firstPage = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 2,
      fetchImpl: fetch,
    });
    expect(firstPage).toMatchObject({
      state: "live",
      progress: {
        observedCollectionCount: 3,
        nextOffset: 2,
        nextCursor: "entry-2",
        partial: true,
      },
    });

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        limit: 2,
        offset: 2,
        afterId: "entry-2",
        expectedCollectionCount: 3,
        fetchImpl: fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      message: expect.stringContaining(
        "collection changed between refresh pages",
      ),
    });
    const continuationRequest = fetchImpl.mock.calls.at(-1)?.[0] as URL;
    expect(continuationRequest.searchParams.get("offset")).toBe("1");
    expect(continuationRequest.searchParams.has("query.id.$gt")).toBe(false);
  });

  it("rejects a refresh continuation when an entry is removed before its saved cursor while another is appended", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) => {
      if (input.pathname === "/api/v1/models") {
        return new Response(
          JSON.stringify({
            models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
          }),
          { status: 200 },
        );
      }
      const continuation = input.searchParams.get("offset") === "1";
      return new Response(
        JSON.stringify(
          continuation
            ? {
                results: [
                  { id: "entry-3", modelId: "model-uuid", data: {} },
                  { id: "entry-4", modelId: "model-uuid", data: {} },
                ],
                totalCount: 3,
              }
            : {
                results: [
                  { id: "entry-1", modelId: "model-uuid", data: {} },
                  { id: "entry-2", modelId: "model-uuid", data: {} },
                ],
                totalCount: 3,
              },
        ),
        { status: 200 },
      );
    });
    const fetch = fetchImpl as unknown as typeof globalThis.fetch;

    const firstPage = await readBuilderCmsContentEntries({
      model: "blog_article",
      limit: 2,
      fetchImpl: fetch,
    });
    expect(firstPage).toMatchObject({
      state: "live",
      progress: {
        observedCollectionCount: 3,
        nextOffset: 2,
        nextCursor: "entry-2",
        partial: true,
      },
    });

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        limit: 2,
        offset: 2,
        afterId: "entry-2",
        expectedCollectionCount: 3,
        fetchImpl: fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      message: expect.stringContaining("changed before the saved cursor"),
    });
    const continuationRequest = fetchImpl.mock.calls.at(-1)?.[0] as URL;
    expect(continuationRequest.searchParams.get("offset")).toBe("1");
  });

  it("requires a saved source binding before an unbound OAuth refresh", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
      oauthConnectionId: "connection-1",
    });
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        requireBoundOAuth: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      message: expect.stringContaining(
        "requires a saved space and connection binding",
      ),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires a saved source binding before OAuth live entry reads", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
      oauthConnectionId: "connection-1",
    });
    const fetchImpl = vi.fn();
    const args = {
      model: "blog_article",
      entryId: "builder-entry-1",
      requireBoundOAuth: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };

    await expect(readBuilderCmsEntryLiveState(args)).rejects.toMatchObject({
      errorCode: "builder_source_binding_required",
    });
    await expect(readBuilderCmsContentEntryResult(args)).rejects.toMatchObject({
      errorCode: "builder_source_binding_required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a query-data page that ignores the stable cursor", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) => {
      if (input.pathname === "/api/v1/models") {
        return new Response(
          JSON.stringify({
            models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
          }),
          { status: 200 },
        );
      }
      const duplicate = {
        id: "duplicate-entry",
        modelId: "model-uuid",
        data: { title: "Duplicate" },
      };
      return new Response(
        JSON.stringify({
          results:
            fetchImpl.mock.calls.length === 2
              ? [duplicate]
              : [duplicate, duplicate],
          totalCount: 2,
        }),
        { status: 200 },
      );
    });

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        limit: 2,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      message: expect.stringContaining("repeated or reordered"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([null, false, ""])(
    "rejects a coerced general query-data totalCount (%j)",
    async (totalCount) => {
      resolveBuilderRequestAuthorizationMock.mockResolvedValue({
        token: "general-oauth-token",
        authorization: "Bearer general-oauth-token",
        source: "oauth",
        oauthResource: "general",
        oauthSelectedPublicKey: "selected-space-key",
      });
      const fetchImpl = vi.fn(async (input: URL) =>
        input.pathname === "/api/v1/models"
          ? new Response(
              JSON.stringify({
                models: [
                  { id: "model-uuid", name: "blog_article", fields: [] },
                ],
              }),
              { status: 200 },
            )
          : new Response(JSON.stringify({ results: [], totalCount }), {
              status: 200,
            }),
      );

      await expect(
        readBuilderCmsContentEntries({
          model: "blog_article",
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).resolves.toMatchObject({
        state: "error",
        message: expect.stringContaining("valid totalCount"),
      });
    },
  );

  it("fails closed before a general API read when the token has no selected space", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "opaque-general-token",
      authorization: "Bearer opaque-general-token",
      source: "oauth",
      oauthResource: "general",
    });
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      message: expect.stringContaining("did not identify its selected space"),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not read a Source through a different OAuth credential lane", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
      oauthConnectionId: "current-connection",
    });
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        expectedSourceSpace: "selected-space-key",
        expectedSourceConnectionId: "original-connection",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      message: expect.stringContaining("credential does not match"),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not downgrade an OAuth-bound Source read to Publish or legacy access", async () => {
    resolveBuilderRequestAuthorizationMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        token: "legacy-private-key",
        authorization: "Bearer legacy-private-key",
        source: "legacy",
      });
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        expectedSourceSpace: "selected-space-key",
        expectedSourceConnectionId: "oauth-connection-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/OAuth connection is unavailable/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a space-only Source binding", async () => {
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "builder-entry-1",
        expectedSourceSpace: "selected-space-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ errorCode: "builder_source_binding_invalid" });
    expect(resolveBuilderRequestAuthorizationMock).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a connection-only Source binding", async () => {
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "builder-entry-1",
        expectedSourceConnectionId: "oauth-connection-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ errorCode: "builder_source_binding_invalid" });
    expect(resolveBuilderRequestAuthorizationMock).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts a stalled live preflight without retrying the request", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
      oauthConnectionId: "oauth-connection-1",
    });
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchImpl = vi.fn(async (_input: URL, init?: RequestInit) => {
      markStarted();
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
    const pending = readBuilderCmsEntryLiveState({
      model: "blog_article",
      entryId: "builder-entry-1",
      expectedSourceSpace: "selected-space-key",
      expectedSourceConnectionId: "oauth-connection-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });

    await started;
    controller.abort(
      new Error("Builder live preflight exceeded its time limit."),
    );

    await expect(pending).rejects.toThrow(
      "Builder live preflight exceeded its time limit.",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("sends every OAuth read to cdn.builder.io even when both host overrides are set", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://attacker.example.com";
    process.env.BUILDER_CMS_API_HOST = "https://attacker-cms.example.com";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) =>
      input.pathname === "/api/v1/models"
        ? new Response(
            JSON.stringify({
              models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
            }),
            { status: 200 },
          )
        : new Response(
            JSON.stringify({
              results: [{ id: "builder-entry-1", modelId: "model-uuid" }],
              totalCount: 1,
            }),
            { status: 200 },
          ),
    );

    await listBuilderCmsModels({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await readBuilderCmsEntryLiveState({
      model: "blog_article",
      entryId: "builder-entry-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await readBuilderCmsContentEntryResult({
      model: "blog_article",
      entryId: "builder-entry-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [input] of fetchImpl.mock.calls) {
      expect(String(input)).toMatch(/^https:\/\/cdn\.builder\.io\/api\/v1\//);
    }
    const entryReads = fetchImpl.mock.calls
      .map(([input]) => input)
      .filter((input) => input.searchParams.get("query.id"));
    expect(entryReads).toHaveLength(2);
    for (const input of entryReads) {
      expect(input.searchParams.get("noCache")).toBe("true");
      expect(Number(input.searchParams.get("cachebust"))).toBeGreaterThan(0);
    }
  });

  describe("when the general grant predates builder:content:read", () => {
    const reauthorizationRequired = new ActionContractError(
      "Re-authorize Builder.io to grant Content read access.",
      {
        errorCode: "builder_oauth_reauthorization_required",
        statusCode: 400,
      },
    );

    beforeEach(() => {
      resolveBuilderRequestAuthorizationMock.mockImplementation(
        async (input) => {
          if (input?.oauthResource === "general") throw reauthorizationRequired;
          return {
            token: "publish-oauth-token",
            authorization: "Bearer publish-oauth-token",
            source: "oauth",
            oauthResource: "publish",
          };
        },
      );
    });

    it("keeps an unbound Source on its Publish read path", async () => {
      const fetchImpl = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: { content: [{ type: "text", text: '{"models":[]}' }] },
            }),
            { status: 200 },
          ),
      );

      await expect(
        listBuilderCmsModels({
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).resolves.toMatchObject({ state: "live", models: [] });
      expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith(
        expect.objectContaining({ oauthResource: "publish" }),
      );
      for (const [input] of fetchImpl.mock.calls) {
        expect(String(input)).toBe("https://mcp.builder.io/mcp/publish");
      }
    });

    it("surfaces re-authorization when Publish is unavailable", async () => {
      resolveBuilderRequestAuthorizationMock.mockImplementation(
        async (input) => {
          if (input?.oauthResource === "general") throw reauthorizationRequired;
          return null;
        },
      );
      const fetchImpl = vi.fn();

      await expect(
        readBuilderCmsContentEntryResult({
          model: "blog_article",
          entryId: "builder-entry-1",
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toBe(reauthorizationRequired);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("surfaces re-authorization for a bound Source instead of downgrading", async () => {
      const fetchImpl = vi.fn();

      await expect(
        readBuilderCmsContentEntryResult({
          model: "blog_article",
          entryId: "builder-entry-1",
          expectedSourceSpace: "selected-space-key",
          expectedSourceConnectionId: "oauth-connection-1",
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toBe(reauthorizationRequired);
      await expect(
        readBuilderCmsEntryLiveState({
          model: "blog_article",
          entryId: "builder-entry-1",
          expectedSourceSpace: "selected-space-key",
          expectedSourceConnectionId: "oauth-connection-1",
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toBe(reauthorizationRequired);
      expect(resolveBuilderRequestAuthorizationMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ oauthResource: "publish" }),
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it.each([
    {
      name: "a missing models endpoint",
      modelsStatus: 404,
      expected: {
        reason: "malformed_body",
        providerStatus: "http_404",
        retryable: false,
      },
    },
    {
      name: "an unavailable models endpoint",
      modelsStatus: 503,
      expected: {
        reason: "transient_read_failure",
        providerStatus: "http_503",
        retryable: true,
      },
    },
    {
      name: "an unknown model",
      modelsStatus: 200,
      expected: {
        reason: "not_found",
        providerStatus: "builder_model_not_found",
        retryable: false,
      },
    },
  ])(
    "classifies $name during a general entry read",
    async ({ modelsStatus, expected }) => {
      resolveBuilderRequestAuthorizationMock.mockResolvedValue({
        token: "general-oauth-token",
        authorization: "Bearer general-oauth-token",
        source: "oauth",
        oauthResource: "general",
        oauthSelectedPublicKey: "selected-space-key",
      });
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ models: [] }), {
            status: modelsStatus,
          }),
      );

      await expect(
        readBuilderCmsContentEntryResult({
          model: "blog_article",
          entryId: "builder-entry-1",
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toMatchObject(expected);
    },
  );

  it("keeps a credential lane mismatch retryable for after the source reconnects", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
      oauthConnectionId: "current-connection",
    });
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "builder-entry-1",
        expectedSourceSpace: "selected-space-key",
        expectedSourceConnectionId: "original-connection",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      reason: "access_denied",
      providerStatus: "builder_source_connection_mismatch",
      retryable: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an expired OAuth grant as an error instead of unconfigured", async () => {
    resolveBuilderRequestAuthorizationMock.mockRejectedValue(
      new Error(
        "Builder.io access expired. Re-authorize Builder.io in Settings to continue.",
      ),
    );
    const fetchImpl = vi.fn();

    await expect(
      listBuilderCmsModels({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      models: [],
      message: expect.stringMatching(/access expired/),
    });
    await expect(
      readBuilderCmsContentEntries({
        model: "agent-native-blog-article-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      entries: [],
      message: expect.stringMatching(/access expired/),
      progress: { readMode: "none" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps unconfigured model-field discovery as an empty-field fallback", async () => {
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
    usePublishAuthorization();
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
    usePublishAuthorization();
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
                        displayName: "Agent-Native Blog Article Test",
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
          displayName: "Agent-Native Blog Article Test",
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
    expect(
      JSON.parse(
        typeof listInit.body === "string"
          ? listInit.body
          : (JSON.stringify(listInit.body) ?? ""),
      ),
    ).toMatchObject({
      method: "tools/call",
      params: {
        name: "list_builder_models",
        arguments: {},
      },
    });
  });

  it("rejects malformed Builder model discovery instead of reporting a live empty catalog", async () => {
    usePublishAuthorization();
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
            result: { content: [{ type: "text", text: "not json" }] },
          }),
          { status: 200 },
        ),
      );

    await expect(
      listBuilderCmsModels({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      models: [],
      message: "Builder MCP model discovery returned malformed tool content.",
    });
  });

  it("returns Builder model fields for a selected model", async () => {
    usePublishAuthorization();
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

  it("can project Builder bodies in paged Publish MCP list reads for bulk hydration", async () => {
    usePublishAuthorization();
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
                        id: "builder-entry-with-body",
                        data: {
                          title: "Builder body",
                          blocks: [{ id: "block-1" }],
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
      model: "blog-article",
      includeBodies: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.entries[0]?.rawEntry?.data).toMatchObject({
      blocks: [{ id: "block-1" }],
    });
    const [, request] = fetchImpl.mock.calls[2] as [string, RequestInit];
    const fields = JSON.parse(
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body),
    ).params.arguments.fields;
    expect(fields.split(",")).toEqual(
      expect.arrayContaining([
        "data.title",
        "data.blocks",
        "data.blocksString",
      ]),
    );
    expect(request.headers).toMatchObject({
      authorization: "Bearer publish-oauth-token",
    });
  });

  it("requests mapped model fields through OAuth-only Builder MCP reads", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
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
    const fields = JSON.parse(
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body),
    ).params.arguments.fields;
    expect(fields).toContain("data.topics");
    expect(fields).toContain("data.tags");
    expect(fields).toContain("data.customModelField");
    expect(fields).not.toContain("data.blocks");
    expect(fields).not.toContain("data.blocksString");
    expect(request.headers).toMatchObject({
      authorization: "Bearer oauth-access-token",
    });
  });

  it("never sends Publish OAuth authorization to a configured content host", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://attacker.example.com";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
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
                  text: '{"content":[],"totalCount":0}',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ state: "live", entries: [] });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.every(
        ([input]) => String(input) === "https://mcp.builder.io/mcp/publish",
      ),
    ).toBe(true);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer oauth-access-token",
      });
    }
  });

  it("caps Builder MCP browse reads at the provider page limit", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
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
                        id: "builder-entry-1",
                        lastUpdated: "2026-09-02T12:00:00.000Z",
                        data: { title: "Builder entry" },
                      },
                    ],
                    totalCount: 1,
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    const result = await readBuilderCmsContentEntries({
      model: "agent-native-blog-article-test",
      limit: 10_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const browseBody = JSON.parse(
      String((fetchImpl.mock.calls[2]?.[1] as RequestInit).body),
    );
    expect(browseBody.params.arguments.limit).toBe(100);
    expect(result).toMatchObject({
      state: "live",
      entries: [{ id: "builder-entry-1" }],
      progress: {
        requestedLimit: 10_000,
        pageSize: 100,
        fetchedEntryCount: 1,
        partial: false,
      },
    });
  });

  it("continues Builder Publish MCP reads beyond the first 100 entries", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
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
                    content: Array.from({ length: 100 }, (_, index) => ({
                      id: `builder-entry-${index + 1}`,
                      data: { title: `Builder entry ${index + 1}` },
                    })),
                    totalCount: 101,
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
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
                        id: "builder-entry-101",
                        data: { title: "Builder entry 101" },
                      },
                    ],
                    totalCount: 101,
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    const result = await readBuilderCmsContentEntries({
      model: "agent-native-blog-article-test",
      limit: 10_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      state: "live",
      progress: { fetchedEntryCount: 101, hasMore: false, partial: false },
    });
    expect(result.entries).toHaveLength(101);
    const secondPageBody = JSON.parse(
      String((fetchImpl.mock.calls[3]?.[1] as RequestInit).body),
    );
    expect(secondPageBody.params.arguments.offset).toBe(100);
  });

  it("advances MCP pagination by the provider window when entries are invalid", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
    const page = (content: unknown[], totalCount: number) =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          result: {
            content: [
              { type: "text", text: JSON.stringify({ content, totalCount }) },
            ],
          },
        }),
        { status: 200 },
      );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: { supportedVersions: ["2026-07-28"] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        page(
          [
            ...Array.from({ length: 99 }, (_, index) => ({
              id: `builder-entry-${index + 1}`,
              data: { title: `Builder entry ${index + 1}` },
            })),
            null,
          ],
          101,
        ),
      )
      .mockResolvedValueOnce(
        page([{ id: "builder-entry-101", data: { title: "Last entry" } }], 101),
      );

    const result = await readBuilderCmsContentEntries({
      model: "agent-native-blog-article-test",
      limit: 10_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      state: "live",
      message: null,
      progress: { nextOffset: 101, fetchedEntryCount: 100 },
      entries: expect.arrayContaining([
        expect.objectContaining({ id: "builder-entry-101" }),
      ]),
    });
    const secondPageBody = JSON.parse(
      String((fetchImpl.mock.calls[2]?.[1] as RequestInit).body),
    );
    expect(secondPageBody.params.arguments.offset).toBe(100);
  });

  it("rejects malformed Builder MCP tool content instead of accepting an empty source", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
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
            result: { content: [{ type: "text", text: "not json" }] },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsContentEntries({
        model: "agent-native-blog-article-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      entries: [],
      message: "Builder MCP browse returned malformed tool content.",
    });
  });

  it("surfaces Builder MCP JSON-RPC errors instead of returning an empty read", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
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
            error: { code: -32602, message: "limit must be at most 100" },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsContentEntries({
        model: "agent-native-blog-article-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      entries: [],
      message: "Builder MCP request failed: limit must be at most 100",
    });
  });

  it("surfaces Builder MCP tool-level errors instead of returning an empty read", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
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
              isError: true,
              content: [{ type: "text", text: "model access denied" }],
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsContentEntries({
        model: "agent-native-blog-article-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "error",
      entries: [],
      message: "Builder MCP tool failed: model access denied",
    });
  });

  it("hydrates an exact entry through MCP with OAuth-only authorization", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: { supportedVersions: ["2026-07-28"] },
          }),
          { status: 200 },
        ),
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
                        id: "builder-entry-1",
                        lastUpdated: "2026-06-08T12:00:00.000Z",
                        data: {
                          title: "OAuth hydration",
                          blocks: [{ id: "text-1" }],
                        },
                      },
                    ],
                    totalCount: 1,
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsContentEntry({
        model: "blog_article",
        entryId: "builder-entry-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      id: "builder-entry-1",
      rawEntry: { data: { title: "OAuth hydration" } },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer oauth-access-token",
      });
    }
    const [, entryInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(entryInit.body))).toMatchObject({
      method: "tools/call",
      params: {
        name: "browse_model_content",
        arguments: {
          modelName: "blog_article",
          limit: 100,
        },
      },
    });
  });

  it("hydrates an exact entry through the general query-data contract", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      if (input.pathname === "/api/v1/models") {
        return new Response(
          JSON.stringify({
            models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
          }),
          { status: 200 },
        );
      }
      expect(Object.fromEntries(input.searchParams)).toEqual({
        apiKey: "selected-space-key",
        "query.modelId": "model-uuid",
        "query.id": "builder-entry-1",
        "sort.id": "1",
        offset: "0",
        limit: "1",
        fetchTotalCount: "true",
        noCache: "true",
        cachebust: expect.stringMatching(/^\d+$/),
      });
      expect(init?.headers).toMatchObject({
        authorization: "Bearer general-oauth-token",
      });
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "builder-entry-1",
              modelId: "blog_article",
              data: { title: "OAuth hydration", blocks: [] },
            },
          ],
          totalCount: 1,
        }),
        { status: 200 },
      );
    });

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "builder-entry-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "found",
      providerStatus: "http_200",
      entry: { id: "builder-entry-1" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("discovers the model once across a run of entry reads, without caching a failed discovery", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    let modelReads = 0;
    const fetchImpl = vi.fn(async (input: URL) => {
      if (input.pathname === "/api/v1/models") {
        modelReads += 1;
        return modelReads === 1
          ? new Response(null, { status: 403 })
          : new Response(
              JSON.stringify({
                models: [
                  { id: "model-uuid", name: "blog_article", fields: [] },
                ],
              }),
              { status: 200 },
            );
      }
      const entryId = input.searchParams.get("query.id");
      return new Response(
        JSON.stringify({
          results: [{ id: entryId, modelId: "blog_article", data: {} }],
          totalCount: 1,
        }),
        { status: 200 },
      );
    });
    const read = (entryId: string) =>
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

    await expect(read("builder-entry-1")).rejects.toThrow();
    const results = [];
    for (const entryId of [
      "builder-entry-1",
      "builder-entry-2",
      "builder-entry-3",
    ]) {
      results.push(await read(entryId));
    }

    expect(results.map((result) => result.entry?.id)).toEqual([
      "builder-entry-1",
      "builder-entry-2",
      "builder-entry-3",
    ]);
    expect(modelReads).toBe(2);
  });

  it("retries transient general query-data failures before reading the entry", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const entryStatuses = [429, 502, 200];
    const fetchImpl = vi.fn(async (input: URL) => {
      if (input.pathname === "/api/v1/models") {
        return new Response(
          JSON.stringify({
            models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
          }),
          { status: 200 },
        );
      }
      const status = entryStatuses.shift() ?? 200;
      return status === 200
        ? new Response(
            JSON.stringify({
              results: [
                {
                  id: "builder-entry-1",
                  modelId: "model-uuid",
                  data: { title: "Recovered" },
                },
              ],
              totalCount: 1,
            }),
            { status: 200 },
          )
        : new Response(null, { status });
    });

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "builder-entry-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      state: "found",
      entry: { id: "builder-entry-1" },
    });
    expect(entryStatuses).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("keeps retry evidence when a general exact read stays rate limited", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) =>
      input.pathname === "/api/v1/models"
        ? new Response(
            JSON.stringify({
              models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
            }),
            { status: 200 },
          )
        : new Response(null, { status: 429 }),
    );

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "rate-limited-entry",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject<Partial<BuilderCmsContentEntryReadError>>({
      reason: "transient_read_failure",
      providerStatus: "http_429",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("hashes a general live preflight body the same way hydration does", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
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
      if (input.pathname === "/api/v1/models") {
        return new Response(
          JSON.stringify({
            models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
          }),
          { status: 200 },
        );
      }
      expect(input.searchParams.get("noCache")).toBe("true");
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "builder-entry-1",
              modelId: "model-uuid",
              published: "draft",
              lastUpdated: 1_786_000_000_000,
              data: { title: "Builder title", blocks: canonicalBlocks },
            },
          ],
          totalCount: 1,
        }),
        { status: 200 },
      );
    });

    const hydrated = await readBuilderCmsContentEntryResult({
      model: "blog_article",
      entryId: "builder-entry-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const live = await readBuilderCmsEntryLiveState({
      model: "blog_article",
      entryId: "builder-entry-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const hydratedRawEntry = hydrated.entry?.rawEntry;
    if (!hydratedRawEntry) throw new Error("Expected a hydrated Builder entry");
    const baselineHash = builderBlocksHash(
      builderEntryBlocks(hydratedRawEntry),
    );
    expect(baselineHash).toEqual(expect.any(String));
    expect(live).toMatchObject({
      exists: true,
      published: "draft",
      lastUpdated: "1786000000000",
      blocksHash: baselineHash,
      id: "builder-entry-1",
      values: expect.objectContaining({ "data.title": "Builder title" }),
    });
  });

  it("reports an empty general exact query as a 200 not-found result", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "missing-entry",
        fetchImpl: vi.fn(async (input: URL) =>
          input.pathname === "/api/v1/models"
            ? new Response(
                JSON.stringify({
                  models: [
                    { id: "model-uuid", name: "blog_article", fields: [] },
                  ],
                }),
                { status: 200 },
              )
            : new Response(JSON.stringify({ results: [], totalCount: 0 }), {
                status: 200,
              }),
        ) as unknown as typeof fetch,
      }),
    ).resolves.toEqual({
      state: "not_found",
      entry: null,
      providerStatus: "http_200_not_found",
    });
  });

  it("treats a present malformed general exact-query entry as invalid", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) =>
      input.pathname === "/api/v1/models"
        ? new Response(
            JSON.stringify({
              models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
            }),
            { status: 200 },
          )
        : new Response(
            JSON.stringify({
              results: [
                { modelId: "model-uuid", data: { title: "Malformed" } },
              ],
              totalCount: 1,
            }),
            { status: 200 },
          ),
    );

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "expected-entry",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject<Partial<BuilderCmsContentEntryReadError>>({
      reason: "malformed_body",
      providerStatus: "http_200_invalid_entry",
      retryable: false,
    });
  });

  it("rejects a wrong-ID result during the general OAuth live preflight", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) =>
      input.pathname === "/api/v1/models"
        ? new Response(
            JSON.stringify({
              models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
            }),
            { status: 200 },
          )
        : new Response(
            JSON.stringify({
              results: [{ id: "wrong-entry", modelId: "model-uuid" }],
              totalCount: 1,
            }),
            { status: 200 },
          ),
    );

    await expect(
      readBuilderCmsEntryLiveState({
        model: "blog_article",
        entryId: "expected-entry",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/unexpected entry payload/);
  });

  it("treats missing general query-data results as malformed, not not-found", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "general-oauth-token",
      authorization: "Bearer general-oauth-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space-key",
    });
    const fetchImpl = vi.fn(async (input: URL) =>
      input.pathname === "/api/v1/models"
        ? new Response(
            JSON.stringify({
              models: [{ id: "model-uuid", name: "blog_article", fields: [] }],
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ totalCount: 0 }), { status: 200 }),
    );

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "missing-entry",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject<Partial<BuilderCmsContentEntryReadError>>({
      reason: "malformed_body",
      retryable: false,
    });
  });

  it("does not bypass expired OAuth custody during hydration", async () => {
    resolveBuilderRequestAuthorizationMock.mockRejectedValue(
      new Error(
        "Builder.io access expired. Re-authorize Builder.io in Settings to continue.",
      ),
    );
    const fetchImpl = vi.fn();

    await expect(
      readBuilderCmsContentEntry({
        model: "blog_article",
        entryId: "builder-entry-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Builder.io access expired");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps OAuth hydration on Publish MCP", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: { supportedVersions: ["2026-07-28"] },
          }),
          { status: 200 },
        ),
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
                        id: "builder-entry-1",
                        data: { title: "OAuth hydration", blocks: [] },
                      },
                    ],
                    totalCount: 1,
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "builder-entry-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ state: "found", providerStatus: "mcp_200" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      fetchImpl.mock.calls.every(
        ([input]) => String(input) === "https://mcp.builder.io/mcp/publish",
      ),
    ).toBe(true);
  });

  it("hydrates an OAuth entry beyond the first MCP page", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: { supportedVersions: ["2026-07-28"] },
          }),
          { status: 200 },
        ),
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
                    content: Array.from({ length: 100 }, (_, index) => ({
                      id: `builder-entry-${index + 1}`,
                      data: { title: `Builder entry ${index + 1}` },
                    })),
                    totalCount: 101,
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
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
                        id: "builder-entry-101",
                        data: { title: "Builder entry 101", blocks: [] },
                      },
                    ],
                    totalCount: 101,
                  }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "builder-entry-101",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ state: "found", providerStatus: "mcp_200" });
    const secondPageBody = JSON.parse(
      String((fetchImpl.mock.calls[2]?.[1] as RequestInit).body),
    );
    expect(secondPageBody.params.arguments.offset).toBe(100);
  });

  it("classifies transient MCP hydration failures as retryable", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: { supportedVersions: ["2026-07-28"] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(
      readBuilderCmsContentEntryResult({
        model: "blog_article",
        entryId: "builder-entry-1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject<Partial<BuilderCmsContentEntryReadError>>({
      reason: "transient_read_failure",
      providerStatus: "mcp_transient_failure",
      retryable: true,
    });
  });

  it("continues Publish MCP reads from a saved offset", async () => {
    usePublishAuthorization();
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
                  text: JSON.stringify({ content: [], totalCount: 500 }),
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      readBuilderCmsContentEntries({
        model: "blog_article",
        limit: 500,
        offset: 500,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ state: "live", entries: [] });
    const body = JSON.parse(
      String((fetchImpl.mock.calls[2]?.[1] as RequestInit).body),
    );
    expect(body.params).toMatchObject({
      name: "browse_model_content",
      arguments: { offset: 500 },
    });
  });

  it("falls back to the 2024 MCP protocol when 2025 initialize is rejected", async () => {
    usePublishAuthorization();
    const initializeVersions: string[] = [];
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(
        typeof init?.body === "string"
          ? init.body
          : (JSON.stringify(init?.body) ?? ""),
      ) as {
        method: string;
        params?: {
          protocolVersion?: string;
          _meta?: Record<string, unknown>;
          name?: string;
        };
      };
      const headers = init?.headers as Record<string, string>;
      if (body.method === "server/discover") {
        expect(headers).not.toHaveProperty("mcp-method");
        expect(headers).not.toHaveProperty("mcp-protocol-version");
        expect(body.params?._meta).toBeUndefined();
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32601,
              message: "Method not found: server/discover",
            },
          }),
          { status: 200 },
        );
      }
      if (body.method === "initialize") {
        const protocolVersion = String(body.params?.protocolVersion);
        initializeVersions.push(protocolVersion);
        if (protocolVersion === "2025-11-25") {
          return new Response("unsupported protocol", { status: 400 });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
          headers: { "mcp-session-id": "legacy-session" },
        });
      }
      if (body.method === "notifications/initialized") {
        expect(headers["mcp-session-id"]).toBe("legacy-session");
        return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
          status: 200,
        });
      }
      expect(headers["mcp-session-id"]).toBe("legacy-session");
      expect(headers).not.toHaveProperty("mcp-protocol-version");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          result: {
            content: [{ type: "text", text: JSON.stringify({ models: [] }) }],
          },
        }),
        { status: 200 },
      );
    });

    await expect(
      listBuilderCmsModels({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ state: "live", models: [] });
    expect(initializeVersions).toEqual(["2025-11-25", "2024-11-05"]);
  });
});
