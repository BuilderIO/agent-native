import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const fileSelectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  fileSelectChain.from.mockReturnValue(fileSelectChain);
  fileSelectChain.innerJoin.mockReturnValue(fileSelectChain);
  fileSelectChain.where.mockReturnValue(fileSelectChain);

  const txSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: vi.fn(),
  };
  txSelectChain.from.mockReturnValue(txSelectChain);
  txSelectChain.where.mockReturnValue(txSelectChain);
  txSelectChain.for.mockReturnValue(txSelectChain);
  const txDesignSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
  };
  txDesignSelectChain.from.mockReturnValue(txDesignSelectChain);
  txDesignSelectChain.where.mockReturnValue(txDesignSelectChain);

  const txDeleteChain = { where: vi.fn() };
  const txUpdateChain = { set: vi.fn(), where: vi.fn() };
  txUpdateChain.set.mockReturnValue(txUpdateChain);

  const tx = {
    select: vi.fn((selection) =>
      selection?.data === "designs.data" ? txDesignSelectChain : txSelectChain,
    ),
    delete: vi.fn(() => txDeleteChain),
    update: vi.fn(() => txUpdateChain),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };

  const db = {
    select: vi.fn(() => fileSelectChain),
    delete: vi.fn(() => txDeleteChain),
    transaction: vi.fn(async (callback) => callback(tx)),
  };

  return {
    db,
    tx,
    fileSelectChain,
    txSelectChain,
    txDesignSelectChain,
    txDeleteChain,
    txUpdateChain,
    accessFilter: vi.fn(() => ({ access: true })),
    assertAccess: vi.fn(),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
    designData: {} as Record<string, unknown>,
    designUpdatedAt: null as string | null,
    snapshotDesignBeforeAgentEdit: vi.fn(),
    snapshotDesignBeforeAgentEditInVersionLock: vi.fn(),
    withDesignVersionLock: vi.fn(),
    affectedRowCount: vi.fn(
      (result: { rowCount?: unknown } | undefined) => result?.rowCount,
    ),
    lockDesignFilesTable: vi.fn(),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: {
      id: "designs.id",
      data: "designs.data",
      updatedAt: "designs.updatedAt",
    },
    designShares: "designShares",
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      fileType: "designFiles.fileType",
    },
    designVersions: {
      id: "designVersions.id",
      designId: "designVersions.designId",
    },
  },
}));

vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshotDesignBeforeAgentEdit,
  snapshotDesignBeforeAgentEditInVersionLock:
    mocks.snapshotDesignBeforeAgentEditInVersionLock,
  withDesignVersionLock: mocks.withDesignVersionLock,
}));

vi.mock("../server/source-workspace.js", () => ({
  affectedRowCount: mocks.affectedRowCount,
  designSourceMutationLockKey: (designId: string) =>
    `agent-native:design-source:${designId}`,
  lockDesignFilesTable: mocks.lockDesignFilesTable,
  lockDesignSourceMutation: vi.fn(),
}));

import action from "./delete-file.js";

describe("delete-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileSelectChain.where.mockReturnValue(mocks.fileSelectChain);
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-b",
        designId: "design_123",
        filename: "b.html",
        fileType: "html",
        content: "<main>Delete</main>",
      },
    ]);
    mocks.txSelectChain.limit.mockResolvedValue([{ content: undefined }]);
    mocks.designData = {
      canvasFrames: {
        "file-a": { x: 0 },
        "file-b": { x: 500 },
      },
      screenMetadata: {
        "file-a": { title: "Keep" },
        "file-b": { title: "Delete" },
      },
      localhostScreens: {
        "file-b": { sourceType: "localhost" },
      },
      designVariantSets: {
        variants: {
          id: "variants",
          screens: [
            { id: "file-a", label: "Keep" },
            { id: "file-b", label: "Delete" },
            { id: "file-c", label: "Other" },
          ],
        },
        settled: {
          id: "settled",
          screens: [
            { id: "file-a", label: "Keep" },
            { id: "file-b", label: "Delete" },
          ],
        },
      },
      keepMe: true,
    };
    mocks.designUpdatedAt = "2026-07-08T00:00:00.000Z";
    mocks.snapshotDesignBeforeAgentEdit.mockResolvedValue(null);
    mocks.snapshotDesignBeforeAgentEditInVersionLock.mockResolvedValue(null);
    mocks.withDesignVersionLock.mockImplementation(
      async (_designId: string, work: () => Promise<unknown>) => work(),
    );
    mocks.txSelectChain.from.mockReturnValue(mocks.txSelectChain);
    mocks.txSelectChain.where.mockReturnValue(mocks.txSelectChain);
    mocks.txSelectChain.for.mockResolvedValue([
      { id: "file-a", filename: "a.html", fileType: "html" },
      { id: "file-b", filename: "b.html", fileType: "html" },
    ]);
    mocks.txSelectChain.limit.mockResolvedValue([]);
    mocks.txDesignSelectChain.from.mockReturnValue(mocks.txDesignSelectChain);
    mocks.txDesignSelectChain.where.mockReturnValue(mocks.txDesignSelectChain);
    mocks.txDesignSelectChain.for.mockImplementation(async () => [
      {
        data: JSON.stringify(mocks.designData),
        updatedAt: mocks.designUpdatedAt,
      },
    ]);
    mocks.txDeleteChain.where.mockResolvedValue({ rowCount: 1 });
    let pendingDesignUpdate: Record<string, unknown> | undefined;
    mocks.txUpdateChain.set.mockImplementation((values) => {
      pendingDesignUpdate = values;
      return mocks.txUpdateChain;
    });
    mocks.txUpdateChain.where.mockImplementation(async () => {
      if (typeof pendingDesignUpdate?.data === "string") {
        mocks.designData = JSON.parse(pendingDesignUpdate.data);
      }
      if (typeof pendingDesignUpdate?.updatedAt === "string") {
        mocks.designUpdatedAt = pendingDesignUpdate.updatedAt;
      }
      return { rowCount: 1 };
    });
  });

  it("returns a non-error result when the file is already missing", async () => {
    mocks.fileSelectChain.limit.mockResolvedValue([]);

    await expect(action.run({ id: "missing-file" })).resolves.toEqual({
      id: "missing-file",
      deleted: false,
      alreadyMissing: true,
    });
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("refuses a locked screen by default so the agent cannot drop template branding", async () => {
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-b",
        designId: "design_123",
        filename: "b.html",
        fileType: "html",
        content: '<div data-agent-native-locked="true">Brand</div>',
      },
    ]);

    await expect(action.run({ id: "file-b" })).rejects.toThrow(/locked/i);
    expect(mocks.db.delete).not.toHaveBeenCalled();
  });

  it("deletes a locked screen when the caller says the user asked for it", async () => {
    // Every template-backed screen carries locked layers, so without the
    // opt-in a user could not remove one they created from a template.
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-b",
        designId: "design_123",
        filename: "b.html",
        fileType: "html",
        content: '<div data-agent-native-locked="true">Brand</div>',
      },
    ]);

    const result = await action.run({
      id: "file-b",
      allowLockedLayers: true,
    });

    expect(result).toEqual({ id: "file-b", deleted: true });
    expect(mocks.tx.delete).toHaveBeenCalled();
  });

  it("reports an already-missing row without pruning its metadata", async () => {
    mocks.txDeleteChain.where.mockResolvedValue({ rowCount: 0 });

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).resolves.toEqual({
      id: "file-b",
      deleted: false,
      alreadyMissing: true,
    });
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("does not report success when the delete result cannot be verified", async () => {
    mocks.txDeleteChain.where.mockResolvedValue({});

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).rejects.toThrow(/verify that the design file was deleted/i);
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("snapshots inside the version lock and takes the table lock before file rows", async () => {
    const events: string[] = [];
    mocks.withDesignVersionLock.mockImplementation(
      async (_designId: string, work: () => Promise<unknown>) => {
        events.push("version");
        return work();
      },
    );
    mocks.snapshotDesignBeforeAgentEditInVersionLock.mockImplementation(
      async () => {
        events.push("snapshot");
        return null;
      },
    );
    mocks.lockDesignFilesTable.mockImplementation(async () => {
      events.push("table");
    });
    mocks.txSelectChain.for.mockImplementation(async () => {
      events.push("files");
      return [
        { id: "file-a", filename: "a.html", fileType: "html" },
        { id: "file-b", filename: "b.html", fileType: "html" },
      ];
    });
    mocks.txDeleteChain.where.mockImplementation(async () => {
      events.push("delete");
      return { rowCount: 1 };
    });
    mocks.txDesignSelectChain.for.mockImplementation(async () => {
      events.push("design");
      return [
        {
          data: JSON.stringify(mocks.designData),
          updatedAt: mocks.designUpdatedAt,
        },
      ];
    });

    await action.run({ id: "file-b" });

    expect(events).toEqual([
      "version",
      "table",
      "files",
      "snapshot",
      "delete",
      "design",
    ]);
    expect(
      mocks.snapshotDesignBeforeAgentEditInVersionLock,
    ).toHaveBeenCalledWith("design_123", undefined, mocks.tx);
  });

  it("deletes the file and prunes stale board metadata", async () => {
    const result = await action.run({ id: "file-b" });

    expect(result).toEqual({ id: "file-b", deleted: true });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_123",
      "editor",
    );
    expect(mocks.tx.delete).toHaveBeenCalled();
    const data = mocks.designData;
    expect(data.keepMe).toBe(true);
    expect(data.canvasFrames).toEqual({ "file-a": { x: 0 } });
    expect(data.screenMetadata).toEqual({ "file-a": { title: "Keep" } });
    expect(data.localhostScreens).toEqual({});
    expect(data.designVariantSets).toEqual({
      variants: {
        id: "variants",
        screens: [
          { id: "file-a", label: "Keep" },
          { id: "file-c", label: "Other" },
        ],
      },
    });
    expect(data.updatedAt).toBe(mocks.designUpdatedAt);
  });

  it("keeps the final user screen when the board file is also present", async () => {
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-b",
        designId: "design_123",
        filename: "b.html",
        fileType: "html",
        content: "<main>Only screen</main>",
      },
    ]);
    mocks.txSelectChain.for.mockResolvedValue([
      { id: "file-b", filename: "b.html", fileType: "html" },
      { id: "board", filename: "__board__.html", fileType: "html" },
    ]);

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).rejects.toThrow(/at least one user screen/i);
    expect(mocks.tx.delete).not.toHaveBeenCalled();
  });

  it("serializes concurrent deletes so only one can remove the final screen", async () => {
    let currentFiles = [
      { id: "file-a", filename: "a.html", fileType: "html" },
      { id: "file-b", filename: "b.html", fileType: "html" },
      { id: "board", filename: "__board__.html", fileType: "html" },
    ];
    let requestedFileId = "";
    mocks.fileSelectChain.where.mockImplementation((condition) => {
      const idClause = condition.and?.find(
        (clause: { left?: string }) => clause.left === "designFiles.id",
      ) as { right?: string } | undefined;
      requestedFileId = idClause?.right ?? "";
      return mocks.fileSelectChain;
    });
    mocks.fileSelectChain.limit.mockImplementation(async () => {
      const file = currentFiles.find(({ id }) => id === requestedFileId);
      return file
        ? [{ ...file, designId: "design_123", content: "<main />" }]
        : [];
    });
    mocks.txSelectChain.for.mockImplementation(async () => [...currentFiles]);
    mocks.txDesignSelectChain.for.mockImplementation(async () => [
      {
        data: JSON.stringify(mocks.designData),
        updatedAt: mocks.designUpdatedAt,
      },
    ]);
    mocks.txDeleteChain.where.mockImplementation(async (condition) => {
      const idClause = condition.and?.find(
        (clause: { left?: string }) => clause.left === "designFiles.id",
      ) as { right?: string } | undefined;
      const before = currentFiles.length;
      currentFiles = currentFiles.filter(({ id }) => id !== idClause?.right);
      return { rowCount: before === currentFiles.length ? 0 : 1 };
    });

    let transactionQueue = Promise.resolve();
    mocks.db.transaction.mockImplementation((callback) => {
      const transaction = transactionQueue.then(() => callback(mocks.tx));
      transactionQueue = transaction.then(
        () => undefined,
        () => undefined,
      );
      return transaction;
    });

    const results = await Promise.allSettled([
      action.run({ id: "file-a", allowLockedLayers: true }),
      action.run({ id: "file-b", allowLockedLayers: true }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(currentFiles.filter((file) => file.id !== "board")).toHaveLength(1);
  });

  it("does not retain a checkpoint when the delete transaction rolls back", async () => {
    const checkpoints: string[] = [];
    mocks.snapshotDesignBeforeAgentEditInVersionLock.mockImplementation(
      async (
        _designId: string,
        _context: unknown,
        transaction: { checkpoint?: string },
      ) => {
        transaction.checkpoint = "checkpoint-1";
        checkpoints.push(transaction.checkpoint);
        return {
          id: transaction.checkpoint,
          createdAt: "now",
          label: "Before",
        };
      },
    );
    mocks.txUpdateChain.where.mockResolvedValue({});
    mocks.db.transaction.mockImplementation(async (callback) => {
      const before = checkpoints.length;
      try {
        return await callback(mocks.tx);
      } catch (error) {
        checkpoints.length = before;
        throw error;
      }
    });

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).rejects.toThrow(/verify that the design metadata was updated/i);
    expect(checkpoints).toEqual([]);
  });
});
