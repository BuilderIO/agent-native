import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  const insertChain = { values: vi.fn() };
  const updateChain = { set: vi.fn(), where: vi.fn() };
  updateChain.set.mockReturnValue(updateChain);
  return {
    data: {} as Record<string, unknown>,
    selectChain,
    insertChain,
    updateChain,
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
    mutateDesignData: vi.fn(),
    assertAccess: vi.fn(),
    seedFromText: vi.fn(),
    nanoid: vi.fn(),
  };
});

vi.mock("@agent-native/core/collab", () => ({
  seedFromText: state.seedFromText,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: state.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (left: unknown, right: unknown) => ({ left, right }),
  sql: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: state.nanoid }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => state.db,
  schema: {
    designs: { id: "designs.id" },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
    },
  },
}));

vi.mock("../server/lib/design-data-mutation.js", () => ({
  mutateDesignData: state.mutateDesignData,
}));

import action from "./migrate-board-objects-to-file.js";

beforeEach(() => {
  vi.clearAllMocks();
  state.data = {
    concurrentCanvasWrite: { keep: true },
    boardObjects: {
      legacy: {
        id: "legacy",
        kind: "rectangle",
        geometry: { x: -120, y: 40, width: 80, height: 60 },
        createdAt: "2026-07-09T00:00:00.000Z",
      },
    },
  };
  state.selectChain.limit.mockResolvedValue([]);
  state.insertChain.values.mockResolvedValue(undefined);
  state.seedFromText.mockResolvedValue(undefined);
  state.nanoid.mockReturnValue("board-file-1");
  state.mutateDesignData.mockImplementation(
    async (options: {
      mutate: (
        current: Record<string, unknown>,
        context: { updatedAt: string },
      ) => Record<string, unknown>;
      isApplied: (current: Record<string, unknown>) => boolean;
    }) => {
      const updatedAt = "2026-07-09T12:00:00.000Z";
      state.data = options.mutate(state.data, { updatedAt });
      expect(options.isApplied(state.data)).toBe(true);
      return { data: state.data, updatedAt };
    },
  );
});

describe("migrate-board-objects designs.data mutation", () => {
  it("reserves, writes, and finalizes without dropping concurrent sibling data", async () => {
    const result = await action.run({ designId: "design-1" });

    expect(result).toMatchObject({
      migrated: true,
      boardFileId: "board-file-1",
      migratedObjectCount: 1,
    });
    expect(state.mutateDesignData).toHaveBeenCalledTimes(2);
    expect(state.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "board-file-1",
        content: expect.stringContaining("left:-120px"),
      }),
    );
    expect(state.data).toMatchObject({
      concurrentCanvasWrite: { keep: true },
      boardFileId: "board-file-1",
      boardObjects: null,
    });
    expect(state.data).not.toHaveProperty("boardFileMigrationId");
  });
});
