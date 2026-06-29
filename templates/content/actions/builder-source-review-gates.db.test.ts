import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api";

const TEST_DB_PATH = join(
  tmpdir(),
  `builder-source-review-gates-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.com";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let prepareReview: typeof import("./prepare-builder-source-review.js").default;
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
    sourceRowId: `entry_${suffix}`,
    sourceQualifiedId: `builder://${args.sourceTable}/entry_${suffix}`,
    sourceDisplayKey: "Old title",
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
    createdAt: now,
    updatedAt: now,
  });

  return {
    databaseId,
    databaseDocumentId,
    sourceId,
    changeSetId,
  };
}

describe("Builder source review execution gates", () => {
  it("returns gate-mutated blocked status from prepare review", async () => {
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
    expect(response.review.result.message).toContain("needs attention");
    expect(response.review.rows[0]?.execution?.state).toBe("blocked");
    expect(response.review.rows[0]?.execution?.lastError).toContain(
      `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
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
});
