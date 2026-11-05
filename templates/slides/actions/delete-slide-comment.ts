import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  assertAccess,
  resolveAccess,
  ROLE_RANK,
} from "@agent-native/core/sharing";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { commentAuthorKind } from "../shared/comment-author.js";

type ThreadRow = { id: string; authorEmail: string };

// Deleting a thread root removes the whole thread. Approval and the locked re-check must see the same rows.
function removedRows<T extends ThreadRow>(
  threadRows: T[],
  comment: { id: string; threadId: string },
): T[] {
  const rootId = (
    threadRows.find((row) => row.id === comment.threadId) ?? threadRows.at(0)
  )?.id;
  return rootId === comment.id
    ? threadRows
    : threadRows.filter((row) => row.id === comment.id);
}

function isOtherPerson(authorEmail: string, viewerEmail: string | undefined) {
  return authorEmail.trim().toLowerCase() !== viewerEmail;
}

export default defineAction({
  description:
    "Delete a slide comment. Authors can delete their own comments; otherwise editor access is required.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    deckId: z.string().describe("Deck ID"),
  }),
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  audit: {
    target: (args) => ({ type: "slide-comment", id: args.id }),
    summary: (_args, result) =>
      `Deleted ${(result as { removedIds: string[] }).removedIds.length} comment(s)`,
  },
  needsApproval: async ({ id, deckId }, ctx) => {
    if (commentAuthorKind(ctx?.caller) !== "agent") return false;
    // Without commenter access run() refuses the call, so there is nothing to approve.
    const access = await resolveAccess("deck", deckId);
    if (!access || ROLE_RANK[access.role] < ROLE_RANK.commenter) return false;
    const db = getDb();
    const targetRows = await db
      .select({
        id: schema.slideComments.id,
        slideId: schema.slideComments.slideId,
        threadId: schema.slideComments.threadId,
      })
      .from(schema.slideComments)
      .where(
        and(
          eq(schema.slideComments.id, id),
          eq(schema.slideComments.deckId, deckId),
        ),
      )
      .limit(1);
    const target = targetRows.at(0);
    if (!target) return false;
    const threadRows = await db
      .select({
        id: schema.slideComments.id,
        authorEmail: schema.slideComments.authorEmail,
      })
      .from(schema.slideComments)
      .where(
        and(
          eq(schema.slideComments.deckId, deckId),
          eq(schema.slideComments.slideId, target.slideId),
          eq(schema.slideComments.threadId, target.threadId),
        ),
      )
      .orderBy(
        asc(schema.slideComments.createdAt),
        asc(schema.slideComments.id),
      );
    const viewer = getRequestUserEmail()?.trim().toLowerCase();
    return removedRows(threadRows, target).some((row) =>
      isOtherPerson(row.authorEmail, viewer),
    );
  },
  run: async (args, ctx) => {
    await assertAccess("deck", args.deckId, "commenter");
    const db = getDb();
    const [comment] = await db
      .select({
        id: schema.slideComments.id,
        deckId: schema.slideComments.deckId,
        slideId: schema.slideComments.slideId,
        threadId: schema.slideComments.threadId,
        authorEmail: schema.slideComments.authorEmail,
      })
      .from(schema.slideComments)
      .where(
        and(
          eq(schema.slideComments.id, args.id),
          eq(schema.slideComments.deckId, args.deckId),
        ),
      )
      .limit(1);

    if (!comment) {
      fail(`Comment not found: ${args.id}`, {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    if (comment.authorEmail.trim().toLowerCase() === userEmail) {
      await assertAccess("deck", comment.deckId, "commenter");
    } else {
      await assertAccess("deck", comment.deckId, "editor");
    }

    const removedIds = await db.transaction(async (tx) => {
      const threadRows = await tx
        .select({
          id: schema.slideComments.id,
          authorEmail: schema.slideComments.authorEmail,
          createdAt: schema.slideComments.createdAt,
        })
        .from(schema.slideComments)
        .where(
          and(
            eq(schema.slideComments.deckId, comment.deckId),
            eq(schema.slideComments.slideId, comment.slideId),
            eq(schema.slideComments.threadId, comment.threadId),
          ),
        )
        .orderBy(
          asc(schema.slideComments.createdAt),
          asc(schema.slideComments.id),
        )
        .for("update");
      if (!threadRows.some((row) => row.id === comment.id)) {
        fail(`Comment not found: ${args.id}`, {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      const removed = removedRows(threadRows, comment);
      // The approval was for the thread as it was before this lock; a reply that landed since needs asking again.
      if (
        commentAuthorKind(ctx?.caller) === "agent" &&
        removed.some((row) => isOtherPerson(row.authorEmail, userEmail))
      ) {
        fail(
          "This thread now holds another person's reply. Ask the user before deleting it.",
          { errorCode: "approval_required", statusCode: 409 },
        );
      }

      const ids = removed.map((row) => row.id);
      await tx
        .delete(schema.slideComments)
        .where(
          and(
            eq(schema.slideComments.deckId, comment.deckId),
            inArray(schema.slideComments.id, ids),
          ),
        );
      return ids;
    });

    return { ok: true, removedIds };
  },
});
