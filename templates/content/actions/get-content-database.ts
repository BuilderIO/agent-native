import { defineAction, type ActionRunContext } from "@agent-native/core/action";
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

const getContentDatabaseSchema = z.object({
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
});

export function resolveContentDatabaseReadLimit(
  limit: number | undefined,
  caller: ActionRunContext["caller"] | undefined,
) {
  return limit ?? (caller === "frontend" ? undefined : 100);
}

export default defineAction({
  description:
    "Get a content database table, including its property schema, mutation contract, and item pages. Refresh this read immediately before a row write, then copy its mutation target and schema revision; for updates, copy the selected item's membership id as itemId, its document.id as documentId, and its rowRevision as expectedRowRevision.",
  mcpTool: true,
  schema: getContentDatabaseSchema,
  agentInputSchema: getContentDatabaseSchema.extend({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONTENT_DATABASE_MAX_READ_LIMIT)
      .default(100)
      .describe("Page size; defaults to 100. Paginate with offset."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (
    { databaseId, documentId, limit, offset, tableQuery },
    context,
  ): Promise<ContentDatabaseResponse | ContentDatabaseUnavailableResponse> => {
    const resolved = await resolveContentDatabaseRead({
      databaseId,
      documentId,
    });
    if (!resolved.available) return resolved;

    return getContentDatabaseResponse(resolved.database.id, {
      limit: resolveContentDatabaseReadLimit(limit, context?.caller),
      offset,
      tableQuery,
      database: resolved.database,
    });
  },
});
