import { resolveBuilderCredential } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BUILDER_CMS_WRITE_TIMEOUT_MS,
  executeBuilderCmsWrite,
  extractBuilderCmsWriteEntryId,
} from "./_builder-cms-write-client";

vi.mock("@agent-native/core/server", () => ({
  resolveBuilderCredential: vi.fn(),
}));

const resolveBuilderCredentialMock = vi.mocked(resolveBuilderCredential);

describe("Builder CMS write client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BUILDER_CONTENT_API_HOST;
    delete process.env.BUILDER_CMS_API_HOST;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call Builder when private credentials are not configured", async () => {
    resolveBuilderCredentialMock.mockResolvedValue(null);
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
      error: "Builder private key is not configured.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolveBuilderCredentialMock).toHaveBeenCalledWith(
      "BUILDER_PRIVATE_KEY",
    );
    expect(resolveBuilderCredentialMock).toHaveBeenCalledWith(
      "BUILDER_CMS_PRIVATE_KEY",
    );
  });

  it("sends PATCH writes to the configured Builder host with bearer auth", async () => {
    process.env.BUILDER_CONTENT_API_HOST = "https://builder-write.test/";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_PRIVATE_KEY" ? "example-private-key" : null,
    );
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
      expect(JSON.parse(String(init?.body))).toEqual({
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

  it("falls back to BUILDER_CMS_PRIVATE_KEY and sends POST writes", async () => {
    process.env.BUILDER_CMS_API_HOST = "https://cms-write.test";
    resolveBuilderCredentialMock.mockImplementation(async (key) =>
      key === "BUILDER_CMS_PRIVATE_KEY" ? "example-cms-private-key" : null,
    );
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.href).toBe(
        "https://cms-write.test/api/v1/write/agent-native-blog-article-test?triggerWebhooks=false",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer example-cms-private-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
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
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
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
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
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
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
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
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
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
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
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
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
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
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
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
