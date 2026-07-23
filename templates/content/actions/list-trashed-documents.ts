import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ListTrashedDocumentsResponse } from "../shared/api.js";

export default defineAction({
  description:
    "List trashed page roots the current user can manage. Titles are returned only after document access filtering.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<ListTrashedDocumentsResponse> => {
    const rows = await getDb()
      .select({
        documentId: schema.documents.id,
        title: schema.documents.title,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .leftJoin(
        schema.contentDatabases,
        eq(schema.contentDatabases.documentId, schema.documents.id),
      )
      .where(
        and(
          isNotNull(schema.documents.trashedAt),
          eq(schema.documents.trashRootId, schema.documents.id),
          isNull(schema.contentDatabases.id),
          accessFilter(
            schema.documents,
            schema.documentShares,
            undefined,
            "admin",
          ),
        ),
      )
      .orderBy(desc(schema.documents.trashedAt));

    return {
      documents: rows.map((row) => ({
        documentId: row.documentId,
        title: row.title.trim() || "Untitled",
        trashedAt: row.trashedAt!,
      })),
    };
  },
});
