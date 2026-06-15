import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type {
  AddContentDatabaseSourceFieldPropertyRequest,
  ContentDatabaseSourceFieldPropertyResponse,
} from "../shared/api.js";
import {
  defaultPropertyOptions,
  normalizePropertyVisibility,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "./_property-utils.js";
import {
  resolveDatabaseForSourceMutation,
  serializeSourceField,
} from "./_database-source-utils.js";

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
  }),
  run: async (
    args: AddContentDatabaseSourceFieldPropertyRequest,
  ): Promise<ContentDatabaseSourceFieldPropertyResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const db = getDb();
    const [field] = await db
      .select()
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.id, args.sourceFieldId));
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
    };
  },
});
