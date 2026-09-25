import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectChain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  const insertChain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };
  insertChain.values.mockReturnValue(insertChain);
  insertChain.onConflictDoUpdate.mockReturnValue(insertChain);
  return {
    designs: {
      id: "designs.id",
      data: "designs.data",
      visibility: "designs.visibility",
      ownerEmail: "designs.ownerEmail",
      orgId: "designs.orgId",
    },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      content: "designFiles.content",
      fileType: "designFiles.fileType",
    },
    designVisualEditSnapshots: {
      designId: "designVisualEditSnapshots.designId",
      fileId: "designVisualEditSnapshots.fileId",
      html: "designVisualEditSnapshots.html",
      captureRevision: "designVisualEditSnapshots.captureRevision",
      publishedRevision: "designVisualEditSnapshots.publishedRevision",
    },
    assertAccess: vi.fn(),
    sql: vi.fn((chunks: TemplateStringsArray, ...values: unknown[]) => ({
      chunks: [...chunks],
      values,
    })),
    getDb: vi.fn(() => ({
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
    })),
    withDesignSourceMutationTransaction: vi.fn(),
    transaction: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
    },
    insertChain,
    selectChain,
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
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
  sql: mocks.sql,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designFiles: mocks.designFiles,
    designs: mocks.designs,
    designVisualEditSnapshots: mocks.designVisualEditSnapshots,
  },
}));
vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
}));

import reserveSnapshotAction from "./reserve-visual-edit-snapshot.js";

const designId = "design_localhost";
const fileId = "screen_home";
const routeUrl = "http://localhost:5173/";
const design = {
  id: designId,
  ownerEmail: "owner@example.test",
  orgId: null,
  visibility: "public",
  data: JSON.stringify({
    sourceType: "localhost",
    screenMetadata: {
      [fileId]: { sourceType: "localhost", url: routeUrl },
    },
  }),
};
const designRow = {
  data: design.data,
  visibility: design.visibility,
  ownerEmail: design.ownerEmail,
  orgId: design.orgId,
};
const file = { id: fileId, content: routeUrl, fileType: "html" };

describe("reserve visual-edit fallback snapshot", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({ role: "owner", resource: design });
    mocks.getDb.mockClear();
    mocks.selectChain.limit.mockReset();
    mocks.selectChain.limit
      .mockResolvedValueOnce([designRow])
      .mockResolvedValueOnce([file]);
    mocks.withDesignSourceMutationTransaction.mockReset();
    mocks.withDesignSourceMutationTransaction.mockImplementation(
      (
        _designId: string,
        callback: (tx: typeof mocks.transaction) => unknown,
      ) => callback(mocks.transaction),
    );
    mocks.transaction.select.mockClear();
    mocks.transaction.insert.mockClear();
    mocks.insertChain.values.mockClear();
    mocks.insertChain.onConflictDoUpdate.mockClear();
    mocks.insertChain.returning.mockReset();
    mocks.insertChain.returning.mockResolvedValue([{ captureRevision: 12n }]);
  });

  it("atomically increments the server-side order and returns the token before capture", async () => {
    expect(reserveSnapshotAction).toMatchObject({
      requiresAuth: true,
      agentTool: false,
      mcpTool: false,
      capabilityScopes: ["visual-edit"],
    });

    await expect(
      reserveSnapshotAction.run(
        { designId, fileId },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).resolves.toEqual({ designId, fileId, reservationToken: "12" });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      designId,
      "editor",
    );
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        designId,
        fileId,
        html: "",
        captureRevision: 1n,
        publishedRevision: 0n,
      }),
    );
    expect(mocks.insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [
          "designVisualEditSnapshots.designId",
          "designVisualEditSnapshots.fileId",
        ],
        set: expect.objectContaining({
          visibility: "public",
          ownerEmail: "owner@example.test",
        }),
      }),
    );
    expect(mocks.sql).toHaveBeenCalledWith(
      ["", " + 1"],
      "designVisualEditSnapshots.captureRevision",
    );
  });

  it("rejects viewers, foreign files, and non-Localhost screens", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("Requires editor role"));
    await expect(
      reserveSnapshotAction.run(
        { designId, fileId },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/Requires editor role/);
    expect(mocks.withDesignSourceMutationTransaction).not.toHaveBeenCalled();

    mocks.assertAccess.mockResolvedValue({ role: "owner", resource: design });
    mocks.selectChain.limit
      .mockReset()
      .mockResolvedValueOnce([designRow])
      .mockResolvedValueOnce([]);
    await expect(
      reserveSnapshotAction.run(
        { designId, fileId },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/does not belong to this design/);

    const originalData = design.data;
    design.data = JSON.stringify({
      screenMetadata: { [fileId]: { sourceType: "fusion", url: routeUrl } },
    });
    mocks.selectChain.limit
      .mockReset()
      .mockResolvedValueOnce([{ ...designRow, data: design.data }])
      .mockResolvedValueOnce([file]);
    await expect(
      reserveSnapshotAction.run(
        { designId, fileId },
        { caller: "frontend", requestHeaders: new Headers() },
      ),
    ).rejects.toThrow(/Only Localhost screens/);
    design.data = originalData;
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });
});
