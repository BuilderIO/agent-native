import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { ForbiddenError } from "../../sharing/access.js";
import { roleSatisfies } from "../../sharing/schema.js";
import {
  canCommentOnReviewableResource,
  resolveReviewableResourceAccess,
} from "../registry.js";
import { getReviewCommentById, updateReviewComment } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  commentId: z.string().min(1),
  anchor: z.unknown().nullable(),
  anchorKind: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("A new kind for the anchor; left out, the comment's kind stays"),
  anchorVersion: z.number().int().positive().nullable().optional(),
  expectedRevision: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The comment's revision when read; a newer one refuses the move with revision_conflict",
    ),
});

export default defineAction({
  description: "Move an anchored review comment to a new canvas position.",
  schema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const userEmail = actionCtx?.userEmail?.trim().toLowerCase();
    if (!userEmail) {
      fail("A signed-in user is required", {
        statusCode: 401,
        errorCode: "unauthenticated",
      });
    }
    const access = await resolveReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
    );
    const comment = await getReviewCommentById(
      args.commentId,
      {
        userEmail: actionCtx?.userEmail ?? null,
        orgId: actionCtx?.orgId ?? null,
      },
      { bypassScope: Boolean(access) },
    );
    if (
      !comment ||
      comment.resourceType !== args.resourceType ||
      comment.resourceId !== args.resourceId ||
      comment.status === "deleted"
    ) {
      fail("Review comment not found", {
        statusCode: 404,
        errorCode: "not_found",
      });
    }
    const isAuthor = comment.authorEmail?.trim().toLowerCase() === userEmail;
    if (!access || !canCommentOnReviewableResource(args.resourceType, access)) {
      throw new ForbiddenError("Not allowed to move this review comment");
    }
    if (!isAuthor && !roleSatisfies(access.role, "editor")) {
      throw new ForbiddenError("Not allowed to move this review comment");
    }
    const moved = await updateReviewComment(
      comment.id,
      {
        anchor: args.anchor,
        ...(args.anchorKind !== undefined
          ? { anchorKind: args.anchorKind }
          : {}),
        ...(args.anchorVersion !== undefined
          ? { anchorVersion: args.anchorVersion }
          : {}),
      },
      { resourceType: args.resourceType, resourceId: args.resourceId },
      { expectedRevision: args.expectedRevision, actorEmail: userEmail },
    );
    if (!moved) {
      fail("Review comment could not be moved", {
        statusCode: 404,
        errorCode: "not_found",
      });
    }
    return {
      commentId: moved.id,
      anchor: moved.anchor,
      anchorKind: moved.anchorKind,
      anchorVersion: moved.anchorVersion,
      revision: moved.revision,
      updatedCount: 1,
    };
  },
  audit: {
    target: (args) => ({
      type: args.resourceType,
      id: args.resourceId,
    }),
  },
});
