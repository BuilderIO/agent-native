import { defineAction } from "@agent-native/core/action";
import { alias } from "@agent-native/core/db/schema";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ListTrashedContentDatabasesResponse } from "../shared/api.js";
import { configurationRevision } from "./_database-setup-mutation.js";

export default defineAction({
  description:
    "List soft-deleted content databases the current user can access for the sidebar Trash surface.",
  mcpTool: true,
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, context): Promise<ListTrashedContentDatabasesResponse> => {
    const db = getDb();
    const limit = args.limit ?? (context?.caller === "mcp" ? 100 : undefined);
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
    const query = db
      .select({
        databaseRecord: schema.contentDatabases,
        databaseId: schema.contentDatabases.id,
        databaseTitle: schema.contentDatabases.title,
        documentId: schema.contentDatabases.documentId,
        ownerDocumentId: schema.contentDatabases.ownerDocumentId,
        deletedAt: schema.contentDatabases.deletedAt,
        documentTitle: schema.documents.title,
        documentParentId: schema.documents.parentId,
        documentTrashRootId: schema.documents.trashRootId,
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
            isNull(schema.documents.trashRootId),
            eq(schema.documents.trashRootId, schema.documents.id),
          ),
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
      .orderBy(
        desc(schema.contentDatabases.deletedAt),
        schema.contentDatabases.id,
      );
    const rows =
      limit === undefined
        ? await query
        : await query.limit(limit + 1).offset(args.offset ?? 0);
    const hasMore = limit !== undefined && rows.length > limit;

    return {
      hasMore,
      nextOffset: hasMore ? (args.offset ?? 0) + limit : null,
      databases: rows.slice(0, limit ?? rows.length).map((row) => ({
        spaceId: row.databaseRecord.spaceId,
        configurationRevision: configurationRevision(row.databaseRecord),
        databaseId: row.databaseId,
        title:
          row.documentTitle?.trim() ||
          row.databaseTitle?.trim() ||
          "Untitled database",
        documentId: row.documentId,
        ownerDocumentId: row.ownerDocumentId,
        deletedAt: row.deletedAt!,
        canPermanentlyDelete:
          row.documentTrashRootId === row.documentId &&
          (row.ownerDocumentId === null ||
            row.documentParentId !== row.ownerDocumentId),
      })),
    };
  },
});
