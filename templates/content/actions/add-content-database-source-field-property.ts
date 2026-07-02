import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  AddContentDatabaseSourceFieldPropertyRequest,
  ContentDatabaseSourceFieldPropertyResponse,
  DocumentPropertyValue,
} from "../shared/api.js";
import {
  defaultPropertyOptions,
  normalizePropertyValue,
  normalizePropertyVisibility,
  serializePropertyValue,
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
): DocumentPropertyType {
  if (sourceFieldType === "number") return "number";
  if (sourceFieldType === "datetime" || sourceFieldType === "date") {
    return "date";
  }
  if (sourceFieldType === "url") return "url";
  if (sourceFieldType === "boolean" || sourceFieldType === "checkbox") {
    return "checkbox";
  }
  return "text";
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
    const type = propertyTypeForSourceField(field.sourceFieldType);
    const visibility = normalizePropertyVisibility(undefined);
    const options = defaultPropertyOptions(type);
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

    await db.insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId ?? null,
      databaseId: database.id,
      name: field.sourceFieldLabel,
      type,
      visibility,
      optionsJson: JSON.stringify(options),
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
