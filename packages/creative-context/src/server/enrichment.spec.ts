import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendVersion: vi.fn(),
  availableFamilies: vi.fn(),
  getActiveEmbeddingSet: vi.fn(),
  getCreativeContext: vi.fn(),
  readMedia: vi.fn(),
  fingerprintMedia: vi.fn(),
  extractDominantColors: vi.fn(),
}));

vi.mock("@agent-native/core/ingestion", () => ({
  fingerprintMedia: mocks.fingerprintMedia,
  extractDominantColors: mocks.extractDominantColors,
}));

vi.mock("../embeddings/providers.js", () => ({
  availableEmbeddingFamilies: mocks.availableFamilies,
}));

vi.mock("../store/index.js", () => ({
  appendMediaEnrichmentVersion: mocks.appendVersion,
  getActiveEmbeddingSet: mocks.getActiveEmbeddingSet,
  getCreativeContextItem: vi.fn(),
  recordEmbeddingMetadata: vi.fn(),
}));

vi.mock("./context.js", () => ({
  getCreativeContext: mocks.getCreativeContext,
}));

vi.mock("./media.js", () => ({
  readCreativeContextMedia: mocks.readMedia,
}));

import { enrichCreativeContextMedia } from "./enrichment.js";

describe("creative context media enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readMedia.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      itemId: "item-1",
      itemVersionId: "version-1",
      mediaId: "media-1",
      media: {
        caption: null,
        ocrText: null,
      },
    });
    mocks.fingerprintMedia.mockReturnValue({ sha256: "image-hash" });
    mocks.extractDominantColors.mockResolvedValue(["#663399"]);
    mocks.availableFamilies.mockResolvedValue([]);
    mocks.getActiveEmbeddingSet.mockResolvedValue(null);
    mocks.appendVersion.mockResolvedValue({
      itemId: "item-1",
      itemVersionId: "version-2",
      mediaId: "media-2",
      appended: true,
    });
    mocks.getCreativeContext.mockReturnValue({
      vectorAdapter: null,
      projections: undefined,
      enrichment: {
        captionImage: vi.fn(async () => "A purple dashboard"),
        ocrImage: vi.fn(async () => "Ship faster"),
      },
    });
  });

  it("writes enrichment as a new immutable version and returns its ids", async () => {
    await expect(
      enrichCreativeContextMedia({ mediaId: "media-1" }),
    ).resolves.toMatchObject({
      mediaId: "media-2",
      itemId: "item-1",
      itemVersionId: "version-2",
      versionAppended: true,
      caption: "A purple dashboard",
      ocrText: "Ship faster",
      palette: ["#663399"],
    });
    expect(mocks.appendVersion).toHaveBeenCalledWith({
      mediaId: "media-1",
      palette: ["#663399"],
      contentHash: "image-hash",
      caption: "A purple dashboard",
      captionStatus: "complete",
      ocrText: "Ship faster",
    });
  });
});
