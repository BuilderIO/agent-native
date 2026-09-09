import { beforeEach, describe, expect, it, vi } from "vitest";

const getAssetOrThrowMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());
const resolveLiveBatchContinuationMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("./_helpers.js", () => ({
  getAssetOrThrow: getAssetOrThrowMock,
}));

vi.mock("./generate-image.js", () => ({
  default: {
    run: generateImageRunMock,
  },
}));

vi.mock("./variant-slots.js", () => ({
  resolveLiveBatchContinuation: resolveLiveBatchContinuationMock,
}));

import action from "./edit-image.js";

describe("edit-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssetOrThrowMock.mockResolvedValue({
      id: "asset-target",
      libraryId: "library-1",
      collectionId: null,
      aspectRatio: "1:1",
      imageSize: "2K",
    });
    generateImageRunMock.mockResolvedValue({ id: "generated-1" });
    resolveLiveBatchContinuationMock.mockResolvedValue(null);
  });

  it("delegates to generate-image as a source-guided full-image edit", async () => {
    const context = { threadId: "thread-1" };
    await action.run(
      {
        assetId: "asset-target",
        instruction: "Make the background navy",
        tier: "fast",
        source: "chat",
      },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: "library-1",
        prompt: "Make the background navy",
        aspectRatio: "1:1",
        imageSize: "2K",
        intent: "edit",
        subjectAssetId: "asset-target",
        referenceAssetIds: [],
        groundingMode: "off",
        includeLogo: false,
        tier: "fast",
      }),
      context,
    );
  });

  it("continues the caller's live batch so prior candidates stay visible", async () => {
    resolveLiveBatchContinuationMock.mockResolvedValue({
      variantBatchId: "batch-live-1",
      collectionId: null,
      presetId: "preset-1",
      sessionId: null,
    });
    const context = { threadId: "thread-1" };

    await action.run(
      {
        assetId: "asset-target",
        instruction: "Make the background navy",
        source: "chat",
      },
      context,
    );

    expect(resolveLiveBatchContinuationMock).toHaveBeenCalledWith({
      threadId: "thread-1",
      libraryId: "library-1",
    });
    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        presetId: "preset-1",
        variantBatchId: "batch-live-1",
        collectionId: undefined,
      }),
      context,
    );
  });

  it("falls back to the live tray's collection only when the asset has none", async () => {
    resolveLiveBatchContinuationMock.mockResolvedValue({
      variantBatchId: "batch-live-1",
      collectionId: "collection-live",
      presetId: null,
      sessionId: null,
    });
    const context = { threadId: "thread-1" };

    await action.run(
      {
        assetId: "asset-target",
        instruction: "Make the background navy",
        source: "chat",
      },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "collection-live" }),
      context,
    );
  });

  it("never overrides the asset's own collection with the live tray's", async () => {
    getAssetOrThrowMock.mockResolvedValue({
      id: "asset-target",
      libraryId: "library-1",
      collectionId: "collection-asset",
      aspectRatio: "1:1",
      imageSize: "2K",
    });
    resolveLiveBatchContinuationMock.mockResolvedValue({
      variantBatchId: "batch-live-1",
      collectionId: "collection-live",
      presetId: null,
      sessionId: null,
    });
    const context = { threadId: "thread-1" };

    await action.run(
      {
        assetId: "asset-target",
        instruction: "Make the background navy",
        source: "chat",
      },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "collection-asset" }),
      context,
    );
  });
});
