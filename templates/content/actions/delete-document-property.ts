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
import { deleteBlocksFieldIdentity } from "./_blocks-field-identity.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import {
  listPropertiesForDocument,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Delete a Notion-style property definition and its stored document values.",
  schema: z.object({
    documentId: z.string().describe("Document ID used to scope access"),
    databaseId: z
      .string()
      .optional()
      .describe(
        "Database ID that owns the property; omit only for context-free entry points",
      ),
    propertyId: z.string().describe("Property definition ID to delete"),
  }),
  run: async ({ documentId, databaseId, propertyId }) => {
    const access = await assertAccess("document", documentId, "editor");
    const document = access.resource;
    const db = getDb();
    const database = await resolvePropertyDatabaseForDocument(
      document,
      databaseId,
      "editor",
    );
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
    if (definition.systemRole) {
      throw new Error("System properties cannot be deleted.");
    }

    await db.transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as ReturnType<typeof getDb>,
        database.id,
      );
      const memberships = await tx
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.databaseId, database.id));
      await lockDatabaseMemberships(
        tx,
        memberships.map((membership) => membership.id),
      );
      const [lockedDefinition] = await tx
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
      if (!lockedDefinition)
        throw new Error(`Property "${propertyId}" not found`);
      if (lockedDefinition.systemRole) {
        throw new Error("System properties cannot be deleted.");
      }

      const isBlocks = isBlocksPropertyType(
        lockedDefinition.type as DocumentPropertyType,
      );
      const isPrimaryBlocks =
        isBlocks &&
        isPrimaryBlocksField(
          parsePropertyOptions(lockedDefinition.optionsJson),
        );

      await tx
        .delete(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, propertyId));
      await tx
        .delete(schema.contentDatabaseItemKeyClaims)
        .where(
          and(
            eq(schema.contentDatabaseItemKeyClaims.databaseId, database.id),
            eq(schema.contentDatabaseItemKeyClaims.propertyId, propertyId),
          ),
        );
      await tx
        .delete(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.id, propertyId));

      if (isBlocks) {
        await deleteBlocksFieldIdentity({
          db: tx as unknown as ReturnType<typeof getDb>,
          propertyId,
        });
        await tx
          .delete(schema.documentBlockFieldContents)
          .where(eq(schema.documentBlockFieldContents.propertyId, propertyId));

        if (isPrimaryBlocks) {
          await tx
            .update(schema.contentDatabases)
            .set({
              primaryBlocksPropertyId: null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.contentDatabases.id, database.id));

          const items = await tx
            .select({ documentId: schema.contentDatabaseItems.documentId })
            .from(schema.contentDatabaseItems)
            .where(eq(schema.contentDatabaseItems.databaseId, database.id));
          if (items.length > 0) {
            const now = new Date().toISOString();
            await tx
              .update(schema.documents)
              .set({ content: "", updatedAt: now })
              .where(
                inArray(
                  schema.documents.id,
                  items.map((item) => item.documentId),
                ),
              );
          }
        }
      }

      const mappedFields = await tx
        .select({
          id: schema.contentDatabaseSourceFields.id,
          sourceFieldKey: schema.contentDatabaseSourceFields.sourceFieldKey,
        })
        .from(schema.contentDatabaseSourceFields)
        .where(eq(schema.contentDatabaseSourceFields.propertyId, propertyId));
      const now = new Date().toISOString();
      for (const mapped of mappedFields) {
        await tx
          .update(schema.contentDatabaseSourceFields)
          .set({
            propertyId: null,
            localFieldKey: mapped.sourceFieldKey,
            mappingType: "property",
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseSourceFields.id, mapped.id));
      }
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument(document, database.id),
    };
  },
});
