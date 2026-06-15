import { defineAction, embedApp } from "@agent-native/core";
import {
  ForbiddenError,
  assertAccess,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  resolvePlanAccessContext,
  resolvePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import { nowIso, writeEvent } from "../server/plans.js";

type CommentRow = {
  id: string;
  parentCommentId: string | null;
  authorEmail: string | null;
};

function normalizeEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function commentAndDescendantIds(comments: CommentRow[], commentId: string) {
  const childrenByParent = new Map<string, string[]>();
  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    const children = childrenByParent.get(comment.parentCommentId) ?? [];
    children.push(comment.id);
    childrenByParent.set(comment.parentCommentId, children);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [commentId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return ids;
}

export default defineAction({
  description:
    "Delete a comment or comment thread from an Agent-Native Plan. Use this only when the user explicitly asks to remove a comment, clean up an accidental comment, or delete an obsolete thread. Deleting is a soft delete: the comment is removed from normal views while retaining an audit row. Deleting a thread root also deletes its replies. Prefer resolve-plan-comment and consume-plan-feedback when the feedback was handled and should remain visible in the review history.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    commentId: z
      .string()
      .describe(
        "ID of the comment to delete. If this is a thread root, its replies are deleted too.",
      ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Delete Plan Comment",
    description: "Delete a comment or comment thread on an Agent-Native Plan.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Delete Comment",
      description:
        "Open the Agent-Native Plan surface to manage reviewer comments.",
      iframeTitle: "Agent-Native Plan",
      openLabel: "Open Plan",
      height: 860,
    }),
  },
  run: async (args) => {
    const requesterEmail = getRequestUserEmail();
    const commentRequestEmail = !isAnonymousPublicViewer(requesterEmail)
      ? resolvePlanOwnerEmailForWrite(requesterEmail)
      : requesterEmail;

    if (isAnonymousPublicViewer(requesterEmail)) {
      throw new ForbiddenError(
        "Deleting a comment requires an agent-native account. Sign in to delete.",
      );
    }
    if (isGuestAuthorIdentity(requesterEmail)) {
      throw new ForbiddenError(
        "Deleting a comment requires an account. Sign in to delete.",
      );
    }
    if (!commentRequestEmail) {
      throw new ForbiddenError(
        "Deleting a comment requires an agent-native account. Sign in to delete.",
      );
    }

    const access = await resolveAccess(
      "plan",
      args.planId,
      resolvePlanAccessContext(currentAccess()),
    );
    if (!access) throw new Error(`Plan ${args.planId} not found`);

    const db = getDb();
    const now = nowIso();
    const comments = await db
      .select({
        id: schema.planComments.id,
        parentCommentId: schema.planComments.parentCommentId,
        authorEmail: schema.planComments.authorEmail,
      })
      .from(schema.planComments)
      .where(
        and(
          eq(schema.planComments.planId, args.planId),
          isNull(schema.planComments.deletedAt),
        ),
      );

    const existing = comments.find((comment) => comment.id === args.commentId);
    if (!existing) {
      throw new Error(
        `Comment not found on this plan. Verify the commentId and planId are correct.`,
      );
    }

    const requester = normalizeEmail(commentRequestEmail);
    const author = normalizeEmail(existing.authorEmail);
    const isAuthor = Boolean(requester && author && requester === author);
    if (!isAuthor) {
      try {
        await assertAccess(
          "plan",
          args.planId,
          "editor",
          resolvePlanAccessContext(currentAccess()),
        );
      } catch (error) {
        if (error instanceof ForbiddenError) {
          throw new ForbiddenError(
            "Only the comment author or a plan editor can delete this comment.",
          );
        }
        throw error;
      }
    }

    const deletedCommentIds = commentAndDescendantIds(comments, args.commentId);
    await db
      .update(schema.planComments)
      .set({
        deletedAt: now,
        deletedBy: commentRequestEmail,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.planComments.planId, args.planId),
          inArray(schema.planComments.id, deletedCommentIds),
        ),
      );

    await writeEvent({
      planId: args.planId,
      type: "plan.updated",
      message:
        deletedCommentIds.length > 1
          ? `Deleted comment thread ${args.commentId}.`
          : `Deleted comment ${args.commentId}.`,
      payload: {
        deletedCommentIds,
        deletedAt: now,
        softDelete: true,
      },
      createdBy: "human",
    });

    return {
      planId: args.planId,
      commentId: args.commentId,
      deletedCommentIds,
      deletedCount: deletedCommentIds.length,
      deletedAt: now,
    };
  },
});
