import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import listSuggestions from "@agent-native/core/review/suggestions/actions/list-resource-suggestions";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { CONTENT_DOCUMENT_SUGGESTION_ADAPTER } from "../server/lib/suggested-edits.js";
import { ACTIVE_COMMENT_AI_STATUSES } from "../shared/comment-ai.js";

/**
 * Whether an Ask AI suggestion made in this thread still waits for review.
 * Reviewing it needs the thread and its request, which a thread delete removes.
 */
async function hasPendingAiSuggestion(
  documentId: string,
  threadId: string,
  ctx: Parameters<typeof listSuggestions.run>[1],
) {
  const { suggestions } = await listSuggestions.run(
    { resourceType: "document", resourceId: documentId, statuses: ["pending"] },
    ctx,
  );
  // Only one bound to an Ask AI request counts, as in the sidebar: creating
  // it checks the request's thread, while anyone can write sourceThreadId.
  return suggestions.some(
    (suggestion) =>
      suggestion.adapterKind === CONTENT_DOCUMENT_SUGGESTION_ADAPTER &&
      suggestion.metadata?.sourceThreadId === threadId &&
      typeof suggestion.metadata.commentAiRequestId === "string",
  );
}

const refusePendingAiSuggestion = (): never =>
  fail(
    "Accept or reject the AI's suggestion in this thread before deleting it",
    { statusCode: 409, errorCode: "comment_ai_suggestion_pending" },
  );

export default defineAction({
  description:
    "Delete a document comment. Deleting a thread's first comment deletes the whole thread with its replies. Authors can delete their own replies, and a thread no one else has commented in; otherwise editor access is required. A comment synced with Notion is deleted in Notion instead. A thread can't be deleted while the AI works on it or while its AI suggestion waits for review.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    documentId: z.string().optional().describe("Document ID"),
  }),
  run: async (args, ctx) => {
    const db = getDb();
    const [comment] = await db
      .select({
        documentId: schema.documentComments.documentId,
        threadId: schema.documentComments.threadId,
        parentId: schema.documentComments.parentId,
      })
      .from(schema.documentComments)
      .where(eq(schema.documentComments.id, args.id))
      .limit(1);

    if (
      !comment ||
      (args.documentId && comment.documentId !== args.documentId)
    ) {
      throw new Error(`Comment not found: ${args.id}`);
    }

    const { documentId, threadId } = comment;
    // A thread's first comment takes its replies with it.
    const deletesThread = !comment.parentId;
    const targetsWhere = deletesThread
      ? and(
          eq(schema.documentComments.documentId, documentId),
          eq(schema.documentComments.threadId, threadId),
        )
      : and(
          eq(schema.documentComments.documentId, documentId),
          eq(schema.documentComments.id, args.id),
        );
    const targetColumns = {
      id: schema.documentComments.id,
      authorEmail: schema.documentComments.authorEmail,
      notionCommentId: schema.documentComments.notionCommentId,
    };
    // Compared without case, as update-comment and the sidebar compare them.
    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    const allTheirs = (targets: { authorEmail: string }[]) =>
      !!userEmail &&
      targets.every(
        ({ authorEmail }) => authorEmail.trim().toLowerCase() === userEmail,
      );

    const authorOnly = allTheirs(
      await db
        .select(targetColumns)
        .from(schema.documentComments)
        .where(targetsWhere),
    );
    await assertAccess(
      "document",
      documentId,
      authorOnly ? "commenter" : "editor",
    );
    if (
      deletesThread &&
      (await hasPendingAiSuggestion(documentId, threadId, ctx))
    ) {
      refusePendingAiSuggestion();
    }

    const deletedIds = await db.transaction(async (tx) => {
      if (deletesThread) {
        // Locked as add-comment locks it for a reply, so no reply lands in
        // the thread while it goes.
        await tx
          .select({ id: schema.documentComments.id })
          .from(schema.documentComments)
          .where(
            and(
              eq(schema.documentComments.documentId, documentId),
              eq(schema.documentComments.id, args.id),
            ),
          )
          .limit(1)
          .for("update");
      }
      const targets = await tx
        .select(targetColumns)
        .from(schema.documentComments)
        .where(targetsWhere);
      if (authorOnly && !allTheirs(targets)) {
        fail(
          "Someone else replied to this thread, so only an editor can delete it",
          {
            statusCode: 409,
            errorCode: "comment_thread_changed",
          },
        );
      }
      // Notion sync brings a synced comment back when it's missing here.
      if (targets.some(({ notionCommentId }) => notionCommentId)) {
        fail("This comment is synced with Notion; delete it in Notion", {
          statusCode: 409,
          errorCode: "comment_synced_with_notion",
        });
      }
      if (deletesThread) {
        const activeAi = await tx
          .select({ id: schema.commentAiRequests.id })
          .from(schema.commentAiRequests)
          .where(
            and(
              eq(schema.commentAiRequests.documentId, documentId),
              eq(schema.commentAiRequests.threadId, threadId),
              inArray(schema.commentAiRequests.status, [
                ...ACTIVE_COMMENT_AI_STATUSES,
              ]),
            ),
          )
          .limit(1);
        if (activeAi.length) {
          fail("Stop the AI working on this thread before deleting it", {
            statusCode: 409,
            errorCode: "comment_ai_already_active",
          });
        }
        // Again under the lock, which saving a suggestion also takes, in case
        // a request finished with one since the check above.
        if (await hasPendingAiSuggestion(documentId, threadId, ctx)) {
          refusePendingAiSuggestion();
        }
      }
      const ids = targets.map(({ id }) => id);
      if (!ids.length) return ids;
      await tx
        .delete(schema.documentComments)
        .where(
          and(
            eq(schema.documentComments.documentId, documentId),
            inArray(schema.documentComments.id, ids),
          ),
        );
      await tx
        .delete(schema.documentCommentReactions)
        .where(
          and(
            eq(schema.documentCommentReactions.documentId, documentId),
            inArray(schema.documentCommentReactions.commentId, ids),
          ),
        );
      if (deletesThread) {
        // Each Ask AI request keeps a copy of the thread; none is active.
        const requestIds = (
          await tx
            .select({ id: schema.commentAiRequests.id })
            .from(schema.commentAiRequests)
            .where(
              and(
                eq(schema.commentAiRequests.documentId, documentId),
                eq(schema.commentAiRequests.threadId, threadId),
              ),
            )
        ).map(({ id }) => id);
        if (requestIds.length) {
          await tx
            .delete(schema.commentAiAttempts)
            .where(inArray(schema.commentAiAttempts.requestId, requestIds));
          await tx
            .delete(schema.commentAiRequests)
            .where(inArray(schema.commentAiRequests.id, requestIds));
        }
      }
      return ids;
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { ok: true, documentId, deletedIds };
  },
  changeResource: (input, result) =>
    documentChangeResource(input.documentId ?? result.documentId),
});
