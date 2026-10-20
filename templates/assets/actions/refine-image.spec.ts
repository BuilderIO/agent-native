import { beforeEach, describe, expect, it, vi } from "vitest";

const getAssetOrThrowMock = vi.hoisted(() => vi.fn());
const requireGenerationSessionInLibraryMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());
const resolveLiveBatchContinuationMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("./_helpers.js", () => ({
  getAssetOrThrow: getAssetOrThrowMock,
  requireGenerationSessionInLibrary: requireGenerationSessionInLibraryMock,
}));

vi.mock("./generate-image.js", () => ({
  default: {
    run: generateImageRunMock,
  },
}));

vi.mock("./variant-slots.js", () => ({
  resolveLiveBatchContinuation: resolveLiveBatchContinuationMock,
}));

import { ASSETS_VARIATION_GRID_RENDERER } from "../shared/action-ui.js";
import action from "./refine-image.js";

describe("refine-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssetOrThrowMock.mockResolvedValue({
      id: "asset-source",
      libraryId: "library-1",
      collectionId: null,
      prompt: "Original prompt",
      aspectRatio: "16:9",
      imageSize: "2K",
      model: "gemini-3.1-flash-image",
      metadata: "{}",
    });
    generateImageRunMock.mockResolvedValue({ id: "generated-1" });
    resolveLiveBatchContinuationMock.mockResolvedValue(null);
  });

  it("uses the variation renderer for a completed refinement", () => {
    expect(action.chatUI?.renderer).toBe(ASSETS_VARIATION_GRID_RENDERER);
    expect(
      action.chatUI?.when?.(
        { assetId: "source", feedback: "Less text" },
        {
          id: "generated-1",
          libraryId: "library-1",
          previewUrl: "/api/assets/generated-1/content",
        },
      ),
    ).toBe(true);
  });

  it("forwards the action run context so the refined candidate lands in the caller's thread tray", async () => {
    const context = { threadId: "thread-1" };
    await action.run(
      {
        assetId: "asset-source",
        feedback: "Reduce the text",
        source: "chat",
      },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: "library-1",
        sourceAssetId: "asset-source",
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
        assetId: "asset-source",
        feedback: "Reduce the text",
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

  it("falls back to the live tray's collection only when the source asset has none", async () => {
    resolveLiveBatchContinuationMock.mockResolvedValue({
      variantBatchId: "batch-live-1",
      collectionId: "collection-live",
      presetId: null,
      sessionId: null,
    });
    const context = { threadId: "thread-1" };

    await action.run(
      { assetId: "asset-source", feedback: "Reduce the text", source: "chat" },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "collection-live" }),
      context,
    );
  });

  it("never overrides the source asset's own collection with the live tray's", async () => {
    getAssetOrThrowMock.mockResolvedValue({
      id: "asset-source",
      libraryId: "library-1",
      collectionId: "collection-asset",
      prompt: "Original prompt",
      aspectRatio: "16:9",
      imageSize: "2K",
      model: "gemini-3.1-flash-image",
      metadata: "{}",
    });
    resolveLiveBatchContinuationMock.mockResolvedValue({
      variantBatchId: "batch-live-1",
      collectionId: "collection-live",
      presetId: null,
      sessionId: null,
    });
    const context = { threadId: "thread-1" };

    await action.run(
      { assetId: "asset-source", feedback: "Reduce the text", source: "chat" },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "collection-asset" }),
      context,
    );
  });
});
