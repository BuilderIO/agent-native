import { beforeEach, describe, expect, it, vi } from "vitest";

const getAssetOrThrowMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());

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
  });

  it("delegates to generate-image as a source-guided full-image edit", async () => {
    await action.run({
      assetId: "asset-target",
      instruction: "Make the background navy",
      tier: "fast",
      source: "chat",
    });

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
    );
  });
});
