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
    delete: vi.fn(() => txDeleteChain),
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
    designData: {} as Record<string, unknown>,
    mutateDesignData: vi.fn(),
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
    },
  },
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: mocks.mutateDesignData,
}));

import action from "./delete-file.js";

describe("delete-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileSelectChain.limit.mockResolvedValue([
      { id: "file-b", designId: "design_123" },
    ]);
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
    mocks.mutateDesignData.mockImplementation(
      async (options: {
        mutate: (
          current: Record<string, unknown>,
          context: { updatedAt: string },
        ) => Record<string, unknown>;
        isApplied: (current: Record<string, unknown>) => boolean;
      }) => {
        const updatedAt = "2026-07-09T00:00:00.000Z";
        mocks.designData = options.mutate(mocks.designData, { updatedAt });
        expect(options.isApplied(mocks.designData)).toBe(true);
        return { data: mocks.designData, updatedAt };
      },
    );
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
    expect(mocks.db.delete).toHaveBeenCalled();
    expect(mocks.mutateDesignData).toHaveBeenCalledTimes(2);

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
    expect(data.updatedAt).toBe("2026-07-09T00:00:00.000Z");
  });
});
