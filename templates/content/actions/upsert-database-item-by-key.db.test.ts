import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// guard:allow-unscoped — isolated SQLite fixtures intentionally inspect rows directly.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-key-upsert-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "owner@example.com";
const OUTSIDER = "outsider@example.com";
const DATABASE_ONLY_EDITOR = "database-only@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let upsert: typeof import("./upsert-database-item-by-key.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let deleteProperty: typeof import("./delete-document-property.js").default;
let deleteDocument: typeof import("./delete-document.js").default;
let permanentlyDeleteDocument: typeof import("./permanently-delete-document.js").default;

const asOwner = <T>(fn: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, fn);

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createDatabase = (await import("./create-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  upsert = (await import("./upsert-database-item-by-key.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  deleteProperty = (await import("./delete-document-property.js")).default;
  deleteDocument = (await import("./delete-document.js")).default;
  permanentlyDeleteDocument = (await import("./permanently-delete-document.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

async function fixture() {
  const created = await asOwner(() =>
    createDatabase.run({ title: "Projection" }),
  );
  const property = await asOwner(() =>
    configureProperty.run({
      documentId: created.database.documentId,
      databaseId: created.database.id,
      name: "External key",
      type: "text",
    }),
  );
  const keyProperty = property.properties.find(
    (candidate) => candidate.definition.name === "External key",
  );
  if (!keyProperty) throw new Error("Fixture key property was not created.");
  return {
    databaseId: created.database.id,
    propertyId: keyProperty.definition.id,
  };
}

describe("upsert-database-item-by-key", () => {
  it("creates, updates, then reports unchanged with the same stable IDs and a one-row bounded readback", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "capability-7",
        title: "First",
        body: "initial",
      }),
    );
    const updated = await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "capability-7",
        title: "Second",
        body: "revised",
      }),
    );
    const unchanged = await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "capability-7",
        title: "Second",
        body: "revised",
      }),
    );
    expect(created.status).toBe("created");
    expect(updated).toMatchObject({
      status: "updated",
      itemId: created.itemId,
      documentId: created.documentId,
    });
    expect(unchanged).toMatchObject({
      status: "unchanged",
      itemId: created.itemId,
      documentId: created.documentId,
    });
    expect(unchanged.readback.items).toHaveLength(1);
    expect(unchanged.readback.items[0]?.id).toBe(created.itemId);
    expect(unchanged.readback.items[0]?.document).toMatchObject({
      id: created.documentId,
      title: "Second",
      content: "",
    });
  });

  it("uses the unique claim for concurrent first writes and preserves inherited privacy", async () => {
    const { databaseId, propertyId } = await fixture();
    const [first, second] = await Promise.all([
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "race-key",
          title: "Race",
        }),
      ),
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "race-key",
          title: "Race",
        }),
      ),
    ]);
    expect(new Set([first.itemId, second.itemId]).size).toBe(1);
    const rows = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    expect(rows).toHaveLength(1);
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, first.documentId));
    expect(document?.visibility).toBe("private");
    await expect(
      getDb().insert(schema.contentDatabaseItemKeyClaims).values({
        id: "conflicting-active-claim",
        ownerEmail: OWNER,
        orgId: null,
        databaseId,
        propertyId,
        keyValueJson: '"another-key"',
        itemId: first.itemId,
        documentId: first.documentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });

  it("advances updatedAt monotonically for an existing-row body projection", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "body-refresh",
        body: "before",
      }),
    );
    const futureUpdatedAt = "2099-01-01T00:00:00.000Z";
    await getDb()
      .update(schema.documents)
      .set({ updatedAt: futureUpdatedAt })
      .where(eq(schema.documents.id, created.documentId));

    await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "body-refresh",
        body: "after",
      }),
    );

    const [document] = await getDb()
      .select({
        content: schema.documents.content,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, created.documentId));
    expect(document?.content).toBe("after");
    expect(document?.updatedAt > futureUpdatedAt).toBe(true);
  });

  it("serializes concurrent writes when an existing row is missing a requested property", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "concurrent-update",
      }),
    );
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    const configured = await asOwner(() =>
      configureProperty.run({
        documentId: database.documentId,
        databaseId,
        name: "Concurrent value",
        type: "text",
      }),
    );
    const requestedProperty = configured.properties.find(
      (property) => property.definition.name === "Concurrent value",
    );
    if (!requestedProperty)
      throw new Error("Concurrent fixture property was not created.");

    await Promise.all([
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "concurrent-update",
          propertyValues: {
            [requestedProperty.definition.id]: "same-value",
          },
        }),
      ),
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "concurrent-update",
          propertyValues: {
            [requestedProperty.definition.id]: "same-value",
          },
        }),
      ),
    ]);

    const stored = await getDb()
      .select()
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, created.documentId),
          eq(
            schema.documentPropertyValues.propertyId,
            requestedProperty.definition.id,
          ),
        ),
      );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.valueJson).toBe('"same-value"');
  });

  it("recollects rows created at the database-lock boundary before trashing", async () => {
    const { databaseId, propertyId } = await fixture();
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    const suffix = databaseId.replace(/[^a-zA-Z0-9_]/g, "_");
    const triggerName = `late_upsert_${suffix}`;
    const documentId = `late_doc_${suffix}`;
    const itemId = `late_item_${suffix}`;
    const now = new Date().toISOString();
    await getDbExec().execute(
      `CREATE TRIGGER ${triggerName}
       BEFORE UPDATE ON content_databases
       WHEN NEW.id = '${databaseId}'
         AND NOT EXISTS (SELECT 1 FROM documents WHERE id = '${documentId}')
       BEGIN
         INSERT INTO documents
           (id, owner_email, parent_id, title, content, position, created_at, updated_at)
         VALUES
           ('${documentId}', '${OWNER}', '${database.documentId}', 'Late row', '', 0, '${now}', '${now}');
         INSERT INTO content_database_items
           (id, owner_email, database_id, document_id, position, created_at, updated_at)
         VALUES
           ('${itemId}', '${OWNER}', '${databaseId}', '${documentId}', 0, '${now}', '${now}');
         INSERT INTO document_property_values
           (id, owner_email, document_id, property_id, value_json, created_at, updated_at)
         VALUES
           ('late_value_${suffix}', '${OWNER}', '${documentId}', '${propertyId}', '"late-key"', '${now}', '${now}');
       END`,
    );
    try {
      await asOwner(() => deleteDocument.run({ id: database.documentId }));
    } finally {
      await getDbExec().execute(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    const [lateDocument] = await getDb()
      .select({
        trashedAt: schema.documents.trashedAt,
        trashRootId: schema.documents.trashRootId,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(lateDocument?.trashedAt).toBeTruthy();
    expect(lateDocument?.trashRootId).toBe(database.documentId);
  });

  it("fails closed when a key definition is deleted at the database-lock boundary", async () => {
    const { databaseId, propertyId } = await fixture();
    const suffix = databaseId.replace(/[^a-zA-Z0-9_]/g, "_");
    const triggerName = `delete_key_definition_${suffix}`;
    await getDbExec().execute(
      `CREATE TRIGGER ${triggerName}
       BEFORE UPDATE ON content_databases
       WHEN NEW.id = '${databaseId}'
         AND EXISTS (
           SELECT 1 FROM document_property_definitions WHERE id = '${propertyId}'
         )
       BEGIN
         DELETE FROM document_property_definitions WHERE id = '${propertyId}';
       END`,
    );
    try {
      await expect(
        asOwner(() =>
          upsert.run({
            databaseId,
            keyPropertyId: propertyId,
            keyValue: "deleted-during-upsert",
          }),
        ),
      ).rejects.toThrow("changed or was deleted");
    } finally {
      await getDbExec().execute(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    const claims = await getDb()
      .select()
      .from(schema.contentDatabaseItemKeyClaims)
      .where(eq(schema.contentDatabaseItemKeyClaims.databaseId, databaseId));
    const items = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    expect(claims).toHaveLength(0);
    expect(items).toHaveLength(0);
  });

  it("verifies every requested property by canonical serialized readback, including arrays and objects", async () => {
    const { databaseId, propertyId } = await fixture();
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    const multi = await asOwner(() =>
      configureProperty.run({
        documentId: database.documentId,
        databaseId,
        name: "Labels",
        type: "multi_select",
        options: {
          options: [
            { id: "alpha", name: "Alpha", color: "blue" },
            { id: "beta", name: "Beta", color: "green" },
          ],
        },
      }),
    );
    const date = await asOwner(() =>
      configureProperty.run({
        documentId: database.documentId,
        databaseId,
        name: "Window",
        type: "date",
      }),
    );
    const multiProperty = multi.properties.find(
      (property) => property.definition.name === "Labels",
    );
    const dateProperty = date.properties.find(
      (property) => property.definition.name === "Window",
    );
    if (!multiProperty || !dateProperty)
      throw new Error("Fixture properties were not created.");

    const result = await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "rich-readback",
        title: "Typed values",
        body: "verified body",
        propertyValues: {
          [multiProperty.definition.id]: ["alpha", "beta"],
          [dateProperty.definition.id]: {
            start: "2026-08-02",
            end: "2026-08-03",
            includeTime: false,
          },
        },
      }),
    );
    const values = new Map(
      result.readback.items[0]?.properties.map((property) => [
        property.definition.id,
        property.value,
      ]),
    );
    expect(values.get(propertyId)).toBe("rich-readback");
    expect(values.get(multiProperty.definition.id)).toEqual(["alpha", "beta"]);
    expect(values.get(dateProperty.definition.id)).toEqual({
      start: "2026-08-02",
      end: "2026-08-03",
      includeTime: false,
    });
  });

  it("denies access and fails closed for wrong-database or computed key properties", async () => {
    const { databaseId, propertyId } = await fixture();
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "nope" }),
      ),
    ).rejects.toThrow();
    await expect(
      asOwner(() =>
        upsert.run({ databaseId, keyPropertyId: "missing", keyValue: "nope" }),
      ),
    ).rejects.toThrow("does not belong");
    const [definition] = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.id, propertyId),
          eq(schema.documentPropertyDefinitions.databaseId, databaseId),
        ),
      );
    await getDb()
      .update(schema.documentPropertyDefinitions)
      .set({ type: "formula" })
      .where(eq(schema.documentPropertyDefinitions.id, definition.id));
    await expect(
      asOwner(() =>
        upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "nope" }),
      ),
    ).rejects.toThrow("cannot be used");
  });

  it("rejects system database memberships", async () => {
    const { databaseId, propertyId } = await fixture();
    await getDb()
      .update(schema.contentDatabases)
      .set({ systemRole: "test-system-database" })
      .where(eq(schema.contentDatabases.id, databaseId));
    await expect(
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "not-a-system-membership",
        }),
      ),
    ).rejects.toThrow("ordinary Content databases");
  });

  it("rejects a source-managed property as the stable key", async () => {
    const { databaseId, propertyId } = await fixture();
    const now = new Date().toISOString();
    await getDb().insert(schema.contentDatabaseSources).values({
      id: "source-managed-key-source",
      ownerEmail: OWNER,
      databaseId,
      sourceType: "test",
      sourceName: "Test source",
      sourceTable: "test_rows",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabaseSourceFields).values({
      id: "source-managed-key-field",
      ownerEmail: OWNER,
      sourceId: "source-managed-key-source",
      propertyId,
      localFieldKey: propertyId,
      sourceFieldKey: "external_id",
      sourceFieldLabel: "External ID",
      sourceFieldType: "text",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "source-owned",
        }),
      ),
    ).rejects.toThrow("cannot be used as a stable key");
    const claims = await getDb()
      .select()
      .from(schema.contentDatabaseItemKeyClaims)
      .where(eq(schema.contentDatabaseItemKeyClaims.databaseId, databaseId));
    expect(claims).toHaveLength(0);
  });

  it("rejects a source-managed non-key property in propertyValues", async () => {
    const { databaseId, propertyId } = await fixture();
    const now = new Date().toISOString();
    const managedPropertyId = "source-managed-payload-property";
    await getDb().insert(schema.documentPropertyDefinitions).values({
      id: managedPropertyId,
      ownerEmail: OWNER,
      databaseId,
      name: "Source Status",
      type: "text",
      visibility: "always_show",
      optionsJson: "{}",
      position: 1,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabaseSources).values({
      id: "source-managed-payload-source",
      ownerEmail: OWNER,
      databaseId,
      sourceType: "test",
      sourceName: "Payload source",
      sourceTable: "test_rows",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabaseSourceFields).values({
      id: "source-managed-payload-field",
      ownerEmail: OWNER,
      sourceId: "source-managed-payload-source",
      propertyId: managedPropertyId,
      localFieldKey: managedPropertyId,
      sourceFieldKey: "status",
      sourceFieldLabel: "Status",
      sourceFieldType: "text",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "payload-source-owned",
          propertyValues: { [managedPropertyId]: "caller overwrite" },
        }),
      ),
    ).rejects.toThrow(/source-managed and cannot be written/i);
    const memberships = await getDb()
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    expect(memberships).toEqual([]);
  });

  it("does not mutate an existing row when the caller can edit only the database page", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "private-row",
        title: "Original",
      }),
    );
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    await getDb().insert(schema.documentShares).values({
      id: "database-only-editor-share",
      resourceId: database.documentId,
      principalType: "user",
      principalId: DATABASE_ONLY_EDITOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
    await expect(
      runWithRequestContext({ userEmail: DATABASE_ONLY_EDITOR }, () =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "private-row",
          title: "Mutated",
        }),
      ),
    ).rejects.toThrow();
    const [document] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, created.documentId));
    expect(document?.title).toBe("Original");
  });

  it("fails closed when a stable-key claim no longer names its exact database membership", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({
        databaseId,
        keyPropertyId: propertyId,
        keyValue: "stale-claim",
        title: "Original",
      }),
    );
    await getDb()
      .update(schema.contentDatabaseItemKeyClaims)
      .set({ itemId: "missing-item" })
      .where(
        and(
          eq(schema.contentDatabaseItemKeyClaims.databaseId, databaseId),
          eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
        ),
      );
    await getDb()
      .delete(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, created.documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      );
    await expect(
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "stale-claim",
          title: "Would mutate if claim were trusted",
        }),
      ),
    ).rejects.toThrow("no longer matches the stored key property");
    const [document] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, created.documentId));
    expect(document?.title).toBe("Original");
  });

  it("atomically retires A when an ordinary property edit changes it to B", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "A" }),
    );
    await asOwner(() =>
      setProperty.run({
        documentId: created.documentId,
        databaseId,
        propertyId,
        value: "B",
      }),
    );
    const replacement = await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "A" }),
    );
    expect(replacement.status).toBe("created");
    expect(replacement.documentId).not.toBe(created.documentId);
    const b = await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "B" }),
    );
    expect(b.documentId).toBe(created.documentId);
  });

  it("serializes a real concurrent ordinary write with stable-key upsert", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "A" }),
    );

    await Promise.allSettled([
      asOwner(() =>
        upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "A" }),
      ),
      asOwner(() =>
        setProperty.run({
          documentId: created.documentId,
          databaseId,
          propertyId,
          value: "B",
        }),
      ),
    ]);

    const aValues = await getDb()
      .select({ documentId: schema.documentPropertyValues.documentId })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.propertyId, propertyId),
          eq(schema.documentPropertyValues.valueJson, '"A"'),
        ),
      );
    const aClaims = await getDb()
      .select({ documentId: schema.contentDatabaseItemKeyClaims.documentId })
      .from(schema.contentDatabaseItemKeyClaims)
      .where(
        and(
          eq(schema.contentDatabaseItemKeyClaims.databaseId, databaseId),
          eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
          eq(schema.contentDatabaseItemKeyClaims.keyValueJson, '"A"'),
        ),
      );
    expect(aValues.length).toBeLessThanOrEqual(1);
    expect(aClaims).toEqual(aValues);
  });

  it("rejects an ordinary edit that collides with another claimed key", async () => {
    const { databaseId, propertyId } = await fixture();
    const a = await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "A" }),
    );
    await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "B" }),
    );

    await expect(
      asOwner(() =>
        setProperty.run({
          documentId: a.documentId,
          databaseId,
          propertyId,
          value: "B",
        }),
      ),
    ).rejects.toThrow(/already claimed as another row's stable key/i);

    const values = await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, a.documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      );
    expect(values).toEqual([{ valueJson: '"A"' }]);
  });

  it("serializes a real concurrent type change and retires old-type claims", async () => {
    const { databaseId, propertyId } = await fixture();
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));

    const [upsertResult, configureResult] = await Promise.allSettled([
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "not-a-number",
        }),
      ),
      asOwner(() =>
        configureProperty.run({
          id: propertyId,
          documentId: database.documentId,
          databaseId,
          name: "External key",
          type: "number",
        }),
      ),
    ]);
    expect(configureResult.status).toBe("fulfilled");
    expect(["fulfilled", "rejected"]).toContain(upsertResult.status);

    const [definition] = await getDb()
      .select({ type: schema.documentPropertyDefinitions.type })
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyId));
    const claims = await getDb()
      .select()
      .from(schema.contentDatabaseItemKeyClaims)
      .where(eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId));
    const values = await getDb()
      .select()
      .from(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.propertyId, propertyId));
    expect(definition?.type).toBe("number");
    expect(claims).toHaveLength(0);
    expect(values).toHaveLength(0);
  });

  it("removes stable-key claims in the same property-definition deletion", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "gone" }),
    );
    await asOwner(() =>
      deleteProperty.run({
        documentId: created.documentId,
        databaseId,
        propertyId,
      }),
    );
    const claims = await getDb()
      .select()
      .from(schema.contentDatabaseItemKeyClaims)
      .where(eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId));
    expect(claims).toHaveLength(0);
  });

  it("releases claims during permanent database-row cleanup so the key can be reused", async () => {
    const { databaseId, propertyId } = await fixture();
    const created = await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "reuse" }),
    );
    await asOwner(() => deleteDocument.run({ id: created.documentId }));
    await expect(
      asOwner(() =>
        upsert.run({
          databaseId,
          keyPropertyId: propertyId,
          keyValue: "reuse",
        }),
      ),
    ).rejects.toThrow("trashed database row");
    await asOwner(() =>
      permanentlyDeleteDocument.run({ id: created.documentId }),
    );
    const reused = await asOwner(() =>
      upsert.run({ databaseId, keyPropertyId: propertyId, keyValue: "reuse" }),
    );
    expect(reused.status).toBe("created");
    expect(reused.documentId).not.toBe(created.documentId);
  });
});
