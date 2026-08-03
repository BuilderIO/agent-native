import { runWithRequestContext } from "@agent-native/core/server";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const POSTGRES_URL = process.env.CONTENT_MIGRATION_POSTGRES_URL;
const OWNER = "synthetic-postgres-migration-owner@example.test";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let action: typeof import("./migrate-content-database-rows.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;

beforeAll(async () => {
  if (!POSTGRES_URL) return;
  const databaseName = new URL(POSTGRES_URL).pathname.slice(1).toLowerCase();
  if (!databaseName.includes("test")) {
    throw new Error(
      "CONTENT_MIGRATION_POSTGRES_URL must name an isolated test database.",
    );
  }
  process.env.DATABASE_URL = POSTGRES_URL;
  const database = await import("../server/db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  action = (await import("./migrate-content-database-rows.js")).default;
  setDocumentProperty = (await import("./set-document-property.js")).default;
  configureDocumentProperty = (await import("./configure-document-property.js"))
    .default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60_000);

afterAll(() => {
  delete process.env.DATABASE_URL;
});

async function fixture() {
  const db = getDb();
  const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const stamp = "2026-01-01T00:00:00.000Z";
  const databaseId = `postgres_migration_db_${key}`;
  const databaseDocumentId = `postgres_migration_page_${key}`;
  const documentId = `postgres_migration_row_${key}`;
  const itemId = `postgres_migration_item_${key}`;
  const protectedPropertyId = `status_${key}`;
  const legacyPropertyId = `legacy_${key}`;
  const newPropertyId = `reported_by_${key}`;
  await db.insert(schema.documents).values([
    {
      id: databaseDocumentId,
      ownerEmail: OWNER,
      spaceId: "synthetic_space",
      title: "Synthetic Postgres migration database",
      content: "",
      visibility: "private",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      spaceId: "synthetic_space",
      parentId: databaseDocumentId,
      title: "Synthetic row",
      content: "# Before",
      visibility: "private",
      hideFromSearch: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    spaceId: "synthetic_space",
    documentId: databaseDocumentId,
    title: "Synthetic Postgres migration database",
    createdAt: stamp,
    updatedAt: stamp,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: itemId,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position: 0,
    createdAt: stamp,
    updatedAt: stamp,
  });
  await db.insert(schema.documentPropertyDefinitions).values([
    {
      id: protectedPropertyId,
      ownerEmail: OWNER,
      databaseId,
      name: "Status",
      type: "status",
      visibility: "always_show",
      optionsJson: "{}",
      position: 0,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: legacyPropertyId,
      ownerEmail: OWNER,
      databaseId,
      name: "Legacy",
      type: "text",
      visibility: "always_show",
      optionsJson: "{}",
      position: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  await db.insert(schema.documentPropertyValues).values({
    id: `postgres_migration_status_${key}`,
    ownerEmail: OWNER,
    documentId,
    propertyId: protectedPropertyId,
    valueJson: '"open"',
    createdAt: stamp,
    updatedAt: stamp,
  });
  return {
    databaseId,
    databaseDocumentId,
    documentId,
    newPropertyId,
    protectedPropertyId,
    plan: {
      databaseId,
      databaseDocumentId,
      idempotencyKey: `postgres-key-${key}`,
      expectedRowCount: 1,
      legacyPropertyIds: [legacyPropertyId],
      propertyDefinitions: [
        {
          id: newPropertyId,
          name: "Reported by",
          type: "text",
          visibility: "always_show",
        },
      ],
      rows: [
        {
          itemId,
          documentId,
          expectedUpdatedAt: stamp,
          content: "# Migrated",
          propertyValues: [{ propertyId: newPropertyId, value: "Synthetic" }],
          protectedPropertyValues: [
            { propertyId: protectedPropertyId, valueJson: '"open"' },
          ],
        },
      ],
    },
  };
}

async function cleanupFixture(seed: Awaited<ReturnType<typeof fixture>>) {
  await getDb().transaction(async (tx: any) => {
    await tx
      .delete(schema.contentDatabaseMigrationReceipts)
      .where(
        eq(schema.contentDatabaseMigrationReceipts.databaseId, seed.databaseId),
      );
    await tx
      .delete(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, seed.documentId));
    await tx
      .delete(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.documentId, seed.documentId));
    await tx
      .delete(schema.documentPropertyDefinitions)
      .where(
        eq(schema.documentPropertyDefinitions.databaseId, seed.databaseId),
      );
    await tx
      .delete(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seed.databaseId));
    await tx
      .delete(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, seed.databaseId));
    await tx
      .delete(schema.documents)
      .where(
        inArray(schema.documents.id, [
          seed.documentId,
          seed.databaseDocumentId,
        ]),
      );
  });
}

async function waitForPostgresLockWait(minimum: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result: any = await getDb().execute(
      sql.raw(
        "SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted AND locktype IN ('advisory', 'transactionid')",
      ),
    );
    if (Number(result.rows[0]?.waiting) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Migration did not enter the expected PostgreSQL lock wait.");
}

const postgresSuite = POSTGRES_URL ? describe : describe.skip;

postgresSuite("migrate-content-database-rows PostgreSQL locking", () => {
  it.each(["value", "schema"] as const)(
    "serializes a migration behind a real %s writer transaction",
    async (writer) => {
      const seed = await fixture();
      const gate = 64_057;
      const trigger = `synthetic_migration_gate_${seed.databaseId}`;
      const functionName = `synthetic_migration_gate_fn_${seed.databaseId}`;
      const table =
        writer === "value"
          ? "document_property_values"
          : "document_property_definitions";
      await getDb().execute(
        sql.raw(
          `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${gate}); RETURN NEW; END; $$`,
        ),
      );
      await getDb().execute(
        sql.raw(
          `CREATE TRIGGER ${trigger} BEFORE ${writer === "value" ? "UPDATE" : "INSERT"} ON ${table} FOR EACH ROW WHEN (NEW.owner_email = '${OWNER}') EXECUTE FUNCTION ${functionName}()`,
        ),
      );
      let releaseGate = () => {};
      let gateHolder: Promise<unknown> | undefined;
      try {
        const gateReleased = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        let gateHeld!: () => void;
        const gateAcquired = new Promise<void>((resolve) => {
          gateHeld = resolve;
        });
        gateHolder = getDb().transaction(async (tx: any) => {
          await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${gate})`));
          gateHeld();
          await gateReleased;
        });
        await gateAcquired;
        const concurrentWriter = runWithRequestContext(
          { userEmail: OWNER },
          () =>
            writer === "value"
              ? setDocumentProperty.run({
                  documentId: seed.documentId,
                  databaseId: seed.databaseId,
                  propertyId: seed.protectedPropertyId,
                  value: "closed",
                })
              : configureDocumentProperty.run({
                  documentId: seed.documentId,
                  databaseId: seed.databaseId,
                  name: "Reported by",
                  type: "text",
                  visibility: "always_show",
                }),
        );
        await waitForPostgresLockWait(1);
        const migration = runWithRequestContext({ userEmail: OWNER }, () =>
          action.run({ phase: "apply", plan: seed.plan }),
        );
        await waitForPostgresLockWait(2);
        releaseGate();
        await gateHolder;
        await concurrentWriter;
        await expect(migration).rejects.toThrow(
          writer === "value"
            ? "Protected property values no longer match persisted values"
            : "New property definition collides with an existing definition",
        );
        expect(
          await getDb()
            .select()
            .from(schema.contentDatabaseMigrationReceipts)
            .where(
              eq(
                schema.contentDatabaseMigrationReceipts.databaseId,
                seed.databaseId,
              ),
            ),
        ).toHaveLength(0);
      } finally {
        releaseGate();
        await gateHolder;
        await getDb().execute(
          sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`),
        );
        await getDb().execute(
          sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`),
        );
        await cleanupFixture(seed);
      }
    },
    60_000,
  );
});
