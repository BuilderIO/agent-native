import { defineAction, fail } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { withFederatedMembershipSnapshot } from "@agent-native/core/org";
import { ensureSettingsStore } from "@agent-native/core/settings";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import type {
  ContentDatabaseItemsPagePayload,
  ContentDatabaseNavigationPageResponse,
  ContentDatabasePersonalViewOverrides,
  ContentDatabaseUnavailableResponse,
} from "../shared/api.js";
import { compactContentDatabaseResponse } from "../shared/database-row-properties.js";
import { readPersonalDatabaseViewOverrides } from "./_content-database-personal-view.js";
import {
  getContentDatabaseNavigationPage,
  MAX_NAVIGATION_EXPAND_IDS,
} from "./_database-navigation.js";
import {
  CONTENT_DATABASE_MAX_READ_LIMIT,
  compactContentDatabaseRowsFor,
  contentDatabaseCompactRowsSchema,
  contentDatabaseTableQuerySchema,
  getContentDatabasePageResponse,
  resolveContentDatabaseRead,
} from "./_database-utils.js";
import { refreshGitHubSourceBeforeRead } from "./_github-source-freshness.js";

export default defineAction({
  description:
    "Query one ordered and filtered page of a content collection without reopening its metadata. Pass compactRows: true to get each row's property values by propertyId, with the definitions once in the top-level properties.",
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
    rowDocumentId: z
      .string()
      .min(1)
      .optional()
      .describe("Read only the row whose page is this document ID"),
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
        expand: z
          .array(z.string().min(1))
          .max(MAX_NAVIGATION_EXPAND_IDS)
          .optional()
          .describe(
            "Expanded document IDs, most important first; each one this read returns comes back with its first child page in branches, and branchesTruncated is true when the cap left any out",
          ),
        pagesOnly: z
          .boolean()
          .optional()
          .describe(
            "true leaves out a linked local folder's subfolder rows, for a picker that only takes pages",
          ),
        group: z
          .string()
          .min(1)
          .optional()
          .describe(
            "A group ID from a grouped top-level read's groups, with parentId null and that group's cursor; reads the group's next page",
          ),
        locate: z
          .string()
          .min(1)
          .optional()
          .describe(
            "A document ID, with parentId null and no cursor or group; returns the IDs of the groups that list it in locatedGroupIds, and no rows",
          ),
      })
      .optional()
      .describe(
        "Bounded Files navigation query. parentId is required and must be null for roots or an exact immediate parent ID.",
      ),
    compactRows: contentDatabaseCompactRowsSchema,
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (
    {
      databaseId,
      documentId,
      limit,
      offset,
      tableQuery,
      rowDocumentId,
      navigation,
      compactRows,
    },
    ctx,
  ): Promise<
    | ContentDatabaseItemsPagePayload
    | ContentDatabaseUnavailableResponse
    | ContentDatabaseNavigationPageResponse
  > => {
    if (
      navigation &&
      (offset !== undefined ||
        tableQuery !== undefined ||
        rowDocumentId !== undefined)
    ) {
      fail("Files navigation does not support offset or table constraints.", {
        errorCode: "unsupported_navigation_query",
        statusCode: 400,
      });
    }
    const userEmail = ctx?.userEmail;
    const databaseRef = {
      ...(databaseId !== undefined ? { databaseId } : {}),
      ...(documentId !== undefined ? { documentId } : {}),
    };
    if (navigation && limit !== undefined && limit > 20) {
      fail("Files navigation supports at most 20 items per page.", {
        errorCode: "navigation_limit_exceeded",
        statusCode: 400,
      });
    }
    if (navigation) {
      const [settingsReady] = await Promise.allSettled([ensureSettingsStore()]);
      return withFederatedMembershipSnapshot(
        () => resolveContentDatabaseRead(databaseRef),
        async (preflight) => {
          if (!preflight.available) return preflight;
          if (!userEmail)
            fail("Not authenticated.", {
              errorCode: "unauthenticated",
              statusCode: 401,
            });
          if (settingsReady.status === "rejected") throw settingsReady.reason;
          return getDb().transaction(
            async () => {
              const resolved = await resolveContentDatabaseRead(databaseRef);
              if (!resolved.available) return resolved;
              const overrides = await readPersonalDatabaseViewOverrides(
                userEmail,
                resolved.database.id,
                { transaction: getDbExec(), bypassCache: true },
              );
              return getContentDatabaseNavigationPage({
                database: resolved.database,
                userEmail,
                overrides:
                  overrides as ContentDatabasePersonalViewOverrides | null,
                parentId: navigation.parentId,
                sort: navigation.sort,
                ...(navigation.viewId !== undefined
                  ? { viewId: navigation.viewId }
                  : {}),
                limit: limit ?? 20,
                ...(navigation.cursor !== undefined
                  ? { cursor: navigation.cursor }
                  : {}),
                ...(navigation.expand !== undefined
                  ? { expand: navigation.expand }
                  : {}),
                pagesOnly: navigation.pagesOnly ?? false,
                ...(navigation.group !== undefined
                  ? { group: navigation.group }
                  : {}),
                ...(navigation.locate !== undefined
                  ? { locate: navigation.locate }
                  : {}),
              });
            },
            { isolationLevel: "repeatable read", accessMode: "read only" },
          );
        },
      );
    }

    const resolved = await resolveContentDatabaseRead(databaseRef);
    if (!resolved.available) return resolved;
    let database = resolved.database;
    if (await refreshGitHubSourceBeforeRead(database.id)) {
      const reread = await resolveContentDatabaseRead({
        databaseId: database.id,
      });
      if (!reread.available) return reread;
      database = reread.database;
    }
    const page = await getContentDatabasePageResponse(database.id, {
      limit: limit ?? 100,
      offset,
      tableQuery,
      ...(rowDocumentId ? { documentIds: [rowDocumentId] } : {}),
      database,
    });
    const rows = {
      items: page.items,
      source: page.source,
      sources: page.sources,
      pagination: page.pagination,
      tableQueryMode: page.tableQueryMode,
    };
    if (!compactContentDatabaseRowsFor(ctx, compactRows)) return rows;
    // Compact rows name their Properties by ID, so the page sends the
    // definitions once.
    return compactContentDatabaseResponse({
      ...rows,
      properties: page.properties,
    });
  },
});
