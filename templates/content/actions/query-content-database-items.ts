import { defineAction } from "@agent-native/core";
import { z } from "zod";

import type {
  ContentDatabaseItemsPageResponse,
  ContentDatabaseUnavailableResponse,
} from "../shared/api.js";
import {
  CONTENT_DATABASE_MAX_READ_LIMIT,
  contentDatabaseTableQuerySchema,
  getContentDatabasePageResponse,
  resolveContentDatabaseRead,
} from "./_database-utils.js";

export default defineAction({
  description:
    "Query one ordered and filtered page of a content database without reopening its metadata.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONTENT_DATABASE_MAX_READ_LIMIT)
      .optional(),
    offset: z.coerce.number().int().min(0).optional(),
    tableQuery: contentDatabaseTableQuerySchema,
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async ({
    databaseId,
    documentId,
    limit,
    offset,
    tableQuery,
  }): Promise<
    ContentDatabaseItemsPageResponse | ContentDatabaseUnavailableResponse
  > => {
    const resolved = await resolveContentDatabaseRead({
      databaseId,
      documentId,
    });
    if (!resolved.available) return resolved;

    const page = await getContentDatabasePageResponse(resolved.database.id, {
      // This action is the bounded table replacement path; unlike the legacy
      // database response, an omitted limit must not turn it into a full read.
      limit: limit ?? 100,
      offset,
      tableQuery,
      database: resolved.database,
    });
    return {
      items: page.items,
      source: page.source,
      sources: page.sources,
      pagination: page.pagination,
      tableQueryMode: page.tableQueryMode,
    };
  },
});
