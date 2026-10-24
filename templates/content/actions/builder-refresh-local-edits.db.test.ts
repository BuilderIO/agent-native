import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.

import { getDbExec } from "@agent-native/core/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import {
  BUILDER_CMS_BODY_BLOCK_COUNT_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
} from "./_builder-cms-source-adapter.js";

const MODEL = "collection-local-edits";
const OWNER = "owner@example.com";
const DATABASE_ID = "db_local_edits";
const DATABASE_DOCUMENT_ID = "doc_db_local_edits";
const SOURCE_ID = "src_local_edits";
const AUTHOR_PROPERTY_ID = "prop_local_edits_author";
const SPACE_ID = "space_local_edits";

const builder = vi.hoisted(() => ({
  entries: new Map<
    string,
    { title: string; author: string; updatedAt: string }
  >(),
  // Builder can leave out the time an entry last changed.
  bodyReadOmitsUpdateTime: false,
  // How Builder reports an emptied body: an empty block list, or an empty
  // blocks string with no list.
  emptiedBodies: new Map<string, "blocks" | "blocksString">(),
}));

vi.mock("./_builder-cms-read-client.js", async () => {
  const actual = await vi.importActual<
    typeof import("./_builder-cms-read-client.js")
  >("./_builder-cms-read-client.js");
  const toEntry = (
    id: string,
    entry: { title: string; author: string; updatedAt: string },
  ) => ({
    id,
    model: MODEL,
    title: entry.title,
    urlPath: `/blog/${id}`,
    updatedAt: entry.updatedAt,
    sourceValues: {
      "data.title": entry.title,
      "data.url": `/blog/${id}`,
      "data.author": entry.author,
      lastUpdated: entry.updatedAt,
      published: "draft",
    },
  });
  return {
    ...actual,
    readBuilderCmsModelFields: vi.fn(async () => [
      { name: "title", type: "string", required: true },
      { name: "author", type: "string", required: false },
    ]),
    readBuilderCmsContentEntries: vi.fn(async (args?: any) => {
      const entries = [...builder.entries].map(([id, entry]) => {
        if (!args?.includeBodies) return toEntry(id, entry);
        const { updatedAt, ...withoutUpdateTime } = toEntry(id, entry);
        const { lastUpdated, ...valuesWithoutUpdateTime } =
          withoutUpdateTime.sourceValues;
        const timed = !builder.bodyReadOmitsUpdateTime;
        return {
          ...withoutUpdateTime,
          ...(timed ? { updatedAt } : {}),
          sourceValues: timed
            ? withoutUpdateTime.sourceValues
            : valuesWithoutUpdateTime,
          rawEntry: {
            id,
            model: MODEL,
            name: entry.title,
            ...(timed ? { lastUpdated } : {}),
            data: {
              title: entry.title,
              url: `/blog/${id}`,
              author: entry.author,
              blocks: [
                {
                  "@type": "@builder.io/sdk:Element",
                  "@version": 2,
                  id: `text-${id}`,
                  component: {
                    name: "Text",
                    options: { text: `<p>Body ${id}</p>` },
                  },
                },
              ],
            },
          },
        };
      });
      return {
        state: "live",
        entries,
        fetchedAt: "2026-10-24T00:00:00.000Z",
        message: null,
        progress: {
          requestedLimit: 500,
          pageSize: 100,
          startOffset: 0,
          nextOffset: entries.length,
          fetchedEntryCount: entries.length,
          hasMore: false,
          partial: false,
          readMode: "builder-api",
        },
      };
    }),
    readBuilderCmsContentEntry: vi.fn(async () => null),
    // A live read of an entry whose body Builder emptied.
    readBuilderCmsContentEntryResult: vi.fn(
      async (args: { entryId: string }) => {
        const entry = builder.entries.get(args.entryId);
        if (!entry || !builder.emptiedBodies.has(args.entryId)) {
          return {
            state: "not_found",
            entry: null,
            providerStatus: "http_404",
          };
        }
        const found = toEntry(args.entryId, entry);
        const emptyList = builder.emptiedBodies.get(args.entryId) === "blocks";
        return {
          state: "found",
          providerStatus: "http_200",
          entry: {
            ...found,
            sourceValues: emptyList
              ? { ...found.sourceValues, [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 0 }
              : found.sourceValues,
            rawEntry: {
              id: args.entryId,
              model: MODEL,
              name: entry.title,
              lastUpdated: entry.updatedAt,
              data: {
                title: entry.title,
                author: entry.author,
                ...(emptyList ? { blocks: [] } : { blocksString: "" }),
              },
            },
          },
        };
      },
    ),
  };
});

const membershipLock = vi.hoisted(() => ({
  beforeNextLock: null as null | (() => Promise<void>),
  onLockExisting: null as null | ((tx: any) => Promise<void>),
}));

vi.mock("./_database-membership-lock.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_database-membership-lock.js")>();
  return {
    ...actual,
    async lockDatabaseMemberships(tx: any, itemIds: string[]) {
      const beforeLock = membershipLock.beforeNextLock;
      membershipLock.beforeNextLock = null;
      await beforeLock?.();
      return actual.lockDatabaseMemberships(tx, itemIds);
    },
    async lockExistingDatabaseMemberships(tx: any, itemIds: string[]) {
      await membershipLock.onLockExisting?.(tx);
      return actual.lockExistingDatabaseMemberships(tx, itemIds);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `builder-refresh-local-edits-${process.pid}-${Date.now()}.pglite`,
);

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let utils: typeof import("./_database-source-utils.js");
let records: typeof import("./_builder-cms-unpublished-changes.js");

let clock = 0;
function tick() {
  clock += 1;
  return new Date(Date.UTC(2026, 9, 24, 1, clock)).toISOString();
}

async function refresh() {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, DATABASE_ID));
  const [source] = await db
    .select()
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, SOURCE_ID));
  await utils.resyncBuilderCmsSourceSnapshot({
    database,
    source,
    now: tick(),
  });
}

async function documentIdFor(entryId: string) {
  const [row] = await getDb()
    .select({ documentId: schema.contentDatabaseSourceRows.documentId })
    .from(schema.contentDatabaseSourceRows)
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.sourceId, SOURCE_ID),
        eq(schema.contentDatabaseSourceRows.sourceRowId, entryId),
      ),
    );
  return row.documentId as string;
}

async function localAuthor(entryId: string) {
  const [value] = await getDb()
    .select({ valueJson: schema.documentPropertyValues.valueJson })
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(
          schema.documentPropertyValues.documentId,
          await documentIdFor(entryId),
        ),
        eq(schema.documentPropertyValues.propertyId, AUTHOR_PROPERTY_ID),
      ),
    );
  return value ? JSON.parse(value.valueJson) : undefined;
}

async function editAuthor(entryId: string, author: string) {
  await getDb()
    .update(schema.documentPropertyValues)
    .set({ valueJson: JSON.stringify(author), updatedAt: tick() })
    .where(
      and(
        eq(
          schema.documentPropertyValues.documentId,
          await documentIdFor(entryId),
        ),
        eq(schema.documentPropertyValues.propertyId, AUTHOR_PROPERTY_ID),
      ),
    );
}

function editInBuilder(
  entryId: string,
  changes: { title?: string; author?: string },
) {
  builder.entries.set(entryId, {
    ...builder.entries.get(entryId)!,
    ...changes,
    updatedAt: tick(),
  });
}

async function localTitle(entryId: string) {
  const [document] = await getDb()
    .select({ title: schema.documents.title })
    .from(schema.documents)
    .where(eq(schema.documents.id, await documentIdFor(entryId)));
  return document.title as string;
}

async function editTitle(entryId: string, title: string) {
  await getDb()
    .update(schema.documents)
    .set({ title, updatedAt: tick() })
    .where(eq(schema.documents.id, await documentIdFor(entryId)));
}

async function hydrateBody(entryId: string, body: string | null) {
  const [row] = await getDb()
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.sourceId, SOURCE_ID),
        eq(schema.contentDatabaseSourceRows.sourceRowId, entryId),
      ),
    );
  const entry = builder.entries.get(entryId)!;
  const updatedAt = tick();
  await utils.enqueueBuilderBodyHydration({
    sourceId: SOURCE_ID,
    ownerEmail: OWNER,
    orgId: null,
    databaseItemId: row.databaseItemId,
    documentId: row.documentId,
    sourceTable: MODEL,
    entry: {
      id: entryId,
      model: MODEL,
      title: entry.title,
      urlPath: `/blog/${entryId}`,
      updatedAt,
      sourceValues: {
        "data.title": entry.title,
        "data.url": `/blog/${entryId}`,
        "data.author": entry.author,
        lastUpdated: updatedAt,
        published: "draft",
        // Without a body the job reads the live entry.
        ...(body === null ? {} : { [BUILDER_CMS_BODY_CONTENT_KEY]: body }),
      },
    },
    now: updatedAt,
    priority: -1,
  });
  // As the background drain does: opening the page would queue the row's
  // own stored body instead.
  await utils.processBuilderBodyHydrationQueue({
    sourceId: SOURCE_ID,
    limit: 1,
  });
}

async function localBody(entryId: string) {
  const [document] = await getDb()
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, await documentIdFor(entryId)));
  return document.content as string;
}

async function editBody(entryId: string, content: string) {
  await getDb()
    .update(schema.documents)
    .set({ content, updatedAt: tick() })
    .where(eq(schema.documents.id, await documentIdFor(entryId)));
}

async function pendingEdit(entryId: string) {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, DATABASE_ID));
  const documentId = await documentIdFor(entryId);
  const snapshot = await utils.getContentDatabaseSourceSnapshotForReview(
    database,
    SOURCE_ID,
    [documentId],
  );
  return (
    snapshot?.changeSets.find(
      (changeSet) =>
        changeSet.direction === "outbound" &&
        changeSet.documentId === documentId,
    ) ?? null
  );
}

async function editConflicts(entryId: string) {
  const [row] = await getDb()
    .select({
      sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
    })
    .from(schema.contentDatabaseSourceRows)
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.sourceId, SOURCE_ID),
        eq(schema.contentDatabaseSourceRows.sourceRowId, entryId),
      ),
    );
  const read = records.readBuilderCmsEditConflicts(
    JSON.parse(row.sourceValuesJson),
  );
  return read.state === "recorded" ? read.sourceFieldKeys : read.state;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
  utils = await import("./_database-source-utils.js");
  records = await import("./_builder-cms-unpublished-changes.js");
  const { systemIdsForContentSpace } = await import("./_content-spaces.js");
  const filesIds = systemIdsForContentSpace(SPACE_ID, "files");

  const db = getDb();
  const now = tick();
  await db.insert(schema.documents).values([
    {
      id: filesIds.documentId,
      spaceId: SPACE_ID,
      ownerEmail: OWNER,
      title: "Files",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: DATABASE_DOCUMENT_ID,
      ownerEmail: OWNER,
      title: "Local edits",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values([
    {
      id: filesIds.databaseId,
      spaceId: SPACE_ID,
      systemRole: "files",
      ownerEmail: OWNER,
      documentId: filesIds.documentId,
      title: "Files",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: DATABASE_ID,
      ownerEmail: OWNER,
      documentId: DATABASE_DOCUMENT_ID,
      title: "Local edits",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.documentPropertyDefinitions).values({
    id: AUTHOR_PROPERTY_ID,
    ownerEmail: OWNER,
    databaseId: DATABASE_ID,
    name: "Author",
    type: "text",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: SOURCE_ID,
    ownerEmail: OWNER,
    databaseId: DATABASE_ID,
    sourceType: "builder-cms",
    sourceName: MODEL,
    sourceTable: MODEL,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: "field_local_edits_author",
    ownerEmail: OWNER,
    sourceId: SOURCE_ID,
    propertyId: AUTHOR_PROPERTY_ID,
    localFieldKey: AUTHOR_PROPERTY_ID,
    sourceFieldKey: "data.author",
    sourceFieldLabel: "Author",
    sourceFieldType: "text",
    mappingType: "property",
    writeOwner: "source",
    createdAt: now,
    updatedAt: now,
  });
  builder.entries.set("entry-a", {
    title: "Entry A",
    author: "Ada",
    updatedAt: now,
  });
  builder.entries.set("entry-b", {
    title: "Entry B",
    author: "Bea",
    updatedAt: now,
  });
  builder.entries.set("entry-c", {
    title: "Entry C",
    author: "Cy",
    updatedAt: now,
  });
  await refresh();
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

it("keeps a value edited in Content through a refresh and takes Builder's for the rest", async () => {
  expect(await localAuthor("entry-a")).toBe("Ada");
  expect(await localAuthor("entry-b")).toBe("Bea");

  await editAuthor("entry-a", "Ada Lovelace");
  editInBuilder("entry-b", { author: "Bea Arthur" });
  await refresh();

  expect(await localAuthor("entry-a")).toBe("Ada Lovelace");
  expect(await localAuthor("entry-b")).toBe("Bea Arthur");
  expect(await pendingEdit("entry-a")).toMatchObject({
    conflictState: "none",
    fieldChanges: [
      expect.objectContaining({
        sourceFieldKey: "data.author",
        currentValue: "Ada",
        proposedValue: "Ada Lovelace",
      }),
    ],
  });
  expect(await pendingEdit("entry-b")).toBeNull();
  expect(await editConflicts("entry-a")).toBe("none");
});

it("flags an edit Builder changed too until the edit matches Builder", async () => {
  editInBuilder("entry-a", { author: "Ada King" });
  await refresh();

  expect(await localAuthor("entry-a")).toBe("Ada Lovelace");
  expect(await pendingEdit("entry-a")).toMatchObject({
    conflictState: "source_changed",
    fieldChanges: [
      expect.objectContaining({
        sourceFieldKey: "data.author",
        currentValue: "Ada King",
        proposedValue: "Ada Lovelace",
      }),
    ],
  });
  expect(await editConflicts("entry-a")).toEqual(["data.author"]);

  // Nothing changed since, but the edit still overwrites Builder's change.
  await refresh();
  expect(await pendingEdit("entry-a")).toMatchObject({
    conflictState: "source_changed",
  });

  await editAuthor("entry-a", "Ada King");
  await refresh();
  expect(await pendingEdit("entry-a")).toBeNull();
  expect(await editConflicts("entry-a")).toBe("none");
});

it("keeps an edit saved while the refresh was reading Builder", async () => {
  editInBuilder("entry-b", { author: "Bea Smith" });
  membershipLock.beforeNextLock = () => editAuthor("entry-b", "Beatrice");
  await refresh();

  expect(await localAuthor("entry-b")).toBe("Beatrice");
  expect(await pendingEdit("entry-b")).toMatchObject({
    conflictState: "source_changed",
    fieldChanges: [
      expect.objectContaining({
        currentValue: "Bea Smith",
        proposedValue: "Beatrice",
      }),
    ],
  });
});

it("takes Builder's title for an unedited page and flags an edited one Builder retitled", async () => {
  editInBuilder("entry-c", { title: "Entry C, revised" });
  await refresh();
  expect(await localTitle("entry-c")).toBe("Entry C, revised");
  expect(await pendingEdit("entry-c")).toBeNull();

  await editTitle("entry-c", "Entry C, mine");
  editInBuilder("entry-c", { title: "Entry C, theirs" });
  await refresh();
  expect(await localTitle("entry-c")).toBe("Entry C, mine");
  expect(await pendingEdit("entry-c")).toMatchObject({
    conflictState: "source_changed",
    fieldChanges: [
      expect.objectContaining({
        sourceFieldKey: "data.title",
        currentValue: "Entry C, theirs",
        proposedValue: "Entry C, mine",
      }),
    ],
  });
  expect(await editConflicts("entry-c")).toEqual([
    records.BUILDER_CMS_TITLE_CONFLICT_KEY,
  ]);

  await editTitle("entry-c", "Entry C, theirs");
  await refresh();
  expect(await pendingEdit("entry-c")).toBeNull();
  expect(await editConflicts("entry-c")).toBe("none");
});

it("takes Builder's body for an unedited page and flags an edited one Builder changed", async () => {
  await hydrateBody("entry-c", "Body C");
  expect(await localBody("entry-c")).toBe("Body C");
  await hydrateBody("entry-c", "Body C, revised");
  expect(await localBody("entry-c")).toBe("Body C, revised");
  expect(await pendingEdit("entry-c")).toBeNull();

  await hydrateBody("entry-a", "Body A");
  await editBody("entry-a", "Body A, mine");
  await hydrateBody("entry-a", "Body A, theirs");
  expect(await localBody("entry-a")).toBe("Body A, mine");
  expect(await editConflicts("entry-a")).toEqual([
    BUILDER_CMS_BODY_CONTENT_KEY,
  ]);
  expect(await pendingEdit("entry-a")).toMatchObject({
    conflictState: "source_changed",
    bodyChange: expect.anything(),
  });

  // A refresh keeps the body's flag; only a body read settles it.
  await refresh();
  expect(await editConflicts("entry-a")).toEqual([
    BUILDER_CMS_BODY_CONTENT_KEY,
  ]);

  await editBody("entry-a", "Body A, theirs");
  await hydrateBody("entry-a", "Body A, theirs");
  expect(await pendingEdit("entry-a")).toBeNull();
  expect(await editConflicts("entry-a")).toBe("none");
});

it("moves an unedited property to the value a body read brings and flags an edited one", async () => {
  editInBuilder("entry-c", { author: "Cy Young" });
  await hydrateBody("entry-c", "Body C, revised");
  expect(await localAuthor("entry-c")).toBe("Cy Young");
  // The next refresh doesn't take the old value for Content's edit.
  await refresh();
  expect(await localAuthor("entry-c")).toBe("Cy Young");
  expect(await pendingEdit("entry-c")).toBeNull();

  await editAuthor("entry-a", "Ada, Countess");
  editInBuilder("entry-a", { author: "Ada Byron" });
  await hydrateBody("entry-a", "Body A, theirs");
  expect(await localAuthor("entry-a")).toBe("Ada, Countess");
  expect(await editConflicts("entry-a")).toEqual(["data.author"]);
});

it("moves an unedited title to the one a body read brings and flags an edited one", async () => {
  for (const id of ["entry-title-kept", "entry-title-mine"]) {
    builder.entries.set(id, { title: id, author: "Tess", updatedAt: tick() });
  }
  await refresh();

  editInBuilder("entry-title-kept", { title: "Retitled in Builder" });
  await hydrateBody("entry-title-kept", "Body");
  expect(await localTitle("entry-title-kept")).toBe("Retitled in Builder");
  // The next refresh doesn't take the old title for Content's edit.
  await refresh();
  expect(await localTitle("entry-title-kept")).toBe("Retitled in Builder");
  expect(await pendingEdit("entry-title-kept")).toBeNull();

  await editTitle("entry-title-mine", "Mine");
  editInBuilder("entry-title-mine", { title: "Theirs" });
  await hydrateBody("entry-title-mine", "Body");
  expect(await localTitle("entry-title-mine")).toBe("Mine");
  expect(await editConflicts("entry-title-mine")).toEqual([
    records.BUILDER_CMS_TITLE_CONFLICT_KEY,
  ]);
  await refresh();
  expect(await pendingEdit("entry-title-mine")).toMatchObject({
    conflictState: "source_changed",
    fieldChanges: [
      expect.objectContaining({
        sourceFieldKey: "data.title",
        currentValue: "Theirs",
        proposedValue: "Mine",
      }),
    ],
  });
});

it.each(["blocks", "blocksString"] as const)(
  "flags a body the page keeps when Builder reports an empty %s",
  async (shape) => {
    const id = `entry-empty-${shape}`;
    builder.entries.set(id, { title: id, author: "Dee", updatedAt: tick() });
    await refresh();
    // Content never read a body for this entry, so it can't tell an empty
    // Builder body from one Builder deleted.
    await editBody(id, "Body D");
    builder.emptiedBodies.set(id, shape);
    await hydrateBody(id, null);

    expect(await localBody(id)).toContain("Body D");
    expect(await editConflicts(id)).toEqual([BUILDER_CMS_BODY_CONTENT_KEY]);
    expect(await pendingEdit(id)).toMatchObject({
      conflictState: "source_changed",
      bodyChange: expect.anything(),
    });
  },
);

it("moves unedited properties to the values a bulk body read brings and flags an edited one", async () => {
  const ids = Array.from({ length: 20 }, (_, index) => `entry-bulk-${index}`);
  for (const id of ids) {
    builder.entries.set(id, { title: id, author: "Old", updatedAt: tick() });
  }
  await refresh();
  await editAuthor("entry-bulk-1", "Mine");
  for (const id of ids) editInBuilder(id, { author: "New" });
  // Without an update time the read can't show it is the version the
  // refresh saw, so nothing but the values says what changed.
  builder.bodyReadOmitsUpdateTime = true;
  try {
    await utils.processBuilderBodyHydrationQueue({
      sourceId: SOURCE_ID,
      limit: 50,
      preloadBodies: true,
    });
  } finally {
    builder.bodyReadOmitsUpdateTime = false;
  }

  expect(await localBody("entry-bulk-0")).toContain("Body entry-bulk-0");
  expect(await localAuthor("entry-bulk-0")).toBe("New");
  expect(await localAuthor("entry-bulk-1")).toBe("Mine");
  expect(await editConflicts("entry-bulk-1")).toEqual(["data.author"]);
});

it("keeps the title's conflict apart from a property mapped to Builder's title", async () => {
  const db = getDb();
  const now = tick();
  const titlePropertyId = "prop_local_edits_title";
  const titleFieldId = "field_local_edits_title";
  // A property named "Title" maps to Builder's `data.title`, as the page
  // title does.
  await db.insert(schema.documentPropertyDefinitions).values({
    id: titlePropertyId,
    ownerEmail: OWNER,
    databaseId: DATABASE_ID,
    name: "Title",
    type: "text",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: titleFieldId,
    ownerEmail: OWNER,
    sourceId: SOURCE_ID,
    propertyId: titlePropertyId,
    localFieldKey: titlePropertyId,
    sourceFieldKey: "data.title",
    sourceFieldLabel: "Title",
    sourceFieldType: "text",
    mappingType: "property",
    writeOwner: "source",
    createdAt: now,
    updatedAt: now,
  });
  try {
    for (const id of ["entry-shared-page", "entry-shared-property"]) {
      builder.entries.set(id, { title: id, author: "Sam", updatedAt: tick() });
    }
    await refresh();

    await editTitle("entry-shared-page", "Page title, mine");
    editInBuilder("entry-shared-page", { title: "Page title, theirs" });
    await refresh();
    expect(await localTitle("entry-shared-page")).toBe("Page title, mine");
    expect(await editConflicts("entry-shared-page")).toEqual([
      records.BUILDER_CMS_TITLE_CONFLICT_KEY,
    ]);
    expect(await pendingEdit("entry-shared-page")).toMatchObject({
      conflictState: "source_changed",
    });

    await getDb()
      .update(schema.documentPropertyValues)
      .set({
        valueJson: JSON.stringify("Property title, mine"),
        updatedAt: tick(),
      })
      .where(
        and(
          eq(
            schema.documentPropertyValues.documentId,
            await documentIdFor("entry-shared-property"),
          ),
          eq(schema.documentPropertyValues.propertyId, titlePropertyId),
        ),
      );
    editInBuilder("entry-shared-property", { title: "Property title, theirs" });
    await refresh();
    expect(await localTitle("entry-shared-property")).toBe(
      "Property title, theirs",
    );
    expect(await editConflicts("entry-shared-property")).toEqual([
      "data.title",
    ]);
  } finally {
    await db
      .delete(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.id, titleFieldId));
    await db
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, titlePropertyId));
  }
});

it("locks the membership before the hydration queue row, as enqueue does", async () => {
  const id = "entry-lock-order";
  builder.entries.set(id, { title: id, author: "Lou", updatedAt: tick() });
  await refresh();
  const documentId = await documentIdFor(id);
  // Whether the hydration's transaction already wrote the queue row when it
  // took the membership lock.
  const queueRowWrittenFirst: boolean[] = [];
  membershipLock.onLockExisting = async (tx) => {
    const result = await tx.execute(
      sql`select xmin::text = (txid_current() % 4294967296)::text as written
        from content_database_body_hydration_queue
        where document_id = ${documentId}`,
    );
    for (const row of result.rows ?? result) {
      queueRowWrittenFirst.push(row.written);
    }
  };
  try {
    await hydrateBody(id, "Body L");
    builder.emptiedBodies.set(id, "blocks");
    await hydrateBody(id, null);
  } finally {
    membershipLock.onLockExisting = null;
  }

  expect(queueRowWrittenFirst.length).toBeGreaterThanOrEqual(2);
  expect(queueRowWrittenFirst).not.toContain(true);
});
