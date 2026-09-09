import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ownership: vi.fn(),
  assert: vi.fn(),
  db: vi.fn(),
  databaseLock: vi.fn(),
  documentLocks: vi.fn(),
  pull: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./_content-database-lifecycle.js", () => ({
  assertContentDatabaseLifecycleAccess: mocks.ownership,
  collectInlineDatabaseOwnerBlockIds: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assert,
  resolveAccess: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.refresh,
}));
vi.mock("./_content-database-mutation-lock.js", () => ({
  lockContentDatabaseMutation: mocks.databaseLock,
}));
vi.mock("./_document-lifecycle.js", () => ({
  lockDocumentsForLifecycle: mocks.documentLocks,
}));
vi.mock("./pull-document.js", () => ({ default: { run: mocks.pull } }));
vi.mock("./delete-document.js", () => ({ restoreDocumentSubtree: vi.fn() }));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: mocks.db,
}));

import { restoreLegacyContentDatabase } from "./restore-content-database";

const database = {
  id: "db",
  documentId: "page",
  ownerDocumentId: "host",
  ownerBlockId: "block",
  ownerEmail: "owner@example.com",
  deletedAt: "2026-09-09T00:00:00Z",
};
const backing = {
  id: "page",
  ownerEmail: database.ownerEmail,
  parentId: "host",
  trashedAt: null,
  trashRootId: null,
};
let writes: unknown[];

beforeEach(() => {
  vi.resetAllMocks();
  writes = [];
  mocks.ownership.mockResolvedValue({
    database: { ...database },
    backingDocument: { ...backing },
    isBlockOwned: true,
  });
  mocks.documentLocks.mockResolvedValue([{ ...backing }, { id: "host" }]);
  mocks.assert.mockResolvedValue({ role: "editor" });
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ ...database }] }) }),
    }),
    update: () => ({
      set: (value: unknown) => {
        writes.push(value);
        return { where: () => ({ returning: async () => [{ id: "db" }] }) };
      },
    }),
  };
  mocks.db.mockReturnValue({
    transaction: async (run: (tx: unknown) => unknown) => run(tx),
  });
});

describe("legacy database Trash restore", () => {
  it("locks database before documents, reauthorizes, and only clears exact database deletion state", async () => {
    const result = await restoreLegacyContentDatabase("db", "page");
    expect(mocks.databaseLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.documentLocks.mock.invocationCallOrder[0],
    );
    expect(mocks.assert.mock.calls).toEqual([
      ["document", "page", "viewer"],
      ["document", "host", "editor"],
    ]);
    expect(writes).toEqual([
      { deletedAt: null, updatedAt: expect.any(String) },
    ]);
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(result.affectedDocumentIds).toEqual(["page"]);
    expect(result.affectedDatabaseIds).toEqual(["db"]);
  });

  it("refuses an unexpected database-to-Page binding before locking or writing", async () => {
    await expect(
      restoreLegacyContentDatabase("db", "other-page"),
    ).rejects.toMatchObject({ errorCode: "trash_scope_changed" });
    expect(mocks.databaseLock).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("refuses a Page that became part of a deletion group", async () => {
    mocks.documentLocks.mockResolvedValue([
      { ...backing, trashedAt: database.deletedAt, trashRootId: "new-group" },
    ]);
    await expect(
      restoreLegacyContentDatabase("db", "page"),
    ).rejects.toMatchObject({ errorCode: "trash_scope_changed" });
    expect(writes).toEqual([]);
  });

  it("does not restore after host permission revocation", async () => {
    mocks.assert
      .mockResolvedValueOnce({ role: "viewer" })
      .mockRejectedValueOnce(new Error("Access revoked"));
    await expect(restoreLegacyContentDatabase("db", "page")).rejects.toThrow(
      "Access revoked",
    );
    expect(writes).toEqual([]);
  });

  it("rejects inline ownership changed between the initial read and the database lock", async () => {
    mocks.ownership.mockResolvedValue({
      database: { ...database, ownerBlockId: "previous-block" },
      backingDocument: { ...backing },
      isBlockOwned: true,
    });
    await expect(
      restoreLegacyContentDatabase("db", "page"),
    ).rejects.toMatchObject({ errorCode: "trash_scope_changed" });
    expect(mocks.documentLocks).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});
