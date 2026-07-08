import { z } from "zod";

import { defineAction } from "../../action.js";
import { extractReviewMentions, normalizeReviewMentions } from "../mentions.js";
import {
  assertReviewableResourceAccess,
  normalizeReviewVisibility,
} from "../registry.js";
import { insertReviewComment } from "../store.js";
import type {
  ReviewActorKind,
  ReviewCommentKind,
  ReviewResourceContext,
} from "../types.js";

const mentionSchema = z.object({
  label: z.string().min(1),
  email: z.string().email().nullable().optional(),
  id: z.string().nullable().optional(),
});

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  targetId: z.string().nullable().optional(),
  kind: z
    .enum([
      "comment",
      "annotation",
      "correction",
      "question",
      "decision",
      "review",
    ])
    .optional(),
  anchor: z.unknown().nullable().optional(),
  body: z.string().min(1),
  authorName: z.string().nullable().optional(),
  resolutionTarget: z.enum(["agent", "human"]).nullable().optional(),
  mentions: z.array(mentionSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export default defineAction({
  description:
    "Create an inline comment, annotation, or review thread for a resource.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const access = await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "viewer",
    );
    const mentions = normalizeReviewMentions([
      ...normalizeReviewMentions(args.mentions),
      ...extractReviewMentions(args.body),
    ]);
    const resolutionTarget =
      args.resolutionTarget ?? (mentions.length > 0 ? "human" : "agent");

    return insertReviewComment({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      targetId: args.targetId ?? null,
      kind: (args.kind ?? "comment") as ReviewCommentKind,
      anchor: args.anchor ?? null,
      body: args.body,
      authorEmail: actionCtx?.userEmail ?? null,
      authorName: args.authorName ?? actionCtx?.userEmail ?? null,
      createdBy: actorKindFromContext(actionCtx),
      resolutionTarget,
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
