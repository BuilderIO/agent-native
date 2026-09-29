import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-metadata-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "database-metadata-owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let getContentDatabase: typeof import("./get-content-database.js").default;
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const spaces = await import("./_content-spaces.js");
  personalContentSpaceId = spaces.personalContentSpaceId;
  getContentDatabase = (await import("./get-content-database.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await runWithRequestContext({ userEmail: OWNER }, () =>
    spaces.provisionContentSpaces(getDb(), OWNER),
  );
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("Files collection metadata read", () => {
  it("returns the saved view without rows when limit is 0", async () => {
    const db = getDb();
    const spaceId = personalContentSpaceId(OWNER);
    const [files] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.spaceId, spaceId))
      .then((rows: Array<{ systemRole: string | null }>) =>
        rows.filter((row) => row.systemRole === "files"),
      );
    if (!files) throw new Error("Missing personal Files database");

    const now = "2026-09-27T12:00:00.000Z";
    const documents = Array.from({ length: 30 }, (_, index) => ({
      id: `metadata-document-${index}`,
      ownerEmail: OWNER,
      spaceId,
      title: `Metadata page ${index}`,
      content: "body ".repeat(200),
      position: index,
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(schema.documents).values(documents);
    await db.insert(schema.contentDatabaseItems).values(
      documents.map((document, index) => ({
        id: `metadata-item-${index}`,
        ownerEmail: OWNER,
        databaseId: files.id,
        documentId: document.id,
        position: index,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const viewConfig = JSON.parse(files.viewConfigJson);
    const sorts = [{ key: "name", label: "Name", direction: "desc" }];
    const filters = [
      {
        key: "name",
        label: "Name",
        operator: "contains",
        value: "Metadata",
      },
    ];
    await db
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: JSON.stringify({
          ...viewConfig,
          views: viewConfig.views.map((view: { id: string }, index: number) =>
            index === 0 ? { ...view, sorts, filters } : view,
          ),
        }),
      })
      .where(eq(schema.contentDatabases.id, files.id));

    const read = (limit?: number) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        getContentDatabase.run(
          { databaseId: files.id, ...(limit === undefined ? {} : { limit }) },
          { userEmail: OWNER, caller: "frontend" } as any,
        ),
      );
    const metadata = await read(0);
    const complete = await read();
    if ("available" in metadata || "available" in complete)
      throw new Error("Files database unavailable");

    expect(metadata.items).toEqual([]);
    expect(metadata.pagination).toMatchObject({
      limit: 0,
      returnedItems: 0,
      totalItems: 30,
    });
    expect(metadata.database.viewConfig.views[0]).toMatchObject({
      sorts,
      filters: [expect.objectContaining(filters[0])],
    });
    expect(metadata.database.viewConfig).toEqual(complete.database.viewConfig);
    expect(complete.items).toHaveLength(30);
    expect(JSON.stringify(metadata).length).toBeLessThan(
      JSON.stringify(complete).length / 5,
    );
  });
});
