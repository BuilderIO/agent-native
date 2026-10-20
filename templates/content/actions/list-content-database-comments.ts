import { defineAction, fail } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { resolveUserProfileName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { readStoredCommentMentions } from "../shared/comment-mentions.js";
import { resolveContentDatabaseRead } from "./_database-utils.js";

const DEFAULT_THREAD_LIMIT = 200;
const MAX_THREAD_LIMIT = 500;

export type ContentDatabaseCommentTarget =
  | { kind: "text"; quotedText: string }
  | {
      kind: "property";
      propertyId: string;
      /**
       * The Property's name and value when the thread started. The value is
       * null for relation, rollup, and formula Properties, whose value
       * depends on who reads it.
       */
      propertyName: string | null;
      propertyValue: string | null;
    }
  | { kind: "page" };

export default defineAction({
  description:
    "List Comment threads across every row of one Collection in a single call, newest first. Each thread names its row, what it targets (quoted text, a Property, or the whole Page), and its comments in order. A Property target carries the value it had when the thread started, except for relation, rollup, and formula Properties. Only rows the caller can read are included. Defaults to open threads.",
  mcpTool: true,
  schema: z.object({
    databaseId: z.string().optional().describe("Collection ID"),
    documentId: z
      .string()
      .optional()
      .describe("The Collection's own Page ID, instead of databaseId"),
    includeResolved: z
      .boolean()
      .optional()
      .describe("Also return resolved threads"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_THREAD_LIMIT)
      .optional()
      .describe(
        `Most threads to return; defaults to ${DEFAULT_THREAD_LIMIT}. truncated is true when more exist.`,
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ databaseId, documentId, includeResolved, limit }) => {
    const resolved = await resolveContentDatabaseRead({
      databaseId,
      documentId,
    });
    if (!resolved.available) return resolved;
    const database = resolved.database;
    if (database.systemRole) {
      fail("Comments can be listed for ordinary Collections only", {
        statusCode: 400,
        errorCode: "unsupported_collection",
      });
    }
    const threadLimit = limit ?? DEFAULT_THREAD_LIMIT;
    const db = getDb();
    const roots = await db
      .select({
        threadId: schema.documentComments.threadId,
        documentId: schema.documentComments.documentId,
        ownerEmail: schema.documentComments.ownerEmail,
        rowTitle: schema.documents.title,
        resolved: schema.documentComments.resolved,
        quotedText: schema.documentComments.quotedText,
        propertyId: schema.documentComments.propertyId,
        propertyName: schema.documentComments.propertyName,
        propertyValue: schema.documentComments.propertyValue,
      })
      .from(schema.documentComments)
      .innerJoin(
        schema.documents,
        and(
          eq(schema.documents.id, schema.documentComments.documentId),
          eq(schema.documents.ownerEmail, schema.documentComments.ownerEmail),
        ),
      )
      .innerJoin(
        schema.contentDatabaseItems,
        and(
          eq(schema.contentDatabaseItems.documentId, schema.documents.id),
          eq(schema.contentDatabaseItems.databaseId, database.id),
        ),
      )
      .where(
        and(
          isNull(schema.documentComments.parentId),
          includeResolved ? undefined : eq(schema.documentComments.resolved, 0),
          isNull(schema.documents.trashedAt),
          eq(schema.documents.ownerEmail, database.ownerEmail),
          accessFilter(
            schema.documents,
            schema.documentShares,
            undefined,
            "viewer",
            { includePublic: true },
          ),
        ),
      )
      .orderBy(
        desc(schema.documentComments.createdAt),
        desc(schema.documentComments.id),
      )
      .limit(threadLimit + 1);
    const truncated = roots.length > threadLimit;
    const threadRoots = roots.slice(0, threadLimit);
    const comments = threadRoots.length
      ? await db
          .select()
          .from(schema.documentComments)
          .where(
            and(
              inArray(
                schema.documentComments.threadId,
                threadRoots.map((root) => root.threadId),
              ),
              // Lets the read use the Page-and-thread index.
              inArray(schema.documentComments.documentId, [
                ...new Set(threadRoots.map((root) => root.documentId)),
              ]),
              eq(schema.documentComments.ownerEmail, database.ownerEmail),
            ),
          )
          .orderBy(
            asc(schema.documentComments.createdAt),
            asc(schema.documentComments.id),
          )
      : [];
    const profiles = await getUserProfiles(
      comments.map((comment) => comment.authorEmail),
    );
    const commentsByThread = new Map<string, typeof comments>();
    for (const comment of comments) {
      const thread = commentsByThread.get(comment.threadId) ?? [];
      thread.push(comment);
      commentsByThread.set(comment.threadId, thread);
    }

    return {
      databaseId: database.id,
      databaseDocumentId: database.documentId,
      truncated,
      threads: threadRoots.map((root) => {
        const target: ContentDatabaseCommentTarget = root.propertyId
          ? {
              kind: "property",
              propertyId: root.propertyId,
              propertyName: root.propertyName,
              propertyValue: root.propertyValue,
            }
          : root.quotedText
            ? { kind: "text", quotedText: root.quotedText }
            : { kind: "page" };
        return {
          threadId: root.threadId,
          documentId: root.documentId,
          rowTitle: root.rowTitle,
          path: `/page/${root.documentId}?comment=${encodeURIComponent(root.threadId)}`,
          resolved: Boolean(root.resolved),
          target,
          comments: (commentsByThread.get(root.threadId) ?? [])
            .filter((comment) => comment.documentId === root.documentId)
            .map((comment) => ({
              id: comment.id,
              parentId: comment.parentId,
              content: comment.content,
              mentions: readStoredCommentMentions(comment.mentionsJson),
              authorEmail: comment.authorEmail,
              authorName: resolveUserProfileName(
                comment.authorEmail,
                comment.authorName,
                profiles.get(comment.authorEmail.toLowerCase())?.name,
              ),
              actorKind:
                comment.actorKind ??
                (comment.submissionSource === "agent" ||
                comment.submissionSource === "mcp"
                  ? "agent"
                  : "human"),
              createdAt: comment.createdAt,
              updatedAt: comment.updatedAt,
            })),
        };
      }),
    };
  },
});
