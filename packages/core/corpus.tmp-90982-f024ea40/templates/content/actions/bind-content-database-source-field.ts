import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  BindContentDatabaseSourceFieldRequest,
  ContentDatabaseResponse,
} from "../shared/api.js";
import { serializePropertyValue } from "../shared/properties.js";
import { chunks } from "./_batch-utils.js";
import { resolveDatabaseForSourceMutation } from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { nanoid } from "./_property-utils.js";
import {
  propertyTypeForSourceField,
  sourceFieldPropertyValuesFromRows,
} from "./add-content-database-source-field-property.js";

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
      if (field.propertyId) {
        const sourceRows = await db
          .select({ documentId: schema.contentDatabaseSourceRows.documentId })
          .from(schema.contentDatabaseSourceRows)
          .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
        const sourceDocumentIds = sourceRows
          .map((row) => row.documentId)
          .filter((id): id is string => Boolean(id));
        if (sourceDocumentIds.length > 0) {
          await db
            .delete(schema.documentPropertyValues)
            .where(
              and(
                eq(schema.documentPropertyValues.propertyId, field.propertyId),
                inArray(
                  schema.documentPropertyValues.documentId,
                  sourceDocumentIds,
                ),
              ),
            );
        }
      }
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
      throw new Error(
        "The Source tag column can't be bound to a source field.",
      );
    }
    // Don't silently repoint a field that's already feeding another column —
    // that would orphan the old column's materialized values. Require an
    // explicit unbind first. (Re-binding to the SAME column is an idempotent
    // refresh and is allowed.)
    if (field.propertyId && field.propertyId !== property.id) {
      throw new Error(
        "This source field is already bound to another column. Unbind it first.",
      );
    }
    // At most one field per source per column: a column reads one value per row,
    // and a row belongs to one source. Enforce server-side, not just in the UI.
    const [conflictingField] = await db
      .select({ id: schema.contentDatabaseSourceFields.id })
      .from(schema.contentDatabaseSourceFields)
      .where(
        and(
          eq(schema.contentDatabaseSourceFields.sourceId, source.id),
          eq(schema.contentDatabaseSourceFields.propertyId, property.id),
          ne(schema.contentDatabaseSourceFields.id, field.id),
        ),
      );
    if (conflictingField) {
      throw new Error(
        "This source already feeds this column from another field. Unbind it first.",
      );
    }
    // Only type-compatible fields can share a column. A `text` column is a
    // permissive target for SCALAR fields; a multi-value (list) field would be
    // lossily stringified, so it needs a matching list/multi-select column.
    // Otherwise the field's derived type must equal the column's type.
    const fieldType = propertyTypeForSourceField(field.sourceFieldType);
    const fieldIsMultiValue = [
      "list",
      "array",
      "tags",
      "multi_select",
    ].includes(field.sourceFieldType.trim().toLowerCase());
    if (property.type === "text") {
      if (fieldIsMultiValue) {
        throw new Error(
          "A multi-value source field can't be bound to a text column.",
        );
      }
    } else if (property.type !== fieldType) {
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
        .select({
          databaseItemId: schema.contentDatabaseSourceRows.databaseItemId,
          documentId: schema.contentDatabaseSourceRows.documentId,
          sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
        })
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
      const itemValues = sourceFieldPropertyValuesFromRows(
        sourceRows,
        field.sourceFieldKey,
        property.type,
      );
      // Clear this column's values for ALL of this source's rows first — not
      // just the rows that now have a value — so a row whose new bound field is
      // empty doesn't keep showing a stale/previous value. Then write the
      // non-empty ones. (This source owns these documents' values for the row-
      // union, so clearing them is safe.)
      const sourceDocumentIds = sourceRows
        .map((row) => row.documentId)
        .filter((id): id is string => Boolean(id));
      if (sourceDocumentIds.length > 0) {
        await db
          .delete(schema.documentPropertyValues)
          .where(
            and(
              eq(schema.documentPropertyValues.propertyId, property.id),
              inArray(
                schema.documentPropertyValues.documentId,
                sourceDocumentIds,
              ),
            ),
          );
      }
      if (itemValues.length > 0) {
        for (const chunk of chunks(itemValues, 200)) {
          await db.insert(schema.documentPropertyValues).values(
            chunk.map((row) => ({
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
    }

    return getContentDatabaseResponse(database.id);
  },
});
