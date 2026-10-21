import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import type { FileUploadInput } from "../file-upload/index.js";
import type { PrivateBlobProvider } from "./types.js";

const deleteUploadedFileMock = vi.hoisted(() => vi.fn());
const getActiveFileUploadProviderForRequestMock = vi.hoisted(() => vi.fn());
const uploadFileMock = vi.hoisted(() => vi.fn());

vi.mock("../file-upload/registry.js", () => ({
  deleteUploadedFile: deleteUploadedFileMock,
  getActiveFileUploadProviderForRequest:
    getActiveFileUploadProviderForRequestMock,
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
    deleteUploadedFileMock.mockReset();
    getActiveFileUploadProviderForRequestMock.mockReset();
    getActiveFileUploadProviderForRequestMock.mockResolvedValue(null);
    uploadFileMock.mockReset();
    resetAppConfigForTests();
  });

  afterEach(async () => {
    const registry = await import("./registry.js");
    resetAppConfigForTests();
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

    deleteUploadedFileMock.mockResolvedValue(true);
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
    await expect(registry.deletePrivateBlob(handle!)).resolves.toEqual({
      deleted: true,
      provider: "public-upload:builder",
    });
    expect(deleteUploadedFileMock).toHaveBeenCalledWith("builder", {
      url: "https://cdn.example.test/private/replay.bin?token=public",
      id: "asset-1",
    });
  });

  it("retries transient public-upload reads after upload propagation delays", async () => {
    const registry = await freshRegistry();
    let uploadedInput: FileUploadInput | null = null;
    uploadFileMock.mockImplementation(async (input: FileUploadInput) => {
      uploadedInput = input;
      return {
        url: "https://cdn.example.test/private/replay.bin",
        provider: "builder",
        id: "asset-1",
      };
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementationOnce(
        async () => new Response(uploadedInput?.data ?? new Uint8Array()),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementationOnce(
        async () => new Response(uploadedInput?.data ?? new Uint8Array()),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const putPromise = registry.putPrivateBlob({
      data: new TextEncoder().encode("hello"),
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const handle = await putPromise;
    const readPromise = registry.readPrivateBlob(handle!);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(readPromise).resolves.toMatchObject({ handle });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("does not return a reference for non-transient public-upload failures", async () => {
    const registry = await freshRegistry();
    uploadFileMock.mockResolvedValue({
      url: "https://cdn.example.test/private/replay.bin",
      provider: "builder",
      id: "asset-1",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      registry.putPrivateBlob({
        data: new TextEncoder().encode("hello"),
      }),
    ).rejects.toThrow("Private blob public-upload read failed (403)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can disable the encrypted public-upload fallback for local SQL storage", async () => {
    const registry = await freshRegistry();
    registry.setPrivateBlobPublicUploadFallbackEnabled(false);

    await expect(
      registry.putPrivateBlob({ data: new TextEncoder().encode("hello") }),
    ).resolves.toBeNull();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("disables the fallback from the declared environment alias", async () => {
    process.env.AGENT_NATIVE_PRIVATE_BLOB_PUBLIC_UPLOAD_FALLBACK = "0";
    const registry = await freshRegistry();
    resetAppConfigForTests();

    await expect(
      registry.putPrivateBlob({ data: new TextEncoder().encode("hello") }),
    ).resolves.toBeNull();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("selects the configured provider instead of the first registered one", async () => {
    const registry = await freshRegistry();
    resetAppConfigForTests();
    const handle = {
      id: "chosen:1",
      provider: "chosen",
      opaque: true as const,
      encrypted: false,
    };
    registry.registerPrivateBlobProvider({
      id: "first",
      name: "First",
      isConfigured: () => true,
      put: vi.fn(),
      read: vi.fn(),
      delete: vi.fn(),
    } as unknown as PrivateBlobProvider);
    registry.registerPrivateBlobProvider({
      id: "chosen",
      name: "Chosen",
      isConfigured: () => true,
      put: vi.fn(async () => handle),
      read: vi.fn(),
      delete: vi.fn(),
    } as unknown as PrivateBlobProvider);

    expect(registry.getActivePrivateBlobProvider()?.id).toBe("first");

    defineAppConfig({ privateBlob: { provider: "chosen" } });
    expect(registry.getActivePrivateBlobProvider()?.id).toBe("chosen");
    await expect(
      registry.putPrivateBlob({ data: new TextEncoder().encode("hello") }),
    ).resolves.toBe(handle);
  });

  it("selects providers configured by request-scoped credentials", async () => {
    const registry = await freshRegistry();
    resetAppConfigForTests();
    const handle = {
      id: "request:1",
      provider: "request",
      opaque: true as const,
      encrypted: false,
    };
    const provider: PrivateBlobProvider = {
      id: "request",
      name: "Request-scoped",
      isConfigured: () => false,
      isConfiguredForRequest: vi.fn(async () => true),
      put: vi.fn(async () => handle),
      read: vi.fn(),
      delete: vi.fn(),
    };
    registry.registerPrivateBlobProvider(provider);

    expect(registry.getActivePrivateBlobProvider()).toBeNull();
    await expect(
      registry.getActivePrivateBlobProviderForRequest(),
    ).resolves.toBe(provider);
    await expect(
      registry.putPrivateBlob({ data: new Uint8Array([1]) }),
    ).resolves.toBe(handle);
    expect(provider.isConfiguredForRequest).toHaveBeenCalledTimes(2);
  });

  it("honors request-scoped configuration for a selected provider", async () => {
    const registry = await freshRegistry();
    resetAppConfigForTests();
    const handle = {
      id: "chosen:1",
      provider: "chosen",
      opaque: true as const,
      encrypted: false,
    };
    const provider: PrivateBlobProvider = {
      id: "chosen",
      name: "Chosen",
      isConfigured: () => false,
      isConfiguredForRequest: async () => true,
      put: vi.fn(async () => handle),
      read: vi.fn(),
      delete: vi.fn(),
    };
    registry.registerPrivateBlobProvider(provider);
    defineAppConfig({ privateBlob: { provider: "chosen" } });

    await expect(
      registry.putPrivateBlob({ data: new Uint8Array([1]) }),
    ).resolves.toBe(handle);
  });

  it("reports private blob readiness through its configured write path", async () => {
    const registry = await freshRegistry();
    defineAppConfig({ privateBlob: { publicUploadFallback: true } });
    getActiveFileUploadProviderForRequestMock.mockResolvedValue({ id: "s3" });

    await expect(registry.isPrivateBlobConfiguredForRequest()).resolves.toBe(
      true,
    );
    await expect(
      registry.getPrivateBlobStorageReadinessForRequest(),
    ).resolves.toEqual({ configured: true, providerId: "s3" });

    getActiveFileUploadProviderForRequestMock.mockResolvedValue(null);
    await expect(registry.isPrivateBlobConfiguredForRequest()).resolves.toBe(
      false,
    );
    await expect(
      registry.getPrivateBlobStorageReadinessForRequest(),
    ).resolves.toEqual({ configured: false, providerId: null });

    defineAppConfig({ privateBlob: { publicUploadFallback: false } });
    getActiveFileUploadProviderForRequestMock.mockResolvedValue({ id: "s3" });
    await expect(registry.isPrivateBlobConfiguredForRequest()).resolves.toBe(
      false,
    );

    const provider: PrivateBlobProvider = {
      id: "private",
      name: "Private",
      isConfigured: () => true,
      put: vi.fn(),
      read: vi.fn(),
      delete: vi.fn(),
    };
    registry.registerPrivateBlobProvider(provider);
    await expect(registry.isPrivateBlobConfiguredForRequest()).resolves.toBe(
      true,
    );
    await expect(
      registry.getPrivateBlobStorageReadinessForRequest(),
    ).resolves.toEqual({ configured: true, providerId: "private" });
  });

  it("fails loudly when the selected provider is unavailable", async () => {
    const registry = await freshRegistry();
    resetAppConfigForTests();
    registry.registerPrivateBlobProvider({
      id: "offline",
      name: "Offline",
      isConfigured: () => false,
      put: vi.fn(),
      read: vi.fn(),
      delete: vi.fn(),
    });
    defineAppConfig({ privateBlob: { provider: "offline" } });

    expect(() => registry.getActivePrivateBlobProvider()).toThrow(
      "selected but not configured",
    );
    await expect(
      registry.putPrivateBlob({ data: new Uint8Array([1]) }),
    ).rejects.toThrow("selected but not configured");
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("fails loudly when the configured provider is not registered", async () => {
    const registry = await freshRegistry();
    resetAppConfigForTests();
    defineAppConfig({ privateBlob: { provider: "missing" } });

    expect(() => registry.getActivePrivateBlobProvider()).toThrow(
      /no provider with that id is registered/,
    );
  });

  describe("typed failures", () => {
    async function putThenBreakStore(
      registry: Awaited<ReturnType<typeof freshRegistry>>,
    ) {
      let uploaded: FileUploadInput | null = null;
      uploadFileMock.mockImplementation(async (input: FileUploadInput) => {
        uploaded = input;
        return {
          url: "https://cdn.example.test/private/blob.bin",
          provider: "builder",
          id: "asset-1",
        };
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(uploaded?.data ?? new Uint8Array())),
      );
      const handle = await registry.putPrivateBlob({
        data: new TextEncoder().encode("hello"),
      });
      return { handle: handle!, bytes: uploaded!.data };
    }

    it.each([
      [404, "not_found"],
      [410, "gone"],
      [403, "unavailable"],
      [500, "unavailable"],
    ])("classifies a %i from the object store as %s", async (status, kind) => {
      const registry = await freshRegistry();
      const { handle } = await putThenBreakStore(registry);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status })),
      );
      vi.useFakeTimers();

      const read = registry.readPrivateBlob(handle).catch((error) => error);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(read).resolves.toMatchObject({
        privateBlobError: true,
        kind,
        status,
      });
      vi.useRealTimers();
    });

    it("classifies a dropped connection as unavailable, not as a missing object", async () => {
      const registry = await freshRegistry();
      const { handle } = await putThenBreakStore(registry);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("fetch failed");
        }),
      );
      vi.useFakeTimers();

      const read = registry.readPrivateBlob(handle).catch((error) => error);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(read).resolves.toMatchObject({ kind: "unavailable" });
      vi.useRealTimers();
    });

    it("classifies bytes that fail authentication as corrupt", async () => {
      const registry = await freshRegistry();
      const { handle } = await putThenBreakStore(registry);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(new Uint8Array([9, 9, 9, 9]))),
      );

      await expect(registry.readPrivateBlob(handle)).rejects.toMatchObject({
        kind: "corrupt",
      });
    });

    it("classifies a handle no registered provider can serve as not configured", async () => {
      const registry = await freshRegistry();

      await expect(
        registry.readPrivateBlob({
          id: "s3:1",
          provider: "s3",
          opaque: true,
          encrypted: false,
        }),
      ).rejects.toMatchObject({ kind: "not_configured" });
      await expect(
        registry.deletePrivateBlob({
          id: "s3:1",
          provider: "s3",
          opaque: true,
          encrypted: false,
        }),
      ).rejects.toMatchObject({ kind: "not_configured" });
    });
  });

  describe("specialized providers", () => {
    function memoryProvider(
      id: string,
      overrides: Partial<PrivateBlobProvider> = {},
    ): PrivateBlobProvider {
      const handle = {
        id: `${id}:1`,
        provider: id,
        opaque: true as const,
        encrypted: false,
      };
      return {
        id,
        name: id,
        isConfigured: () => true,
        put: vi.fn(async () => handle),
        read: vi.fn(async () => ({ data: new Uint8Array(), handle })),
        delete: vi.fn(async () => ({ deleted: true, provider: id })),
        ...overrides,
      };
    }

    it("sends only the puts a provider claims to it", async () => {
      const registry = await freshRegistry();
      const logos = memoryProvider("logos", {
        handles: (request) => request.metadata?.purpose === "logo",
      });
      const general = memoryProvider("general");
      registry.registerPrivateBlobProvider(logos);
      registry.registerPrivateBlobProvider(general);

      await expect(
        registry.putPrivateBlob({
          data: new Uint8Array([1]),
          mimeType: "application/json",
          metadata: { purpose: "app-activity", recordingId: "rec-1" },
        }),
      ).resolves.toMatchObject({ provider: "general" });
      await expect(
        registry.putPrivateBlob({
          data: new Uint8Array([1]),
          mimeType: "image/png",
          metadata: { purpose: "logo", organizationId: "org-1" },
        }),
      ).resolves.toMatchObject({ provider: "logos" });
      expect(registry.getActivePrivateBlobProvider()?.id).toBe("general");
      await expect(
        registry.getActivePrivateBlobProviderForRequest(),
      ).resolves.toMatchObject({ id: "general" });
    });

    it("sends claimed puts to the provider config selects", async () => {
      const registry = await freshRegistry();
      resetAppConfigForTests();
      registry.registerPrivateBlobProvider(
        memoryProvider("logos", {
          handles: (request) => request.metadata?.purpose === "logo",
        }),
      );
      registry.registerPrivateBlobProvider(memoryProvider("general"));
      registry.registerPrivateBlobProvider(memoryProvider("chosen"));
      defineAppConfig({ privateBlob: { provider: "chosen" } });

      await expect(
        registry.putPrivateBlob({
          data: new Uint8Array([1]),
          mimeType: "image/png",
          metadata: { purpose: "logo", organizationId: "org-1" },
        }),
      ).resolves.toMatchObject({ provider: "chosen" });
    });

    it("falls back to the general provider when a claiming provider isn't configured", async () => {
      const registry = await freshRegistry();
      registry.registerPrivateBlobProvider(
        memoryProvider("logos", {
          handles: () => true,
          isConfigured: () => false,
          isConfiguredForRequest: async () => false,
        }),
      );
      registry.registerPrivateBlobProvider(memoryProvider("general"));

      await expect(
        registry.putPrivateBlob({
          data: new Uint8Array([1]),
          metadata: { purpose: "logo" },
        }),
      ).resolves.toMatchObject({ provider: "general" });
    });

    it("doesn't report a claiming provider as ready private storage", async () => {
      const registry = await freshRegistry();
      registry.setPrivateBlobPublicUploadFallbackEnabled(false);
      registry.registerPrivateBlobProvider(
        memoryProvider("logos", { handles: () => true }),
      );

      await expect(
        registry.getPrivateBlobStorageReadinessForRequest(),
      ).resolves.toMatchObject({ configured: false });
    });
  });

  describe("range reads and read links", () => {
    const handle = {
      id: "memory:1",
      provider: "memory",
      opaque: true as const,
      encrypted: false,
    };

    function wholeReadProvider(): PrivateBlobProvider {
      return {
        id: "memory",
        name: "Memory",
        isConfigured: () => true,
        put: vi.fn(async () => handle),
        read: vi.fn(async () => ({
          data: new TextEncoder().encode("0123456789"),
          handle,
        })),
        delete: vi.fn(async () => ({ deleted: true, provider: "memory" })),
      };
    }

    it("slices a whole read when the provider can't read ranges", async () => {
      const registry = await freshRegistry();
      registry.registerPrivateBlobProvider(wholeReadProvider());

      const result = await registry.readPrivateBlobRange(handle, {
        start: 2,
        end: 4,
      });
      expect(new TextDecoder().decode(result.data)).toBe("234");
      expect(result.range).toEqual({ start: 2, end: 4, size: 10 });

      const tail = await registry.readPrivateBlobRange(handle, {
        start: 7,
        end: 99,
      });
      expect(new TextDecoder().decode(tail.data)).toBe("789");
      expect(tail.range).toEqual({ start: 7, end: 9, size: 10 });

      const open = await registry.readPrivateBlobRange(handle, { start: 8 });
      expect(new TextDecoder().decode(open.data)).toBe("89");
    });

    it("rejects malformed ranges and ranges past the end", async () => {
      const registry = await freshRegistry();
      const { PrivateBlobRangeError } = await import("./errors.js");
      registry.registerPrivateBlobProvider(wholeReadProvider());

      await expect(
        registry.readPrivateBlobRange(handle, { start: 5, end: 4 }),
      ).rejects.toBeInstanceOf(PrivateBlobRangeError);
      await expect(
        registry.readPrivateBlobRange(handle, { start: -1 }),
      ).rejects.toBeInstanceOf(PrivateBlobRangeError);
      await expect(
        registry.readPrivateBlobRange(handle, { start: 10 }),
      ).rejects.toMatchObject({ size: 10 });
    });

    it("uses the provider's own range read when it has one", async () => {
      const registry = await freshRegistry();
      const readRange = vi.fn(async () => ({
        data: new Uint8Array([1]),
        handle,
        range: { start: 3, end: 3, size: 10 },
      }));
      const provider = { ...wholeReadProvider(), readRange };
      registry.registerPrivateBlobProvider(provider);

      await registry.readPrivateBlobRange(handle, { start: 3, end: 3 });
      expect(readRange).toHaveBeenCalledWith(handle, { start: 3, end: 3 });
      expect(provider.read).not.toHaveBeenCalled();
    });

    it("returns a read link only from providers that can sign one", async () => {
      const registry = await freshRegistry();
      registry.registerPrivateBlobProvider(wholeReadProvider());
      await expect(
        registry.getPrivateBlobReadUrl(handle, { expiresInSeconds: 60 }),
      ).resolves.toBeNull();

      registry.unregisterPrivateBlobProvider("memory");
      const link = {
        url: "https://bucket.example.test/blob?X-Amz-Signature=abc",
        expiresAt: "2026-10-21T00:01:00.000Z",
      };
      registry.registerPrivateBlobProvider({
        ...wholeReadProvider(),
        getReadUrl: vi.fn(async () => link),
      });
      await expect(
        registry.getPrivateBlobReadUrl(handle, { expiresInSeconds: 60 }),
      ).resolves.toBe(link);
      await expect(
        registry.getPrivateBlobReadUrl(
          { ...handle, provider: "public-upload:builder" },
          { expiresInSeconds: 60 },
        ),
      ).resolves.toBeNull();
    });
  });
});
