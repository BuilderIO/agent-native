import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrivateBlobHandle } from "../private-blob/types.js";
import type { ProtectedCiphertextProvider } from "./types.js";

const coordinate = {
  kind: "object",
  vaultId: "vault:test-0001",
  objectId: "object:test-0001",
  revisionId: "revision:test-0001",
  part: "header",
} as const;

async function freshRegistry() {
  vi.resetModules();
  return import("./registry.js");
}

describe("protected ciphertext registry", () => {
  beforeEach(async () => {
    const registry = await import("./registry.js");
    for (const provider of registry.listProtectedCiphertextProviders()) {
      registry.unregisterProtectedCiphertextProvider(provider.id);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed without a configured provider or fallback", async () => {
    const registry = await freshRegistry();
    await expect(
      registry.putProtectedCiphertext({
        coordinate,
        ciphertext: new Uint8Array([1, 2, 3]),
        expectedByteLength: 3,
      }),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextStorageUnavailableError",
    });
  });

  it("rejects duplicate provider registration instead of replacing identity", async () => {
    const registry = await freshRegistry();
    const provider: ProtectedCiphertextProvider = {
      id: "memory-protected-v1",
      name: "Memory",
      isConfigured: () => true,
      put: vi.fn(),
      read: vi.fn(),
      delete: vi.fn(),
    };
    registry.registerProtectedCiphertextProvider(provider);
    expect(() =>
      registry.registerProtectedCiphertextProvider({
        ...provider,
        name: "Replacement",
      }),
    ).toThrow(/already registered/i);
    expect(registry.listProtectedCiphertextProviders()).toEqual([provider]);
  });

  it("validates coordinates and exact byte length before provider dispatch", async () => {
    const registry = await freshRegistry();
    const provider: ProtectedCiphertextProvider = {
      id: "memory-protected-v1",
      name: "Memory",
      isConfigured: () => true,
      put: vi.fn(),
      read: vi.fn(),
      delete: vi.fn(),
    };
    registry.registerProtectedCiphertextProvider(provider);

    await expect(
      registry.putProtectedCiphertext({
        coordinate,
        ciphertext: new Uint8Array([1, 2, 3]),
        expectedByteLength: 2,
      }),
    ).rejects.toMatchObject({ name: "ProtectedCiphertextLengthMismatchError" });
    await expect(
      registry.putProtectedCiphertext({
        coordinate: { ...coordinate, objectId: "../../private" },
        ciphertext: new Uint8Array([1]),
        expectedByteLength: 1,
      }),
    ).rejects.toThrow();
    expect(provider.put).not.toHaveBeenCalled();
  });

  it("keeps protected locators and legacy private-blob handles mutually unusable", async () => {
    const protectedRegistry = await freshRegistry();
    const protectedLocator = {
      kind: "agent-native.protected-ciphertext" as const,
      version: 1 as const,
      provider: "memory-protected-v1",
      opaque: true as const,
      coordinate,
    };
    const provider: ProtectedCiphertextProvider = {
      id: protectedLocator.provider,
      name: "Memory",
      isConfigured: () => true,
      put: vi.fn(),
      read: vi.fn(async () => ({
        locator: protectedLocator,
        ciphertext: new Uint8Array([1]),
        byteLength: 1,
      })),
      delete: vi.fn(async () => ({
        deleted: true,
        provider: protectedLocator.provider,
      })),
    };
    protectedRegistry.registerProtectedCiphertextProvider(provider);

    const legacy = await import("../private-blob/registry.js");
    await expect(
      legacy.readPrivateBlob(protectedLocator as unknown as PrivateBlobHandle),
    ).rejects.toThrow();
    await expect(
      legacy.deletePrivateBlob(
        protectedLocator as unknown as PrivateBlobHandle,
      ),
    ).rejects.toThrow();

    const legacyHandle: PrivateBlobHandle = {
      id: "legacy-private:fixture",
      provider: "legacy-private",
      opaque: true,
      encrypted: false,
    };
    await expect(
      protectedRegistry.readProtectedCiphertext(legacyHandle),
    ).rejects.toThrow();
    await expect(
      protectedRegistry.deleteProtectedCiphertext(legacyHandle),
    ).rejects.toThrow();
    expect(provider.read).not.toHaveBeenCalled();
    expect(provider.delete).not.toHaveBeenCalled();
  });

  it("uses typed failure when the active provider lacks prefix deletion", async () => {
    const registry = await freshRegistry();
    registry.registerProtectedCiphertextProvider({
      id: "memory-protected-v1",
      name: "Memory",
      isConfigured: () => true,
      put: vi.fn(),
      read: vi.fn(),
      delete: vi.fn(),
    });
    await expect(
      registry.deleteProtectedCiphertextPrefix({
        scope: "vault",
        vaultId: coordinate.vaultId,
      }),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextStorageUnavailableError",
    });
  });

  it("reconstructs reads and deletes from coordinates with exactly one provider", async () => {
    const registry = await freshRegistry();
    const provider: ProtectedCiphertextProvider = {
      id: "memory-protected-v1",
      name: "Memory",
      isConfigured: () => true,
      put: vi.fn(),
      read: vi.fn(async (locator) => ({
        locator,
        ciphertext: new Uint8Array([8]),
        byteLength: 1,
      })),
      delete: vi.fn(async () => ({
        deleted: true,
        provider: "memory-protected-v1",
      })),
    };
    registry.registerProtectedCiphertextProvider(provider);

    await expect(
      registry.readProtectedCiphertextAt(coordinate),
    ).resolves.toMatchObject({
      ciphertext: new Uint8Array([8]),
    });
    await expect(
      registry.deleteProtectedCiphertextAt(coordinate),
    ).resolves.toEqual({
      deleted: true,
      provider: provider.id,
    });
    expect(provider.read).toHaveBeenCalledWith(
      expect.objectContaining({ provider: provider.id, coordinate }),
    );
    expect(provider.delete).toHaveBeenCalledWith(
      expect.objectContaining({ provider: provider.id, coordinate }),
    );
  });

  it("fails coordinate reads and deletes with no configured provider", async () => {
    const registry = await freshRegistry();
    await expect(
      registry.readProtectedCiphertextAt(coordinate),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextStorageUnavailableError",
    });
    await expect(
      registry.deleteProtectedCiphertextAt(coordinate),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextStorageUnavailableError",
    });
  });

  it("rejects ambiguous configured providers instead of selecting by registration order", async () => {
    const registry = await freshRegistry();
    for (const id of ["memory-protected-a", "memory-protected-b"]) {
      registry.registerProtectedCiphertextProvider({
        id,
        name: id,
        isConfigured: () => true,
        put: vi.fn(),
        read: vi.fn(),
        delete: vi.fn(),
      });
    }
    expect(() => registry.getActiveProtectedCiphertextProvider()).toThrow(
      "More than one protected ciphertext provider",
    );
    await expect(
      registry.putProtectedCiphertext({
        coordinate,
        ciphertext: new Uint8Array([1]),
        expectedByteLength: 1,
      }),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextProviderAmbiguousError",
    });
    await expect(
      registry.readProtectedCiphertextAt(coordinate),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextProviderAmbiguousError",
    });
    await expect(
      registry.deleteProtectedCiphertextAt(coordinate),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextProviderAmbiguousError",
    });
  });
});
