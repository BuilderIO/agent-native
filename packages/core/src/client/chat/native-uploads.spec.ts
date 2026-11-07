import { AgentKitClient } from "@agent-native/agentkit/client";
import { persistableFilePart } from "@agent-native/agentkit/protocol";
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";
import {
  createAgentNativeUploadRuntime,
  fileUploadUrlForChatApi,
} from "./native-uploads.js";

describe("native AgentKit uploads", () => {
  it("uses the configured chat server for file uploads", () => {
    expect(
      fileUploadUrlForChatApi(
        "https://chat.example.test/base/_agent-native/agent-chat",
      ),
    ).toBe("https://chat.example.test/base/_agent-native/file-upload");
  });
  it.each(["create", "complete", "cancel"] as const)(
    "does not mix Core upload state with a custom %s operation",
    async (operation) => {
      const transport = createAgentNativeAgentKitTransport({
        operations:
          operation === "create"
            ? {
                createUpload: async () => ({
                  uploadId: "custom",
                  method: "PUT",
                  url: "https://storage.example.test/custom",
                }),
              }
            : operation === "complete"
              ? {
                  completeUpload: async () => ({
                    type: "file",
                    name: "custom",
                    url: "https://storage.example.test/custom",
                  }),
                }
              : { cancelUpload: async () => {} },
      });
      try {
        expect(transport.upload).toBeUndefined();
        expect(transport.capabilities?.uploads).toBe(false);
      } finally {
        await transport.dispose();
      }
    },
  );
  it("works through a bare AgentKit client without a host upload override", async () => {
    const file = new File(["bare client context"], "context.txt", {
      type: "text/plain",
    });
    let bytes = "";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (_url, init) => {
        if (init?.body instanceof FormData) {
          const body = init.body.get("file");
          if (!(body instanceof File))
            throw new Error("Expected multipart file");
          bytes = await body.text();
          return Response.json(
            { url: "https://storage.example.test/bare.txt" },
            { status: 201 },
          );
        }
        return Response.json({});
      }),
    });
    const client = new AgentKitClient({
      transport,
      transportOwnership: "owned",
    });
    try {
      const parts = await client.uploadFiles("thread", [
        { name: file.name, mediaType: file.type, size: file.size, body: file },
      ]);
      expect(bytes).toBe("bare client context");
      expect(parts).toEqual([
        {
          type: "file",
          name: "context.txt",
          mediaType: "text/plain",
          url: "https://storage.example.test/bare.txt",
        },
      ]);
    } finally {
      await client.shutdown();
    }
  });
  it.each([
    "https://storage.example.test/object",
    "http://127.0.0.1:5203/object",
  ])("preserves the provider-issued reference %s", async (url) => {
    const runtime = createAgentNativeUploadRuntime({
      fetch: vi.fn(async () => Response.json({ url })),
    });
    const target = await runtime.operations.createUpload({
      threadId: "thread",
      descriptor: {
        name: "context",
        mediaType: "text/plain",
        size: 1,
        purpose: "message",
      },
    });
    await runtime.upload(target, {
      name: "context",
      mediaType: "text/plain",
      size: 1,
      body: new Blob(["x"]),
    });
    const completed = await runtime.operations.completeUpload({
      threadId: "thread",
      uploadId: target.uploadId,
    });
    expect(completed).toMatchObject({ url });
    expect(persistableFilePart(completed)).toEqual(completed);
  });
  it.each([
    "data:text/plain,review",
    "blob:https://storage.example.test/object",
    "https://storage.example.test/object?version=one",
  ])("rejects non-durable upload response %s", async (url) => {
    const runtime = createAgentNativeUploadRuntime({
      fetch: vi.fn(async () => Response.json({ url })),
    });
    const target = await runtime.operations.createUpload({
      threadId: "thread",
      descriptor: {
        name: "context",
        mediaType: "text/plain",
        size: 1,
        purpose: "message",
      },
    });
    await expect(
      runtime.upload(target, {
        name: "context",
        mediaType: "text/plain",
        size: 1,
        body: new Blob(["x"]),
      }),
    ).rejects.toMatchObject({ code: "upload_invalid_response" });
    await expect(
      runtime.operations.completeUpload({
        threadId: "thread",
        uploadId: target.uploadId,
      }),
    ).rejects.toThrow();
    runtime.dispose();
  });
  it("uploads actual multipart bytes and completes only in the owning thread", async () => {
    const saved = new Map<string, string>();
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const file = (init?.body as FormData).get("file") as File;
        saved.set(file.name, await file.text());
        expect(new Headers(init?.headers).get("x-review-thread")).toBe(
          "thread-one",
        );
        return new Response(
          JSON.stringify({
            url: "https://storage.example.test/context.txt",
            id: "asset-one",
          }),
          { status: 201 },
        );
      },
    );
    const runtime = createAgentNativeUploadRuntime({
      fetch: fetcher,
      headers: async (threadId) => new Headers({ "x-review-thread": threadId }),
    });
    const file = new File(["actual attachment context"], "context.txt", {
      type: "text/plain",
    });
    const target = await runtime.operations.createUpload({
      threadId: "thread-one",
      descriptor: {
        name: file.name,
        mediaType: file.type,
        size: file.size,
        purpose: "message",
      },
    });
    await runtime.upload(target, {
      name: file.name,
      mediaType: file.type,
      size: file.size,
      body: file,
    });
    await expect(
      runtime.operations.completeUpload({
        threadId: "other-thread",
        uploadId: target.uploadId,
      }),
    ).rejects.toThrow();
    const part = await runtime.operations.completeUpload({
      threadId: "thread-one",
      uploadId: target.uploadId,
    });
    expect(saved.get("context.txt")).toBe("actual attachment context");
    expect(part).toEqual({
      type: "file",
      name: "context.txt",
      mediaType: "text/plain",
      url: "https://storage.example.test/context.txt",
      fileId: "asset-one",
    });
    await expect(
      runtime.operations.completeUpload({
        threadId: "thread-one",
        uploadId: target.uploadId,
      }),
    ).rejects.toThrow();
  });
  it.each([400, 401, 415, 408, 429, 503])(
    "preserves upload failure %s without a completed attachment",
    async (status) => {
      const runtime = createAgentNativeUploadRuntime({
        fetch: vi.fn(
          async () => new Response("untrusted upstream details", { status }),
        ),
      });
      const target = await runtime.operations.createUpload({
        threadId: "thread",
        descriptor: {
          name: "image.png",
          mediaType: "image/png",
          size: 4,
          purpose: "message",
        },
      });
      await expect(
        runtime.upload(target, {
          name: "image.png",
          mediaType: "image/png",
          size: 4,
          body: new Blob(["data"]),
        }),
      ).rejects.toMatchObject({
        status,
        retryable: status === 408 || status === 429 || status >= 500,
        code:
          status === 400
            ? "upload_http_400"
            : status === 401
              ? "upload_session_expired"
              : status === 415
                ? "upload_unsupported_type"
                : "upload_unavailable",
      });
      await expect(
        runtime.operations.completeUpload({
          threadId: "thread",
          uploadId: target.uploadId,
        }),
      ).rejects.toThrow();
      await runtime.operations.cancelUpload({
        threadId: "thread",
        uploadId: target.uploadId,
      });
    },
  );
  it("preserves a non-retryable Builder reconnect failure", async () => {
    const runtime = createAgentNativeUploadRuntime({
      fetch: vi.fn(async () =>
        Response.json(
          {
            errorCode: "builder_oauth_reauthorization_required",
            error: "untrusted server message",
          },
          { status: 503 },
        ),
      ),
    });
    const target = await runtime.operations.createUpload({
      threadId: "thread",
      descriptor: {
        name: "image.png",
        mediaType: "image/png",
        size: 4,
        purpose: "message",
      },
    });
    await expect(
      runtime.upload(target, {
        name: "image.png",
        mediaType: "image/png",
        size: 4,
        body: new Blob(["data"]),
      }),
    ).rejects.toMatchObject({
      code: "upload_builder_oauth_reauthorization_required",
      status: 503,
      retryable: false,
      message: "upload_builder_oauth_reauthorization_required",
    });
    runtime.dispose();
  });
  it("rejects oversized uploads and clears pending state on disposal", async () => {
    const runtime = createAgentNativeUploadRuntime();
    await expect(
      runtime.operations.createUpload({
        threadId: "thread",
        descriptor: {
          name: "large",
          mediaType: "text/plain",
          size: 26 * 1024 * 1024,
          purpose: "message",
        },
      }),
    ).rejects.toMatchObject({ code: "upload_too_large" });
    const target = await runtime.operations.createUpload({
      threadId: "thread",
      descriptor: {
        name: "small",
        mediaType: "text/plain",
        size: 1,
        purpose: "message",
      },
    });
    runtime.dispose();
    await expect(
      runtime.upload(target, {
        name: "small",
        mediaType: "text/plain",
        size: 1,
        body: new Blob(["x"]),
      }),
    ).rejects.toThrow();
  });
});
