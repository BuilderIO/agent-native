import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLocalImportedAsset: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  resolveAccess: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: mocks.track,
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "local@example.com"),
}));

vi.mock("../server/db/index.js", () => ({}));

vi.mock("../server/lib/import-asset-storage.js", () => ({
  readLocalImportedAsset: mocks.readLocalImportedAsset,
}));

import { fetchImageAsBase64 } from "./export-pptx";

const LOCAL_ASSET_URL = "/api/import-assets/test-token";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

describe("fetchImageAsBase64 local imported assets", () => {
  beforeEach(() => {
    mocks.readLocalImportedAsset.mockReset();
    mocks.ssrfSafeFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an oversized local asset before base64 conversion", async () => {
    mocks.readLocalImportedAsset.mockResolvedValue({
      data: new Uint8Array(MAX_IMAGE_BYTES + 1),
      mimeType: "image/png",
    });

    await expect(
      fetchImageAsBase64(LOCAL_ASSET_URL, "local@example.com"),
    ).rejects.toMatchObject({ errorCode: "pptx_image_size_limit" });

    expect(mocks.readLocalImportedAsset).toHaveBeenCalledWith({
      token: "test-token",
      email: "local@example.com",
    });
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("counts local bytes toward the export aggregate without double-counting failures", async () => {
    mocks.readLocalImportedAsset.mockResolvedValue({
      data: new Uint8Array([17]),
      mimeType: "image/png",
    });
    const budget = { totalBytes: MAX_TOTAL_BYTES - 1 };

    await expect(
      fetchImageAsBase64(LOCAL_ASSET_URL, "local@example.com", budget),
    ).resolves.toBe("data:image/png;base64,EQ==");
    expect(budget.totalBytes).toBe(MAX_TOTAL_BYTES);

    await expect(
      fetchImageAsBase64(LOCAL_ASSET_URL, "local@example.com", budget),
    ).rejects.toMatchObject({ errorCode: "pptx_image_size_limit" });
    expect(budget.totalBytes).toBe(MAX_TOTAL_BYTES);
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });
});
