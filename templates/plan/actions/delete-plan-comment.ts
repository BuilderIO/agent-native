import { defineAction } from "@agent-native/core/action";
import { ensureReviewTables } from "@agent-native/core/review";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  ForbiddenError,
  assertAccess,
  currentAccess,
  resolveAccess,
  roleSatisfies,
} from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  resolvePlanAccessContext,
  resolvePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import {
  deletePlanCommentThread,
  listPlanCommentRows,
} from "../server/lib/plan-comments.js";
import { nowIso, writeEvent } from "../server/plans.js";

function normalizeEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
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
  },
  changeResource: (input) =>
    input.planId ? { resourceType: "plan", resourceId: input.planId } : null,
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
    if ((access.resource as typeof schema.plans.$inferSelect).deletedAt) {
      throw new ForbiddenError(`Plan ${args.planId} not found`);
    }

    const db = getDb();
    const now = nowIso();
    await ensureReviewTables();
    const comments = await listPlanCommentRows(args.planId);

    const existing = comments.find((comment) => comment.id === args.commentId);
    if (!existing) {
      throw new Error(
        `Comment not found on this plan. Verify the commentId and planId are correct.`,
      );
    }

    const requester = normalizeEmail(commentRequestEmail);
    const author = normalizeEmail(existing.authorEmail);
    const isAuthor = Boolean(requester && author && requester === author);
    if (!roleSatisfies(access.role, "commenter")) {
      throw new ForbiddenError(
        "Commenting on this plan requires commenter access or higher.",
      );
    }
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

    const deletedCommentIds = await db.transaction((tx) =>
      deletePlanCommentThread(
        tx,
        args.planId,
        args.commentId,
        commentRequestEmail,
        now,
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
