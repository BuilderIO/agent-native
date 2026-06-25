import { defineAction } from "@agent-native/core";
import {
  accessFilter,
  resolveAccess,
  roleSatisfies,
} from "@agent-native/core/sharing";
import { and, desc, eq, isNotNull } from "drizzle-orm";
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
    const rows = await db
      .select({
        databaseId: schema.contentDatabases.id,
        databaseTitle: schema.contentDatabases.title,
        documentId: schema.contentDatabases.documentId,
        ownerDocumentId: schema.contentDatabases.ownerDocumentId,
        deletedAt: schema.contentDatabases.deletedAt,
        documentTitle: schema.documents.title,
        documentParentId: schema.documents.parentId,
      })
      .from(schema.contentDatabases)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabases.documentId),
      )
      .where(
        and(
          isNotNull(schema.contentDatabases.deletedAt),
          accessFilter(schema.documents, schema.documentShares),
        ),
      )
      .orderBy(desc(schema.contentDatabases.deletedAt));

    const restorableRows: typeof rows = [];
    for (const row of rows) {
      const isBlockOwned =
        !!row.ownerDocumentId && row.documentParentId === row.ownerDocumentId;
      const restoreAccess = isBlockOwned
        ? await resolveAccess("document", row.ownerDocumentId!)
        : await resolveAccess("document", row.documentId);
      if (
        restoreAccess &&
        roleSatisfies(restoreAccess.role, isBlockOwned ? "editor" : "admin")
      ) {
        restorableRows.push(row);
      }
    }

    return {
      databases: restorableRows.map((row) => ({
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
