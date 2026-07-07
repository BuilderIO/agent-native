import { z } from "zod";

import { defineAction } from "../../action.js";
import { extractReviewMentions, normalizeReviewMentions } from "../mentions.js";
import {
  assertReviewableResourceAccess,
  normalizeReviewVisibility,
} from "../registry.js";
import { getReviewCommentById, insertReviewComment } from "../store.js";
import type { ReviewActorKind, ReviewResourceContext } from "../types.js";

const mentionSchema = z.object({
  label: z.string().min(1),
  email: z.string().email().nullable().optional(),
  id: z.string().nullable().optional(),
});

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  commentId: z.string().min(1),
  body: z.string().min(1),
  authorName: z.string().nullable().optional(),
  resolutionTarget: z.enum(["agent", "human"]).nullable().optional(),
  mentions: z.array(mentionSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export default defineAction({
  description: "Reply to an existing review comment thread.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const scope = {
      userEmail: actionCtx?.userEmail ?? null,
      orgId: actionCtx?.orgId ?? null,
    };
    const access = await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "viewer",
    );
    const parent = await getReviewCommentById(args.commentId, scope, {
      bypassScope: true,
    });
    if (
      !parent ||
      parent.resourceType !== args.resourceType ||
      parent.resourceId !== args.resourceId
    ) {
      throw new Error("Review comment not found");
    }
    const mentions = normalizeReviewMentions([
      ...normalizeReviewMentions(args.mentions),
      ...extractReviewMentions(args.body),
    ]);

    return insertReviewComment({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      threadId: parent.threadId,
      parentCommentId: parent.id,
      targetId: parent.targetId,
      kind: parent.kind,
      anchor: parent.anchor,
      body: args.body,
      authorEmail: actionCtx?.userEmail ?? null,
      authorName: args.authorName ?? actionCtx?.userEmail ?? null,
      createdBy: actorKindFromContext(actionCtx),
      resolutionTarget:
        args.resolutionTarget ??
        (mentions.length > 0 ? "human" : parent.resolutionTarget),
      mentions,
      ownerEmail: access.ownerEmail ?? actionCtx?.userEmail ?? null,
      orgId: access.orgId ?? actionCtx?.orgId ?? null,
      visibility: normalizeReviewVisibility(access.visibility),
      metadata: args.metadata,
    });
  },
  audit: {
    target: (args, result) => {
      const comment = result as {
        ownerEmail?: string | null;
        orgId?: string | null;
        visibility?: "private" | "org" | "public";
      };
      return {
        type: args.resourceType,
        id: args.resourceId,
        ownerEmail: comment.ownerEmail,
        orgId: comment.orgId,
        visibility: comment.visibility,
      };
    },
  },
});

function actorKindFromContext(
  ctx: ReviewResourceContext | undefined,
): ReviewActorKind {
  const caller = typeof ctx?.caller === "string" ? ctx.caller : "";
  if (caller === "agent" || caller === "tool") {
    return "agent";
  }
  return ctx?.userEmail ? "human" : "system";
}
