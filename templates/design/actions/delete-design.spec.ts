import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const schema = {
    designShares: {
      id: "designShares.id",
      resourceId: "designShares.resourceId",
    },
    designAccessRequests: {
      id: "designAccessRequests.id",
      designId: "designAccessRequests.designId",
    },
    componentIndex: {
      id: "componentIndex.id",
      designId: "componentIndex.designId",
    },
    motionTimeline: {
      id: "motionTimeline.id",
      designId: "motionTimeline.designId",
    },
    designState: { id: "designState.id", designId: "designState.designId" },
    designReviewSnapshot: {
      id: "designReviewSnapshot.id",
      designId: "designReviewSnapshot.designId",
    },
    designFiles: { id: "designFiles.id", designId: "designFiles.designId" },
    designVersions: {
      id: "designVersions.id",
      designId: "designVersions.designId",
    },
    designLocalhostWriteGrants: {
      id: "designLocalhostWriteGrants.id",
      designId: "designLocalhostWriteGrants.designId",
    },
    designFusionEdits: {
      id: "designFusionEdits.id",
      designId: "designFusionEdits.designId",
    },
    designVisualEditSnapshots: {
      fileId: "designVisualEditSnapshots.fileId",
      designId: "designVisualEditSnapshots.designId",
      blobHandle: "designVisualEditSnapshots.blobHandle",
    },
    designVisualEditPending: {
      designId: "designVisualEditPending.designId",
    },
    designScreenRestoreClaims: {
      id: "designScreenRestoreClaims.id",
      designId: "designScreenRestoreClaims.designId",
    },
    designBoardReplayScreenshots: {
      id: "designBoardReplayScreenshots.id",
      designId: "designBoardReplayScreenshots.designId",
      blobHandle: "designBoardReplayScreenshots.blobHandle",
    },
    designs: {
      id: "designs.id",
      title: "designs.title",
      description: "designs.description",
      data: "designs.data",
      dataOperationRevisions: "designs.dataOperationRevisions",
      liveCollaborationEnabled: "designs.liveCollaborationEnabled",
      projectType: "designs.projectType",
      designSystemId: "designs.designSystemId",
      createdAt: "designs.createdAt",
      updatedAt: "designs.updatedAt",
      ownerEmail: "designs.ownerEmail",
      orgId: "designs.orgId",
      visibility: "designs.visibility",
    },
  };
  const state = {
    table: undefined as unknown,
    conditionalCleanup: false,
    currentDesign: undefined as Record<string, unknown> | undefined,
    relatedRows: new Map<unknown, unknown[]>(),
  };
  const snapshotQuery = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: vi.fn(),
  };
  snapshotQuery.from.mockImplementation((table: unknown) => {
    state.table = table;
    return snapshotQuery;
  });
  snapshotQuery.where.mockReturnValue(snapshotQuery);
  snapshotQuery.for.mockImplementation(() => {
    if (state.table === schema.designs) {
      return Promise.resolve(state.currentDesign ? [state.currentDesign] : []);
    }
    if (
      !state.conditionalCleanup &&
      state.table === schema.designVisualEditSnapshots
    ) {
      return Promise.resolve([{ blobHandle: "serialized-handle" }]);
    }
    if (
      !state.conditionalCleanup &&
      state.table === schema.designBoardReplayScreenshots
    ) {
      return Promise.resolve([{ blobHandle: "replay-screenshot-handle" }]);
    }
    return Promise.resolve([]);
  });
  snapshotQuery.limit.mockImplementation(() =>
    Promise.resolve(state.relatedRows.get(state.table) ?? []),
  );
  const deleteQuery = { where: vi.fn() };
  const tx = {
    select: vi.fn(() => snapshotQuery),
    execute: vi.fn(async () => ({})),
    delete: vi.fn(() => deleteQuery),
  };
  const snapshotRows = [{ blobHandle: "serialized-handle" }];
  const screenshotRows = [{ blobHandle: "replay-screenshot-handle" }];
  const withDesignSourceMutationTransaction = vi.fn(
    async (_id: string, callback: (tx: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      events.push("commit");
      return result;
    },
  );

  return {
    events,
    schema,
    state,
    snapshotQuery,
    deleteQuery,
    tx,
    snapshotRows,
    screenshotRows,
    assertAccess: vi.fn(),
    getRequestUserEmail: vi.fn(() => "owner@example.test"),
    withDesignSourceMutationTransaction,
    deleteVisualEditSnapshotBlobs: vi.fn(async () => {
      events.push("cleanup");
    }),
    queueVisualEditSnapshotBlobCleanupInTransaction: vi.fn(
      async (_tx: unknown, _handles: string[]) => {
        events.push("queue-cleanup");
      },
    ),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/private-blob", () => ({}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  sql: (strings: TemplateStringsArray) => strings[0],
}));
vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  deleteVisualEditSnapshotBlobs: mocks.deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction:
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
}));
vi.mock("../server/db/index.js", () => ({
  schema: mocks.schema,
}));
vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
}));

import action from "./delete-design.js";

const expectedCreatedShell = {
  title: "Session replay storyboard",
  description: "Private session replay storyboard from Analytics.",
  data: "{}",
  dataOperationRevisions: "{}",
  liveCollaborationEnabled: false,
  projectType: "prototype",
  designSystemId: null,
  createdAt: "2026-10-11T12:00:00.000Z",
  updatedAt: "2026-10-11T12:00:00.000Z",
  ownerEmail: "owner@example.test",
  orgId: null,
  visibility: "private",
};

function setExpectedCreatedShell() {
  mocks.state.conditionalCleanup = true;
  mocks.state.currentDesign = {
    id: "design-one",
    ...expectedCreatedShell,
  };
}

describe("delete-design snapshot cleanup", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.assertAccess.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.state.table = undefined;
    mocks.state.conditionalCleanup = false;
    mocks.state.currentDesign = undefined;
    mocks.state.relatedRows.clear();
    mocks.tx.execute.mockClear();
    mocks.tx.delete.mockClear();
    mocks.withDesignSourceMutationTransaction.mockClear();
    mocks.withDesignSourceMutationTransaction.mockImplementation(
      async (
        _id: string,
        callback: (tx: typeof mocks.tx) => Promise<unknown>,
      ) => {
        const result = await callback(mocks.tx);
        mocks.events.push("commit");
        return result;
      },
    );
    mocks.snapshotQuery.for.mockClear();
    mocks.snapshotQuery.limit.mockClear();
    mocks.deleteQuery.where.mockReset();
    mocks.deleteQuery.where.mockResolvedValue(undefined);
    mocks.deleteVisualEditSnapshotBlobs.mockReset();
    mocks.deleteVisualEditSnapshotBlobs.mockImplementation(async () => {
      mocks.events.push("cleanup");
    });
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction.mockReset();
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction.mockImplementation(
      async () => {
        mocks.events.push("queue-cleanup");
      },
    );
  });

  it("removes snapshot and replay screenshot blobs after design deletion commits", async () => {
    await expect(action.run({ id: "design-one" })).resolves.toEqual({
      id: "design-one",
      deleted: true,
    });

    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledWith([
      "serialized-handle",
      "replay-screenshot-handle",
    ]);
    expect(
      mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
    ).toHaveBeenCalledWith(mocks.tx, [
      "serialized-handle",
      "replay-screenshot-handle",
    ]);
    expect(mocks.tx.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "designBoardReplayScreenshots.designId",
        blobHandle: "designBoardReplayScreenshots.blobHandle",
      }),
    );
    expect(mocks.tx.delete).toHaveBeenCalledWith({
      designId: "designVisualEditPending.designId",
    });
    expect(mocks.events).toEqual(["queue-cleanup", "commit", "cleanup"]);
  });

  it("does not delete blobs if the SQL deletion fails", async () => {
    mocks.withDesignSourceMutationTransaction.mockRejectedValueOnce(
      new Error("transaction failed"),
    );

    await expect(action.run({ id: "design-one" })).rejects.toThrow(
      /transaction failed/,
    );
    expect(mocks.deleteVisualEditSnapshotBlobs).not.toHaveBeenCalled();
  });

  it("deletes an unchanged empty private shell under the source transaction lock", async () => {
    setExpectedCreatedShell();

    await expect(
      action.run({ id: "design-one", expectedCreatedShell }),
    ).resolves.toEqual({ id: "design-one", deleted: true });

    expect(mocks.tx.execute).toHaveBeenCalledWith(
      "LOCK TABLE design_shares IN SHARE MODE",
    );
    expect(mocks.withDesignSourceMutationTransaction).toHaveBeenCalledWith(
      "design-one",
      expect.any(Function),
    );
    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledWith([]);
  });

  it.each([
    ["renamed", { title: "User renamed board" }],
    ["edited", { updatedAt: "2026-10-11T12:01:00.000Z" }],
    ["shared", { visibility: "org", orgId: "org-1" }],
    ["re-owned", { ownerEmail: "other@example.test" }],
  ])(
    "preserves a %s shell whose current row differs",
    async (_label, patch) => {
      setExpectedCreatedShell();
      mocks.state.currentDesign = {
        ...mocks.state.currentDesign,
        ...patch,
      };

      await expect(
        action.run({ id: "design-one", expectedCreatedShell }),
      ).resolves.toEqual({ id: "design-one", deleted: false });

      expect(mocks.tx.execute).toHaveBeenCalledOnce();
      expect(mocks.tx.delete).not.toHaveBeenCalled();
      expect(mocks.deleteVisualEditSnapshotBlobs).not.toHaveBeenCalled();
    },
  );

  it("preserves a shell whose captured timestamp predates its last edit", async () => {
    const editedShell = {
      ...expectedCreatedShell,
      updatedAt: "2026-10-11T12:01:00.000Z",
    };
    mocks.state.conditionalCleanup = true;
    mocks.state.currentDesign = { id: "design-one", ...editedShell };

    await expect(
      action.run({ id: "design-one", expectedCreatedShell: editedShell }),
    ).resolves.toEqual({ id: "design-one", deleted: false });

    expect(mocks.tx.delete).not.toHaveBeenCalled();
    expect(mocks.deleteVisualEditSnapshotBlobs).not.toHaveBeenCalled();
  });

  it.each([
    ["a share", mocks.schema.designShares],
    ["an access request", mocks.schema.designAccessRequests],
    ["a user file", mocks.schema.designFiles],
    ["a saved version", mocks.schema.designVersions],
    ["a design state", mocks.schema.designState],
    ["indexed component data", mocks.schema.componentIndex],
    ["a motion timeline", mocks.schema.motionTimeline],
    ["a localhost write grant", mocks.schema.designLocalhostWriteGrants],
    ["a fusion edit", mocks.schema.designFusionEdits],
    ["a review snapshot", mocks.schema.designReviewSnapshot],
    ["a visual edit", mocks.schema.designVisualEditPending],
    ["a visual snapshot", mocks.schema.designVisualEditSnapshots],
    ["a restore claim", mocks.schema.designScreenRestoreClaims],
    ["a replay screenshot", mocks.schema.designBoardReplayScreenshots],
  ])("preserves an unchanged shell with %s", async (_label, table) => {
    setExpectedCreatedShell();
    mocks.state.relatedRows.set(table, [{ id: "related-row" }]);

    await expect(
      action.run({ id: "design-one", expectedCreatedShell }),
    ).resolves.toEqual({ id: "design-one", deleted: false });

    expect(mocks.tx.execute).toHaveBeenCalledOnce();
    expect(mocks.tx.delete).not.toHaveBeenCalled();
    expect(mocks.deleteVisualEditSnapshotBlobs).not.toHaveBeenCalled();
  });
});
