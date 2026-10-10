import { beforeEach, describe, expect, it, vi } from "vitest";

const { readDesignNativeTextureAsset } = vi.hoisted(() => ({
  readDesignNativeTextureAsset: vi.fn(),
}));
vi.mock("./design-native-texture-assets", () => ({
  DesignNativeTextureAssetError: class DesignNativeTextureAssetError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  parseDesignNativeTexturePath: (path: string) =>
    /^\/api\/design-native-texture\/[a-f0-9-]{36}\.png$/.test(path)
      ? { id: path.slice(-40, -4), mimeType: "image/png" }
      : null,
  readDesignNativeTextureAsset,
}));
vi.mock("@agent-native/core/file-upload", () => ({
  FileUploadReadError: class FileUploadReadError extends Error {},
  readUploadedFile: vi.fn(),
}));

import {
  ExportAssetError,
  loadPublicExportAssets,
} from "./design-export-assets";

const root = process.cwd();
const nativePath =
  "/api/design-native-texture/12345678-1234-4123-8123-123456789abc.png";

describe("standalone export resolves Design native textures", () => {
  beforeEach(() => {
    readDesignNativeTextureAsset.mockReset();
  });

  it("packages exact access-checked bytes under the original local path", async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71]);
    readDesignNativeTextureAsset.mockResolvedValue({
      mimeType: "image/png",
      bytes,
    });
    expect(await loadPublicExportAssets(root, [nativePath])).toEqual({
      [nativePath]: { mimeType: "image/png", bytes },
    });
    expect(readDesignNativeTextureAsset).toHaveBeenCalledWith(
      nativePath,
      1_000_000,
    );
  });

  it("keeps an unreadable texture provider distinct from a missing export asset", async () => {
    const { DesignNativeTextureAssetError } =
      await import("./design-native-texture-assets");
    readDesignNativeTextureAsset.mockRejectedValueOnce(
      new DesignNativeTextureAssetError(
        "unreadable",
        "Provider body unreadable",
      ),
    );
    await expect(loadPublicExportAssets(root, [nativePath])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExportAssetError && error.code === "unreadable",
    );
  });

  it("rejects malformed native references before public-file fallback", async () => {
    await expect(
      loadPublicExportAssets(root, [nativePath + "?swap=1"]),
    ).rejects.toMatchObject({ code: "invalid-reference" });
    expect(readDesignNativeTextureAsset).not.toHaveBeenCalled();
  });

  it("preserves access failures and export's total byte bound", async () => {
    readDesignNativeTextureAsset.mockRejectedValueOnce(
      new Error("simulated failure"),
    );
    await expect(loadPublicExportAssets(root, [nativePath])).rejects.toThrow(
      "simulated failure",
    );
    const bytes = new Uint8Array(900_000);
    readDesignNativeTextureAsset.mockResolvedValue({
      mimeType: "image/png",
      bytes,
    });
    const paths = [0, 1, 2, 3, 4].map(
      (i) =>
        `/api/design-native-texture/12345678-1234-4123-8123-123456789ab${i}.png`,
    );
    await expect(loadPublicExportAssets(root, paths)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExportAssetError && error.code === "limit",
    );
  });
});
