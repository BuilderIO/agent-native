import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ListTrashedContentDatabasesResponse } from "../shared/api.js";

export default defineAction({
  description:
    "List soft-deleted content databases the current user can access for the sidebar Trash surface.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<ListTrashedContentDatabasesResponse> => {
    const db = getDb();
    const hostDocuments = alias(schema.documents, "host_documents");
    const isBlockOwned = and(
      isNotNull(schema.contentDatabases.ownerDocumentId),
      eq(schema.documents.parentId, schema.contentDatabases.ownerDocumentId),
    );
    const isNotBlockOwned = or(
      isNull(schema.contentDatabases.ownerDocumentId),
      isNull(schema.documents.parentId),
      ne(schema.documents.parentId, schema.contentDatabases.ownerDocumentId),
    );
    const rows = await db
      .select({
        databaseId: schema.contentDatabases.id,
        databaseTitle: schema.contentDatabases.title,
        documentId: schema.contentDatabases.documentId,
        ownerDocumentId: schema.contentDatabases.ownerDocumentId,
        deletedAt: schema.contentDatabases.deletedAt,
        documentTitle: schema.documents.title,
      })
      .from(schema.contentDatabases)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabases.documentId),
      )
      .leftJoin(
        hostDocuments,
        eq(hostDocuments.id, schema.contentDatabases.ownerDocumentId),
      )
      .where(
        and(
          isNotNull(schema.contentDatabases.deletedAt),
          or(
            and(
              isBlockOwned,
              accessFilter(
                hostDocuments,
                schema.documentShares,
                undefined,
                "editor",
              ),
            ),
            and(
              isNotBlockOwned,
              accessFilter(
                schema.documents,
                schema.documentShares,
                undefined,
                "admin",
              ),
            ),
          ),
        ),
      )
      .orderBy(desc(schema.contentDatabases.deletedAt));

    return {
      databases: rows.map((row) => ({
        databaseId: row.databaseId,
        title:
          row.documentTitle?.trim() ||
          row.databaseTitle?.trim() ||
          "Untitled database",
        documentId: row.documentId,
        ownerDocumentId: row.ownerDocumentId,
        deletedAt: row.deletedAt!,
      })),
    };
  },
});
