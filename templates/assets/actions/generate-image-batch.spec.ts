import { beforeEach, describe, expect, it, vi } from "vitest";

const assertAccessMock = vi.hoisted(() => vi.fn());
const requireGenerationSessionInLibraryMock = vi.hoisted(() => vi.fn());
const generateImageRunMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("./_helpers.js", () => ({
  requireGenerationSessionInLibrary: requireGenerationSessionInLibraryMock,
}));

vi.mock("./generate-image.js", () => ({
  default: {
    run: generateImageRunMock,
  },
}));

import action from "./generate-image-batch.js";

describe("generate-image-batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
    requireGenerationSessionInLibraryMock.mockResolvedValue({
      id: "session-1",
    });
    generateImageRunMock.mockResolvedValue({ assetId: "asset-1" });
  });

  it("validates sessionId before spawning slot generations", async () => {
    requireGenerationSessionInLibraryMock.mockRejectedValue(
      new Error("Generation session does not belong to this library."),
    );

    await expect(
      action.run({
        libraryId: "lib-1",
        sessionId: "session-other",
        slots: [{ slotId: "slot-1", prompt: "Generate a hero" }],
      }),
    ).rejects.toThrow(/does not belong to this library/);

    expect(generateImageRunMock).not.toHaveBeenCalled();
  });
});
