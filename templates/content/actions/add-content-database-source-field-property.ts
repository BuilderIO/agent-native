import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  AddContentDatabaseSourceFieldPropertyRequest,
  BuilderCmsModelFieldSummary,
  ContentDatabaseSourceFieldPropertyResponse,
  DocumentPropertyValue,
} from "../shared/api.js";
import {
  defaultPropertyOptions,
  normalizePropertyValue,
  normalizePropertyValueWithOptions,
  normalizePropertyVisibility,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptionColor,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { chunks } from "./_batch-utils.js";
import { readBuilderCmsContentEntries } from "./_builder-cms-read-client.js";
import {
  builderCmsQualifiedId,
  type BuilderCmsSourceEntry,
} from "./_builder-cms-source-adapter.js";
import {
  resolveDatabaseForSourceMutation,
  serializeSourceField,
} from "./_database-source-utils.js";
import { nanoid } from "./_property-utils.js";

const BUILDER_FIELD_REFRESH_MINIMUM_LIMIT = 500;

type SourceRow = typeof schema.contentDatabaseSourceRows.$inferSelect;

function parseSourceValues(
  value: string | null | undefined,
): Record<string, DocumentPropertyValue> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, DocumentPropertyValue>)
      : {};
  } catch {
    return {};
  }
}

function hasSourceFieldValue(
  row: Pick<SourceRow, "sourceValuesJson">,
  sourceFieldKey: string,
) {
  return Object.prototype.hasOwnProperty.call(
    parseSourceValues(row.sourceValuesJson),
    sourceFieldKey,
  );
}

function mergeBuilderFieldIntoSourceRows(args: {
  rows: SourceRow[];
  entries: BuilderCmsSourceEntry[];
  sourceTable: string;
  sourceFieldKey: string;
  now: string;
}) {
  const entriesById = new Map(args.entries.map((entry) => [entry.id, entry]));
  const entriesByQualifiedId = new Map(
    args.entries.map((entry) => [
      builderCmsQualifiedId({
        sourceTable: args.sourceTable,
        entryId: entry.id,
      }),
      entry,
    ]),
  );
  let missingRows = 0;
  let matchedMissingRows = 0;
  const rows = args.rows.map((row) => {
    if (hasSourceFieldValue(row, args.sourceFieldKey)) return row;
    missingRows += 1;
    const entry =
      entriesById.get(row.sourceRowId) ??
      entriesByQualifiedId.get(row.sourceQualifiedId);
    if (!entry) return row;
    matchedMissingRows += 1;
    return {
      ...row,
      sourceValuesJson: JSON.stringify({
        ...parseSourceValues(row.sourceValuesJson),
        [args.sourceFieldKey]: Object.prototype.hasOwnProperty.call(
          entry.sourceValues,
          args.sourceFieldKey,
        )
          ? entry.sourceValues[args.sourceFieldKey]
          : null,
      }),
      updatedAt: args.now,
    };
  });
  return { rows, missingRows, matchedMissingRows };
}

export function sourceFieldPropertyValuesFromRows(
  rows: Array<{
    databaseItemId: string;
    documentId: string;
    sourceValuesJson: string | null;
  }>,
  sourceFieldKey: string,
  type: DocumentPropertyType,
  options?: DocumentPropertyOptions,
) {
  return rows
    .map((row) => {
      const sourceValues = parseSourceValues(row.sourceValuesJson);
      const sourceValue = sourceValues[sourceFieldKey];
      const value = options
        ? normalizePropertyValueWithOptions(type, sourceValue, options)
        : normalizePropertyValue(type, sourceValue);
      return {
        itemId: row.databaseItemId,
        documentId: row.documentId,
        value,
      };
    })
    .filter((row) => row.value !== null);
}

export function propertyTypeForSourceField(
  sourceFieldType: string,
  metadata?: BuilderCmsModelFieldSummary | null,
): DocumentPropertyType {
  const normalized = sourceFieldType.trim().toLowerCase();
  const metadataKind = [
    metadata?.type,
    metadata?.inputType,
    metadata?.name,
    metadata?.label,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .trim()
    .toLowerCase();
  const hasChoices =
    (metadata?.enum?.length ?? 0) > 0 || (metadata?.options?.length ?? 0) > 0;
  const looksMultiSelect = /\b(multi[-_\s]?select|tags?|stringlist)\b/.test(
    metadataKind,
  );

  if (normalized === "number") return "number";
  if (normalized === "datetime" || normalized === "date") {
    return "date";
  }
  if (normalized === "url") return "url";
  if (normalized === "boolean" || normalized === "checkbox") {
    return "checkbox";
  }
  if (normalized === "multi_select" || normalized === "tags") {
    return "multi_select";
  }
  if ((normalized === "list" || normalized === "array") && looksMultiSelect) {
    return "multi_select";
  }
  if (hasChoices && looksMultiSelect) return "multi_select";
  if (hasChoices && normalized !== "list" && normalized !== "array") {
    return "select";
  }
  return "text";
}

const SOURCE_OPTION_COLORS: DocumentPropertyOptionColor[] = [
  "blue",
  "green",
  "purple",
  "pink",
  "orange",
  "yellow",
  "red",
  "gray",
];

function optionIdFromName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "option"
  );
}

function uniqueOptionIdFromName(name: string, usedIds: Set<string>) {
  const baseId = optionIdFromName(name);
  let id = baseId;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${index++}`;
  }
  usedIds.add(id);
  return id;
}

function uniqueStringValues(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
}

function sourceFieldOptionNames(args: {
  metadata?: BuilderCmsModelFieldSummary | null;
  rows: Array<{ sourceValuesJson: string | null }>;
  sourceFieldKey: string;
  type: DocumentPropertyType;
}) {
  const explicit = uniqueStringValues([
    ...(args.metadata?.options ?? []),
    ...(args.metadata?.enum ?? []),
  ]);
  if (explicit.length > 0) return explicit;
  if (args.type !== "select" && args.type !== "multi_select") return [];

  const rowValues: string[] = [];
  for (const row of args.rows) {
    const value = parseSourceValues(row.sourceValuesJson)[args.sourceFieldKey];
    if (Array.isArray(value)) rowValues.push(...value);
    else if (typeof value === "string") rowValues.push(value);
  }
  return uniqueStringValues(rowValues).slice(0, 100);
}

export function sourceFieldPropertyOptions(args: {
  type: DocumentPropertyType;
  metadata?: BuilderCmsModelFieldSummary | null;
  rows: Array<{ sourceValuesJson: string | null }>;
  sourceFieldKey: string;
}): DocumentPropertyOptions {
  const optionNames = sourceFieldOptionNames(args);
  if (
    (args.type === "select" || args.type === "multi_select") &&
    optionNames.length > 0
  ) {
    const usedIds = new Set<string>();
    return {
      options: optionNames.map((name, index) => ({
        id: uniqueOptionIdFromName(name, usedIds),
        name,
        color: SOURCE_OPTION_COLORS[index % SOURCE_OPTION_COLORS.length],
      })),
    };
  }
  return defaultPropertyOptions(args.type);
}

function builderFieldNameForSourceKey(sourceFieldKey: string) {
  return sourceFieldKey.replace(/^data\./, "").trim();
}

function builderModelFieldsFromMetadata(
  metadataJson: string | null | undefined,
): BuilderCmsModelFieldSummary[] {
  if (!metadataJson) return [];
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const fields = (parsed as { builderModelFields?: unknown })
      .builderModelFields;
    return Array.isArray(fields)
      ? fields.filter((field): field is BuilderCmsModelFieldSummary => {
          return (
            !!field &&
            typeof field === "object" &&
            typeof (field as BuilderCmsModelFieldSummary).name === "string" &&
            typeof (field as BuilderCmsModelFieldSummary).type === "string"
          );
        })
      : [];
  } catch {
    return [];
  }
}

export function builderMetadataForSourceField(args: {
  sourceFieldKey: string;
  sourceMetadataJson: string | null | undefined;
}) {
  const fieldName = builderFieldNameForSourceKey(args.sourceFieldKey);
  const sourceFieldKey = args.sourceFieldKey.trim();
  return (
    builderModelFieldsFromMetadata(args.sourceMetadataJson).find((field) => {
      const name = field.name.trim();
      return name === fieldName || `data.${name}` === sourceFieldKey;
    }) ?? null
  );
}

export default defineAction({
  description:
    "Create a local database property from an unmapped source field and bind the source field to that property.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceFieldId: z.string().describe("Source field mapping ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Source ID for stale field ID fallback"),
    sourceFieldKey: z
      .string()
      .optional()
      .describe("Stable source field key for stale field ID fallback"),
  }),
  run: async (
    args: AddContentDatabaseSourceFieldPropertyRequest,
  ): Promise<ContentDatabaseSourceFieldPropertyResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const db = getDb();
    let [field] = await db
      .select()
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.id, args.sourceFieldId));
    if (!field && args.sourceId && args.sourceFieldKey) {
      [field] = await db
        .select()
        .from(schema.contentDatabaseSourceFields)
        .where(
          and(
            eq(schema.contentDatabaseSourceFields.sourceId, args.sourceId),
            eq(
              schema.contentDatabaseSourceFields.sourceFieldKey,
              args.sourceFieldKey,
            ),
          ),
        );
    }
    if (!field) throw new Error("Source field not found.");

    const [source] = await db
      .select()
      .from(schema.contentDatabaseSources)
      .where(
        and(
          eq(schema.contentDatabaseSources.id, field.sourceId),
          eq(schema.contentDatabaseSources.databaseId, database.id),
        ),
      );
    if (!source) {
      throw new Error("Source field does not belong to this database.");
    }
    if (field.propertyId) {
      throw new Error("Source field is already mapped to a property.");
    }
    if (field.mappingType === "title") {
      throw new Error("The title source field is already mapped to Name.");
    }

    // A federated secondary source's rows have no local document (they join by
    // canonical key), so we don't materialize their values into
    // documentPropertyValues — the read path overlays them per row at query
    // time. Primary sources still copy values onto their backing documents.
    let federationRole: string | null = null;
    try {
      const parsed = JSON.parse(source.metadataJson ?? "{}") as {
        federation?: { role?: string };
      };
      federationRole = parsed.federation?.role ?? null;
    } catch {
      federationRole = null;
    }
    const isSecondary = federationRole === "secondary";

    const initialSourceRows = isSecondary
      ? []
      : await db
          .select()
          .from(schema.contentDatabaseSourceRows)
          .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
    const shouldRefreshBuilderField =
      !isSecondary &&
      source.sourceType === "builder-cms" &&
      initialSourceRows.some(
        (row) => !hasSourceFieldValue(row, field.sourceFieldKey),
      );
    let builderEntries: BuilderCmsSourceEntry[] | null = null;
    if (shouldRefreshBuilderField) {
      // Read before writing so a Builder outage cannot leave behind a cleanly
      // reported but empty property. Start at zero even when the source's
      // broader refresh is incremental: the stored rows we are backfilling
      // begin with that first page.
      const builderRead = await readBuilderCmsContentEntries({
        model: source.sourceTable,
        fieldPaths: [field.sourceFieldKey],
        limit: Math.max(
          BUILDER_FIELD_REFRESH_MINIMUM_LIMIT,
          initialSourceRows.length,
        ),
        offset: 0,
      });
      if (builderRead.state !== "live") {
        throw new Error(
          builderRead.message ??
            "Builder CMS could not refresh this field. No property was created.",
        );
      }
      if (initialSourceRows.length > 0 && builderRead.entries.length === 0) {
        throw new Error(
          "Builder CMS returned no entries for this source. No property was created; refresh the source and try again.",
        );
      }
      builderEntries = builderRead.entries;
    }

    // Keep the local snapshot, property definition, mapping, and materialized
    // values atomic. Re-read rows after the provider request so a concurrent
    // source refresh cannot be overwritten by the older pre-request snapshot.
    return await db.transaction(async (tx) => {
      const now = new Date().toISOString();
      const visibility = normalizePropertyVisibility(undefined);
      const propertyId = nanoid();
      const [currentField] = await tx
        .select()
        .from(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.id, field.id));
      if (!currentField) throw new Error("Source field not found.");
      if (currentField.propertyId) {
        throw new Error("Source field is already mapped to a property.");
      }
      if (currentField.mappingType === "title") {
        throw new Error("The title source field is already mapped to Name.");
      }
      if (currentField.sourceId !== source.id) {
        throw new Error("Source field does not belong to this database.");
      }
      const [currentSource] = await tx
        .select()
        .from(schema.contentDatabaseSources)
        .where(
          and(
            eq(schema.contentDatabaseSources.id, source.id),
            eq(schema.contentDatabaseSources.databaseId, database.id),
          ),
        );
      if (!currentSource) {
        throw new Error("Source field does not belong to this database.");
      }

      let sourceRows = isSecondary
        ? []
        : await tx
            .select()
            .from(schema.contentDatabaseSourceRows)
            .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
      if (builderEntries) {
        const merged = mergeBuilderFieldIntoSourceRows({
          rows: sourceRows,
          entries: builderEntries,
          sourceTable: source.sourceTable,
          sourceFieldKey: currentField.sourceFieldKey,
          now,
        });
        if (merged.matchedMissingRows < merged.missingRows) {
          throw new Error(
            "Builder CMS did not return entries for every stored source row. No property was created; refresh the source and try again.",
          );
        }
        for (let index = 0; index < merged.rows.length; index += 1) {
          const currentRow = sourceRows[index];
          const mergedRow = merged.rows[index];
          if (
            !currentRow ||
            !mergedRow ||
            currentRow.sourceValuesJson === mergedRow.sourceValuesJson
          ) {
            continue;
          }
          const [updatedRow] = await tx
            .update(schema.contentDatabaseSourceRows)
            .set({
              sourceValuesJson: mergedRow.sourceValuesJson,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.contentDatabaseSourceRows.id, currentRow.id),
                eq(
                  schema.contentDatabaseSourceRows.sourceValuesJson,
                  currentRow.sourceValuesJson,
                ),
              ),
            )
            .returning({ id: schema.contentDatabaseSourceRows.id });
          if (!updatedRow) {
            throw new Error(
              "The Builder source changed while adding this property. No property was created; try again.",
            );
          }
        }
        sourceRows = merged.rows;
      } else if (
        source.sourceType === "builder-cms" &&
        sourceRows.some(
          (row) => !hasSourceFieldValue(row, currentField.sourceFieldKey),
        )
      ) {
        throw new Error(
          "The Builder source changed while adding this property. No property was created; try again.",
        );
      }

      const builderMetadata = builderMetadataForSourceField({
        sourceFieldKey: currentField.sourceFieldKey,
        sourceMetadataJson: currentSource.metadataJson,
      });
      const type = propertyTypeForSourceField(
        currentField.sourceFieldType,
        builderMetadata,
      );
      const options = sourceFieldPropertyOptions({
        type,
        metadata: builderMetadata,
        rows: sourceRows,
        sourceFieldKey: currentField.sourceFieldKey,
      });
      const [maxPos] = await tx
        .select({
          max: sql<number>`COALESCE(MAX(position), -1)`,
        })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(
              schema.documentPropertyDefinitions.ownerEmail,
              database.ownerEmail,
            ),
            eq(schema.documentPropertyDefinitions.databaseId, database.id),
          ),
        );
      const position = (maxPos?.max ?? -1) + 1;

      await tx.insert(schema.documentPropertyDefinitions).values({
        id: propertyId,
        ownerEmail: database.ownerEmail,
        orgId: database.orgId ?? null,
        databaseId: database.id,
        name: currentField.sourceFieldLabel,
        type,
        visibility,
        optionsJson: serializePropertyOptions(options),
        position,
        createdAt: now,
        updatedAt: now,
      });

      const [mappedField] = await tx
        .update(schema.contentDatabaseSourceFields)
        .set({
          propertyId,
          localFieldKey: propertyId,
          mappingType: "property",
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.contentDatabaseSourceFields.id, currentField.id),
            isNull(schema.contentDatabaseSourceFields.propertyId),
          ),
        )
        .returning({ id: schema.contentDatabaseSourceFields.id });
      if (!mappedField) {
        throw new Error("Source field is already mapped to a property.");
      }

      await tx
        .update(schema.contentDatabaseSources)
        .set({ updatedAt: now })
        .where(eq(schema.contentDatabaseSources.id, currentSource.id));

      const itemValues = sourceFieldPropertyValuesFromRows(
        sourceRows,
        currentField.sourceFieldKey,
        type,
        options,
      );
      if (itemValues.length > 0) {
        for (const chunk of chunks(itemValues, 200)) {
          await tx.insert(schema.documentPropertyValues).values(
            chunk.map((row) => ({
              id: nanoid(),
              ownerEmail: database.ownerEmail,
              documentId: row.documentId,
              propertyId,
              valueJson: serializePropertyValue(row.value),
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
      }

      const sourceField = serializeSourceField(
        {
          ...currentField,
          propertyId,
          localFieldKey: propertyId,
          mappingType: "property",
          updatedAt: now,
        },
        currentField.sourceFieldLabel,
      );

      return {
        databaseId: database.id,
        documentId: database.documentId,
        property: {
          definition: {
            id: propertyId,
            databaseId: database.id,
            name: currentField.sourceFieldLabel,
            type,
            visibility,
            options,
            position,
            createdAt: now,
            updatedAt: now,
          },
          value: null,
          editable: true,
        },
        sourceField,
        itemValues,
      };
    });
  },
});
