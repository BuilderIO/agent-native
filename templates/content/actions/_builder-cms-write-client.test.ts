import { EventEmitter } from "node:events";

import { resolveBuilderCredential } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
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
          body: { data: { title: "Created title" }, published: "draft" },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 201,
      entryId: "created-entry-1",
    });
  });

  it("returns structured non-2xx failures without leaking the key", async () => {
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ message: "Invalid payload" }), {
        status: 400,
      });
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
      responseBody: { message: "Invalid payload" },
      error: "Builder write request failed with HTTP 400.",
    });
    expect(JSON.stringify(result)).not.toContain("example-private-key");
  });

  it("falls back to node http transport when fetch throws", async () => {
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const writes: string[] = [];
    const requestImpl = vi.fn((url, options, callback) => {
      expect(url.href).toBe(
        "https://builder.io/api/v1/write/agent-native-blog-article-test/entry-1",
      );
      expect(options.method).toBe("PATCH");
      const request = new EventEmitter() as EventEmitter & {
        write: (chunk: string) => void;
        end: () => void;
      };
      request.write = (chunk: string) => {
        writes.push(chunk);
      };
      request.end = () => {};
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
      };
      response.statusCode = 200;
      queueMicrotask(() => {
        callback(response as never);
        response.emit("data", JSON.stringify({ id: "entry-1" }));
        response.emit("end");
      });
      return request as never;
    });

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
      ok: true,
      status: 200,
      entryId: "entry-1",
    });
    expect(writes).toEqual([JSON.stringify({ data: { title: "New title" } })]);
  });

  it("does not retry create POST writes after a transport error", async () => {
    resolveBuilderCredentialMock.mockResolvedValue("example-private-key");
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket closed after request body was sent");
    });
    const requestImpl = vi.fn();

    await expect(
      executeBuilderCmsWrite({
        request: {
          method: "POST",
          path: "/api/v1/write/agent-native-blog-article-test",
          body: { data: { title: "Created title" } },
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        nodeRequestImpl: requestImpl,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 0,
      error:
        "Builder write request failed: socket closed after request body was sent",
    });
    expect(requestImpl).not.toHaveBeenCalled();
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
