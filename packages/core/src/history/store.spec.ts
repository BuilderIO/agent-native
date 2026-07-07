import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

const {
  __resetHistoryInitForTests,
  ensureResourceVersionsTable,
  getResourceVersionById,
  insertResourceVersion,
  queryResourceVersions,
} = await import("./store.js");

beforeEach(async () => {
  sqlite = new Database(":memory:");
  rawClient.execute.mockClear();
  __resetHistoryInitForTests();
  await ensureResourceVersionsTable();
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("resource history store", () => {
  it("creates sequential versions and round-trips snapshot JSON", async () => {
    const first = await insertResourceVersion({
      resourceType: "doc",
      resourceId: "d1",
      createdBy: "alice@example.com",
      ownerEmail: "alice@example.com",
      title: "First draft",
      snapshot: { title: "Draft", blocks: [{ id: "intro" }] },
      metadata: { source: "test" },
    });
    const second = await insertResourceVersion({
      resourceType: "doc",
      resourceId: "d1",
      createdBy: "alice@example.com",
      ownerEmail: "alice@example.com",
      title: "Second draft",
      snapshot: { title: "Draft 2" },
    });

    expect(first.versionNumber).toBe(1);
    expect(second.versionNumber).toBe(2);

    const rows = await queryResourceVersions({
      resourceType: "doc",
      resourceId: "d1",
      scope: { userEmail: "alice@example.com" },
    });
    expect(rows.map((row) => row.versionNumber)).toEqual([2, 1]);
    expect(rows[1].snapshot).toBeUndefined();

    const full = await getResourceVersionById(first.id, {
      userEmail: "alice@example.com",
    });
    expect(full?.snapshot).toEqual({
      title: "Draft",
      blocks: [{ id: "intro" }],
    });
    expect(full?.metadata).toEqual({ source: "test" });
  });

  it("scopes private, org, and public versions", async () => {
    await insertResourceVersion({
      resourceType: "doc",
      resourceId: "private",
      ownerEmail: "alice@example.com",
      snapshot: { private: true },
    });
    await insertResourceVersion({
      resourceType: "doc",
      resourceId: "org-doc",
      ownerEmail: "bob@example.com",
      orgId: "org-1",
      visibility: "org",
      snapshot: { org: true },
    });
    await insertResourceVersion({
      resourceType: "doc",
      resourceId: "public-doc",
      ownerEmail: "bob@example.com",
      visibility: "public",
      snapshot: { public: true },
    });

    expect(
      await queryResourceVersions({
        resourceType: "doc",
        resourceId: "private",
        scope: { userEmail: "bob@example.com", orgId: "org-1" },
      }),
    ).toHaveLength(0);
    expect(
      await queryResourceVersions({
        resourceType: "doc",
        resourceId: "org-doc",
        scope: { userEmail: "alice@example.com", orgId: "org-1" },
      }),
    ).toHaveLength(1);
    expect(
      await queryResourceVersions({
        resourceType: "doc",
        resourceId: "public-doc",
        scope: {},
      }),
    ).toHaveLength(1);
  });
});
