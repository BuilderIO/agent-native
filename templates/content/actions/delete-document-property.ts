import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isBlocksPropertyType,
  isPrimaryBlocksField,
  parsePropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  listPropertiesForDocument,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Delete a Notion-style property definition and its stored document values.",
  schema: z.object({
    documentId: z.string().describe("Document ID used to scope access"),
    propertyId: z.string().describe("Property definition ID to delete"),
  }),
  run: async ({ documentId, propertyId }) => {
    const access = await assertAccess("document", documentId, "editor");
    const document = access.resource;
    const db = getDb();
    const database = await resolvePropertyDatabaseForDocument(document);
    if (!database) throw new Error("Document is not part of a database.");

    const [definition] = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.id, propertyId),
          eq(
            schema.documentPropertyDefinitions.ownerEmail,
            document.ownerEmail,
          ),
          eq(schema.documentPropertyDefinitions.databaseId, database.id),
        ),
      );
    if (!definition) throw new Error(`Property "${propertyId}" not found`);

    const isBlocks = isBlocksPropertyType(
      definition.type as DocumentPropertyType,
    );
    const isPrimaryBlocks =
      isBlocks &&
      isPrimaryBlocksField(parsePropertyOptions(definition.optionsJson));

    await db
      .delete(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.propertyId, propertyId));
    await db
      .delete(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.id, propertyId));

    if (isBlocks) {
      // Drop the independent content for this Blocks field across every row.
      await db
        .delete(schema.documentBlockFieldContents)
        .where(eq(schema.documentBlockFieldContents.propertyId, propertyId));

      // Deleting the primary "Content" field removes the body (documents.content)
      // for every object of this type, per the delete warning shown in the UI.
      if (isPrimaryBlocks) {
        // Record that the primary was intentionally removed: clear the single
        // source of truth but LEAVE blocks_seeded = 1, so neither the read path
        // nor the startup repair ever recreates it. Deleting the only Blocks
        // field is an allowed product action that leaves the row metadata-only
        // with ZERO Blocks fields.
        await db
          .update(schema.contentDatabases)
          .set({
            primaryBlocksPropertyId: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.contentDatabases.id, database.id));

        const items = await db
          .select({ documentId: schema.contentDatabaseItems.documentId })
          .from(schema.contentDatabaseItems)
          .where(eq(schema.contentDatabaseItems.databaseId, database.id));
        const documentIds = items.map((item) => item.documentId);
        if (documentIds.length > 0) {
          const now = new Date().toISOString();
          await db
            .update(schema.documents)
            .set({ content: "", updatedAt: now })
            .where(inArray(schema.documents.id, documentIds));
        }
      }
    }

    // Free any source field that was mapped to this property so it returns to
    // the "From source" picker immediately, instead of staying orphaned until
    // the next source refresh reconciles it.
    const mappedFields = await db
      .select({
        id: schema.contentDatabaseSourceFields.id,
        sourceFieldKey: schema.contentDatabaseSourceFields.sourceFieldKey,
      })
      .from(schema.contentDatabaseSourceFields)
      .where(eq(schema.contentDatabaseSourceFields.propertyId, propertyId));
    if (mappedFields.length > 0) {
      const now = new Date().toISOString();
      for (const mapped of mappedFields) {
        await db
          .update(schema.contentDatabaseSourceFields)
          .set({
            propertyId: null,
            localFieldKey: mapped.sourceFieldKey,
            mappingType: "property",
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseSourceFields.id, mapped.id));
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument(document),
    };
  },
});
