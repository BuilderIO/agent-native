import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentDiscoveryFilter } from "../server/lib/documents.js";
import type { ListContentDatabasesResponse } from "../shared/api.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    "Discover ordinary Content databases the user can access from their live title and user-authored description. Returns stable database, document, and space IDs. Use exact filters before reading a selected database's schema.",
  schema: z.object({
    spaceId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact Content space ID to search within."),
    databaseId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact Content database ID to resolve."),
    documentId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact Content database document/page ID to resolve."),
    title: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Exact live database title to resolve, case-insensitively."),
    excludeDatabaseId: z
      .string()
      .optional()
      .describe("Database id to omit from the results."),
    excludeDatabaseIds: z
      .array(z.string())
      .optional()
      .describe("Database ids to omit from the results."),
    query: z
      .string()
      .optional()
      .describe("Optional title or user-authored description search text."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum number of databases to return."),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args): Promise<ListContentDatabasesResponse> => {
    const db = getDb();
    const query = args.query?.trim();
    const pattern = query ? `%${escapeLike(query.toLowerCase())}%` : null;
    const exactTitle = args.title?.toLowerCase();
    const excludedDatabaseIds = new Set(
      [
        args.excludeDatabaseId?.trim(),
        ...(args.excludeDatabaseIds ?? []).map((id) => id.trim()),
      ].filter((id): id is string => !!id),
    );
    // The same access + discovery filter the sidebar uses, so the picker shows
    // owned AND shared/org databases and never a trashed/hidden one.
    const queryBuilder = db
      .select({
        id: schema.contentDatabases.id,
        documentId: schema.contentDatabases.documentId,
        title: schema.documents.title,
        description: schema.documents.description,
        spaceId: schema.contentDatabases.spaceId,
      })
      .from(schema.contentDatabases)
      .innerJoin(
        schema.documents,
        eq(schema.contentDatabases.documentId, schema.documents.id),
      )
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          isNull(schema.documents.trashedAt),
          documentDiscoveryFilter(),
          isNull(schema.contentDatabases.deletedAt),
          isNull(schema.contentDatabases.systemRole),
          args.spaceId
            ? eq(schema.contentDatabases.spaceId, args.spaceId)
            : undefined,
          args.databaseId
            ? eq(schema.contentDatabases.id, args.databaseId)
            : undefined,
          args.documentId
            ? eq(schema.contentDatabases.documentId, args.documentId)
            : undefined,
          exactTitle
            ? sql`lower(${schema.documents.title}) = ${exactTitle}`
            : undefined,
          excludedDatabaseIds.size === 1
            ? ne(
                schema.contentDatabases.id,
                Array.from(excludedDatabaseIds)[0]!,
              )
            : undefined,
          pattern
            ? or(
                sql`lower(${schema.documents.title}) LIKE ${pattern} ESCAPE '\\'`,
                sql`lower(${schema.documents.description}) LIKE ${pattern} ESCAPE '\\'`,
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.documents.position));

    const rows = await queryBuilder;

    const localTableSources =
      excludedDatabaseIds.size > 0
        ? await db
            .select({
              databaseId: schema.contentDatabaseSources.databaseId,
              sourceTable: schema.contentDatabaseSources.sourceTable,
            })
            .from(schema.contentDatabaseSources)
            .where(eq(schema.contentDatabaseSources.sourceType, "local-table"))
        : [];
    const localTableTargetByDatabaseId = new Map(
      localTableSources.map((source) => [
        source.databaseId,
        source.sourceTable,
      ]),
    );
    const sourceChainIncludesExcludedDatabase = (databaseId: string) => {
      const seen = new Set<string>();
      let current: string | undefined = databaseId;
      while (current && !seen.has(current)) {
        if (excludedDatabaseIds.has(current)) return true;
        seen.add(current);
        current = localTableTargetByDatabaseId.get(current);
      }
      return false;
    };

    const visibleRows = rows
      // Exclusion ids may be database ids OR database document ids — the
      // settings panel only has the document id before any source exists.
      .filter(
        (row) =>
          !excludedDatabaseIds.has(row.documentId) &&
          !sourceChainIncludesExcludedDatabase(row.id),
      );

    if (
      (args.databaseId || args.documentId || exactTitle) &&
      visibleRows.length !== 1
    ) {
      const selector = args.databaseId
        ? `database ID "${args.databaseId}"`
        : args.documentId
          ? `document ID "${args.documentId}"`
          : `title "${args.title?.trim()}"`;
      throw new Error(
        visibleRows.length === 0
          ? `No accessible Content database matched exact ${selector}.`
          : `Exact ${selector} is ambiguous across ${visibleRows.length} accessible Content databases.`,
      );
    }

    const databases = visibleRows
      .slice(0, args.limit ?? visibleRows.length)
      .map((row) => ({
        databaseId: row.id,
        documentId: row.documentId,
        spaceId: row.spaceId,
        // The document's live title (matches the sidebar) rather than the
        // possibly-stale content_databases.title.
        title: row.title ?? "Untitled database",
        description: row.description,
      }));

    return { databases };
  },
});
