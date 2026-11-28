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
  return {
    db,
    fileRow,
    makeWhereResult,
    fileSelectChain,
    readLiveSourceFile,
    writeInlineSourceFile,
    snapshotDesignBeforeAgentEdit,
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

import { ActionContractError } from "@agent-native/core/action";

import { SourceWorkspaceEditConflictError } from "../server/source-workspace.js";
import { LockedLayerEditError } from "../shared/locked-layers.js";
import action from "./edit-design.js";

describe("edit-design conflict retry", () => {
  beforeEach(() => {
    mocks.fileSelectChain.where.mockImplementation(() =>
      mocks.makeWhereResult([mocks.fileRow]),
    );
    mocks.readLiveSourceFile.mockReset();
    mocks.writeInlineSourceFile.mockReset();
    mocks.snapshotDesignBeforeAgentEdit.mockReset().mockResolvedValue(null);
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
    } as never);

    expect(mocks.readLiveSourceFile).toHaveBeenCalledTimes(2);
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledTimes(2);
    expect(mocks.writeInlineSourceFile.mock.calls[1][0].content).toBe(
      "<main>Hi base, plus a concurrent change</main>",
    );
    // oracle-change: Creative context removed from Design; its assertions no longer apply
    expect(result).toMatchObject({ changed: true, editsApplied: 1 });
  });

  it("preserves a retry no-match after checkpointing and accepts a corrected call", async () => {
    mocks.readLiveSourceFile
      .mockResolvedValueOnce({
        content: "<main>Hello base</main>",
        versionHash: "h0",
        language: "html",
      })
      .mockResolvedValueOnce({
        content: "<main>Concurrent update</main>",
        versionHash: "h1",
        language: "html",
      })
      .mockResolvedValueOnce({
        content: "<main>Concurrent update</main>",
        versionHash: "h1",
        language: "html",
      });
    mocks.writeInlineSourceFile
      .mockRejectedValueOnce(new SourceWorkspaceEditConflictError())
      .mockResolvedValueOnce({
        versionHash: "h2",
        changed: true,
        updatedAt: "2026-10-26T00:00:00.000Z",
      });

    const searchMiss = action.run({
      designId: "design_1",
      filename: "index.html",
      edits: [{ search: "Hello", replace: "Hi" }],
    } as never);
    await expect(searchMiss).rejects.toBeInstanceOf(ActionContractError);
    await expect(searchMiss).rejects.toMatchObject({
      errorCode: "design_edit_conflict",
    });
    await expect(searchMiss).rejects.toThrow("search text was not found");
    await expect(searchMiss).rejects.toThrow(
      "None of the edits in this batch were saved",
    );
    await expect(searchMiss).rejects.not.toHaveProperty("noWrite");

    expect(mocks.readLiveSourceFile).toHaveBeenCalledTimes(2);
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();

    const corrected = await action.run({
      designId: "design_1",
      filename: "index.html",
      edits: [{ search: "Concurrent update", replace: "Recovered" }],
    } as never);

    expect(corrected).toMatchObject({ changed: true, editsApplied: 1 });
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledTimes(2);
    expect(mocks.writeInlineSourceFile.mock.calls[1][0].content).toBe(
      "<main>Recovered</main>",
    );
  });

  it("does not label a retry miss as no-write after checkpointing", async () => {
    mocks.readLiveSourceFile
      .mockResolvedValueOnce({
        content: "<main>Hello base</main>",
        versionHash: "h0",
        language: "html",
      })
      .mockResolvedValueOnce({
        content: "<main>Concurrent replacement</main>",
        versionHash: "h1",
        language: "html",
      });
    mocks.writeInlineSourceFile.mockRejectedValueOnce(
      new SourceWorkspaceEditConflictError(),
    );

    const searchMiss = action.run({
      designId: "design_1",
      filename: "index.html",
      edits: [{ search: "Hello", replace: "Hi" }],
    } as never);
    await expect(searchMiss).rejects.toBeInstanceOf(ActionContractError);
    await expect(searchMiss).rejects.toMatchObject({
      errorCode: "design_edit_conflict",
    });
    await expect(searchMiss).rejects.toThrow("search text was not found");
    await expect(searchMiss).rejects.not.toHaveProperty("noWrite");

    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledOnce();
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();
  });

  it("preserves a locked-layer rejection after a checkpointed conflict", async () => {
    mocks.readLiveSourceFile
      .mockResolvedValueOnce({
        content: "<main>Legal</main>",
        versionHash: "h0",
        language: "html",
      })
      .mockResolvedValueOnce({
        content:
          '<main><div data-agent-native-node-id="legal" data-agent-native-locked="true">Legal</div></main>',
        versionHash: "h1",
        language: "html",
      });
    mocks.writeInlineSourceFile.mockRejectedValueOnce(
      new SourceWorkspaceEditConflictError(),
    );

    await expect(
      action.run({
        designId: "design_1",
        filename: "index.html",
        edits: [{ search: "Legal", replace: "Changed" }],
      } as never),
    ).rejects.toBeInstanceOf(LockedLayerEditError);

    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledOnce();
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();
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
    ["overlapping exact text", "<p>aaa</p>", "aa"],
    ["overlapping whitespace-flexible text", "<p>a a a</p>", "a  a"],
    [
      "ambiguous whitespace variants after stripping stable ids",
      '<p  data-agent-native-node-id="one" >One</p><p data-agent-native-node-id="two" >One</p>',
      '<p data-agent-native-node-id="old" >One</p>',
    ],
    [
      "overlapping stable-id fallback",
      '<p>a data-agent-native-node-id="live"aa</p>',
      'a data-agent-native-node-id="snapshot"a',
    ],
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

  it.each([
    [
      "text",
      '<main>label data-agent-native-node-id="live" hello  world</main>',
      '<main>label data-agent-native-node-id="snapshot" hello world</main>',
    ],
    [
      "script",
      '<script>const marker = \' data-agent-native-node-id="live"\'; const label = "hello  world";</script>',
      '<script>const marker = \' data-agent-native-node-id="snapshot"\'; const label = "hello world";</script>',
    ],
  ])(
    "does not write a whitespace-only stable-ID fallback in %s",
    async (_kind, content, search) => {
      mocks.readLiveSourceFile.mockResolvedValue({
        content,
        versionHash: "h0",
        language: "html",
      });
      const failure = action.run({
        designId: "design_1",
        filename: "index.html",
        edits: [{ search, replace: "replacement" }],
      } as never);
      await expect(failure).rejects.toMatchObject({
        name: "NoWriteError",
        noWrite: true,
        errorCode: "design_edit_conflict",
      });
      await expect(failure).rejects.not.toThrow(search);
      expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
      expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "start",
      '<p data-agent-native-node-id="live" class="old">Hi</p>',
      ' data-agent-native-node-id="stale" class="old"',
      ' data-agent-native-node-id="stale" class="new"',
    ],
    [
      "end",
      '<p class="old" data-agent-native-node-id="live">Hi</p>',
      ' class="old" data-agent-native-node-id="stale"',
      ' class="new" data-agent-native-node-id="stale"',
    ],
    [
      "search start with separated live ID",
      '<p data-agent-native-node-id="live" title="x" class="old">Hi</p>',
      ' data-agent-native-node-id="stale" class="old"',
      ' data-agent-native-node-id="stale" class="new"',
    ],
    [
      "search end with separated live ID",
      '<p class="old" title="x" data-agent-native-node-id="live">Hi</p>',
      ' class="old" data-agent-native-node-id="stale"',
      ' class="new" data-agent-native-node-id="stale"',
    ],
  ])(
    "rejects a stripped stable ID at the %s boundary without writing",
    async (_boundary, content, search, replace) => {
      mocks.readLiveSourceFile.mockResolvedValue({
        content,
        versionHash: "h0",
        language: "html",
      });
      await expect(
        action.run({
          designId: "design_1",
          filename: "index.html",
          edits: [{ search, replace }],
        } as never),
      ).rejects.toMatchObject({
        name: "NoWriteError",
        noWrite: true,
        errorCode: "design_edit_conflict",
      });
      expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
      expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    },
  );

  it("still rejects a locked layer changed through stable-ID fallback", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content:
        '<main><div data-agent-native-node-id="live" data-agent-native-locked="true">Legal</div></main>',
      versionHash: "h0",
      language: "html",
    });
    await expect(
      action.run({
        designId: "design_1",
        filename: "index.html",
        edits: [
          {
            search:
              '<div data-agent-native-node-id="stale" data-agent-native-locked="true">Legal</div>',
            replace:
              '<div data-agent-native-node-id="stale" data-agent-native-locked="true">Changed</div>',
          },
        ],
      } as never),
    ).rejects.toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "locked_layer_edit_rejected",
    });
    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing",
      "<main><p>First</p><p>Private repeated text</p></main>",
      "Private absent text",
      "search text was not found",
    ],
    [
      "ambiguous",
      "<main><p>First</p><p>Private repeated text</p><p>Private repeated text</p></main>",
      "Private repeated text",
      "matched 2 places",
    ],
  ])(
    "reports a later %s edit without saving or disclosing the batch",
    async (_kind, content, search, classifier) => {
      mocks.readLiveSourceFile.mockResolvedValue({
        content,
        versionHash: "h0",
        language: "html",
      });

      const failure = action.run({
        designId: "design_1",
        filename: "index.html",
        edits: [
          { search: "First", replace: "Updated" },
          { search, replace: "Replacement" },
        ],
      } as never);

      await expect(failure).rejects.toMatchObject({
        name: "NoWriteError",
        noWrite: true,
        errorCode: "design_edit_conflict",
        statusCode: 409,
        message: expect.stringContaining(classifier),
      });
      await expect(failure).rejects.toThrow(
        "None of the edits in this batch were saved",
      );
      await expect(failure).rejects.toThrow("get-design-snapshot");
      await expect(failure).rejects.toThrow(
        "one pass or smaller sequential batches when appropriate",
      );
      await expect(failure).rejects.toThrow(
        "all intended edits in the rejected batch",
      );
      await expect(failure).rejects.not.toThrow(search);
      expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
      expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();
    },
  );

  it("classifies a locked-layer rejection as no-write and accepts a corrected call", async () => {
    const lockedContent =
      '<main><div data-agent-native-node-id="legal" data-agent-native-locked="true">Legal</div><p>Draft</p></main>';
    mocks.readLiveSourceFile.mockResolvedValue({
      content: lockedContent,
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
        edits: [{ search: "Legal", replace: "Changed" }],
      } as never),
    ).rejects.toMatchObject({
      name: "NoWriteError",
      noWrite: true,
      errorCode: "locked_layer_edit_rejected",
      statusCode: 409,
    });

    expect(mocks.snapshotDesignBeforeAgentEdit).not.toHaveBeenCalled();
    expect(mocks.writeInlineSourceFile).not.toHaveBeenCalled();

    const corrected = await action.run({
      designId: "design_1",
      filename: "index.html",
      edits: [{ search: "Draft", replace: "Ready" }],
    } as never);

    expect(corrected).toMatchObject({ changed: true, editsApplied: 1 });
    expect(mocks.snapshotDesignBeforeAgentEdit).toHaveBeenCalledOnce();
    expect(mocks.writeInlineSourceFile).toHaveBeenCalledOnce();
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
