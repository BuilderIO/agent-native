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
    limit: vi.fn(),
  };
  txSelectChain.from.mockReturnValue(txSelectChain);
  txSelectChain.where.mockReturnValue(txSelectChain);

  const txDeleteChain = { where: vi.fn() };
  const txUpdateChain = { set: vi.fn(), where: vi.fn() };
  txUpdateChain.set.mockReturnValue(txUpdateChain);

  const tx = {
    select: vi.fn(() => txSelectChain),
    delete: vi.fn(() => txDeleteChain),
    update: vi.fn(() => txUpdateChain),
  };

  const db = {
    select: vi.fn(() => fileSelectChain),
    transaction: vi.fn(async (callback) => callback(tx)),
  };

  return {
    db,
    tx,
    fileSelectChain,
    txSelectChain,
    txDeleteChain,
    txUpdateChain,
    accessFilter: vi.fn(() => ({ access: true })),
    assertAccess: vi.fn(),
    and: vi.fn((...args) => ({ and: args })),
    eq: vi.fn((left, right) => ({ left, right })),
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
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
    },
  },
}));

import action from "./delete-file.js";

describe("delete-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileSelectChain.limit.mockResolvedValue([
      { id: "file-b", designId: "design_123" },
    ]);
    mocks.txSelectChain.limit.mockResolvedValue([
      {
        data: JSON.stringify({
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
        }),
      },
    ]);
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

  it("deletes the file and prunes stale board metadata", async () => {
    const result = await action.run({ id: "file-b" });

    expect(result).toEqual({ id: "file-b", deleted: true });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_123",
      "editor",
    );
    expect(mocks.tx.delete).toHaveBeenCalled();
    expect(mocks.tx.update).toHaveBeenCalled();

    const updatePayload = mocks.txUpdateChain.set.mock.calls[0]?.[0] as {
      data: string;
      updatedAt: string;
    };
    const data = JSON.parse(updatePayload.data);
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
    expect(data.updatedAt).toBe(updatePayload.updatedAt);
  });
});
