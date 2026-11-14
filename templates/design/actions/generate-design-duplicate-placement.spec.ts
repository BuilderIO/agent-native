import { beforeEach, describe, expect, it, vi } from "vitest";
import { placementTestFixtures } from "./generate-design.test-fixtures.js";

const { action, mocks, resetDesignDataMutation, setExistingFile, track } =
  placementTestFixtures;

describe("generate-design: mixed placement targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    track.mockReset();
    mocks.snapshotDesignBeforeAgentEdit.mockReset().mockResolvedValue(null);
    mocks.seededCollabText.clear();
    mocks.setFileRows([]);
    mocks.setDesignRows([
      { id: "design-1", title: "Untitled Design", data: null },
    ]);
    mocks.assertAccess.mockImplementation(mocks.designAccess);
    mocks.readAppState.mockResolvedValue(null);
    mocks.fileUpdateChain.where.mockResolvedValue({ rowsAffected: 1 });
    mocks.designUpdateChain.where.mockResolvedValue(undefined);
    resetDesignDataMutation();
  });

  it.each([
    [
      { fileId: "file-1", x: 100 },
      { filename: "index.html", x: 200 },
    ],
    [
      { filename: "index.html", x: 100 },
      { fileId: "file-1", x: 200 },
    ],
  ])(
    "rejects mixed references to the same screen before writes",
    async (first, second) => {
      setExistingFile("<html><body>Old screen</body></html>");
      await expect(
        action.run({
          designId: "design-1",
          prompt: "Add a screen",
          files: [
            {
              filename: "new-screen.html",
              fileType: "html",
              content: "<main>New screen</main>",
            },
          ],
          canvasFrames: [first, second],
        }),
      ).rejects.toMatchObject({
        name: "NoWriteError",
        noWrite: true,
        message: expect.stringContaining("duplicates the target"),
      });
      expect.soft(mocks.insert).not.toHaveBeenCalled();
      expect.soft(mocks.fileUpdateChain.set).not.toHaveBeenCalled();
      expect.soft(mocks.seededCollabText.size).toBe(0);
      expect.soft(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
      expect.soft(mocks.mutateDesignData).not.toHaveBeenCalled();
    },
  );

  it("uses fileId precedence when checking mixed placements for duplicates", async () => {
    setExistingFile("<html><body>Old screen</body></html>");
    const result = await action.run({
      designId: "design-1",
      prompt: "Add a screen",
      files: [
        {
          filename: "new-screen.html",
          fileType: "html",
          content: "<main>New screen</main>",
        },
      ],
      canvasFrames: [
        { fileId: "file-1", filename: "new-screen.html", x: 100 },
        { filename: "new-screen.html", x: 200 },
      ],
    });
    expect(result.savedFiles).toHaveLength(1);
  });
});
