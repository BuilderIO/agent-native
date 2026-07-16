import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecretValue } from "../secrets/crypto.js";

const blob = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@vercel/blob", () => blob);

const originalEnv = { ...process.env };

async function provider() {
  vi.resetModules();
  return (await import("./vercel.js")).vercelPrivateBlobProvider;
}

function setTokenConfiguration() {
  process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.BLOB_STORE_ID;
}

describe("Vercel private blob provider", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SECRETS_ENCRYPTION_KEY: "vercel-private-blob-test",
    };
    blob.del.mockReset();
    blob.get.mockReset();
    blob.put.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("detects only a supported Vercel Blob credential path", async () => {
    const subject = await provider();
    expect(subject.isConfigured()).toBe(false);

    process.env.VERCEL_OIDC_TOKEN = "test-oidc";
    expect(subject.isConfigured()).toBe(false);
    process.env.BLOB_STORE_ID = "store_test";
    expect(subject.isConfigured()).toBe(true);

    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.BLOB_STORE_ID;
    process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
    expect(subject.isConfigured()).toBe(true);
  });

  it("uses private access and seals the provider URL into an opaque handle", async () => {
    setTokenConfiguration();
    blob.put.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/private-object",
      contentType: "application/json",
    });
    const subject = await provider();
    const handle = await subject.put({
      data: new TextEncoder().encode("private payload"),
      filename: "alice-private-notes.json",
      ownerEmail: "alice@example.test",
      mimeType: "application/json",
      metadata: { category: "test" },
    });

    expect(blob.put).toHaveBeenCalledWith(
      expect.stringMatching(/^agent-native\/private-blobs\/v1\/[0-9a-f-]+$/),
      expect.any(Buffer),
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
        token: "test-blob-token",
      }),
    );
    expect(JSON.stringify(handle)).not.toContain("vercel-storage.com");
    expect(JSON.stringify(handle)).not.toContain("alice-private-notes");
    expect(handle).toMatchObject({
      provider: "vercel-blob",
      opaque: true,
      encrypted: false,
      size: 15,
      mimeType: "application/json",
      metadata: { category: "test" },
    });
  });

  it("authenticates reads, returns bytes, and deletes only after Vercel succeeds", async () => {
    setTokenConfiguration();
    blob.put.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/private-object",
      contentType: "text/plain",
    });
    blob.get.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("round trip"));
          controller.close();
        },
      }),
      blob: { contentType: "text/plain" },
    });
    blob.del.mockResolvedValue(undefined);
    const subject = await provider();
    const handle = await subject.put({
      data: new TextEncoder().encode("round trip"),
      mimeType: "text/plain",
    });

    await expect(subject.read(handle)).resolves.toMatchObject({
      data: new TextEncoder().encode("round trip"),
      handle,
    });
    expect(blob.get).toHaveBeenCalledWith(
      "https://store.public.blob.vercel-storage.com/private-object",
      { access: "private", token: "test-blob-token" },
    );
    await expect(subject.delete(handle)).resolves.toEqual({
      deleted: true,
      provider: "vercel-blob",
    });
    expect(blob.del).toHaveBeenCalledWith(
      "https://store.public.blob.vercel-storage.com/private-object",
      { token: "test-blob-token" },
    );
  });

  it("rejects malformed handles, missing blobs, and delete failures", async () => {
    setTokenConfiguration();
    const subject = await provider();
    const malformed = {
      id: "vercel-blob:v1:not-a-valid-descriptor",
      provider: "vercel-blob",
      opaque: true as const,
      encrypted: false,
    };
    await expect(subject.read(malformed)).rejects.toThrow(
      "descriptor is invalid",
    );

    const wrongVersion = {
      ...malformed,
      id: `vercel-blob:v1:${encryptSecretValue(
        JSON.stringify({
          kind: "agent-native.private-blob.vercel",
          version: 2,
          url: "https://store.public.blob.vercel-storage.com/private-object",
          size: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      )}`,
    };
    await expect(subject.read(wrongVersion)).rejects.toThrow(
      "descriptor is invalid",
    );

    blob.put.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/private-object",
      contentType: "text/plain",
    });
    const handle = await subject.put({ data: new Uint8Array([1]) });
    blob.get.mockResolvedValue(null);
    await expect(subject.read(handle)).rejects.toThrow("was not found");
    blob.del.mockRejectedValue(new Error("provider unavailable"));
    await expect(subject.delete(handle)).rejects.toThrow(
      "provider unavailable",
    );
  });
});
