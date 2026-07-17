import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isComputedPropertyType,
  type DocumentPropertyType,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { commitContentDatabaseItem } from "./_content-database-item-mutations.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { normalizedValueJson } from "./_property-utils.js";

export default defineAction({
  description: "Add a page item to a content database table.",
  schema: z.object({
    databaseId: z.string().describe("Database ID"),
    title: z.string().optional().describe("New row page title"),
    propertyValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Initial property values keyed by property definition ID"),
    submissionIntent: z
      .enum(["draft", "submitted"])
      .optional()
      .describe(
        "Whether this atomic operation is a draft row or a completed agent/API submission. Defaults to draft.",
      ),
  }),
  run: async ({ databaseId, title, propertyValues, submissionIntent }, ctx) => {
    const db = getDb();
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, databaseId),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    if (!database) throw new Error(`Database "${databaseId}" not found`);

    const initialValues = Object.entries(propertyValues ?? {});
    const normalizedValues = new Map<string, DocumentPropertyValue>();
    let definitions: Array<
      typeof schema.documentPropertyDefinitions.$inferSelect
    > = [];
    if (initialValues.length > 0) {
      const requestedPropertyIds = initialValues.map(
        ([propertyId]) => propertyId,
      );
      definitions = await db
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(
              schema.documentPropertyDefinitions.ownerEmail,
              database.ownerEmail,
            ),
            eq(schema.documentPropertyDefinitions.databaseId, databaseId),
            inArray(
              schema.documentPropertyDefinitions.id,
              requestedPropertyIds,
            ),
          ),
        );
      const definitionById = new Map(
        definitions.map((definition) => [definition.id, definition]),
      );

      for (const [propertyId, value] of initialValues) {
        const definition = definitionById.get(propertyId);
        const type = definition?.type as DocumentPropertyType | undefined;
        if (!definition || !type || isComputedPropertyType(type)) continue;
        normalizedValues.set(
          propertyId,
          JSON.parse(normalizedValueJson(type, value)) as DocumentPropertyValue,
        );
      }
    }
    const mutation = await commitContentDatabaseItem({
      databaseId,
      title,
      values: normalizedValues,
      intent: submissionIntent ?? "draft",
      actionContext: ctx,
    });
    await writeAppState("refresh-signal", { ts: Date.now() }).catch(() => {
      // The row is already committed; polling will reconcile the refresh hint.
    });

    return {
      ...(await getContentDatabaseResponse(databaseId)),
      createdItemId: mutation.itemId,
      createdDocumentId: mutation.documentId,
    };
  },
});
