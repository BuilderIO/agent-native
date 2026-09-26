import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import type {
  ResourceSuggestion,
  ResourceSuggestionProposal,
  SuggestionDecision,
  SuggestionOperation,
  SuggestionStatus,
} from "../../review/suggestions/types.js";
import type {
  ReviewComment,
  ReviewCommentKind,
  ReviewDiscussionState,
  ReviewThreadPreference,
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
  newestFirst?: boolean;
  limit?: number;
}

export interface ListReviewCommentsResult {
  comments: ReviewComment[];
  discussion: ReviewDiscussionState;
  reviewStatus: ReviewStatusEntry | null;
  summary: {
    openCount: number;
    agentQueueCount: number;
  };
}

export interface GetReviewFeedbackParams {
  resourceType: string;
  resourceId: string;
  includeHumanTargeted?: boolean;
  limit?: number;
}

export interface GetReviewFeedbackResult {
  comments: ReviewComment[];
}

export interface CreateReviewCommentInput {
  resourceType: string;
  resourceId: string;
  targetId?: string | null;
  kind?: ReviewCommentKind;
  anchor?: unknown;
  body: string;
  authorName?: string | null;
  resolutionTarget?: ReviewResolutionTarget | null;
  mentions?: ReviewMention[];
  metadata?: Record<string, unknown>;
  /** Reuse when retrying one logical submission so create is idempotent. */
  clientOperationId?: string;
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
  /** Reuse when retrying one logical submission so reply is idempotent. */
  clientOperationId?: string;
}

export interface ReactToReviewCommentInput {
  resourceType: string;
  resourceId: string;
  commentId: string;
  reaction: string;
  active: boolean;
}

export interface SetReviewThreadUnreadInput {
  resourceType: string;
  resourceId: string;
  threadId: string;
  unread: boolean;
}

export interface SetReviewThreadsUnreadInput {
  resourceType: string;
  resourceId: string;
  threadIds: string[];
  unread: boolean;
}

export interface SetReviewThreadMutedInput {
  resourceType: string;
  resourceId: string;
  threadId: string;
  muted: boolean;
}

export type ReviewThreadStatus = "open" | "resolved";

export function useReactToReviewComment() {
  const queryClient = useQueryClient();
  return useActionMutation<
    {
      commentId: string;
      actorEmail: string;
      reaction: string;
      active: boolean;
    },
    ReactToReviewCommentInput
  >("react-to-review-comment", {
    skipActionQueryInvalidation: true,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["action", "list-review-comments"],
      }),
  });
}

export function useSetReviewThreadUnread() {
  const queryClient = useQueryClient();
  return useActionMutation<
    ReviewThreadPreference & { threadId: string },
    SetReviewThreadUnreadInput
  >("set-review-thread-unread", {
    skipActionQueryInvalidation: true,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["action", "list-review-comments"],
      }),
  });
}

export function useSetReviewThreadsUnread() {
  const queryClient = useQueryClient();
  return useActionMutation<
    Array<ReviewThreadPreference & { threadId: string }>,
    SetReviewThreadsUnreadInput
  >("set-review-threads-unread", {
    skipActionQueryInvalidation: true,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["action", "list-review-comments"],
      }),
  });
}

export function useSetReviewThreadMuted() {
  const queryClient = useQueryClient();
  return useActionMutation<
    ReviewThreadPreference & { threadId: string },
    SetReviewThreadMutedInput
  >("set-review-thread-muted", {
    skipActionQueryInvalidation: true,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["action", "list-review-comments"],
      }),
  });
}

export interface ResolveReviewThreadInput {
  resourceType: string;
  resourceId: string;
  threadId?: string;
  commentId?: string;
  status?: ReviewThreadStatus;
  resolutionNote?: string;
}

export interface ResolveReviewThreadResult {
  threadId: string;
  status: ReviewThreadStatus;
  resolved: boolean;
  updatedCount: number;
  resolutionNote: string | null;
  comment: ReviewComment;
}

export interface DeleteReviewCommentInput {
  resourceType: string;
  resourceId: string;
  commentId: string;
}

export interface UpdateReviewCommentInput {
  resourceType: string;
  resourceId: string;
  commentId: string;
  body?: string;
  anchor?: unknown;
  mentions?: ReviewMention[];
}

export interface ConsumeReviewFeedbackInput {
  resourceType: string;
  resourceId: string;
  commentIds: string[];
}

export interface SendReviewThreadToAgentInput {
  resourceType: string;
  resourceId: string;
  threadId: string;
}

export interface SetReviewStatusInput {
  resourceType: string;
  resourceId: string;
  status: ReviewStatus;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListResourceSuggestionsParams {
  resourceType: string;
  resourceId: string;
  statuses?: SuggestionStatus[];
}

export interface CreateResourceSuggestionInput {
  resourceType: string;
  resourceId: string;
  adapterKind: string;
  baseRevision: string;
  summary: string;
  idempotencyKey: string;
  operations: SuggestionOperation[];
  metadata?: Record<string, unknown>;
}

export interface DecideResourceSuggestionInput {
  id: string;
  decision: SuggestionDecision;
  idempotencyKey: string;
  observedBase: string;
  observedRevision?: number;
}
export interface CreateResourceSuggestionProposalInput {
  resourceType: string;
  resourceId: string;
  adapterKind: string;
  baseRevision: string;
  summary: string;
  proposalId?: string;
  idempotencyKey: string;
  suggestions: {
    summary: string;
    operations: SuggestionOperation[];
    metadata?: Record<string, unknown>;
  }[];
}
export interface DecideResourceSuggestionProposalInput {
  proposalId: string;
  decision: SuggestionDecision;
  idempotencyKey: string;
  members: { id: string; observedRevision: number; observedBase: string }[];
}
export interface ResourceSuggestionProposalResult {
  proposal: ResourceSuggestionProposal;
  suggestions: ResourceSuggestion[];
}

export interface UpdateResourceSuggestionInput {
  id: string;
  observedRevision: number;
  idempotencyKey: string;
  operations: SuggestionOperation[];
  summary?: string;
}

type ReviewResource = Pick<
  ListReviewCommentsParams,
  "resourceType" | "resourceId"
>;

type ReviewQueryAction = "list-review-comments" | "list-resource-suggestions";

type OptimisticTransform = (data: unknown, params: unknown) => unknown;

interface OptimisticOperation {
  id: string;
  pending: boolean;
  transform: OptimisticTransform;
  onSuccess?: (result: unknown) => OptimisticTransform;
  successReplacesOptimistic?: boolean;
}

interface OptimisticQueryState {
  queryKey: readonly unknown[];
  resource: ReviewResource;
  base: unknown;
  rendered: unknown;
  operations: Map<string, OptimisticOperation>;
}

export interface ReviewOptimisticMutation {
  action: ReviewQueryAction;
  resource: ReviewResource;
  transform: OptimisticTransform;
  onSuccess?: (result: unknown) => OptimisticTransform;
  successReplacesOptimistic?: boolean;
}

export interface ReviewOptimisticMutationContext {
  operationId: string;
  action: ReviewQueryAction;
  resource: ReviewResource;
  queryHashes: string[];
}

/**
 * Review writes can settle out of order. Keep each pending intent as an
 * overlay rather than restoring a whole cache snapshot when one fails.
 */
export class ReviewOptimisticCache {
  private readonly queries = new Map<string, OptimisticQueryState>();
  private readonly resourceOperations = new Map<string, Set<string>>();
  private readonly activeMutations = new Map<
    string,
    {
      mutation: ReviewOptimisticMutation;
      context: ReviewOptimisticMutationContext;
    }
  >();
  private nextOperation = 0;
  private rendering = false;

  constructor(private readonly queryClient: QueryClient) {
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "added") {
        for (const { mutation, context } of this.activeMutations.values()) {
          this.attach(event.query, mutation, context);
        }
        return;
      }
      if (event.type !== "updated") return;
      const state = this.queries.get(event.query.queryHash);
      if (!state || this.rendering || event.query.state.data === state.rendered)
        return;
      state.base = event.query.state.data;
      this.render(state);
    });
  }

  begin(mutation: ReviewOptimisticMutation): ReviewOptimisticMutationContext {
    const operationId = `review-optimistic-${++this.nextOperation}`;
    const resourceKey = reviewResourceKey(mutation.resource);
    const resourceOperations =
      this.resourceOperations.get(resourceKey) ?? new Set();
    resourceOperations.add(operationId);
    this.resourceOperations.set(resourceKey, resourceOperations);

    const context: ReviewOptimisticMutationContext = {
      operationId,
      action: mutation.action,
      resource: mutation.resource,
      queryHashes: [],
    };
    this.activeMutations.set(operationId, { mutation, context });
    for (const query of this.queryClient
      .getQueryCache()
      .findAll({ queryKey: ["action", mutation.action] })) {
      this.attach(query, mutation, context);
    }
    return context;
  }

  succeed(
    context: ReviewOptimisticMutationContext | undefined,
    result: unknown,
  ) {
    if (!context) return;
    for (const queryHash of context.queryHashes) {
      const state = this.queries.get(queryHash);
      const operation = state?.operations.get(context.operationId);
      if (!state || !operation) continue;
      operation.pending = false;
      if (operation.onSuccess) {
        const optimisticTransform = operation.transform;
        const successTransform = operation.onSuccess(result);
        operation.transform = operation.successReplacesOptimistic
          ? successTransform
          : (data, params) =>
              successTransform(optimisticTransform(data, params), params);
      }
      this.render(state);
    }
  }

  fail(context: ReviewOptimisticMutationContext | undefined) {
    if (!context) return;
    for (const queryHash of context.queryHashes) {
      const state = this.queries.get(queryHash);
      if (!state || !state.operations.delete(context.operationId)) continue;
      this.render(state);
    }
  }

  settle(context: ReviewOptimisticMutationContext | undefined) {
    if (!context) return;
    this.activeMutations.delete(context.operationId);
    const resourceKey = reviewResourceKey(context.resource);
    const resourceOperations = this.resourceOperations.get(resourceKey);
    resourceOperations?.delete(context.operationId);
    if (resourceOperations?.size) return;
    this.resourceOperations.delete(resourceKey);

    for (const [queryHash, state] of this.queries) {
      if (reviewResourceKey(state.resource) !== resourceKey) continue;
      if (
        [...state.operations.values()].some((operation) => operation.pending)
      ) {
        continue;
      }
      this.render(state);
      this.queries.delete(queryHash);
    }
    void this.queryClient.invalidateQueries({
      predicate: (query) =>
        (isReviewQueryAction(query.queryKey[1]) ||
          query.queryKey[1] === "get-review-feedback") &&
        matchesReviewResource(query.queryKey[2], context.resource),
    });
  }

  private render(state: OptimisticQueryState) {
    const params = state.queryKey[2];
    const data = [...state.operations.values()].reduce(
      (current, operation) => operation.transform(current, params),
      state.base,
    );
    state.rendered = data;
    this.rendering = true;
    try {
      this.queryClient.setQueryData(state.queryKey, data);
      state.rendered = this.queryClient.getQueryData(state.queryKey);
    } finally {
      this.rendering = false;
    }
  }

  private attach(
    query: {
      queryHash: string;
      queryKey: readonly unknown[];
      state: { data: unknown };
    },
    mutation: ReviewOptimisticMutation,
    context: ReviewOptimisticMutationContext,
  ) {
    if (
      query.queryKey[0] !== "action" ||
      query.queryKey[1] !== mutation.action ||
      !matchesReviewResource(query.queryKey[2], mutation.resource) ||
      context.queryHashes.includes(query.queryHash)
    ) {
      return;
    }
    const state = this.queries.get(query.queryHash) ?? {
      queryKey: query.queryKey,
      resource: mutation.resource,
      base: query.state.data,
      rendered: query.state.data,
      operations: new Map<string, OptimisticOperation>(),
    };
    state.operations.set(context.operationId, {
      id: context.operationId,
      pending: true,
      transform: mutation.transform,
      onSuccess: mutation.onSuccess,
      successReplacesOptimistic: mutation.successReplacesOptimistic,
    });
    this.queries.set(query.queryHash, state);
    context.queryHashes.push(query.queryHash);
    this.render(state);
  }
}

const optimisticCaches = new WeakMap<QueryClient, ReviewOptimisticCache>();

function reviewOptimisticCache(queryClient: QueryClient) {
  let cache = optimisticCaches.get(queryClient);
  if (!cache) {
    cache = new ReviewOptimisticCache(queryClient);
    optimisticCaches.set(queryClient, cache);
  }
  return cache;
}

function reviewResourceKey(resource: ReviewResource) {
  return `${resource.resourceType}:${resource.resourceId}`;
}

function matchesReviewResource(
  params: unknown,
  resource: ReviewResource,
): params is ReviewResource {
  if (!params || typeof params !== "object") return false;
  const value = params as Partial<ReviewResource>;
  return (
    value.resourceType === resource.resourceType &&
    value.resourceId === resource.resourceId
  );
}

function isReviewQueryAction(value: unknown): value is ReviewQueryAction {
  return (
    value === "list-review-comments" || value === "list-resource-suggestions"
  );
}

function useOptimisticReviewMutation<TData, TVariables>(
  actionName: string,
  mutation: (
    variables: TVariables,
    queryClient: QueryClient,
  ) => ReviewOptimisticMutation,
) {
  const queryClient = useQueryClient();
  const cache = reviewOptimisticCache(queryClient);
  return useActionMutation<TData, TVariables>(actionName, {
    skipActionQueryInvalidation: true,
    onMutate: (variables) =>
      cache.begin(mutation(variables as TVariables, queryClient)),
    onSuccess: (result, _variables, context) =>
      cache.succeed(
        context as ReviewOptimisticMutationContext | undefined,
        result,
      ),
    onError: (_error, _variables, context) =>
      cache.fail(context as ReviewOptimisticMutationContext | undefined),
    onSettled: (_result, _error, _variables, context) =>
      cache.settle(context as ReviewOptimisticMutationContext | undefined),
  });
}

function updateComments(
  data: unknown,
  transform: (comments: ReviewComment[]) => ReviewComment[],
): unknown {
  if (!isReviewCommentsResult(data)) return data;
  const comments = transform(data.comments);
  return {
    ...data,
    comments,
    summary: updateCommentSummary(data.summary, data.comments, comments),
  };
}

function isReviewCommentsResult(
  data: unknown,
): data is ListReviewCommentsResult {
  return (
    !!data &&
    typeof data === "object" &&
    Array.isArray((data as ListReviewCommentsResult).comments)
  );
}

function updateCommentSummary(
  summary: ListReviewCommentsResult["summary"],
  previous: ReviewComment[],
  next: ReviewComment[],
) {
  const count = (comments: ReviewComment[], target: "open" | "agent") =>
    comments.filter(
      (comment) =>
        comment.parentCommentId === null &&
        comment.status === "open" &&
        (target === "open" ||
          (comment.resolutionTarget !== "human" &&
            comment.consumedAt === null)),
    ).length;
  return {
    openCount: Math.max(
      0,
      summary.openCount + count(next, "open") - count(previous, "open"),
    ),
    agentQueueCount: Math.max(
      0,
      summary.agentQueueCount + count(next, "agent") - count(previous, "agent"),
    ),
  };
}

function matchesCommentQuery(
  params: unknown,
  comment: Pick<ReviewComment, "targetId" | "status">,
) {
  if (!params || typeof params !== "object") return true;
  const query = params as ListReviewCommentsParams;
  if (query.targetId !== undefined && query.targetId !== comment.targetId)
    return false;
  if (comment.status === "resolved" && !query.includeResolved) return false;
  if (comment.status === "deleted" && !query.includeDeleted) return false;
  return true;
}

function optimisticComment(
  input: CreateReviewCommentInput | ReplyReviewCommentInput,
  id: string,
  parent: ReviewComment | undefined,
): ReviewComment {
  const now = new Date().toISOString();
  const mentions = input.mentions ?? [];
  const resolutionTarget =
    input.resolutionTarget ?? (mentions.length > 0 ? "human" : "agent");
  return {
    id,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    threadId: parent?.threadId ?? id,
    parentCommentId: parent?.id ?? null,
    targetId:
      parent?.targetId ??
      ("targetId" in input ? (input.targetId ?? null) : null),
    kind:
      parent?.kind ?? ("kind" in input ? (input.kind ?? "comment") : "comment"),
    status: "open",
    anchor:
      parent?.anchor ?? ("anchor" in input ? (input.anchor ?? null) : null),
    body: input.body,
    authorEmail: null,
    authorName: input.authorName ?? null,
    createdBy: "human",
    resolutionTarget: parent ? null : resolutionTarget,
    mentions,
    ownerEmail: null,
    orgId: null,
    visibility: "private",
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedBy: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? null,
    canDelete: true,
  };
}

function replaceComment(
  comments: ReviewComment[],
  previousId: string,
  replacement: ReviewComment,
) {
  return comments.map((comment) =>
    comment.id === previousId ? replacement : comment,
  );
}

export function insertOptimisticComment(
  comments: ReviewComment[],
  comment: ReviewComment,
  params: unknown,
) {
  if (comments.some((item) => item.id === comment.id)) return comments;
  const query = params as ListReviewCommentsParams | undefined;
  const limit = query?.limit ?? 200;
  if (comment.parentCommentId) return [...comments, comment];
  const roots = comments.filter((item) => item.parentCommentId === null);
  if (!query?.newestFirst && roots.length >= limit) return comments;
  const next = [...comments, comment];
  if (!query?.newestFirst || roots.length < limit) return next;
  const activity = new Map<string, string>();
  for (const item of comments) {
    const latest = activity.get(item.threadId);
    if (!latest || item.createdAt > latest) {
      activity.set(item.threadId, item.createdAt);
    }
  }
  const oldestThreadId = roots.reduce((oldest, root) => {
    if (!oldest) return root.threadId;
    const rootActivity = activity.get(root.threadId) ?? root.createdAt;
    const oldestActivity = activity.get(oldest) ?? "";
    return rootActivity < oldestActivity ? root.threadId : oldest;
  }, "");
  return next.filter((item) => item.threadId !== oldestThreadId);
}

function updateSuggestions(
  data: unknown,
  transform: (suggestions: ResourceSuggestion[]) => ResourceSuggestion[],
): unknown {
  if (!isResourceSuggestionsResult(data)) return data;
  return { ...data, suggestions: transform(data.suggestions) };
}

function isResourceSuggestionsResult(
  data: unknown,
): data is { suggestions: ResourceSuggestion[] } {
  return (
    !!data &&
    typeof data === "object" &&
    Array.isArray((data as { suggestions?: unknown }).suggestions)
  );
}

function matchesSuggestionQuery(
  params: unknown,
  suggestion: ResourceSuggestion,
) {
  if (!params || typeof params !== "object") return true;
  const query = params as ListResourceSuggestionsParams;
  return !query.statuses || query.statuses.includes(suggestion.status);
}

function optimisticSuggestion(
  input: CreateResourceSuggestionInput,
  id: string,
): ResourceSuggestion {
  const now = new Date().toISOString();
  return {
    id,
    revision: 1,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    adapterKind: input.adapterKind,
    adapterVersion: 1,
    threadId: `suggestion-thread-${id}`,
    authorEmail: null,
    actorKind: "human",
    baseRevision: input.baseRevision,
    status: "pending",
    summary: input.summary,
    ownerEmail: null,
    orgId: null,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? null,
    operations: input.operations,
  };
}

export function replaceOptimisticSuggestion(
  suggestions: ResourceSuggestion[],
  optimisticId: string,
  result: ResourceSuggestion,
) {
  const hasServerRecord = suggestions.some((item) => item.id === result.id);
  if (hasServerRecord) {
    return suggestions.filter((item) => item.id !== optimisticId);
  }
  return suggestions.map((item) => (item.id === optimisticId ? result : item));
}

export function reconcileSuggestionAmendment(
  suggestions: ResourceSuggestion[],
  saved: ResourceSuggestion,
) {
  return suggestions.map((suggestion) =>
    suggestion.id === saved.id && suggestion.revision <= saved.revision
      ? saved
      : suggestion,
  );
}

function optimisticId(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function ensureClientOperationId(input: {
  clientOperationId?: string;
}): string {
  if (!input.clientOperationId) {
    input.clientOperationId = globalThis.crypto.randomUUID();
  }
  return input.clientOperationId;
}

function noSuggestionOverlay(): ReviewOptimisticMutation {
  return {
    action: "list-resource-suggestions",
    resource: { resourceType: "", resourceId: "" },
    transform: (data) => data,
  };
}

function resourceForSuggestion(queryClient: QueryClient, id: string) {
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: ["action", "list-resource-suggestions"] })) {
    if (!isResourceSuggestionsResult(query.state.data)) continue;
    const suggestion = query.state.data.suggestions.find(
      (candidate) => candidate.id === id,
    );
    if (suggestion) {
      return {
        resourceType: suggestion.resourceType,
        resourceId: suggestion.resourceId,
      };
    }
  }
  return null;
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

export function useReviewFeedback(
  params: GetReviewFeedbackParams,
  options?: { enabled?: boolean },
) {
  return useActionQuery<GetReviewFeedbackResult>(
    "get-review-feedback",
    params,
    {
      enabled:
        options?.enabled ?? Boolean(params.resourceType && params.resourceId),
    },
  );
}

export function useCreateReviewComment() {
  return useOptimisticReviewMutation<ReviewComment, CreateReviewCommentInput>(
    "create-review-comment",
    (input) => {
      const id = `rev_comment_${ensureClientOperationId(input)}`;
      const comment = optimisticComment(input, id, undefined);
      return {
        action: "list-review-comments",
        resource: input,
        transform: (data, params) =>
          matchesCommentQuery(params, comment)
            ? updateComments(data, (comments) =>
                insertOptimisticComment(comments, comment, params),
              )
            : data,
        onSuccess: (result) => (data) =>
          updateComments(data, (comments) =>
            replaceComment(comments, id, result as ReviewComment),
          ),
      };
    },
  );
}

export function useReplyReviewComment() {
  return useOptimisticReviewMutation<ReviewComment, ReplyReviewCommentInput>(
    "reply-review-comment",
    (input) => {
      const id = `rev_comment_${ensureClientOperationId(input)}`;
      return {
        action: "list-review-comments",
        resource: input,
        transform: (data, params) =>
          updateComments(data, (comments) => {
            const parent = comments.find(
              (comment) => comment.id === input.commentId,
            );
            if (!parent) return comments;
            const reply = optimisticComment(input, id, parent);
            return matchesCommentQuery(params, reply)
              ? insertOptimisticComment(comments, reply, params)
              : comments;
          }),
        onSuccess: (result) => (data) =>
          updateComments(data, (comments) =>
            replaceComment(comments, id, result as ReviewComment),
          ),
      };
    },
  );
}

export function useResolveReviewThread() {
  return useOptimisticReviewMutation<
    ResolveReviewThreadResult,
    ResolveReviewThreadInput
  >("resolve-review-thread", (input) => ({
    action: "list-review-comments",
    resource: input,
    transform: (data, params) =>
      updateComments(data, (comments) => {
        const threadId =
          input.threadId ??
          comments.find((comment) => comment.id === input.commentId)?.threadId;
        if (!threadId) return comments;
        const status = input.status ?? "resolved";
        return comments
          .map((comment) => {
            if (comment.threadId !== threadId) return comment;
            const next = {
              ...comment,
              status,
              resolvedBy: status === "resolved" ? null : null,
              resolvedAt:
                status === "resolved" ? new Date().toISOString() : null,
              resolutionNote:
                comment.parentCommentId === null && status === "resolved"
                  ? (input.resolutionNote ?? comment.resolutionNote ?? null)
                  : status === "open"
                    ? null
                    : comment.resolutionNote,
            };
            return next;
          })
          .filter((comment) => matchesCommentQuery(params, comment));
      }),
  }));
}

export function useDeleteReviewComment() {
  return useOptimisticReviewMutation<
    { commentId: string; deleted: true; updatedCount: number },
    DeleteReviewCommentInput
  >("delete-review-comment", (input) => ({
    action: "list-review-comments",
    resource: input,
    transform: (data, params) =>
      updateComments(data, (comments) =>
        comments
          .map((comment) =>
            comment.id === input.commentId
              ? {
                  ...comment,
                  status: "deleted" as const,
                  deletedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
              : comment,
          )
          .filter((comment) => matchesCommentQuery(params, comment)),
      ),
  }));
}

export function useUpdateReviewComment() {
  return useOptimisticReviewMutation<ReviewComment, UpdateReviewCommentInput>(
    "update-review-comment",
    (input) => ({
      action: "list-review-comments",
      resource: input,
      transform: (data) =>
        updateComments(data, (comments) =>
          comments.map((comment) =>
            comment.id === input.commentId
              ? {
                  ...comment,
                  ...(input.body !== undefined ? { body: input.body } : {}),
                  ...(input.anchor !== undefined
                    ? { anchor: input.anchor }
                    : {}),
                  ...(input.mentions !== undefined
                    ? { mentions: input.mentions }
                    : {}),
                }
              : comment,
          ),
        ),
      successReplacesOptimistic: true,
      onSuccess: (result) => (data) =>
        updateComments(data, (comments) =>
          comments.map((comment) => {
            const saved = result as ReviewComment;
            return comment.id === input.commentId &&
              comment.updatedAt <= saved.updatedAt
              ? saved
              : comment;
          }),
        ),
    }),
  );
}

export function useConsumeReviewFeedback() {
  return useActionMutation<
    { consumedCommentIds: string[]; updatedCount: number },
    ConsumeReviewFeedbackInput
  >("consume-review-feedback");
}

export function useSendReviewThreadToAgent() {
  return useActionMutation<
    {
      resourceType: string;
      resourceId: string;
      threadId: string;
      resolutionTarget: "agent";
      consumedAt: null;
      updatedCount: number;
      ownerEmail: string | null;
      orgId: string | null;
      visibility: "private" | "org" | "public";
    },
    SendReviewThreadToAgentInput
  >("send-review-thread-to-agent");
}

export function useSetReviewStatus() {
  return useActionMutation<ReviewStatusEntry, SetReviewStatusInput>(
    "set-review-status",
  );
}

export function useResourceSuggestions(
  params: ListResourceSuggestionsParams,
  options?: { enabled?: boolean },
) {
  return useActionQuery<{ suggestions: ResourceSuggestion[] }>(
    "list-resource-suggestions",
    params,
    {
      enabled:
        options?.enabled ?? Boolean(params.resourceType && params.resourceId),
    },
  );
}

export function useCreateResourceSuggestion() {
  return useOptimisticReviewMutation<
    ResourceSuggestion,
    CreateResourceSuggestionInput
  >("create-resource-suggestion", (input) => {
    const id = optimisticId("optimistic-suggestion");
    const suggestion = optimisticSuggestion(input, id);
    return {
      action: "list-resource-suggestions",
      resource: input,
      transform: (data, params) =>
        matchesSuggestionQuery(params, suggestion)
          ? updateSuggestions(data, (suggestions) => [
              ...suggestions,
              suggestion,
            ])
          : data,
      onSuccess: (result) => (data) =>
        updateSuggestions(data, (suggestions) =>
          replaceOptimisticSuggestion(
            suggestions,
            id,
            result as ResourceSuggestion,
          ),
        ),
    };
  });
}

export function useCreateResourceSuggestionProposal() {
  return useActionMutation<
    ResourceSuggestionProposalResult,
    CreateResourceSuggestionProposalInput
  >("create-resource-suggestion-proposal");
}

export function useDecideResourceSuggestionProposal() {
  return useActionMutation<
    ResourceSuggestionProposalResult,
    DecideResourceSuggestionProposalInput
  >("decide-resource-suggestion-proposal");
}

export function useDecideResourceSuggestion() {
  return useOptimisticReviewMutation<
    { suggestion: ResourceSuggestion; decision: unknown },
    DecideResourceSuggestionInput
  >("decide-resource-suggestion", (input, queryClient) => {
    const resource = resourceForSuggestion(queryClient, input.id);
    if (!resource) return noSuggestionOverlay();
    return {
      action: "list-resource-suggestions",
      resource,
      transform: (data, params) =>
        updateSuggestions(data, (suggestions) => {
          const current = suggestions.find(
            (suggestion) => suggestion.id === input.id,
          );
          if (!current) return suggestions;
          const next = { ...current, status: input.decision };
          return matchesSuggestionQuery(params, next)
            ? suggestions.map((suggestion) =>
                suggestion.id === input.id ? next : suggestion,
              )
            : suggestions.filter((suggestion) => suggestion.id !== input.id);
        }),
      onSuccess: (result) => (data, params) =>
        updateSuggestions(data, (suggestions) => {
          const next = (result as { suggestion: ResourceSuggestion })
            .suggestion;
          return matchesSuggestionQuery(params, next)
            ? suggestions.map((suggestion) =>
                suggestion.id === next.id ? next : suggestion,
              )
            : suggestions.filter((suggestion) => suggestion.id !== next.id);
        }),
    };
  });
}

export function useUpdateResourceSuggestion() {
  return useOptimisticReviewMutation<
    ResourceSuggestion,
    UpdateResourceSuggestionInput
  >("update-resource-suggestion", (input, queryClient) => {
    const resource = resourceForSuggestion(queryClient, input.id);
    if (!resource) return noSuggestionOverlay();
    return {
      action: "list-resource-suggestions",
      resource,
      transform: (data) =>
        updateSuggestions(data, (suggestions) =>
          suggestions.map((suggestion) =>
            suggestion.id === input.id
              ? {
                  ...suggestion,
                  revision: suggestion.revision + 1,
                  operations: input.operations,
                  ...(input.summary !== undefined
                    ? { summary: input.summary }
                    : {}),
                }
              : suggestion,
          ),
        ),
      onSuccess: (result) => (data) =>
        updateSuggestions(data, (suggestions) =>
          reconcileSuggestionAmendment(
            suggestions,
            result as ResourceSuggestion,
          ),
        ),
      successReplacesOptimistic: true,
    };
  });
}
