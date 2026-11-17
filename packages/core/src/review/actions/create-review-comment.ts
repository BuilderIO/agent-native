import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertReviewCommentHasContent,
  sanitizeReviewCommentMetadata,
} from "../attachments.js";
import { reviewAuthorNameFromContext } from "../identity.js";
import { extractReviewMentions, normalizeReviewMentions } from "../mentions.js";
import {
  notifyReviewComment,
  notifyReviewCommentWithReceipt,
} from "../notifications.js";
import {
  assertPersonReviewAnchorKind,
  assertReviewCommentAccess,
  normalizeReviewVisibility,
  reviewCommentPolicy,
} from "../registry.js";
import {
  insertReviewComment,
  insertReviewCommentIdempotently,
  reviewCommentIdForClientOperation,
} from "../store.js";
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
  surfaceId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("The part of the resource the thread sits on, such as a slide"),
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
  anchorKind: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("The anchor's kind, when the resource declares anchor kinds"),
  anchorVersion: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("The version the anchor was written at; defaults to the latest"),
  body: z
    .string()
    .describe("Inline Markdown; may be empty when the comment has an image"),
  authorName: z.string().nullable().optional(),
  resolutionTarget: z.enum(["agent", "human"]).nullable().optional(),
  mentions: z.array(mentionSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  clientOperationId: z
    .string()
    .uuid()
    .optional()
    .describe("Stable UUID for retrying the same comment submission"),
});

export default defineAction({
  description:
    "Create an inline comment, annotation, or review thread for a resource. Body text supports inline Markdown without headings.",
  schema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const access = await assertReviewCommentAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
    );
    const metadata = await sanitizeReviewCommentMetadata(args.metadata);
    assertReviewCommentHasContent(args.body, metadata);
    const mentions = normalizeReviewMentions([
      ...normalizeReviewMentions(args.mentions),
      ...extractReviewMentions(args.body),
    ]);
    const resolutionTarget =
      args.resolutionTarget ??
      (mentions.length > 0
        ? "human"
        : reviewCommentPolicy(args.resourceType).unmentionedRoute);

    assertPersonReviewAnchorKind(args.anchorKind);
    const input = {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      targetId: args.targetId ?? null,
      surfaceId: args.surfaceId ?? null,
      kind: (args.kind ?? "comment") as ReviewCommentKind,
      anchor: args.anchor ?? null,
      anchorKind: args.anchorKind ?? null,
      anchorVersion: args.anchorVersion ?? null,
      body: args.body,
      authorEmail: actionCtx?.userEmail ?? null,
      authorName: args.authorName ?? reviewAuthorNameFromContext(actionCtx),
      createdBy: actorKindFromContext(actionCtx),
      resolutionTarget,
      mentions,
      ownerEmail: access.ownerEmail ?? actionCtx?.userEmail ?? null,
      orgId: access.orgId ?? actionCtx?.orgId ?? null,
      visibility: normalizeReviewVisibility(access.visibility),
      metadata,
    };
    const result = args.clientOperationId
      ? await insertReviewCommentIdempotently({
          ...input,
          id: reviewCommentIdForClientOperation(args.clientOperationId),
        })
      : { comment: await insertReviewComment(input), replayed: false };

    return {
      ...result.comment,
      replayed: result.replayed,
      notified: args.clientOperationId
        ? await notifyReviewCommentWithReceipt(result.comment)
        : await notifyReviewComment(result.comment),
    };
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
