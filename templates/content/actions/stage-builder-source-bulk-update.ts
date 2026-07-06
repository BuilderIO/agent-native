import { defineAction } from "@agent-native/core";
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
  ownerEmail: string;
  documentIds: string[];
  propertyId: string;
  valueJson: string;
  now: string;
}) {
  const db = getDb();
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
    existing.map((row) => [row.documentId, row.id]),
  );
  const existingIds = existing.map((row) => row.id);
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
      (sourceRow ? reviewableRowBlocker(source, sourceRow) : null) ??
      (openChangeSetForDocument(source, row.document.id)
        ? "This row already has a pending Builder review item."
        : null);
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
      results.push({
        ...baseResult,
        status: "unchanged",
        message: "The selected Builder field already has this value.",
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
    .describe("Value to set on the mapped Builder-backed field."),
});

export const stageBuilderSourceBulkUpdateSchema = z
  .object({
    databaseId: z.string().optional().describe("Content database ID"),
    documentId: z
      .string()
      .optional()
      .describe("Content database backing document ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target Builder source ID (defaults to the primary source)"),
    itemIds: z
      .array(z.string())
      .max(DATABASE_ROW_BATCH_LIMIT)
      .optional()
      .describe("Selected database row item IDs to stage in one batch."),
    documentIds: z
      .array(z.string())
      .max(DATABASE_ROW_BATCH_LIMIT)
      .optional()
      .describe("Selected database row document IDs to stage in one batch."),
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
    "Preview or stage one bounded bulk update across selected source-backed Builder CMS rows. This only stages local reviewable diffs; Builder writeback still goes through the existing review and execution actions.",
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
