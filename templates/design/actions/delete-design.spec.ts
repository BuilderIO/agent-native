import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const snapshotQuery = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
  };
  snapshotQuery.from.mockReturnValue(snapshotQuery);
  snapshotQuery.where.mockReturnValue(snapshotQuery);
  const deleteQuery = { where: vi.fn() };
  const tx = {
    select: vi.fn(() => snapshotQuery),
    delete: vi.fn(() => deleteQuery),
  };
  const snapshotRows = [{ blobHandle: "serialized-handle" }];
  const withDesignSourceMutationTransaction = vi.fn(
    async (_id: string, callback: (tx: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      events.push("commit");
      return result;
    },
  );

  return {
    events,
    snapshotQuery,
    deleteQuery,
    tx,
    snapshotRows,
    assertAccess: vi.fn(),
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
vi.mock("@agent-native/core/private-blob", () => ({}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));
vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  deleteVisualEditSnapshotBlobs: mocks.deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction:
    mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
}));
vi.mock("../server/db/index.js", () => ({
  schema: {
    designShares: { resourceId: "designShares.resourceId" },
    designAccessRequests: { designId: "designAccessRequests.designId" },
    componentIndex: { designId: "componentIndex.designId" },
    motionTimeline: { designId: "motionTimeline.designId" },
    designState: { designId: "designState.designId" },
    designReviewSnapshot: { designId: "designReviewSnapshot.designId" },
    designFiles: { designId: "designFiles.designId" },
    designVersions: { designId: "designVersions.designId" },
    designVisualEditSnapshots: {
      designId: "designVisualEditSnapshots.designId",
      blobHandle: "designVisualEditSnapshots.blobHandle",
    },
    designVisualEditPending: { designId: "designVisualEditPending.designId" },
    designs: { id: "designs.id" },
  },
}));
vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
}));

import action from "./delete-design.js";

describe("delete-design snapshot cleanup", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.assertAccess.mockReset();
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
    mocks.snapshotQuery.for.mockReset();
    mocks.snapshotQuery.for.mockResolvedValue(mocks.snapshotRows);
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

  it("removes every snapshot blob after the design deletion commits", async () => {
    await expect(action.run({ id: "design-one" })).resolves.toEqual({
      id: "design-one",
      deleted: true,
    });

    expect(mocks.deleteVisualEditSnapshotBlobs).toHaveBeenCalledWith([
      "serialized-handle",
    ]);
    expect(
      mocks.queueVisualEditSnapshotBlobCleanupInTransaction,
    ).toHaveBeenCalledWith(mocks.tx, ["serialized-handle"]);
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
});
