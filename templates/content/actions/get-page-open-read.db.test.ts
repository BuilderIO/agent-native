import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActionRunContext } from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-get-page-open-read-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "open-owner@example.com";
const VIEWER = "open-viewer@example.com";
const STRANGER = "open-stranger@example.com";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let getPageOpenReadAction: typeof import("./get-page-open-read.js").default;
let getDocumentAction: typeof import("./get-document.js").default;
let getContentDatabaseAction: typeof import("./get-content-database.js").default;
let getPersonalViewAction: typeof import("./get-content-database-personal-view.js").default;
let updatePersonalViewAction: typeof import("./update-content-database-personal-view.js").default;
let queryItemsAction: typeof import("./query-content-database-items.js").default;
let createContentDatabaseAction: typeof import("./create-content-database.js").default;
let createDocumentAction: typeof import("./create-document.js").default;
let configurePropertyAction: typeof import("./configure-document-property.js").default;
let addDatabaseItemAction: typeof import("./add-database-item.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getPageOpenReadAction = (await import("./get-page-open-read.js")).default;
  getDocumentAction = (await import("./get-document.js")).default;
  getContentDatabaseAction = (await import("./get-content-database.js"))
    .default;
  getPersonalViewAction = (
    await import("./get-content-database-personal-view.js")
  ).default;
  updatePersonalViewAction = (
    await import("./update-content-database-personal-view.js")
  ).default;
  queryItemsAction = (await import("./query-content-database-items.js"))
    .default;
  createContentDatabaseAction = (await import("./create-content-database.js"))
    .default;
  createDocumentAction = (await import("./create-document.js")).default;
  configurePropertyAction = (await import("./configure-document-property.js"))
    .default;
  addDatabaseItemAction = (await import("./add-database-item.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  const { scheduleStartupMaintenance } =
    await import("../server/lib/startup-maintenance.js");
  await scheduleStartupMaintenance();
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

// Each read runs as the browser's own request for that reader.
function as<T>(userEmail: string, run: (ctx: ActionRunContext) => Promise<T>) {
  return runWithRequestContext({ userEmail }, () =>
    run({ caller: "frontend", userEmail }),
  );
}

function openPage(
  userEmail: string,
  args: { id: string } & Record<string, string | boolean>,
) {
  return as(userEmail, (ctx) =>
    getPageOpenReadAction.run(args as { id: string }, ctx),
  );
}

async function seedCollection(suffix: string) {
  return as(OWNER, async (ctx) => {
    const created = await createContentDatabaseAction.run(
      { title: `Survey ${suffix}` },
      ctx,
    );
    const databaseId = created.database.id;
    const documentId = created.database.documentId;
    const configured = await configurePropertyAction.run(
      { documentId, databaseId, name: "Depth", type: "number" },
      ctx,
    );
    const depthId = configured.properties.find(
      (property) => property.definition.name === "Depth",
    )?.definition.id;
    if (!depthId) throw new Error("Missing Depth property.");
    const read = await getContentDatabaseAction.run({ databaseId }, ctx);
    if (!("database" in read) || !read.mutationContract) {
      throw new Error("Fixture collection has no mutation contract.");
    }
    for (const [index, depth] of [3, 9, 6].entries()) {
      await addDatabaseItemAction.run(
        {
          target: read.mutationContract.target,
          expectedSchemaRevision: read.mutationContract.schemaRevision,
          idempotencyKey: `open-read-${suffix}-${index}`,
          title: `Pier ${index}`,
          propertyValues: { [depthId]: depth },
        },
        ctx,
      );
    }
    const deepestFirst = {
      key: depthId,
      label: "Depth",
      direction: "desc" as const,
    };
    await getDb()
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: JSON.stringify({
          activeViewId: "table",
          views: [
            {
              id: "table",
              name: "Table",
              type: "table",
              sorts: [deepestFirst],
              filters: [],
              columnWidths: {},
            },
            {
              id: "board",
              name: "Board",
              type: "board",
              sorts: [],
              filters: [],
              columnWidths: {},
            },
          ],
        }),
      })
      .where(eq(schema.contentDatabases.id, databaseId));
    return { databaseId, documentId, depthId, deepestFirst };
  });
}

async function share(resourceId: string, principalId: string) {
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `share-${resourceId}-${principalId}`,
      resourceId,
      principalType: "user",
      principalId,
      role: "viewer",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
}

const titles = (page: unknown) =>
  (page as { items: Array<{ document: { title: string } }> }).items.map(
    (item) => item.document.title,
  );

describe("get-page-open-read", () => {
  it.each([
    ["its owner", OWNER],
    ["a viewer it is shared with", VIEWER],
  ])(
    "gives %s a collection's page exactly as that reader's own reads would",
    async (_reader, reader) => {
      const fixture = await seedCollection(reader === OWNER ? "own" : "view");
      await share(fixture.documentId, VIEWER);
      const tableQuery = {
        search: "",
        filters: [],
        sorts: [fixture.deepestFirst],
        filterMode: "and" as const,
      };

      const open = await openPage(reader, {
        id: fixture.documentId,
        includePreviewDraft: true,
      });
      const own = await as(reader, async (ctx) => ({
        document: await getDocumentAction.run(
          { id: fixture.documentId, includePreviewDraft: true },
          ctx,
        ),
        database: await getContentDatabaseAction.run(
          { documentId: fixture.documentId, limit: 100 },
          ctx,
        ),
        personalView: await getPersonalViewAction.run(
          { databaseId: fixture.databaseId },
          ctx,
        ),
        rows: await queryItemsAction.run(
          { documentId: fixture.documentId, limit: 100, tableQuery },
          ctx,
        ),
      }));

      expect(open.document).toEqual(own.document);
      expect(open.document.canEdit).toBe(reader === OWNER);
      expect(open.collection).toEqual({
        database: own.database,
        personalView: own.personalView,
        rows: { tableQuery, page: own.rows },
      });
      expect(titles(open.collection?.rows?.page)).toEqual([
        "Pier 1",
        "Pier 2",
        "Pier 0",
      ]);
    },
  );

  it("reads the rows of the reader's personal view, or of the view the address names", async () => {
    const fixture = await seedCollection("personal");
    await share(fixture.documentId, VIEWER);
    const shallowestFirst = { ...fixture.deepestFirst, direction: "asc" };
    await as(VIEWER, (ctx) =>
      updatePersonalViewAction.run(
        {
          databaseId: fixture.databaseId,
          overrides: {
            version: 2,
            activeViewId: "table",
            views: [
              {
                id: "table",
                sorts: [shallowestFirst],
                filters: [],
                filterMode: "and",
              },
            ],
          },
        },
        ctx,
      ),
    );

    const viewer = await openPage(VIEWER, { id: fixture.documentId });
    expect(viewer.collection?.rows?.tableQuery.sorts).toEqual([
      shallowestFirst,
    ]);
    expect(titles(viewer.collection?.rows?.page)).toEqual([
      "Pier 0",
      "Pier 2",
      "Pier 1",
    ]);
    // The owner's view is untouched by the viewer's.
    const owner = await openPage(OWNER, { id: fixture.documentId });
    expect(owner.collection?.rows?.tableQuery.sorts).toEqual([
      fixture.deepestFirst,
    ]);
    // A board shows the collection read's own rows, so it reads none.
    const board = await openPage(VIEWER, {
      id: fixture.documentId,
      databaseViewId: "board",
    });
    expect(board.collection?.database).toBeDefined();
    expect(board.collection?.rows).toBeUndefined();
  });

  it("reads only the page for a plain page or a row opened in its collection", async () => {
    const fixture = await seedCollection("row");
    const plain = await as(OWNER, (ctx) =>
      createDocumentAction.run({ title: "Tide table" }, ctx),
    );
    const row = await getDb()
      .select({ documentId: schema.contentDatabaseItems.documentId })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, fixture.databaseId))
      .limit(1);

    const plainOpen = await openPage(OWNER, { id: plain.id });
    // Without the draft flag the page is get-document's plain answer.
    expect(plainOpen.document).toEqual(
      await as(OWNER, (ctx) => getDocumentAction.run({ id: plain.id }, ctx)),
    );
    expect(plainOpen).not.toHaveProperty("collection");
    const rowOpen = await openPage(OWNER, {
      id: row[0].documentId,
      databaseId: fixture.databaseId,
    });
    expect(rowOpen.document.id).toBe(row[0].documentId);
    expect(rowOpen).not.toHaveProperty("collection");
  });

  it("refuses a missing, trashed or unshared page with a 404, as get-document does", async () => {
    const fixture = await seedCollection("refused");
    await expect(openPage(OWNER, { id: "no-such-page" })).rejects.toMatchObject(
      { statusCode: 404 },
    );
    await expect(
      openPage(STRANGER, { id: fixture.documentId }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, fixture.documentId));
    await expect(
      openPage(OWNER, { id: fixture.documentId }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
