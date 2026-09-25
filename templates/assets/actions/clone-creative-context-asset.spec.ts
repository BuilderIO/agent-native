import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPrivateBlob: vi.fn(),
  resolveReference: vi.fn(),
  createAsset: vi.fn(),
  requireLibrary: vi.fn(),
  getAsset: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  readPrivateBlob: mocks.readPrivateBlob,
}));
vi.mock("@agent-native/creative-context/server", () => ({
  resolveNativeContextCloneReference: mocks.resolveReference,
}));
vi.mock("../server/lib/assets.js", () => ({
  createAssetFromBuffer: mocks.createAsset,
}));
vi.mock("./_helpers.js", () => ({
  requireLibrary: mocks.requireLibrary,
  getAssetOrThrow: mocks.getAsset,
}));

import action from "./clone-creative-context-asset.js";

describe("clone-creative-context-asset", () => {
  const bytes = Buffer.from("approved-image-bytes");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLibrary.mockResolvedValue({ id: "library-1" });
    mocks.resolveReference.mockResolvedValue({
      publishedItemVersionId: "version-1",
      cloneHandle: { key: "private" },
    });
    mocks.readPrivateBlob.mockResolvedValue({
      data: bytes,
      mimeType: "image/png",
      metadata: {
        appId: "assets",
        resourceType: "asset",
        resourceId: "asset-1",
        contentHash: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-copy" });
    mocks.getAsset.mockResolvedValue({
      id: "asset-copy",
      libraryId: "library-1",
      title: "Context asset",
    });
  });

  it("copies approved bytes through the Assets store and records provenance", async () => {
    const result = await action.run({
      contextId: "context-1",
      artifactKey: "assets:asset:asset-1",
      resourceId: "asset-1",
      libraryId: "library-1",
    });
    expect(mocks.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: "library-1",
        buffer: bytes,
        metadata: {
          creativeContext: {
            itemVersionId: "version-1",
            sourceAssetId: "asset-1",
          },
        },
      }),
    );
    expect(result).toMatchObject({
      id: "asset-copy",
      clonedExactVersion: "version-1",
    });
    expect(result).not.toHaveProperty("cloneHandle");
  });
});
