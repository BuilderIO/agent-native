import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `cancel-prepared-builder-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "owner@example.com";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let cancelPrepared: typeof import("./cancel-prepared-builder-source-update.js").default;
let getWriteSnapshot: typeof import("./_database-source-utils.js").getContentDatabaseSourceSnapshotForWrite;
let prepareReview: typeof import("./prepare-builder-source-review.js").default;
let counter = 0;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  cancelPrepared = (await import("./cancel-prepared-builder-source-update.js"))
    .default;
  getWriteSnapshot = (await import("./_database-source-utils.js"))
    .getContentDatabaseSourceSnapshotForWrite;
  prepareReview = (await import("./prepare-builder-source-review.js")).default;
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function asUser<T>(email: string, fn: () => Promise<T>) {
  return runWithRequestContext({ userEmail: email }, fn);
}

async function seed(args?: {
  sourceType?: string;
  executions?: Array<{
    state: string;
    payload?: Record<string, unknown>;
    attemptToken?: string | null;
  }>;
  claimMode?: "canonical" | "missing" | "mismatched" | "foreign";
  duplicateIdempotency?: boolean;
  titleDiff?: { remote: string; local: string };
  syntheticChangeSetId?: boolean;
}) {
  const suffix = `${++counter}_${Math.random().toString(36).slice(2, 7)}`;
  const now = "2026-07-13T20:00:00.000Z";
  const databaseId = `database_${suffix}`;
  const documentId = `document_${suffix}`;
  const sourceId = `source_${suffix}`;
  const itemId = `item_${suffix}`;
  const itemDocumentId = `item_document_${suffix}`;
  const sourceRowId = `row_${suffix}`;
  const changeSetId = args?.syntheticChangeSetId
    ? `local-pending-${sourceRowId}-change`
    : `change_${suffix}`;
  const db = getDb();

  await db.insert(schema.documents).values({
    id: documentId,
    ownerEmail: OWNER,
    title: "Builder cancellation database",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId,
    title: "Builder cancellation database",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSources).values({
    id: sourceId,
    ownerEmail: OWNER,
    databaseId,
    sourceType: args?.sourceType ?? "builder-cms",
    sourceName: "Builder CMS",
    sourceTable: "agent-native-blog-article-test",
    capabilitiesJson: "{}",
    metadataJson: JSON.stringify({
      primaryKey: "id",
      titleField: "data.title",
      writeMode: "stage_only",
    }),
    createdAt: now,
    updatedAt: now,
  });
  if (args?.titleDiff) {
    await db.insert(schema.documents).values({
      id: itemDocumentId,
      ownerEmail: OWNER,
      parentId: documentId,
      title: args.titleDiff.local,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: OWNER,
      databaseId,
      documentId: itemDocumentId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: sourceRowId,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: itemId,
      documentId: itemDocumentId,
      sourceRowId: `builder_${suffix}`,
      sourceQualifiedId: `builder-cms://agent-native-blog-article-test/builder_${suffix}`,
      sourceDisplayKey: args.titleDiff.remote,
      sourceValuesJson: JSON.stringify({
        "data.title": args.titleDiff.remote,
      }),
      provenance: "Builder CMS read adapter",
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.insert(schema.contentDatabaseSourceChangeSets).values({
    id: changeSetId,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: args?.titleDiff ? itemId : null,
    documentId: args?.titleDiff ? itemDocumentId : null,
    kind: "field_update",
    direction: "outbound",
    state: "approved",
    pushMode: "autosave",
    localOnly: 1,
    summary: "Prepared title update.",
    fieldChangesJson: JSON.stringify(
      args?.titleDiff
        ? [
            {
              propertyId: null,
              propertyName: "Title",
              localFieldKey: "title",
              sourceFieldKey: "data.title",
              currentValue: args.titleDiff.remote,
              proposedValue: args.titleDiff.local,
            },
          ]
        : [],
    ),
    createdAt: now,
    updatedAt: now,
  });

  const executions = args?.executions ?? [
    { state: "ready", payload: { dryRun: { status: "validated" } } },
  ];
  for (const [index, execution] of executions.entries()) {
    const id = `execution_${suffix}_${index}`;
    const idempotencyKey = `builder-cms:${sourceId}:${changeSetId}:autosave:${args?.duplicateIdempotency ? 0 : index}`;
    await db.insert(schema.contentDatabaseSourceExecutions).values({
      id,
      ownerEmail: OWNER,
      sourceId,
      changeSetId,
      adapter: "builder-cms",
      pushMode: "autosave",
      state: execution.state,
      idempotencyKey,
      summary: "Prepared Builder write.",
      payloadJson: JSON.stringify(execution.payload ?? {}),
      attemptToken: execution.attemptToken ?? null,
      createdAt: now,
      updatedAt: now,
    });
    const claimMode = args?.claimMode ?? "canonical";
    if (
      claimMode !== "missing" &&
      (!args?.duplicateIdempotency || index === 0)
    ) {
      await db.insert(schema.contentDatabaseSourceExecutionClaims).values({
        id: `claim_${suffix}_${index}`,
        ownerEmail: OWNER,
        sourceId: claimMode === "foreign" ? `foreign_${sourceId}` : sourceId,
        idempotencyKey,
        executionId:
          claimMode === "mismatched" && index === 0 ? `foreign_${id}` : id,
        createdAt: now,
      });
    }
  }

  return {
    databaseId,
    documentId,
    sourceId,
    changeSetId,
    itemDocumentId,
  };
}

async function cancel(seeded: Awaited<ReturnType<typeof seed>>) {
  return asUser(OWNER, () =>
    cancelPrepared.run({
      documentId: seeded.documentId,
      sourceId: seeded.sourceId,
      changeSetId: seeded.changeSetId,
    }),
  );
}

async function persistedState(seeded: Awaited<ReturnType<typeof seed>>) {
  const [changeSet] = await getDb()
    .select()
    .from(schema.contentDatabaseSourceChangeSets)
    .where(eq(schema.contentDatabaseSourceChangeSets.id, seeded.changeSetId));
  const executions = await getDb()
    .select()
    .from(schema.contentDatabaseSourceExecutions)
    .where(
      and(
        eq(schema.contentDatabaseSourceExecutions.sourceId, seeded.sourceId),
        eq(
          schema.contentDatabaseSourceExecutions.changeSetId,
          seeded.changeSetId,
        ),
      ),
    );
  const reviews = await getDb()
    .select()
    .from(schema.contentDatabaseSourceChangeReviews)
    .where(
      eq(
        schema.contentDatabaseSourceChangeReviews.changeSetId,
        seeded.changeSetId,
      ),
    );
  const claims = await getDb()
    .select()
    .from(schema.contentDatabaseSourceExecutionClaims)
    .where(
      inArray(
        schema.contentDatabaseSourceExecutionClaims.executionId,
        executions.map((execution: any) => execution.id),
      ),
    );
  return { changeSet, executions, reviews, claims };
}

describe("cancel-prepared-builder-source-update", () => {
  it.each([
    ["ready", { dryRun: { status: "validated" } }],
    ["write_disabled", { dryRun: { status: "blocked" } }],
    ["blocked", { dryRun: { status: "blocked" } }],
  ])(
    "atomically cancels an eligible %s execution with its canonical claim",
    async (state, payload) => {
      const seeded = await seed({ executions: [{ state, payload }] });

      const response = await cancel(seeded);
      const persisted = await persistedState(seeded);

      expect(response.cancellation).toMatchObject({
        sourceId: seeded.sourceId,
        changeSetId: seeded.changeSetId,
        status: "cancelled",
        cancelledBy: OWNER,
      });
      expect(persisted.changeSet.state).toBe("rejected");
      expect(persisted.executions).toHaveLength(1);
      expect(persisted.executions[0]).toMatchObject({
        state: "blocked",
        summary: "Cancelled before Builder dispatch.",
        lastError: null,
      });
      expect(persisted.reviews).toHaveLength(1);
      expect(persisted.reviews[0]).toMatchObject({
        reviewerEmail: OWNER,
        decision: "rejected",
        stateFrom: "approved",
        stateTo: "rejected",
      });
      expect(persisted.reviews[0].note).toContain(OWNER);
      expect(persisted.reviews[0].note).toContain("2026-");
      expect(persisted.claims).toHaveLength(1);
    },
  );

  it.each([
    ["running", {}, "running"],
    ["response_received", { response: { status: 200 } }, "response_received"],
    ["reconciliation_required", {}, "reconciliation_required"],
    ["succeeded", { response: { status: 200 } }, "succeeded"],
    ["failed", { dispatch: { startedAt: "now" } }, "failed"],
  ])("fails closed for %s and preserves state", async (state, payload) => {
    const seeded = await seed({
      executions: [
        {
          state,
          payload,
          attemptToken: state === "failed" ? "attempt-token" : null,
        },
      ],
    });

    await expect(cancel(seeded)).rejects.toThrow(/Cannot cancel/);
    const persisted = await persistedState(seeded);
    expect(persisted.changeSet.state).toBe("approved");
    expect(persisted.executions[0].state).toBe(state);
    expect(persisted.reviews).toHaveLength(0);
  });

  it("fails closed for response evidence even when state says ready", async () => {
    const seeded = await seed({
      executions: [
        {
          state: "ready",
          payload: { response: { status: 200 } },
        },
      ],
    });
    await expect(cancel(seeded)).rejects.toThrow(/response evidence/);
    expect((await persistedState(seeded)).changeSet.state).toBe("approved");
  });

  it.each(["missing", "mismatched", "foreign"] as const)(
    "fails closed for a %s canonical claim relationship",
    async (claimMode) => {
      const seeded = await seed({ claimMode });
      await expect(cancel(seeded)).rejects.toThrow(/claim/);
      expect((await persistedState(seeded)).changeSet.state).toBe("approved");
    },
  );

  it("fails closed for duplicate execution gates sharing an idempotency key", async () => {
    const seeded = await seed({
      duplicateIdempotency: true,
      executions: [
        { state: "ready", payload: { dryRun: { status: "validated" } } },
        { state: "ready", payload: { dryRun: { status: "validated" } } },
      ],
    });
    await expect(cancel(seeded)).rejects.toThrow(/duplicate execution gates/);
    expect((await persistedState(seeded)).changeSet.state).toBe("approved");
  });

  it("fails atomically for mixed eligible and running executions", async () => {
    const seeded = await seed({
      executions: [
        { state: "ready", payload: { dryRun: { status: "validated" } } },
        { state: "running", payload: {} },
      ],
    });
    await expect(cancel(seeded)).rejects.toThrow(/state running/);
    const persisted = await persistedState(seeded);
    expect(persisted.changeSet.state).toBe("approved");
    expect(persisted.executions.map((row: any) => row.state)).toEqual([
      "ready",
      "running",
    ]);
    expect(persisted.reviews).toHaveLength(0);
  });

  it("requires editor access and an exact Builder source", async () => {
    const seeded = await seed();
    await expect(
      asUser("outsider@example.com", () =>
        cancelPrepared.run({
          documentId: seeded.documentId,
          sourceId: seeded.sourceId,
          changeSetId: seeded.changeSetId,
        }),
      ),
    ).rejects.toThrow();

    const nonBuilder = await seed({ sourceType: "local-table" });
    await expect(cancel(nonBuilder)).rejects.toThrow(/exact Builder source/);

    await expect(
      asUser(OWNER, () =>
        cancelPrepared.run({
          documentId: seeded.documentId,
          sourceId: seeded.sourceId,
          changeSetId: nonBuilder.changeSetId,
        }),
      ),
    ).rejects.toThrow(/change-set not found/);
  });

  it("is idempotent after a successful cancellation", async () => {
    const seeded = await seed();
    const first = await cancel(seeded);
    const second = await cancel(seeded);
    const persisted = await persistedState(seeded);

    expect(first.cancellation.status).toBe("cancelled");
    expect(second.cancellation.status).toBe("already_cancelled");
    expect(persisted.reviews).toHaveLength(1);
    expect(persisted.changeSet.state).toBe("rejected");
    expect(persisted.claims).toHaveLength(1);
  });

  it("suppresses only the identical cancelled diff and resurfaces local or remote changes", async () => {
    const seeded = await seed({
      titleDiff: { remote: "Remote title", local: "Local title" },
    });
    await cancel(seeded);

    const exactSnapshot = await getWriteSnapshot(
      {
        id: seeded.databaseId,
        documentId: seeded.documentId,
      } as any,
      seeded.sourceId,
    );
    expect(
      exactSnapshot?.changeSets.filter(
        (changeSet) => changeSet.state === "pending_push",
      ),
    ).toEqual([]);

    await getDb()
      .update(schema.documents)
      .set({ title: "Changed local title" })
      .where(eq(schema.documents.id, seeded.itemDocumentId));
    const localChanged = await getWriteSnapshot(
      {
        id: seeded.databaseId,
        documentId: seeded.documentId,
      } as any,
      seeded.sourceId,
    );
    expect(
      localChanged?.changeSets.find(
        (changeSet) => changeSet.state === "pending_push",
      )?.fieldChanges,
    ).toMatchObject([{ proposedValue: "Changed local title" }]);

    await getDb()
      .update(schema.documents)
      .set({ title: "Local title" })
      .where(eq(schema.documents.id, seeded.itemDocumentId));
    await getDb()
      .update(schema.contentDatabaseSourceRows)
      .set({
        sourceDisplayKey: "Changed remote title",
        sourceValuesJson: JSON.stringify({
          "data.title": "Changed remote title",
        }),
      })
      .where(eq(schema.contentDatabaseSourceRows.sourceId, seeded.sourceId));
    const remoteChanged = await getWriteSnapshot(
      {
        id: seeded.databaseId,
        documentId: seeded.documentId,
      } as any,
      seeded.sourceId,
    );
    expect(
      remoteChanged?.changeSets.find(
        (changeSet) => changeSet.state === "pending_push",
      )?.fieldChanges,
    ).toMatchObject([{ currentValue: "Changed remote title" }]);
  });

  it("preserves a cancelled synthetic diff and prepares a materially changed revision under a new deterministic identity", async () => {
    const seeded = await seed({
      titleDiff: { remote: "Remote title", local: "Local title" },
      syntheticChangeSetId: true,
    });
    await cancel(seeded);

    const exactSnapshot = await getWriteSnapshot(
      {
        id: seeded.databaseId,
        documentId: seeded.documentId,
      } as any,
      seeded.sourceId,
    );
    expect(
      exactSnapshot?.changeSets.filter(
        (changeSet) => changeSet.state === "pending_push",
      ),
    ).toEqual([]);

    await getDb()
      .update(schema.documents)
      .set({ title: "Changed local title" })
      .where(eq(schema.documents.id, seeded.itemDocumentId));
    const changedSnapshot = await getWriteSnapshot(
      {
        id: seeded.databaseId,
        documentId: seeded.documentId,
      } as any,
      seeded.sourceId,
    );
    const changed = changedSnapshot?.changeSets.find(
      (changeSet) => changeSet.state === "pending_push",
    );
    expect(changed).toMatchObject({
      id: seeded.changeSetId,
      fieldChanges: [{ proposedValue: "Changed local title" }],
    });

    const prepared = await asUser(OWNER, () =>
      prepareReview.run({
        documentId: seeded.documentId,
        sourceId: seeded.sourceId,
        changeSetIds: [seeded.changeSetId],
        pushModeConfirmation: "autosave",
      }),
    );
    const revisionId = prepared.review.rows[0]?.changeSetId;
    expect(revisionId).toMatch(
      new RegExp(`^${seeded.changeSetId}-revision-[a-f0-9]{16}$`),
    );
    expect(prepared.preparedChangeSetMappings).toEqual([
      {
        requestedChangeSetId: seeded.changeSetId,
        preparedChangeSetId: revisionId,
      },
    ]);

    const persistedChangeSets = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        eq(schema.contentDatabaseSourceChangeSets.sourceId, seeded.sourceId),
      );
    const cancelled = persistedChangeSets.find(
      (changeSet: any) => changeSet.id === seeded.changeSetId,
    );
    const revision = persistedChangeSets.find(
      (changeSet: any) => changeSet.id === revisionId,
    );
    expect(cancelled).toMatchObject({ state: "rejected" });
    expect(JSON.parse(cancelled.fieldChangesJson)).toMatchObject([
      { proposedValue: "Local title" },
    ]);
    expect(revision).toMatchObject({ state: "approved" });
    expect(JSON.parse(revision.fieldChangesJson)).toMatchObject([
      { proposedValue: "Changed local title" },
    ]);

    const [execution] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        eq(schema.contentDatabaseSourceExecutions.changeSetId, revisionId),
      );
    expect(execution).toBeTruthy();
    expect(JSON.parse(execution.payloadJson).changeSetId).toBe(revisionId);
  });
});
