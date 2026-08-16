import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const inArrayMock = vi.hoisted(() =>
  vi.fn((column: unknown, values: string[]) => ({ column, values })),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  inArray: inArrayMock,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assets: {
      id: "assets.id",
      libraryId: "assets.library_id",
    },
  },
}));

import action from "./delete-assets.js";

function createDb(rows: Array<{ id: string; libraryId: string }>) {
  const deleteWhere = vi.fn(async () => undefined);
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => rows),
      })),
    })),
    delete: vi.fn(() => ({ where: deleteWhere })),
  };
  return { db, deleteWhere };
}

describe("delete-assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
  });

  it("checks every library before deleting a mixed-library selection", async () => {
    const { db, deleteWhere } = createDb([
      { id: "asset-a", libraryId: "library-a" },
      { id: "asset-b", libraryId: "library-b" },
    ]);
    getDbMock.mockReturnValue(db);

    const result = await action.run({
      ids: ["asset-a", "asset-a", "asset-b", "missing"],
    });

    expect(assertAccessMock).toHaveBeenNthCalledWith(
      1,
      "asset-library",
      "library-a",
      "editor",
    );
    expect(assertAccessMock).toHaveBeenNthCalledWith(
      2,
      "asset-library",
      "library-b",
      "editor",
    );
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      requestedCount: 4,
      uniqueRequestedCount: 3,
      foundCount: 2,
      deletedCount: 2,
      missingIds: ["missing"],
    });
  });

  it("does not partially delete when one library is not editable", async () => {
    const { db, deleteWhere } = createDb([
      { id: "asset-a", libraryId: "library-a" },
      { id: "asset-b", libraryId: "library-b" },
    ]);
    getDbMock.mockReturnValue(db);
    assertAccessMock.mockImplementation(async (_type, libraryId) => {
      if (libraryId === "library-b") throw new Error("Editor access required");
    });

    await expect(action.run({ ids: ["asset-a", "asset-b"] })).rejects.toThrow(
      "Editor access required",
    );
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});
