import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BUILDER_CMS_FIXTURE_ROW_PROVENANCE } from "./_builder-cms-source-adapter";
import {
  BUILDER_CMS_EDIT_CONFLICTS_KEY,
  BUILDER_CMS_TITLE_CONFLICT_KEY,
} from "./_builder-cms-unpublished-changes";
import { registerMemoryPrivateBlobProvider } from "./_builder-private-blob.test-fixture";

const snapshotRead = vi.hoisted(() => ({
  after: null as null | (() => Promise<void>),
}));

vi.mock("./_database-source-utils.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_database-source-utils.js")>();
  return {
    ...actual,
    async getContentDatabaseSourceSnapshotForWrite(
      ...args: Parameters<
        typeof actual.getContentDatabaseSourceSnapshotForWrite
      >
    ) {
      const snapshot = await actual.getContentDatabaseSourceSnapshotForWrite(
        ...args,
      );
      const after = snapshotRead.after;
      snapshotRead.after = null;
      await after?.();
      return snapshot;
    },
  };
});

const membershipLock = vi.hoisted(() => ({
  beforeNextLock: null as null | (() => Promise<void>),
}));

vi.mock("./_database-membership-lock.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_database-membership-lock.js")>();
  return {
    ...actual,
    async lockDatabaseMemberships(tx: any, itemIds: string[]) {
      const beforeLock = membershipLock.beforeNextLock;
      membershipLock.beforeNextLock = null;
      await beforeLock?.();
      return actual.lockDatabaseMemberships(tx, itemIds);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `stage-builder-source-bulk-update-${process.pid}-${Date.now()}.pglite`,
);

const OWNER = "owner@example.com";
const privateBlobs = registerMemoryPrivateBlobProvider();

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let stageBulkUpdate: typeof import("./stage-builder-source-bulk-update.js").default;
let prepareReview: typeof import("./prepare-builder-source-review.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  stageBulkUpdate = (await import("./stage-builder-source-bulk-update.js"))
    .default;
  prepareReview = (await import("./prepare-builder-source-review.js")).default;
}, 60000);

afterAll(() => {
  privateBlobs.unregister();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, fn);
}

function capabilities(args: { liveWritesEnabled?: boolean } = {}) {
  return JSON.stringify({
    canRefresh: true,
    canCreateChangeSets: true,
    canWriteFields: true,
    canWriteBody: true,
    canPush: true,
    canPull: true,
    canPublish: false,
    canDelete: false,
    canStageLocalRevision: true,
    liveWritesEnabled: args.liveWritesEnabled ?? false,
    readOnlyRefresh: true,
  });
}

async function seedBuilderDatabase(args: {
  propertyType?: string;
  sourceFieldType?: string;
  rowCount?: number;
  staleRowIndex?: number;
  existingOpenChangeIndex?: number;
  fixtureRowIndex?: number;
  liveReadConfigured?: boolean;
  liveWritesEnabled?: boolean;
  sourceFieldKey?: string;
}) {
  const db = getDb();
  const now = "2026-07-01T12:00:00.000Z";
  const suffix = nextId("bulk");
  const databaseId = `db_${suffix}`;
  const databaseDocumentId = `doc_db_${suffix}`;
  const sourceId = `src_${suffix}`;
  const propertyId = `prop_${suffix}`;
  const sourceFieldKey = args.sourceFieldKey ?? "data.audience";

  await db.insert(schema.documents).values({
    id: databaseDocumentId,
    ownerEmail: OWNER,
    title: "Builder bulk DB",
    content: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: "Builder bulk DB",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail: OWNER,
    databaseId,
    name: "Audience",
    type: args.propertyType ?? "text",
    visibility: "always_show",
    optionsJson: "{}",
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
    sourceTable: "blog_article",
    capabilitiesJson: capabilities({
      liveWritesEnabled: args.liveWritesEnabled,
    }),
    metadataJson: JSON.stringify({
      primaryKey: "id",
      titleField: "data.title",
      writeMode: "stage_only",
      pushMode: "autosave",
      liveReadConfigured: args.liveReadConfigured,
    }),
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseSourceFields).values({
    id: `field_${suffix}`,
    ownerEmail: OWNER,
    sourceId,
    propertyId,
    localFieldKey: propertyId,
    sourceFieldKey,
    sourceFieldLabel: "Audience",
    sourceFieldType: args.sourceFieldType ?? "string",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 0,
    provenance: "source",
    freshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });

  const rows = [];
  const rowCount = args.rowCount ?? 2;
  for (let index = 0; index < rowCount; index += 1) {
    const documentId = `doc_row_${suffix}_${index}`;
    const itemId = `item_${suffix}_${index}`;
    await db.insert(schema.documents).values({
      id: documentId,
      ownerEmail: OWNER,
      parentId: databaseDocumentId,
      title: `Article ${index + 1}`,
      content: "",
      position: index,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: OWNER,
      databaseId,
      documentId,
      position: index,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: `source_row_${suffix}_${index}`,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: itemId,
      documentId,
      sourceRowId: `entry_${suffix}_${index}`,
      sourceQualifiedId: `builder://blog_article/entry_${suffix}_${index}`,
      sourceDisplayKey: `Article ${index + 1}`,
      sourceValuesJson: JSON.stringify({
        "data.title": `Article ${index + 1}`,
        [sourceFieldKey]: index === 1 ? "Founders" : "Developers",
      }),
      provenance:
        args.fixtureRowIndex === index
          ? BUILDER_CMS_FIXTURE_ROW_PROVENANCE
          : "source",
      freshness: args.staleRowIndex === index ? "stale" : "fresh",
      syncState: "linked",
      lastSourceUpdatedAt:
        args.staleRowIndex === index ? "2026-07-01T12:05:00.000Z" : null,
      createdAt: now,
      updatedAt: now,
    });
    rows.push({ itemId, documentId });
  }

  if (args.existingOpenChangeIndex !== undefined) {
    const row = rows[args.existingOpenChangeIndex];
    await db.insert(schema.contentDatabaseSourceChangeSets).values({
      id: `change_${suffix}`,
      ownerEmail: OWNER,
      sourceId,
      databaseItemId: row.itemId,
      documentId: row.documentId,
      kind: "field_update",
      direction: "outbound",
      state: "pending_push",
      pushMode: "autosave",
      localOnly: 1,
      summary: "Existing pending change.",
      fieldChangesJson: JSON.stringify([
        {
          propertyId,
          propertyName: "Audience",
          localFieldKey: propertyId,
          sourceFieldKey,
          currentValue: "Developers",
          proposedValue: "Operators",
        },
      ]),
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    databaseId,
    databaseDocumentId,
    sourceId,
    propertyId,
    sourceFieldKey,
    rows,
  };
}

async function valuesFor(propertyId: string, documentIds: string[]) {
  return getDb()
    .select({
      documentId: schema.documentPropertyValues.documentId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(schema.documentPropertyValues.propertyId, propertyId),
        inArray(schema.documentPropertyValues.documentId, documentIds),
      ),
    );
}

describe("stage-builder-source-bulk-update", () => {
  it("previews selected Builder rows without writing local values", async () => {
    const seeded = await seedBuilderDatabase({});

    const response = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: "Architects" },
      }),
    );

    expect(response.dryRun).toBe(true);
    expect(response.summary).toEqual({
      total: 2,
      staged: 2,
      unchanged: 0,
      blocked: 0,
    });
    expect(response.review?.rows).toHaveLength(2);
    expect(response.review?.rows[0]?.fieldChanges[0]).toMatchObject({
      propertyId: seeded.propertyId,
      sourceFieldKey: seeded.sourceFieldKey,
      currentValue: "Developers",
      proposedValue: "Architects",
    });
    await expect(
      valuesFor(
        seeded.propertyId,
        seeded.rows.map((row) => row.documentId),
      ),
    ).resolves.toHaveLength(0);
  });

  it("stages selected Builder field updates and keeps apply on the review path", async () => {
    const seeded = await seedBuilderDatabase({});

    const response = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: "Architects" },
        dryRun: false,
      }),
    );

    expect(response.dryRun).toBe(false);
    expect(response.summary.staged).toBe(2);
    expect(response.review?.rows).toHaveLength(2);
    const stagedRowChangeSetIds = response.rows.map((row) => row.changeSetId);
    const reviewChangeSetIds =
      response.review?.rows.map((row) => row.changeSetId) ?? [];
    expect(stagedRowChangeSetIds).toEqual(reviewChangeSetIds);
    expect(
      stagedRowChangeSetIds.every(
        (id) => id && !id.startsWith("bulk-preview-"),
      ),
    ).toBe(true);
    await expect(
      valuesFor(
        seeded.propertyId,
        seeded.rows.map((row) => row.documentId),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ valueJson: JSON.stringify("Architects") }),
        expect.objectContaining({ valueJson: JSON.stringify("Architects") }),
      ]),
    );

    const prepared = await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
      }),
    );
    expect(prepared.review.rows).toHaveLength(2);
    expect(
      prepared.review.rows.map((row) => row.fieldChanges[0]?.proposedValue),
    ).toEqual(["Architects", "Architects"]);
  });

  it("prepares only requested staged Builder rows", async () => {
    const seeded = await seedBuilderDatabase({});

    const staged = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: "Architects" },
        dryRun: false,
      }),
    );
    const firstChangeSetId = staged.review?.rows[0]?.changeSetId;
    expect(firstChangeSetId).toBeTruthy();

    const prepared = await asOwner(() =>
      prepareReview.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        changeSetIds: [firstChangeSetId!],
      }),
    );

    expect(prepared.review.rows).toHaveLength(1);
    expect(prepared.review.rows[0]?.documentId).toBe(seeded.rows[0].documentId);
  });

  it("reports all requested Builder change-set IDs that are not reviewable", async () => {
    const seeded = await seedBuilderDatabase({});

    const staged = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: "Architects" },
        dryRun: false,
      }),
    );
    const firstChangeSetId = staged.review?.rows[0]?.changeSetId;
    expect(firstChangeSetId).toBeTruthy();

    await expect(
      asOwner(() =>
        prepareReview.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          changeSetIds: [
            firstChangeSetId!,
            "missing-change-set-a",
            "missing-change-set-b",
          ],
        }),
      ),
    ).rejects.toThrow(
      "Requested Builder change-set is not reviewable: missing-change-set-a, missing-change-set-b.",
    );
  });

  it("stages only changed rows when selected rows already match the value", async () => {
    const seeded = await seedBuilderDatabase({});

    const response = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: "Founders" },
        dryRun: false,
      }),
    );

    expect(response.summary).toEqual({
      total: 2,
      staged: 1,
      unchanged: 1,
      blocked: 0,
    });
    expect(response.rows[0]).toMatchObject({
      documentId: seeded.rows[0].documentId,
      status: "staged",
    });
    expect(response.rows[1]).toMatchObject({
      documentId: seeded.rows[1].documentId,
      status: "unchanged",
    });
    expect(response.review?.rows).toHaveLength(1);
    await expect(
      valuesFor(
        seeded.propertyId,
        seeded.rows.map((row) => row.documentId),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        documentId: seeded.rows[0].documentId,
        valueJson: JSON.stringify("Founders"),
      }),
    ]);
  });

  it("sets an unpushed edit back when staging the value Builder already has", async () => {
    const seeded = await seedBuilderDatabase({ existingOpenChangeIndex: 0 });
    const [row] = seeded.rows;
    const stage = (value: string, dryRun: boolean) =>
      asOwner(() =>
        stageBulkUpdate.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          itemIds: [row.itemId],
          field: { propertyId: seeded.propertyId, value },
          dryRun,
        }),
      );
    await stage("Operators", false);

    const preview = await stage("Developers", true);
    expect(preview.rows[0]).toMatchObject({
      status: "unchanged",
      message: expect.stringContaining("goes back"),
    });
    await expect(
      valuesFor(seeded.propertyId, [row.documentId]),
    ).resolves.toEqual([
      expect.objectContaining({ valueJson: JSON.stringify("Operators") }),
    ]);

    const sourceRowFilter = and(
      eq(schema.contentDatabaseSourceRows.sourceId, seeded.sourceId),
      eq(schema.contentDatabaseSourceRows.documentId, row.documentId),
    );
    const [sourceRow] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(sourceRowFilter);
    // A refresh flagged the field and the title as changed in Builder too.
    await getDb()
      .update(schema.contentDatabaseSourceRows)
      .set({
        sourceValuesJson: JSON.stringify({
          ...JSON.parse(sourceRow.sourceValuesJson),
          [BUILDER_CMS_EDIT_CONFLICTS_KEY]: [
            seeded.sourceFieldKey,
            BUILDER_CMS_TITLE_CONFLICT_KEY,
          ],
        }),
      })
      .where(sourceRowFilter);

    const response = await stage("Developers", false);
    expect(response.summary).toMatchObject({ staged: 0, unchanged: 1 });
    const [restoredRow] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(sourceRowFilter);
    expect(
      JSON.parse(restoredRow.sourceValuesJson)[BUILDER_CMS_EDIT_CONFLICTS_KEY],
    ).toEqual([BUILDER_CMS_TITLE_CONFLICT_KEY]);
    await expect(
      valuesFor(seeded.propertyId, [row.documentId]),
    ).resolves.toEqual([
      expect.objectContaining({ valueJson: JSON.stringify("Developers") }),
    ]);
    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        eq(
          schema.contentDatabaseSourceChangeSets.id,
          `change_${seeded.sourceId.slice("src_".length)}`,
        ),
      );
    expect(changeSet).toMatchObject({
      state: "rejected",
      fieldChangesJson: "[]",
    });
  });

  it("keeps the page title's change when a property on Builder's title field is set back", async () => {
    // A property named "Title" maps to Builder's title field, as the page
    // title does.
    const seeded = await seedBuilderDatabase({
      existingOpenChangeIndex: 0,
      sourceFieldKey: "data.title",
    });
    const [row] = seeded.rows;
    const changeSetFilter = eq(
      schema.contentDatabaseSourceChangeSets.id,
      `change_${seeded.sourceId.slice("src_".length)}`,
    );
    const stage = (value: string) =>
      asOwner(() =>
        stageBulkUpdate.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          itemIds: [row.itemId],
          field: { propertyId: seeded.propertyId, value },
          dryRun: false,
        }),
      );
    await stage("Operators");
    const [staged] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    const titleChange = {
      propertyId: null,
      propertyName: "Title",
      localFieldKey: "title",
      sourceFieldKey: "data.title",
      currentValue: "Developers",
      proposedValue: "My title",
    };
    await getDb()
      .update(schema.contentDatabaseSourceChangeSets)
      .set({
        fieldChangesJson: JSON.stringify([
          ...JSON.parse(staged.fieldChangesJson),
          titleChange,
        ]),
      })
      .where(changeSetFilter);

    await stage("Developers");

    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    expect(changeSet.state).toBe("pending_push");
    expect(JSON.parse(changeSet.fieldChangesJson)).toEqual([titleChange]);
  });

  it("keeps a change saved to the review item after the stage read it", async () => {
    const seeded = await seedBuilderDatabase({ existingOpenChangeIndex: 0 });
    const [row] = seeded.rows;
    const changeSetId = `change_${seeded.sourceId.slice("src_".length)}`;
    const stage = (value: string) =>
      asOwner(() =>
        stageBulkUpdate.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          itemIds: [row.itemId],
          field: { propertyId: seeded.propertyId, value },
          dryRun: false,
        }),
      );
    await stage("Operators");
    const changeSetFilter = eq(
      schema.contentDatabaseSourceChangeSets.id,
      changeSetId,
    );
    snapshotRead.after = async () => {
      const [current] = await getDb()
        .select()
        .from(schema.contentDatabaseSourceChangeSets)
        .where(changeSetFilter);
      await getDb()
        .update(schema.contentDatabaseSourceChangeSets)
        .set({
          fieldChangesJson: JSON.stringify([
            ...JSON.parse(current.fieldChangesJson),
            {
              propertyId: null,
              propertyName: "Title",
              localFieldKey: "title",
              sourceFieldKey: "data.title",
              currentValue: "Article 1",
              proposedValue: "Retitled",
            },
          ]),
        })
        .where(changeSetFilter);
    };
    try {
      await stage("Developers");
    } finally {
      snapshotRead.after = null;
    }

    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    expect(changeSet.state).toBe("pending_push");
    expect(JSON.parse(changeSet.fieldChangesJson)).toEqual([
      expect.objectContaining({
        sourceFieldKey: "data.title",
        proposedValue: "Retitled",
      }),
    ]);
  });

  it("keeps an edit when staging the other selected rows fails", async () => {
    const seeded = await seedBuilderDatabase({ existingOpenChangeIndex: 0 });
    const [editedRow, stagedRow] = seeded.rows;
    const changeSetFilter = eq(
      schema.contentDatabaseSourceChangeSets.id,
      `change_${seeded.sourceId.slice("src_".length)}`,
    );
    const stage = (itemIds: string[], value: string) =>
      asOwner(() =>
        stageBulkUpdate.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          itemIds,
          field: { propertyId: seeded.propertyId, value },
          dryRun: false,
        }),
      );
    await stage([editedRow.itemId], "Operators");
    const [before] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    const triggerName = `fail_staged_value_${counter}`;
    const functionName = `${triggerName}_fn`;
    await getDbExec().execute(
      `CREATE FUNCTION ${functionName}() RETURNS trigger
       LANGUAGE plpgsql AS $stage$
       BEGIN
         RAISE EXCEPTION 'staged write failed';
       END;
       $stage$`,
    );
    await getDbExec().execute(
      `CREATE TRIGGER ${triggerName}
       BEFORE INSERT OR UPDATE ON document_property_values
       FOR EACH ROW WHEN (NEW.document_id = '${stagedRow.documentId}')
       EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      // The edited row is set back to Builder's value; the other row stages it.
      await expect(
        stage([editedRow.itemId, stagedRow.itemId], "Developers"),
      ).rejects.toThrow(/insert into "document_property_values"/);
    } finally {
      await getDbExec().execute(
        `DROP TRIGGER IF EXISTS ${triggerName} ON document_property_values`,
      );
      await getDbExec().execute(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    await expect(
      valuesFor(seeded.propertyId, [editedRow.documentId]),
    ).resolves.toEqual([
      expect.objectContaining({ valueJson: JSON.stringify("Operators") }),
    ]);
    const [after] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    expect(after).toMatchObject({
      state: before.state,
      fieldChangesJson: before.fieldChangesJson,
    });
  });

  it("refuses to stage over a value saved in Content while the stage waited for the rows", async () => {
    const seeded = await seedBuilderDatabase({});
    const row = seeded.rows[1];
    membershipLock.beforeNextLock = () =>
      getDb()
        .insert(schema.documentPropertyValues)
        .values({
          id: `value_${row.documentId}`,
          ownerEmail: OWNER,
          documentId: row.documentId,
          propertyId: seeded.propertyId,
          valueJson: JSON.stringify("Saved meanwhile"),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
    try {
      await expect(
        asOwner(() =>
          stageBulkUpdate.run({
            documentId: seeded.databaseDocumentId,
            sourceId: seeded.sourceId,
            itemIds: [row.itemId],
            field: { propertyId: seeded.propertyId, value: "Architects" },
            dryRun: false,
          }),
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "builder_bulk_stage_rows_changed",
      });
    } finally {
      membershipLock.beforeNextLock = null;
    }

    expect(
      await valuesFor(seeded.propertyId, [row.documentId]),
    ).not.toContainEqual(
      expect.objectContaining({ valueJson: JSON.stringify("Architects") }),
    );
  });

  it("refuses to set an edit back when Builder's value changed after the stage read it", async () => {
    const seeded = await seedBuilderDatabase({ existingOpenChangeIndex: 0 });
    const [row] = seeded.rows;
    const changeSetFilter = eq(
      schema.contentDatabaseSourceChangeSets.id,
      `change_${seeded.sourceId.slice("src_".length)}`,
    );
    const stage = (value: string) =>
      asOwner(() =>
        stageBulkUpdate.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          itemIds: [row.itemId],
          field: { propertyId: seeded.propertyId, value },
          dryRun: false,
        }),
      );
    await stage("Operators");
    const [before] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    const sourceRowFilter = and(
      eq(schema.contentDatabaseSourceRows.sourceId, seeded.sourceId),
      eq(schema.contentDatabaseSourceRows.documentId, row.documentId),
    );
    snapshotRead.after = async () => {
      const [sourceRow] = await getDb()
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(sourceRowFilter);
      await getDb()
        .update(schema.contentDatabaseSourceRows)
        .set({
          sourceValuesJson: JSON.stringify({
            ...JSON.parse(sourceRow.sourceValuesJson),
            [seeded.sourceFieldKey]: "Designers",
          }),
        })
        .where(sourceRowFilter);
    };
    try {
      await expect(stage("Developers")).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "builder_bulk_stage_rows_changed",
      });
    } finally {
      snapshotRead.after = null;
    }

    await expect(
      valuesFor(seeded.propertyId, [row.documentId]),
    ).resolves.toEqual([
      expect.objectContaining({ valueJson: JSON.stringify("Operators") }),
    ]);
    const [after] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    expect(after).toMatchObject({
      state: before.state,
      fieldChangesJson: before.fieldChangesJson,
    });
  });

  it("refuses to stage a new value while the row's review item is being pushed", async () => {
    const seeded = await seedBuilderDatabase({ existingOpenChangeIndex: 0 });
    const [row] = seeded.rows;
    const changeSetId = `change_${seeded.sourceId.slice("src_".length)}`;
    const changeSetFilter = eq(
      schema.contentDatabaseSourceChangeSets.id,
      changeSetId,
    );
    await getDb()
      .update(schema.contentDatabaseSourceChangeSets)
      .set({ state: "approved" })
      .where(changeSetFilter);
    const [before] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    const startedAt = new Date().toISOString();
    await getDb()
      .insert(schema.contentDatabaseSourceExecutions)
      .values({
        id: `execution_${changeSetId}`,
        ownerEmail: OWNER,
        sourceId: seeded.sourceId,
        changeSetId,
        adapter: "builder-cms",
        pushMode: "autosave",
        state: "running",
        idempotencyKey: `builder-cms:${seeded.sourceId}:${changeSetId}:autosave`,
        summary: "Running.",
        payloadJson: JSON.stringify({ request: { method: "PATCH" } }),
        attemptToken: null,
        lastError: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      });

    await expect(
      asOwner(() =>
        stageBulkUpdate.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          itemIds: [row.itemId],
          field: { propertyId: seeded.propertyId, value: "Architects" },
          dryRun: false,
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "builder_execution_running",
    });
    await expect(
      valuesFor(seeded.propertyId, [row.documentId]),
    ).resolves.toEqual([]);
    const [after] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(changeSetFilter);
    expect(after).toMatchObject({
      state: "approved",
      fieldChangesJson: before.fieldChangesJson,
    });
  });

  it("refuses to set an edit back while its review item is being pushed", async () => {
    const seeded = await seedBuilderDatabase({ existingOpenChangeIndex: 0 });
    const [row] = seeded.rows;
    const changeSetId = `change_${seeded.sourceId.slice("src_".length)}`;
    const stage = (value: string) =>
      asOwner(() =>
        stageBulkUpdate.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          itemIds: [row.itemId],
          field: { propertyId: seeded.propertyId, value },
          dryRun: false,
        }),
      );
    await stage("Operators");
    const startedAt = new Date().toISOString();
    await getDb()
      .insert(schema.contentDatabaseSourceExecutions)
      .values({
        id: `execution_${changeSetId}`,
        ownerEmail: OWNER,
        sourceId: seeded.sourceId,
        changeSetId,
        adapter: "builder-cms",
        pushMode: "autosave",
        state: "running",
        idempotencyKey: `builder-cms:${seeded.sourceId}:${changeSetId}:autosave`,
        summary: "Running.",
        payloadJson: JSON.stringify({ request: { method: "PATCH" } }),
        attemptToken: null,
        lastError: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      });

    await expect(stage("Developers")).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "builder_execution_running",
    });
    await expect(
      valuesFor(seeded.propertyId, [row.documentId]),
    ).resolves.toEqual([
      expect.objectContaining({ valueJson: JSON.stringify("Operators") }),
    ]);
    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSetId));
    expect(JSON.parse(changeSet.fieldChangesJson)).toEqual([
      expect.objectContaining({ proposedValue: "Operators" }),
    ]);
  });

  it("stages Builder File URLs through Files & media properties", async () => {
    const seeded = await seedBuilderDatabase({
      propertyType: "files_media",
      sourceFieldType: "file",
    });
    const logoUrl = "https://cdn.example.com/assets/product-logo";

    const response = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: [logoUrl] },
        dryRun: false,
      }),
    );

    expect(response.summary).toEqual({
      total: 2,
      staged: 2,
      unchanged: 0,
      blocked: 0,
    });
    expect(
      response.review?.rows.map((row) => row.fieldChanges[0]?.proposedValue),
    ).toEqual([[logoUrl], [logoUrl]]);
    await expect(
      valuesFor(
        seeded.propertyId,
        seeded.rows.map((row) => row.documentId),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ valueJson: JSON.stringify([logoUrl]) }),
        expect.objectContaining({ valueJson: JSON.stringify([logoUrl]) }),
      ]),
    );
  });

  it("blocks stale rows without partially staging the batch", async () => {
    const seeded = await seedBuilderDatabase({ staleRowIndex: 1 });

    const response = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: "Architects" },
        dryRun: false,
      }),
    );

    expect(response.summary).toEqual({
      total: 2,
      staged: 0,
      unchanged: 0,
      blocked: 2,
    });
    expect(response.rows[0]).toMatchObject({
      status: "blocked",
      message:
        "No rows were staged because at least one selected row is blocked.",
    });
    expect(response.rows[1]).toMatchObject({
      status: "blocked",
      message: "Refresh this Builder row before staging a bulk update.",
    });
    await expect(
      valuesFor(
        seeded.propertyId,
        seeded.rows.map((row) => row.documentId),
      ),
    ).resolves.toHaveLength(0);
  });

  it("blocks legacy fixture rows on live Builder sources before local staging", async () => {
    const seeded = await seedBuilderDatabase({
      fixtureRowIndex: 1,
      liveReadConfigured: true,
    });

    const response = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: "Architects" },
        dryRun: false,
      }),
    );

    expect(response.summary).toEqual({
      total: 2,
      staged: 0,
      unchanged: 0,
      blocked: 2,
    });
    expect(response.rows[0]).toMatchObject({
      status: "blocked",
      message:
        "No rows were staged because at least one selected row is blocked.",
    });
    expect(response.rows[1]).toMatchObject({
      status: "blocked",
      message:
        "Refresh this Builder row from the live source before staging a bulk update.",
    });
    expect(response.review).toBeNull();
    await expect(
      valuesFor(
        seeded.propertyId,
        seeded.rows.map((row) => row.documentId),
      ),
    ).resolves.toHaveLength(0);
  });

  it("updates existing pending Builder reviews to the latest local overwrite", async () => {
    const seeded = await seedBuilderDatabase({ existingOpenChangeIndex: 1 });

    const response = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: seeded.rows.map((row) => row.itemId),
        field: { propertyId: seeded.propertyId, value: "Architects" },
        dryRun: false,
      }),
    );

    expect(response.summary).toEqual({
      total: 2,
      staged: 2,
      unchanged: 0,
      blocked: 0,
    });
    expect(response.review?.rows).toHaveLength(2);
    expect(
      response.review?.rows.map((row) => ({
        documentId: row.documentId,
        proposedValue: row.fieldChanges[0]?.proposedValue,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          documentId: seeded.rows[0].documentId,
          proposedValue: "Architects",
        },
        {
          documentId: seeded.rows[1].documentId,
          proposedValue: "Architects",
        },
      ]),
    );
    await expect(
      valuesFor(
        seeded.propertyId,
        seeded.rows.map((row) => row.documentId),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ valueJson: JSON.stringify("Architects") }),
        expect.objectContaining({ valueJson: JSON.stringify("Architects") }),
      ]),
    );
  });

  it("reports unsupported mapped property types as blocked", async () => {
    const seeded = await seedBuilderDatabase({
      propertyType: "select",
      sourceFieldType: "enum",
    });

    const response = await asOwner(() =>
      stageBulkUpdate.run({
        documentId: seeded.databaseDocumentId,
        sourceId: seeded.sourceId,
        itemIds: [seeded.rows[0].itemId],
        field: { propertyId: seeded.propertyId, value: "Architects" },
      }),
    );

    expect(response.summary).toEqual({
      total: 1,
      staged: 0,
      unchanged: 0,
      blocked: 1,
    });
    expect(response.rows[0]?.message).toBe(
      "This property type is not supported for Builder bulk updates yet.",
    );
    expect(response.review).toBeNull();
  });

  it("rejects ambiguous Builder field mappings instead of picking one", async () => {
    const seeded = await seedBuilderDatabase({});
    const now = "2026-07-01T12:00:00.000Z";
    await getDb()
      .insert(schema.contentDatabaseSourceFields)
      .values({
        id: nextId("duplicate_field"),
        ownerEmail: OWNER,
        sourceId: seeded.sourceId,
        propertyId: seeded.propertyId,
        localFieldKey: seeded.propertyId,
        sourceFieldKey: `${seeded.sourceFieldKey}.duplicate`,
        sourceFieldLabel: "Audience duplicate",
        sourceFieldType: "string",
        mappingType: "property",
        writeOwner: "source",
        readOnly: 0,
        provenance: "source",
        freshness: "fresh",
        createdAt: now,
        updatedAt: now,
      });

    await expect(
      asOwner(() =>
        stageBulkUpdate.run({
          documentId: seeded.databaseDocumentId,
          sourceId: seeded.sourceId,
          itemIds: [seeded.rows[0].itemId],
          field: { propertyId: seeded.propertyId, value: "Architects" },
          dryRun: false,
        }),
      ),
    ).rejects.toThrow("Mapped Builder source field is ambiguous.");
  });
});
