import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptSecretValue: vi.fn(),
  readFile: vi.fn(),
  registerFileUploadProvider: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: mocks.readFile,
  rm: mocks.rm,
  writeFile: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  registerFileUploadProvider: mocks.registerFileUploadProvider,
}));

vi.mock("@agent-native/core/secrets/crypto", () => ({
  decryptSecretValue: mocks.decryptSecretValue,
  encryptSecretValue: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => "",
}));

vi.mock("./tenant-files.js", () => ({
  isHostedSlidesRuntime: () => false,
  tenantFileKey: () => "a".repeat(24),
}));

import {
  IMPORT_ASSET_PREFIX,
  localImportedAssetFileUploadProvider,
  localImportedAssetIdentity,
  readLocalImportedAsset,
} from "./import-asset-storage";

const descriptor = {
  kind: "slides-import-asset",
  version: 1,
  ownerKey: "a".repeat(24),
  id: "123e4567-e89b-12d3-a456-426614174000",
  filename: "image.png",
  mimeType: "image/png",
};

function localAssetUrl(token = `${IMPORT_ASSET_PREFIX}ciphertext`) {
  return `http://localhost/api/import-assets/${encodeURIComponent(token)}`;
}

describe("local imported asset cleanup", () => {
  beforeEach(() => {
    mocks.decryptSecretValue
      .mockReset()
      .mockReturnValue(JSON.stringify(descriptor));
    mocks.readFile.mockReset();
    mocks.registerFileUploadProvider.mockClear();
    mocks.rm.mockReset();
  });

  it("preserves filesystem deletion failures for the cleanup retry boundary", async () => {
    const deleteError = new Error("filesystem unavailable");
    mocks.rm.mockRejectedValue(deleteError);
    const deleteAsset = localImportedAssetFileUploadProvider.delete;
    if (!deleteAsset) throw new TypeError("Provider has no delete method.");

    await expect(
      deleteAsset({
        url: localAssetUrl(),
        id: descriptor.id,
      }),
    ).rejects.toBe(deleteError);
  });

  it("distinguishes a malformed local token from a non-local asset URL", () => {
    const decryptError = new Error("token cannot be decrypted");
    mocks.decryptSecretValue.mockImplementation(() => {
      throw decryptError;
    });

    expect(() => localImportedAssetIdentity(localAssetUrl())).toThrow(
      decryptError,
    );
    expect(
      localImportedAssetIdentity(localAssetUrl("not-a-local-asset-token")),
    ).toBe(null);
    expect(localImportedAssetIdentity("https://cdn.example/image.png")).toBe(
      null,
    );
  });

  it("treats only a missing local image as absent and propagates other read errors", async () => {
    const missingFileError = Object.assign(new Error("missing"), {
      code: "ENOENT",
    });
    mocks.readFile.mockRejectedValueOnce(missingFileError);

    await expect(
      readLocalImportedAsset({
        token: encodeURIComponent(`${IMPORT_ASSET_PREFIX}ciphertext`),
        email: "owner@example.com",
      }),
    ).resolves.toBe(null);

    const readError = new Error("filesystem unavailable");
    mocks.readFile.mockRejectedValueOnce(readError);
    await expect(
      readLocalImportedAsset({
        token: encodeURIComponent(`${IMPORT_ASSET_PREFIX}ciphertext`),
        email: "owner@example.com",
      }),
    ).rejects.toBe(readError);
  });
});
