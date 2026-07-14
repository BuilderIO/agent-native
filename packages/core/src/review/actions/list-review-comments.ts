import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import {
  getReviewStatus,
  getReviewThreadSummary,
  queryReviewComments,
} from "../store.js";
import type {
  ReviewComment,
  ReviewResourceContext,
  ReviewStatusEntry,
} from "../types.js";

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
    const redactIdentity =
      !actionCtx?.userEmail ||
      (access.visibility === "public" && access.role === "viewer");
    const commentsWithCapabilities = comments.map((comment) => ({
      ...comment,
      canDelete:
        access.role !== "viewer" ||
        Boolean(
          actionCtx?.userEmail && comment.authorEmail === actionCtx.userEmail,
        ),
    }));
    return redactIdentity
      ? {
          comments: commentsWithCapabilities.map(redactPublicCommentIdentity),
          reviewStatus: redactPublicReviewStatusIdentity(reviewStatus),
          summary,
        }
      : { comments: commentsWithCapabilities, reviewStatus, summary };
  },
});

function redactPublicCommentIdentity(comment: ReviewComment): ReviewComment {
  return {
    ...comment,
    authorEmail: null,
    authorName: safeDisplayName(comment.authorName),
    mentions: comment.mentions.map((mention) => ({
      label: safeDisplayName(mention.label) ?? "Mentioned user",
    })),
    ownerEmail: null,
    orgId: null,
    resolvedBy: null,
    deletedBy: null,
    metadata: redactPublicMetadata(comment.metadata),
  };
}

function redactPublicReviewStatusIdentity(
  status: ReviewStatusEntry | null,
): ReviewStatusEntry | null {
  return status
    ? {
        ...status,
        updatedBy: null,
        ownerEmail: null,
        orgId: null,
        metadata: redactPublicMetadata(status.metadata),
      }
    : null;
}

function safeDisplayName(value: string | null | undefined): string | null {
  const name = value?.trim();
  if (!name || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) {
    return null;
  }
  return name;
}

function redactPublicMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) =>
      /^(authorEmail|ownerEmail|orgId|updatedBy|resolvedBy|deletedBy|email|userEmail|userId)$/i.test(
        key,
      )
        ? []
        : [[key, redactPublicMetadataValue(value)]],
    ),
  );
}

function redactPublicMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPublicMetadataValue);
  }
  if (typeof value === "object" && value !== null) {
    return redactPublicMetadata(value as Record<string, unknown>);
  }
  if (
    typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  ) {
    return null;
  }
  return value;
}
