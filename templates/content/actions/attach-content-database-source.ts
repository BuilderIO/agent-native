import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import type {
  ContentDatabaseResponse,
  ContentDatabaseSourceType,
} from "../shared/api.js";
import {
  getExistingSource,
  getSourceRows,
  importBuilderCmsEntriesAsDatabaseItems,
  replaceSourceMetadata,
  resolveDatabaseForSourceMutation,
  seedMockSourceFields,
  seedMockSourceRows,
  sourceSetupPayload,
  updateBuilderCmsSourceReadMetadata,
} from "./_database-source-utils.js";
import {
  readBuilderCmsContentEntries,
  readBuilderCmsModelFields,
} from "./_builder-cms-read-client.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const sourceTypeSchema = z
  .enum(["mock-local", "builder-cms"])
  .default("mock-local");

export default defineAction({
  description:
    "Attach or replace a safe local source binding for a content database. Builder CMS bindings store source metadata, field mappings, row identity, provenance, freshness, capabilities, and local-only diff state without calling external APIs.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceType: sourceTypeSchema.describe(
      "Source type. Defaults to mock-local. Builder CMS is local metadata only in this slice.",
    ),
    sourceName: z
      .string()
      .optional()
      .describe("Display name for the source binding."),
    sourceTable: z
      .string()
      .optional()
      .describe("Source table/model name, for example content_items."),
  }),
  run: async (args): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const now = new Date().toISOString();
    const sourceType = (args.sourceType ??
      "mock-local") as ContentDatabaseSourceType;
    const sourceName =
      args.sourceName?.trim() ||
      (sourceType === "builder-cms" ? "Builder CMS" : "Mock local source");
    const sourceTable =
      args.sourceTable?.trim() ||
      (sourceType === "builder-cms" ? "blog_article" : "content_items");

    const existingSource = await getExistingSource(database.id);
    const existingSourceRows = existingSource
      ? await getSourceRows(existingSource.id)
      : [];
    const sourceId = await replaceSourceMetadata({
      database,
      source: existingSource,
      sourceType,
      sourceName,
      sourceTable,
      now,
    });
    const builderRead =
      sourceType === "builder-cms"
        ? await readBuilderCmsContentEntries({
            model: sourceTable,
          })
        : null;
    const builderModelFields =
      sourceType === "builder-cms"
        ? await readBuilderCmsModelFields({
            model: sourceTable,
          })
        : [];
    if (builderRead?.state === "live") {
      await importBuilderCmsEntriesAsDatabaseItems({
        database,
        entries: builderRead.entries,
        now,
        sourceTable,
        existingSourceRows,
      });
    }

    const refreshedSetup = await sourceSetupPayload(database.id);
    const builderEntriesByTitle =
      builderRead?.state === "live"
        ? new Map(
            builderRead.entries.map((entry) => [
              entry.title.trim().toLowerCase(),
              entry,
            ]),
          )
        : null;
    const builderEntriesByDocumentId = builderEntriesByTitle
      ? new Map(
          refreshedSetup.response.items
            .map((item) => {
              const entry = builderEntriesByTitle.get(
                item.document.title.trim().toLowerCase(),
              );
              return entry ? ([item.document.id, entry] as const) : null;
            })
            .filter((entry): entry is readonly [string, NonNullable<typeof builderRead>["entries"][number]] =>
              Boolean(entry),
            ),
        )
      : undefined;

    await seedMockSourceFields({
      sourceId,
      ownerEmail: database.ownerEmail,
      sourceType,
      properties: refreshedSetup.properties,
      builderModelFields,
      now,
    });
    await seedMockSourceRows({
      sourceId,
      ownerEmail: database.ownerEmail,
      sourceType,
      sourceTable,
      items: refreshedSetup.response.items,
      now,
      builderEntriesByDocumentId,
    });
    if (sourceType === "builder-cms" && builderRead) {
      await updateBuilderCmsSourceReadMetadata({
        sourceId,
        sourceTable,
        readState: builderRead.state,
        entryCount: builderRead.entries.length,
        matchedRowCount: builderEntriesByDocumentId?.size ?? 0,
        fetchedAt: builderRead.fetchedAt,
        now,
        message: builderRead.message,
        syncState: "linked",
      });
    }

    return getContentDatabaseResponse(database.id);
  },
});
