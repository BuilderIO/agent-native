import type {
  ReviewComment,
  ReviewCommentKind,
  ReviewMention,
  ReviewResolutionTarget,
  ReviewStatus,
  ReviewStatusEntry,
} from "../../review/types.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

export interface ListReviewCommentsParams {
  resourceType: string;
  resourceId: string;
  includeResolved?: boolean;
  includeDeleted?: boolean;
  targetId?: string | null;
  limit?: number;
}

export interface ListReviewCommentsResult {
  comments: ReviewComment[];
  reviewStatus: ReviewStatusEntry | null;
}

export interface CreateReviewCommentInput {
  resourceType: string;
  resourceId: string;
  targetId?: string | null;
  kind?: ReviewCommentKind;
  anchor?: unknown | null;
  body: string;
  authorName?: string | null;
  resolutionTarget?: ReviewResolutionTarget | null;
  mentions?: ReviewMention[];
  metadata?: Record<string, unknown>;
}

export interface ReplyReviewCommentInput {
  resourceType: string;
  resourceId: string;
  commentId: string;
  body: string;
  authorName?: string | null;
  resolutionTarget?: ReviewResolutionTarget | null;
  mentions?: ReviewMention[];
  metadata?: Record<string, unknown>;
}

export interface ResolveReviewThreadInput {
  resourceType: string;
  resourceId: string;
  threadId?: string;
  commentId?: string;
}

export interface DeleteReviewCommentInput {
  resourceType: string;
  resourceId: string;
  commentId: string;
}

export interface SetReviewStatusInput {
  resourceType: string;
  resourceId: string;
  status: ReviewStatus;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

export function useReviewComments(
  params: ListReviewCommentsParams,
  options?: { enabled?: boolean },
) {
  return useActionQuery<ListReviewCommentsResult>(
    "list-review-comments",
    params,
    {
      enabled:
        options?.enabled ?? Boolean(params.resourceType && params.resourceId),
    },
  );
}

export function useCreateReviewComment() {
  return useActionMutation<ReviewComment, CreateReviewCommentInput>(
    "create-review-comment",
  );
}

export function useReplyReviewComment() {
  return useActionMutation<ReviewComment, ReplyReviewCommentInput>(
    "reply-review-comment",
  );
}

export function useResolveReviewThread() {
  return useActionMutation<
    { threadId: string; resolved: true },
    ResolveReviewThreadInput
  >("resolve-review-thread");
}

export function useDeleteReviewComment() {
  return useActionMutation<
    { commentId: string; deleted: true },
    DeleteReviewCommentInput
  >("delete-review-comment");
}

export function useSetReviewStatus() {
  return useActionMutation<ReviewStatusEntry, SetReviewStatusInput>(
    "set-review-status",
  );
}
