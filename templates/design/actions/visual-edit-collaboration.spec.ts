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
  const snapshotSelect = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
  };
  snapshotSelect.from.mockReturnValue(snapshotSelect);
  snapshotSelect.where.mockReturnValue(snapshotSelect);
  snapshotSelect.for.mockResolvedValue([]);
  const snapshotUpdate = {
    set: vi.fn(),
    where: vi.fn(),
  };
  snapshotUpdate.set.mockReturnValue(snapshotUpdate);
  snapshotUpdate.where.mockReturnValue(snapshotUpdate);
  const snapshots = {
    designId: "snapshots.designId",
    blobHandle: "snapshots.blobHandle",
    captureRevision: "snapshots.captureRevision",
  };
  const tx = {
    select: vi.fn((selection?: Record<string, unknown>) =>
      selection?.blobHandle === snapshots.blobHandle
        ? snapshotSelect
        : designSelect,
    ),
    update: vi.fn((table) => (table === snapshots ? snapshotUpdate : update)),
  };
  return {
    designs: {
      id: "designs.id",
      liveCollaborationEnabled: "designs.enabled",
      updatedAt: "designs.updatedAt",
    },
    snapshots,
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
    snapshotSelect,
    snapshotUpdate,
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  }),
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
    mocks.snapshotSelect.for.mockReset().mockResolvedValue([]);
    mocks.snapshotUpdate.set.mockClear();
    mocks.snapshotUpdate.where.mockClear();
    mocks.tx.update.mockClear();
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
    expect(getCollaborationAction).toMatchObject({ requiresAuth: false });

    mocks.getRequestUserEmail.mockReturnValueOnce(undefined);
    await expect(
      updateCollaborationAction.run(
        { designId: "design-one", enabled: false },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({ errorCode: "visual_edit_account_required" });
  });

  it("invalidates snapshot rows and queues blob cleanup when collaboration is disabled", async () => {
    mocks.snapshotSelect.for.mockResolvedValue([
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
    expect(mocks.snapshotUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        html: "",
        blobHandle: null,
        captureRevision: expect.anything(),
        publishedRevision: 0n,
      }),
    );
  });

  it("retries queued blob cleanup when collaboration is disabled without current snapshots", async () => {
    await expect(
      updateCollaborationAction.run(
        { designId: "design-one", enabled: false },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ designId: "design-one", enabled: false });

    expect(mocks.snapshotSelect.for).toHaveBeenCalledTimes(1);
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
