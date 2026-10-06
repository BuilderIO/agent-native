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
  const txShareSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
  };
  txShareSelectChain.from.mockReturnValue(txShareSelectChain);
  txShareSelectChain.where.mockReturnValue(txShareSelectChain);
  const txMemberSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
  };
  txMemberSelectChain.from.mockReturnValue(txMemberSelectChain);
  txMemberSelectChain.where.mockReturnValue(txMemberSelectChain);
  const txSnapshotSelectChain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
  };
  txSnapshotSelectChain.from.mockReturnValue(txSnapshotSelectChain);
  txSnapshotSelectChain.where.mockReturnValue(txSnapshotSelectChain);

  const txDeleteChain = { where: vi.fn() };
  const txUpdateChain = { set: vi.fn(), where: vi.fn() };
  txUpdateChain.set.mockReturnValue(txUpdateChain);

  const tx = {
    select: vi.fn((selection) => {
      if (selection?.blobHandle === "visualEditSnapshots.blobHandle") {
        return txSnapshotSelectChain;
      }
      if (selection?.data === "designs.data") return txDesignSelectChain;
      if (selection?.id === "designShares.id") return txShareSelectChain;
      if (selection?.id === "orgMembers.id") return txMemberSelectChain;
      return txSelectChain;
    }),
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
    txShareSelectChain,
    txMemberSelectChain,
    txSnapshotSelectChain,
    orgMembers: {
      id: "orgMembers.id",
      orgId: "orgMembers.orgId",
      email: "orgMembers.email",
    },
    txDeleteChain,
    txUpdateChain,
    accessFilter: vi.fn(() => ({ access: true })),
    assertAccess: vi.fn(),
    currentAccess: vi.fn(() => ({})),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
    inArray: vi.fn((left, right) => ({ left, right })),
    designData: {} as Record<string, unknown>,
    designUpdatedAt: null as string | null,
    snapshotDesignBeforeAgentEdit: vi.fn(),
    snapshotDesignBeforeAgentEditInVersionLock: vi.fn(),
    withDesignVersionLock: vi.fn(),
    affectedRowCount: vi.fn(
      (result: { rowCount?: unknown } | undefined) => result?.rowCount,
    ),
    lockDesignFilesTable: vi.fn(),
    deleteVisualEditSnapshotBlobs: vi.fn(),
    queueVisualEditSnapshotBlobCleanupInTransaction: vi.fn(),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  currentAccess: mocks.currentAccess,
}));

vi.mock("@agent-native/core/org", () => ({
  orgMembers: mocks.orgMembers,
  isMissingOrganizationTableError: (error: unknown) =>
    String((error as Error)?.message ?? "").includes("org_members"),
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  inArray: mocks.inArray,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designs: {
      id: "designs.id",
      data: "designs.data",
      updatedAt: "designs.updatedAt",
      ownerEmail: "designs.ownerEmail",
      orgId: "designs.orgId",
      visibility: "designs.visibility",
    },
    orgMembers: {
      id: "orgMembers.id",
      orgId: "orgMembers.orgId",
      email: "orgMembers.email",
    },
    designShares: {
      id: "designShares.id",
      resourceId: "designShares.resourceId",
    },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
      fileType: "designFiles.fileType",
      createdAt: "designFiles.createdAt",
      updatedAt: "designFiles.updatedAt",
    },
    designVersions: {
      id: "designVersions.id",
      designId: "designVersions.designId",
    },
    designVisualEditSnapshots: {
      designId: "visualEditSnapshots.designId",
      fileId: "visualEditSnapshots.fileId",
      blobHandle: "visualEditSnapshots.blobHandle",
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
vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  deleteVisualEditSnapshotBlobs: mocks.deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction:
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
}));

import action from "./delete-file.js";

describe("delete-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockReset();
    mocks.currentAccess.mockReset();
    mocks.currentAccess.mockReturnValue({});
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
      {
        id: "file-a",
        filename: "a.html",
        fileType: "html",
        content: "<main>Keep</main>",
      },
      {
        id: "file-b",
        filename: "b.html",
        fileType: "html",
        content: "<main>Delete</main>",
      },
    ]);
    mocks.txShareSelectChain.for.mockResolvedValue([]);
    mocks.txMemberSelectChain.for.mockResolvedValue([]);
    mocks.txSnapshotSelectChain.for.mockResolvedValue([]);
    mocks.deleteVisualEditSnapshotBlobs.mockReset();
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

  it("rechecks locked layers from the locked file reread", async () => {
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-b",
        designId: "design_123",
        filename: "b.html",
        fileType: "html",
        content: "<main>Unlocked preflight</main>",
      },
    ]);
    mocks.txSelectChain.for.mockResolvedValue([
      {
        id: "file-a",
        filename: "a.html",
        fileType: "html",
        content: "<main>Keep</main>",
      },
      {
        id: "file-b",
        filename: "b.html",
        fileType: "html",
        content:
          '<div data-agent-native-locked="true">Added concurrently</div>',
      },
    ]);

    await expect(action.run({ id: "file-b" })).rejects.toThrow(/locked/i);
    expect(
      mocks.snapshotDesignBeforeAgentEditInVersionLock,
    ).not.toHaveBeenCalled();
    expect(mocks.tx.delete).not.toHaveBeenCalled();
  });

  it("rechecks editor access inside the destructive transaction", async () => {
    mocks.assertAccess.mockImplementation(async () => {
      if (mocks.assertAccess.mock.calls.length > 1) {
        throw new Error("editor access revoked");
      }
    });

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).rejects.toThrow(/editor access revoked/i);
    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      2,
      "design",
      "design_123",
      "editor",
      expect.objectContaining({
        transaction: expect.objectContaining({
          execute: expect.any(Function),
        }),
      }),
    );
    expect(
      mocks.snapshotDesignBeforeAgentEditInVersionLock,
    ).not.toHaveBeenCalled();
    expect(mocks.tx.delete).not.toHaveBeenCalled();
  });

  it("normalizes array-shaped Drizzle results for transactional access", async () => {
    const rows = [{ id: "design_123" }] as Array<{ id: string }> & {
      count: number;
    };
    rows.count = 1;
    mocks.tx.execute.mockResolvedValue(rows);
    mocks.assertAccess.mockImplementation(async (...args: unknown[]) => {
      const transaction = (
        args[3] as { transaction?: { execute: Function } } | undefined
      )?.transaction;
      if (!transaction) return;
      await expect(
        transaction.execute({ sql: "SELECT 1", args: [] }),
      ).resolves.toEqual({ rows, rowsAffected: 1 });
    });

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).resolves.toMatchObject({ id: "file-b", deleted: true });
  });

  it("does not lock org_members for an owner on an embedded org-visible design", async () => {
    mocks.currentAccess.mockReturnValue({ userEmail: "owner@example.com" });
    mocks.txDesignSelectChain.for.mockResolvedValue([
      {
        id: "design_123",
        data: JSON.stringify(mocks.designData),
        updatedAt: mocks.designUpdatedAt,
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        visibility: "org",
      },
    ]);

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).resolves.toMatchObject({ id: "file-b", deleted: true });
    expect(mocks.txMemberSelectChain.for).not.toHaveBeenCalled();
  });

  it("does not make org_members a hard dependency for non-owner access", async () => {
    mocks.currentAccess.mockReturnValue({
      userEmail: "shared@example.com",
      orgId: "org-1",
    });
    mocks.txDesignSelectChain.for.mockResolvedValue([
      {
        id: "design_123",
        data: JSON.stringify(mocks.designData),
        updatedAt: mocks.designUpdatedAt,
        ownerEmail: "owner@example.com",
        orgId: "org-1",
        visibility: "org",
      },
    ]);
    mocks.txMemberSelectChain.for.mockRejectedValue(
      new Error('relation "org_members" does not exist'),
    );

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).resolves.toMatchObject({ id: "file-b", deleted: true });
    expect(mocks.txMemberSelectChain.for).toHaveBeenCalledTimes(1);
    expect(mocks.tx.delete).toHaveBeenCalledTimes(1);
  });

  it("holds authorization rows before the delete so a revoke waits", async () => {
    let releaseAuthorizationLock!: () => void;
    let markAuthorizationLockReached!: () => void;
    const authorizationLock = new Promise<void>((resolve) => {
      releaseAuthorizationLock = resolve;
    });
    const authorizationLockReached = new Promise<void>((resolve) => {
      markAuthorizationLockReached = resolve;
    });
    mocks.txShareSelectChain.for.mockImplementation(async () => {
      markAuthorizationLockReached();
      await authorizationLock;
      return [];
    });

    const deletion = action.run({
      id: "file-b",
      allowLockedLayers: true,
    });
    await authorizationLockReached;
    expect(mocks.tx.delete).not.toHaveBeenCalled();

    releaseAuthorizationLock();
    await expect(deletion).resolves.toMatchObject({
      id: "file-b",
      deleted: true,
    });
    expect(mocks.tx.delete).toHaveBeenCalledTimes(1);
  });

  it("locks the caller membership row for an org-visible design", async () => {
    mocks.currentAccess.mockReturnValue({
      userEmail: "editor@example.com",
      orgId: "org-1",
    });
    mocks.txDesignSelectChain.for.mockResolvedValue([
      {
        id: "design_123",
        data: JSON.stringify(mocks.designData),
        updatedAt: mocks.designUpdatedAt,
        orgId: "org-1",
        visibility: "org",
      },
    ]);

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).resolves.toMatchObject({ id: "file-b", deleted: true });
    expect(mocks.txMemberSelectChain.for).toHaveBeenCalledTimes(1);
  });

  it("deletes a locked screen when the caller says the user asked for it", async () => {
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

    expect(result).toMatchObject({ id: "file-b", deleted: true });
    expect(mocks.tx.delete).toHaveBeenCalled();
  });

  it("removes the committed snapshot blobs after deleting the screens", async () => {
    const blobHandle = JSON.stringify({
      id: "snapshot-blob",
      provider: "private-provider",
      opaque: true,
      encrypted: true,
    });
    mocks.txSnapshotSelectChain.for.mockResolvedValue([{ blobHandle }]);

    await expect(
      action.run({ id: "file-b", allowLockedLayers: true }),
    ).resolves.toMatchObject({ id: "file-b", deleted: true });

    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledWith([
      blobHandle,
    ]);
    expect(
      mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
    ).toHaveBeenCalledWith(mocks.tx, [blobHandle]);
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
    mocks.txSnapshotSelectChain.for.mockImplementation(async () => {
      events.push("snapshot-blobs");
      return [];
    });
    mocks.lockDesignFilesTable.mockImplementation(async () => {
      events.push("table");
    });
    mocks.txSelectChain.for.mockImplementation(async () => {
      events.push("files");
      return [
        { id: "file-a", filename: "a.html", fileType: "html", content: "" },
        { id: "file-b", filename: "b.html", fileType: "html", content: "" },
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
      "design",
      "snapshot",
      "snapshot-blobs",
      "delete",
    ]);
    expect(
      mocks.snapshotDesignBeforeAgentEditInVersionLock,
    ).toHaveBeenCalledWith("design_123", undefined, mocks.tx);
  });

  it("captures an edit that lands after a standalone browser checkpoint", async () => {
    const standaloneCheckpointState = JSON.stringify(mocks.designData);
    mocks.designData = {
      ...mocks.designData,
      keepMe: "edited after checkpoint",
    };
    expect(JSON.stringify(mocks.designData)).not.toBe(
      standaloneCheckpointState,
    );

    mocks.fileSelectChain.limit
      .mockResolvedValueOnce([
        {
          id: "file-b",
          designId: "design_123",
          filename: "b.html",
          fileType: "html",
          content: "<main>Delete</main>",
        },
      ])
      .mockResolvedValueOnce([{ id: "checkpoint-1", designId: "design_123" }]);

    const events: string[] = [];
    let capturedState: Record<string, unknown> | undefined;
    mocks.lockDesignFilesTable.mockImplementation(async () => {
      events.push("table");
    });
    mocks.snapshotDesignBeforeAgentEditInVersionLock.mockImplementation(
      async () => {
        events.push("snapshot");
        capturedState = JSON.parse(JSON.stringify(mocks.designData));
        return null;
      },
    );
    mocks.txDeleteChain.where.mockImplementation(async () => {
      events.push("delete");
      return { rowCount: 1 };
    });

    await action.run(
      {
        id: "file-b",
        allowLockedLayers: true,
        historyCheckpointId: "checkpoint-1",
      },
      { caller: "frontend", actionName: "delete-file" },
    );

    expect(events).toEqual(["table", "snapshot", "delete"]);
    expect(capturedState?.keepMe).toBe("edited after checkpoint");
  });

  it("deletes the file and prunes stale board metadata", async () => {
    const result = await action.run({ id: "file-b" });

    expect(result).toMatchObject({ id: "file-b", deleted: true });
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

  it("returns the authoritative locked file snapshot for session undo", async () => {
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-b",
        designId: "design_123",
        filename: "b.html",
        fileType: "html",
        content: "<main>Client preflight bytes</main>",
      },
    ]);
    mocks.txSelectChain.for.mockResolvedValue([
      {
        id: "file-a",
        filename: "a.html",
        fileType: "html",
        content: "<main>Keep</main>",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
      {
        id: "file-b",
        filename: "b.html",
        fileType: "html",
        content: "<main>Newer server bytes</main>",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    ]);

    const result = await action.run({
      id: "file-b",
      allowLockedLayers: true,
    });

    expect(result).toMatchObject({
      id: "file-b",
      deleted: true,
      deletedFiles: [
        {
          id: "file-b",
          content: "<main>Newer server bytes</main>",
          createdAt: "2026-07-08T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
          geometry: { x: 500 },
          screenMetadata: { title: "Delete" },
        },
      ],
    });
  });

  it("deletes a multi-screen selection with one durable checkpoint", async () => {
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-b",
        designId: "design_123",
        filename: "b.html",
        fileType: "html",
        content: "<main>Delete B</main>",
      },
      {
        id: "file-c",
        designId: "design_123",
        filename: "c.html",
        fileType: "html",
        content: "<main>Delete C</main>",
      },
    ]);
    mocks.txSelectChain.for.mockResolvedValue([
      { id: "file-a", filename: "a.html", fileType: "html" },
      { id: "file-b", filename: "b.html", fileType: "html" },
      { id: "file-c", filename: "c.html", fileType: "html" },
    ]);
    mocks.txDeleteChain.where.mockResolvedValue({ rowCount: 2 });

    await expect(
      action.run(
        {
          id: "file-b",
          fileIds: ["file-c"],
          allowLockedLayers: true,
        },
        { caller: "frontend", actionName: "delete-file" },
      ),
    ).resolves.toMatchObject({
      id: "file-b",
      deleted: true,
      deletedIds: ["file-b", "file-c"],
    });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(
      mocks.snapshotDesignBeforeAgentEditInVersionLock,
    ).toHaveBeenCalledTimes(1);
    expect(mocks.tx.delete).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a multi-screen selection includes a missing file", async () => {
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-a",
        designId: "design_123",
        filename: "a.html",
        fileType: "html",
        content: "<main>Keep</main>",
      },
    ]);

    await expect(
      action.run({
        id: "file-a",
        fileIds: ["missing-file"],
        allowLockedLayers: true,
      }),
    ).rejects.toThrow(/no longer available/i);
    expect(
      mocks.snapshotDesignBeforeAgentEditInVersionLock,
    ).not.toHaveBeenCalled();
    expect(mocks.tx.delete).not.toHaveBeenCalled();
  });

  it("fails closed when a selected file disappears after the locked reread", async () => {
    mocks.fileSelectChain.limit.mockResolvedValue([
      {
        id: "file-b",
        designId: "design_123",
        filename: "b.html",
        fileType: "html",
        content: "<main>Delete B</main>",
      },
      {
        id: "file-c",
        designId: "design_123",
        filename: "c.html",
        fileType: "html",
        content: "<main>Delete C</main>",
      },
    ]);
    mocks.txSelectChain.for.mockResolvedValue([
      { id: "file-a", filename: "a.html", fileType: "html" },
      { id: "file-b", filename: "b.html", fileType: "html" },
    ]);

    await expect(
      action.run({
        id: "file-b",
        fileIds: ["file-c"],
        allowLockedLayers: true,
      }),
    ).rejects.toThrow(/changed while it was being deleted/i);
    expect(
      mocks.snapshotDesignBeforeAgentEditInVersionLock,
    ).not.toHaveBeenCalled();
    expect(mocks.tx.delete).not.toHaveBeenCalled();
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
