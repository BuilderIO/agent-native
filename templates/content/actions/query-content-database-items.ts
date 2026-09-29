import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import type {
  ContentDatabaseItemsPageResponse,
  ContentDatabaseNavigationPageResponse,
  ContentDatabaseUnavailableResponse,
} from "../shared/api.js";
import { getContentDatabaseNavigationPage } from "./_database-navigation.js";
import {
  CONTENT_DATABASE_MAX_READ_LIMIT,
  contentDatabaseTableQuerySchema,
  getContentDatabasePageResponse,
  resolveContentDatabaseRead,
} from "./_database-utils.js";

export default defineAction({
  description:
    "Query one ordered and filtered page of a content collection without reopening its metadata.",
  schema: z.object({
    databaseId: z.string().optional().describe("Collection ID"),
    documentId: z.string().optional().describe("Collection document/page ID"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONTENT_DATABASE_MAX_READ_LIMIT)
      .optional(),
    offset: z.coerce.number().int().min(0).optional(),
    tableQuery: contentDatabaseTableQuerySchema,
    navigation: z
      .object({
        parentId: z
          .string()
          .nullable()
          .describe(
            "null for roots, or the exact immediate parent document ID",
          ),
        sort: z
          .enum(["custom", "name", "created", "last_edited"])
          .default("custom")
          .describe("Sidebar order; defaults to custom"),
        viewId: z
          .string()
          .optional()
          .describe("Personal View ID used for custom order"),
        cursor: z
          .string()
          .min(1)
          .optional()
          .describe("Opaque cursor returned by the previous matching page"),
      })
      .optional()
      .describe(
        "Bounded Files navigation query. parentId is required and must be null for roots or an exact immediate parent ID.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (
    { databaseId, documentId, limit, offset, tableQuery, navigation },
    ctx,
  ): Promise<
    | ContentDatabaseItemsPageResponse
    | ContentDatabaseUnavailableResponse
    | ContentDatabaseNavigationPageResponse
  > => {
    if (navigation && (offset !== undefined || tableQuery !== undefined)) {
      fail("Files navigation does not support offset or table constraints.", {
        errorCode: "unsupported_navigation_query",
        statusCode: 400,
      });
    }
    const userEmail = ctx?.userEmail;
    if (navigation && limit !== undefined && limit > 20) {
      fail("Files navigation supports at most 20 items per page.", {
        errorCode: "navigation_limit_exceeded",
        statusCode: 400,
      });
    }
    const resolved = await resolveContentDatabaseRead({
      databaseId,
      documentId,
    });
    if (!resolved.available) return resolved;

    if (navigation) {
      if (!userEmail) throw new Error("Not authenticated.");
      return getContentDatabaseNavigationPage({
        database: resolved.database,
        userEmail,
        parentId: navigation.parentId,
        sort: navigation.sort,
        viewId: navigation.viewId,
        limit: limit ?? 20,
        cursor: navigation.cursor,
      });
    }

    const page = await getContentDatabasePageResponse(resolved.database.id, {
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
