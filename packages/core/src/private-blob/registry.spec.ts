import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileUploadInput } from "../file-upload/index.js";
import type { PrivateBlobProvider } from "./types.js";

const uploadFileMock = vi.hoisted(() => vi.fn());

vi.mock("../file-upload/index.js", () => ({
  uploadFile: uploadFileMock,
}));

const originalEnv = { ...process.env };

async function freshRegistry() {
  vi.resetModules();
  return import("./registry.js");
}

describe("private blob registry", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SECRETS_ENCRYPTION_KEY: "private-blob-test",
    };
    uploadFileMock.mockReset();
  });

  afterEach(async () => {
    const registry = await import("./registry.js");
    registry.setPrivateBlobPublicUploadFallbackEnabled(true);
    for (const provider of registry.listPrivateBlobProviders()) {
      registry.unregisterPrivateBlobProvider(provider.id);
    }
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("dispatches put/read/delete through a configured private provider", async () => {
    const registry = await freshRegistry();
    const handle = {
      id: "memory:1",
      provider: "memory",
      opaque: true as const,
      encrypted: false,
    };
    const provider: PrivateBlobProvider = {
      id: "memory",
      name: "Memory",
      isConfigured: () => true,
      put: vi.fn(async () => handle),
      read: vi.fn(async () => ({
        data: new TextEncoder().encode("hello"),
        handle,
      })),
      delete: vi.fn(async () => ({ deleted: true, provider: "memory" })),
    };
    registry.registerPrivateBlobProvider(provider);

    await expect(
      registry.putPrivateBlob({ data: new TextEncoder().encode("hello") }),
    ).resolves.toBe(handle);
    await expect(registry.readPrivateBlob(handle)).resolves.toMatchObject({
      handle,
    });
    await expect(registry.deletePrivateBlob(handle)).resolves.toEqual({
      deleted: true,
      provider: "memory",
    });
  });

  it("wraps public uploads in encrypted opaque handles without exposing URLs", async () => {
    const registry = await freshRegistry();
    let uploadedInput: FileUploadInput | null = null;
    uploadFileMock.mockImplementation(async (input: FileUploadInput) => {
      uploadedInput = input;
      return {
        url: "https://cdn.example.test/private/replay.bin?token=public",
        provider: "builder",
        id: "asset-1",
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(uploadedInput?.data ?? new Uint8Array())),
    );

    const original = new TextEncoder().encode("secret replay payload");
    const handle = await registry.putPrivateBlob({
      data: original,
      filename: "replay.json",
      mimeType: "application/json",
      metadata: { kind: "session-replay" },
    });

    expect(handle).toMatchObject({
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
      mimeType: "application/json",
      metadata: { kind: "session-replay" },
    });
    expect(JSON.stringify(handle)).not.toContain("cdn.example.test");
    expect(JSON.stringify(handle)).not.toContain("token=public");
    expect(Buffer.from(uploadedInput!.data).toString("utf8")).not.toContain(
      "secret replay payload",
    );
    expect(uploadedInput).toMatchObject({
      recordAsset: false,
    });

    const read = await registry.readPrivateBlob(handle!);
    expect(new TextDecoder().decode(read.data)).toBe("secret replay payload");
    await expect(registry.deletePrivateBlob(handle!)).resolves.toMatchObject({
      deleted: false,
      provider: "public-upload:builder",
      reason: expect.stringContaining("not supported"),
    });
  });

  it("can disable the encrypted public-upload fallback for local SQL storage", async () => {
    const registry = await freshRegistry();
    registry.setPrivateBlobPublicUploadFallbackEnabled(false);

    await expect(
      registry.putPrivateBlob({ data: new TextEncoder().encode("hello") }),
    ).resolves.toBeNull();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });
});
