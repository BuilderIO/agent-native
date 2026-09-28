import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  DocumentHistoryCheckpointKind,
  DocumentHistoryCheckpointPage,
} from "../shared/document-history.js";

interface CheckpointCursor {
  createdAt: string;
  checkpointRank: number;
  id: string;
}

function decodeCursor(value: string): CheckpointCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CheckpointCursor>;
    if (
      typeof parsed.createdAt === "string" &&
      typeof parsed.checkpointRank === "number" &&
      typeof parsed.id === "string"
    ) {
      return {
        createdAt: parsed.createdAt,
        checkpointRank: parsed.checkpointRank,
        id: parsed.id,
      };
    }
    throw new Error("Invalid document checkpoint cursor.");
  } catch {
    throw new Error("Invalid document checkpoint cursor.");
  }
}

function encodeCursor(cursor: CheckpointCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export default defineAction({
  description:
    "List metadata for the recoverable checkpoints in one document history group.",
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    groupId: z.string().min(1).describe("History group ID"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Maximum checkpoints to return; defaults to 50"),
    cursor: z
      .string()
      .optional()
      .describe("Opaque nextCursor from a previous response"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<DocumentHistoryCheckpointPage> => {
    const access = await assertAccess("document", args.documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const cursor = args.cursor ? decodeCursor(args.cursor) : undefined;
    const checkpointRank = sql<number>`case when ${schema.documentVersions.checkpointKind} = 'after' then 1 else 0 end`;
    const rows = await getDb()
      .select({
        id: schema.documentVersions.id,
        documentId: schema.documentVersions.documentId,
        groupId: schema.documentVersions.groupId,
        title: schema.documentVersions.title,
        checkpointKind: schema.documentVersions.checkpointKind,
        checkpointRank,
        createdAt: schema.documentVersions.createdAt,
      })
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.ownerEmail, ownerEmail),
          eq(schema.documentVersions.documentId, args.documentId),
          or(
            eq(schema.documentVersions.groupId, args.groupId),
            and(
              isNull(schema.documentVersions.groupId),
              eq(schema.documentVersions.id, args.groupId),
            ),
          ),
          cursor
            ? or(
                sql`${schema.documentVersions.createdAt} < ${cursor.createdAt}`,
                and(
                  eq(schema.documentVersions.createdAt, cursor.createdAt),
                  or(
                    sql`${checkpointRank} < ${cursor.checkpointRank}`,
                    and(
                      sql`${checkpointRank} = ${cursor.checkpointRank}`,
                      sql`${schema.documentVersions.id} < ${cursor.id}`,
                    ),
                  ),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        desc(schema.documentVersions.createdAt),
        desc(checkpointRank),
        desc(schema.documentVersions.id),
      )
      .limit(args.limit + 1);
    const hasMore = rows.length > args.limit;
    const pageRows = rows.slice(0, args.limit);
    const last = pageRows[pageRows.length - 1];
    return {
      checkpoints: pageRows.map((row) => ({
        id: row.id,
        documentId: row.documentId,
        groupId: row.groupId ?? row.id,
        title: row.title,
        checkpointKind: (row.checkpointKind ??
          "legacy") as DocumentHistoryCheckpointKind,
        createdAt: row.createdAt,
      })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              createdAt: last.createdAt,
              checkpointRank: last.checkpointRank,
              id: last.id,
            })
          : null,
    };
  },
});
