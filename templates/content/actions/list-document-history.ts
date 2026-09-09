import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, max, min, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  DocumentHistoryActorKind,
  DocumentHistoryGroupKind,
  DocumentHistoryPage,
} from "../shared/document-history.js";

interface HistoryCursor {
  startedAt: string;
  id: string;
}

function decodeCursor(value: string): HistoryCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<HistoryCursor>;
    if (typeof parsed.startedAt === "string" && typeof parsed.id === "string") {
      return { startedAt: parsed.startedAt, id: parsed.id };
    }
    throw new Error("Invalid document history cursor.");
  } catch {
    throw new Error("Invalid document history cursor.");
  }
}

function encodeCursor(cursor: HistoryCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export default defineAction({
  description:
    "List one metadata-only page of a document's history groups, newest first.",
  schema: z.object({
    documentId: z.string().min(1).describe("Document ID"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .describe("Maximum history groups to return; defaults to 30"),
    cursor: z
      .string()
      .optional()
      .describe("Opaque nextCursor from a previous response"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<DocumentHistoryPage> => {
    const access = await assertAccess("document", args.documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const cursor = args.cursor ? decodeCursor(args.cursor) : undefined;
    const groupId = sql<string>`coalesce(${schema.documentVersions.groupId}, ${schema.documentVersions.id})`;
    const startedAt = min(schema.documentVersions.createdAt);
    const endedAt = max(
      sql<string>`coalesce(${schema.documentVersions.updatedAt}, ${schema.documentVersions.createdAt})`,
    );
    const page = getDb()
      .select({
        id: groupId.as("group_id"),
        kind: sql<string>`coalesce(max(${schema.documentVersions.groupKind}), 'legacy')`.as(
          "kind",
        ),
        actorEmail: max(schema.documentVersions.actorEmail).as("actor_email"),
        actorKind:
          sql<string>`coalesce(max(${schema.documentVersions.actorKind}), 'unknown')`.as(
            "actor_kind",
          ),
        origin: max(schema.documentVersions.origin).as("origin"),
        operation: max(schema.documentVersions.operation).as("operation"),
        startedAt: startedAt.as("started_at"),
        endedAt: endedAt.as("ended_at"),
        checkpointCount: sql<number>`count(*)::integer`.as("checkpoint_count"),
      })
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.ownerEmail, ownerEmail),
          eq(schema.documentVersions.documentId, args.documentId),
        ),
      )
      .groupBy(groupId)
      .having(
        cursor
          ? sql`min(${schema.documentVersions.createdAt}) < ${cursor.startedAt} or (min(${schema.documentVersions.createdAt}) = ${cursor.startedAt} and ${groupId} < ${cursor.id})`
          : undefined,
      )
      .orderBy(desc(startedAt), desc(groupId))
      .limit(args.limit + 1)
      .as("history_page");
    const rows = await getDb()
      .select({
        id: page.id,
        kind: page.kind,
        actorEmail: page.actorEmail,
        actorKind: page.actorKind,
        origin: page.origin,
        operation: page.operation,
        startedAt: page.startedAt,
        endedAt: page.endedAt,
        checkpointCount: page.checkpointCount,
        latestCheckpointId: sql<string>`(select checkpoint.id from document_versions checkpoint
          where checkpoint.owner_email = ${ownerEmail}
            and checkpoint.document_id = ${args.documentId}
            and coalesce(checkpoint.group_id, checkpoint.id) = ${page.id}
          order by checkpoint.created_at desc,
            case when checkpoint.checkpoint_kind = 'after' then 0 else 1 end, checkpoint.id desc
          limit 1)`,
      })
      .from(page)
      .orderBy(desc(page.startedAt), desc(page.id));
    const hasMore = rows.length > args.limit;
    const pageRows = rows.slice(0, args.limit);
    const last = pageRows[pageRows.length - 1];
    return {
      groups: pageRows.map((row) => ({
        id: row.id,
        kind: row.kind as DocumentHistoryGroupKind,
        actorEmail: row.actorEmail,
        actorKind: row.actorKind as DocumentHistoryActorKind,
        origin: row.origin,
        operation: row.operation,
        startedAt: row.startedAt as string,
        endedAt: row.endedAt as string,
        checkpointCount: row.checkpointCount,
        latestCheckpointId: row.latestCheckpointId,
      })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ startedAt: last.startedAt as string, id: last.id })
          : null,
    };
  },
});
