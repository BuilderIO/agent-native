import { defineAction } from "@agent-native/core";
import { z } from "zod";

import type {
  ContentDatabaseResponse,
  ContentDatabaseUnavailableResponse,
} from "../shared/api.js";
import {
  CONTENT_DATABASE_MAX_READ_LIMIT,
  contentDatabaseTableQuerySchema,
  getContentDatabaseResponse,
  resolveContentDatabaseRead,
} from "./_database-utils.js";

export default defineAction({
  description:
    "Get a content database table, including its property schema and item pages.",
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
  run: async ({
    databaseId,
    documentId,
    limit,
    offset,
    tableQuery,
  }): Promise<ContentDatabaseResponse | ContentDatabaseUnavailableResponse> => {
    const resolved = await resolveContentDatabaseRead({
      databaseId,
      documentId,
    });
    if (!resolved.available) return resolved;

    return getContentDatabaseResponse(resolved.database.id, {
      limit,
      offset,
      tableQuery,
      database: resolved.database,
    });
  },
});
