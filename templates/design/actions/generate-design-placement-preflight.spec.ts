import { beforeEach, describe, expect, it, vi } from "vitest";

import { placementTestFixtures } from "./_generate-design.test-fixtures.js";

const { action, mocks, resetDesignDataMutation, setExistingFile, track } =
  placementTestFixtures;

describe("generate-design: placement target preflight", () => {
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
    ["fileId", { fileId: "opaque-missing-id" }, "opaque-missing-id"],
    ["filename", { filename: "missing.html" }, "missing.html"],
    [
      "fileId with a matching filename",
      { fileId: "opaque-missing-id", filename: "new-screen.html" },
      "opaque-missing-id",
    ],
  ])(
    "rejects an unknown canvasFrames %s before any writes",
    async (_kind, target, missingTarget) => {
      setExistingFile("<html><body>Old screen</body></html>");

      await expect(
        action.run({
          designId: "design-1",
          prompt: "Add and update screens",
          files: [
            {
              filename: "new-screen.html",
              fileType: "html",
              content: "<html><body>New screen</body></html>",
            },
            {
              filename: "index.html",
              fileType: "html",
              content: "<html><body>Updated screen</body></html>",
            },
          ],
          canvasFrames: [{ ...target, x: 0, y: 0, width: 100, height: 100 }],
        }),
      ).rejects.toMatchObject({
        name: "NoWriteError",
        noWrite: true,
        message: `canvasFrames entry did not match a design file: ${missingTarget}`,
      });

      expect.soft(mocks.insert).not.toHaveBeenCalled();
      expect.soft(mocks.fileUpdateChain.set).not.toHaveBeenCalled();
      expect.soft(mocks.seededCollabText.size).toBe(0);
      expect.soft(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
      expect.soft(mocks.mutateDesignData).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a new filename", { filename: "new-screen.html" }, "new"],
    ["an existing filename", { filename: "index.html" }, "existing"],
    ["an existing fileId", { fileId: "file-1" }, "existing"],
    [
      "an existing fileId over a conflicting filename",
      { fileId: "file-1", filename: "new-screen.html" },
      "existing",
    ],
  ])("places %s", async (_kind, target, expectedFile) => {
    setExistingFile("<html><body>Old screen</body></html>");
    const result = await action.run({
      designId: "design-1",
      prompt: "Add a screen",
      files: [
        {
          filename: "new-screen.html",
          fileType: "html",
          content: "<html><body>New screen</body></html>",
        },
      ],
      canvasFrames: [{ ...target, x: 3000, y: 2400, width: 100, height: 100 }],
    });

    const fileId =
      expectedFile === "existing" ? "file-1" : result.savedFiles[0]?.id;
    expect(fileId).toEqual(expect.any(String));
    if (fileId === undefined) throw new Error("Expected a saved file ID");
    expect(mocks.getDesignData().canvasFrames).toMatchObject({
      [fileId]: { x: 3000, y: 2400, width: 100, height: 100 },
    });
  });
});
