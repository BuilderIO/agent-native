import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { documentDiscoveryFilter } from "../server/lib/documents.js";
import { getDb, schema } from "../server/db/index.js";
import type { ListContentDatabasesResponse } from "../shared/api.js";

export default defineAction({
  description:
    "List the content databases the user can access (owned, shared, or org-shared — matching the sidebar) so any of them can be used as a local-table source. Optionally excludes one database (e.g. the one being configured).",
  schema: z.object({
    excludeDatabaseId: z
      .string()
      .optional()
      .describe("Database id to omit from the results."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<ListContentDatabasesResponse> => {
    const db = getDb();
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
        inArray(
          schema.contentDatabases.documentId,
          accessibleDocs.map((doc) => doc.id),
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
      }));

    return { databases };
  },
});
