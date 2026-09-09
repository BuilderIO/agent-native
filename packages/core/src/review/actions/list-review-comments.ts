import { z } from "zod";

import { defineAction } from "../../action.js";
import { roleSatisfies } from "../../sharing/schema.js";
import {
  isEmailDerivedName,
  resolveUserProfileName,
} from "../../user-profile/shared.js";
import { getUserProfiles } from "../../user-profile/store.js";
import {
  redactPublicReviewCommentIdentity,
  redactPublicReviewStatusIdentity,
  shouldRedactReviewIdentity,
} from "../identity.js";
import { assertReviewableResourceAccess } from "../registry.js";
import {
  getReviewStatus,
  getReviewThreadSummary,
  queryReviewComments,
} from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  includeResolved: z.boolean().optional(),
  includeDeleted: z.boolean().optional(),
  targetId: z.string().nullable().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export default defineAction({
  description:
    "List inline comments, annotations, and review threads for a resource.",
  schema,
  http: { method: "GET" },
  requiresAuth: false,
  readOnly: true,
  parallelSafe: true,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const access = await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "viewer",
    );
    const scope = {
      userEmail: actionCtx?.userEmail ?? null,
      orgId: actionCtx?.orgId ?? null,
    };
    const [comments, reviewStatus, summary] = await Promise.all([
      queryReviewComments({
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        scope,
        bypassScope: true,
        includeResolved: args.includeResolved,
        includeDeleted: args.includeDeleted,
        targetId: args.targetId,
        limit: args.limit,
      }),
      getReviewStatus(args.resourceType, args.resourceId, scope, {
        bypassScope: true,
      }),
      getReviewThreadSummary({
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        scope,
        bypassScope: true,
        targetId: args.targetId,
      }),
    ]);
    const profiles = await getUserProfiles(
      comments.flatMap((comment) =>
        comment.authorEmail &&
        isEmailDerivedName(comment.authorName, comment.authorEmail)
          ? [comment.authorEmail]
          : [],
      ),
    );
    const redactIdentity = shouldRedactReviewIdentity(actionCtx, access);
    const commentsWithCapabilities = comments.map((comment) => ({
      ...comment,
      ...(comment.authorEmail
        ? {
            authorName: resolveUserProfileName(
              comment.authorEmail,
              comment.authorName,
              profiles.get(comment.authorEmail.toLowerCase())?.name,
            ),
          }
        : {}),
      canDelete:
        roleSatisfies(access.role, "commenter") &&
        (roleSatisfies(access.role, "editor") ||
          Boolean(
            actionCtx?.userEmail && comment.authorEmail === actionCtx.userEmail,
          )),
    }));
    return redactIdentity
      ? {
          comments: commentsWithCapabilities.map(
            redactPublicReviewCommentIdentity,
          ),
          reviewStatus: redactPublicReviewStatusIdentity(reviewStatus),
          summary,
        }
      : { comments: commentsWithCapabilities, reviewStatus, summary };
  },
});
