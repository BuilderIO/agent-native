import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertDeckScope: vi.fn(),
  downloadFont: vi.fn(),
  importFont: vi.fn(),
  storageReady: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("../server/lib/deck-asset-scope.js", () => ({
  assertDeckAssetUploadScope: (...args: unknown[]) =>
    mocks.assertDeckScope(...args),
}));

vi.mock("../server/lib/google-fonts.js", () => ({
  downloadGoogleFont: (...args: unknown[]) => mocks.downloadFont(...args),
  GoogleFontError: class GoogleFontError extends Error {},
}));

vi.mock("../server/lib/upload-storage-status.js", () => ({
  isSlides2UploadStorageReady: () => mocks.storageReady(),
}));

vi.mock("../server/lib/uploaded-fonts.js", () => ({
  importGoogleFontAsset: (...args: unknown[]) => mocks.importFont(...args),
  UploadedFontError: class UploadedFontError extends Error {},
}));

import action from "./import-google-font.js";

describe("import-google-font", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertDeckScope.mockResolvedValue(undefined);
    mocks.storageReady.mockResolvedValue(true);
    mocks.downloadFont.mockResolvedValue({
      family: "Inter",
      variant: "400",
      extension: "woff2",
      mimeType: "font/woff2",
      data: Buffer.from("wOF2"),
    });
    mocks.importFont.mockResolvedValue({
      assetId: "font-1",
      family: "Inter",
      variant: "400",
      mimeType: "font/woff2",
      url: "https://storage.example.test/fonts/inter.woff2",
      filename: "font-inter-400.woff2",
      size: 4,
    });
  });

  it("stops before external font requests when upload storage is unavailable", async () => {
    mocks.storageReady.mockResolvedValue(false);

    await expect(
      action.run({ deckId: "deck-1", family: "Inter", variant: "400" }),
    ).rejects.toMatchObject({
      errorCode: "google_font_storage_unavailable",
      statusCode: 503,
    });

    expect(mocks.assertDeckScope).toHaveBeenCalledWith({
      deckId: "deck-1",
      email: "owner@example.com",
      orgId: "org-1",
    });
    expect(mocks.downloadFont).not.toHaveBeenCalled();
    expect(mocks.importFont).not.toHaveBeenCalled();
  });

  it("stores a selected catalog variant and returns its registered handle", async () => {
    const result = await action.run({
      deckId: "deck-1",
      family: "Inter",
      variant: "400",
    });

    expect(mocks.downloadFont).toHaveBeenCalledWith("Inter", "400");
    expect(mocks.importFont).toHaveBeenCalledWith({
      email: "owner@example.com",
      orgId: "org-1",
      deckId: "deck-1",
      font: expect.objectContaining({ family: "Inter", variant: "400" }),
    });
    expect(result).toMatchObject({
      assetId: "font-1",
      family: "Inter",
      variant: "400",
      mimeType: "font/woff2",
      url: "https://storage.example.test/fonts/inter.woff2",
    });
  });
});
