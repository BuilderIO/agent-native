import { runWithRequestContext } from "@agent-native/core/server";
import { eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const flushOpenDocumentEditorToSql = vi.hoisted(() => vi.fn());

vi.mock("./_document-flush.js", () => ({
  flushOpenDocumentEditorToSql,
}));

const POSTGRES_URL = process.env.CONTENT_MIGRATION_POSTGRES_URL;
const OWNER = "synthetic-postgres-migration-owner@example.test";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let action: typeof import("./migrate-content-database-rows.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;
let lockContentDatabaseMutation: typeof import("./_content-database-mutation-lock.js").lockContentDatabaseMutation;
let deleteDocument: typeof import("./delete-document.js").default;
let deleteContentDatabase: typeof import("./delete-content-database.js").default;
let restoreDocument: typeof import("./restore-document.js").default;
let restoreContentDatabase: typeof import("./restore-content-database.js").default;
let permanentlyDeleteDocument: typeof import("./permanently-delete-document.js").default;

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
  lockContentDatabaseMutation = (
    await import("./_content-database-mutation-lock.js")
  ).lockContentDatabaseMutation;
  deleteDocument = (await import("./delete-document.js")).default;
  deleteContentDatabase = (await import("./delete-content-database.js"))
    .default;
  restoreDocument = (await import("./restore-document.js")).default;
  restoreContentDatabase = (await import("./restore-content-database.js"))
    .default;
  permanentlyDeleteDocument = (await import("./permanently-delete-document.js"))
    .default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60_000);

beforeEach(() => {
  flushOpenDocumentEditorToSql.mockReset();
  flushOpenDocumentEditorToSql.mockResolvedValue(undefined);
});

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
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    if (Number(rows[0]?.waiting) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Migration did not enter the expected PostgreSQL lock wait.");
}

const postgresSuite = POSTGRES_URL ? describe : describe.skip;

postgresSuite("migrate-content-database-rows PostgreSQL locking", () => {
  it("rejects stale plans before requesting an editor flush", async () => {
    const seed = await fixture();
    try {
      seed.plan.rows[0]!.expectedUpdatedAt = "2025-12-31T00:00:00.000Z";
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          action.run({ phase: "apply", plan: seed.plan }),
        ),
      ).rejects.toThrow("Stale row");
      expect(flushOpenDocumentEditorToSql).not.toHaveBeenCalled();
    } finally {
      await cleanupFixture(seed);
    }
  });

  it("revalidates an editor save before applying the migration", async () => {
    const seed = await fixture();
    try {
      flushOpenDocumentEditorToSql.mockImplementationOnce(
        async (args: { documentId: string }) => {
          await getDb()
            .update(schema.documents)
            .set({
              content: "# New live editor body",
              updatedAt: "2026-01-01T00:00:01.000Z",
            })
            .where(eq(schema.documents.id, args.documentId));
        },
      );
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          action.run({ phase: "apply", plan: seed.plan }),
        ),
      ).rejects.toThrow("Stale row");
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
      await cleanupFixture(seed);
    }
  });

  it.each(["apply", "rollback"] as const)(
    "holds the durable database lock while flushing live editors during %s",
    async (phase) => {
      const seed = await fixture();
      let releaseFlush = () => {};
      let contender: Promise<unknown> | undefined;
      let operation: Promise<unknown> | undefined;
      try {
        const applied =
          phase === "rollback"
            ? await runWithRequestContext({ userEmail: OWNER }, () =>
                action.run({ phase: "apply", plan: seed.plan }),
              )
            : null;
        const flushReleased = new Promise<void>((resolve) => {
          releaseFlush = resolve;
        });
        let flushEntered!: () => void;
        const flushStarted = new Promise<void>((resolve) => {
          flushEntered = resolve;
        });
        flushOpenDocumentEditorToSql.mockImplementationOnce(
          async (args: { documentId: string }) => {
            await getDb()
              .update(schema.documents)
              .set({ content: phase === "apply" ? "# Before" : "# Migrated" })
              .where(eq(schema.documents.id, args.documentId));
            flushEntered();
            await flushReleased;
          },
        );

        operation = runWithRequestContext({ userEmail: OWNER }, () =>
          phase === "apply"
            ? action.run({ phase: "apply", plan: seed.plan })
            : action.run({
                phase: "rollback",
                databaseId: seed.databaseId,
                idempotencyKey: seed.plan.idempotencyKey,
                expectedPostDigest: applied!.postDigest,
              }),
        );
        await flushStarted;

        let contenderEntered = false;
        contender = getDb().transaction(async (tx: any) => {
          await lockContentDatabaseMutation(tx, seed.databaseId);
          contenderEntered = true;
        });
        await waitForPostgresLockWait(1);
        expect(contenderEntered).toBe(false);

        releaseFlush();
        await operation;
        await contender;
        expect(contenderEntered).toBe(true);
      } finally {
        releaseFlush();
        await Promise.allSettled(
          [operation, contender].filter(
            (pending): pending is Promise<unknown> => Boolean(pending),
          ),
        );
        await cleanupFixture(seed);
      }
    },
    60_000,
  );

  it("serializes restoring a trashed row behind the migration snapshot", async () => {
    const seed = await fixture();
    const stamp = "2026-01-01T00:00:00.000Z";
    const restoredDocumentId = `postgres_restored_row_${seed.databaseId}`;
    const restoredItemId = `postgres_restored_item_${seed.databaseId}`;
    await getDb().insert(schema.documents).values({
      id: restoredDocumentId,
      ownerEmail: OWNER,
      spaceId: "synthetic_space",
      parentId: seed.databaseDocumentId,
      title: "Synthetic trashed row",
      content: "# Not migrated",
      visibility: "private",
      hideFromSearch: 1,
      trashedAt: stamp,
      trashRootId: restoredDocumentId,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await getDb().insert(schema.contentDatabaseItems).values({
      id: restoredItemId,
      ownerEmail: OWNER,
      databaseId: seed.databaseId,
      documentId: restoredDocumentId,
      position: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });

    let releaseFlush = () => {};
    let migration: Promise<any> | undefined;
    let restore: Promise<any> | undefined;
    try {
      const flushReleased = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
      let flushEntered!: () => void;
      const flushStarted = new Promise<void>((resolve) => {
        flushEntered = resolve;
      });
      flushOpenDocumentEditorToSql.mockImplementationOnce(async () => {
        flushEntered();
        await flushReleased;
      });

      migration = runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: seed.plan }),
      );
      await flushStarted;
      restore = runWithRequestContext({ userEmail: OWNER }, () =>
        restoreDocument.run({ id: restoredDocumentId }),
      );
      await waitForPostgresLockWait(1);
      expect(
        (
          await getDb()
            .select({ trashedAt: schema.documents.trashedAt })
            .from(schema.documents)
            .where(eq(schema.documents.id, restoredDocumentId))
        )[0]?.trashedAt,
      ).toBe(stamp);

      releaseFlush();
      const applied = await migration;
      await restore;
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          action.run({
            phase: "verify",
            databaseId: seed.databaseId,
            idempotencyKey: seed.plan.idempotencyKey,
            expectedPostDigest: applied.postDigest,
          }),
        ),
      ).rejects.toThrow("Migration has drifted; verification is refused.");
    } finally {
      releaseFlush();
      await Promise.allSettled(
        [migration, restore].filter((pending): pending is Promise<unknown> =>
          Boolean(pending),
        ),
      );
      await cleanupFixture(seed);
      await getDb()
        .delete(schema.documents)
        .where(eq(schema.documents.id, restoredDocumentId));
    }
  }, 60_000);

  it.each(["same-trash-root", "active"] as const)(
    "rebuilds permanent-delete scope after a concurrent %s row insertion",
    async (rowState) => {
      const seed = await fixture();
      const stamp = "2026-01-01T00:00:00.000Z";
      const extraDocumentId = `postgres_delete_row_${seed.databaseId}`;
      const extraItemId = `postgres_delete_item_${seed.databaseId}`;
      await runWithRequestContext({ userEmail: OWNER }, () =>
        deleteContentDatabase.run({ databaseId: seed.databaseId }),
      );

      let requestInsertion = () => {};
      let releaseHolder = () => {};
      let holder: Promise<unknown> | undefined;
      let deletion: Promise<any> | undefined;
      try {
        const insertionRequested = new Promise<void>((resolve) => {
          requestInsertion = resolve;
        });
        const holderReleased = new Promise<void>((resolve) => {
          releaseHolder = resolve;
        });
        let holderEntered!: () => void;
        const holderStarted = new Promise<void>((resolve) => {
          holderEntered = resolve;
        });
        let rowInserted!: () => void;
        const insertionCompleted = new Promise<void>((resolve) => {
          rowInserted = resolve;
        });
        holder = getDb().transaction(async (tx: any) => {
          await lockContentDatabaseMutation(tx, seed.databaseId);
          holderEntered();
          await insertionRequested;
          await tx.insert(schema.documents).values({
            id: extraDocumentId,
            ownerEmail: OWNER,
            spaceId: "synthetic_space",
            parentId: seed.databaseDocumentId,
            title: "Concurrent synthetic row",
            content: "# Concurrent",
            visibility: "private",
            hideFromSearch: 1,
            trashedAt: rowState === "same-trash-root" ? stamp : null,
            trashRootId:
              rowState === "same-trash-root" ? seed.databaseDocumentId : null,
            createdAt: stamp,
            updatedAt: stamp,
          });
          await tx.insert(schema.contentDatabaseItems).values({
            id: extraItemId,
            ownerEmail: OWNER,
            databaseId: seed.databaseId,
            documentId: extraDocumentId,
            position: 1,
            createdAt: stamp,
            updatedAt: stamp,
          });
          rowInserted();
          await holderReleased;
        });
        await holderStarted;

        deletion = runWithRequestContext({ userEmail: OWNER }, () =>
          permanentlyDeleteDocument.run({ id: seed.databaseDocumentId }),
        );
        const deletionExpectation =
          rowState === "active"
            ? expect(deletion).rejects.toThrow(
                "Database contains an active row outside this Trash item",
              )
            : null;
        await waitForPostgresLockWait(1);
        requestInsertion();
        await insertionCompleted;
        releaseHolder();
        await holder;

        if (deletionExpectation) {
          await deletionExpectation;
          expect(
            await getDb()
              .select()
              .from(schema.contentDatabases)
              .where(eq(schema.contentDatabases.id, seed.databaseId)),
          ).toHaveLength(1);
          expect(
            await getDb()
              .select()
              .from(schema.documents)
              .where(eq(schema.documents.id, extraDocumentId)),
          ).toHaveLength(1);
        } else {
          await deletion;
          expect(
            await getDb()
              .select()
              .from(schema.contentDatabaseItems)
              .where(eq(schema.contentDatabaseItems.id, extraItemId)),
          ).toHaveLength(0);
          expect(
            await getDb()
              .select()
              .from(schema.documents)
              .where(eq(schema.documents.id, extraDocumentId)),
          ).toHaveLength(0);
        }
      } finally {
        requestInsertion();
        releaseHolder();
        await Promise.allSettled(
          [holder, deletion].filter((pending): pending is Promise<unknown> =>
            Boolean(pending),
          ),
        );
        await cleanupFixture(seed);
        await getDb()
          .delete(schema.documents)
          .where(eq(schema.documents.id, extraDocumentId));
      }
    },
    60_000,
  );

  it("retries permanent deletion when a new external membership expands the lock set", async () => {
    const seed = await fixture();
    const stamp = "2026-01-01T00:00:00.000Z";
    const externalDatabaseId = `aaa_external_${seed.databaseId}`;
    const externalDatabaseDocumentId = `external_page_${seed.databaseId}`;
    const externalItemId = `external_item_${seed.databaseId}`;
    await getDb().insert(schema.documents).values({
      id: externalDatabaseDocumentId,
      ownerEmail: OWNER,
      spaceId: "synthetic_space",
      title: "External synthetic database",
      content: "",
      visibility: "private",
      createdAt: stamp,
      updatedAt: stamp,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: externalDatabaseId,
      ownerEmail: OWNER,
      spaceId: "synthetic_space",
      documentId: externalDatabaseDocumentId,
      title: "External synthetic database",
      createdAt: stamp,
      updatedAt: stamp,
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteDocument.run({ id: seed.documentId }),
    );

    let releaseHolder = () => {};
    let holder: Promise<unknown> | undefined;
    let deletion: Promise<any> | undefined;
    try {
      const holderReleased = new Promise<void>((resolve) => {
        releaseHolder = resolve;
      });
      let holderEntered!: () => void;
      const holderStarted = new Promise<void>((resolve) => {
        holderEntered = resolve;
      });
      holder = getDb().transaction(async (tx: any) => {
        await lockContentDatabaseMutation(tx, seed.databaseId);
        holderEntered();
        await holderReleased;
      });
      await holderStarted;

      deletion = runWithRequestContext({ userEmail: OWNER }, () =>
        permanentlyDeleteDocument.run({ id: seed.documentId }),
      );
      await waitForPostgresLockWait(1);
      await getDb().transaction(async (tx: any) => {
        await lockContentDatabaseMutation(tx, externalDatabaseId);
        await tx.insert(schema.contentDatabaseItems).values({
          id: externalItemId,
          ownerEmail: OWNER,
          databaseId: externalDatabaseId,
          documentId: seed.documentId,
          position: 0,
          createdAt: stamp,
          updatedAt: stamp,
        });
      });
      releaseHolder();
      await holder;
      await deletion;

      expect(
        await getDb()
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, seed.documentId)),
      ).toHaveLength(0);
      expect(
        await getDb()
          .select()
          .from(schema.contentDatabaseItems)
          .where(eq(schema.contentDatabaseItems.id, externalItemId)),
      ).toHaveLength(0);
      expect(
        await getDb()
          .select()
          .from(schema.contentDatabases)
          .where(eq(schema.contentDatabases.id, externalDatabaseId)),
      ).toHaveLength(1);
    } finally {
      releaseHolder();
      await Promise.allSettled(
        [holder, deletion].filter((pending): pending is Promise<unknown> =>
          Boolean(pending),
        ),
      );
      await cleanupFixture(seed);
      await getDb()
        .delete(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.databaseId, externalDatabaseId));
      await getDb()
        .delete(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, externalDatabaseId));
      await getDb()
        .delete(schema.documents)
        .where(eq(schema.documents.id, externalDatabaseDocumentId));
    }
  }, 60_000);

  it("refuses permanent deletion when restore wins the lifecycle locks", async () => {
    const seed = await fixture();
    await runWithRequestContext({ userEmail: OWNER }, () =>
      deleteContentDatabase.run({ databaseId: seed.databaseId }),
    );
    let releaseHolder = () => {};
    let holder: Promise<unknown> | undefined;
    let restore: Promise<any> | undefined;
    let deletion: Promise<any> | undefined;
    try {
      const holderReleased = new Promise<void>((resolve) => {
        releaseHolder = resolve;
      });
      let holderEntered!: () => void;
      const holderStarted = new Promise<void>((resolve) => {
        holderEntered = resolve;
      });
      holder = getDb().transaction(async (tx: any) => {
        await lockContentDatabaseMutation(tx, seed.databaseId);
        holderEntered();
        await holderReleased;
      });
      await holderStarted;

      restore = runWithRequestContext({ userEmail: OWNER }, () =>
        restoreContentDatabase.run({ databaseId: seed.databaseId }),
      );
      await waitForPostgresLockWait(1);
      deletion = runWithRequestContext({ userEmail: OWNER }, () =>
        permanentlyDeleteDocument.run({ id: seed.databaseDocumentId }),
      );
      // The losing deletion rejects while the awaits below are still pending,
      // and Node reports a rejection with no handler attached at that moment as
      // a run-level unhandled rejection even though the assertion arrives a few
      // lines later. Capture the outcome as it settles, then assert on it.
      const deletionOutcome = deletion.then(
        () => null,
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseHolder();
      await holder;
      await restore;
      const deletionError = await deletionOutcome;
      expect(deletionError).toBeInstanceOf(Error);
      expect((deletionError as Error).message).toContain(
        "Document must be in Trash and be a Trash root before permanent deletion",
      );

      expect(
        (
          await getDb()
            .select({ deletedAt: schema.contentDatabases.deletedAt })
            .from(schema.contentDatabases)
            .where(eq(schema.contentDatabases.id, seed.databaseId))
        )[0]?.deletedAt,
      ).toBeNull();
      expect(
        (
          await getDb()
            .select({ trashedAt: schema.documents.trashedAt })
            .from(schema.documents)
            .where(eq(schema.documents.id, seed.databaseDocumentId))
        )[0]?.trashedAt,
      ).toBeNull();
    } finally {
      releaseHolder();
      await Promise.allSettled(
        [holder, restore, deletion].filter(
          (pending): pending is Promise<unknown> => Boolean(pending),
        ),
      );
      await cleanupFixture(seed);
    }
  }, 60_000);

  it("removes a receipt when permanent deletion follows a migration that held the database lock", async () => {
    const seed = await fixture();
    const rootId = `postgres_migration_root_${seed.databaseId}`;
    await getDb().insert(schema.documents).values({
      id: rootId,
      ownerEmail: OWNER,
      spaceId: "synthetic_space",
      title: "Synthetic parent",
      content: "",
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await getDb()
      .update(schema.documents)
      .set({ parentId: rootId })
      .where(eq(schema.documents.id, seed.databaseDocumentId));
    let releaseFlush = () => {};
    let migration: Promise<any> | undefined;
    let trash: Promise<any> | undefined;
    try {
      const flushReleased = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });
      let flushEntered = () => {};
      const flushStarted = new Promise<void>((resolve) => {
        flushEntered = resolve;
      });
      flushOpenDocumentEditorToSql.mockImplementationOnce(async () => {
        flushEntered();
        await flushReleased;
      });

      migration = runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: seed.plan }),
      );
      await flushStarted;
      trash = runWithRequestContext({ userEmail: OWNER }, () =>
        deleteDocument.run({ id: rootId }),
      );
      await waitForPostgresLockWait(1);

      releaseFlush();
      await migration;
      await trash;
      await runWithRequestContext({ userEmail: OWNER }, () =>
        permanentlyDeleteDocument.run({ id: rootId }),
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
      expect(
        await getDb()
          .select()
          .from(schema.contentDatabases)
          .where(eq(schema.contentDatabases.id, seed.databaseId)),
      ).toHaveLength(0);
      expect(
        await getDb()
          .select()
          .from(schema.contentDatabaseItems)
          .where(eq(schema.contentDatabaseItems.databaseId, seed.databaseId)),
      ).toHaveLength(0);
    } finally {
      releaseFlush();
      await Promise.allSettled(
        [migration, trash].filter((pending): pending is Promise<unknown> =>
          Boolean(pending),
        ),
      );
      await cleanupFixture(seed);
      await getDb()
        .delete(schema.documents)
        .where(eq(schema.documents.id, rootId));
    }
  }, 60_000);

  it("fails a migration cleanly when database deletion wins the durable lock", async () => {
    const seed = await fixture();
    const gate = 64_058;
    const trigger = `synthetic_delete_gate_${seed.databaseId}`;
    const functionName = `synthetic_delete_gate_fn_${seed.databaseId}`;
    await getDb().execute(
      sql.raw(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${gate}); RETURN NEW; END; $$`,
      ),
    );
    await getDb().execute(
      sql.raw(
        `CREATE TRIGGER ${trigger} BEFORE UPDATE ON content_databases FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.owner_email = '${OWNER}') EXECUTE FUNCTION ${functionName}()`,
      ),
    );
    let releaseGate = () => {};
    let gateHolder: Promise<unknown> | undefined;
    let trash: Promise<unknown> | undefined;
    let permanentDelete: Promise<unknown> | undefined;
    let migrationExpectation: Promise<unknown> | undefined;
    try {
      const gateReleased = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let gateHeld = () => {};
      const gateAcquired = new Promise<void>((resolve) => {
        gateHeld = resolve;
      });
      gateHolder = getDb().transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${gate})`));
        gateHeld();
        await gateReleased;
      });
      await gateAcquired;
      trash = runWithRequestContext({ userEmail: OWNER }, () =>
        deleteContentDatabase.run({ databaseId: seed.databaseId }),
      );
      await waitForPostgresLockWait(1);

      const migration = runWithRequestContext({ userEmail: OWNER }, () =>
        action.run({ phase: "apply", plan: seed.plan }),
      );
      migrationExpectation = Promise.resolve(
        expect(migration).rejects.toThrow("Database not found"),
      );
      await waitForPostgresLockWait(2);
      releaseGate();
      await gateHolder;
      await trash;
      permanentDelete = runWithRequestContext({ userEmail: OWNER }, () =>
        permanentlyDeleteDocument.run({ id: seed.databaseDocumentId }),
      );
      await Promise.all([migrationExpectation, permanentDelete]);

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
      expect(
        await getDb()
          .select()
          .from(schema.contentDatabases)
          .where(eq(schema.contentDatabases.id, seed.databaseId)),
      ).toHaveLength(0);
      expect(flushOpenDocumentEditorToSql).not.toHaveBeenCalled();
    } finally {
      releaseGate();
      await Promise.allSettled(
        [gateHolder, trash, permanentDelete, migrationExpectation].filter(
          (pending): pending is Promise<unknown> => Boolean(pending),
        ),
      );
      await getDb().execute(
        sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON content_databases`),
      );
      await getDb().execute(
        sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`),
      );
      await cleanupFixture(seed);
    }
  }, 60_000);

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
      let concurrentWriter: Promise<unknown> | undefined;
      let migrationExpectation: Promise<unknown> | undefined;
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
        concurrentWriter = runWithRequestContext({ userEmail: OWNER }, () =>
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
        migrationExpectation = Promise.resolve(
          expect(migration).rejects.toThrow(
            writer === "value"
              ? "Protected property values no longer match persisted values"
              : "New property definition collides with an existing definition",
          ),
        );
        await waitForPostgresLockWait(2);
        releaseGate();
        await gateHolder;
        await concurrentWriter;
        await migrationExpectation;
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
        await Promise.allSettled(
          [gateHolder, concurrentWriter, migrationExpectation].filter(
            (pending): pending is Promise<unknown> => Boolean(pending),
          ),
        );
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
