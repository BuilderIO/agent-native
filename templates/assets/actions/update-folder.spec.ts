import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
  schema: {
    assetFolders: {
      id: "asset_folders.id",
    },
  },
}));

import action from "./update-folder.js";

function createDb(rows: unknown[][]) {
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  }));
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => rows.shift() ?? []),
        })),
      })),
    })),
    update,
  };
}

describe("update-folder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue(undefined);
  });

  it("rejects moving a folder under one of its descendants", async () => {
    const db = createDb([
      [{ id: "folder-a", libraryId: "lib-1", parentId: null }],
      [{ id: "folder-b", libraryId: "lib-1", parentId: "folder-c" }],
      [{ id: "folder-c", libraryId: "lib-1", parentId: "folder-a" }],
    ]);
    getDbMock.mockReturnValue(db);

    await expect(
      action.run({ id: "folder-a", parentId: "folder-b" }),
    ).rejects.toThrow(/cannot be moved into one of its children/);
    expect(db.update).not.toHaveBeenCalled();
  });
});
