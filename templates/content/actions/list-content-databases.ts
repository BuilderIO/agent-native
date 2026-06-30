import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, inArray, isNull, sql } from "drizzle-orm";
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
    const pattern = query ? `%${escapeLike(query)}%` : null;
    // The same access + discovery filter the sidebar uses, so the picker shows
    // owned AND shared/org databases and never a trashed/hidden one.
    const accessibleDocs = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
      })
      .from(schema.documents)
      .where(
        and(
          accessFilter(schema.documents, schema.documentShares),
          documentDiscoveryFilter(),
          pattern
            ? sql`${schema.documents.title} LIKE ${pattern} ESCAPE '\\'`
            : undefined,
        ),
      )
      .orderBy(asc(schema.documents.position));
    if (accessibleDocs.length === 0) return { databases: [] };

    const titleByDocId = new Map(
      accessibleDocs.map((doc) => [doc.id, doc.title]),
    );
    const rows = await db
      .select({
        id: schema.contentDatabases.id,
        documentId: schema.contentDatabases.documentId,
      })
      .from(schema.contentDatabases)
      .where(
        and(
          inArray(
            schema.contentDatabases.documentId,
            accessibleDocs.map((doc) => doc.id),
          ),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );

    const databases = rows
      .filter((row) => row.id !== args.excludeDatabaseId)
      .map((row) => ({
        databaseId: row.id,
        documentId: row.documentId,
        // The document's live title (matches the sidebar) rather than the
        // possibly-stale content_databases.title.
        title: titleByDocId.get(row.documentId) ?? "Untitled database",
      }))
      .slice(0, args.limit);

    return { databases };
  },
});
