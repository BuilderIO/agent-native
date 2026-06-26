import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type {
  BindContentDatabaseSourceFieldRequest,
  ContentDatabaseResponse,
} from "../shared/api.js";
import { serializePropertyValue } from "../shared/properties.js";
import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "./_property-utils.js";
import {
  propertyTypeForSourceField,
  sourceFieldPropertyValuesFromRows,
} from "./add-content-database-source-field-property.js";
import { resolveDatabaseForSourceMutation } from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const SOURCE_TAG_PROPERTY_NAME = "Source";

export default defineAction({
  description:
    "Bind a source field to an existing database column (row-union per-source field binding), or unbind it. Binding routes the source's per-row values into the shared column; types must be compatible. Pass propertyId: null to unbind.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceFieldId: z.string().describe("Source field mapping ID"),
    propertyId: z
      .string()
      .nullable()
      .describe(
        "Target column property to bind the field to, or null to unbind.",
      ),
  }),
  run: async (
    args: BindContentDatabaseSourceFieldRequest,
  ): Promise<ContentDatabaseResponse> => {
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
    if (field.mappingType === "title") {
      throw new Error("The title field is bound to Name and can't be rebound.");
    }
    if (field.mappingType === "system" || field.writeOwner === "derived") {
      throw new Error("Integration-managed fields can't be bound to a column.");
    }

    const now = new Date().toISOString();

    // ── Unbind ────────────────────────────────────────────────────────────
    if (args.propertyId === null) {
      await db
        .update(schema.contentDatabaseSourceFields)
        .set({
          propertyId: null,
          localFieldKey: field.sourceFieldKey,
          updatedAt: now,
        })
        .where(eq(schema.contentDatabaseSourceFields.id, field.id));
      await db
        .update(schema.contentDatabaseSources)
        .set({ updatedAt: now })
        .where(eq(schema.contentDatabaseSources.id, source.id));
      return getContentDatabaseResponse(database.id);
    }

    // ── Bind to an existing column ─────────────────────────────────────────
    const [property] = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.id, args.propertyId),
          eq(schema.documentPropertyDefinitions.databaseId, database.id),
        ),
      );
    if (!property) {
      throw new Error("Target column does not belong to this database.");
    }
    // The auto-created "Source" tag is internal row-tagging, never a writable
    // bind target.
    if (
      property.name === SOURCE_TAG_PROPERTY_NAME &&
      property.type === "select"
    ) {
      throw new Error("The Source tag column can't be bound to a source field.");
    }
    // Only type-compatible fields can share a column. A `text` column is a
    // permissive target (it can render any scalar); otherwise the field's
    // derived type must match the column's type.
    const fieldType = propertyTypeForSourceField(field.sourceFieldType);
    if (property.type !== "text" && property.type !== fieldType) {
      throw new Error(
        `Field type "${fieldType}" is not compatible with the "${property.type}" column.`,
      );
    }

    await db
      .update(schema.contentDatabaseSourceFields)
      .set({
        propertyId: property.id,
        localFieldKey: property.id,
        mappingType: "property",
        updatedAt: now,
      })
      .where(eq(schema.contentDatabaseSourceFields.id, field.id));
    await db
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    // Backfill the column with this source's per-row values. A federated
    // secondary's rows carry no local document (the read path overlays them),
    // so only materialize for document-backed sources.
    let federationRole: string | null = null;
    try {
      const parsed = JSON.parse(source.metadataJson ?? "{}") as {
        federation?: { role?: string };
      };
      federationRole = parsed.federation?.role ?? null;
    } catch {
      federationRole = null;
    }
    if (federationRole !== "secondary") {
      const sourceRows = await db
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
      const itemValues = sourceFieldPropertyValuesFromRows(
        sourceRows,
        field.sourceFieldKey,
        property.type,
      );
      if (itemValues.length > 0) {
        const documentIds = itemValues.map((row) => row.documentId);
        // Replace any prior values for these rows on this column so re-binding
        // is idempotent (this source owns these documents' values).
        await db
          .delete(schema.documentPropertyValues)
          .where(
            and(
              eq(schema.documentPropertyValues.propertyId, property.id),
              inArray(schema.documentPropertyValues.documentId, documentIds),
            ),
          );
        await db.insert(schema.documentPropertyValues).values(
          itemValues.map((row) => ({
            id: nanoid(),
            ownerEmail: database.ownerEmail,
            documentId: row.documentId,
            propertyId: property.id,
            valueJson: serializePropertyValue(row.value),
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    }

    return getContentDatabaseResponse(database.id);
  },
});
