import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ContentDatabaseResponse } from "../shared/api.js";
import { getDb, schema } from "../server/db/index.js";
import {
  buildMockBodyChange,
  buildMockFieldChange,
  findOpenSourceChangeSet,
  getExistingSource,
  propertyForMockChange,
  resolveDatabaseForSourceMutation,
  sourceChangeSetKey,
  sourceChangeSetSummary,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

export default defineAction({
  description:
    "Create a local proposed source change-set for a database row. This stores a review-only field/body diff record and never executes external writes.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    itemDocumentId: z
      .string()
      .optional()
      .describe("Row document ID to target. Defaults to the first row."),
    propertyId: z
      .string()
      .optional()
      .describe(
        "Property ID to propose changing. Defaults to the first editable property on the row.",
      ),
    includeBodyChange: z
      .boolean()
      .optional()
      .describe("Also include a mock body diff in the stored change set."),
  }),
  run: async (args): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const source = await getExistingSource(database.id);
    if (!source) {
      throw new Error(
        "Attach a mock/local source binding before creating source change sets.",
      );
    }

    const response = await getContentDatabaseResponse(database.id);
    const item =
      (args.itemDocumentId
        ? response.items.find(
            (candidate) => candidate.document.id === args.itemDocumentId,
          )
        : response.items[0]) ?? null;
    if (!item) throw new Error("Database has no row to propose changes for.");

    const property = await propertyForMockChange({
      item,
      propertyId: args.propertyId,
    });
    const fieldChanges = property
      ? [
          buildMockFieldChange({
            property,
            currentValue: property.value,
          }),
        ]
      : [];
    const bodyChange = args.includeBodyChange
      ? buildMockBodyChange(item.document.content)
      : null;
    if (fieldChanges.length === 0 && !bodyChange) {
      throw new Error("No editable field or body change was available.");
    }

    const now = new Date().toISOString();
    const kind =
      bodyChange && fieldChanges.length === 0 ? "body_update" : "field_update";
    const summary = sourceChangeSetSummary({
      itemTitle: item.document.title,
      fieldChanges,
      bodyChange,
    });
    const changeSetKey = sourceChangeSetKey({
      documentId: item.document.id,
      databaseItemId: item.id,
      kind,
      direction: "incoming",
      pushMode: null,
      fieldChanges,
      bodyChange,
    });
    const existingOpenChangeSet = await findOpenSourceChangeSet({
      sourceId: source.id,
      key: changeSetKey,
    });

    if (existingOpenChangeSet) {
      await getDb()
        .update(schema.contentDatabaseSourceChangeSets)
        .set({
          summary,
          fieldChangesJson: JSON.stringify(fieldChanges),
          bodyChangeJson: bodyChange ? JSON.stringify(bodyChange) : null,
          updatedAt: now,
        })
        .where(
          eq(
            schema.contentDatabaseSourceChangeSets.id,
            existingOpenChangeSet.id,
          ),
        );
    } else {
      await getDb()
        .insert(schema.contentDatabaseSourceChangeSets)
        .values({
          id: crypto.randomUUID(),
          ownerEmail: database.ownerEmail,
          sourceId: source.id,
          databaseItemId: item.id,
          documentId: item.document.id,
          kind,
          direction: "incoming",
          state: "proposed",
          pushMode: null,
          localOnly: 1,
          summary,
          fieldChangesJson: JSON.stringify(fieldChanges),
          bodyChangeJson: bodyChange ? JSON.stringify(bodyChange) : null,
          createdAt: now,
          updatedAt: now,
        });
    }

    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    return getContentDatabaseResponse(database.id);
  },
});
