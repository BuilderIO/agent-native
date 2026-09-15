import { resolveBuilderRequestAuthorization } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BUILDER_CMS_WRITE_TIMEOUT_MS,
  executeBuilderCmsWrite,
  extractBuilderCmsWriteEntryId,
} from "./_builder-cms-write-client";

vi.mock("@agent-native/core/server", () => ({
  BUILDER_CONTENT_WRITE_SCOPE: "builder:content:write",
  BUILDER_OAUTH_RESOURCE: "https://api.builder.io",
  resolveBuilderRequestAuthorization: vi.fn(),
}));

const resolveBuilderRequestAuthorizationMock = vi.mocked(
  resolveBuilderRequestAuthorization,
);

function useLegacyWriteAuthorization(token = "example-private-key") {
  resolveBuilderRequestAuthorizationMock.mockResolvedValue({
    token,
    authorization: `Bearer ${token}`,
    source: "legacy",
  });
}

describe("Builder CMS write client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BUILDER_CONTENT_API_HOST;
    delete process.env.BUILDER_CMS_API_HOST;
    resolveBuilderRequestAuthorizationMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call Builder when private credentials are not configured", async () => {
    const fetchImpl = vi.fn();

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "PATCH",
          path: "/api/v1/write/agent-native-blog-article-test/entry-1",
          query: { autoSaveOnly: "true" },
          body: { data: { title: "New title" } },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 0,
      responseBody: null,
      error: "Builder write access is not connected.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
      oauthResource: "general",
      requiredScope: "builder:content:write",
      legacyCredentialKeys: ["BUILDER_PRIVATE_KEY", "BUILDER_CMS_PRIVATE_KEY"],
    });
  });

  it("sends PATCH writes to the configured Builder host with bearer auth", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://builder-write.test/";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "example-private-key",
      authorization: "Bearer example-private-key",
      source: "legacy",
    });
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.href).toBe(
        "https://builder-write.test/api/v1/write/agent-native-blog-article-test/entry-1?autoSaveOnly=true&triggerWebhooks=false",
      );
      expect(init?.method).toBe("PATCH");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        authorization: "Bearer example-private-key",
        "content-type": "application/json",
      });
      expect(
        JSON.parse(
          typeof init?.body === "string"
            ? init.body
            : (JSON.stringify(init?.body) ?? ""),
        ),
      ).toEqual({
        data: { title: "New title" },
      });
      return new Response(JSON.stringify({ id: "entry-1" }), {
        status: 200,
      });
    });

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "PATCH",
          path: "/api/v1/write/agent-native-blog-article-test/entry-1",
          query: { autoSaveOnly: "true", triggerWebhooks: "false" },
          body: { data: { title: "New title" } },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      entryId: "entry-1",
      responseBody: { id: "entry-1" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the general OAuth grant for the existing Write API without a key fallback", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space",
      oauthConnectionId: "connection-1",
    });
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.href).toBe(
        "https://api.builder.io/api/v1/write/blog-article/entry-1?autoSaveOnly=true",
      );
      expect(init?.headers).toMatchObject({
        authorization: "Bearer oauth-access-token",
      });
      return new Response(JSON.stringify({ id: "entry-1" }), { status: 200 });
    });

    await expect(
      executeBuilderCmsWrite({
        expectedSourceSpace: "selected-space",
        expectedSourceConnectionId: "connection-1",
        request: {
          method: "PATCH",
          path: "/api/v1/write/blog-article/entry-1",
          query: { autoSaveOnly: "true" },
          body: { data: { title: "Reviewed title" } },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ ok: true, entryId: "entry-1" });
    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledTimes(1);
  });

  it("requires the guarded committed response contract", async () => {
    useLegacyWriteAuthorization();
    const request = {
      method: "PATCH" as const,
      path: "/api/v1/write/blog-article/entry-1",
      body: {
        id: "entry-1",
        ownerId: "selected-space",
        modelId: "model-uuid",
        data: { title: "Reviewed title" },
        __write: { version: "opaque-version-1" },
      },
    };

    await expect(
      executeBuilderCmsWrite({
        request,
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ id: "entry-1" }), { status: 200 }),
        ) as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: false,
      ambiguity: "provider",
      responseBody: null,
      error:
        "Builder guarded write returned a malformed response after dispatch; remote outcome is unknown.",
    });

    await expect(
      executeBuilderCmsWrite({
        request,
        fetchImpl: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                committed: true,
                content: {
                  id: "entry-1",
                  ownerId: "selected-space",
                  modelId: "model-uuid",
                  data: { title: "Reviewed title" },
                },
                editableContent: {
                  id: "entry-1",
                  ownerId: "selected-space",
                  modelId: "model-uuid",
                  data: { title: "Reviewed title", pendingOnly: "preserved" },
                },
                autosaveIds: ["autosave-2"],
                writeSnapshot: null,
                superseded: false,
                readback: "unavailable",
              }),
              { status: 200 },
            ),
        ) as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: true,
      committed: true,
      entryId: "entry-1",
      writeSnapshot: null,
      superseded: false,
      readback: "unavailable",
    });

    const matchedContent = {
      id: "entry-1",
      ownerId: "selected-space",
      modelId: "model-uuid",
      data: { title: "Reviewed title" },
    };
    const matchedEditable = {
      ...matchedContent,
      data: { ...matchedContent.data, pendingOnly: "preserved" },
    };
    await expect(
      executeBuilderCmsWrite({
        request,
        fetchImpl: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                committed: true,
                content: matchedContent,
                editableContent: matchedEditable,
                autosaveIds: [],
                writeSnapshot: {
                  version: "opaque-version-2",
                  content: matchedContent,
                  editableContent: matchedEditable,
                  autosaveId: null,
                  autosaveCreatedDate: null,
                  hasPendingAutosave: true,
                },
                superseded: false,
                readback: "matched",
              }),
              { status: 200 },
            ),
        ) as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: true,
      entryId: "entry-1",
      readback: "matched",
      writeSnapshot: { version: "opaque-version-2" },
    });

    await expect(
      executeBuilderCmsWrite({
        request,
        fetchImpl: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                committed: true,
                content: { ...matchedContent, ownerId: "other-space" },
                editableContent: matchedEditable,
                autosaveIds: [],
                writeSnapshot: null,
                superseded: false,
                readback: "unavailable",
              }),
              { status: 200 },
            ),
        ) as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ ok: false, ambiguity: "provider" });
  });

  it("surfaces the guarded conflict code as a safe no-retry conflict", async () => {
    useLegacyWriteAuthorization();
    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "PATCH",
          path: "/api/v1/write/blog-article/entry-1",
          body: {
            id: "entry-1",
            ownerId: "selected-space",
            modelId: "model-uuid",
            __write: { version: "stale-version" },
          },
        },
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ code: "CONTENT_WRITE_CONFLICT" }), {
              status: 409,
            }),
        ) as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 409,
      error:
        "Builder content changed after review. Refresh and review the change again.",
    });
  });

  it("rejects a guarded request whose raw owner does not match its bound source", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space",
      oauthConnectionId: "connection-1",
    });
    const fetchImpl = vi.fn();

    await expect(
      executeBuilderCmsWrite({
        expectedSourceSpace: "selected-space",
        expectedSourceConnectionId: "connection-1",
        requireSourceBinding: true,
        request: {
          method: "PATCH",
          path: "/api/v1/write/blog-article/entry-1",
          body: {
            id: "entry-1",
            ownerId: "other-space",
            modelId: "model-uuid",
            __write: { version: "opaque-version" },
          },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/does not match its bound entry, model, and space/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["wrong_snapshot_identity", "changed_with_snapshot"] as const)(
    "treats incoherent guarded acknowledgement %s as an unknown outcome",
    async (variant) => {
      useLegacyWriteAuthorization();
      const content = {
        id: "entry-1",
        ownerId: "selected-space",
        modelId: "model-uuid",
        data: { title: "Reviewed" },
      };
      const snapshotContent =
        variant === "wrong_snapshot_identity"
          ? { ...content, modelId: "other-model" }
          : content;
      const snapshot = {
        version: "opaque-version-2",
        content: snapshotContent,
        editableContent: content,
        autosaveId: null,
        autosaveCreatedDate: null,
        hasPendingAutosave: false,
      };

      await expect(
        executeBuilderCmsWrite({
          request: {
            method: "PATCH",
            path: "/api/v1/write/blog-article/entry-1",
            body: {
              ...content,
              __write: { version: "opaque-version-1" },
            },
          },
          fetchImpl: vi.fn(
            async () =>
              new Response(
                JSON.stringify({
                  committed: true,
                  content,
                  editableContent: content,
                  autosaveIds: [],
                  writeSnapshot: snapshot,
                  superseded: variant === "changed_with_snapshot",
                  readback:
                    variant === "changed_with_snapshot" ? "changed" : "matched",
                }),
                { status: 200 },
              ),
          ) as unknown as typeof fetch,
        }),
      ).resolves.toMatchObject({ ok: false, ambiguity: "provider" });
    },
  );

  it("preserves a non-Source OAuth write caller without inventing a Source binding", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "selected-space",
      oauthConnectionId: "connection-1",
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "entry-1" }), { status: 200 }),
    );

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "PATCH",
          path: "/api/v1/write/blog-article/entry-1",
          body: { data: { title: "Reviewed title" } },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ ok: true, entryId: "entry-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch an OAuth write for a different or unbound source space", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "oauth-access-token",
      authorization: "Bearer oauth-access-token",
      source: "oauth",
      oauthResource: "general",
      oauthSelectedPublicKey: "connected-space",
      oauthConnectionId: "connection-1",
    });
    const fetchImpl = vi.fn();
    const request = {
      method: "PATCH" as const,
      path: "/api/v1/write/blog-article/entry-1",
      body: { data: { title: "Reviewed title" } },
    };

    await expect(
      executeBuilderCmsWrite({
        request,
        expectedSourceSpace: "source-space",
        expectedSourceConnectionId: "connection-1",
        requireSourceBinding: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/does not match this Content source/);
    await expect(
      executeBuilderCmsWrite({
        request,
        expectedSourceConnectionId: "connection-1",
        requireSourceBinding: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not bound to its connected space/);
    await expect(
      executeBuilderCmsWrite({
        request,
        expectedSourceSpace: "connected-space",
        expectedSourceConnectionId: "different-connection",
        requireSourceBinding: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/credential does not match/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not downgrade an OAuth-bound Source write to a legacy key", async () => {
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "legacy-private-key",
      authorization: "Bearer legacy-private-key",
      source: "legacy",
      legacyCredentialKey: "BUILDER_PRIVATE_KEY",
    });
    const fetchImpl = vi.fn();

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "PATCH",
          path: "/api/v1/write/blog-article/entry-1",
          body: { data: { title: "Reviewed title" } },
        },
        expectedSourceSpace: "selected-space",
        expectedSourceConnectionId: "oauth-connection-1",
        requireSourceBinding: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/OAuth connection is unavailable/);
    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "PATCH",
          path: "/api/v1/write/blog-article/entry-1",
          body: { data: { title: "Reviewed title" } },
        },
        requireSourceBinding: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/OAuth connection is unavailable/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to BUILDER_CMS_PRIVATE_KEY and sends POST writes", async () => {
    process.env.BUILDER_CMS_API_HOST = "https://cms-write.test";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "example-cms-private-key",
      authorization: "Bearer example-cms-private-key",
      source: "legacy",
    });
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.href).toBe(
        "https://cms-write.test/api/v1/write/agent-native-blog-article-test?triggerWebhooks=false",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer example-cms-private-key",
      });
      expect(
        JSON.parse(
          typeof init?.body === "string"
            ? init.body
            : (JSON.stringify(init?.body) ?? ""),
        ),
      ).toEqual({
        name: "Created title",
        data: { title: "Created title" },
        published: "draft",
      });
      return new Response(
        JSON.stringify({ result: { id: "created-entry-1" } }),
        { status: 201 },
      );
    });

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "POST",
          path: "/api/v1/write/agent-native-blog-article-test",
          query: { triggerWebhooks: "false" },
          body: {
            name: "Created title",
            data: { title: "Created title" },
            published: "draft",
          },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 201,
      entryId: "created-entry-1",
    });
  });

  it("returns safe validation detail without leaking the key", async () => {
    useLegacyWriteAuthorization();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ message: "Blurb must be at least 110 characters" }),
        { status: 400 },
      );
    });

    const result = await executeBuilderCmsWrite({
      request: {
        method: "PATCH",
        path: "/api/v1/write/agent-native-blog-article-test/entry-1",
        body: { data: { title: "New title" } },
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      responseBody: { message: "Blurb must be at least 110 characters" },
      error: "Builder validation failed: Blurb must be at least 110 characters",
    });
    expect(JSON.stringify(result)).not.toContain("example-private-key");
  });

  it("does not expose arbitrary upstream error text", async () => {
    useLegacyWriteAuthorization();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ message: "Database failed for user@example.com" }),
        { status: 400 },
      );
    });

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "PATCH",
          path: "/api/v1/write/agent-native-blog-article-test/entry-1",
          body: { data: { title: "New title" } },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      error: "Builder write request failed with HTTP 400.",
    });
  });

  it("treats provider server errors as ambiguous without exposing their body", async () => {
    useLegacyWriteAuthorization();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          message: "Validation failed for customer alice@example.com",
        }),
        { status: 500 },
      );
    });

    const result = await executeBuilderCmsWrite({
      request: {
        method: "PATCH",
        path: "/api/v1/write/agent-native-blog-article-test/entry-1",
        body: { data: { title: "New title" } },
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      responseBody: null,
      ambiguity: "provider",
      error:
        "Builder returned HTTP 500 after the write was dispatched; remote outcome is unknown.",
    });
    expect(result.error).not.toContain("alice@example.com");
    expect(JSON.stringify(result)).not.toContain("alice@example.com");
    expect(result.entryId).toBeUndefined();
  });

  it("does not dispatch a second PATCH after an ambiguous fetch failure", async () => {
    useLegacyWriteAuthorization();
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const requestImpl = vi.fn();

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "PATCH",
          path: "/api/v1/write/agent-native-blog-article-test/entry-1",
          body: { data: { title: "New title" } },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        nodeRequestImpl: requestImpl,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 0,
      ambiguity: "transport",
      error:
        "Builder write transport failed after dispatch; remote outcome is unknown.",
    });
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it("does not retry create POST writes after a transport error", async () => {
    useLegacyWriteAuthorization();
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket closed after request body was sent");
    });
    const requestImpl = vi.fn();

    const result = await executeBuilderCmsWrite({
      request: {
        method: "POST",
        path: "/api/v1/write/agent-native-blog-article-test",
        body: { data: { title: "Created title" } },
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nodeRequestImpl: requestImpl,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 0,
      ambiguity: "transport",
      error: expect.stringContaining("remote outcome is unknown"),
    });
    expect(JSON.stringify(result)).not.toContain("socket closed");
    expect(requestImpl).not.toHaveBeenCalled();
  });

  it("bounds provider calls and reports timeout ambiguity", async () => {
    useLegacyWriteAuthorization();
    const fetchImpl = vi.fn(
      async (_input: URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "POST",
          path: "/api/v1/write/agent-native-blog-article-test",
          body: { data: { title: "Created title" } },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 5,
      }),
    ).resolves.toMatchObject({
      ok: false,
      ambiguity: "timeout",
      error: expect.stringContaining("remote outcome is unknown"),
    });
  });

  it("allows slow hosted Builder writes up to the 30-second provider window", async () => {
    vi.useFakeTimers();
    useLegacyWriteAuthorization();
    const fetchImpl = vi.fn(
      async (_input: URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const resultPromise = executeBuilderCmsWrite({
      request: {
        method: "PATCH",
        path: "/api/v1/write/agent-native-blog-article-test/entry-1",
        body: { published: "published" },
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    let settled = false;
    void resultPromise.finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_BUILDER_CMS_WRITE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      ambiguity: "timeout",
      error: `Builder write timed out after ${DEFAULT_BUILDER_CMS_WRITE_TIMEOUT_MS}ms; remote outcome is unknown.`,
    });
  });

  it("extracts entry ids from common Builder response envelopes", () => {
    expect(extractBuilderCmsWriteEntryId({ id: "direct-id" })).toBe(
      "direct-id",
    );
    expect(
      extractBuilderCmsWriteEntryId({ result: { entryId: "nested-id" } }),
    ).toBe("nested-id");
    expect(extractBuilderCmsWriteEntryId({ data: { uuid: "uuid-id" } })).toBe(
      "uuid-id",
    );
  });
});
