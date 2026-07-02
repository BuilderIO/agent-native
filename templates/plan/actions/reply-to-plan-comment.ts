import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import {
  ForbiddenError,
  currentAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyPlanCommentRecipients } from "../server/lib/comment-notifications.js";
import {
  isAnonymousPublicViewer,
  isGuestAuthorIdentity,
  resolvePlanAccessContext,
  resolvePlanOwnerEmailForWrite,
} from "../server/lib/local-identity.js";
import {
  buildUpdatedPlanCommentRows,
  emitPlanCommented,
  loadPlanBundle,
  newId,
  nowIso,
  planCommentKindSchema,
  planCommentResolutionTargetSchema,
  writeEvent,
} from "../server/plans.js";

export default defineAction({
  description:
    "Append a reply to an existing comment thread on an Agent-Native Plan. Call this when you want to respond to reviewer feedback in-thread, acknowledge a comment, or answer a question pinned to the plan. Requires an authenticated account; anonymous viewers cannot reply.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    commentId: z
      .string()
      .describe(
        "ID of the parent (thread-root) comment to reply to. Use get-plan-feedback to obtain comment IDs.",
      ),
    body: z.string().min(1).describe("Reply message text"),
    resolutionTarget: planCommentResolutionTargetSchema
      .optional()
      .describe(
        'Who should act next: "agent" (agent owns next step) or "human" (waiting on a human). Defaults to the parent comment\'s resolutionTarget when omitted.',
      ),
    kind: planCommentKindSchema
      .optional()
      .describe(
        "Comment kind — inherit from parent thread when omitted (recommended). Only override when the reply is a distinct annotation kind.",
      ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Reply to Plan Comment",
    description:
      "Post a reply to an existing comment thread on an Agent-Native Plan.",
  },
  mcpApp: {
    compactCatalog: true,
  },
  run: async (args) => {
    const requesterEmail = getRequestUserEmail();
    const requesterName = getRequestUserName();
    const commentRequestEmail = !isAnonymousPublicViewer(requesterEmail)
      ? resolvePlanOwnerEmailForWrite(requesterEmail)
      : requesterEmail;

    // Commenting requires a real account — same identity checks as update-visual-plan.
    if (isAnonymousPublicViewer(requesterEmail)) {
      throw new ForbiddenError(
        "Replying to a comment requires an agent-native account. Sign in to reply.",
      );
    }
    if (isGuestAuthorIdentity(requesterEmail)) {
      throw new ForbiddenError(
        "Replying requires an account. Sign in to reply.",
      );
    }
    if (!commentRequestEmail) {
      throw new ForbiddenError(
        "Replying to a comment requires an agent-native account. Sign in to reply.",
      );
    }

    // Viewer-level access is sufficient for commenting (mirrors update-visual-plan).
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

    // Verify the parent comment exists on this plan.
    const [parentComment] = await db
      .select({
        id: schema.planComments.id,
        planId: schema.planComments.planId,
        parentCommentId: schema.planComments.parentCommentId,
        sectionId: schema.planComments.sectionId,
        kind: schema.planComments.kind,
        anchor: schema.planComments.anchor,
        resolutionTarget: schema.planComments.resolutionTarget,
        status: schema.planComments.status,
      })
      .from(schema.planComments)
      .where(
        and(
          eq(schema.planComments.id, args.commentId),
          eq(schema.planComments.planId, args.planId),
          isNull(schema.planComments.deletedAt),
        ),
      );

    if (!parentComment) {
      throw new Error(
        `Comment not found on this plan. Verify the commentId and planId are correct.`,
      );
    }

    // Replies must target the thread root (not a nested reply's id).
    // If the supplied commentId is itself a reply, walk to the root.
    const threadRootId = parentComment.parentCommentId
      ? parentComment.parentCommentId
      : parentComment.id;

    const bundle = await loadPlanBundle(args.planId);
    const commentsBeforeInsert = bundle.comments;

    const commentInput = {
      parentCommentId: threadRootId,
      kind: args.kind ?? parentComment.kind,
      status: "open" as const,
      message: args.body,
      createdBy: "agent" as const,
      resolutionTarget: args.resolutionTarget,
    };

    const [commentRow] = buildUpdatedPlanCommentRows({
      planId: args.planId,
      comments: [commentInput],
      existingComments: bundle.comments,
      requestEmail: commentRequestEmail,
      requestName: requesterName,
      now,
    });

    if (!commentRow) throw new Error("Failed to build comment row.");

    const insertedId = commentRow.id ?? newId("cmt");

    await db
      .insert(schema.planComments)
      .values({ ...commentRow, id: insertedId });

    await writeEvent({
      planId: args.planId,
      type: "plan.updated",
      message: "Agent replied to a comment thread.",
      payload: {
        insertedCommentIds: [insertedId],
        commentCount: 1,
      },
      createdBy: "agent",
    });

    const bundleAfter = await loadPlanBundle(args.planId);

    await notifyPlanCommentRecipients({
      bundle: bundleAfter,
      insertedCommentIds: [insertedId],
      priorComments: commentsBeforeInsert,
    }).catch((error) => {
      console.warn("[reply-to-plan-comment] notification failed:", error);
    });

    const inserted = bundleAfter.comments.find((c) => c.id === insertedId);
    emitPlanCommented({
      planId: bundleAfter.plan.id,
      title: bundleAfter.plan.title,
      kind: bundleAfter.plan.kind,
      comments: inserted
        ? [
            {
              id: inserted.id,
              message: inserted.message,
              resolutionTarget: inserted.resolutionTarget,
              authorEmail: inserted.authorEmail,
              createdBy: inserted.createdBy,
            },
          ]
        : [],
      ownerEmail: bundleAfter.access?.ownerEmail,
    });

    return {
      planId: args.planId,
      commentId: insertedId,
      parentCommentId: threadRootId,
      message: args.body,
    };
  },
});
