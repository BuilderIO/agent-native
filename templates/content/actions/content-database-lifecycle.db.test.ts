import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializeRegistryBlockToMdx } from "../shared/nfm-registry.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-lifecycle-${process.pid}-${Date.now()}.sqlite`,
);
process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let updateDocumentAction: typeof import("./update-document.js").default;
let moveDocumentAction: typeof import("./move-document.js").default;
let deleteContentDatabaseAction: typeof import("./delete-content-database.js").default;
let restoreContentDatabaseAction: typeof import("./restore-content-database.js").default;
let getContentDatabaseAction: typeof import("./get-content-database.js").default;
let listDocumentsAction: typeof import("./list-documents.js").default;
let listTrashedContentDatabasesAction: typeof import("./list-trashed-content-databases.js").default;
let getDocumentAction: typeof import("./get-document.js").default;
let listDocumentPropertiesAction: typeof import("./list-document-properties.js").default;
let addDatabaseItemAction: typeof import("./add-database-item.js").default;

const OWNER = "owner@example.com";
const COLLABORATOR = "collaborator@example.com";

beforeAll(async () => {
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  updateDocumentAction = (await import("./update-document.js")).default;
  moveDocumentAction = (await import("./move-document.js")).default;
  deleteContentDatabaseAction = (await import("./delete-content-database.js"))
    .default;
  restoreContentDatabaseAction = (await import("./restore-content-database.js"))
    .default;
  getContentDatabaseAction = (await import("./get-content-database.js"))
    .default;
  listDocumentsAction = (await import("./list-documents.js")).default;
  listTrashedContentDatabasesAction = (
    await import("./list-trashed-content-databases.js")
  ).default;
  getDocumentAction = (await import("./get-document.js")).default;
  listDocumentPropertiesAction = (await import("./list-document-properties.js"))
    .default;
  addDatabaseItemAction = (await import("./add-database-item.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let counter = 0;

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

function inlineDatabaseBlock(args: {
  blockId: string;
  databaseId: string;
  databaseDocumentId: string;
}) {
  return serializeRegistryBlockToMdx("inline-database", {
    id: args.blockId,
    data: {
      databaseId: args.databaseId,
      databaseDocumentId: args.databaseDocumentId,
      ownerBlockId: args.blockId,
    },
  });
}

async function createDocument(args: {
  id?: string;
  parentId?: string | null;
  title?: string;
  content?: string;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = args.id ?? nextId("doc");
  await db.insert(schema.documents).values({
    id,
    ownerEmail: args.ownerEmail ?? OWNER,
    parentId: args.parentId ?? null,
    title: args.title ?? "Untitled",
    content: args.content ?? "",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createDatabase(args: {
  hostDocumentId?: string | null;
  ownerBlockId?: string | null;
  backingParentId?: string | null;
  deletedAt?: string | null;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = nextId("db");
  const databaseDocumentId = await createDocument({
    id: nextId("dbdoc"),
    parentId: args.backingParentId ?? args.hostDocumentId ?? null,
    title: "Database",
    ownerEmail: args.ownerEmail,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: args.ownerEmail ?? OWNER,
    documentId: databaseDocumentId,
    ownerDocumentId: args.hostDocumentId ?? null,
    ownerBlockId: args.ownerBlockId ?? null,
    title: "Database",
    deletedAt: args.deletedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { databaseId, databaseDocumentId };
}

async function databaseRow(databaseId: string) {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  return database;
}

describe("inline database lifecycle reconcile", () => {
  it("soft-deletes an owned inline database when its owner block is removed", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const ownerBlockId = nextId("inline_database");
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
    });
    const originalContent = inlineDatabaseBlock({
      blockId: ownerBlockId,
      databaseId,
      databaseDocumentId,
    });
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: originalContent })
      .where(eq(schema.documents.id, hostDocumentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: "The database block was removed.",
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([databaseId]);
    expect((await databaseRow(databaseId))?.deletedAt).toEqual(
      expect.any(String),
    );
  });

  it("does not delete when only a non-owning reference block is removed", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const ownerBlockId = nextId("inline_database");
    const referenceBlockId = nextId("inline_database_reference");
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
    });
    const ownerBlock = inlineDatabaseBlock({
      blockId: ownerBlockId,
      databaseId,
      databaseDocumentId,
    });
    const referenceBlock = inlineDatabaseBlock({
      blockId: referenceBlockId,
      databaseId,
      databaseDocumentId,
    });
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: `${ownerBlock}\n${referenceBlock}` })
      .where(eq(schema.documents.id, hostDocumentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: ownerBlock,
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([]);
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });

  it("does not delete when the database document is no longer positionally owned", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const otherParentId = await createDocument({ title: "Other" });
    const ownerBlockId = nextId("inline_database");
    const { databaseId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
      backingParentId: otherParentId,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: "No inline database block here.",
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([]);
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });

  it("clears block ownership when move-document reparents an inline database backing document", async () => {
    const hostDocumentId = await createDocument({ title: "Host A" });
    const ownerBlockId = nextId("inline_database");
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
    });
    const originalContent = inlineDatabaseBlock({
      blockId: ownerBlockId,
      databaseId,
      databaseDocumentId,
    });
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: originalContent })
      .where(eq(schema.documents.id, hostDocumentId));

    await runWithRequestContext({ userEmail: OWNER }, () =>
      moveDocumentAction.run({
        id: databaseDocumentId,
        parentId: null,
      }),
    );

    const movedDatabase = await databaseRow(databaseId);
    expect(movedDatabase?.ownerDocumentId).toBeNull();
    expect(movedDatabase?.ownerBlockId).toBeNull();

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: "The inline reference was removed after reparenting.",
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([]);
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });

  it("skips deletion when inline database parsing is uncertain", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const ownerBlockId = nextId("inline_database");
    const { databaseId } = await createDatabase({
      hostDocumentId,
      ownerBlockId,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: hostDocumentId,
        content: '<InlineDatabase id="broken"',
      }),
    );

    expect(result.softDeletedDatabaseIds).toEqual([]);
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });
});

describe("content database soft-delete actions and reads", () => {
  it("delete-content-database and restore-content-database round-trip deleted_at", async () => {
    const { databaseId } = await createDatabase({});

    const deleted = await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteContentDatabaseAction.run({ databaseId }),
    );
    expect(deleted.deletedAt).toEqual(expect.any(String));
    expect((await databaseRow(databaseId))?.deletedAt).toEqual(
      deleted.deletedAt,
    );

    const restored = await runWithRequestContext({ userEmail: OWNER }, () =>
      restoreContentDatabaseAction.run({ databaseId }),
    );
    expect(restored.deletedAt).toBeNull();
    expect((await databaseRow(databaseId))?.deletedAt).toBeNull();
  });

  it("excludes soft-deleted databases from get-content-database and list-documents", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId: nextId("inline_database"),
      deletedAt: new Date().toISOString(),
    });
    const rowDocumentId = await createDocument({
      parentId: databaseDocumentId,
      title: "Row",
    });
    const db = getDb();
    await db.insert(schema.contentDatabaseItems).values({
      id: nextId("item"),
      ownerEmail: OWNER,
      databaseId,
      documentId: rowDocumentId,
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const databaseResponse = await runWithRequestContext(
      { userEmail: OWNER },
      () => getContentDatabaseAction.run({ databaseId }),
    );
    expect(databaseResponse).toMatchObject({
      available: false,
      reason: "deleted",
      databaseId,
    });

    const listResponse = await runWithRequestContext({ userEmail: OWNER }, () =>
      listDocumentsAction.run({}),
    );
    const listedIds = new Set(listResponse.documents.map((doc) => doc.id));
    expect(listedIds.has(hostDocumentId)).toBe(true);
    expect(listedIds.has(databaseDocumentId)).toBe(false);
    expect(listedIds.has(rowDocumentId)).toBe(false);
  });

  it("blocks direct document and property reads for soft-deleted database pages", async () => {
    const deletedAt = new Date().toISOString();
    const { databaseId, databaseDocumentId } = await createDatabase({
      deletedAt,
    });
    const rowDocumentId = await createDocument({
      parentId: databaseDocumentId,
      title: "Row",
    });
    const db = getDb();
    await db.insert(schema.contentDatabaseItems).values({
      id: nextId("item"),
      ownerEmail: OWNER,
      databaseId,
      documentId: rowDocumentId,
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentAction.run({ id: databaseDocumentId }),
      ),
    ).rejects.toThrow(`Document "${databaseDocumentId}" not found`);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentAction.run({ id: rowDocumentId }),
      ),
    ).rejects.toThrow(`Document "${rowDocumentId}" not found`);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        listDocumentPropertiesAction.run({ documentId: rowDocumentId }),
      ),
    ).rejects.toThrow(`Document "${rowDocumentId}" not found`);
  });

  it("blocks row mutations for soft-deleted databases", async () => {
    const { databaseId } = await createDatabase({
      deletedAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        addDatabaseItemAction.run({ databaseId, title: "Should not write" }),
      ),
    ).rejects.toThrow(`Database "${databaseId}" not found`);

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    expect(rows).toEqual([]);
  });

  it("lists only accessible soft-deleted databases for Trash", async () => {
    const deletedAt = new Date().toISOString();
    const ownedDeleted = await createDatabase({
      deletedAt,
    });
    const active = await createDatabase({});
    const otherDeleted = await createDatabase({
      deletedAt,
      ownerEmail: "other@example.com",
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      listTrashedContentDatabasesAction.run({}),
    );

    expect(result.databases).toEqual(
      expect.arrayContaining([
        {
          databaseId: ownedDeleted.databaseId,
          title: "Database",
          documentId: ownedDeleted.databaseDocumentId,
          ownerDocumentId: null,
          deletedAt,
        },
      ]),
    );
    const listedIds = new Set(
      result.databases.map((database) => database.databaseId),
    );
    expect(listedIds.has(active.databaseId)).toBe(false);
    expect(listedIds.has(otherDeleted.databaseId)).toBe(false);
  });

  it("requires host document edit access before detaching inline database ownership", async () => {
    const hostDocumentId = await createDocument({ title: "Host" });
    const { databaseId, databaseDocumentId } = await createDatabase({
      hostDocumentId,
      ownerBlockId: nextId("inline_database"),
    });
    const db = getDb();
    await db.insert(schema.documentShares).values({
      id: nextId("share"),
      resourceId: databaseDocumentId,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: COLLABORATOR }, () =>
        moveDocumentAction.run({ id: databaseDocumentId, parentId: null }),
      ),
    ).rejects.toThrow(`No access to document ${hostDocumentId}`);

    const database = await databaseRow(databaseId);
    expect(database?.ownerDocumentId).toBe(hostDocumentId);
    expect(database?.ownerBlockId).toEqual(expect.any(String));
  });
});
