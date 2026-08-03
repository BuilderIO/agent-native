import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type {
  BuilderCmsAttachPreviewResponse,
  ContentDatabaseItem,
} from "../shared/api.js";
import { readBuilderCmsContentEntries } from "./_builder-cms-read-client.js";
import {
  builderCmsImportIds,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

export default defineAction({
  description:
    "Preview the first projected Builder rows for a database source attachment without writing local or provider data.",
  schema: z.object({
    databaseId: z.string().optional(),
    documentId: z.string().optional(),
    sourceTable: z.string().min(1).max(500),
    fieldPaths: z.array(z.string().max(500)).max(200).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<BuilderCmsAttachPreviewResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const [read, base] = await Promise.all([
      readBuilderCmsContentEntries({
        model: args.sourceTable,
        fieldPaths: args.fieldPaths,
        allowCached: true,
        maxPages: 1,
      }),
      getContentDatabaseResponse(database.id, { limit: 100, offset: 0 }),
    ]);
    if (read.state !== "live") {
      throw new Error(
        read.message ?? "Builder rows are not available for preview.",
      );
    }

    const items: ContentDatabaseItem[] = read.entries.map((entry, index) => {
      const ids = builderCmsImportIds({
        ownerEmail: database.ownerEmail,
        databaseId: database.id,
        sourceTable: args.sourceTable,
        entryId: entry.id,
      });
      return {
        id: ids.itemId,
        databaseId: database.id,
        document: {
          id: ids.documentId,
          parentId: database.documentId,
          title: entry.title.trim() || entry.id,
          content: "",
          icon: null,
          position: index,
          isFavorite: false,
          hideFromSearch: false,
          accessRole: "viewer",
          canEdit: false,
          canManage: false,
          createdAt: entry.updatedAt,
          updatedAt: entry.updatedAt,
        },
        position: index,
        properties: [],
        bodyHydration: {
          status: "pending",
          attemptedAt: null,
          error: null,
          version: null,
        },
      };
    });
    return {
      databaseId: database.id,
      documentId: database.documentId,
      sourceTable: args.sourceTable,
      base,
      items,
      fetchedAt: read.fetchedAt,
      hasMore: read.progress.hasMore,
    };
  },
});
