import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const update = { set: vi.fn(), where: vi.fn() };
  update.set.mockReturnValue(update);
  update.where.mockResolvedValue(undefined);
  const designSelect = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    limit: vi.fn(),
  };
  designSelect.from.mockReturnValue(designSelect);
  designSelect.where.mockReturnValue(designSelect);
  designSelect.for.mockReturnValue(designSelect);
  designSelect.limit.mockResolvedValue([{ id: "design-one" }]);
  const snapshotDelete = { where: vi.fn(), returning: vi.fn() };
  snapshotDelete.where.mockReturnValue(snapshotDelete);
  snapshotDelete.returning.mockResolvedValue([]);
  const tx = {
    select: vi.fn(() => designSelect),
    update: vi.fn(() => update),
    delete: vi.fn(() => snapshotDelete),
  };
  return {
    designs: {
      id: "designs.id",
      liveCollaborationEnabled: "designs.enabled",
      updatedAt: "designs.updatedAt",
    },
    snapshots: {
      designId: "snapshots.designId",
      blobHandle: "snapshots.blobHandle",
    },
    design: { liveCollaborationEnabled: false },
    assertAccess: vi.fn(),
    currentAccess: vi.fn(() => ({
      userEmail: "owner@example.test",
      authCapability: "capability:visual-edit:design:design-one",
    })),
    getRequestUserEmail: vi.fn((): string | undefined => "owner@example.test"),
    withDesignSourceMutationTransaction: vi.fn(
      async (_designId: string, callback: (tx: unknown) => Promise<unknown>) =>
        callback(tx),
    ),
    queueCleanup: vi.fn(),
    deleteBlobs: vi.fn(),
    tx,
    update,
    designSelect,
    snapshotDelete,
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  currentAccess: mocks.currentAccess,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));
vi.mock("../server/db/index.js", () => ({
  schema: {
    designs: mocks.designs,
    designVisualEditSnapshots: mocks.snapshots,
  },
}));
vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
}));
vi.mock("../server/lib/visual-edit-snapshot-blobs.js", () => ({
  deleteVisualEditSnapshotBlobs: mocks.deleteBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction: mocks.queueCleanup,
}));

import getCollaborationAction from "./get-visual-edit-collaboration.js";
import updateCollaborationAction from "./update-visual-edit-collaboration.js";

describe("visual-edit collaboration preference", () => {
  beforeEach(() => {
    mocks.design.liveCollaborationEnabled = false;
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: mocks.design,
    });
    mocks.getRequestUserEmail.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.currentAccess.mockReturnValue({
      userEmail: "owner@example.test",
      authCapability: "capability:visual-edit:design:design-one",
    });
    mocks.withDesignSourceMutationTransaction.mockClear();
    mocks.queueCleanup.mockClear();
    mocks.deleteBlobs.mockClear();
    mocks.update.set.mockClear();
    mocks.update.where.mockClear();
    mocks.tx.delete.mockClear();
    mocks.snapshotDelete.returning.mockResolvedValue([]);
  });

  it("gets the persisted preference with viewer access", async () => {
    expect(
      await getCollaborationAction.run(
        { designId: "design-one" },
        { caller: "frontend" },
      ),
    ).toEqual({ designId: "design-one", enabled: false });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-one",
      "viewer",
    );
  });

  it("updates the preference only for a signed-in editor", async () => {
    expect(updateCollaborationAction).toMatchObject({ requiresAuth: true });
    expect(updateCollaborationAction).not.toHaveProperty("capabilityScopes");
    await expect(
      updateCollaborationAction.run(
        { designId: "design-one", enabled: true },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ designId: "design-one", enabled: true });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-one",
      "editor",
      {
        userEmail: "owner@example.test",
        authCapability: undefined,
      },
    );
    expect(mocks.update.set).toHaveBeenCalledWith(
      expect.objectContaining({ liveCollaborationEnabled: true }),
    );
    expect(mocks.withDesignSourceMutationTransaction).toHaveBeenCalled();
    expect(mocks.tx.delete).not.toHaveBeenCalled();
    expect(getCollaborationAction).toMatchObject({ requiresAuth: false });

    mocks.getRequestUserEmail.mockReturnValueOnce(undefined);
    await expect(
      updateCollaborationAction.run(
        { designId: "design-one", enabled: false },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_account_required" });
  });

  it("deletes snapshot rows and queues blob cleanup when collaboration is disabled", async () => {
    mocks.snapshotDelete.returning.mockResolvedValue([
      { blobHandle: "snapshot-blob" },
      { blobHandle: null },
    ]);

    await expect(
      updateCollaborationAction.run(
        { designId: "design-one", enabled: false },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ designId: "design-one", enabled: false });

    expect(mocks.queueCleanup).toHaveBeenCalledWith(mocks.tx, [
      "snapshot-blob",
      null,
    ]);
    expect(mocks.deleteBlobs).toHaveBeenCalledWith(["snapshot-blob", null]);
  });

  it("retries queued blob cleanup when collaboration is disabled without current snapshots", async () => {
    await expect(
      updateCollaborationAction.run(
        { designId: "design-one", enabled: false },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ designId: "design-one", enabled: false });

    expect(mocks.queueCleanup).toHaveBeenCalledWith(mocks.tx, []);
    expect(mocks.deleteBlobs).toHaveBeenCalledWith([]);
  });

  it("does not let a signed-in viewer's visual-edit capability grant editor access", async () => {
    mocks.getRequestUserEmail.mockReturnValue("viewer@example.test");
    mocks.currentAccess.mockReturnValue({
      userEmail: "viewer@example.test",
      authCapability: "capability:visual-edit:design:design-one",
    });
    mocks.assertAccess.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { statusCode: 403 }),
    );

    await expect(
      updateCollaborationAction.run(
        { designId: "design-one", enabled: true },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-one",
      "editor",
      { userEmail: "viewer@example.test", authCapability: undefined },
    );
    expect(mocks.update.set).not.toHaveBeenCalled();
  });
});
