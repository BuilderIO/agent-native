import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api";

const TEST_DB_PATH = join(
  tmpdir(),
  `builder-source-review-gates-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.com";

const heavySnapshotReads = vi.hoisted(() => ({
  target: 0,
  allSources: 0,
  omitTargetRows: false,
}));
vi.mock("./_database-source-utils.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./_database-source-utils.js")>();
  return {
    ...original,
    getContentDatabaseSourceSnapshotForWrite: async (
      ...args: Parameters<
        typeof original.getContentDatabaseSourceSnapshotForWrite
      >
    ) => {
      heavySnapshotReads.target += 1;
      const snapshot = await original.getContentDatabaseSourceSnapshotForWrite(
        ...args,
      );
      return snapshot && heavySnapshotReads.omitTargetRows
        ? { ...snapshot, rows: [] }
        : snapshot;
    },
    getAllContentDatabaseSourceSnapshots: async (
      ...args: Parameters<typeof original.getAllContentDatabaseSourceSnapshots>
    ) => {
      heavySnapshotReads.allSources += 1;
      return original.getAllContentDatabaseSourceSnapshots(...args);
    },
  };
});

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let prepareReview: typeof import("./prepare-builder-source-review.js").default;
let previewReview: typeof import("./preview-builder-source-review.js").default;
let prepareExecution: typeof import("./prepare-builder-source-execution.js").default;
let validateExecution: typeof import("./validate-builder-source-execution.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  prepareReview = (await import("./prepare-builder-source-review.js")).default;
  previewReview = (await import("./preview-builder-source-review.js")).default;
  prepareExecution = (await import("./prepare-builder-source-execution.js"))
    .default;
  validateExecution = (await import("./validate-builder-source-execution.js"))
    .default;
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

function capabilities(liveWritesEnabled: boolean) {
  return JSON.stringify({
    canRefresh: true,
    canCreateChangeSets: true,
    canWriteFields: true,
    canWriteBody: true,
    canPush: true,
    canPull: true,
    canPublish: true,
    canDelete: false,
    canStageLocalRevision: true,
    liveWritesEnabled,
    readOnlyRefresh: true,
  });
}

async function seedBuilderSource(args: {
  sourceTable: string;
  sourceId?: string;
  changeSetState?: "pending_push" | "approved";
  metadata?: Record<string, unknown>;
  unmatched?: boolean;
  bodyChange?: Record<string, unknown>;
}) {
  const db = getDb();
  const now = "2026-06-29T15:00:00.000Z";
  const suffix = `${++counter}_${Math.random().toString(36).slice(2, 7)}`;
  const databaseId = `db_${suffix}`;
  const databaseDocumentId = `doc_db_${suffix}`;
  const itemId = `item_${suffix}`;
  const rowDocumentId = `doc_row_${suffix}`;
  const sourceId = args.sourceId ?? `src_${suffix}`;
  const changeSetId = `change_${suffix}`;

  await db.insert(schema.documents).values([
    {
      id: databaseDocumentId,
      ownerEmail: OWNER,
      title: "Builder review DB",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: rowDocumentId,
      ownerEmail: OWNER,
      title: "Old title",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: "Builder review DB",
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
    sourceName: "Builder CMS",
    sourceTable: args.sourceTable,
    capabilitiesJson: capabilities(true),
    metadataJson: JSON.stringify({
      primaryKey: "id",
      titleField: "title",
      writeMode: "stage_only",
      pushMode: "autosave",
      ...args.metadata,
    }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceRows).values({
    id: `row_${suffix}`,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId: rowDocumentId,
    sourceRowId: args.unmatched
      ? `builder-${rowDocumentId}`
      : `entry_${suffix}`,
    sourceQualifiedId: args.unmatched
      ? `builder-cms://${args.sourceTable}/builder-${rowDocumentId}`
      : `builder://${args.sourceTable}/entry_${suffix}`,
    sourceDisplayKey: "Old title",
    provenance: args.unmatched ? "Builder CMS fixture adapter" : "source",
    sourceValuesJson: JSON.stringify({ "data.title": "Old title" }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceChangeSets).values({
    id: changeSetId,
    ownerEmail: OWNER,
    sourceId,
    databaseItemId: itemId,
    documentId: rowDocumentId,
    kind: "field_update",
    direction: "outbound",
    state: args.changeSetState ?? "pending_push",
    pushMode:
      args.metadata?.writeMode === "publish_updates" ? "publish" : "autosave",
    localOnly: 1,
    summary: "Pending local Builder CMS title change.",
    fieldChangesJson: JSON.stringify([
      {
        propertyId: null,
        propertyName: "Title",
        localFieldKey: "title",
        sourceFieldKey: "data.title",
        currentValue: "Old title",
        proposedValue: "New title",
      },
    ]),
    bodyChangeJson: args.bodyChange ? JSON.stringify(args.bodyChange) : null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    databaseId,
    databaseDocumentId,
    rowDocumentId,
    sourceId,
    changeSetId,
  };
}

describe("Builder source review execution gates", () => {
  it("restores authoritative Builder targets in selected read-only previews", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
    });
    heavySnapshotReads.omitTargetRows = true;
    try {
      const response = await asOwner(() =>
        previewReview.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          scope: "selected",
          documentIds: [seeded.rowDocumentId],
        }),
      );
      expect(response.review?.rows).toMatchObject([
        {
          changeSetId: seeded.changeSetId,
          targetEntryId: expect.stringMatching(/^entry_/),
          effect: "autosave",
        },
      ]);
    } finally {
      heavySnapshotReads.omitTargetRows = false;
    }
  });

  it("restores a linked Builder target from authoritative row identity when the snapshot window omits it", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
    });
    heavySnapshotReads.omitTargetRows = true;
    try {
      const response = await asOwner(() =>
        prepareReview.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          changeSetIds: [seeded.changeSetId],
          pushModeConfirmation: "autosave",
        }),
      );
      expect(response.review.rows).toMatchObject([
        {
          changeSetId: seeded.changeSetId,
          targetEntryId: expect.stringMatching(/^entry_/),
          effect: "autosave",
        },
      ]);
      const [execution] = await getDb()
        .select()
        .from(schema.contentDatabaseSourceExecutions)
        .where(
          eq(
            schema.contentDatabaseSourceExecutions.changeSetId,
            seeded.changeSetId,
          ),
        );
      expect(JSON.parse(execution.payloadJson).target).toMatchObject({
        entryId: expect.stringMatching(/^entry_/),
        documentId: expect.stringMatching(/^doc_row_/),
      });
      expect(JSON.parse(execution.payloadJson).request.method).toBe("PATCH");
    } finally {
      heavySnapshotReads.omitTargetRows = false;
    }
  });

  it("refreshes a previously approved body only from a provably unsent blocked dry run", async () => {
    const staleBody = {
      summary: "Old blocked body",
      currentExcerpt: "",
      proposedExcerpt: "Old",
      currentHash: null,
      proposedHash: "old-hash",
      proposedContent: "<empty-block />",
      proposedBlocksJson: "[]",
      sidecarsJson: "{}",
      warnings: ["Unsupported Builder MDX component: <empty-block>"],
    };
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      changeSetState: "approved",
      unmatched: true,
      bodyChange: staleBody,
    });
    const db = getDb();
    const now = "2026-07-13T20:00:00.000Z";
    const executionId = `blocked-refresh-${counter}`;
    const idempotencyKey = `builder-cms:${seeded.sourceId}:${seeded.changeSetId}:autosave`;
    const [changeSet] = await db
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, seeded.changeSetId));
    await db
      .update(schema.documents)
      .set({ content: "Fresh body after the converter fix.", updatedAt: now })
      .where(eq(schema.documents.id, changeSet.documentId));
    await db.insert(schema.contentDatabaseSourceExecutions).values({
      id: executionId,
      ownerEmail: OWNER,
      sourceId: seeded.sourceId,
      changeSetId: seeded.changeSetId,
      adapter: "builder-cms",
      pushMode: "autosave",
      state: "blocked",
      idempotencyKey,
      summary: "Dry run validated blockers locally.",
      payloadJson: JSON.stringify({
        request: { method: "POST" },
        dryRun: { status: "blocked" },
      }),
      attemptToken: null,
      lastError: "Unsupported Builder MDX component: <empty-block>",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceExecutionClaims).values({
      id: `claim-${executionId}`,
      ownerEmail: OWNER,
      sourceId: seeded.sourceId,
      idempotencyKey,
      executionId,
      createdAt: now,
    });

    const response = await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetIds: [seeded.changeSetId],
        pushModeConfirmation: "autosave",
      }),
    );

    const [persisted] = await db
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, seeded.changeSetId));
    const [refreshedExecution] = await db
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(eq(schema.contentDatabaseSourceExecutions.id, executionId));
    const body = JSON.parse(persisted.bodyChangeJson);
    const payload = JSON.parse(refreshedExecution.payloadJson);

    expect(persisted.id).toBe(seeded.changeSetId);
    expect(body.proposedContent).toBe("Fresh body after the converter fix.");
    expect(body.warnings).toEqual([]);
    expect(payload.request.body.data.blocks).toEqual(
      JSON.parse(body.proposedBlocksJson),
    );
    expect(payload.dryRun.status).toBe("validated");
    expect(response.review.rows[0]?.changeSetId).toBe(seeded.changeSetId);
    expect(response.review.rows[0]?.bodyChange).toEqual(body);
  });

  it("freezes an approved body after a failed dispatched attempt", async () => {
    const staleBody = {
      summary: "Approved body evidence",
      currentExcerpt: "",
      proposedExcerpt: "Approved",
      currentHash: null,
      proposedHash: "approved-hash",
      proposedContent: "Approved body evidence.",
      proposedBlocksJson: "[]",
      sidecarsJson: "{}",
      warnings: [],
    };
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      changeSetState: "approved",
      unmatched: true,
      bodyChange: staleBody,
    });
    const db = getDb();
    const now = "2026-07-13T20:05:00.000Z";
    const executionId = `failed-freeze-${counter}`;
    const idempotencyKey = `builder-cms:${seeded.sourceId}:${seeded.changeSetId}:autosave`;
    const [changeSet] = await db
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, seeded.changeSetId));
    await db
      .update(schema.documents)
      .set({
        content: "A newer local body must not replace evidence.",
        updatedAt: now,
      })
      .where(eq(schema.documents.id, changeSet.documentId));
    const failedPayload = {
      request: { method: "POST" },
      dryRun: { status: "validated" },
      dispatch: { startedAt: now },
    };
    await db.insert(schema.contentDatabaseSourceExecutions).values({
      id: executionId,
      ownerEmail: OWNER,
      sourceId: seeded.sourceId,
      changeSetId: seeded.changeSetId,
      adapter: "builder-cms",
      pushMode: "autosave",
      state: "failed",
      idempotencyKey,
      summary: "Builder request failed after dispatch.",
      payloadJson: JSON.stringify(failedPayload),
      attemptToken: "attempt-after-dispatch",
      lastError: "Remote outcome requires reconciliation.",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceExecutionClaims).values({
      id: `claim-${executionId}`,
      ownerEmail: OWNER,
      sourceId: seeded.sourceId,
      idempotencyKey,
      executionId,
      createdAt: now,
    });

    const response = await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetIds: [seeded.changeSetId],
        pushModeConfirmation: "autosave",
      }),
    );

    const [persisted] = await db
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, seeded.changeSetId));
    const [preservedExecution] = await db
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(eq(schema.contentDatabaseSourceExecutions.id, executionId));

    expect(JSON.parse(persisted.bodyChangeJson)).toEqual(staleBody);
    expect(JSON.parse(preservedExecution.payloadJson)).toEqual(failedPayload);
    expect(preservedExecution.state).toBe("failed");
    expect(preservedExecution.attemptToken).toBe("attempt-after-dispatch");
    expect(response.review.rows[0]?.bodyChange).toEqual(staleBody);
  });

  it("builds the persisted gate from the exact approved selection with two heavy snapshots", async () => {
    const bodyChange = {
      summary: "Body changed",
      currentExcerpt: "Old",
      proposedExcerpt: "New",
      currentHash: "old-hash",
      proposedHash: "new-hash",
      proposedContent: "New",
      proposedBlocksJson: JSON.stringify([
        {
          "@type": "@builder.io/sdk:Element",
          component: { name: "Text", options: { text: "New" } },
        },
      ]),
      sidecarsJson: "{}",
      warnings: [],
    };
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      bodyChange,
    });
    heavySnapshotReads.target = 0;
    heavySnapshotReads.allSources = 0;

    const response = await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetIds: [seeded.changeSetId],
        pushModeConfirmation: "autosave",
      }),
    );

    const [persistedChangeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, seeded.changeSetId));
    const [execution] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        eq(
          schema.contentDatabaseSourceExecutions.changeSetId,
          seeded.changeSetId,
        ),
      );
    const persistedFields = JSON.parse(persistedChangeSet.fieldChangesJson);
    const persistedBody = JSON.parse(persistedChangeSet.bodyChangeJson);
    const executionPayload = JSON.parse(execution.payloadJson);

    expect(heavySnapshotReads).toMatchObject({ target: 2, allSources: 1 });
    expect(persistedChangeSet.state).toBe("approved");
    expect(response.review.rows[0]?.fieldChanges).toEqual(persistedFields);
    expect(response.review.rows[0]?.bodyChange).toEqual(persistedBody);
    expect(executionPayload.operations).toEqual(
      persistedFields.map((field: Record<string, unknown>) => ({
        sourceFieldKey: field.sourceFieldKey,
        localFieldKey: field.localFieldKey,
        value: field.proposedValue,
      })),
    );
    expect(executionPayload.request.body.data.blocks).toEqual(
      JSON.parse(bodyChange.proposedBlocksJson),
    );
    expect(executionPayload.dryRun.status).toBe("validated");
  });

  it("keeps an exact synthetic create selection scoped among unrelated changes", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
    });
    const db = getDb();
    const now = "2026-07-13T19:00:00.000Z";
    const localItemId = `local-item-${counter}`;
    const localDocumentId = `local-document-${counter}`;
    const syntheticChangeSetId = `local-pending-create-${localItemId}`;

    await db.insert(schema.documents).values({
      id: localDocumentId,
      ownerEmail: OWNER,
      title: "Quiet Comet",
      content: "A rich local article.",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: localItemId,
      ownerEmail: OWNER,
      databaseId: seeded.databaseId,
      documentId: localDocumentId,
      position: 1,
      createdAt: now,
      updatedAt: now,
    });

    const prepared = await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetIds: [syntheticChangeSetId],
        pushModeConfirmation: "autosave",
      }),
    );

    expect(prepared.review.rows).toHaveLength(1);
    expect(prepared.review.rows[0]).toMatchObject({
      changeSetId: syntheticChangeSetId,
      documentId: localDocumentId,
      effect: "create_draft",
    });
    expect(prepared.review.totalRowCount).toBe(1);
    expect(prepared.review.preparedRowLimit).toBe(1);

    const [persisted] = await db
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        eq(schema.contentDatabaseSourceChangeSets.id, syntheticChangeSetId),
      );
    expect(persisted).toMatchObject({
      sourceId: seeded.sourceId,
      documentId: localDocumentId,
      state: "approved",
    });
  });

  it("returns gate-mutated blocked status for a production model", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: "blog_article",
    });

    const response = await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
      }),
    );

    expect(response.review.result.status).toBe("blocked");
    expect(response.review.rows[0]?.execution?.state).toBe("blocked");
    expect(response.review.rows[0]?.execution?.lastError).toContain(
      BUILDER_CMS_SAFE_WRITE_MODEL,
    );
  });

  it("validates publication-transition gates with the same transition intent", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      changeSetState: "approved",
      metadata: {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowPublicationTransitions: true,
        allowedWriteModes: ["autosave", "publish"],
      },
    });
    const idempotencyKey = `builder-cms:${seeded.sourceId}:${seeded.changeSetId}:publish`;

    await asOwner(() =>
      prepareExecution.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetId: seeded.changeSetId,
        pushModeConfirmation: "publish",
        publicationTransition: "publish",
      }),
    );
    await asOwner(() =>
      validateExecution.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetId: seeded.changeSetId,
        idempotencyKey,
        pushModeConfirmation: "publish",
        publicationTransition: "publish",
      }),
    );

    const [execution] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        eq(
          schema.contentDatabaseSourceExecutions.idempotencyKey,
          idempotencyKey,
        ),
      );
    const payload = JSON.parse(execution.payloadJson);

    expect(execution.state).toBe("ready");
    expect(execution.lastError).toBeNull();
    expect(payload.effect).toBe("publish");
    expect(payload.dryRun.status).toBe("validated");
  });

  it("prepares a publish-key gate that still creates a draft for an unmatched row", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      unmatched: true,
      metadata: {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowPublicationTransitions: true,
        allowedWriteModes: ["autosave", "publish"],
      },
    });

    const response = await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetIds: [seeded.changeSetId],
        pushModeConfirmation: "publish",
        transitions: {},
      }),
    );

    expect(response.review.rows).toHaveLength(1);
    expect(response.review.rows[0]).toMatchObject({
      changeSetId: seeded.changeSetId,
      effect: "create_draft",
      execution: {
        idempotencyKey: `builder-cms:${seeded.sourceId}:${seeded.changeSetId}:publish`,
        state: "ready",
        payload: {
          effect: "create_draft",
          request: {
            method: "POST",
            body: { published: "draft" },
          },
        },
      },
    });
  });

  it("rejects a transition for a change-set outside the requested selection", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      metadata: {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowPublicationTransitions: true,
        allowedWriteModes: ["autosave", "publish"],
      },
    });

    await expect(
      asOwner(() =>
        prepareReview.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          changeSetIds: [seeded.changeSetId],
          pushModeConfirmation: "publish",
          transitions: {
            "foreign-change-set": { publicationTransition: "publish" },
          },
        }),
      ),
    ).rejects.toThrow("does not belong to the requested Builder selection");

    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, seeded.changeSetId));
    expect(changeSet.state).toBe("pending_push");
  });

  it("rejects transition keys when no explicit change-set selection is supplied", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      metadata: {
        writeMode: "publish_updates",
        pushMode: "publish",
        allowPublicationTransitions: true,
        allowedWriteModes: ["autosave", "publish"],
      },
    });

    await expect(
      asOwner(() =>
        prepareReview.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          pushModeConfirmation: "publish",
          transitions: {
            [seeded.changeSetId]: { publicationTransition: "publish" },
          },
        }),
      ),
    ).rejects.toThrow("does not belong to the requested Builder selection");

    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, seeded.changeSetId));
    expect(changeSet.state).toBe("pending_push");
  });

  it("preserves running and response-bearing execution evidence on prepare", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      changeSetState: "approved",
    });
    await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetIds: [seeded.changeSetId],
        pushModeConfirmation: "autosave",
      }),
    );
    const [execution] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        eq(schema.contentDatabaseSourceExecutions.sourceId, seeded.sourceId),
      );
    const evidence = {
      preserved: true,
      response: { ok: true, status: 201, entryId: "remote-proof" },
    };
    await getDb()
      .update(schema.contentDatabaseSourceExecutions)
      .set({ state: "running", payloadJson: JSON.stringify(evidence) })
      .where(eq(schema.contentDatabaseSourceExecutions.id, execution.id));

    await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetIds: [seeded.changeSetId],
        pushModeConfirmation: "autosave",
      }),
    );
    const [preserved] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(eq(schema.contentDatabaseSourceExecutions.id, execution.id));
    expect(preserved.state).toBe("running");
    expect(JSON.parse(preserved.payloadJson)).toEqual(evidence);
  });

  it("reuses one execution row across concurrent prepare calls", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      changeSetState: "approved",
    });
    const prepare = () =>
      asOwner(() =>
        prepareExecution.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          changeSetId: seeded.changeSetId,
          pushModeConfirmation: "autosave",
        }),
      );

    await Promise.all([prepare(), prepare()]);
    const executions = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        eq(schema.contentDatabaseSourceExecutions.sourceId, seeded.sourceId),
      );
    expect(executions).toHaveLength(1);
    const claims = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutionClaims)
      .where(
        eq(
          schema.contentDatabaseSourceExecutionClaims.sourceId,
          seeded.sourceId,
        ),
      );
    expect(claims).toHaveLength(1);
    expect(claims[0]?.executionId).toBe(executions[0]?.id);
  });

  it("preserves legacy duplicate gates and blocks their canonical claim", async () => {
    const seeded = await seedBuilderSource({
      sourceTable: BUILDER_CMS_SAFE_WRITE_MODEL,
      changeSetState: "approved",
    });
    const now = "2026-07-13T18:00:00.000Z";
    const idempotencyKey = `builder-cms:${seeded.sourceId}:${seeded.changeSetId}:autosave`;
    await getDb()
      .insert(schema.contentDatabaseSourceExecutions)
      .values([
        {
          id: `duplicate-a-${counter}`,
          ownerEmail: OWNER,
          sourceId: seeded.sourceId,
          changeSetId: seeded.changeSetId,
          adapter: "builder-cms",
          pushMode: "autosave",
          state: "ready",
          idempotencyKey,
          summary: "First legacy gate",
          payloadJson: "{}",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: `duplicate-b-${counter}`,
          ownerEmail: OWNER,
          sourceId: seeded.sourceId,
          changeSetId: seeded.changeSetId,
          adapter: "builder-cms",
          pushMode: "autosave",
          state: "running",
          idempotencyKey,
          summary: "Second legacy gate",
          payloadJson: "{}",
          createdAt: now,
          updatedAt: now,
        },
      ]);

    await asOwner(() =>
      prepareExecution.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetId: seeded.changeSetId,
        pushModeConfirmation: "autosave",
      }),
    );

    const executions = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        eq(schema.contentDatabaseSourceExecutions.sourceId, seeded.sourceId),
      );
    const claims = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutionClaims)
      .where(
        eq(
          schema.contentDatabaseSourceExecutionClaims.sourceId,
          seeded.sourceId,
        ),
      );
    expect(executions).toHaveLength(2);
    expect(claims).toHaveLength(1);
    expect(
      executions.find((execution) => execution.id === claims[0]?.executionId),
    ).toMatchObject({ state: "reconciliation_required" });
  });
});
