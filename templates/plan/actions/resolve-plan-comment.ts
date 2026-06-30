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
  commentResolutionFields,
  emitPlanCommented,
  loadPlanBundle,
  nowIso,
  writeEvent,
} from "../server/plans.js";
import type { PlanComment } from "../shared/types.js";

function rootCommentIdFor(
  comment: Pick<PlanComment, "id" | "parentCommentId">,
  commentsById: Map<string, Pick<PlanComment, "id" | "parentCommentId">>,
) {
  let current = comment;
  const seen = new Set<string>();
  while (current.parentCommentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = commentsById.get(current.parentCommentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

function threadCommentIdsFor(
  rootId: string,
  comments: Array<Pick<PlanComment, "id" | "parentCommentId">>,
) {
  const childrenByParent = new Map<string, string[]>();
  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    const children = childrenByParent.get(comment.parentCommentId) ?? [];
    children.push(comment.id);
    childrenByParent.set(comment.parentCommentId, children);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
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
    'Mark a plan comment thread as resolved or reopen it. Call this after addressing reviewer feedback to signal that the thread is handled. Pass status "resolved" to close the thread, "open" to reopen it. An optional resolutionNote posts a reply before the status change so reviewers see what was done. Resolving marks the thread done for reviewers; it does NOT remove it from get-plan-feedback — also call consume-plan-feedback (or pass consumedCommentIds to update-visual-plan) to stop the thread from appearing as pending work.',
  schema: z.object({
    planId: z.string().describe("Plan ID"),
    commentId: z
      .string()
      .describe(
        "ID of the comment (thread root) to resolve or reopen. Use get-plan-feedback to obtain comment IDs.",
      ),
    status: z
      .enum(["resolved", "open"])
      .describe(
        'New status for the thread. "resolved" closes it; "open" reopens it.',
      ),
    resolutionNote: z
      .string()
      .optional()
      .describe(
        "Optional message to post as a reply before changing the status — use this to briefly explain what was done or why the thread is being closed.",
      ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Resolve Plan Comment",
    description:
      "Mark a comment thread on an Agent-Native Plan as resolved or reopen it.",
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

    // Same identity checks as update-visual-plan comment paths.
    if (isAnonymousPublicViewer(requesterEmail)) {
      throw new ForbiddenError(
        "Resolving a comment requires an agent-native account. Sign in to resolve.",
      );
    }
    if (isGuestAuthorIdentity(requesterEmail)) {
      throw new ForbiddenError(
        "Resolving a comment requires an account. Sign in to resolve.",
      );
    }
    if (!commentRequestEmail) {
      throw new ForbiddenError(
        "Resolving a comment requires an agent-native account. Sign in to resolve.",
      );
    }

    // Viewer-level access is sufficient for status changes (mirrors update-visual-plan).
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

    // Load the existing comment — must be on this plan.
    const [existing] = await db
      .select({
        id: schema.planComments.id,
        planId: schema.planComments.planId,
        parentCommentId: schema.planComments.parentCommentId,
        sectionId: schema.planComments.sectionId,
        kind: schema.planComments.kind,
        anchor: schema.planComments.anchor,
        message: schema.planComments.message,
        createdBy: schema.planComments.createdBy,
        authorEmail: schema.planComments.authorEmail,
        resolutionTarget: schema.planComments.resolutionTarget,
        mentionsJson: schema.planComments.mentionsJson,
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

    if (!existing) {
      throw new Error(
        `Comment not found on this plan. Verify the commentId and planId are correct.`,
      );
    }

    const resolution = commentResolutionFields({
      status: args.status,
      createdBy: existing.createdBy,
      authorEmail: existing.authorEmail,
      requestEmail: commentRequestEmail,
      now,
    });
    const bundle = await loadPlanBundle(args.planId);
    const commentsById = new Map(
      bundle.comments.map((comment) => [
        comment.id,
        {
          id: comment.id,
          parentCommentId: comment.parentCommentId,
        },
      ]),
    );
    const threadRootId = rootCommentIdFor(existing, commentsById);
    const existingThreadCommentIds = threadCommentIdsFor(
      threadRootId,
      bundle.comments,
    );
    const updatedCommentIds =
      existingThreadCommentIds.length > 0
        ? existingThreadCommentIds
        : [existing.id];

    // Optionally post a reply note before updating the status.
    let insertedNoteId: string | undefined;
    if (args.resolutionNote) {
      const noteRows = buildUpdatedPlanCommentRows({
        planId: args.planId,
        comments: [
          {
            parentCommentId: threadRootId,
            kind: existing.kind,
            status: args.status,
            message: args.resolutionNote,
            createdBy: "agent" as const,
          },
        ],
        existingComments: bundle.comments,
        requestEmail: commentRequestEmail,
        requestName: requesterName,
        now,
      });
      const noteRow = noteRows[0];
      if (noteRow) {
        await db.insert(schema.planComments).values(noteRow);
        insertedNoteId = noteRow.id;
      }
    }
    const allUpdatedCommentIds = insertedNoteId
      ? [...updatedCommentIds, insertedNoteId]
      : updatedCommentIds;

    for (const commentId of allUpdatedCommentIds) {
      await db
        .update(schema.planComments)
        .set({
          status: args.status,
          resolvedBy: resolution.resolvedBy,
          resolvedAt: resolution.resolvedAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.planComments.id, commentId),
            eq(schema.planComments.planId, args.planId),
            isNull(schema.planComments.deletedAt),
          ),
        );
    }

    await writeEvent({
      planId: args.planId,
      type: "plan.updated",
      message: `Comment ${args.commentId} ${args.status === "resolved" ? "resolved" : "reopened"}.`,
      payload: {
        existingCommentIdsUpdated: updatedCommentIds,
        insertedCommentIds: insertedNoteId ? [insertedNoteId] : [],
        resolutionNote: args.resolutionNote ?? null,
      },
      createdBy: "agent",
    });

    // Notify and emit events for the reply note (if any).
    if (insertedNoteId) {
      const bundleAfter = await loadPlanBundle(args.planId);
      await notifyPlanCommentRecipients({
        bundle: bundleAfter,
        insertedCommentIds: [insertedNoteId],
      }).catch((error) => {
        console.warn("[resolve-plan-comment] notification failed:", error);
      });
      const inserted = bundleAfter.comments.find(
        (c) => c.id === insertedNoteId,
      );
      if (inserted) {
        emitPlanCommented({
          planId: bundleAfter.plan.id,
          title: bundleAfter.plan.title,
          kind: bundleAfter.plan.kind,
          comments: [
            {
              id: inserted.id,
              message: inserted.message,
              resolutionTarget: inserted.resolutionTarget,
              authorEmail: inserted.authorEmail,
              createdBy: inserted.createdBy,
            },
          ],
          ownerEmail: bundleAfter.access?.ownerEmail,
        });
      }
    }

    return {
      planId: args.planId,
      commentId: args.commentId,
      status: args.status,
      resolvedBy: resolution.resolvedBy,
      resolvedAt: resolution.resolvedAt,
      ...(insertedNoteId ? { resolutionNoteId: insertedNoteId } : {}),
    };
  },
});
