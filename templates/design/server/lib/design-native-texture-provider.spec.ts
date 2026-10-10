import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readUploadedFile: vi.fn() }));
vi.mock("@agent-native/core/file-upload", () => ({
  FileUploadReadError: class FileUploadReadError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  readUploadedFile: mocks.readUploadedFile,
}));
vi.mock("./local-figma-qa-upload", () => ({
  isLocalFigmaQaUploadEnabled: () => false,
  LocalFigmaQaExportAssetError: class LocalFigmaQaExportAssetError extends Error {},
  readLocalFigmaQaAssetForExport: vi.fn(),
}));

import { FileUploadReadError } from "@agent-native/core/file-upload";

import {
  NativeTextureProviderError,
  readDesignNativeTextureProvider,
} from "./design-native-texture-provider";

describe("Design native texture provider", () => {
  it("preserves a configured HTTPS reader's unreadable failure", async () => {
    mocks.readUploadedFile.mockRejectedValueOnce(
      new FileUploadReadError("unreadable", "Provider body is unreadable."),
    );
    await expect(
      readDesignNativeTextureProvider(
        "https://owned.example.test/photo.png",
        "editor@example.test",
        1_000_000,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof NativeTextureProviderError &&
        error.code === "unreadable",
    );
    expect(mocks.readUploadedFile).toHaveBeenCalledWith({
      url: "https://owned.example.test/photo.png",
      ownerEmail: "editor@example.test",
      maxBytes: 1_000_000,
    });
  });
});
