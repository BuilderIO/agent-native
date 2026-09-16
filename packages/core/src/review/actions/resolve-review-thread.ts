import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import {
  getReviewCommentById,
  getReviewThreadRoot,
  resolveReviewThread,
} from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z
  .object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    threadId: z.string().optional(),
    commentId: z.string().optional(),
    status: z
      .enum(["resolved", "open"])
      .default("resolved")
      .describe('New thread status. "resolved" closes it; "open" reopens it.'),
    resolutionNote: z.string().trim().min(1).max(2_000).optional(),
  })
  .refine(
    (args) => args.status === "resolved" || args.resolutionNote === undefined,
    {
      path: ["resolutionNote"],
      message: "Resolution notes are only supported when resolving",
    },
  );

export default defineAction({
  description:
    "Resolve or reopen an inline comment or review thread. Resolution notes support inline Markdown without headings and are only valid when resolving.",
  schema,
  run: async (args, ctx) => {
    const status = args.status ?? "resolved";
    const actionCtx = ctx as ReviewResourceContext | undefined;
    await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "editor",
    );
    let threadId = args.threadId;
    if (!threadId && args.commentId) {
      const comment = await getReviewCommentById(
        args.commentId,
        {
          userEmail: actionCtx?.userEmail ?? null,
          orgId: actionCtx?.orgId ?? null,
        },
        { bypassScope: true },
      );
      if (
        !comment ||
        comment.resourceType !== args.resourceType ||
        comment.resourceId !== args.resourceId
      ) {
        fail("Review comment not found", {
          statusCode: 404,
          errorCode: "not_found",
        });
      }
      threadId = comment.threadId;
    }
    if (!threadId) {
      fail("Provide threadId or commentId", {
        errorCode: "invalid_input",
      });
    }
    const updatedCount = await resolveReviewThread(
      threadId,
      actionCtx?.userEmail ?? null,
      {
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      },
      args.resolutionNote,
      status,
    );
    if (updatedCount < 1) {
      fail("Review thread not found", {
        statusCode: 404,
        errorCode: "not_found",
      });
    }
    const comment = await getReviewThreadRoot(
      threadId,
      {
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      },
      {
        userEmail: actionCtx?.userEmail ?? null,
        orgId: actionCtx?.orgId ?? null,
      },
      { bypassScope: true },
    );
    if (!comment) {
      fail("Review thread status could not be verified", {
        statusCode: 500,
        errorCode: "verification_failed",
      });
    }
    return {
      threadId,
      status,
      resolved: status === "resolved",
      updatedCount,
      resolutionNote:
        status === "resolved" ? (comment.resolutionNote ?? null) : null,
      comment,
    };
  },
  audit: {
    target: (args) => ({
      type: args.resourceType,
      id: args.resourceId,
    }),
  },
});
