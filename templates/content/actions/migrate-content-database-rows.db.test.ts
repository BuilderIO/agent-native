import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-row-migration-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "synthetic-migration-owner@example.test";
const OUTSIDER = "synthetic-migration-outsider@example.test";
let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let action: typeof import("./migrate-content-database-rows.js").default;
let lockContentDatabaseMutation: typeof import("./_content-database-mutation-lock.js").lockContentDatabaseMutation;
let touchContentDatabase: typeof import("./_content-database-mutation-lock.js").touchContentDatabase;
let serializeMigrationValue: typeof import("./_content-database-row-migration.js").serializeMigrationValue;
const now = () => new Date().toISOString();

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const database = await import("../server/db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  serializeMigrationValue = (
    await import("./_content-database-row-migration.js")
  ).serializeMigrationValue;
  action = (await import("./migrate-content-database-rows.js")).default;
  ({ lockContentDatabaseMutation, touchContentDatabase } =
    await import("./_content-database-mutation-lock.js"));
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  for (const suffix of ["", "-wal", "-shm"])
    expect(existsSync(`${TEST_DB_PATH}${suffix}`)).toBe(false);
});

async function fixture(rowCount = 20) {
  const db = getDb();
  const stamp = now();
  const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const databaseId = `synthetic_migration_db_${key}`;
  const databaseDocumentId = `synthetic_migration_page_${key}`;
  await db.insert(schema.documents).values({
    id: databaseDocumentId,
    ownerEmail: OWNER,
    spaceId: "synthetic_space",
    title: "Synthetic migration database",
    content: "",
    visibility: "private",
    createdAt: stamp,
    updatedAt: stamp,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    spaceId: "synthetic_space",
    documentId: databaseDocumentId,
    title: "Synthetic migration database",
    createdAt: stamp,
    updatedAt: stamp,
  });
  const definitions = [
    { id: `status_${key}`, name: "Status", type: "status", systemRole: null },
    { id: `cluster_${key}`, name: "Cluster", type: "text", systemRole: null },
    { id: `evidence_${key}`, name: "Evidence", type: "url", systemRole: null },
  ];
  await db.insert(schema.documentPropertyDefinitions).values(
    definitions.map((definition, position) => ({
      ...definition,
      ownerEmail: OWNER,
      databaseId,
      visibility: "always_show",
      optionsJson: "{}",
      position,
      createdAt: stamp,
      updatedAt: stamp,
    })),
  );
  const rows = [] as any[];
  for (let index = 0; index < rowCount; index += 1) {
    const documentId = `synthetic_row_doc_${key}_${index}`;
    const itemId = `synthetic_row_item_${key}_${index}`;
    const updatedAt = `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`;
    const status = ["open", "in_progress", "closed"][index % 3];
    await db.insert(schema.documents).values({
      id: documentId,
      ownerEmail: OWNER,
      spaceId: "synthetic_space",
      parentId: databaseDocumentId,
      title: `Synthetic ${index}`,
      content: `# Synthetic heading ${index % 5}`,
      visibility: "private",
      hideFromSearch: 1,
      position: index,
      createdAt: stamp,
      updatedAt,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: OWNER,
      databaseId,
      documentId,
      position: index,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await db.insert(schema.documentPropertyValues).values([
      {
        id: `synthetic_status_${key}_${index}`,
        ownerEmail: OWNER,
        documentId,
        propertyId: definitions[0].id,
        valueJson: JSON.stringify(status),
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: `synthetic_cluster_${key}_${index}`,
        ownerEmail: OWNER,
        documentId,
        propertyId: definitions[1].id,
        valueJson: '"blue"',
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: `synthetic_evidence_${key}_${index}`,
        ownerEmail: OWNER,
        documentId,
        propertyId: definitions[2].id,
        valueJson: `"https://synthetic.example.test/evidence/${index}"`,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ]);
    rows.push({
      itemId,
      documentId,
      expectedUpdatedAt: updatedAt,
      content: `# User need\nSynthetic need ${index}\n\n# Slack context\nSynthetic context ${index}\n\n# Assessment\nSynthetic assessment ${index}\n\n# Implementation evidence\nSynthetic evidence ${index}\n\n# Remaining gap\nSynthetic gap ${index}`,
      propertyValues: [
        {
          propertyId: `reported_by_${key}`,
          value: `Synthetic person ${index}`,
        },
        {
          propertyId: `slack_thread_${key}`,
          value: `https://synthetic.example.test/slack/${index}`,
        },
        {
          propertyId: `reported_date_${key}`,
          value: { start: "2026-01-01" },
        },
        {
          propertyId: `roadmap_feature_${key}`,
          value:
            index % 2 === 0
              ? [
                  "content.feature.durable-foundations",
                  "content.feature.living-references",
                ]
              : ["content.feature.durable-foundations"],
        },
      ],
      protectedPropertyValues: [
        { propertyId: definitions[0].id, valueJson: JSON.stringify(status) },
      ],
    });
  }
  return { databaseId, databaseDocumentId, key, rows, definitions };
}

function plan(seed: Awaited<ReturnType<typeof fixture>>) {
  return {
    databaseId: seed.databaseId,
    databaseDocumentId: seed.databaseDocumentId,
    idempotencyKey: `synthetic-key-${seed.key}`,
    expectedRowCount: seed.rows.length,
    legacyPropertyIds: [seed.definitions[1].id, seed.definitions[2].id],
    propertyDefinitions: [
      {
        id: `reported_by_${seed.key}`,
        name: "Reported by",
        type: "text",
        visibility: "always_show",
      },
      {
        id: `slack_thread_${seed.key}`,
        name: "Slack thread",
        type: "url",
        visibility: "always_show",
      },
      {
        id: `reported_date_${seed.key}`,
        name: "Reported date",
        type: "date",
        visibility: "hide_when_empty",
      },
      {
        id: `roadmap_feature_${seed.key}`,
        name: "Roadmap feature",
        type: "multi_select",
        visibility: "always_show",
        options: [
          {
            id: "content.feature.durable-foundations",
            name: "Durable foundations",
            color: "blue",
          },
          {
            id: "content.feature.living-references",
            name: "Living references",
            color: "green",
          },
        ],
      },
    ],
    rows: seed.rows,
  } as const;
}

async function readFixtureState(seed: Awaited<ReturnType<typeof fixture>>) {
  const db = getDb();
  const documentIds = seed.rows.map((row: any) => row.documentId);
  const byId = (left: any, right: any) => left.id.localeCompare(right.id);
  const documents = await db
    .select()
    .from(schema.documents)
    .where(inArray(schema.documents.id, documentIds));
  const items = await db
    .select()
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, seed.databaseId));
  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, seed.databaseId));
  const values = await db
    .select()
    .from(schema.documentPropertyValues)
    .where(inArray(schema.documentPropertyValues.documentId, documentIds));
  const shares = await db
    .select()
    .from(schema.documentShares)
    .where(
      inArray(schema.documentShares.resourceId, [
        seed.databaseDocumentId,
        ...documentIds,
      ]),
    );
  return {
    documents: documents
      .map(({ updatedAt: _updatedAt, ...document }: any) => document)
      .sort(byId),
    items: items
      .map(({ updatedAt: _updatedAt, ...item }: any) => item)
      .sort(byId),
    definitions: definitions
      .map(({ updatedAt: _updatedAt, ...definition }: any) => definition)
      .sort(byId),
    values: values
      .map(({ updatedAt: _updatedAt, ...value }: any) => value)
      .sort(byId),
    shares: shares.sort(byId),
  };
}

/**
 * Terminal replays must be observationally inert. Keep timestamps and the
 * receipt here: stripping them would hide a lock or receipt rewrite.
 */
async function readDurableMigrationState(
  seed: Awaited<ReturnType<typeof fixture>>,
) {
  const db = getDb();
  const documentIds = [
    seed.databaseDocumentId,
    ...seed.rows.map((row: any) => row.documentId),
  ];
  const byId = (left: any, right: any) => left.id.localeCompare(right.id);
  const [databases, documents, items, definitions, values, versions, receipts] =
    await Promise.all([
      db
        .select()
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, seed.databaseId)),
      db
        .select()
        .from(schema.documents)
        .where(inArray(schema.documents.id, documentIds)),
      db
        .select()
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.databaseId, seed.databaseId)),
      db
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          eq(schema.documentPropertyDefinitions.databaseId, seed.databaseId),
        ),
      db
        .select()
        .from(schema.documentPropertyValues)
        .where(inArray(schema.documentPropertyValues.documentId, documentIds)),
      db
        .select()
        .from(schema.documentVersions)
        .where(inArray(schema.documentVersions.documentId, documentIds)),
      db
        .select()
        .from(schema.contentDatabaseMigrationReceipts)
        .where(
          eq(
            schema.contentDatabaseMigrationReceipts.databaseId,
            seed.databaseId,
          ),
        ),
    ]);
  return {
    databases: databases.sort(byId),
    documents: documents.sort(byId),
    items: items.sort(byId),
    definitions: definitions.sort(byId),
    values: values.sort(byId),
    versions: versions.sort(byId),
    receipts: receipts.sort(byId),
  };
}

describe("migrate-content-database-rows", () => {
  it("validates without writes, applies all 20 synthetic rows, and replays without versions", async () => {
    const seed = await fixture();
    const input = plan(seed);
    const db = getDb();
    const validated = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "validate", plan: input }),
    );
    expect(validated).toMatchObject({ written: 0, counts: { rows: 20 } });
    expect(await db.select().from(schema.documentVersions)).toHaveLength(0);
    const applied = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "apply", plan: input }),
    );
    expect(applied).toMatchObject({
      state: "applied",
      written: 20,
      replayed: false,
      verified: false,
    });
    const migrated = await db
      .select()
      .from(schema.documents)
      .where(
        inArray(
          schema.documents.id,
          seed.rows.map((row: any) => row.documentId),
        ),
      );
    const items = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seed.databaseId));
    const values = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(
        inArray(
          schema.documentPropertyValues.documentId,
          seed.rows.map((row: any) => row.documentId),
        ),
      );
    const shares = await db
      .select()
      .from(schema.documentShares)
      .where(
        inArray(schema.documentShares.resourceId, [
          seed.databaseDocumentId,
          ...seed.rows.map((row: any) => row.documentId),
        ]),
      );
    const migratedDefinitions = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        eq(schema.documentPropertyDefinitions.databaseId, seed.databaseId),
      );
    expect(migrated).toHaveLength(20);
    expect(items).toHaveLength(20);
    expect(shares).toHaveLength(0);
    for (const expected of input.propertyDefinitions) {
      expect(
        migratedDefinitions.find(
          (definition: any) => definition.id === expected.id,
        ),
      ).toMatchObject({
        id: expected.id,
        ownerEmail: OWNER,
        databaseId: seed.databaseId,
        name: expected.name,
        type: expected.type,
        visibility: expected.visibility,
        optionsJson: JSON.stringify(
          expected.type === "multi_select" ? { options: expected.options } : {},
        ),
      });
    }
    for (const expected of seed.rows) {
      const document = migrated.find(
        (candidate: any) => candidate.id === expected.documentId,
      );
      const item = items.find(
        (candidate: any) => candidate.id === expected.itemId,
      );
      expect(document).toMatchObject({
        id: expected.documentId,
        ownerEmail: OWNER,
        spaceId: "synthetic_space",
        parentId: seed.databaseDocumentId,
        content: expected.content,
        visibility: "private",
        hideFromSearch: 1,
      });
      expect(item).toMatchObject({
        id: expected.itemId,
        databaseId: seed.databaseId,
        documentId: expected.documentId,
        ownerEmail: OWNER,
      });
      const rowValues = values.filter(
        (value: any) => value.documentId === expected.documentId,
      );
      expect(rowValues).toHaveLength(7);
      expect(
        rowValues.find(
          (value: any) => value.propertyId === seed.definitions[0].id,
        )?.valueJson,
      ).toBe(expected.protectedPropertyValues[0].valueJson);
      for (const propertyValue of expected.propertyValues) {
        const definition = input.propertyDefinitions.find(
          (candidate) => candidate.id === propertyValue.propertyId,
        )!;
        expect(
          rowValues.find(
            (value: any) => value.propertyId === propertyValue.propertyId,
          )?.valueJson,
        ).toBe(serializeMigrationValue(definition, propertyValue.value));
      }
    }
    const versions = await db
      .select()
      .from(schema.documentVersions)
      .where(
        inArray(
          schema.documentVersions.documentId,
          seed.rows.map((row: any) => row.documentId),
        ),
      );
    expect(versions).toHaveLength(20);
    const replayed = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "apply", plan: input }),
    );
    expect(replayed).toMatchObject({ replayed: true, state: "applied" });
    expect(
      await db
        .select()
        .from(schema.documentVersions)
        .where(
          inArray(
            schema.documentVersions.documentId,
            seed.rows.map((row: any) => row.documentId),
          ),
        ),
    ).toHaveLength(20);
  });

  it("refuses unauthorised, stale, and unknown-option plans before a write", async () => {
    const seed = await fixture();
    const input: any = structuredClone(plan(seed));
    const before = await readFixtureState(seed);
    const originalTimestamp = seed.rows[0].expectedUpdatedAt;
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        action.run({ phase: "apply", plan: input }),
      ),
    ).rejects.toThrow();
    input.rows[0].expectedUpdatedAt = "stale";
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: input }),
      ),
    ).rejects.toThrow("Stale row");
    input.rows[0].expectedUpdatedAt = originalTimestamp;
    input.rows[0].propertyValues[3].value = ["unknown"];
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: input }),
      ),
    ).rejects.toThrow("Unknown multi-select option");
    expect(await readFixtureState(seed)).toEqual(before);
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
  });

  it("rejects same-key changed plans and rolls all writes back on an abort trigger", async () => {
    const seed = await fixture();
    const input: any = structuredClone(plan(seed));
    const db = getDb();
    const before = await readFixtureState(seed);
    await db.run(
      sql.raw(
        `CREATE TRIGGER synthetic_migration_abort BEFORE UPDATE ON documents WHEN NEW.id = '${seed.rows[8].documentId}' BEGIN SELECT RAISE(ABORT, 'synthetic migration abort'); END`,
      ),
    );
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: input }),
      ),
    ).rejects.toThrow("synthetic migration abort");
    expect(await readFixtureState(seed)).toEqual(before);
    expect(
      await db
        .select()
        .from(schema.documentVersions)
        .where(
          inArray(
            schema.documentVersions.documentId,
            seed.rows.map((row: any) => row.documentId),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          eq(schema.documentPropertyDefinitions.databaseId, seed.databaseId),
        ),
    ).toHaveLength(3);
    expect(
      await db
        .select()
        .from(schema.contentDatabaseMigrationReceipts)
        .where(
          eq(
            schema.contentDatabaseMigrationReceipts.databaseId,
            seed.databaseId,
          ),
        ),
    ).toHaveLength(0);
    await db.run(sql`DROP TRIGGER synthetic_migration_abort`);
    const applied: any = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "apply", plan: input }),
    );
    const changed = structuredClone(input);
    changed.rows[0].content = "# Different synthetic body";
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: changed }),
      ),
    ).rejects.toThrow("different migration plan");
    expect(applied.state).toBe("applied");
  });

  it("serializes simultaneous same-key applies into one commit and one replay", async () => {
    const seed = await fixture();
    const input = plan(seed);
    const results = await Promise.all([
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: input }),
      ),
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: input }),
      ),
    ]);

    expect(results.map((result: any) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
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
    ).toHaveLength(1);
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(
          inArray(
            schema.documentVersions.documentId,
            seed.rows.map((row: any) => row.documentId),
          ),
        ),
    ).toHaveLength(seed.rows.length);
  });

  it("serializes an ordinary row addition against the exact migration snapshot", async () => {
    const seed = await fixture();
    const input = plan(seed);
    const concurrentDocumentId = `concurrent_document_${seed.key}`;
    const [migration, addition] = await Promise.allSettled([
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: input }),
      ),
      getDb().transaction(async (tx: any) => {
        const stamp = now();
        await lockContentDatabaseMutation(tx, seed.databaseId);
        await touchContentDatabase(tx, seed.databaseId, stamp);
        await tx.insert(schema.documents).values({
          id: concurrentDocumentId,
          ownerEmail: OWNER,
          spaceId: "synthetic_space",
          parentId: seed.databaseDocumentId,
          title: "Concurrent synthetic row",
          content: "",
          visibility: "private",
          position: 20,
          createdAt: stamp,
          updatedAt: stamp,
        });
        await tx.insert(schema.contentDatabaseItems).values({
          id: `concurrent_item_${seed.key}`,
          ownerEmail: OWNER,
          databaseId: seed.databaseId,
          documentId: concurrentDocumentId,
          position: 20,
          createdAt: stamp,
          updatedAt: stamp,
        });
      }),
    ]);

    if (addition.status === "rejected") throw addition.reason;
    expect(
      await getDb()
        .select()
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.databaseId, seed.databaseId)),
    ).toHaveLength(21);
    const receipts = await getDb()
      .select()
      .from(schema.contentDatabaseMigrationReceipts)
      .where(
        eq(schema.contentDatabaseMigrationReceipts.databaseId, seed.databaseId),
      );
    const newDefinitions = await getDb()
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        inArray(
          schema.documentPropertyDefinitions.id,
          input.propertyDefinitions.map((definition) => definition.id),
        ),
      );
    const [firstRow] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, seed.rows[0].documentId));
    if (migration.status === "fulfilled") {
      expect(receipts).toHaveLength(1);
      expect(newDefinitions).toHaveLength(input.propertyDefinitions.length);
      expect(firstRow.content).toBe(input.rows[0].content);
    } else {
      expect(receipts).toHaveLength(0);
      expect(newDefinitions).toHaveLength(0);
      expect(firstRow.content).toBe("# Synthetic heading 0");
    }
  });

  it("applies the declared 100-row by 100-property ceiling in bounded batches", async () => {
    const seed = await fixture(100);
    const input: any = {
      ...plan(seed),
      legacyPropertyIds: [],
      propertyDefinitions: Array.from({ length: 100 }, (_, index) => ({
        id: `bounded_property_${seed.key}_${index}`,
        name: `Bounded property ${index}`,
        type: "text",
        visibility: "always_show",
      })),
    };
    input.rows = seed.rows.map((row: any) => ({
      ...row,
      propertyValues: input.propertyDefinitions.map((definition: any) => ({
        propertyId: definition.id,
        value: `${row.documentId}:${definition.id}`,
      })),
    }));

    const applied: any = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "apply", plan: input }),
    );
    expect(applied).toMatchObject({
      state: "applied",
      counts: { rows: 100, properties: 100 },
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentPropertyValues)
        .where(
          inArray(
            schema.documentPropertyValues.propertyId,
            input.propertyDefinitions.map((definition: any) =>
              String(definition.id),
            ),
          ),
        ),
    ).toHaveLength(10_000);
  }, 60_000);

  it("rejects source-mapped legacy fields and detects property-description drift", async () => {
    const db = getDb();
    const mappedSeed = await fixture();
    const sourceId = `synthetic_source_${mappedSeed.key}`;
    await db.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId: mappedSeed.databaseId,
      sourceType: "mock-local",
      sourceName: "Synthetic source",
      sourceTable: "synthetic",
    });
    await db.insert(schema.contentDatabaseSourceFields).values({
      id: `synthetic_source_field_${mappedSeed.key}`,
      ownerEmail: OWNER,
      sourceId,
      propertyId: mappedSeed.definitions[1].id,
      localFieldKey: "cluster",
      sourceFieldKey: "cluster",
      sourceFieldLabel: "Cluster",
      sourceFieldType: "text",
    });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: plan(mappedSeed) }),
      ),
    ).rejects.toThrow("mapped to a source");
    expect(
      await db
        .select()
        .from(schema.contentDatabaseMigrationReceipts)
        .where(
          eq(
            schema.contentDatabaseMigrationReceipts.databaseId,
            mappedSeed.databaseId,
          ),
        ),
    ).toHaveLength(0);

    const driftSeed = await fixture();
    const driftPlan = plan(driftSeed);
    const applied: any = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "apply", plan: driftPlan }),
    );
    await db
      .update(schema.documentPropertyDefinitions)
      .set({ description: "A later synthetic edit" })
      .where(
        eq(
          schema.documentPropertyDefinitions.id,
          driftPlan.propertyDefinitions[0].id,
        ),
      );
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({
          phase: "verify",
          databaseId: driftSeed.databaseId,
          idempotencyKey: driftPlan.idempotencyKey,
          expectedPostDigest: applied.postDigest,
        }),
      ),
    ).rejects.toThrow("drifted");
  });

  it("requires current editor access to every row before legacy cleanup", async () => {
    const seed = await fixture();
    const input = plan(seed);
    const stamp = now();
    await getDb()
      .insert(schema.documentShares)
      .values([
        {
          id: `synthetic_database_admin_${seed.key}`,
          resourceId: seed.databaseDocumentId,
          principalType: "user",
          principalId: OUTSIDER,
          role: "admin",
          createdBy: OWNER,
          createdAt: stamp,
        },
        ...seed.rows.map((row: any, index: number) => ({
          id: `synthetic_row_editor_${seed.key}_${index}`,
          resourceId: row.documentId,
          principalType: "user",
          principalId: OUTSIDER,
          role: "editor",
          createdBy: OWNER,
          createdAt: stamp,
        })),
      ]);
    const applied: any = await runWithRequestContext(
      { userEmail: OUTSIDER },
      () => action.run({ phase: "apply", plan: input }),
    );
    await runWithRequestContext({ userEmail: OUTSIDER }, () =>
      action.run({
        phase: "verify",
        databaseId: seed.databaseId,
        idempotencyKey: input.idempotencyKey,
        expectedPostDigest: applied.postDigest,
      }),
    );
    await getDb()
      .delete(schema.documentShares)
      .where(
        eq(schema.documentShares.id, `synthetic_row_editor_${seed.key}_0`),
      );

    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        action.run({
          phase: "finalize",
          databaseId: seed.databaseId,
          idempotencyKey: input.idempotencyKey,
          expectedPostDigest: applied.postDigest,
        }),
      ),
    ).rejects.toThrow();
    expect(
      await getDb()
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          inArray(
            schema.documentPropertyDefinitions.id,
            input.legacyPropertyIds,
          ),
        ),
    ).toHaveLength(input.legacyPropertyIds.length);
  });

  it("performs guarded rollback/finalize and refuses drift", async () => {
    const db = getDb();
    const rollbackSeed = await fixture();
    const rollbackPlan: any = structuredClone(plan(rollbackSeed));
    const beforeRollback = await readFixtureState(rollbackSeed);
    const applied: any = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "apply", plan: rollbackPlan }),
    );
    const rolledBack: any = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        action.run({
          phase: "rollback",
          databaseId: rollbackSeed.databaseId,
          idempotencyKey: rollbackPlan.idempotencyKey,
          expectedPostDigest: applied.postDigest,
        }),
    );
    expect(rolledBack).toMatchObject({
      state: "rolled_back",
      postDigest: applied.preDigest,
    });
    expect(await readFixtureState(rollbackSeed)).toEqual(beforeRollback);
    const rollbackStateBeforeReplay =
      await readDurableMigrationState(rollbackSeed);
    const rollbackReplay: any = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        action.run({
          phase: "rollback",
          databaseId: rollbackSeed.databaseId,
          idempotencyKey: rollbackPlan.idempotencyKey,
          expectedPostDigest: applied.postDigest,
        }),
    );
    expect(rollbackReplay).toMatchObject({
      state: "rolled_back",
      replayed: true,
      postDigest: applied.preDigest,
    });
    expect(await readFixtureState(rollbackSeed)).toEqual(beforeRollback);
    expect(await readDurableMigrationState(rollbackSeed)).toEqual(
      rollbackStateBeforeReplay,
    );
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({
          phase: "rollback",
          databaseId: rollbackSeed.databaseId,
          idempotencyKey: rollbackPlan.idempotencyKey,
          expectedPostDigest: "wrong-synthetic-digest",
        }),
      ),
    ).rejects.toThrow("drifted");
    expect(await readFixtureState(rollbackSeed)).toEqual(beforeRollback);
    expect(
      await db
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          eq(
            schema.documentPropertyDefinitions.databaseId,
            rollbackSeed.databaseId,
          ),
        ),
    ).toHaveLength(3);
    const finalizeSeed = await fixture();
    const finalizePlan: any = structuredClone(plan(finalizeSeed));
    const finalizedApply: any = await runWithRequestContext(
      { userEmail: OWNER },
      () => action.run({ phase: "apply", plan: finalizePlan }),
    );
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({
          phase: "finalize",
          databaseId: finalizeSeed.databaseId,
          idempotencyKey: finalizePlan.idempotencyKey,
          expectedPostDigest: finalizedApply.postDigest,
        }),
      ),
    ).rejects.toThrow("verified");
    const verified: any = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        action.run({
          phase: "verify",
          databaseId: finalizeSeed.databaseId,
          idempotencyKey: finalizePlan.idempotencyKey,
          expectedPostDigest: finalizedApply.postDigest,
        }),
    );
    expect(verified.state).toBe("verified");
    const verifyStateBeforeReplay =
      await readDurableMigrationState(finalizeSeed);
    const verifyReplay: any = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        action.run({
          phase: "verify",
          databaseId: finalizeSeed.databaseId,
          idempotencyKey: finalizePlan.idempotencyKey,
          expectedPostDigest: finalizedApply.postDigest,
        }),
    );
    expect(verifyReplay).toMatchObject({
      state: "verified",
      replayed: true,
      verified: true,
    });
    expect(await readDurableMigrationState(finalizeSeed)).toEqual(
      verifyStateBeforeReplay,
    );
    const finalized: any = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        action.run({
          phase: "finalize",
          databaseId: finalizeSeed.databaseId,
          idempotencyKey: finalizePlan.idempotencyKey,
          expectedPostDigest: verified.postDigest,
        }),
    );
    expect(finalized.state).toBe("finalized");
    const finalizeStateBeforeReplay =
      await readDurableMigrationState(finalizeSeed);
    const finalizeReplay: any = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        action.run({
          phase: "finalize",
          databaseId: finalizeSeed.databaseId,
          idempotencyKey: finalizePlan.idempotencyKey,
          expectedPostDigest: verified.postDigest,
        }),
    );
    expect(finalizeReplay).toMatchObject({
      state: "finalized",
      replayed: true,
      verified: true,
    });
    expect(await readDurableMigrationState(finalizeSeed)).toEqual(
      finalizeStateBeforeReplay,
    );
    expect(
      await db
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(
              schema.documentPropertyDefinitions.databaseId,
              finalizeSeed.databaseId,
            ),
            inArray(
              schema.documentPropertyDefinitions.id,
              finalizePlan.legacyPropertyIds,
            ),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.documentPropertyValues)
        .where(
          inArray(
            schema.documentPropertyValues.propertyId,
            finalizePlan.legacyPropertyIds,
          ),
        ),
    ).toHaveLength(0);
    const driftSeed = await fixture();
    const driftPlan: any = structuredClone(plan(driftSeed));
    const drifted: any = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "apply", plan: driftPlan }),
    );
    await db
      .update(schema.documents)
      .set({ content: "# Drifted synthetic body" })
      .where(eq(schema.documents.id, driftSeed.rows[0].documentId));
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({
          phase: "rollback",
          databaseId: driftSeed.databaseId,
          idempotencyKey: driftPlan.idempotencyKey,
          expectedPostDigest: drifted.postDigest,
        }),
      ),
    ).rejects.toThrow("drifted");
  });

  it("allows only one competing terminal transition from a verified receipt", async () => {
    const seed = await fixture();
    const input = plan(seed);
    const applied: any = await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({ phase: "apply", plan: input }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      action.run({
        phase: "verify",
        databaseId: seed.databaseId,
        idempotencyKey: input.idempotencyKey,
        expectedPostDigest: applied.postDigest,
      }),
    );

    const transitions = await Promise.allSettled([
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({
          phase: "rollback",
          databaseId: seed.databaseId,
          idempotencyKey: input.idempotencyKey,
          expectedPostDigest: applied.postDigest,
        }),
      ),
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({
          phase: "finalize",
          databaseId: seed.databaseId,
          idempotencyKey: input.idempotencyKey,
          expectedPostDigest: applied.postDigest,
        }),
      ),
    ]);

    expect(
      transitions.filter((transition) => transition.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      transitions.filter((transition) => transition.status === "rejected"),
    ).toHaveLength(1);
    const [receipt] = await getDb()
      .select()
      .from(schema.contentDatabaseMigrationReceipts)
      .where(
        eq(schema.contentDatabaseMigrationReceipts.databaseId, seed.databaseId),
      );
    expect(["rolled_back", "finalized"]).toContain(receipt.state);
  });
});
