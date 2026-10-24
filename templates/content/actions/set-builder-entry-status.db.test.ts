import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { BuilderCmsSourceEntry, ContentDatabaseItem } from "../shared/api";
import type { ExistingBuilderSourceRowIdentity } from "./_builder-cms-source-adapter";
import {
  BUILDER_CMS_PUBLICATION_INTENT_KEY,
  withBuilderCmsUnpublishedChanges,
} from "./_builder-cms-unpublished-changes";

const TEST_DB_PATH = join(
  tmpdir(),
  `set-builder-entry-status-test-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const DATABASE_ID = "db_entry_status";
const COLLECTION_DOCUMENT_ID = "doc_db_entry_status";
const SOURCE_ID = "src_entry_status";
const MODEL = "entry-status-model";
const NOW = "2026-10-24T00:00:00.000Z";
const TRANSITIONS_ON = JSON.stringify({
  writeMode: "publish_updates",
  allowPublicationTransitions: true,
});

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let utils: typeof import("./_database-source-utils.js");
let statusModule: typeof import("./_builder-status-property.js");
let setStatus: typeof import("./set-builder-entry-status.js").default;
let listProperties: typeof import("./list-document-properties.js").default;
let setWriteMode: typeof import("./set-content-database-source-write-mode.js").default;
let disconnectSource: typeof import("./disconnect-content-database-source.js").default;

const rows = [
  { documentId: "doc_entry_draft", title: "Draft entry" },
  { documentId: "doc_entry_live", title: "Live entry" },
  { documentId: "doc_entry_editor", title: "Editor entry" },
  { documentId: "doc_entry_saved", title: "Saved entry" },
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
  const title = rows.find((row) => row.documentId === documentId)!.title;
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

const entries = () =>
  new Map([
    entry("doc_entry_draft", { published: "draft" }),
    entry("doc_entry_live", { published: "published" }),
    entry("doc_entry_editor", {
      published: "published",
      "__builder.meta.hasAutosaves": true,
    }),
    entry("doc_entry_saved", {
      published: "published",
      "data.title": "Live title",
    }),
  ]);

function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, fn);
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

async function stagedIntent(documentId: string) {
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
  return JSON.parse(row.sourceValuesJson)[BUILDER_CMS_PUBLICATION_INTENT_KEY];
}

async function statusChoices(documentId: string) {
  const result = await asOwner(() =>
    listProperties.run({ documentId, databaseId: DATABASE_ID }),
  );
  return (
    result.properties.find(
      (property) => property.definition.systemRole === "builder_status",
    )?.builderStatusChoices ?? null
  );
}

function pick(documentId: string, status: "published" | "draft") {
  return asOwner(() =>
    setStatus.run({ databaseId: DATABASE_ID, documentId, status }),
  );
}

/** The stored rows, as a refresh reads them before it writes. */
async function readRows(): Promise<
  Map<string, ExistingBuilderSourceRowIdentity>
> {
  const stored = await getDb()
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.sourceId, SOURCE_ID));
  return new Map(
    stored.map((row: ExistingBuilderSourceRowIdentity) => [
      row.documentId,
      row,
    ]),
  );
}

async function refresh(
  builderEntries = entries(),
  existingBuilderRows?: Map<string, ExistingBuilderSourceRowIdentity>,
) {
  await utils.replaceMockSourceRows({
    sourceId: SOURCE_ID,
    ownerEmail: OWNER,
    sourceType: "builder-cms",
    sourceTable: MODEL,
    items: items(),
    now: NOW,
    existingBuilderRows: existingBuilderRows ?? (await readRows()),
    builderEntriesByDocumentId: builderEntries,
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  utils = await import("./_database-source-utils.js");
  statusModule = await import("./_builder-status-property.js");
  setStatus = (await import("./set-builder-entry-status.js")).default;
  listProperties = (await import("./list-document-properties.js")).default;
  setWriteMode = (await import("./set-content-database-source-write-mode.js"))
    .default;
  disconnectSource = (await import("./disconnect-content-database-source.js"))
    .default;

  const db = getDb();
  await db.insert(schema.documents).values([
    {
      id: COLLECTION_DOCUMENT_ID,
      ownerEmail: OWNER,
      title: "Entry status collection",
      createdAt: NOW,
      updatedAt: NOW,
    },
    ...rows.map((row) => ({
      id: row.documentId,
      ownerEmail: OWNER,
      parentId: COLLECTION_DOCUMENT_ID,
      title: row.title,
      content: "",
      createdAt: NOW,
      updatedAt: NOW,
    })),
  ]);
  await db.insert(schema.contentDatabases).values({
    id: DATABASE_ID,
    ownerEmail: OWNER,
    documentId: COLLECTION_DOCUMENT_ID,
    title: "Entry status collection",
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
    capabilitiesJson: JSON.stringify({ liveWritesEnabled: true }),
    metadataJson: TRANSITIONS_ON,
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
  await utils.seedMockSourceRows({
    sourceId: SOURCE_ID,
    ownerEmail: OWNER,
    sourceType: "builder-cms",
    sourceTable: MODEL,
    items: items(),
    now: NOW,
    existingBuilderRows: new Map([
      [
        "doc_entry_saved",
        {
          documentId: "doc_entry_saved",
          sourceRowId: "entry_doc_entry_saved",
          sourceQualifiedId: `builder-cms://${MODEL}/entry_doc_entry_saved`,
          sourceDisplayKey: "Saved entry",
          provenance: "Builder CMS read adapter",
          lastSourceUpdatedAt: NOW,
          // Content saved this title over the live one, unpublished.
          sourceValuesJson: JSON.stringify(
            withBuilderCmsUnpublishedChanges(
              { published: "published", "data.title": "Saved entry" },
              { liveValues: { "data.title": "Live title" } },
            ),
          ),
        },
      ],
    ]),
    builderEntriesByDocumentId: entries(),
  });
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

it("offers Published only where Content can see every unpublished change", async () => {
  expect(await statuses()).toEqual({
    doc_entry_draft: "draft",
    doc_entry_live: "published",
    doc_entry_editor: "unpublished_changes",
    doc_entry_saved: "unpublished_changes",
  });
  expect(await statusChoices("doc_entry_draft")).toEqual([
    { status: "published", available: true },
    { status: "draft", available: true },
  ]);
  expect(await statusChoices("doc_entry_saved")).toEqual([
    { status: "published", available: true },
    { status: "draft", available: true },
  ]);
  expect(await statusChoices("doc_entry_editor")).toEqual([
    { status: "published", available: false },
    { status: "draft", available: true },
  ]);
  await expect(pick("doc_entry_editor", "published")).rejects.toMatchObject({
    errorCode: "builder_status_builder_editor_changes",
    statusCode: 409,
  });
  expect(await stagedIntent("doc_entry_editor")).toBeUndefined();
});

it("stages a publish or unpublish and shows the status it will have", async () => {
  await expect(pick("doc_entry_draft", "published")).resolves.toEqual({
    documentId: "doc_entry_draft",
    sourceId: SOURCE_ID,
    stagedPublicationTransition: "publish",
  });
  await expect(pick("doc_entry_live", "draft")).resolves.toMatchObject({
    stagedPublicationTransition: "unpublish",
  });
  await expect(pick("doc_entry_saved", "published")).resolves.toMatchObject({
    stagedPublicationTransition: "publish",
  });

  expect(await stagedIntent("doc_entry_draft")).toBe("publish");
  expect(await stagedIntent("doc_entry_live")).toBe("unpublish");
  expect(await statuses()).toMatchObject({
    doc_entry_draft: "published",
    doc_entry_live: "draft",
    doc_entry_saved: "published",
  });
});

it("reviews a staged change with no field edits as its own push", async () => {
  const [database] = await getDb()
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, DATABASE_ID));
  const snapshot = await asOwner(() =>
    utils.getContentDatabaseSourceSnapshot(database),
  );
  const changeSet = snapshot?.changeSets.find(
    (candidate) => candidate.documentId === "doc_entry_draft",
  );

  expect(changeSet).toMatchObject({
    direction: "outbound",
    kind: "metadata_update",
    stagedPublicationTransition: "publish",
    fieldChanges: [],
  });
  expect(changeSet?.riskReasons).toContain("staged publish");
  // The saved title goes out with the publish, against the live one.
  const saved = snapshot?.changeSets.find(
    (candidate) => candidate.documentId === "doc_entry_saved",
  );
  expect(saved?.stagedPublicationTransition).toBe("publish");
  expect(saved?.fieldChanges).toEqual([
    expect.objectContaining({
      sourceFieldKey: "data.title",
      currentValue: "Live title",
      proposedValue: "Saved entry",
    }),
  ]);
});

it("gives a repeated publish or unpublish a review id of its own", async () => {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, DATABASE_ID));
  const reviewedId = async () => {
    const snapshot = await asOwner(() =>
      utils.getContentDatabaseSourceSnapshot(database),
    );
    const ids = snapshot?.changeSets.map((changeSet) => changeSet.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    return snapshot?.changeSets.find(
      (changeSet) =>
        changeSet.documentId === "doc_entry_draft" &&
        changeSet.state === "pending_push",
    )?.id;
  };

  const pushed: string[] = [];
  try {
    for (let push = 0; push < 3; push += 1) {
      const id = await reviewedId();
      expect(id).toBeTruthy();
      expect(pushed).not.toContain(id);
      pushed.push(id!);
      await db.insert(schema.contentDatabaseSourceChangeSets).values({
        id: id!,
        ownerEmail: OWNER,
        sourceId: SOURCE_ID,
        databaseItemId: "item_doc_entry_draft",
        documentId: "doc_entry_draft",
        kind: "metadata_update",
        direction: "outbound",
        state: "applied",
        pushMode: "publish",
        localOnly: 1,
        summary: "Published the entry in Builder.",
        fieldChangesJson: "[]",
        bodyChangeJson: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
  } finally {
    for (const id of pushed) {
      await db
        .delete(schema.contentDatabaseSourceChangeSets)
        .where(eq(schema.contentDatabaseSourceChangeSets.id, id));
    }
  }
});

it("keeps a staged change through a refresh until Builder reaches it", async () => {
  await refresh();
  expect(await stagedIntent("doc_entry_draft")).toBe("publish");
  expect((await statuses()).doc_entry_draft).toBe("published");

  await refresh(
    new Map([...entries(), entry("doc_entry_live", { published: "draft" })]),
  );
  expect(await stagedIntent("doc_entry_live")).toBeUndefined();
  expect((await statuses()).doc_entry_live).toBe("draft");
  await refresh();
});

it("keeps a status picked while a refresh was reading Builder", async () => {
  const readBeforePick = await readRows();
  await pick("doc_entry_live", "draft");

  await refresh(entries(), readBeforePick);

  expect(await stagedIntent("doc_entry_live")).toBe("unpublish");
  expect((await statuses()).doc_entry_live).toBe("draft");
  await pick("doc_entry_live", "published");
});

it("clears a staged change when the entry's own status is picked", async () => {
  await expect(pick("doc_entry_draft", "draft")).resolves.toMatchObject({
    stagedPublicationTransition: null,
  });
  expect(await stagedIntent("doc_entry_draft")).toBeUndefined();
  expect((await statuses()).doc_entry_draft).toBe("draft");
});

it("drops staged changes when the source stops allowing them", async () => {
  await pick("doc_entry_draft", "published");
  expect((await statuses()).doc_entry_draft).toBe("published");

  await asOwner(() =>
    setWriteMode.run({
      databaseId: DATABASE_ID,
      sourceId: SOURCE_ID,
      writeMode: "publish_updates",
      allowPublicationTransitions: false,
    }),
  );

  expect(await stagedIntent("doc_entry_draft")).toBeUndefined();
  expect(await stagedIntent("doc_entry_saved")).toBeUndefined();
  expect(await statuses()).toMatchObject({
    doc_entry_draft: "draft",
    doc_entry_saved: "unpublished_changes",
  });
  expect(await statusChoices("doc_entry_draft")).toBeNull();
  await expect(pick("doc_entry_draft", "published")).rejects.toMatchObject({
    errorCode: "builder_status_publication_transitions_off",
    statusCode: 409,
  });

  // Turning them back on doesn't bring the old picks back.
  await asOwner(() =>
    setWriteMode.run({
      databaseId: DATABASE_ID,
      sourceId: SOURCE_ID,
      writeMode: "publish_updates",
      allowPublicationTransitions: true,
    }),
  );
  expect(await stagedIntent("doc_entry_draft")).toBeUndefined();
  expect((await statuses()).doc_entry_draft).toBe("draft");
});

it("keeps the status read-only for a page in two Builder sources", async () => {
  await getDb().insert(schema.contentDatabaseSources).values({
    id: "src_entry_status_details",
    ownerEmail: OWNER,
    databaseId: DATABASE_ID,
    sourceType: "builder-cms",
    sourceName: MODEL,
    sourceTable: MODEL,
    metadataJson: TRANSITIONS_ON,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await getDb()
    .insert(schema.contentDatabaseSourceRows)
    .values({
      id: "row_entry_status_details",
      ownerEmail: OWNER,
      sourceId: "src_entry_status_details",
      databaseItemId: "item_doc_entry_live",
      documentId: "doc_entry_live",
      sourceRowId: "entry_details_live",
      sourceQualifiedId: `builder-cms://${MODEL}/entry_details_live`,
      sourceDisplayKey: "Live entry",
      provenance: "Builder CMS read adapter",
      sourceValuesJson: JSON.stringify({ published: "published" }),
      createdAt: NOW,
      updatedAt: NOW,
    });

  expect(await statusChoices("doc_entry_live")).toBeNull();
  await expect(pick("doc_entry_live", "draft")).rejects.toMatchObject({
    errorCode: "builder_source_ambiguous",
    statusCode: 400,
  });
  await expect(
    asOwner(() =>
      setStatus.run({
        databaseId: DATABASE_ID,
        documentId: "doc_entry_live",
        status: "draft",
        sourceId: SOURCE_ID,
      }),
    ),
  ).resolves.toMatchObject({ stagedPublicationTransition: "unpublish" });
});

it("removes the status property and its view references with the last Builder source", async () => {
  const propertyId = statusModule.builderStatusPropertyId(DATABASE_ID);
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
            sorts: [
              { key: propertyId, label: "Builder status", direction: "asc" },
            ],
            filters: [
              {
                key: propertyId,
                label: "Builder status",
                operator: "equals",
                value: "published",
              },
            ],
            columnWidths: { [propertyId]: 140 },
            groupByPropertyId: propertyId,
            hiddenPropertyIds: [propertyId],
            tableColumnOrderIds: ["name", propertyId],
          },
        ],
      }),
    })
    .where(eq(schema.contentDatabases.id, DATABASE_ID));
  const definition = () =>
    getDb()
      .select({ id: schema.documentPropertyDefinitions.id })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyId));

  await asOwner(() =>
    disconnectSource.run({
      databaseId: DATABASE_ID,
      sourceId: SOURCE_ID,
    }),
  );
  // Another Builder source still has a row, so the property stays.
  expect(await definition()).toHaveLength(1);
  expect(Object.keys(await statuses())).toEqual(["doc_entry_live"]);

  await asOwner(() =>
    disconnectSource.run({
      databaseId: DATABASE_ID,
      sourceId: "src_entry_status_details",
    }),
  );

  expect(await definition()).toEqual([]);
  expect(await statuses()).toEqual({});
  const [database] = await getDb()
    .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, DATABASE_ID));
  const [view] = JSON.parse(database.viewConfigJson).views;
  expect(view).toMatchObject({
    sorts: [],
    filters: [],
    columnWidths: {},
    hiddenPropertyIds: [],
    tableColumnOrderIds: ["name"],
  });
  expect(view.groupByPropertyId ?? null).toBeNull();
});
