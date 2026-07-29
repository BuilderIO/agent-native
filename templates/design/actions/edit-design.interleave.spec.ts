/**
 * Regression coverage for edit-design's conflict-retry path.
 *
 * writeInlineSourceFile throws SourceWorkspaceEditConflictError when a
 * concurrent writer's change lands between edit-design's live read and its
 * persist call. Before this fix, that error propagated straight to the
 * agent with no fresh content to retry against, forcing a separate
 * get-design-snapshot round trip that may or may not happen. For
 * search-replace mode, edit-design now re-reads the live file and reapplies
 * the same edits automatically; replace-file mode still fails closed on the
 * first conflict since a full-document replacement computed from a stale
 * snapshot can't be safely retried blind.
 */
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

  return { db, fileRow, readLiveSourceFile, writeInlineSourceFile };
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
  getGenerationCreativeContext: vi.fn().mockResolvedValue(null),
  recordGenerationCreativeContext: vi.fn().mockResolvedValue(undefined),
  replaceCreativeContextElementProvenance: (
    _previous: unknown,
    next: unknown,
  ) => next,
  validateGenerationCreativeContext: vi.fn().mockResolvedValue({
    contextMode: "off",
    contextPackId: null,
    reuseLabels: [],
  }),
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
    mocks.readLiveSourceFile.mockReset();
    mocks.writeInlineSourceFile.mockReset();
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
    // The retried write must be computed from the SECOND (fresh) read, not
    // the original stale one — proving it isn't just blindly resubmitting
    // the same doomed content.
    expect(mocks.writeInlineSourceFile.mock.calls[1][0].content).toBe(
      "<main>Hi base, plus a concurrent change</main>",
    );
    expect(result).toMatchObject({ changed: true, editsApplied: 1 });
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
});
