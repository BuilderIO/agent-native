import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const assertAccessMock = vi.hoisted(() => vi.fn());
const libraryAccessMock = vi.hoisted(() =>
  vi.fn(async () => ({ role: "owner", canApprove: true })),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: assertAccessMock,
}));
const deleteDraftMock = vi.hoisted(() => vi.fn(async () => true));
const unrestrictedScope = vi.hoisted(() => ({
  unrestricted: true,
  approvableLibraryIds: new Set<string>(),
  ownRunIds: new Set<string>(),
  callerEmail: "viewer@example.test",
}));

vi.mock("../server/lib/library-access.js", () => ({
  assertCanDraft: libraryAccessMock,
  assertCanApprove: libraryAccessMock,
  assertCanDraftAuthoredBy: libraryAccessMock,
  assertCanDeleteAsset: libraryAccessMock,
  // The draft-input guards have their own tests; these specs exercise the
  // surrounding behavior with an approver's unrestricted scope.
  draftScopeForLibrary: vi.fn(async () => unrestrictedScope),
  resolveDraftReadScope: vi.fn(async () => unrestrictedScope),
  unrestrictedDraftReadScope: vi.fn(() => unrestrictedScope),
  assertCanUseAssets: vi.fn(),
  assertCanUseRuns: vi.fn(),
  canReadDraftAsset: vi.fn(() => true),
  canReadRun: vi.fn(() => true),
  draftReadFilter: vi.fn(() => undefined),
  runReadFilter: vi.fn(() => undefined),
  sessionReadFilter: vi.fn(() => undefined),
  canReadSession: vi.fn(() => true),
  deleteDraftAssetIfUnchanged: deleteDraftMock,
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
    libraryAccessMock.mockResolvedValue({ role: "owner", canApprove: true });
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
