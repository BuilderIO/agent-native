import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/file-upload", () => ({
  FileUploadReadError: class FileUploadReadError extends Error {},
  readUploadedFile: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: vi.fn() }));
vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: { designNativeTextureAssets: {}, designFiles: {} },
}));

import {
  DesignNativeTextureAssetError,
  designNativeTexturePath,
  parseDesignNativeTexturePath,
  readDesignNativeTextureAsset,
  validateDesignNativeTextureBytes,
  type DesignNativeTextureReadDependencies,
} from "./design-native-texture-assets";
import { NativeTextureProviderError } from "./design-native-texture-provider-policy";

const id = "12345678-1234-4123-8123-123456789abc";
const path = designNativeTexturePath(id, "image/png");
const bytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Xq8AAAAASUVORK5CYII=",
    "base64",
  ),
);
const sha256 = createHash("sha256").update(bytes).digest("hex");

function dependencies(): DesignNativeTextureReadDependencies {
  return {
    lookupAsset: vi.fn(async () => ({
      id,
      designId: "design-a",
      fileId: "file-a",
      uploaderEmail: "editor@example.test",
      ownerEmail: "owner@example.test",
      orgId: "org-a",
      visibility: "private" as const,
      providerUrl: "https://owned.example.test/image.png",
      mimeType: "image/png",
      byteLength: bytes.byteLength,
      sha256,
      idempotencyKey: "once",
      createdAt: null,
    })),
    canReadDesign: vi.fn(async () => true),
    fileInDesign: vi.fn(async () => true),
    readProvider: vi.fn(async () => ({ mimeType: "image/png", data: bytes })),
  };
}

function code(error: unknown): string | undefined {
  return error instanceof DesignNativeTextureAssetError
    ? error.code
    : undefined;
}

describe("Design-native texture access and exact bytes", () => {
  it("returns a root-relative versionless identity and verified provider bytes", async () => {
    const deps = dependencies();
    expect(path).toBe(`/api/design-native-texture/${id}.png`);
    expect(parseDesignNativeTexturePath(path)).toEqual({
      id,
      mimeType: "image/png",
    });
    expect(validateDesignNativeTextureBytes("image/png", bytes)).toBe(sha256);
    expect(await readDesignNativeTextureAsset(path, 1_000_000, deps)).toEqual({
      mimeType: "image/png",
      bytes,
    });
    expect(deps.readProvider).toHaveBeenCalledWith(
      "https://owned.example.test/image.png",
      "editor@example.test",
      1_000_000,
    );
  });

  it("rejects cross-design access and a file no longer in that Design before provider read", async () => {
    const deps = dependencies();
    deps.canReadDesign = vi.fn(async () => false);
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, deps),
    ).rejects.toSatisfy((error: unknown) => code(error) === "forbidden");
    expect(deps.readProvider).not.toHaveBeenCalled();
    deps.canReadDesign = vi.fn(async () => true);
    deps.fileInDesign = vi.fn(async () => false);
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, deps),
    ).rejects.toSatisfy((error: unknown) => code(error) === "not-found");
    expect(deps.readProvider).not.toHaveBeenCalled();
  });

  it("rejects wrong digest, changed bytes, provider failure and export byte cap", async () => {
    const deps = dependencies();
    deps.readProvider = vi.fn(async () => ({
      mimeType: "image/png",
      data: Uint8Array.from([
        ...bytes.slice(0, -1),
        bytes[bytes.length - 1]! ^ 1,
      ]),
    }));
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, deps),
    ).rejects.toSatisfy((error: unknown) => code(error) === "mismatch");
    deps.readProvider = vi.fn(async () => {
      throw new NativeTextureProviderError("unavailable", "provider down");
    });
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, deps),
    ).rejects.toSatisfy((error: unknown) => code(error) === "unavailable");
    deps.readProvider = vi.fn(async () => {
      throw new NativeTextureProviderError(
        "unreadable",
        "provider body unreadable",
      );
    });
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, deps),
    ).rejects.toSatisfy((error: unknown) => code(error) === "unreadable");
    const unexpected = new Error("unexpected provider failure");
    deps.readProvider = vi.fn(async () => {
      throw unexpected;
    });
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, deps),
    ).rejects.toBe(unexpected);
    deps.lookupAsset = vi.fn(async () => ({
      id,
      designId: "design-a",
      fileId: "file-a",
      uploaderEmail: "editor@example.test",
      ownerEmail: "owner@example.test",
      orgId: "org-a",
      visibility: "private" as const,
      providerUrl: "https://owned.example.test/image.png",
      mimeType: "image/png",
      byteLength: 1_000_001,
      sha256,
      idempotencyKey: "once",
      createdAt: null,
    }));
    await expect(
      readDesignNativeTextureAsset(path, 1_000_000, deps),
    ).rejects.toSatisfy((error: unknown) => code(error) === "limit");
  });

  it("rejects a raster header with dimensions beyond the GPU input bound", () => {
    const oversized = Uint8Array.from(bytes);
    oversized.set([0, 0, 20, 0], 16);
    expect(() =>
      validateDesignNativeTextureBytes("image/png", oversized),
    ).toThrowError(DesignNativeTextureAssetError);
  });

  it("refuses alias extensions and malformed paths", async () => {
    const deps = dependencies();
    await expect(
      readDesignNativeTextureAsset(
        path.replace(".png", ".jpg"),
        1_000_000,
        deps,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => code(error) === "invalid-reference",
    );
    await expect(
      readDesignNativeTextureAsset(`${path}?redirect=1`, 1_000_000, deps),
    ).rejects.toSatisfy(
      (error: unknown) => code(error) === "invalid-reference",
    );
  });
});
