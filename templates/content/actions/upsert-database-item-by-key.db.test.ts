import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-key-upsert-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "owner@example.com";
const OUTSIDER = "outsider@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let upsert: typeof import("./upsert-database-item-by-key.js").default;

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
    ).rejects.toThrow("does not resolve to a row in this database");
    const [document] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, created.documentId));
    expect(document?.title).toBe("Original");
  });
});
