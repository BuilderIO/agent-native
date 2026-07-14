// Integration tests for the row-union per-source column field-binding action
// (slice 6c + its Codex review fixes). Boots a real in-memory libsql DB, runs
// the actual migrations, seeds a 2-source row-union, and drives the bind action
// through `run` (with an owner request context so assertAccess passes).

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `bind-source-field-test-${process.pid}-${Date.now()}.sqlite`,
);

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let bindAction: typeof import("./bind-content-database-source-field.js").default;
let addSourceFieldPropertyAction: typeof import("./add-content-database-source-field-property.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  bindAction = (await import("./bind-content-database-source-field.js"))
    .default;
  const addSourceFieldPropertyModule =
    await import("./add-content-database-source-field-property.js");
  addSourceFieldPropertyAction = addSourceFieldPropertyModule.default;
}, 60000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let counter = 0;
async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, fn);
}

/**
 * Seed a row-union database with two Builder sources. Source A has two rows
 * carrying a `data.cat` value (one of which is empty), plus a multi-value
 * `data.labels` field; source B has one row. A text column "Tag" is the bind
 * target. Returns the ids needed to drive and assert against the action.
 */
async function seedRowUnion() {
  const db = getDb();
  const now = new Date().toISOString();
  const suffix = `${++counter}_${Math.random().toString(36).slice(2, 7)}`;
  const databaseId = `db_${suffix}`;
  const databaseDocId = `doc_${databaseId}`;

  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "Row union DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "Row union DB",
    createdAt: now,
    updatedAt: now,
  });

  async function addSource(name: string, createdAt: string) {
    const id = `src_${name}_${suffix}`;
    await db.insert(schema.contentDatabaseSources).values({
      id,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "builder-cms",
      sourceName: name,
      sourceTable: name,
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  }
  // A is the primary (older); B is the secondary.
  const sourceA = await addSource("collection-a", "2026-01-01T00:00:00.000Z");
  const sourceB = await addSource("collection-b", "2026-01-02T00:00:00.000Z");

  async function addRow(
    sourceId: string,
    label: string,
    sourceValues: Record<string, unknown>,
  ) {
    const docId = `doc_${label}_${suffix}`;
    const itemId = `item_${label}_${suffix}`;
    await db.insert(schema.documents).values({
      id: docId,
      ownerEmail: OWNER,
      title: label,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: OWNER,
      databaseId,
      documentId: docId,
      position: counter,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: `row_${label}_${suffix}`,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: itemId,
      documentId: docId,
      sourceRowId: `srid_${label}`,
      sourceQualifiedId: `qid_${label}`,
      sourceDisplayKey: label,
      sourceValuesJson: JSON.stringify(sourceValues),
      createdAt: now,
      updatedAt: now,
    });
    return docId;
  }
  const a1 = await addRow(sourceA, "a1", { "data.cat": "Alpha" });
  const a2 = await addRow(sourceA, "a2", {}); // no cat value (sparse)
  const b1 = await addRow(sourceB, "b1", { "data.cat": "Beta" });

  async function addField(
    sourceId: string,
    sourceFieldKey: string,
    sourceFieldType: string,
  ) {
    const id = `field_${sourceFieldKey}_${sourceId}`;
    await db.insert(schema.contentDatabaseSourceFields).values({
      id,
      ownerEmail: OWNER,
      sourceId,
      propertyId: null,
      localFieldKey: sourceFieldKey,
      sourceFieldKey,
      sourceFieldLabel: sourceFieldKey,
      sourceFieldType,
      mappingType: "property",
      writeOwner: "source",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }
  const fieldACat = await addField(sourceA, "data.cat", "text");
  const fieldAOther = await addField(sourceA, "data.other", "text");
  const fieldALabels = await addField(sourceA, "data.labels", "list");
  const fieldBCat = await addField(sourceB, "data.cat", "text");

  // Target text column "Tag".
  const tagPropertyId = `prop_tag_${suffix}`;
  await db.insert(schema.documentPropertyDefinitions).values({
    id: tagPropertyId,
    ownerEmail: OWNER,
    databaseId,
    name: "Tag",
    type: "text",
    visibility: "always_show",
    optionsJson: "{}",
    position: 0,
    createdAt: now,
    updatedAt: now,
  });

  return {
    databaseId,
    docs: { a1, a2, b1 },
    sourceA,
    sourceB,
    fields: { fieldACat, fieldAOther, fieldALabels, fieldBCat },
    tagPropertyId,
  };
}

async function tagValue(documentId: string, propertyId: string) {
  const db = getDb();
  const [row] = await db
    .select({ valueJson: schema.documentPropertyValues.valueJson })
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(schema.documentPropertyValues.documentId, documentId),
        eq(schema.documentPropertyValues.propertyId, propertyId),
      ),
    );
  return row ? (JSON.parse(row.valueJson) as unknown) : undefined;
}

async function seedStaleBuilderTopicsSnapshot(rowCount = 2) {
  const db = getDb();
  const now = new Date().toISOString();
  const suffix = `${++counter}_${Math.random().toString(36).slice(2, 7)}`;
  const databaseId = `db_stale_topics_${suffix}`;
  const databaseDocId = `doc_${databaseId}`;
  const sourceId = `src_stale_topics_${suffix}`;
  const fieldId = `field_stale_topics_${suffix}`;
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    entryId: `entry_${index + 1}_${suffix}`,
    itemId: `item_${index + 1}_${suffix}`,
    documentId: `doc_${index + 1}_${suffix}`,
    title: `Article ${index + 1}`,
  }));

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "Stale Builder topics DB",
      createdAt: now,
      updatedAt: now,
    },
    ...rows.map((row) => ({
      id: row.documentId,
      ownerEmail: OWNER,
      title: row.title,
      createdAt: now,
      updatedAt: now,
    })),
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "Stale Builder topics DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values(
    rows.map((row, position) => ({
      id: row.itemId,
      ownerEmail: OWNER,
      databaseId,
      documentId: row.documentId,
      position,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "Builder blog",
    sourceTable: "blog-article",
    metadataJson: JSON.stringify({
      builderModelFields: [
        {
          name: "topics",
          label: "Topics",
          type: "list",
          inputType: "tags",
          options: ["Agent Native", "Developer Experience"],
        },
      ],
    }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: fieldId,
    ownerEmail: OWNER,
    sourceId,
    propertyId: null,
    localFieldKey: "data.topics",
    sourceFieldKey: "data.topics",
    sourceFieldLabel: "Topics",
    sourceFieldType: "list",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "Builder model field",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values(
    rows.map((row) => ({
      id: `source_row_${row.entryId}`,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: row.itemId,
      documentId: row.documentId,
      sourceRowId: row.entryId,
      sourceQualifiedId: `builder-cms://blog-article/${row.entryId}`,
      sourceDisplayKey: row.title,
      sourceValuesJson: JSON.stringify({ "data.title": row.title }),
      createdAt: now,
      updatedAt: now,
    })),
  );

  return { databaseId, databaseDocId, sourceId, fieldId, rows, now };
}

describe("bind-content-database-source-field (row-union)", () => {
  it("backfills only the bound source's rows into the column", async () => {
    const f = await seedRowUnion();
    await asOwner(() =>
      bindAction.run({
        databaseId: f.databaseId,
        sourceFieldId: f.fields.fieldACat,
        propertyId: f.tagPropertyId,
      }),
    );
    // Source A's row with a value gets it; source B's row is untouched.
    expect(await tagValue(f.docs.a1, f.tagPropertyId)).toBe("Alpha");
    expect(await tagValue(f.docs.b1, f.tagPropertyId)).toBeUndefined();
  });

  it("clears a stale column value when the newly bound field is empty", async () => {
    const f = await seedRowUnion();
    const db = getDb();
    // Pre-seed a stale value on a2 (whose data.cat is empty).
    await db.insert(schema.documentPropertyValues).values({
      id: `pv_stale_${f.docs.a2}`,
      ownerEmail: OWNER,
      documentId: f.docs.a2,
      propertyId: f.tagPropertyId,
      valueJson: JSON.stringify("STALE"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await asOwner(() =>
      bindAction.run({
        databaseId: f.databaseId,
        sourceFieldId: f.fields.fieldACat,
        propertyId: f.tagPropertyId,
      }),
    );
    // The empty-valued row no longer shows the stale value.
    expect(await tagValue(f.docs.a2, f.tagPropertyId)).toBeUndefined();
    expect(await tagValue(f.docs.a1, f.tagPropertyId)).toBe("Alpha");
  });

  it("rejects rebinding a field already bound to another column", async () => {
    const f = await seedRowUnion();
    const db = getDb();
    const otherProp = `prop_other_${f.databaseId}`;
    await db.insert(schema.documentPropertyDefinitions).values({
      id: otherProp,
      ownerEmail: OWNER,
      databaseId: f.databaseId,
      name: "Other",
      type: "text",
      visibility: "always_show",
      optionsJson: "{}",
      position: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await asOwner(() =>
      bindAction.run({
        databaseId: f.databaseId,
        sourceFieldId: f.fields.fieldACat,
        propertyId: f.tagPropertyId,
      }),
    );
    await expect(
      asOwner(() =>
        bindAction.run({
          databaseId: f.databaseId,
          sourceFieldId: f.fields.fieldACat,
          propertyId: otherProp,
        }),
      ),
    ).rejects.toThrow(/already bound to another column/i);
  });

  it("rejects a second field from the same source on the same column", async () => {
    const f = await seedRowUnion();
    await asOwner(() =>
      bindAction.run({
        databaseId: f.databaseId,
        sourceFieldId: f.fields.fieldACat,
        propertyId: f.tagPropertyId,
      }),
    );
    await expect(
      asOwner(() =>
        bindAction.run({
          databaseId: f.databaseId,
          sourceFieldId: f.fields.fieldAOther,
          propertyId: f.tagPropertyId,
        }),
      ),
    ).rejects.toThrow(/already feeds this column/i);
  });

  it("rejects a multi-value field into a text column", async () => {
    const f = await seedRowUnion();
    await expect(
      asOwner(() =>
        bindAction.run({
          databaseId: f.databaseId,
          sourceFieldId: f.fields.fieldALabels,
          propertyId: f.tagPropertyId,
        }),
      ),
    ).rejects.toThrow(/multi-value/i);
  });

  it("allows two different sources to feed one column, then unbinds", async () => {
    const f = await seedRowUnion();
    await asOwner(() =>
      bindAction.run({
        databaseId: f.databaseId,
        sourceFieldId: f.fields.fieldACat,
        propertyId: f.tagPropertyId,
      }),
    );
    await asOwner(() =>
      bindAction.run({
        databaseId: f.databaseId,
        sourceFieldId: f.fields.fieldBCat,
        propertyId: f.tagPropertyId,
      }),
    );
    // Both sources now feed "Tag": A's a1 and B's b1 both populated.
    expect(await tagValue(f.docs.a1, f.tagPropertyId)).toBe("Alpha");
    expect(await tagValue(f.docs.b1, f.tagPropertyId)).toBe("Beta");

    // Unbind source A's field; its mapping reverts to unmapped.
    await asOwner(() =>
      bindAction.run({
        databaseId: f.databaseId,
        sourceFieldId: f.fields.fieldACat,
        propertyId: null,
      }),
    );
    const db = getDb();
    const [field] = await db
      .select({ propertyId: schema.contentDatabaseSourceFields.propertyId })
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.id, f.fields.fieldACat));
    expect(field.propertyId).toBeNull();
    expect(await tagValue(f.docs.a1, f.tagPropertyId)).toBeUndefined();
    expect(await tagValue(f.docs.b1, f.tagPropertyId)).toBe("Beta");
  });
});

describe("add-content-database-source-field-property Builder refresh", () => {
  it("refreshes a stale Builder snapshot before creating and populating a Topics property", async () => {
    const f = await seedStaleBuilderTopicsSnapshot();
    const readBuilderEntries = vi
      .spyOn(
        await import("./_builder-cms-read-client.js"),
        "readBuilderCmsContentEntries",
      )
      .mockResolvedValue({
        state: "live" as const,
        entries: [
          {
            id: f.rows[0].entryId,
            model: "blog-article",
            title: f.rows[0].title,
            urlPath: "/first-article",
            updatedAt: f.now,
            sourceValues: { "data.topics": ["Agent Native"] },
          },
          {
            id: f.rows[1].entryId,
            model: "blog-article",
            title: f.rows[1].title,
            urlPath: "/second-article",
            updatedAt: f.now,
            sourceValues: { "data.topics": ["Developer Experience"] },
          },
        ],
        fetchedAt: f.now,
        message: null,
        progress: {
          requestedLimit: 500,
          pageSize: 100,
          startOffset: 0,
          nextOffset: 2,
          fetchedEntryCount: 2,
          hasMore: false,
          partial: false,
          readMode: "builder-api" as const,
        },
      });

    const result = await asOwner(() =>
      addSourceFieldPropertyAction.run({
        documentId: f.databaseDocId,
        sourceFieldId: f.fieldId,
      }),
    );

    expect(readBuilderEntries).toHaveBeenCalledOnce();
    expect(readBuilderEntries).toHaveBeenCalledWith({
      model: "blog-article",
      fieldPaths: ["data.topics"],
      limit: 500,
      offset: 0,
    });
    expect(result.itemValues).toEqual([
      {
        itemId: f.rows[0].itemId,
        documentId: f.rows[0].documentId,
        value: ["agent-native"],
      },
      {
        itemId: f.rows[1].itemId,
        documentId: f.rows[1].documentId,
        value: ["developer-experience"],
      },
    ]);

    const db = getDb();
    const sourceRows = await db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, f.sourceId));
    expect(
      sourceRows.map((row) => {
        return JSON.parse(row.sourceValuesJson)["data.topics"];
      }),
    ).toEqual([["Agent Native"], ["Developer Experience"]]);
    const properties = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, f.databaseId));
    const mappedFields = await db
      .select()
      .from(schema.contentDatabaseSourceFields)
      .where(
        and(
          eq(schema.contentDatabaseSourceFields.sourceId, f.sourceId),
          eq(
            schema.contentDatabaseSourceFields.propertyId,
            result.property.definition.id,
          ),
        ),
      );
    const propertyValues = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(
        eq(
          schema.documentPropertyValues.propertyId,
          result.property.definition.id,
        ),
      );
    expect(properties).toHaveLength(1);
    expect(mappedFields).toHaveLength(1);
    expect(propertyValues).toHaveLength(2);
  });

  it("hydrates only the selected field across all 597 stored rows without restarting or pruning", async () => {
    const f = await seedStaleBuilderTopicsSnapshot(597);
    const db = getDb();
    const storedRows = await db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, f.sourceId));
    const rowIndexByEntryId = new Map(
      f.rows.map((row, index) => [row.entryId, index]),
    );
    await Promise.all(
      storedRows.map((row) => {
        const index = rowIndexByEntryId.get(row.sourceRowId);
        if (index === undefined) throw new Error("Unknown seeded source row.");
        return db
          .update(schema.contentDatabaseSourceRows)
          .set({
            sourceValuesJson: JSON.stringify({
              "data.title": f.rows[index].title,
              "data.tags": [`stored-tag-${index + 1}`],
            }),
          })
          .where(eq(schema.contentDatabaseSourceRows.id, row.id));
      }),
    );

    const remoteEntries = f.rows.map((row, index) => ({
      id: row.entryId,
      data: {
        title: `Remote ${row.title}`,
        tags: [`remote-tag-${index + 1}`],
        topics: [index % 2 === 0 ? "Agent Native" : "Developer Experience"],
      },
    }));
    const requests: Array<{ limit: number; offset: number }> = [];
    const previousPublicKey = process.env.BUILDER_PUBLIC_KEY;
    const previousPrivateKey = process.env.BUILDER_PRIVATE_KEY;
    const previousCmsPrivateKey = process.env.BUILDER_CMS_PRIVATE_KEY;
    const previousContentApiHost = process.env.BUILDER_CONTENT_API_HOST;
    process.env.BUILDER_PUBLIC_KEY = "test-public-key";
    delete process.env.BUILDER_PRIVATE_KEY;
    delete process.env.BUILDER_CMS_PRIVATE_KEY;
    process.env.BUILDER_CONTENT_API_HOST = "https://cdn.test.builder.io";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset"));
      requests.push({ limit, offset });
      return new Response(
        JSON.stringify({
          results: remoteEntries.slice(offset, offset + limit),
        }),
        { status: 200 },
      );
    });

    try {
      const result = await asOwner(() =>
        addSourceFieldPropertyAction.run({
          documentId: f.databaseDocId,
          sourceFieldId: f.fieldId,
        }),
      );

      expect(requests).toEqual([
        { limit: 100, offset: 0 },
        { limit: 100, offset: 100 },
        { limit: 100, offset: 200 },
        { limit: 100, offset: 300 },
        { limit: 100, offset: 400 },
        { limit: 97, offset: 500 },
      ]);
      expect(requests.filter((request) => request.offset === 0)).toHaveLength(
        1,
      );
      expect(result.itemValues).toHaveLength(597);

      const sourceRowsAfter = await db
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, f.sourceId));
      expect(sourceRowsAfter).toHaveLength(597);
      const valuesBySourceRowId = new Map(
        sourceRowsAfter.map((row) => [
          row.sourceRowId,
          JSON.parse(row.sourceValuesJson) as Record<string, unknown>,
        ]),
      );
      for (const [index, row] of f.rows.entries()) {
        expect(valuesBySourceRowId.get(row.entryId)).toEqual({
          "data.title": row.title,
          "data.tags": [`stored-tag-${index + 1}`],
          "data.topics": [
            index % 2 === 0 ? "Agent Native" : "Developer Experience",
          ],
        });
      }

      const items = await db
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.databaseId, f.databaseId));
      const propertyValues = await db
        .select()
        .from(schema.documentPropertyValues)
        .where(
          eq(
            schema.documentPropertyValues.propertyId,
            result.property.definition.id,
          ),
        );
      expect(items).toHaveLength(597);
      expect(propertyValues).toHaveLength(597);
    } finally {
      if (previousPublicKey === undefined)
        delete process.env.BUILDER_PUBLIC_KEY;
      else process.env.BUILDER_PUBLIC_KEY = previousPublicKey;
      if (previousPrivateKey === undefined)
        delete process.env.BUILDER_PRIVATE_KEY;
      else process.env.BUILDER_PRIVATE_KEY = previousPrivateKey;
      if (previousCmsPrivateKey === undefined)
        delete process.env.BUILDER_CMS_PRIVATE_KEY;
      else process.env.BUILDER_CMS_PRIVATE_KEY = previousCmsPrivateKey;
      if (previousContentApiHost === undefined)
        delete process.env.BUILDER_CONTENT_API_HOST;
      else process.env.BUILDER_CONTENT_API_HOST = previousContentApiHost;
    }
  });

  it("preserves a concurrent source field update while refreshing Topics", async () => {
    const f = await seedStaleBuilderTopicsSnapshot();
    let notifyBuilderReadStarted: () => void = () => {};
    const builderReadStarted = new Promise<void>((resolve) => {
      notifyBuilderReadStarted = resolve;
    });
    let releaseBuilderRead: () => void = () => {};
    const builderReadReleased = new Promise<void>((resolve) => {
      releaseBuilderRead = resolve;
    });
    vi.spyOn(
      await import("./_builder-cms-read-client.js"),
      "readBuilderCmsContentEntries",
    ).mockImplementation(async () => {
      notifyBuilderReadStarted();
      await builderReadReleased;
      return {
        state: "live" as const,
        entries: [
          {
            id: f.rows[0].entryId,
            model: "blog-article",
            title: f.rows[0].title,
            urlPath: "/first-article",
            updatedAt: f.now,
            sourceValues: { "data.topics": ["Agent Native"] },
          },
          {
            id: f.rows[1].entryId,
            model: "blog-article",
            title: f.rows[1].title,
            urlPath: "/second-article",
            updatedAt: f.now,
            sourceValues: { "data.topics": ["Developer Experience"] },
          },
        ],
        fetchedAt: f.now,
        message: null,
        progress: {
          requestedLimit: 500,
          pageSize: 100,
          startOffset: 0,
          nextOffset: 2,
          fetchedEntryCount: 2,
          hasMore: false,
          partial: false,
          readMode: "builder-api" as const,
        },
      };
    });

    const addPromise = asOwner(() =>
      addSourceFieldPropertyAction.run({
        documentId: f.databaseDocId,
        sourceFieldId: f.fieldId,
      }),
    );
    await builderReadStarted;

    const db = getDb();
    const [rowDuringRead] = await db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(
        eq(schema.contentDatabaseSourceRows.sourceRowId, f.rows[0].entryId),
      );
    await db
      .update(schema.contentDatabaseSourceRows)
      .set({
        sourceValuesJson: JSON.stringify({
          ...JSON.parse(rowDuringRead.sourceValuesJson),
          "data.concurrent": "preserve me",
        }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.contentDatabaseSourceRows.id, rowDuringRead.id));
    releaseBuilderRead();

    const result = await addPromise;
    expect(result.itemValues).toHaveLength(2);
    const rowsAfterAdd = await db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, f.sourceId));
    const valuesBySourceRowId = new Map(
      rowsAfterAdd.map((row) => [
        row.sourceRowId,
        JSON.parse(row.sourceValuesJson) as Record<string, unknown>,
      ]),
    );
    expect(valuesBySourceRowId.get(f.rows[0].entryId)).toMatchObject({
      "data.concurrent": "preserve me",
      "data.topics": ["Agent Native"],
    });
    expect(valuesBySourceRowId.get(f.rows[1].entryId)).toMatchObject({
      "data.topics": ["Developer Experience"],
    });
  });

  it("uses current Builder metadata when it changes during the field refresh", async () => {
    const f = await seedStaleBuilderTopicsSnapshot();
    const db = getDb();
    await db
      .update(schema.contentDatabaseSourceFields)
      .set({ sourceFieldType: "text" })
      .where(eq(schema.contentDatabaseSourceFields.id, f.fieldId));

    let notifyBuilderReadStarted: () => void = () => {};
    const builderReadStarted = new Promise<void>((resolve) => {
      notifyBuilderReadStarted = resolve;
    });
    let releaseBuilderRead: () => void = () => {};
    const builderReadReleased = new Promise<void>((resolve) => {
      releaseBuilderRead = resolve;
    });
    vi.spyOn(
      await import("./_builder-cms-read-client.js"),
      "readBuilderCmsContentEntries",
    ).mockImplementation(async () => {
      notifyBuilderReadStarted();
      await builderReadReleased;
      return {
        state: "live" as const,
        entries: f.rows.map((row) => ({
          id: row.entryId,
          model: "blog-article",
          title: row.title,
          urlPath: `/${row.entryId}`,
          updatedAt: f.now,
          sourceValues: { "data.topics": "Current Choice" },
        })),
        fetchedAt: f.now,
        message: null,
        progress: {
          requestedLimit: 500,
          pageSize: 100,
          startOffset: 0,
          nextOffset: 2,
          fetchedEntryCount: 2,
          hasMore: false,
          partial: false,
          readMode: "builder-api" as const,
        },
      };
    });

    const addPromise = asOwner(() =>
      addSourceFieldPropertyAction.run({
        documentId: f.databaseDocId,
        sourceFieldId: f.fieldId,
      }),
    );
    await builderReadStarted;

    await db
      .update(schema.contentDatabaseSources)
      .set({
        metadataJson: JSON.stringify({
          builderModelFields: [
            {
              name: "topics",
              label: "Topics",
              type: "string",
              inputType: "select",
              options: ["Current Choice", "Second Choice"],
            },
          ],
        }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.contentDatabaseSources.id, f.sourceId));
    releaseBuilderRead();

    const result = await addPromise;
    expect(result.property.definition.type).toBe("select");
    expect(result.property.definition.options.options).toEqual([
      { id: "current-choice", name: "Current Choice", color: "blue" },
      { id: "second-choice", name: "Second Choice", color: "green" },
    ]);
    expect(result.itemValues).toEqual(
      f.rows.map((row) => ({
        itemId: row.itemId,
        documentId: row.documentId,
        value: "current-choice",
      })),
    );

    const [property] = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        eq(
          schema.documentPropertyDefinitions.id,
          result.property.definition.id,
        ),
      );
    expect(property.type).toBe("select");
    expect(JSON.parse(property.optionsJson)).toEqual(
      result.property.definition.options,
    );
  });

  it("leaves every local write untouched when Builder omits a stored row", async () => {
    const f = await seedStaleBuilderTopicsSnapshot();
    vi.spyOn(
      await import("./_builder-cms-read-client.js"),
      "readBuilderCmsContentEntries",
    ).mockResolvedValue({
      state: "live" as const,
      entries: [
        {
          id: f.rows[0].entryId,
          model: "blog-article",
          title: f.rows[0].title,
          urlPath: "/first-article",
          updatedAt: f.now,
          sourceValues: { "data.topics": ["Agent Native"] },
        },
      ],
      fetchedAt: f.now,
      message: null,
      progress: {
        requestedLimit: 500,
        pageSize: 100,
        startOffset: 0,
        nextOffset: 1,
        fetchedEntryCount: 1,
        hasMore: false,
        partial: false,
        readMode: "builder-api" as const,
      },
    });

    await expect(
      asOwner(() =>
        addSourceFieldPropertyAction.run({
          documentId: f.databaseDocId,
          sourceFieldId: f.fieldId,
        }),
      ),
    ).rejects.toThrow(/every stored source row/i);

    const db = getDb();
    const properties = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, f.databaseId));
    const [field] = await db
      .select()
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.id, f.fieldId));
    const [source] = await db
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, f.sourceId));
    const propertyValues = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(
        inArray(
          schema.documentPropertyValues.documentId,
          f.rows.map((row) => row.documentId),
        ),
      );
    const sourceRows = await db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, f.sourceId));
    expect(properties).toHaveLength(0);
    expect(field).toMatchObject({
      propertyId: null,
      localFieldKey: "data.topics",
      updatedAt: f.now,
    });
    expect(source.updatedAt).toBe(f.now);
    expect(propertyValues).toHaveLength(0);
    expect(sourceRows.map((row) => JSON.parse(row.sourceValuesJson))).toEqual(
      f.rows.map((row) => ({ "data.title": row.title })),
    );
    expect(sourceRows.every((row) => row.updatedAt === f.now)).toBe(true);
  });

  it("leaves no property, mapping, values, or snapshot mutation when the Builder read fails", async () => {
    const f = await seedStaleBuilderTopicsSnapshot();
    vi.spyOn(
      await import("./_builder-cms-read-client.js"),
      "readBuilderCmsContentEntries",
    ).mockResolvedValue({
      state: "error",
      entries: [],
      fetchedAt: f.now,
      message: "Builder CMS read failed for test.",
      progress: {
        requestedLimit: 500,
        pageSize: 100,
        startOffset: 0,
        nextOffset: 0,
        fetchedEntryCount: 0,
        hasMore: false,
        partial: false,
        readMode: "builder-api",
      },
    });

    await expect(
      asOwner(() =>
        addSourceFieldPropertyAction.run({
          documentId: f.databaseDocId,
          sourceFieldId: f.fieldId,
        }),
      ),
    ).rejects.toThrow("Builder CMS read failed for test.");

    const db = getDb();
    const properties = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, f.databaseId));
    const [field] = await db
      .select()
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.id, f.fieldId));
    const propertyValues = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(
        inArray(
          schema.documentPropertyValues.documentId,
          f.rows.map((row) => row.documentId),
        ),
      );
    const sourceRows = await db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, f.sourceId));
    expect(properties).toHaveLength(0);
    expect(field.propertyId).toBeNull();
    expect(propertyValues).toHaveLength(0);
    expect(
      sourceRows.every(
        (row) => !("data.topics" in JSON.parse(row.sourceValuesJson)),
      ),
    ).toBe(true);
  });
});

it("creates a property from a source field resolved by stable key when the field id is stale", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const suffix = `${++counter}_${Math.random().toString(36).slice(2, 7)}`;
  const databaseId = `db_stale_add_${suffix}`;
  const databaseDocId = `doc_${databaseId}`;
  const sourceId = `src_stale_add_${suffix}`;
  const fieldId = `field_fresh_${suffix}`;

  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "Stale source field DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "Stale source field DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "Blog",
    sourceTable: "blog",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: fieldId,
    ownerEmail: OWNER,
    sourceId,
    propertyId: null,
    localFieldKey: "data.author",
    sourceFieldKey: "data.author",
    sourceFieldLabel: "Author",
    sourceFieldType: "text",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "Builder model field",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });

  const result = await asOwner(() =>
    addSourceFieldPropertyAction.run({
      documentId: databaseDocId,
      sourceFieldId: `stale_${fieldId}`,
      sourceId,
      sourceFieldKey: "data.author",
    }),
  );

  expect(result.sourceField.id).toBe(fieldId);
  expect(result.sourceField.propertyId).toBe(result.property.definition.id);
  const [field] = await db
    .select()
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.id, fieldId));
  expect(field.propertyId).toBe(result.property.definition.id);
});

it("creates a multi-select property with Builder options for constrained tag fields", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const suffix = `${++counter}_${Math.random().toString(36).slice(2, 7)}`;
  const databaseId = `db_topics_${suffix}`;
  const databaseDocId = `doc_${databaseId}`;
  const sourceId = `src_topics_${suffix}`;
  const fieldId = `field_topics_${suffix}`;
  const itemId = `item_topics_${suffix}`;
  const rowDocumentId = `doc_topics_${suffix}`;

  await db.insert(schema.documents).values([
    {
      id: databaseDocId,
      ownerEmail: OWNER,
      title: "Builder topics DB",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: rowDocumentId,
      ownerEmail: OWNER,
      title: "Building Without the Handoffs",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "Builder topics DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId: rowDocumentId,
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "Builder blog",
    sourceTable: "blog-article",
    metadataJson: JSON.stringify({
      builderModelFields: [
        {
          name: "topics",
          label: 'Topics (new, will override any "Topic")',
          type: "list",
          inputType: "tags",
          required: false,
          options: [
            "Headless CMS",
            "Governance &amp; Security",
            "Developer Experience",
          ],
        },
      ],
    }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: fieldId,
    ownerEmail: OWNER,
    sourceId,
    propertyId: null,
    localFieldKey: "data.topics",
    sourceFieldKey: "data.topics",
    sourceFieldLabel: 'Topics (new, will override any "Topic")',
    sourceFieldType: "list",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "Builder model field",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: `row_topics_${suffix}`,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId: rowDocumentId,
    sourceRowId: "builder-topic-row",
    sourceQualifiedId: "builder-cms://blog-article/builder-topic-row",
    sourceDisplayKey: "Building Without the Handoffs",
    sourceValuesJson: JSON.stringify({
      "data.topics": ["Headless CMS", "Governance &amp; Security"],
    }),
    createdAt: now,
    updatedAt: now,
  });

  const result = await asOwner(() =>
    addSourceFieldPropertyAction.run({
      documentId: databaseDocId,
      sourceFieldId: fieldId,
    }),
  );

  expect(result.property.definition.type).toBe("multi_select");
  expect(
    result.property.definition.options.options?.map((o) => o.name),
  ).toEqual([
    "Headless CMS",
    "Governance &amp; Security",
    "Developer Experience",
  ]);
  expect(result.itemValues).toEqual([
    {
      itemId,
      documentId: rowDocumentId,
      value: ["headless-cms", "governance-amp-security"],
    },
  ]);
  expect(await tagValue(rowDocumentId, result.property.definition.id)).toEqual([
    "headless-cms",
    "governance-amp-security",
  ]);
});

it("keeps unknown list source fields conservative when Builder does not describe choices", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const suffix = `${++counter}_${Math.random().toString(36).slice(2, 7)}`;
  const databaseId = `db_unknown_list_${suffix}`;
  const databaseDocId = `doc_${databaseId}`;
  const sourceId = `src_unknown_list_${suffix}`;
  const fieldId = `field_unknown_list_${suffix}`;

  await db.insert(schema.documents).values({
    id: databaseDocId,
    ownerEmail: OWNER,
    title: "Unknown list DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocId,
    title: "Unknown list DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: "builder-cms",
    sourceName: "Builder blog",
    sourceTable: "blog-article",
    metadataJson: JSON.stringify({
      builderModelFields: [
        {
          name: "relatedLinks",
          type: "list",
          required: false,
        },
      ],
    }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: fieldId,
    ownerEmail: OWNER,
    sourceId,
    propertyId: null,
    localFieldKey: "data.relatedLinks",
    sourceFieldKey: "data.relatedLinks",
    sourceFieldLabel: "Related Links",
    sourceFieldType: "list",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "Builder model field",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });

  const result = await asOwner(() =>
    addSourceFieldPropertyAction.run({
      documentId: databaseDocId,
      sourceFieldId: fieldId,
    }),
  );

  expect(result.property.definition.type).toBe("text");
  expect(result.property.definition.options).toEqual({});
});
