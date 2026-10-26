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

import action from "./resolve-selection-source.js";

describe("resolve-selection-source", () => {
  beforeEach(() => {
    mocks.resolveSourceWorkspace.mockReset();
    mocks.findSourceWorkspaceFile.mockReset();
    mocks.readLiveSourceFile.mockReset();
    mocks.resolveSourceWorkspace.mockResolvedValue({
      sourceType: "inline",
      files: [{ id: "file-1", filename: "index.html" }],
    });
    mocks.findSourceWorkspaceFile.mockReturnValue({
      id: "file-1",
      filename: "index.html",
    });
  });

  it("returns resolver conflicts so callers can distinguish ambiguous IDs", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content:
        '<main><section data-loc="src:repeat"></section><section data-loc="src:repeat"></section></main>',
    });

    const result = await action.run({
      designId: "design-1",
      path: "index.html",
      nodeId: "src:repeat",
    });

    expect(result).toMatchObject({
      resolved: false,
      line: null,
      column: null,
      resolutionStatus: "conflict",
      resolutionMessage: 'Node id "src:repeat" matched 2 code layer nodes.',
    });
  });
});
