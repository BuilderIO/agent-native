import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
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
  normalizePropertyVisibility,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptionColor,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  resolveDatabaseForSourceMutation,
  serializeSourceField,
} from "./_database-source-utils.js";
import { nanoid } from "./_property-utils.js";

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

export function sourceFieldPropertyValuesFromRows(
  rows: Array<{
    databaseItemId: string;
    documentId: string;
    sourceValuesJson: string | null;
  }>,
  sourceFieldKey: string,
  type: DocumentPropertyType,
) {
  return rows
    .map((row) => {
      const sourceValues = parseSourceValues(row.sourceValuesJson);
      const sourceValue = sourceValues[sourceFieldKey];
      const value = normalizePropertyValue(type, sourceValue);
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

function sourceFieldPropertyOptions(args: {
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
    return {
      options: optionNames.map((name, index) => ({
        id: optionIdFromName(name),
        name,
        color: SOURCE_OPTION_COLORS[index % SOURCE_OPTION_COLORS.length],
      })),
    };
  }
  return defaultPropertyOptions(args.type);
}

function builderFieldNameForSourceKey(sourceFieldKey: string) {
  return sourceFieldKey
    .replace(/^data\./, "")
    .trim()
    .toLowerCase();
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

function builderMetadataForSourceField(args: {
  sourceFieldKey: string;
  sourceMetadataJson: string | null | undefined;
}) {
  const fieldName = builderFieldNameForSourceKey(args.sourceFieldKey);
  const sourceFieldKey = args.sourceFieldKey.trim().toLowerCase();
  return (
    builderModelFieldsFromMetadata(args.sourceMetadataJson).find((field) => {
      const name = field.name.trim().toLowerCase();
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

    const now = new Date().toISOString();
    const visibility = normalizePropertyVisibility(undefined);
    const [maxPos] = await db
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
    const propertyId = nanoid();

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

    const sourceRows = isSecondary
      ? []
      : await db
          .select()
          .from(schema.contentDatabaseSourceRows)
          .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
    const builderMetadata = builderMetadataForSourceField({
      sourceFieldKey: field.sourceFieldKey,
      sourceMetadataJson: source.metadataJson,
    });
    const type = propertyTypeForSourceField(
      field.sourceFieldType,
      builderMetadata,
    );
    const options = sourceFieldPropertyOptions({
      type,
      metadata: builderMetadata,
      rows: sourceRows,
      sourceFieldKey: field.sourceFieldKey,
    });

    await db.insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId ?? null,
      databaseId: database.id,
      name: field.sourceFieldLabel,
      type,
      visibility,
      optionsJson: serializePropertyOptions(options),
      position: (maxPos?.max ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(schema.contentDatabaseSourceFields)
      .set({
        propertyId,
        localFieldKey: propertyId,
        mappingType: "property",
        updatedAt: now,
      })
      .where(eq(schema.contentDatabaseSourceFields.id, field.id));

    await db
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    const itemValues = sourceFieldPropertyValuesFromRows(
      sourceRows,
      field.sourceFieldKey,
      type,
    );
    if (itemValues.length > 0) {
      await db.insert(schema.documentPropertyValues).values(
        itemValues.map((row) => ({
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

    const sourceField = serializeSourceField(
      {
        ...field,
        propertyId,
        localFieldKey: propertyId,
        mappingType: "property",
        updatedAt: now,
      },
      field.sourceFieldLabel,
    );

    return {
      databaseId: database.id,
      documentId: database.documentId,
      property: {
        definition: {
          id: propertyId,
          databaseId: database.id,
          name: field.sourceFieldLabel,
          type,
          visibility,
          options,
          position: (maxPos?.max ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        },
        value: null,
        editable: true,
      },
      sourceField,
      itemValues,
    };
  },
});
