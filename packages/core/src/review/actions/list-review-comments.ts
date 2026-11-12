import { z } from "zod";

import { defineAction } from "../../action.js";
import { roleSatisfies } from "../../sharing/schema.js";
import {
  isEmailDerivedName,
  resolveUserProfileName,
} from "../../user-profile/shared.js";
import { getUserProfiles } from "../../user-profile/store.js";
import { sanitizeReviewCommentMetadata } from "../attachments.js";
import {
  redactPublicReviewCommentIdentity,
  redactPublicReviewStatusIdentity,
  shouldRedactReviewIdentity,
} from "../identity.js";
import {
  assertReviewableResourceAccess,
  canCommentOnReviewableResource,
} from "../registry.js";
import {
  getLiveReviewAuthorsByThread,
  getReviewStatus,
  getReviewDiscussionStateForComments,
  getReviewThreadSummary,
  queryReviewCommentPage,
  queryReviewComments,
} from "../store.js";
import { canDeleteReviewThread } from "../thread-delete.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  includeResolved: z.boolean().optional(),
  includeDeleted: z.boolean().optional(),
  targetId: z.string().nullable().optional(),
  surfaceId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("One surface's comments, or null for those on no surface"),
  newestFirst: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The nextCursor from the previous page; pages run oldest first only",
    ),
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
    const query = {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      scope,
      bypassScope: true,
      includeResolved: args.includeResolved,
      includeDeleted: args.includeDeleted,
      targetId: args.targetId,
      surfaceId: args.surfaceId,
      newestFirst: args.newestFirst,
      limit: args.limit,
    };
    // Newest first lists whole threads by latest activity, which no cursor
    // can resume, so only oldest first pages; a cursor with it is refused.
    const [page, reviewStatus, summary] = await Promise.all([
      args.newestFirst && !args.cursor
        ? queryReviewComments(query).then((comments) => ({
            comments,
            // Not paged, so no cursor; null would claim the list is complete.
            nextCursor: undefined,
          }))
        : queryReviewCommentPage({ ...query, cursor: args.cursor }),
      getReviewStatus(args.resourceType, args.resourceId, scope, {
        bypassScope: true,
      }),
      getReviewThreadSummary({
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        scope,
        bypassScope: true,
        targetId: args.targetId,
        surfaceId: args.surfaceId,
      }),
    ]);
    const comments = await Promise.all(
      page.comments.map(async (comment) => ({
        ...comment,
        metadata: await sanitizeReviewCommentMetadata(comment.metadata),
      })),
    );
    const discussion = {
      ...(await getReviewDiscussionStateForComments(
        comments,
        actionCtx?.userEmail ?? null,
      )),
      canReact:
        Boolean(actionCtx?.userEmail) &&
        canCommentOnReviewableResource(args.resourceType, access),
      canSetThreadPreferences: Boolean(actionCtx?.userEmail),
    };
    const profiles = await getUserProfiles(
      comments.flatMap((comment) =>
        comment.authorEmail &&
        isEmailDerivedName(comment.authorName, comment.authorEmail)
          ? [comment.authorEmail]
          : [],
      ),
    );
    const redactIdentity = shouldRedactReviewIdentity(actionCtx, access);
    const isEditor = roleSatisfies(access.role, "editor");
    const canComment = canCommentOnReviewableResource(
      args.resourceType,
      access,
      Boolean(actionCtx?.userEmail),
    );
    // Only a commenter's own threads can turn on who else wrote in them: an
    // editor may delete any, and nobody else may delete one they did not start.
    // So each first comment asked about here is the reader's own, and its
    // author among the thread's authors changes nothing.
    const authorsByThread =
      canComment && !isEditor
        ? await getLiveReviewAuthorsByThread(
            comments
              .filter(
                (comment) =>
                  !comment.parentCommentId &&
                  canDeleteReviewThread({
                    isEditor,
                    actorEmail: actionCtx?.userEmail,
                    rootAuthorEmail: comment.authorEmail,
                    replyAuthorEmails: [],
                  }),
              )
              .map((comment) => comment.threadId),
            { resourceType: args.resourceType, resourceId: args.resourceId },
          )
        : new Map<string, Array<string | null>>();
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
        canComment &&
        (isEditor ||
          Boolean(
            actionCtx?.userEmail && comment.authorEmail === actionCtx.userEmail,
          )),
      ...(comment.parentCommentId
        ? {}
        : {
            canDeleteThread:
              canComment &&
              canDeleteReviewThread({
                isEditor,
                actorEmail: actionCtx?.userEmail,
                rootAuthorEmail: comment.authorEmail,
                replyAuthorEmails: authorsByThread.get(comment.threadId) ?? [],
              }),
          }),
    }));
    return redactIdentity
      ? {
          comments: commentsWithCapabilities.map(
            redactPublicReviewCommentIdentity,
          ),
          nextCursor: page.nextCursor,
          reviewStatus: redactPublicReviewStatusIdentity(reviewStatus),
          summary,
          discussion,
        }
      : {
          comments: commentsWithCapabilities,
          nextCursor: page.nextCursor,
          reviewStatus,
          summary,
          discussion,
        };
  },
});
