import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  function makeWhereResult(rows: unknown[]) {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  }

  const fileRow = {
    id: "file_1",
    designId: "design_1",
    filename: "index.html",
    fileType: "html",
    content: "<main>Hello base</main>",
  };

  const fileSelectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  fileSelectChain.from.mockReturnValue(fileSelectChain);
  fileSelectChain.innerJoin.mockReturnValue(fileSelectChain);
  fileSelectChain.where.mockImplementation(() => makeWhereResult([fileRow]));

  const retrySelectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  retrySelectChain.from.mockReturnValue(retrySelectChain);
  retrySelectChain.where.mockImplementation(() =>
    makeWhereResult([{ content: fileRow.content }]),
  );

  const db = {
    select: vi.fn((columns: Record<string, unknown>) =>
      "content" in columns && Object.keys(columns).length === 1
        ? retrySelectChain
        : fileSelectChain,
    ),
  };

  const readLiveSourceFile = vi.fn();
  const writeInlineSourceFile = vi.fn();
  const snapshotDesignBeforeAgentEdit = vi.fn().mockResolvedValue(null);
  const getGenerationCreativeContext = vi.fn().mockResolvedValue(null);
  const recordGenerationCreativeContext = vi.fn().mockResolvedValue(undefined);
  const validateGenerationCreativeContext = vi.fn().mockResolvedValue({
    contextMode: "off",
    contextPackId: null,
    reuseLabels: [],
  });

  return {
    db,
    fileRow,
    makeWhereResult,
    fileSelectChain,
    readLiveSourceFile,
    writeInlineSourceFile,
    snapshotDesignBeforeAgentEdit,
    getGenerationCreativeContext,
    recordGenerationCreativeContext,
    validateGenerationCreativeContext,
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
      content: "designFiles.content",
    },
    designs: { id: "designs.id" },
    designShares: {},
  },
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
}));

vi.mock("../server/lib/design-tracking.js", () => ({
  trackDesign: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => true,
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@agent-native/core/collab", () => ({
  agentEnterDocument: vi.fn(),
  agentLeaveDocument: vi.fn(),
  agentUpdateSelection: vi.fn(),
}));

vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: (...args: unknown[]) =>
    mocks.getGenerationCreativeContext(...args),
  recordGenerationCreativeContext: (...args: unknown[]) =>
    mocks.recordGenerationCreativeContext(...args),
  replaceCreativeContextElementProvenance: (
    _previous: unknown,
    next: unknown,
  ) => next,
  validateGenerationCreativeContext: (...args: unknown[]) =>
    mocks.validateGenerationCreativeContext(...args),
}));

vi.mock("../server/source-workspace.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/source-workspace.js")
  >("../server/source-workspace.js");
  return {
    ...actual,
    readLiveSourceFile: mocks.readLiveSourceFile,
    writeInlineSourceFile: mocks.writeInlineSourceFile,
  };
});

import { SourceWorkspaceEditConflictError } from "../server/source-workspace.js";
import action from "./edit-design.js";

describe("edit-design conflict retry", () => {
  beforeEach(() => {
    mocks.fileSelectChain.where.mockImplementation(() =>
      mocks.makeWhereResult([mocks.fileRow]),
    );
    mocks.readLiveSourceFile.mockReset();
    mocks.writeInlineSourceFile.mockReset();
    mocks.snapshotDesignBeforeAgentEdit.mockReset().mockResolvedValue(null);
    mocks.getGenerationCreativeContext.mockReset().mockResolvedValue(null);
    mocks.recordGenerationCreativeContext
      .mockReset()
      .mockResolvedValue(undefined);
    mocks.validateGenerationCreativeContext.mockReset().mockResolvedValue({
      contextMode: "off",
      contextPackId: null,
      reuseLabels: [],
    });
  });

  it("re-reads and reapplies search-replace edits after a persist conflict", async () => {
    mocks.readLiveSourceFile
      .mockResolvedValueOnce({
        content: "<main>Hello base</main>",
        versionHash: "h0",
        language: "html",
      })
      .mockResolvedValueOnce({
        content: "<main>Hello base, plus a concurrent change</main>",
        versionHash: "h1",
        language: "html",
      });

    mocks.writeInlineSourceFile
      .mockRejectedValueOnce(new SourceWorkspaceEditConflictError())
      .mockResolvedValueOnce({
        versionHash: "h2",
        changed: true,
        updatedAt: "2026-07-25T00:00:00.000Z",
      });

    const result = await action.run({
      designId: "design_1",
      filename: "index.html",
      edits: [{ search: "Hello", replace: "Hi" }],
      reuseLabels: [],
    } as never);

    expect(mocks.readLiveSourceFile).toHaveBeenCalledTimes(2);
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledTimes(2);
    expect(mocks.writeInlineSourceFile.mock.calls[1][0].content).toBe(
      "<main>Hi base, plus a concurrent change</main>",
    );
    expect(result).toMatchObject({ changed: true, editsApplied: 1 });
    expect(mocks.getGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mocks.validateGenerationCreativeContext).not.toHaveBeenCalled();
    expect(mocks.recordGenerationCreativeContext).not.toHaveBeenCalled();
  });

  it("does not retry replace-file mode on conflict", async () => {
    mocks.readLiveSourceFile.mockResolvedValueOnce({
      content: "<main>Hello base</main>",
      versionHash: "h0",
      language: "html",
    });
    mocks.writeInlineSourceFile.mockRejectedValueOnce(
      new SourceWorkspaceEditConflictError(),
    );

    await expect(
      action.run({
        designId: "design_1",
        filename: "index.html",
        mode: "replace-file",
        replacementContent: "<main>Replaced</main>",
      } as never),
    ).rejects.toMatchObject({
      name: "SourceWorkspaceEditConflictError",
      statusCode: 409,
    });

    expect(mocks.readLiveSourceFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing text", "<main>Hello base</main>", "Not present"],
    ["ambiguous text", "<p>Hello</p><p>Hello</p>", "Hello"],
  ])("reports %s as a no-write rejection", async (_label, content, search) => {
    mocks.readLiveSourceFile.mockResolvedValueOnce({
      content,
      versionHash: "h0",
      language: "html",
    });

    await expect(
      action.run({
        designId: "design_1",
        filename: "index.html",
        edits: [{ search, replace: "Updated" }],
      } as never),
    ).rejects.toMatchObject({ name: "NoWriteError", noWrite: true });

    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("reports a missing file as a no-write rejection", async () => {
    mocks.fileSelectChain.where.mockImplementationOnce(() =>
      mocks.makeWhereResult([]),
    );

    await expect(
      action.run({
        designId: "design_1",
        filename: "missing.html",
        edits: [{ search: "Hello", replace: "Hi" }],
      } as never),
    ).rejects.toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "design_file_not_found",
      statusCode: 404,
    });

    expect(mocks.readLiveSourceFile).not.toHaveBeenCalled();
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it("lets a corrected call run after a search-replace no-match rejection", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<main>Hello base</main>",
      versionHash: "h0",
      language: "html",
    });
    mocks.writeInlineSourceFile.mockResolvedValue({
      versionHash: "h1",
      changed: true,
      updatedAt: "2026-10-26T00:00:00.000Z",
    });

    await expect(
      action.run({
        designId: "design_1",
        filename: "index.html",
        edits: [{ search: "Not present", replace: "Hi" }],
      } as never),
    ).rejects.toMatchObject({ name: "NoWriteError", noWrite: true });
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();

    const result = await action.run({
      designId: "design_1",
      filename: "index.html",
      edits: [{ search: "Hello", replace: "Hi" }],
    } as never);

    expect(result).toMatchObject({ changed: true, editsApplied: 1 });
    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledOnce();
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();
  });
});
