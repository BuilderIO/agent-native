import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentDiscoveryFilter } from "../server/lib/documents.js";
import type { ListContentDatabasesResponse } from "../shared/api.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    "List the content databases the user can access (owned, shared, or org-shared — matching the sidebar) so any of them can be used as a local-table source. Optionally filters by title or excludes one database (e.g. the one being configured).",
  schema: z.object({
    excludeDatabaseId: z
      .string()
      .optional()
      .describe("Database id to omit from the results."),
    excludeDatabaseIds: z
      .array(z.string())
      .optional()
      .describe("Database ids to omit from the results."),
    query: z.string().optional().describe("Optional title search text."),
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
  run: async (args): Promise<ListContentDatabasesResponse> => {
    const db = getDb();
    const query = args.query?.trim();
    const pattern = query ? `%${escapeLike(query.toLowerCase())}%` : null;
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
      })
      .from(schema.contentDatabases)
      .innerJoin(
        schema.documents,
        eq(schema.contentDatabases.documentId, schema.documents.id),
      )
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          documentDiscoveryFilter(),
          isNull(schema.contentDatabases.deletedAt),
          excludedDatabaseIds.size === 1
            ? ne(
                schema.contentDatabases.id,
                Array.from(excludedDatabaseIds)[0]!,
              )
            : undefined,
          pattern
            ? sql`lower(${schema.documents.title}) LIKE ${pattern} ESCAPE '\\'`
            : undefined,
        ),
      )
      .orderBy(asc(schema.documents.position));

    const rows = args.limit
      ? await queryBuilder.limit(args.limit)
      : await queryBuilder;

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

    const databases = rows
      // Exclusion ids may be database ids OR database document ids — the
      // settings panel only has the document id before any source exists.
      .filter(
        (row) =>
          !excludedDatabaseIds.has(row.documentId) &&
          !sourceChainIncludesExcludedDatabase(row.id),
      )
      .map((row) => ({
        databaseId: row.id,
        documentId: row.documentId,
        // The document's live title (matches the sidebar) rather than the
        // possibly-stale content_databases.title.
        title: row.title ?? "Untitled database",
      }));

    return { databases };
  },
});
