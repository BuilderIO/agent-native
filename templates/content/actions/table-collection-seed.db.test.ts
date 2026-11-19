import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `table-collection-seed-test-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createInlineContentDatabaseAction: typeof import("./create-inline-content-database.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  registerLabs([CREATIVE_CONTEXT_LIBRARY_LAB]);
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createInlineContentDatabaseAction = (
    await import("./create-inline-content-database.js")
  ).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  const { scheduleStartupMaintenance } =
    await import("../server/lib/startup-maintenance.js");
  await scheduleStartupMaintenance();
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;
async function hostPage() {
  const now = new Date().toISOString();
  const id = `host_${++counter}_${Math.random().toString(36).slice(2, 8)}`;
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    title: "Host page",
    content: "",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function collectionContents(databaseId: string) {
  const db = getDb();
  const properties = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId))
    .orderBy(asc(schema.documentPropertyDefinitions.position));
  const items = await db
    .select({
      documentId: schema.contentDatabaseItems.documentId,
      title: schema.documents.title,
      parentId: schema.documents.parentId,
      spaceId: schema.documents.spaceId,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(eq(schema.contentDatabaseItems.databaseId, databaseId))
    .orderBy(asc(schema.contentDatabaseItems.position));
  const values =
    items.length > 0
      ? await db
          .select()
          .from(schema.documentPropertyValues)
          .where(
            inArray(
              schema.documentPropertyValues.documentId,
              items.map((item: { documentId: string }) => item.documentId),
            ),
          )
      : [];
  return { properties, items, values };
}

describe("create-inline-content-database with a table", () => {
  it("fills the new collection with the table's rows and columns", async () => {
    const hostDocumentId = await hostPage();
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      createInlineContentDatabaseAction.run({
        hostDocumentId,
        title: "Untitled collection",
        newDocumentId: `table_collection_${counter}`,
        ownerBlockId: `inline-database-table-${counter}`,
        table: {
          properties: ["Owner", "Due"],
          rows: [
            ["Write brief", "Ana", "Monday"],
            ["Review", "", "Fri\nafternoon"],
          ],
        },
      }),
    );

    const { properties, items, values } = await collectionContents(
      result.block.databaseId,
    );
    const text = properties.filter(
      (property: { type: string }) => property.type === "text",
    );
    expect(text.map((property: { name: string }) => property.name)).toEqual([
      "Owner",
      "Due",
    ]);
    expect(properties[0].type).toBe("blocks");

    expect(items.map((item: { title: string }) => item.title)).toEqual([
      "Write brief",
      "Review",
    ]);
    for (const item of items) {
      expect(item.parentId).toBe(result.block.databaseDocumentId);
    }

    const [owner, due] = text.map((property: { id: string }) => property.id);
    const valueOf = (documentId: string, propertyId: string) =>
      values.find(
        (value: { documentId: string; propertyId: string }) =>
          value.documentId === documentId && value.propertyId === propertyId,
      )?.valueJson;
    expect(valueOf(items[0].documentId, owner)).toBe(JSON.stringify("Ana"));
    expect(valueOf(items[0].documentId, due)).toBe(JSON.stringify("Monday"));
    expect(valueOf(items[1].documentId, owner)).toBeUndefined();
    expect(valueOf(items[1].documentId, due)).toBe(
      JSON.stringify("Fri\nafternoon"),
    );
  });

  it("makes a collection with properties and no rows from a header-only table", async () => {
    const hostDocumentId = await hostPage();
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      createInlineContentDatabaseAction.run({
        hostDocumentId,
        table: { properties: ["Status"], rows: [] },
      }),
    );
    const { properties, items } = await collectionContents(
      result.block.databaseId,
    );
    expect(
      properties
        .filter((property: { type: string }) => property.type === "text")
        .map((property: { name: string }) => property.name),
    ).toEqual(["Status"]);
    expect(items).toEqual([]);
  });

  it("refuses rows that don't match the properties, and makes nothing", async () => {
    const hostDocumentId = await hostPage();
    const newDocumentId = `table_collection_bad_${counter}`;
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        createInlineContentDatabaseAction.run({
          hostDocumentId,
          newDocumentId,
          table: { properties: ["Owner"], rows: [["Only a title"]] },
        }),
      ),
    ).rejects.toThrow();
    const created = await getDb()
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, newDocumentId),
          eq(schema.documents.ownerEmail, OWNER),
        ),
      );
    expect(created).toEqual([]);
  });
});
