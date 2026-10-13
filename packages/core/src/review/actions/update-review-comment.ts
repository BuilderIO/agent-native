import { z } from "zod";

import { defineAction } from "../../action.js";
import { ForbiddenError } from "../../sharing/access.js";
import { roleSatisfies } from "../../sharing/schema.js";
import { extractReviewMentions, normalizeReviewMentions } from "../mentions.js";
import { resolveReviewableResourceAccess } from "../registry.js";
import { getReviewCommentById, updateReviewComment } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const mentionSchema = z.object({
  label: z.string().min(1),
  email: z.string().email().nullable().optional(),
  id: z.string().nullable().optional(),
});

const schema = z
  .object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    commentId: z.string().min(1),
    body: z.string().min(1).optional(),
    anchor: z.unknown().optional(),
    mentions: z.array(mentionSchema).optional(),
  })
  .refine((args) => args.body !== undefined || args.anchor !== undefined, {
    message: "Provide a body or anchor to update",
  });

export default defineAction({
  description: "Update an authored review comment body or canvas anchor.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const scope = {
      userEmail: actionCtx?.userEmail ?? null,
      orgId: actionCtx?.orgId ?? null,
    };
    const access = await resolveReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
    );
    const comment = await getReviewCommentById(args.commentId, scope, {
      bypassScope: Boolean(access),
    });
    if (
      !comment ||
      comment.resourceType !== args.resourceType ||
      comment.resourceId !== args.resourceId
    ) {
      throw new Error("Review comment not found");
    }
    const isAuthor =
      Boolean(actionCtx?.userEmail) &&
      normalizeEmail(comment.authorEmail) ===
        normalizeEmail(actionCtx?.userEmail);
    const changesContent =
      args.body !== undefined || args.mentions !== undefined;
    if (
      !access ||
      !roleSatisfies(access.role, "commenter") ||
      (changesContent
        ? !isAuthor
        : !isAuthor && !roleSatisfies(access.role, "editor"))
    ) {
      throw new ForbiddenError("Not allowed to update this review comment");
    }
    const mentions =
      args.body === undefined
        ? undefined
        : normalizeReviewMentions([
            ...normalizeReviewMentions(args.mentions),
            ...extractReviewMentions(args.body),
          ]);
    const updated = await updateReviewComment(
      args.commentId,
      {
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.anchor !== undefined ? { anchor: args.anchor } : {}),
        ...(mentions !== undefined ? { mentions } : {}),
      },
      { resourceType: args.resourceType, resourceId: args.resourceId },
    );
    if (!updated) throw new Error("Review comment not found");
    return updated;
  },
  audit: {
    target: (args) => ({
      type: args.resourceType,
      id: args.resourceId,
    }),
  },
});

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}
