import { beforeEach, describe, expect, it, vi } from "vitest";

const getAssetOrThrowMock = vi.hoisted(() => vi.fn());
const requireGenerationSessionInLibraryMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());

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
});
