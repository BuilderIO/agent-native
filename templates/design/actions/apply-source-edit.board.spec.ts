import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSourceWorkspace: vi.fn(),
  findSourceWorkspaceFile: vi.fn(),
  readLiveSourceFile: vi.fn(),
  writeInlineSourceFile: vi.fn(),
  snapshotDesignBeforeAgentEdit: vi.fn(),
}));

vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  findSourceWorkspaceFile: mocks.findSourceWorkspaceFile,
  readLiveSourceFile: mocks.readLiveSourceFile,
  writeInlineSourceFile: mocks.writeInlineSourceFile,
}));
vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));

import action from "./apply-source-edit.js";

describe("apply-source-edit on explicitly targeted board artwork", () => {
  const board = { id: "board-1", filename: "__board__.html" };
  const content = '<div data-agent-native-node-id="frame-1"></div>';

  beforeEach(() => {
    mocks.resolveSourceWorkspace.mockReset().mockResolvedValue({
      sourceType: "inline",
      canEdit: true,
      files: [board],
      boardFileId: board.id,
    });
    mocks.findSourceWorkspaceFile.mockReset().mockReturnValue(board);
    mocks.readLiveSourceFile.mockReset().mockResolvedValue({
      content,
      versionHash: "current-hash",
      language: "html",
      source: "stored",
    });
    mocks.writeInlineSourceFile.mockReset().mockResolvedValue({
      changed: true,
      versionHash: "next-hash",
      updatedAt: "2026-10-06T00:00:00.000Z",
    });
    mocks.snapshotDesignBeforeAgentEdit
      .mockReset()
      .mockResolvedValue(undefined);
  });

  it("edits the real board source with the version read before the write", async () => {
    const edited = content.replace("frame-1", "frame-2");
    const result = await action.run(
      {
        designId: "design-1",
        fileId: board.id,
        edit: { kind: "full-replace", content: edited },
        expectedVersionHash: "current-hash",
      },
      {} as Parameters<typeof action.run>[1],
    );

    expect(mocks.resolveSourceWorkspace).toHaveBeenCalledWith("design-1", {
      includeContent: true,
      includeBoard: true,
    });
    expect(mocks.findSourceWorkspaceFile).toHaveBeenCalledWith([board], {
      fileId: board.id,
      path: undefined,
    });
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledWith({
      designId: "design-1",
      file: board,
      content: edited,
      expectedVersionHash: "current-hash",
    });
    expect(result).toMatchObject({
      fileId: board.id,
      versionHash: "next-hash",
    });
  });
});
