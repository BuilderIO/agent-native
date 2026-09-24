import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-favorites-order-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "favorites-order-owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let getContentDatabase: typeof import("./get-content-database.js").default;
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;
let personalDatabaseViewSettingKey: typeof import("./_content-database-personal-view.js").personalDatabaseViewSettingKey;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const spaces = await import("./_content-spaces.js");
  personalContentSpaceId = spaces.personalContentSpaceId;
  ({ personalDatabaseViewSettingKey } =
    await import("./_content-database-personal-view.js"));
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

describe("scoped Favorites personal ordering", () => {
  it("orders accessible selected-space pins before applying the display bound", async () => {
    const db = getDb();
    const spaceId = personalContentSpaceId(OWNER);
    const databases = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.spaceId, spaceId));
    const favorites = databases.find(
      (database: { systemRole: string | null }) =>
        database.systemRole === "favorites",
    );
    const files = databases.find(
      (database: { systemRole: string | null }) =>
        database.systemRole === "files",
    );
    if (!favorites || !files)
      throw new Error("Missing personal system databases");

    const now = "2026-09-17T12:00:00.000Z";
    const scopedDocuments = Array.from({ length: 54 }, (_, index) => ({
      id: `favorites-order-document-${String(index).padStart(2, "0")}`,
      ownerEmail: OWNER,
      orgId: null,
      spaceId,
      parentId: null,
      title:
        index < 2 ? "Same title" : `Title ${String(index).padStart(2, "0")}`,
      content: "",
      description: "",
      position: index,
      isFavorite: 1,
      hideFromSearch: 0,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    }));
    const inaccessibleDocument = {
      ...scopedDocuments[0],
      id: "favorites-order-inaccessible",
      ownerEmail: "someone-else@example.com",
      title: "Inaccessible",
    };
    const unscopedDocument = {
      ...scopedDocuments[0],
      id: "favorites-order-unscoped",
      spaceId: null,
      title: "Unscoped",
    };
    await db
      .insert(schema.documents)
      .values([...scopedDocuments, inaccessibleDocument, unscopedDocument]);

    const favoriteItems = [
      ...scopedDocuments.map((document, index) => ({
        id:
          index === 0
            ? "favorites-order-item-a"
            : index === 1
              ? "favorites-order-item-b"
              : `favorites-order-item-${String(index).padStart(2, "0")}`,
        ownerEmail: OWNER,
        databaseId: favorites.id,
        documentId: document.id,
        position: index < 2 ? 0 : index,
        createdAt: now,
        updatedAt: now,
      })),
      {
        id: "favorites-order-item-inaccessible",
        ownerEmail: OWNER,
        databaseId: favorites.id,
        documentId: inaccessibleDocument.id,
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "favorites-order-item-unscoped",
        ownerEmail: OWNER,
        databaseId: favorites.id,
        documentId: unscopedDocument.id,
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
    ];
    await db.insert(schema.contentDatabaseItems).values([
      ...favoriteItems,
      ...[...scopedDocuments, inaccessibleDocument].map((document, index) => ({
        id: `favorites-order-files-item-${String(index).padStart(2, "0")}`,
        ownerEmail: OWNER,
        databaseId: files.id,
        documentId: document.id,
        position: index,
        createdAt: now,
        updatedAt: now,
      })),
    ]);

    const viewConfig = JSON.parse(favorites.viewConfigJson);
    const activeViewId = viewConfig.activeViewId ?? viewConfig.views[0].id;
    const customFirst = favoriteItems[53].id;
    await putUserSetting(OWNER, personalDatabaseViewSettingKey(favorites.id), {
      version: 2,
      activeViewId,
      views: [
        {
          id: activeViewId,
          sorts: [],
          filters: [],
          filterMode: "and",
          sidebarOrder: { mode: "custom", itemIds: [customFirst] },
        },
      ],
    });

    const {
      contentDatabaseCustomOrderRank,
      contentDatabaseFilesMembershipFilter,
    } = await import("./_database-utils.js");
    const scopedQueryShape = db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, favorites.id),
          contentDatabaseFilesMembershipFilter(files.id),
        ),
      )
      .limit(50)
      .toSQL();
    expect(scopedQueryShape.sql).toContain(
      'exists (select "id" from "content_database_items" "scoped_files_memberships"',
    );
    expect(scopedQueryShape.sql).toContain(
      '"scoped_files_memberships"."document_id" = "content_database_items"."document_id"',
    );
    expect(scopedQueryShape.sql).toMatch(/\)\) limit \$3$/);
    expect(scopedQueryShape.params).toEqual([favorites.id, files.id, 50]);

    const boundedCustomIds = Array.from(
      { length: 5_000 },
      (_, index) => `stored-item-${index}`,
    );
    const customOrderQueryShape = db
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, favorites.id))
      .orderBy(contentDatabaseCustomOrderRank(boundedCustomIds))
      .limit(50)
      .toSQL();
    expect(customOrderQueryShape.params).toEqual([
      favorites.id,
      JSON.stringify(boundedCustomIds),
      5_001,
      50,
    ]);

    const scoped = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabase.run(
        { databaseId: favorites.id, contentSpaceId: spaceId, limit: 50 },
        { userEmail: OWNER } as any,
      ),
    );
    expect(scoped.items).toHaveLength(50);
    expect(scoped.items.slice(0, 3).map((item) => item.id)).toEqual([
      customFirst,
      "favorites-order-item-a",
      "favorites-order-item-b",
    ]);
    expect(scoped.items.map((item) => item.id)).not.toContain(
      "favorites-order-item-inaccessible",
    );
    expect(scoped.items.map((item) => item.id)).not.toContain(
      "favorites-order-item-unscoped",
    );
    expect(scoped.pagination).toMatchObject({ totalItems: 54, hasMore: true });

    await putUserSetting(OWNER, personalDatabaseViewSettingKey(favorites.id), {
      version: 2,
      activeViewId,
      views: [
        {
          id: activeViewId,
          sorts: [],
          filters: [],
          filterMode: "and",
          sidebarOrder: { mode: "name", itemIds: [customFirst] },
        },
      ],
    });
    const byName = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabase.run(
        { databaseId: favorites.id, contentSpaceId: spaceId, limit: 2 },
        { userEmail: OWNER } as any,
      ),
    );
    expect(byName.items.map((item) => item.id)).toEqual([
      "favorites-order-item-a",
      "favorites-order-item-b",
    ]);

    const aggregate = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabase.run({ databaseId: favorites.id, limit: 100 }, {
        userEmail: OWNER,
      } as any),
    );
    expect(aggregate.items.map((item) => item.id)).toContain(
      "favorites-order-item-unscoped",
    );
    expect(aggregate.items.map((item) => item.id)).not.toContain(
      "favorites-order-item-inaccessible",
    );
  });
});
