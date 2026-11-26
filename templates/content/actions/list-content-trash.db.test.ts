import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq, inArray } from "drizzle-orm";
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
let listFilterOptions: typeof import("./list-content-trash-filter-options.js").default;
let restoreCollection: typeof import("./restore-content-database.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listTrash = (await import("./list-content-trash.js")).default;
  listFilterOptions = (await import("./list-content-trash-filter-options.js"))
    .default;
  restoreCollection = (await import("./restore-content-database.js")).default;
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
        createdBy: "nested-creator@example.test",
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

  it("matches where conditions joined by any or all, as the filter chips send them", async () => {
    const either = await asOwner(() =>
      listTrash.run(
        listTrash.schema.parse({
          where: JSON.stringify({
            mode: "or",
            items: [
              { field: "createdBy", values: ["CREATOR-TWO@example.test"] },
              { field: "updatedBy", values: ["editor-one@example.test"] },
            ],
          }),
          limit: 50,
        }),
      ),
    );
    expect(either.items.map((item) => item.documentId).sort()).toEqual([
      "trash-root",
      "trash-root-two",
    ]);
    const both = await asOwner(() =>
      listTrash.run(
        listTrash.schema.parse({
          where: {
            mode: "and",
            items: [
              { field: "deletedBy", operator: "isNot", values: [OWNER] },
              {
                mode: "or",
                conditions: [
                  { field: "kind", values: ["page"] },
                  { field: "createdBy", values: [OWNER] },
                ],
              },
            ],
          },
          limit: 50,
        }),
      ),
    );
    expect(both.items.map((item) => item.documentId)).toEqual([
      "trash-root-two",
    ]);
    expect(() =>
      listTrash.schema.parse({
        where: { mode: "and", items: [{ field: "deletedAt" }] },
      }),
    ).toThrow();
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

  it("offers the creator and original parent of a nested row the root view has not loaded", async () => {
    const roots = await asOwner(() => listTrash.run({ limit: 50 }));
    expect(roots.items.map((item) => item.documentId)).not.toContain(
      "trash-child",
    );

    const options = await asOwner(() => listFilterOptions.run({ limit: 500 }));
    expect(options.people.map((person) => person.email)).toContain(
      "nested-creator@example.test",
    );
    expect(options.locations).toContainEqual({
      id: "trash-root",
      title: "Duplicate title",
    });
    expect(options.locations.map((location) => location.id)).not.toContain(
      "trash-root-two",
    );
    expect(JSON.stringify(options)).not.toContain(DENIED);
    expect(options).toMatchObject({
      peopleComplete: true,
      locationsComplete: true,
    });

    const picked = await asOwner(() =>
      listTrash.run(
        listTrash.schema.parse({
          where: {
            mode: "and",
            items: [
              { field: "createdBy", values: ["nested-creator@example.test"] },
              { field: "parentId", values: ["trash-root"] },
            ],
          },
          limit: 50,
        }),
      ),
    );
    expect(picked.items.map((item) => item.documentId)).toEqual([
      "trash-child",
    ]);
  });

  it("rejects a where over the total condition or value budget before querying", () => {
    const emails = (prefix: string) =>
      Array.from(
        { length: 100 },
        (_, index) => `${prefix}-${index}@example.test`,
      );
    const kindGroup = {
      mode: "and",
      conditions: Array.from({ length: 30 }, () => ({
        field: "kind",
        operator: "is",
        values: ["page"],
      })),
    };
    const valueConditions = ["createdBy", "updatedBy", "deletedBy"].map(
      (field) => ({ field, operator: "is", values: emails(field) }),
    );
    for (const where of [
      { mode: "or", items: valueConditions },
      { mode: "or", items: [kindGroup, kindGroup] },
    ]) {
      const parsed = listTrash.schema.safeParse({ where, limit: 50 });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
        "A Trash filter allows at most 50 conditions and 200 values in total",
      );
    }
    expect(
      listTrash.schema.safeParse({
        where: { mode: "or", items: valueConditions.slice(0, 2) },
        limit: 50,
      }).success,
    ).toBe(true);
  });

  it("continues a cursor issued before where filters existed", async () => {
    const first = await asOwner(() =>
      listTrash.run({ sort: "deletedAt", direction: "desc", limit: 1 }),
    );
    const decoded = JSON.parse(
      Buffer.from(first.nextCursor ?? "", "base64url").toString("utf8"),
    );
    const baseFilter = createHash("sha256")
      .update(
        JSON.stringify([
          OWNER,
          "",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          "deletedAt",
          "desc",
        ]),
      )
      .digest("hex");
    expect(decoded.filter).toBe(baseFilter);

    const baseCursor = Buffer.from(
      JSON.stringify({
        version: 2,
        filter: baseFilter,
        value: decoded.value,
        id: decoded.id,
      }),
    ).toString("base64url");
    for (const where of [undefined, { mode: "and" as const, items: [] }]) {
      const next = await asOwner(() =>
        listTrash.run({
          sort: "deletedAt",
          direction: "desc",
          limit: 1,
          cursor: baseCursor,
          ...(where ? { where } : {}),
        }),
      );
      expect(next.items[0]?.documentId).toBe("trash-root-two");
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

  it("restores a legacy collection only against the deletion Trash listed", async () => {
    const now = new Date().toISOString();
    const deletedAt = (id: string) =>
      getDb()
        .select({ deletedAt: schema.contentDatabases.deletedAt })
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, id))
        .then((rows: Array<{ deletedAt: string | null }>) => rows);
    const listed = async (databaseId: string) => {
      const page = await asOwner(() =>
        listTrash.run({ kind: "database", query: "Pinned legacy" }),
      );
      return page.items.find((item) => item.databaseId === databaseId);
    };
    await getDb()
      .insert(schema.documents)
      .values(
        ["pinned-guarded-page", "pinned-legacy-page"].map((id) => ({
          id,
          spaceId: SPACE_ID,
          ownerEmail: OWNER,
          title: "Pinned legacy collection",
          content: "",
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        })),
      );
    await getDb()
      .insert(schema.contentDatabases)
      .values(
        ["pinned-guarded", "pinned-legacy"].map((id) => ({
          id,
          spaceId: SPACE_ID,
          ownerEmail: OWNER,
          documentId: `${id}-page`,
          title: "Pinned legacy collection",
          deletedAt: "2026-09-13T00:00:00.000Z",
          createdAt: now,
          updatedAt: now,
        })),
      );
    try {
      const shown = await listed("pinned-guarded");
      expect(shown).toMatchObject({
        legacyRestoreDatabaseId: "pinned-guarded",
        canRestore: true,
        collectionRestore: {
          spaceId: SPACE_ID,
          databaseDocumentId: "pinned-guarded-page",
          configurationRevision: expect.any(String),
        },
      });
      const pinned = {
        target: {
          spaceId: SPACE_ID,
          databaseId: "pinned-guarded",
          databaseDocumentId: "pinned-guarded-page",
        },
        expectedConfigurationRevision:
          shown?.collectionRestore?.configurationRevision ?? "",
      };

      await asOwner(() =>
        restoreCollection.run({ ...pinned, idempotencyKey: "other-tab" }),
      );
      expect(await deletedAt("pinned-guarded")).toEqual([{ deletedAt: null }]);
      await getDb()
        .update(schema.contentDatabases)
        .set({ deletedAt: "2026-09-15T00:00:00.000Z" })
        .where(eq(schema.contentDatabases.id, "pinned-guarded"));

      await expect(
        asOwner(() =>
          restoreCollection.run({ ...pinned, idempotencyKey: "this-tab" }),
        ),
      ).rejects.toMatchObject({ errorCode: "CONFIGURATION_REVISION_CONFLICT" });
      expect(await deletedAt("pinned-guarded")).toEqual([
        { deletedAt: "2026-09-15T00:00:00.000Z" },
      ]);

      await expect(
        asOwner(() =>
          restoreCollection.run({
            databaseId: "pinned-legacy",
            expectedDeletedAt: "2026-09-12T00:00:00.000Z",
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "TRASH_REVISION_CONFLICT" });
      expect(await deletedAt("pinned-legacy")).toEqual([
        { deletedAt: "2026-09-13T00:00:00.000Z" },
      ]);
      const legacy = await listed("pinned-legacy");
      await asOwner(() =>
        restoreCollection.run({
          databaseId: "pinned-legacy",
          expectedDeletedAt: legacy?.trashedAt,
        }),
      );
      expect(await deletedAt("pinned-legacy")).toEqual([{ deletedAt: null }]);
    } finally {
      await getDb()
        .delete(schema.contentDatabases)
        .where(
          inArray(schema.contentDatabases.id, [
            "pinned-guarded",
            "pinned-legacy",
          ]),
        );
      await getDb()
        .delete(schema.documents)
        .where(
          inArray(schema.documents.id, [
            "pinned-guarded-page",
            "pinned-legacy-page",
          ]),
        );
    }
  });
});
