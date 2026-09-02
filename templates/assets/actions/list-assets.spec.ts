import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const requireLibraryMock = vi.hoisted(() => vi.fn());

vi.mock("../server/db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/db/index.js")>()),
  getDb: getDbMock,
}));

vi.mock("./_helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_helpers.js")>()),
  requireLibrary: requireLibraryMock,
}));

import { serializeAssetListItem } from "./_helpers.js";
import action from "./list-assets.js";

describe("list-assets schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireLibraryMock.mockResolvedValue({ id: "lib-1", title: "Library" });
  });

  it("allows libraryId to be omitted for cross-kit browsing", () => {
    const parsed = action.schema.parse({
      query: "hero",
    });

    expect(parsed.libraryId).toBeUndefined();
    expect(parsed.query).toBe("hero");
  });

  it("accepts a single GET candidateRunIds value as an array", () => {
    const parsed = action.schema.parse({
      libraryId: "lib-1",
      candidateRunIds: "run-1",
    });

    expect(parsed.candidateRunIds).toEqual(["run-1"]);
  });

  it("returns only list-consumer metadata", () => {
    const asset = serializeAssetListItem({
      id: "asset-1",
      libraryId: "lib-1",
      collectionId: null,
      folderId: null,
      mediaType: "image",
      role: "generated",
      status: "saved",
      title: "Hero",
      description: null,
      altText: null,
      prompt: "A product hero",
      model: "image-model",
      aspectRatio: "16:9",
      imageSize: "2K",
      mimeType: "image/png",
      width: 1536,
      height: 1024,
      durationSeconds: null,
      sizeBytes: 1234,
      objectKey: "https://cdn.example.com/asset-1.png",
      thumbnailObjectKey: null,
      sourceUrl: null,
      generationRunId: "run-1",
      metadata: JSON.stringify({
        category: "hero",
        intent: "subject",
        description: "Product on a clean background",
        originalName: "hero.png",
        provider: "provider",
        compiledPrompt: "large compiled prompt",
        skeletonSpec: { regions: [] },
        referenceSelection: { selectedAssetIds: ["reference-1"] },
        settingsUsed: { model: "image-model" },
        creativeContext: { results: [] },
        referenceAssetIds: ["reference-1"],
      }),
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(asset.metadata).toEqual({
      category: "hero",
      intent: "subject",
      description: "Product on a clean background",
      originalName: "hero.png",
      provider: "provider",
    });
    expect(asset).not.toHaveProperty("imageSize");
    expect(asset).not.toHaveProperty("sizeBytes");
    expect(asset).not.toHaveProperty("sourceUrl");
    expect(asset).not.toHaveProperty("generationRunId");
    expect(asset).not.toHaveProperty("createdAt");
    expect(asset).not.toHaveProperty("updatedAt");
    expect(asset).not.toHaveProperty("urlPath");
    expect(asset).not.toHaveProperty("legacyUrl");
    expect(asset).not.toHaveProperty("legacyUrlPath");
  });

  it("projects and returns only the list contract", async () => {
    const row = {
      id: "asset-1",
      libraryId: "lib-1",
      collectionId: null,
      folderId: null,
      mediaType: "image",
      role: "generated",
      status: "saved",
      title: "Hero",
      description: null,
      altText: null,
      prompt: "A product hero",
      model: "image-model",
      aspectRatio: "16:9",
      mimeType: "image/png",
      width: 1536,
      height: 1024,
      durationSeconds: null,
      objectKey: "https://cdn.example.com/asset-1.png",
      thumbnailObjectKey: null,
      generationRunId: "run-1",
      metadata: JSON.stringify({
        category: "hero",
        compiledPrompt: "large compiled prompt",
      }),
    };
    const primaryOrderBy = vi.fn(async () => [row]);
    const select = vi
      .fn()
      .mockImplementationOnce(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ orderBy: primaryOrderBy })),
        })),
      }))
      .mockImplementationOnce(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      }));
    getDbMock.mockReturnValue({ select });

    const result = await action.run({ libraryId: "lib-1" });

    const projection = select.mock.calls[0][0];
    expect(Object.keys(projection)).not.toEqual(
      expect.arrayContaining([
        "imageSize",
        "sizeBytes",
        "sourceUrl",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(result.assets).toEqual([
      expect.objectContaining({
        id: "asset-1",
        category: "hero",
        metadata: expect.not.objectContaining({
          compiledPrompt: expect.anything(),
        }),
      }),
    ]);
    expect(result.assets[0]).not.toHaveProperty("sizeBytes");
    expect(result.assets[0]).not.toHaveProperty("legacyUrl");
  });
});
