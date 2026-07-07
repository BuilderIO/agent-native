// Integration tests for the row-union per-source column field-binding action
// (slice 6c + its Codex review fixes). Boots a real in-memory libsql DB, runs
// the actual migrations, seeds a 2-source row-union, and drives the bind action
// through `run` (with an owner request context so assertAccess passes).

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  addSourceFieldPropertyAction = (
    await import("./add-content-database-source-field-property.js")
  ).default;
}, 60000);

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
      value: ["Headless CMS", "Governance &amp; Security"],
    },
  ]);
  expect(await tagValue(rowDocumentId, result.property.definition.id)).toEqual([
    "Headless CMS",
    "Governance &amp; Security",
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
