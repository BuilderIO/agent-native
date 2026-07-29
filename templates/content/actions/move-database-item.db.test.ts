import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn().mockResolvedValue(undefined),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `move-database-item-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "owner@example.com";
const OUTSIDER = "outsider@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let moveDatabaseItemAction: typeof import("./move-database-item.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  moveDatabaseItemAction = (await import("./move-database-item.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}`;
}

async function createDatabaseWithItems(
  label: string,
  itemCount = 3,
  systemRole?: string,
) {
  const db = getDb();
  const now = new Date().toISOString();
  const databaseId = nextId(`${label}_database`);
  const databaseDocumentId = nextId(`${label}_database_document`);
  await db.insert(schema.documents).values({
    id: databaseDocumentId,
    ownerEmail: OWNER,
    parentId: null,
    title: `${label} database`,
    content: "",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: `${label} database`,
    systemRole,
    createdAt: now,
    updatedAt: now,
  });

  const items = await Promise.all(
    Array.from({ length: itemCount }, async (_, position) => {
      const documentId = nextId(`${label}_document`);
      const itemId = nextId(`${label}_item`);
      await db.insert(schema.documents).values({
        id: documentId,
        ownerEmail: OWNER,
        parentId: databaseDocumentId,
        title: `${label} ${position}`,
        content: "",
        position,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.contentDatabaseItems).values({
        id: itemId,
        ownerEmail: OWNER,
        databaseId,
        documentId,
        position,
        createdAt: now,
        updatedAt: now,
      });
      return { documentId, itemId };
    }),
  );
  return { databaseId, databaseDocumentId, items };
}

async function itemPositions(databaseId: string) {
  return getDb()
    .select({
      id: schema.contentDatabaseItems.id,
      position: schema.contentDatabaseItems.position,
    })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId))
    .orderBy(asc(schema.contentDatabaseItems.position));
}

describe("move-database-item", () => {
  it("moves an exact membership without changing the underlying page hierarchy", async () => {
    const pinned = await createDatabaseWithItems("pinned");
    const files = await createDatabaseWithItems("files", 0);
    const moved = pinned.items[2]!;
    await getDb()
      .update(schema.documents)
      .set({ parentId: null, position: 42 })
      .where(eq(schema.documents.id, moved.documentId));
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values({
        id: nextId("files_membership"),
        ownerEmail: OWNER,
        databaseId: files.databaseId,
        documentId: moved.documentId,
        position: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      moveDatabaseItemAction.run({
        databaseId: pinned.databaseId,
        itemId: moved.itemId,
        position: 0,
      }),
    );

    expect(await itemPositions(pinned.databaseId)).toEqual([
      { id: moved.itemId, position: 0 },
      { id: pinned.items[0]!.itemId, position: 1 },
      { id: pinned.items[1]!.itemId, position: 2 },
    ]);
    expect(await itemPositions(files.databaseId)).toEqual([
      expect.objectContaining({ position: 0 }),
    ]);
    const [document] = await getDb()
      .select({
        parentId: schema.documents.parentId,
        position: schema.documents.position,
        ownerEmail: schema.documents.ownerEmail,
        visibility: schema.documents.visibility,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, moved.documentId));
    expect(document).toEqual({
      parentId: null,
      position: 42,
      ownerEmail: OWNER,
      visibility: "private",
    });
  });

  it("rejects an item paired with another database", async () => {
    const pinned = await createDatabaseWithItems("pair-pinned", 1);
    const workspaces = await createDatabaseWithItems("pair-workspaces", 1);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        moveDatabaseItemAction.run({
          databaseId: workspaces.databaseId,
          itemId: pinned.items[0]!.itemId,
          position: 0,
        }),
      ),
    ).rejects.toThrow("Database row not found");
  });

  it("keeps reference document positions unchanged for personal system catalogs", async () => {
    const workspaces = await createDatabaseWithItems(
      "workspace-catalog",
      3,
      "workspaces",
    );

    await runWithRequestContext({ userEmail: OWNER }, () =>
      moveDatabaseItemAction.run({
        databaseId: workspaces.databaseId,
        itemId: workspaces.items[2]!.itemId,
        position: 0,
      }),
    );

    expect(await itemPositions(workspaces.databaseId)).toEqual([
      { id: workspaces.items[2]!.itemId, position: 0 },
      { id: workspaces.items[0]!.itemId, position: 1 },
      { id: workspaces.items[1]!.itemId, position: 2 },
    ]);
    const documents = await getDb()
      .select({ id: schema.documents.id, position: schema.documents.position })
      .from(schema.documents)
      .where(eq(schema.documents.parentId, workspaces.databaseDocumentId))
      .orderBy(asc(schema.documents.position));
    expect(documents).toEqual(
      workspaces.items.map((entry, position) => ({
        id: entry.documentId,
        position,
      })),
    );
  });

  it("requires edit access to the ordering surface", async () => {
    const pinned = await createDatabaseWithItems("access-pinned", 1);

    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        moveDatabaseItemAction.run({
          databaseId: pinned.databaseId,
          itemId: pinned.items[0]!.itemId,
          position: 0,
        }),
      ),
    ).rejects.toThrow();
  });

  it("serializes concurrent moves into gapless membership positions", async () => {
    const database = await createDatabaseWithItems("race", 5);

    await Promise.all(
      database.items.map((item) =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          moveDatabaseItemAction.run({
            databaseId: database.databaseId,
            itemId: item.itemId,
            position: 0,
          }),
        ),
      ),
    );

    const positions = await itemPositions(database.databaseId);
    expect(positions.map((item) => item.position)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(positions.map((item) => item.id))).toEqual(
      new Set(database.items.map((item) => item.itemId)),
    );
  });
});
