import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSourceWorkspace: vi.fn(),
  findSourceWorkspaceFile: vi.fn(),
  readLiveSourceFile: vi.fn(),
}));

vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  findSourceWorkspaceFile: mocks.findSourceWorkspaceFile,
  readLiveSourceFile: mocks.readLiveSourceFile,
}));

import action from "./read-source-file.js";

describe("read-source-file", () => {
  beforeEach(() => {
    mocks.resolveSourceWorkspace.mockReset();
    mocks.findSourceWorkspaceFile.mockReset();
    mocks.readLiveSourceFile.mockReset();
  });

  it("exposes a signed-out-capable surface, matching get-design.ts", () => {
    expect(action.requiresAuth).toBe(false);
    expect(action).not.toHaveProperty("capabilityScopes");
  });

  it("returns a public design's file content for an anonymous viewer", async () => {
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId: "design-1",
      sourceType: "inline",
      canEdit: false,
      files: [{ id: "file-1", filename: "index.html", updatedAt: null }],
      boardFileId: null,
    });
    mocks.findSourceWorkspaceFile.mockReturnValue({
      id: "file-1",
      filename: "index.html",
      updatedAt: null,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<main>Hello</main>",
      versionHash: "hash-1",
      language: "html",
      source: "stored",
    });

    const result = await action.run({
      designId: "design-1",
      path: "index.html",
    });

    expect(result).toMatchObject({
      designId: "design-1",
      content: "<main>Hello</main>",
      readonly: true,
    });
  });

  it("reads real board artwork with a version hash when its file id is explicit", async () => {
    const board = {
      id: "board-1",
      filename: "__board__.html",
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId: "design-1",
      sourceType: "inline",
      canEdit: true,
      files: [board],
      boardFileId: board.id,
    });
    mocks.findSourceWorkspaceFile.mockReturnValue(board);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: '<div data-agent-native-node-id="frame-1"></div>',
      versionHash: "board-hash-1",
      language: "html",
      source: "stored",
    });

    const result = await action.run({ designId: "design-1", fileId: board.id });

    expect(mocks.resolveSourceWorkspace).toHaveBeenCalledWith("design-1", {
      includeContent: true,
      includeBoard: true,
    });
    expect(mocks.findSourceWorkspaceFile).toHaveBeenCalledWith([board], {
      fileId: board.id,
      path: undefined,
    });
    expect(result).toMatchObject({
      fileId: board.id,
      readonly: false,
      content: '<div data-agent-native-node-id="frame-1"></div>',
      versionHash: "board-hash-1",
    });
  });

  it("fails loudly (404) for a private design instead of the run() ever reading a file", async () => {
    const notFound = Object.assign(new Error("Design not found"), {
      statusCode: 404,
    });
    mocks.resolveSourceWorkspace.mockRejectedValue(notFound);

    await expect(
      action.run({ designId: "private-design", path: "index.html" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.findSourceWorkspaceFile).not.toHaveBeenCalled();
  });
});
