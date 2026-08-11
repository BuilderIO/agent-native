import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentDiscoveryFilter } from "../server/lib/documents.js";
import type { ListContentDatabasesResponse } from "../shared/api.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";

function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

export default defineAction({
  description:
    "List ordinary Content databases the user can access. Use spaceId and databaseId for exact identity checks; set includeSystemCollections to classify Files, Favorites, Workspaces, and other system chrome separately. This is database inventory, not Content-space navigation.",
  schema: z.object({
    spaceId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact Content space id to inventory."),
    databaseId: z
      .string()
      .min(1)
      .optional()
      .describe("Exact database id to find without title matching."),
    includeSystemCollections: z
      .boolean()
      .optional()
      .describe(
        "Return system-role databases in systemCollections instead of treating them as ordinary databases.",
      ),
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
    if (args.spaceId) {
      await resolveContentSpaceAccess(args.spaceId, "viewer", { db });
    }
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
        spaceId: schema.contentDatabases.spaceId,
        spaceName: schema.contentSpaces.name,
        spaceKind: schema.contentSpaces.kind,
        systemRole: schema.contentDatabases.systemRole,
      })
      .from(schema.contentDatabases)
      .innerJoin(
        schema.documents,
        eq(schema.contentDatabases.documentId, schema.documents.id),
      )
      .leftJoin(
        schema.contentSpaces,
        eq(schema.contentDatabases.spaceId, schema.contentSpaces.id),
      )
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          isNull(schema.documents.trashedAt),
          isNull(schema.contentDatabases.deletedAt),
          args.spaceId
            ? eq(schema.contentDatabases.spaceId, args.spaceId)
            : undefined,
          args.databaseId
            ? eq(schema.contentDatabases.id, args.databaseId)
            : undefined,
          args.includeSystemCollections
            ? or(
                isNotNull(schema.contentDatabases.systemRole),
                documentDiscoveryFilter(),
              )
            : and(
                isNull(schema.contentDatabases.systemRole),
                documentDiscoveryFilter(),
              ),
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

    const rows =
      args.limit && !args.includeSystemCollections
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

    const visibleRows = rows.filter(
      (row) =>
        !excludedDatabaseIds.has(row.documentId) &&
        !sourceChainIncludesExcludedDatabase(row.id),
    );
    const includeIdentity = Boolean(
      args.spaceId || args.databaseId || args.includeSystemCollections,
    );
    const databases = visibleRows
      // Exclusion ids may be database ids OR database document ids — the
      // settings panel only has the document id before any source exists.
      .filter((row) => row.systemRole === null)
      .slice(0, args.limit)
      .map((row) => ({
        databaseId: row.id,
        documentId: row.documentId,
        // The document's live title (matches the sidebar) rather than the
        // possibly-stale content_databases.title.
        title: row.title ?? "Untitled database",
        ...(includeIdentity
          ? {
              spaceId: row.spaceId,
              spaceName: row.spaceName,
              spaceKind: row.spaceKind,
              systemRole: null,
            }
          : {}),
      }));

    if (!args.includeSystemCollections) return { databases };
    const systemCollections = visibleRows
      .filter(
        (row): row is typeof row & { systemRole: string } =>
          row.systemRole !== null,
      )
      .map((row) => ({
        databaseId: row.id,
        documentId: row.documentId,
        title: row.title ?? "Untitled database",
        spaceId: row.spaceId,
        spaceName: row.spaceName,
        spaceKind: row.spaceKind,
        systemRole: row.systemRole,
      }));
    return { databases, systemCollections };
  },
});
