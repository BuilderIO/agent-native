import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);

  return {
    snapshots: {
      designId: "snapshots.designId",
      fileId: "snapshots.fileId",
      html: "snapshots.html",
      updatedAt: "snapshots.updatedAt",
    },
    assertAccess: vi.fn(),
    getDb: vi.fn(() => ({ select: vi.fn(() => query) })),
    query,
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: { designVisualEditSnapshots: mocks.snapshots },
}));

import getSnapshotAction from "./get-visual-edit-snapshot.js";

describe("get visual-edit fallback snapshot", () => {
  beforeEach(() => {
    mocks.assertAccess.mockReset();
    mocks.assertAccess.mockResolvedValue({ role: "viewer" });
    mocks.getDb.mockClear();
    mocks.query.limit.mockReset();
  });

  it("requires design viewer access and scopes the snapshot to its screen", async () => {
    const result = {
      html: "<html><body>Shared</body></html>",
      updatedAt: "2026-09-24T00:00:00.000Z",
      unchanged: false,
    };
    mocks.query.limit.mockResolvedValue([result]);

    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      ...result,
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-one",
      "viewer",
    );
    expect(mocks.query.where).toHaveBeenCalledWith({
      conditions: [
        { left: "snapshots.designId", right: "design-one" },
        { left: "snapshots.fileId", right: "screen-one" },
      ],
    });
  });

  it("omits the HTML body when the viewer already has the latest snapshot", async () => {
    mocks.query.limit.mockResolvedValue([
      {
        html: "<html><body>Shared</body></html>",
        updatedAt: "2026-09-24T00:00:00.000Z",
      },
    ]);

    await expect(
      getSnapshotAction.run(
        {
          designId: "design-one",
          fileId: "screen-one",
          knownUpdatedAt: "2026-09-24T00:00:00.000Z",
        },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: null,
      updatedAt: "2026-09-24T00:00:00.000Z",
      unchanged: true,
    });
  });

  it("returns an explicit empty value when the owner has not published a snapshot", async () => {
    mocks.query.limit.mockResolvedValue([]);

    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: null,
      updatedAt: null,
      unchanged: false,
    });
  });
});
