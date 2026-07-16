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
      prompt: "A Steve quote about Star Wars",
      aspectRatio: "1:1",
      imageSize: "2K",
      model: "gemini-3.1-flash-image",
      metadata: "{}",
    });
    generateImageRunMock.mockResolvedValue({ id: "generated-1" });
  });

  it("forwards the chat thread context and appends the result to the candidate tray", async () => {
    await action.run(
      {
        assetId: "asset-source",
        feedback: "add some illustrations on the right side",
        source: "chat",
      },
      { threadId: "thread-9" } as any,
    );

    expect(generateImageRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: "library-1",
        sourceAssetId: "asset-source",
        appendVariant: true,
      }),
      { threadId: "thread-9" },
    );
  });

  it("includes the source prompt and feedback in the refine prompt", async () => {
    await action.run(
      {
        assetId: "asset-source",
        feedback: "make the gradient tighter",
        source: "chat",
      },
      { threadId: "thread-9" } as any,
    );

    const prompt = generateImageRunMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("A Steve quote about Star Wars");
    expect(prompt).toContain("make the gradient tighter");
  });
});
