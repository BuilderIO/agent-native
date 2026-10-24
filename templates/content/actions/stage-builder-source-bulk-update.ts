import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceFieldChange,
  ContentDatabaseSourceFieldMapping,
  DocumentPropertyValue,
  StageBuilderSourceBulkUpdateRequest,
  StageBuilderSourceBulkUpdateResponse,
  StageBuilderSourceBulkUpdateRowResult,
} from "../shared/api.js";
import {
  isBlocksPropertyType,
  isComputedPropertyType,
  normalizePropertyValue,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { BUILDER_CMS_FIXTURE_ROW_PROVENANCE } from "./_builder-cms-source-adapter.js";
import {
  readBuilderCmsEditConflicts,
  withBuilderCmsEditConflicts,
} from "./_builder-cms-unpublished-changes.js";
import { parseBuilderEntrySourceValues } from "./_builder-entry-status.js";
import { assertNoActiveBuilderSourceExecutions } from "./_builder-source-execution-guard.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import {
  DATABASE_ROW_BATCH_LIMIT,
  resolveDatabaseRowsForBatch,
} from "./_database-row-batch.js";
import {
  getContentDatabaseSourceSnapshotForWrite,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { nanoid, normalizedValueJson } from "./_property-utils.js";
import { buildBuilderSourceReviewPayload } from "./prepare-builder-source-review.js";

const supportedBulkPropertyTypes = new Set<DocumentPropertyType>([
  "text",
  "number",
  "checkbox",
  "url",
  "email",
  "phone",
  "files_media",
]);

function parseSourceValues(
  value: string | Record<string, DocumentPropertyValue> | null | undefined,
) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (!value) return {};
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, DocumentPropertyValue>)
      : {};
  } catch {
    return {};
  }
}

function stableValueString(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(stableValueString).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValueString(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameSourceFieldValue(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return stableValueString(value);
  };
  return normalize(a) === normalize(b);
}

function openChangeSetForDocument(
  source: ContentDatabaseSource,
  documentId: string,
) {
  return source.changeSets.find(
    (changeSet) =>
      changeSet.documentId === documentId &&
      changeSet.direction === "outbound" &&
      (changeSet.state === "pending_push" ||
        changeSet.state === "staged_revision" ||
        changeSet.state === "approved"),
  );
}

function resolveSourceField(args: {
  source: ContentDatabaseSource;
  field: StageBuilderSourceBulkUpdateRequest["field"];
}) {
  const candidates = args.source.fields.filter(
    (field) =>
      field.mappingType === "property" &&
      (args.field.propertyId
        ? field.propertyId === args.field.propertyId
        : true) &&
      (args.field.localFieldKey
        ? field.localFieldKey === args.field.localFieldKey
        : true) &&
      (args.field.sourceFieldKey
        ? field.sourceFieldKey === args.field.sourceFieldKey
        : true),
  );
  if (candidates.length > 1) {
    throw new Error("Mapped Builder source field is ambiguous.");
  }
  return candidates[0] ?? null;
}

function fieldBlocker(field: ContentDatabaseSourceFieldMapping) {
  if (field.readOnly) return "The selected Builder field is read-only.";
  if (field.writeOwner !== "source") {
    return "Only source-owned Builder fields can be staged for Builder writeback.";
  }
  if (!field.propertyId) {
    return "Bulk Builder updates currently require a mapped database property.";
  }
  return null;
}

function sourceBlocker(source: ContentDatabaseSource) {
  if (source.sourceType !== "builder-cms") {
    return "Attach a Builder CMS source before staging a bulk update.";
  }
  if (!source.capabilities.canCreateChangeSets) {
    return "This Builder source cannot create reviewable change sets.";
  }
  if (!source.capabilities.canWriteFields) {
    return "This Builder source does not allow field writeback.";
  }
  if (source.freshness !== "fresh") {
    return "Refresh the Builder source before staging bulk updates.";
  }
  return null;
}

function reviewableRowBlocker(
  source: ContentDatabaseSource,
  row: ContentDatabaseSource["rows"][number],
) {
  const skipsFixtureRows =
    source.metadata.liveReadConfigured === true ||
    source.capabilities.liveWritesEnabled === true;
  if (
    skipsFixtureRows &&
    row.provenance === BUILDER_CMS_FIXTURE_ROW_PROVENANCE
  ) {
    return "Refresh this Builder row from the live source before staging a bulk update.";
  }
  return null;
}

function rowTitle(row: { document: { title?: string | null } }) {
  return row.document.title?.trim() || "Untitled";
}

function summarizeRows(rows: StageBuilderSourceBulkUpdateRowResult[]) {
  return {
    total: rows.length,
    staged: rows.filter((row) => row.status === "staged").length,
    unchanged: rows.filter((row) => row.status === "unchanged").length,
    blocked: rows.filter((row) => row.status === "blocked").length,
  };
}

function previewChangeSet(args: {
  source: ContentDatabaseSource;
  row: StageBuilderSourceBulkUpdateRowResult;
  fieldChange: ContentDatabaseSourceFieldChange;
  now: string;
}): ContentDatabaseSourceChangeSet {
  return {
    id: args.row.changeSetId ?? `bulk-preview-${args.row.itemId}`,
    databaseItemId: args.row.itemId,
    documentId: args.row.documentId,
    kind: "field_update",
    direction: "outbound",
    state: "pending_push",
    pushMode: args.source.metadata.pushMode ?? "autosave",
    localOnly: true,
    summary: `Pending local Builder CMS bulk update for "${args.row.title}".`,
    fieldChanges: [args.fieldChange],
    bodyChange: null,
    riskLevel: "low",
    riskReasons: ["bulk field update"],
    conflictState: "none",
    reviewEvents: [],
    executions: [],
    createdAt: args.now,
    updatedAt: args.now,
  };
}

function mergedFieldChanges(
  current: ContentDatabaseSourceFieldChange[],
  next: ContentDatabaseSourceFieldChange,
) {
  const withoutExisting = current.filter(
    (change) =>
      change.sourceFieldKey !== next.sourceFieldKey &&
      change.localFieldKey !== next.localFieldKey,
  );
  return [...withoutExisting, next];
}

async function propertyDefinition(args: {
  databaseId: string;
  ownerEmail: string;
  propertyId: string;
}) {
  const [definition] = await getDb()
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.id, args.propertyId),
        eq(schema.documentPropertyDefinitions.databaseId, args.databaseId),
        eq(schema.documentPropertyDefinitions.ownerEmail, args.ownerEmail),
      ),
    );
  return definition ?? null;
}

async function upsertPropertyValues(args: {
  db?: any;
  ownerEmail: string;
  documentIds: string[];
  propertyId: string;
  valueJson: string;
  now: string;
}) {
  const db = args.db ?? getDb();
  const existing = await db
    .select({
      id: schema.documentPropertyValues.id,
      documentId: schema.documentPropertyValues.documentId,
    })
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(schema.documentPropertyValues.propertyId, args.propertyId),
        inArray(schema.documentPropertyValues.documentId, args.documentIds),
      ),
    );
  const existingByDocumentId = new Map(
    existing.map((row: { id: string; documentId: string }) => [
      row.documentId,
      row.id,
    ]),
  );
  const existingIds = existing.map((row: { id: string }) => row.id);
  if (existingIds.length > 0) {
    await db
      .update(schema.documentPropertyValues)
      .set({ valueJson: args.valueJson, updatedAt: args.now })
      .where(inArray(schema.documentPropertyValues.id, existingIds));
  }
  const inserts = args.documentIds
    .filter((documentId) => !existingByDocumentId.has(documentId))
    .map((documentId) => ({
      id: nanoid(),
      ownerEmail: args.ownerEmail,
      documentId,
      propertyId: args.propertyId,
      valueJson: args.valueJson,
      createdAt: args.now,
      updatedAt: args.now,
    }));
  if (inserts.length > 0) {
    await db.insert(schema.documentPropertyValues).values(inserts);
  }
}

async function updateOpenChangeSetsForStagedRows(args: {
  source: ContentDatabaseSource;
  rows: StageBuilderSourceBulkUpdateRowResult[];
  now: string;
}) {
  const db = getDb();
  for (const row of args.rows) {
    if (row.status !== "staged" || !row.fieldChange) continue;
    const openChangeSet = openChangeSetForDocument(args.source, row.documentId);
    if (!openChangeSet) continue;
    const fieldChanges = mergedFieldChanges(
      openChangeSet.fieldChanges,
      row.fieldChange,
    );
    await db
      .update(schema.contentDatabaseSourceChangeSets)
      .set({
        state: "pending_push",
        summary: `Pending local Builder CMS changes for "${row.title}".`,
        fieldChangesJson: JSON.stringify(fieldChanges),
        updatedAt: args.now,
      })
      .where(eq(schema.contentDatabaseSourceChangeSets.id, openChangeSet.id));
  }
}

/**
 * Sets the rows' properties back to the value Builder has and takes the field
 * out of their open review items and edit conflicts, all at once.
 */
async function setEditsBackToBuilderValue(args: {
  databaseId: string;
  sourceId: string;
  field: ContentDatabaseSourceFieldMapping;
  rows: Array<{ itemId: string; documentId: string; localValueJson: string }>;
  builderValue: unknown;
  ownerEmail: string;
  propertyId: string;
  valueJson: string;
  now: string;
}) {
  const documentIds = args.rows.map((row) => row.documentId);
  await getDb().transaction(async (tx) => {
    const db = tx as unknown as ReturnType<typeof getDb>;
    // A push starts under the database lock and needs its change set still
    // approved, so it either shows up as running below or finds it closed.
    await lockContentDatabaseMutation(db, args.databaseId);
    // Refreshes and pushes rewrite these rows under the same lock.
    await lockDatabaseMemberships(
      tx,
      args.rows.map((row) => row.itemId),
    );
    const openChangeSets = await tx
      .select({
        id: schema.contentDatabaseSourceChangeSets.id,
        fieldChangesJson:
          schema.contentDatabaseSourceChangeSets.fieldChangesJson,
        bodyChangeJson: schema.contentDatabaseSourceChangeSets.bodyChangeJson,
      })
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        and(
          eq(schema.contentDatabaseSourceChangeSets.sourceId, args.sourceId),
          inArray(
            schema.contentDatabaseSourceChangeSets.documentId,
            documentIds,
          ),
          eq(schema.contentDatabaseSourceChangeSets.direction, "outbound"),
          inArray(schema.contentDatabaseSourceChangeSets.state, [
            "pending_push",
            "staged_revision",
            "approved",
          ]),
        ),
      )
      .for("update");
    await assertNoActiveBuilderSourceExecutions(
      db,
      [args.sourceId],
      openChangeSets.map((changeSet) => changeSet.id),
    );
    const sourceRows = await tx
      .select({
        id: schema.contentDatabaseSourceRows.id,
        documentId: schema.contentDatabaseSourceRows.documentId,
        sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
      })
      .from(schema.contentDatabaseSourceRows)
      .where(
        and(
          eq(schema.contentDatabaseSourceRows.sourceId, args.sourceId),
          inArray(schema.contentDatabaseSourceRows.documentId, documentIds),
        ),
      );
    const localValues = await tx
      .select({
        documentId: schema.documentPropertyValues.documentId,
        valueJson: schema.documentPropertyValues.valueJson,
      })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.propertyId, args.propertyId),
          inArray(schema.documentPropertyValues.documentId, documentIds),
        ),
      );
    const localValueJsonByDocumentId = new Map(
      localValues.map((value) => [value.documentId, value.valueJson]),
    );
    const sourceValuesByDocumentId = new Map(
      sourceRows.map((row) => [
        row.documentId,
        parseBuilderEntrySourceValues(row.sourceValuesJson),
      ]),
    );
    // The stage compared these values before it had the locks.
    const rowChanged = args.rows.some((row) => {
      const sourceValues = sourceValuesByDocumentId.get(row.documentId);
      return (
        localValueJsonByDocumentId.get(row.documentId) !== row.localValueJson ||
        !sourceValues ||
        !sameSourceFieldValue(
          sourceValues[args.field.sourceFieldKey] ?? null,
          args.builderValue,
        )
      );
    });
    if (rowChanged) {
      fail(
        "A selected row changed while this update was staging. Review the rows and stage it again.",
        { errorCode: "builder_bulk_stage_rows_changed", statusCode: 409 },
      );
    }
    await upsertPropertyValues({
      db: tx,
      ownerEmail: args.ownerEmail,
      documentIds,
      propertyId: args.propertyId,
      valueJson: args.valueJson,
      now: args.now,
    });
    for (const changeSet of openChangeSets) {
      const current = JSON.parse(
        changeSet.fieldChangesJson,
      ) as ContentDatabaseSourceFieldChange[];
      const fieldChanges = current.filter(
        (change) =>
          change.sourceFieldKey !== args.field.sourceFieldKey &&
          change.localFieldKey !== args.field.localFieldKey,
      );
      if (fieldChanges.length === current.length) continue;
      await tx
        .update(schema.contentDatabaseSourceChangeSets)
        .set({
          // A change with nothing left to push is closed rather than pushed empty.
          state:
            fieldChanges.length === 0 && !changeSet.bodyChangeJson
              ? "rejected"
              : "pending_push",
          fieldChangesJson: JSON.stringify(fieldChanges),
          updatedAt: args.now,
        })
        .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSet.id));
    }
    for (const row of sourceRows) {
      const sourceValues = sourceValuesByDocumentId.get(row.documentId);
      const conflicts = readBuilderCmsEditConflicts(sourceValues);
      if (
        !sourceValues ||
        conflicts.state !== "recorded" ||
        !conflicts.sourceFieldKeys.includes(args.field.sourceFieldKey)
      ) {
        continue;
      }
      await tx
        .update(schema.contentDatabaseSourceRows)
        .set({
          sourceValuesJson: JSON.stringify(
            withBuilderCmsEditConflicts(sourceValues, {
              ownedKeys: [args.field.sourceFieldKey],
              conflictedKeys: [],
            }),
          ),
          updatedAt: args.now,
        })
        .where(eq(schema.contentDatabaseSourceRows.id, row.id));
    }
  });
}

async function stageBuilderSourceBulkUpdateWithDeps(
  args: StageBuilderSourceBulkUpdateRequest,
): Promise<StageBuilderSourceBulkUpdateResponse> {
  const database = await resolveDatabaseForSourceMutation(args);
  if (!database) throw new Error("Database not found.");
  await assertAccess("document", database.documentId, "editor");

  const { rows } = await resolveDatabaseRowsForBatch({
    databaseId: database.id,
    itemIds: args.itemIds,
    documentIds: args.documentIds,
  });
  const source = await getContentDatabaseSourceSnapshotForWrite(
    database,
    args.sourceId,
  );
  if (!source) throw new Error("Attach a source before staging bulk updates.");

  const sourceLevelBlocker = sourceBlocker(source);
  const field = resolveSourceField({ source, field: args.field });
  if (!field) throw new Error("Mapped Builder source field not found.");
  const fieldLevelBlocker = fieldBlocker(field);
  const definition = field.propertyId
    ? await propertyDefinition({
        databaseId: database.id,
        ownerEmail: database.ownerEmail,
        propertyId: field.propertyId,
      })
    : null;
  if (field.propertyId && !definition) {
    throw new Error("Mapped database property not found.");
  }
  const propertyType = definition?.type as DocumentPropertyType | undefined;
  const propertyBlocker =
    propertyType &&
    (isComputedPropertyType(propertyType) ||
      isBlocksPropertyType(propertyType) ||
      !supportedBulkPropertyTypes.has(propertyType))
      ? "This property type is not supported for Builder bulk updates yet."
      : null;
  const normalizedValue = propertyType
    ? normalizePropertyValue(propertyType, args.field.value)
    : args.field.value;
  const valueJson = propertyType
    ? normalizedValueJson(propertyType, normalizedValue)
    : null;
  const now = new Date().toISOString();
  const sourceRowsByDocumentId = new Map(
    source.rows.map((row) => [row.documentId, row]),
  );
  const results: StageBuilderSourceBulkUpdateRowResult[] = [];
  const previewChangeSets: ContentDatabaseSourceChangeSet[] = [];
  // A refresh keeps Content's unpushed edit, so a row whose Builder value
  // already matches can still show a different one until this sets it back.
  const localValueJsonByDocumentId = new Map(
    field.propertyId && rows.length > 0
      ? (
          await getDb()
            .select({
              documentId: schema.documentPropertyValues.documentId,
              valueJson: schema.documentPropertyValues.valueJson,
            })
            .from(schema.documentPropertyValues)
            .where(
              and(
                eq(schema.documentPropertyValues.propertyId, field.propertyId),
                inArray(
                  schema.documentPropertyValues.documentId,
                  rows.map((row) => row.document.id),
                ),
              ),
            )
        ).map((value) => [value.documentId, value.valueJson])
      : [],
  );
  const revertedRows: Array<{
    itemId: string;
    documentId: string;
    localValueJson: string;
  }> = [];

  for (const row of rows) {
    const sourceRow = sourceRowsByDocumentId.get(row.document.id);
    const title = rowTitle(row);
    const baseResult = {
      itemId: row.item.id,
      documentId: row.document.id,
      title,
    };
    const blocker =
      sourceLevelBlocker ??
      fieldLevelBlocker ??
      propertyBlocker ??
      (!sourceRow
        ? "Selected row is not backed by the target Builder source."
        : null) ??
      (sourceRow?.freshness !== "fresh" || sourceRow?.syncState === "error"
        ? "Refresh this Builder row before staging a bulk update."
        : null) ??
      (sourceRow ? reviewableRowBlocker(source, sourceRow) : null);
    if (blocker || !sourceRow) {
      results.push({
        ...baseResult,
        status: "blocked",
        message:
          blocker ?? "Selected row is not backed by the target Builder source.",
      });
      continue;
    }

    const sourceValues = parseSourceValues(sourceRow.sourceValues);
    const currentValue = sourceValues[field.sourceFieldKey] ?? null;
    if (sameSourceFieldValue(currentValue, normalizedValue)) {
      const localValueJson = localValueJsonByDocumentId.get(row.document.id);
      const revertsLocalEdit =
        localValueJson !== undefined && localValueJson !== valueJson;
      if (revertsLocalEdit) {
        revertedRows.push({
          itemId: row.item.id,
          documentId: row.document.id,
          localValueJson,
        });
      }
      results.push({
        ...baseResult,
        status: "unchanged",
        message: revertsLocalEdit
          ? "The selected Builder field already has this value, so Content's unpushed edit goes back to it."
          : "The selected Builder field already has this value.",
      });
      continue;
    }

    const fieldChange: ContentDatabaseSourceFieldChange = {
      propertyId: field.propertyId,
      propertyName: field.propertyName,
      localFieldKey: field.localFieldKey,
      sourceFieldKey: field.sourceFieldKey,
      currentValue,
      proposedValue: normalizedValue,
    };
    const changeSetId = `bulk-preview-${row.item.id}`;
    const result = {
      ...baseResult,
      status: "staged" as const,
      changeSetId,
      fieldChange,
    };
    results.push(result);
    previewChangeSets.push(
      previewChangeSet({ source, row: result, fieldChange, now }),
    );
  }

  const summary = summarizeRows(results);
  const dryRun = args.dryRun !== false;
  if (!dryRun && summary.blocked > 0) {
    const blockedRows = results.map((row) =>
      row.status === "staged"
        ? {
            ...row,
            status: "blocked" as const,
            message:
              "No rows were staged because at least one selected row is blocked.",
            changeSetId: undefined,
            fieldChange: undefined,
          }
        : row.status === "unchanged" &&
            revertedRows.some(
              (reverted) => reverted.documentId === row.documentId,
            )
          ? {
              ...row,
              message: "The selected Builder field already has this value.",
            }
          : row,
    );
    return {
      dryRun,
      databaseId: database.id,
      documentId: database.documentId,
      sourceId: source.id,
      field: {
        propertyId: field.propertyId,
        propertyName: field.propertyName,
        localFieldKey: field.localFieldKey,
        sourceFieldKey: field.sourceFieldKey,
        sourceFieldLabel: field.sourceFieldLabel,
      },
      summary: summarizeRows(blockedRows),
      rows: blockedRows,
      review: null,
    };
  }
  if (
    !dryRun &&
    summary.blocked === 0 &&
    revertedRows.length > 0 &&
    field.propertyId &&
    valueJson
  ) {
    await setEditsBackToBuilderValue({
      databaseId: database.id,
      sourceId: source.id,
      field,
      rows: revertedRows,
      builderValue: normalizedValue,
      ownerEmail: database.ownerEmail,
      propertyId: field.propertyId,
      valueJson,
      now,
    });
    if (summary.staged === 0) {
      await getDb()
        .update(schema.contentDatabaseSources)
        .set({ updatedAt: now })
        .where(eq(schema.contentDatabaseSources.id, source.id));
    }
  }
  if (!dryRun && summary.blocked === 0 && summary.staged > 0) {
    if (!field.propertyId || !valueJson) {
      throw new Error(
        "Bulk Builder updates currently require a mapped property.",
      );
    }
    await upsertPropertyValues({
      ownerEmail: database.ownerEmail,
      documentIds: results
        .filter((row) => row.status === "staged")
        .map((row) => row.documentId),
      propertyId: field.propertyId,
      valueJson,
      now,
    });
    await updateOpenChangeSetsForStagedRows({
      source,
      rows: results,
      now,
    });
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    const updatedSource = await getContentDatabaseSourceSnapshotForWrite(
      database,
      args.sourceId,
    );
    if (!updatedSource) throw new Error("Builder source disappeared.");
    const stagedDocumentIds = new Set(
      results
        .filter((row) => row.status === "staged")
        .map((row) => row.documentId),
    );
    const reviewChangeSets = updatedSource.changeSets.filter(
      (changeSet) =>
        changeSet.documentId &&
        stagedDocumentIds.has(changeSet.documentId) &&
        changeSet.direction === "outbound" &&
        (changeSet.state === "pending_push" ||
          changeSet.state === "staged_revision" ||
          changeSet.state === "approved") &&
        changeSet.fieldChanges.some(
          (change) => change.sourceFieldKey === field.sourceFieldKey,
        ),
    );
    const reviewChangeSetByDocumentId = new Map(
      reviewChangeSets.map((changeSet) => [changeSet.documentId, changeSet]),
    );
    const stagedRows = results.map((row) =>
      row.status === "staged"
        ? {
            ...row,
            changeSetId: reviewChangeSetByDocumentId.get(row.documentId)?.id,
          }
        : row,
    );
    return {
      dryRun,
      databaseId: database.id,
      documentId: database.documentId,
      sourceId: updatedSource.id,
      field: {
        propertyId: field.propertyId,
        propertyName: field.propertyName,
        localFieldKey: field.localFieldKey,
        sourceFieldKey: field.sourceFieldKey,
        sourceFieldLabel: field.sourceFieldLabel,
      },
      summary,
      rows: stagedRows,
      review:
        reviewChangeSets.length > 0
          ? buildBuilderSourceReviewPayload({
              source: updatedSource,
              changeSets: reviewChangeSets,
            })
          : null,
    };
  }

  return {
    dryRun,
    databaseId: database.id,
    documentId: database.documentId,
    sourceId: source.id,
    field: {
      propertyId: field.propertyId,
      propertyName: field.propertyName,
      localFieldKey: field.localFieldKey,
      sourceFieldKey: field.sourceFieldKey,
      sourceFieldLabel: field.sourceFieldLabel,
    },
    summary,
    rows: results,
    review:
      previewChangeSets.length > 0
        ? buildBuilderSourceReviewPayload({
            source,
            changeSets: previewChangeSets,
          })
        : null,
  };
}

const fieldSchema = z.object({
  propertyId: z.string().optional(),
  localFieldKey: z.string().optional(),
  sourceFieldKey: z.string().optional(),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z
        .object({
          start: z.string(),
          end: z.string().nullable().optional(),
          includeTime: z.boolean().optional(),
        })
        .passthrough(),
      z.null(),
    ])
    .describe(
      "Value to set on the mapped Builder-backed field. Builder File fields accept one http(s) URL as a string or one-item array; no media-picker upload is required.",
    ),
});

export const stageBuilderSourceBulkUpdateSchema = z
  .object({
    databaseId: z.string().optional().describe("Content collection ID"),
    documentId: z
      .string()
      .optional()
      .describe("Content collection backing document ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target Builder source ID (defaults to the primary source)"),
    itemIds: z
      .array(z.string())
      .max(DATABASE_ROW_BATCH_LIMIT)
      .optional()
      .describe("Selected collection row item IDs to stage in one batch."),
    documentIds: z
      .array(z.string())
      .max(DATABASE_ROW_BATCH_LIMIT)
      .optional()
      .describe("Selected collection row document IDs to stage in one batch."),
    field: fieldSchema.describe(
      "One mapped Builder-backed field to update across the selected rows.",
    ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "Preview only when true or omitted. Set false to stage locally.",
      ),
  })
  .superRefine((value, ctx) => {
    if (!value.databaseId && !value.documentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either databaseId or documentId is required.",
      });
    }
    const total =
      (value.itemIds?.length ?? 0) + (value.documentIds?.length ?? 0);
    if (total === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one itemId or documentId is required.",
      });
    }
    if (total > DATABASE_ROW_BATCH_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Builder source bulk updates are limited to ${DATABASE_ROW_BATCH_LIMIT} rows.`,
      });
    }
    if (!value.field.propertyId && !value.field.localFieldKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["field"],
        message: "A propertyId or localFieldKey is required.",
      });
    }
  });

export { stageBuilderSourceBulkUpdateWithDeps };

export default defineAction({
  description:
    "Preview or stage one bounded bulk update across selected source-backed Builder CMS rows, including Builder File fields backed by Content Files & media properties. This only stages local reviewable diffs; Builder writeback still goes through the existing review and execution actions.",
  schema: stageBuilderSourceBulkUpdateSchema,
  run: async (
    args: StageBuilderSourceBulkUpdateRequest,
  ): Promise<StageBuilderSourceBulkUpdateResponse> => {
    if (
      (args.itemIds?.length ?? 0) + (args.documentIds?.length ?? 0) >
      DATABASE_ROW_BATCH_LIMIT
    ) {
      throw new Error(
        `Builder source bulk updates are limited to ${DATABASE_ROW_BATCH_LIMIT} rows.`,
      );
    }
    return stageBuilderSourceBulkUpdateWithDeps(args);
  },
});
