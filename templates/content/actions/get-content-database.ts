import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import type {
  ContentDatabaseResponse,
  ContentDatabaseUnavailableResponse,
  ContentSidebarViewOrder,
} from "../shared/api.js";
import { readPersonalDatabaseViewOverrides } from "./_content-database-personal-view.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import {
  CONTENT_DATABASE_MAX_READ_LIMIT,
  contentDatabaseTableQuerySchema,
  getContentDatabaseResponse,
  resolveContentDatabaseRead,
} from "./_database-utils.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";

const getContentDatabaseSchema = z.object({
  databaseId: z.string().optional().describe("Collection ID"),
  documentId: z.string().optional().describe("Collection document/page ID"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CONTENT_DATABASE_MAX_READ_LIMIT)
    .optional(),
  offset: z.coerce.number().int().min(0).optional(),
  contentSpaceId: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe(
      "For the personal Favorites database only, filter rows to authoritative Files membership in this Content space before pagination.",
    ),
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
    "Get a content collection table, including its property schema, mutation contract, and item pages. Refresh this read immediately before a row write, then copy its mutation target and schema revision; for updates, copy the selected item's membership id as itemId, its document.id as documentId, and its rowRevision as expectedRowRevision.",
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
    { databaseId, documentId, limit, offset, tableQuery, contentSpaceId },
    context,
  ): Promise<ContentDatabaseResponse | ContentDatabaseUnavailableResponse> => {
    const resolved = await resolveContentDatabaseRead({
      databaseId,
      documentId,
    });
    if (!resolved.available) return resolved;

    let filesMembershipDatabaseId: string | undefined;
    let sidebarOrder: ContentSidebarViewOrder | undefined;
    if (contentSpaceId) {
      if (resolved.database.systemRole !== "favorites") {
        throw new Error("Content-space scope is only valid for Favorites.");
      }
      const db = getDb();
      const access = await resolveContentSpaceAccess(contentSpaceId, "viewer", {
        db,
      });
      filesMembershipDatabaseId = access.space.filesDatabaseId;
      if (context?.userEmail) {
        const sharedConfig = parseDatabaseViewConfig(
          resolved.database.viewConfigJson,
        );
        const overrides = await readPersonalDatabaseViewOverrides(
          context.userEmail,
          resolved.database.id,
        );
        const activeViewId =
          overrides?.activeViewId &&
          sharedConfig.views.some((view) => view.id === overrides.activeViewId)
            ? overrides.activeViewId
            : sharedConfig.activeViewId;
        sidebarOrder = overrides?.views.find((view) => view.id === activeViewId)
          ?.sidebarOrder ?? { mode: "custom", itemIds: [] };
      }
    }

    return getContentDatabaseResponse(resolved.database.id, {
      limit: resolveContentDatabaseReadLimit(limit, context?.caller),
      offset,
      tableQuery,
      database: resolved.database,
      filesMembershipDatabaseId,
      sidebarOrder,
    });
  },
});
