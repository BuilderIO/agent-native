import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type {
  BuilderCmsSourceEntry,
  ContentDatabaseItem,
  DocumentProperty,
} from "../shared/api";
import { BUILDER_CMS_UNPUBLISHED_CHANGES_KEY } from "./_builder-cms-unpublished-changes";

const statusWrite = vi.hoisted(() => ({ nextFailure: null as Error | null }));
vi.mock("./_builder-status-property.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_builder-status-property.js")>();
  return {
    ...actual,
    async writeBuilderStatusValues(
      ...args: Parameters<typeof actual.writeBuilderStatusValues>
    ) {
      const failure = statusWrite.nextFailure;
      statusWrite.nextFailure = null;
      if (failure) throw failure;
      return actual.writeBuilderStatusValues(...args);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `builder-status-property-test-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const DATABASE_ID = "db_builder_status";
const SOURCE_ID = "src_builder_status";
const MODEL = "builder-status-model";
const NOW = "2026-10-23T00:00:00.000Z";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let utils: typeof import("./_database-source-utils.js");
let statusModule: typeof import("./_builder-status-property.js");

const rows = [
  { documentId: "doc_status_live", title: "Live entry" },
  { documentId: "doc_status_saved", title: "Saved entry" },
  { documentId: "doc_status_autosaved", title: "Autosaved entry" },
  { documentId: "doc_status_draft", title: "Draft entry" },
  { documentId: "doc_status_unknown", title: "Unknown entry" },
];

function items(documentIds = rows.map((row) => row.documentId)) {
  return rows
    .filter((row) => documentIds.includes(row.documentId))
    .map(
      (row) =>
        ({
          id: `item_${row.documentId}`,
          databaseId: DATABASE_ID,
          document: { id: row.documentId, title: row.title, content: "" },
          position: rows.indexOf(row),
          properties: [],
        }) as unknown as ContentDatabaseItem,
    );
}

function entry(
  documentId: string,
  sourceValues: BuilderCmsSourceEntry["sourceValues"],
): [string, BuilderCmsSourceEntry] {
  const fixture = rows.find((row) => row.documentId === documentId);
  if (!fixture) throw new Error(`No fixture row for ${documentId}`);
  const title = fixture.title;
  return [
    documentId,
    {
      id: `entry_${documentId}`,
      model: MODEL,
      title,
      urlPath: `/blog/${documentId}`,
      updatedAt: NOW,
      sourceValues: { "data.title": title, ...sourceValues },
    },
  ];
}

async function statuses() {
  const values = await getDb()
    .select({
      documentId: schema.documentPropertyValues.documentId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues)
    .where(
      eq(
        schema.documentPropertyValues.propertyId,
        statusModule.builderStatusPropertyId(DATABASE_ID),
      ),
    );
  return Object.fromEntries(
    values.map((value: { documentId: string; valueJson: string }) => [
      value.documentId,
      JSON.parse(value.valueJson),
    ]),
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  utils = await import("./_database-source-utils.js");
  statusModule = await import("./_builder-status-property.js");

  const db = getDb();
  await db.insert(schema.documents).values([
    {
      id: "doc_db_builder_status",
      ownerEmail: OWNER,
      title: "Builder status collection",
      createdAt: NOW,
      updatedAt: NOW,
    },
    ...rows.map((row) => ({
      id: row.documentId,
      ownerEmail: OWNER,
      parentId: "doc_db_builder_status",
      title: row.title,
      content: "",
      createdAt: NOW,
      updatedAt: NOW,
    })),
  ]);
  await db.insert(schema.contentDatabases).values({
    id: DATABASE_ID,
    ownerEmail: OWNER,
    documentId: "doc_db_builder_status",
    title: "Builder status collection",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: SOURCE_ID,
    ownerEmail: OWNER,
    databaseId: DATABASE_ID,
    sourceType: "builder-cms",
    sourceName: MODEL,
    sourceTable: MODEL,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.contentDatabaseItems).values(
    rows.map((row, position) => ({
      id: `item_${row.documentId}`,
      ownerEmail: OWNER,
      databaseId: DATABASE_ID,
      documentId: row.documentId,
      position,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  );
  await db.insert(schema.documentPropertyDefinitions).values({
    id: "prop_builder_status_author",
    ownerEmail: OWNER,
    databaseId: DATABASE_ID,
    name: "Author",
    type: "text",
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

it("shows each Builder row's status in a read-only property first in the collection", async () => {
  const seed = {
    sourceId: SOURCE_ID,
    ownerEmail: OWNER,
    sourceType: "builder-cms" as const,
    sourceTable: MODEL,
    items: items(),
    now: NOW,
    existingBuilderRows: new Map([
      [
        "doc_status_saved",
        {
          documentId: "doc_status_saved",
          sourceRowId: "entry_doc_status_saved",
          sourceQualifiedId: `builder-cms://${MODEL}/entry_doc_status_saved`,
          sourceDisplayKey: "Saved entry",
          provenance: "Builder CMS read adapter",
          lastSourceUpdatedAt: NOW,
          // Unreadable, but Content still saved changes over the live entry.
          sourceValuesJson: JSON.stringify({
            published: "published",
            [BUILDER_CMS_UNPUBLISHED_CHANGES_KEY]: "{not json",
          }),
        },
      ],
    ]),
    builderEntriesByDocumentId: new Map([
      entry("doc_status_live", { published: "published" }),
      entry("doc_status_saved", { published: "published" }),
      entry("doc_status_autosaved", {
        published: "published",
        "__builder.meta.hasAutosaves": true,
      }),
      entry("doc_status_draft", { published: "draft" }),
      entry("doc_status_unknown", {}),
    ]),
  };
  await utils.seedMockSourceRows(seed);
  await utils.seedMockSourceRows(seed);

  const definitions = await getDb()
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, DATABASE_ID));
  const status = definitions.filter(
    (definition: { systemRole: string | null }) =>
      definition.systemRole === "builder_status",
  );
  expect(status).toHaveLength(1);
  expect(status[0]).toMatchObject({
    id: statusModule.builderStatusPropertyId(DATABASE_ID),
    name: "Builder status",
    type: "select",
    position: -1,
  });
  expect(JSON.parse(status[0].optionsJson).options).toEqual([
    { id: "published", name: "Published", color: "green" },
    { id: "draft", name: "Draft", color: "gray" },
    { id: "unpublished_changes", name: "Unpublished changes", color: "orange" },
  ]);
  expect(await statuses()).toEqual({
    doc_status_live: "published",
    doc_status_saved: "unpublished_changes",
    doc_status_autosaved: "unpublished_changes",
    doc_status_draft: "draft",
  });
});

it("updates statuses on refresh and clears rows that leave the source", async () => {
  await utils.replaceMockSourceRows({
    sourceId: SOURCE_ID,
    ownerEmail: OWNER,
    sourceType: "builder-cms",
    sourceTable: MODEL,
    items: items([
      "doc_status_live",
      "doc_status_autosaved",
      "doc_status_unknown",
    ]),
    now: NOW,
    builderEntriesByDocumentId: new Map([
      entry("doc_status_live", { published: "draft" }),
      entry("doc_status_autosaved", { published: "published" }),
      entry("doc_status_unknown", { published: "published" }),
    ]),
  });

  expect(await statuses()).toEqual({
    doc_status_live: "draft",
    doc_status_autosaved: "published",
    doc_status_unknown: "published",
  });
});

it("never maps the Builder status to a Builder field", async () => {
  const definitions = await getDb()
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, DATABASE_ID));
  await utils.seedMockSourceFields({
    sourceId: SOURCE_ID,
    ownerEmail: OWNER,
    sourceType: "builder-cms",
    properties: definitions.map(
      (definition: { id: string; name: string; type: string }) =>
        ({
          definition: { ...definition, options: {} },
          value: null,
        }) as unknown as DocumentProperty,
    ),
    now: NOW,
  });

  const mapped = await getDb()
    .select({ propertyId: schema.contentDatabaseSourceFields.propertyId })
    .from(schema.contentDatabaseSourceFields)
    .where(
      and(
        eq(schema.contentDatabaseSourceFields.sourceId, SOURCE_ID),
        eq(
          schema.contentDatabaseSourceFields.propertyId,
          statusModule.builderStatusPropertyId(DATABASE_ID),
        ),
      ),
    );
  expect(mapped).toEqual([]);
  const author = await getDb()
    .select({ propertyId: schema.contentDatabaseSourceFields.propertyId })
    .from(schema.contentDatabaseSourceFields)
    .where(
      eq(
        schema.contentDatabaseSourceFields.propertyId,
        "prop_builder_status_author",
      ),
    );
  expect(author).toHaveLength(1);
});

async function storedPublished(documentId: string) {
  const [row] = await getDb()
    .select({
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
    })
    .from(schema.contentDatabaseSourceRows)
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.sourceId, SOURCE_ID),
        eq(schema.contentDatabaseSourceRows.documentId, documentId),
      ),
    );
  return JSON.parse(row.sourceValuesJson).published;
}

// A save racing a refresh can only land before or after both its rows and
// their statuses, never between them.
it("stores a refresh's rows and their statuses together", async () => {
  const before = await storedPublished("doc_status_live");
  statusWrite.nextFailure = new Error("Status write failed");

  await expect(
    utils.replaceMockSourceRows({
      sourceId: SOURCE_ID,
      ownerEmail: OWNER,
      sourceType: "builder-cms",
      sourceTable: MODEL,
      items: items(["doc_status_live"]),
      now: NOW,
      builderEntriesByDocumentId: new Map([
        entry("doc_status_live", {
          published: before === "draft" ? "published" : "draft",
        }),
      ]),
      documentIds: ["doc_status_live"],
    }),
  ).rejects.toThrow("Status write failed");

  expect(await storedPublished("doc_status_live")).toBe(before);
  expect((await statuses()).doc_status_live).toBe(before);
});

it("adds the status property to a Builder collection with no rows yet", async () => {
  for (const [databaseId, write] of [
    ["db_builder_status_empty_attach", utils.replaceMockSourceRows],
    ["db_builder_status_empty_seed", utils.seedMockSourceRows],
  ] as const) {
    const sourceId = `src_${databaseId}`;
    await getDb()
      .insert(schema.documents)
      .values({
        id: `doc_${databaseId}`,
        ownerEmail: OWNER,
        title: "Empty Builder collection",
        createdAt: NOW,
        updatedAt: NOW,
      });
    await getDb()
      .insert(schema.contentDatabases)
      .values({
        id: databaseId,
        ownerEmail: OWNER,
        documentId: `doc_${databaseId}`,
        title: "Empty Builder collection",
        createdAt: NOW,
        updatedAt: NOW,
      });
    await getDb().insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "builder-cms",
      sourceName: MODEL,
      sourceTable: MODEL,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await write({
      sourceId,
      ownerEmail: OWNER,
      sourceType: "builder-cms",
      sourceTable: MODEL,
      items: [],
      now: NOW,
    });

    const definitions = await getDb()
      .select({
        id: schema.documentPropertyDefinitions.id,
        systemRole: schema.documentPropertyDefinitions.systemRole,
      })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
    expect(definitions).toEqual([
      {
        id: statusModule.builderStatusPropertyId(databaseId),
        systemRole: "builder_status",
      },
    ]);
  }
});

it("leaves the status off a row's copy, which has no Builder entry", async () => {
  await getDb()
    .insert(schema.documentPropertyValues)
    .values({
      id: "value_builder_status_author",
      ownerEmail: OWNER,
      documentId: "doc_status_live",
      propertyId: "prop_builder_status_author",
      valueJson: JSON.stringify("Ada"),
      createdAt: NOW,
      updatedAt: NOW,
    });
  const values = await getDb()
    .select()
    .from(schema.documentPropertyValues)
    .where(eq(schema.documentPropertyValues.documentId, "doc_status_live"));
  expect(
    values.map((value: { propertyId: string }) => value.propertyId).sort(),
  ).toEqual(
    [
      "prop_builder_status_author",
      statusModule.builderStatusPropertyId(DATABASE_ID),
    ].sort(),
  );

  const copied = await statusModule.withoutBuilderStatusValues(getDb(), values);
  expect(copied.map((value) => value.propertyId)).toEqual([
    "prop_builder_status_author",
  ]);
});

it("clears statuses when a local source replaces the Builder one, except rows another Builder source has", async () => {
  await getDb().insert(schema.contentDatabaseSources).values({
    id: "src_builder_status_details",
    ownerEmail: OWNER,
    databaseId: DATABASE_ID,
    sourceType: "builder-cms",
    sourceName: MODEL,
    sourceTable: MODEL,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await getDb()
    .insert(schema.contentDatabaseSourceRows)
    .values({
      id: "row_builder_status_details",
      ownerEmail: OWNER,
      sourceId: "src_builder_status_details",
      databaseItemId: "item_doc_status_autosaved",
      documentId: "doc_status_autosaved",
      sourceRowId: "entry_builder_status_details",
      sourceQualifiedId: `builder-cms://${MODEL}/entry_builder_status_details`,
      sourceDisplayKey: "Autosaved entry",
      sourceValuesJson: JSON.stringify({ published: "published" }),
      createdAt: NOW,
      updatedAt: NOW,
    });
  // Attaching a local source over the Builder one keeps its source id.
  await getDb()
    .update(schema.contentDatabaseSources)
    .set({ sourceType: "mock-local", sourceTable: DATABASE_ID })
    .where(eq(schema.contentDatabaseSources.id, SOURCE_ID));

  await utils.replaceMockSourceRows({
    sourceId: SOURCE_ID,
    ownerEmail: OWNER,
    sourceType: "mock-local",
    sourceTable: DATABASE_ID,
    items: items([
      "doc_status_live",
      "doc_status_autosaved",
      "doc_status_unknown",
    ]),
    now: NOW,
  });

  expect(await statuses()).toEqual({ doc_status_autosaved: "published" });
});

it("clears statuses when a Builder source turns into details for rows another source keeps", async () => {
  // The local source from the test above still keeps the autosaved row.
  expect(await statuses()).toEqual({ doc_status_autosaved: "published" });
  const { removeRowsOwnedOnlyBySource } =
    await import("./change-content-database-source-role.js");

  await removeRowsOwnedOnlyBySource({
    databaseId: DATABASE_ID,
    sourceId: "src_builder_status_details",
  });
  await utils.storeSecondarySourceRows({
    sourceId: "src_builder_status_details",
    ownerEmail: OWNER,
    sourceType: "builder-cms",
    sourceTable: MODEL,
    entries: [],
    now: NOW,
  });

  expect(await statuses()).toEqual({});
  const [membership] = await getDb()
    .select({ id: schema.contentDatabaseItems.id })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.id, "item_doc_status_autosaved"));
  expect(membership).toBeTruthy();
});
