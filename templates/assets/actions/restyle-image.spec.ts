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

import action from "./restyle-image.js";

describe("restyle-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssetOrThrowMock.mockResolvedValue({
      id: "asset-subject",
      libraryId: "library-1",
      collectionId: "collection-1",
      aspectRatio: "4:5",
      imageSize: "2K",
    });
    generateImageRunMock.mockResolvedValue({ id: "generated-1" });
    resolveLiveBatchContinuationMock.mockResolvedValue(null);
  });

  it("delegates to generate-image with the subject first and restyle intent", async () => {
    const context = { threadId: "thread-1" };
    await action.run(
      {
        subjectAssetId: "asset-subject",
        prompt: "Make it match the launch campaign",
        styleStrength: "strong",
        tier: "best",
        source: "chat",
      },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: "library-1",
        collectionId: "collection-1",
        prompt: "Make it match the launch campaign",
        intent: "restyle",
        subjectAssetId: "asset-subject",
        styleStrength: "strong",
        tier: "best",
        includeLogo: false,
      }),
      context,
    );
  });

  it("continues the caller's live batch so prior candidates stay visible", async () => {
    resolveLiveBatchContinuationMock.mockResolvedValue({
      variantBatchId: "batch-live-1",
      collectionId: "collection-1",
      presetId: null,
      sessionId: "session-1",
    });
    const context = { threadId: "thread-1" };

    await action.run(
      {
        subjectAssetId: "asset-subject",
        styleStrength: "balanced",
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
        sessionId: "session-1",
        variantBatchId: "batch-live-1",
      }),
      context,
    );
  });

  it("falls back to the live tray's collection only when the subject has none", async () => {
    getAssetOrThrowMock.mockResolvedValue({
      id: "asset-subject",
      libraryId: "library-1",
      collectionId: null,
      aspectRatio: "4:5",
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
        subjectAssetId: "asset-subject",
        styleStrength: "balanced",
        source: "chat",
      },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "collection-live" }),
      context,
    );
  });

  it("never overrides the subject's own collection with the live tray's", async () => {
    resolveLiveBatchContinuationMock.mockResolvedValue({
      variantBatchId: "batch-live-1",
      collectionId: "collection-live",
      presetId: null,
      sessionId: null,
    });
    const context = { threadId: "thread-1" };

    await action.run(
      {
        subjectAssetId: "asset-subject",
        styleStrength: "balanced",
        source: "chat",
      },
      context,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "collection-1" }),
      context,
    );
  });
});
