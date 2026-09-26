import { beforeEach, describe, expect, it, vi } from "vitest";


const mocks = vi.hoisted(() => ({
  resolveSourceWorkspace: vi.fn(),
  findSourceWorkspaceFile: vi.fn(),
  readLiveSourceFile: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  findSourceWorkspaceFile: mocks.findSourceWorkspaceFile,
  readLiveSourceFile: mocks.readLiveSourceFile,
}));

import { sourceContentHash } from "../shared/source-workspace.js";
import action from "./preview-source-edit.js";

describe("preview-source-edit nextVersionHash", () => {
  const liveContent = "<html><body>Hello</body></html>";

  beforeEach(() => {
    mocks.resolveSourceWorkspace.mockReset().mockResolvedValue({
      canEdit: true,
      sourceType: "inline",
      files: [],
    });
    mocks.findSourceWorkspaceFile.mockReset().mockReturnValue({
      id: "file_1",
      filename: "index.html",
    });
    mocks.readLiveSourceFile.mockReset().mockResolvedValue({
      content: liveContent,
      versionHash: sourceContentHash(liveContent),
    });
  });

  it("returns the post-edit hash (not the current hash, not undefined) when the edit actually changes content", async () => {
    const result = (await action.run({
      designId: "design_1",
      fileId: "file_1",
      edit: { kind: "exact-replace", search: "Hello", replace: "Goodbye" },
    })) as { nextVersionHash?: string; currentVersionHash: string };

    const expectedNextContent = liveContent.replace("Hello", "Goodbye");
    expect(result.nextVersionHash).toBe(sourceContentHash(expectedNextContent));
    expect(result.nextVersionHash).not.toBeUndefined();
    expect(result.nextVersionHash).not.toBe(result.currentVersionHash);
  });

  it("omits nextVersionHash when the edit is a no-op (identical full-replace content)", async () => {
    const result = (await action.run({
      designId: "design_1",
      fileId: "file_1",
      edit: { kind: "full-replace", content: liveContent },
    })) as { nextVersionHash?: string; editsApplied: number };

    expect(result.editsApplied).toBe(0);
    expect(result.nextVersionHash).toBeUndefined();
  });
});
