import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-trash-query-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "trash-owner@example.test";
const DENIED = "trash-denied@example.test";
const SPACE_ID = "trash-query-space";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let listTrash: typeof import("./list-content-trash.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listTrash = (await import("./list-content-trash.js")).default;
  await (await import("../server/plugins/db.js")).default(undefined as any);

  const now = new Date().toISOString();
  await getDb().insert(schema.contentSpaces).values({
    id: SPACE_ID,
    name: "Trash query",
    kind: "personal",
    ownerEmail: OWNER,
    orgId: null,
    filesDatabaseId: "trash-query-files",
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .insert(schema.documents)
    .values([
      {
        id: "trash-root",
        spaceId: SPACE_ID,
        ownerEmail: OWNER,
        title: "Duplicate title",
        content: "",
        visibility: "private",
        trashedAt: "2026-09-14T02:00:00.000Z",
        trashRootId: "trash-root",
        trashedBy: OWNER,
        createdBy: OWNER,
        updatedBy: "editor-one@example.test",
        trashOrigin: "ui",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-10T00:00:00.000Z",
      },
      {
        id: "trash-child",
        spaceId: SPACE_ID,
        ownerEmail: OWNER,
        parentId: "trash-root",
        trashParentId: "trash-root",
        title: "Nested exact needle",
        content: "",
        visibility: "private",
        trashedAt: "2026-09-14T02:00:00.000Z",
        trashRootId: "trash-root",
        trashedBy: OWNER,
        createdBy: OWNER,
        updatedBy: "editor-two@example.test",
        trashOrigin: "ui",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "trash-root-two",
        spaceId: SPACE_ID,
        ownerEmail: OWNER,
        title: "Duplicate title",
        content: "",
        visibility: "private",
        trashedAt: "2026-09-14T01:00:00.000Z",
        trashRootId: "trash-root-two",
        trashedBy: "other@example.test",
        createdBy: "creator-two@example.test",
        updatedBy: OWNER,
        createdAt: "2026-09-03T00:00:00.000Z",
        updatedAt: "2026-09-12T00:00:00.000Z",
      },
      {
        id: "trash-denied-child",
        spaceId: SPACE_ID,
        ownerEmail: DENIED,
        parentId: "trash-root-two",
        trashParentId: "trash-root-two",
        title: "Inaccessible nested page",
        content: "",
        visibility: "private",
        trashedAt: "2026-09-14T01:00:00.000Z",
        trashRootId: "trash-root-two",
        trashedBy: DENIED,
        createdBy: DENIED,
        updatedBy: DENIED,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "trash-database-root",
        spaceId: SPACE_ID,
        ownerEmail: OWNER,
        title: "Database root",
        content: "",
        visibility: "private",
        trashedAt: "2026-09-14T00:00:00.000Z",
        trashRootId: "trash-database-root",
        trashedBy: OWNER,
        createdBy: null,
        updatedBy: null,
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-11T00:00:00.000Z",
      },
      {
        id: "trash-database-child",
        spaceId: SPACE_ID,
        ownerEmail: OWNER,
        parentId: "trash-database-root",
        trashParentId: "trash-database-root",
        title: "Deleted block-owned database",
        content: "",
        visibility: "private",
        trashRootId: "trash-database-root",
        trashedBy: OWNER,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  await getDb().insert(schema.contentDatabases).values({
    id: "trash-block-owned-database",
    spaceId: SPACE_ID,
    ownerEmail: OWNER,
    documentId: "trash-database-child",
    ownerDocumentId: "trash-database-root",
    title: "Deleted block-owned database",
    deletedAt: "2026-09-14T00:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("list-content-trash", () => {
  it("installs the partial expression index used by Trash Name sorting", async () => {
    const { rows } = await getDbExec().execute(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'documents_trash_name_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.indexdef).toLowerCase()).toMatch(
      /using btree \(lower\(title\), id\) where \(trashed_at is not null\)/,
    );
  });

  it("browses roots but finds an authorized nested title directly", async () => {
    const roots = await asOwner(() => listTrash.run({ limit: 50 }));
    expect(roots.items.map((item) => item.documentId)).toEqual([
      "trash-root",
      "trash-root-two",
      "trash-database-root",
    ]);
    expect(
      roots.items.find((item) => item.documentId === "trash-root")
        ?.hasAccessibleTrashedChildren,
    ).toBe(true);
    expect(
      roots.items.find((item) => item.documentId === "trash-root-two")
        ?.hasAccessibleTrashedChildren,
    ).toBe(false);
    expect(
      roots.items.find((item) => item.documentId === "trash-database-root")
        ?.hasAccessibleTrashedChildren,
    ).toBe(true);

    const matches = await asOwner(() =>
      listTrash.run({ query: "exact needle", limit: 50 }),
    );
    expect(matches.items.map((item) => item.documentId)).toEqual([
      "trash-child",
    ]);
    expect(matches.items[0]?.parentId).toBe("trash-root");
  });

  it("uses the same access and database-deletion rules for hints and expansion", async () => {
    const permitted = await asOwner(() =>
      listTrash.run({ groupId: "trash-database-root", limit: 50 }),
    );
    expect(permitted.items.map((item) => item.documentId).sort()).toEqual([
      "trash-database-child",
      "trash-database-root",
    ]);

    const denied = await asOwner(() =>
      listTrash.run({ groupId: "trash-root-two", limit: 50 }),
    );
    expect(denied.items.map((item) => item.documentId)).toEqual([
      "trash-root-two",
    ]);
  });

  it("expands groups, applies exact actor filters, and binds cursors", async () => {
    const group = await asOwner(() =>
      listTrash.run({ groupId: "trash-root", limit: 50 }),
    );
    expect(group.items.map((item) => item.documentId).sort()).toEqual([
      "trash-child",
      "trash-root",
    ]);

    const first = await asOwner(() => listTrash.run({ limit: 1 }));
    expect(first.nextCursor).not.toBeNull();
    const second = await asOwner(() =>
      listTrash.run({ limit: 1, cursor: first.nextCursor! }),
    );
    expect(second.items[0]?.documentId).toBe("trash-root-two");
    await expect(
      asOwner(() =>
        listTrash.run({
          actor: OWNER,
          limit: 1,
          cursor: first.nextCursor!,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_cursor" });
  });

  it("filters every actor dimension and a bounded deletion range without leaking denied rows", async () => {
    const created = await asOwner(() =>
      listTrash.run({ createdBy: "creator-two@example.test", limit: 50 }),
    );
    expect(created.items.map((item) => item.documentId)).toEqual([
      "trash-root-two",
    ]);
    const updated = await asOwner(() =>
      listTrash.run({ updatedBy: "editor-one@example.test", limit: 50 }),
    );
    expect(updated.items.map((item) => item.documentId)).toEqual([
      "trash-root",
    ]);
    const deleted = await asOwner(() =>
      listTrash.run({
        deletedFrom: "2026-09-14T00:30:00.000Z",
        deletedTo: "2026-09-14T01:30:00.000Z",
        limit: 50,
      }),
    );
    expect(deleted.items.map((item) => item.documentId)).toEqual([
      "trash-root-two",
    ]);
    expect(JSON.stringify(created)).not.toContain(DENIED);
    expect(
      created.items.every(
        (item) => item.createdByName === null && item.trashedByName === null,
      ),
    ).toBe(true);
    expect(created.items[0]).toMatchObject({
      createdByState: "known",
      trashedByState: "known",
    });

    const offsetEquivalent = await asOwner(() =>
      listTrash.run({
        deletedFrom: "2026-09-13T20:30:00.000-04:00",
        deletedTo: "2026-09-13T21:30:00.000-04:00",
        limit: 50,
      }),
    );
    expect(offsetEquivalent.items.map((item) => item.documentId)).toEqual(
      deleted.items.map((item) => item.documentId),
    );
  });

  it("paginates every stable sort in both directions without duplicates or omissions", async () => {
    for (const sort of [
      "name",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ] as const) {
      for (const direction of ["asc", "desc"] as const) {
        const expected = await asOwner(() =>
          listTrash.run({ sort, direction, limit: 100 }),
        );
        const paged: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await asOwner(() =>
            listTrash.run({ sort, direction, limit: 1, cursor }),
          );
          paged.push(...page.items.map((item) => item.documentId));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(paged).toEqual(expected.items.map((item) => item.documentId));
        expect(new Set(paged).size).toBe(paged.length);
      }
    }
  });

  it("rejects a cursor when any filter or sort state changes", async () => {
    const first = await asOwner(() =>
      listTrash.run({ sort: "name", direction: "asc", limit: 1 }),
    );
    expect(first.nextCursor).not.toBeNull();
    for (const changed of [
      { sort: "name" as const, direction: "desc" as const },
      { sort: "createdAt" as const, direction: "asc" as const },
      { sort: "name" as const, direction: "asc" as const, createdBy: OWNER },
      {
        sort: "name" as const,
        direction: "asc" as const,
        deletedFrom: "2026-09-14T00:00:00.000Z",
      },
    ]) {
      await expect(
        asOwner(() =>
          listTrash.run({ ...changed, cursor: first.nextCursor!, limit: 1 }),
        ),
      ).rejects.toMatchObject({ errorCode: "invalid_cursor" });
    }
  });
});
