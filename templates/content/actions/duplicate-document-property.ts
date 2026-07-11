import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isBlocksPropertyType,
  serializePropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import {
  propertyDefinitionsPositionScope,
  withPositionLock,
} from "./_position-utils.js";
import {
  listPropertiesForDocument,
  nanoid,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Duplicate a Notion-style property definition and copy its stored values.",
  schema: z.object({
    documentId: z.string().describe("Document ID used to scope access"),
    propertyId: z.string().describe("Property definition ID to duplicate"),
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

    const now = new Date().toISOString();
    const newPropertyId = nanoid();
    const isBlocks = isBlocksPropertyType(
      definition.type as DocumentPropertyType,
    );
    // A duplicated Blocks field is a brand-new, independent, EMPTY field — never
    // primary (only one field backs the body) and with no copied content.
    const optionsJson = isBlocks
      ? serializePropertyOptions({ blocks: { primary: false } })
      : definition.optionsJson;

    await withPositionLock(
      propertyDefinitionsPositionScope(database.id),
      async () => {
        const [maxPos] = await db
          .select({
            max: sql<number>`COALESCE(MAX(position), -1)`,
          })
          .from(schema.documentPropertyDefinitions)
          .where(
            and(
              eq(
                schema.documentPropertyDefinitions.ownerEmail,
                document.ownerEmail,
              ),
              eq(schema.documentPropertyDefinitions.databaseId, database.id),
            ),
          );

        await db.insert(schema.documentPropertyDefinitions).values({
          id: newPropertyId,
          ownerEmail: definition.ownerEmail,
          orgId: definition.orgId,
          databaseId: database.id,
          name: `${definition.name} copy`,
          type: definition.type,
          visibility: definition.visibility,
          optionsJson,
          position: (maxPos?.max ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        });
      },
    );

    // Blocks fields don't use document_property_values; a duplicate starts empty.
    if (!isBlocks) {
      const values = await db
        .select()
        .from(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, propertyId));
      if (values.length > 0) {
        await db.insert(schema.documentPropertyValues).values(
          values.map((value) => ({
            id: nanoid(),
            ownerEmail: value.ownerEmail,
            documentId: value.documentId,
            propertyId: newPropertyId,
            valueJson: value.valueJson,
            createdAt: now,
            updatedAt: now,
          })),
        );
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
