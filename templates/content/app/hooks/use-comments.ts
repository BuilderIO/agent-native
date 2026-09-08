import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";

export interface CommentMention {
  email: string;
  name: string;
}

export interface CommentMutationState {
  operationId: string;
  kind: "create" | "edit" | "resolve";
  status: "pending" | "error";
  error?: Error;
  ambiguous?: boolean;
}

export interface Comment {
  id: string;
  document_id: string;
  thread_id: string;
  parent_id: string | null;
  content: string;
  quoted_text: string | null;
  anchor_prefix: string | null;
  anchor_suffix: string | null;
  anchor_start_offset: number | null;
  mentions: CommentMention[];
  author_email: string;
  author_name: string | null;
  resolved: number;
  created_at: string;
  updated_at: string;
  notion_comment_id: string | null;
  mutation?: CommentMutationState;
}

export interface CommentThread {
  threadId: string;
  quotedText: string | null;
  /** Robust anchor context, captured from the root comment. */
  prefix: string | null;
  suffix: string | null;
  startOffset: number | null;
  resolved: boolean;
  comments: Comment[];
}

type CommentListResponse = { comments: Comment[] } | Comment[];
type CommentQueryKey = readonly [
  "action",
  "list-comments",
  { documentId: string },
];

interface MutationContext {
  operationId: string;
  queryKey: CommentQueryKey;
}

interface CreateMutationContext extends MutationContext {
  temporaryId: string;
}

interface UpdateMutationContext extends MutationContext {
  before: Map<string, Comment>;
}

export interface CreateCommentVariables {
  documentId: string;
  content: string;
  threadId?: string;
  parentId?: string;
  quotedText?: string;
  anchorPrefix?: string;
  anchorSuffix?: string;
  anchorStartOffset?: number;
  mentions?: string;
}

export interface EditCommentVariables {
  id: string;
  documentId: string;
  content: string;
  mentions?: string;
}

export interface ResolveCommentVariables {
  id: string;
  documentId: string;
  resolved?: boolean;
}

export interface CommentAuthor {
  email?: string | null;
  name?: string | null;
}

type ActiveCommentOperation =
  | {
      operationId: string;
      sequence: number;
      kind: "create";
      status: "pending" | "error";
      error?: Error;
      ambiguous?: boolean;
      comment: Comment;
      existingIds: Set<string>;
    }
  | {
      operationId: string;
      sequence: number;
      kind: "edit";
      status: "pending" | "error";
      error?: Error;
      targetId: string;
      content: string;
      mentions?: CommentMention[];
    }
  | {
      operationId: string;
      sequence: number;
      kind: "resolve";
      status: "pending" | "error";
      error?: Error;
      targetIds: string[];
      resolved: number;
    };

const operationsByClient = new WeakMap<
  object,
  Map<string, Map<string, ActiveCommentOperation>>
>();
let nextOperationSequence = 1;

function documentOperations(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
): Map<string, ActiveCommentOperation> {
  let byDocument = operationsByClient.get(queryClient);
  if (!byDocument) {
    byDocument = new Map();
    operationsByClient.set(queryClient, byDocument);
  }
  let operations = byDocument.get(documentId);
  if (!operations) {
    operations = new Map();
    byDocument.set(documentId, operations);
  }
  return operations;
}

function mutationState(
  operation: ActiveCommentOperation,
): CommentMutationState {
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    status: operation.status,
    error: operation.error,
    ambiguous: operation.kind === "create" ? operation.ambiguous : undefined,
  };
}

function operationTargetIds(operation: ActiveCommentOperation): string[] {
  if (operation.kind === "create") return [operation.comment.id];
  return operation.kind === "edit" ? [operation.targetId] : operation.targetIds;
}

function pruneSupersededOperations(
  operations: Map<string, ActiveCommentOperation>,
  settled: ActiveCommentOperation,
) {
  if (settled.kind === "create") return;
  const settledTargets = new Set(operationTargetIds(settled));
  for (const [operationId, candidate] of operations) {
    if (
      candidate.operationId === settled.operationId ||
      candidate.kind !== settled.kind ||
      candidate.sequence >= settled.sequence
    ) {
      continue;
    }
    if (
      operationTargetIds(candidate).some((targetId) =>
        settledTargets.has(targetId),
      )
    ) {
      operations.delete(operationId);
    }
  }
}

function matchesCreatedComment(
  comment: Comment,
  operation: Extract<ActiveCommentOperation, { kind: "create" }>,
): boolean {
  const optimistic = operation.comment;
  return (
    comment.id !== optimistic.id &&
    !operation.existingIds.has(comment.id) &&
    comment.document_id === optimistic.document_id &&
    comment.thread_id ===
      (optimistic.parent_id ? optimistic.thread_id : comment.id) &&
    comment.parent_id === optimistic.parent_id &&
    comment.author_email === optimistic.author_email &&
    comment.content === optimistic.content &&
    comment.quoted_text === optimistic.quoted_text &&
    comment.anchor_prefix === optimistic.anchor_prefix &&
    comment.anchor_suffix === optimistic.anchor_suffix &&
    comment.anchor_start_offset === optimistic.anchor_start_offset &&
    JSON.stringify(comment.mentions) === JSON.stringify(optimistic.mentions)
  );
}

function applyOperationOverlays(
  response: CommentListResponse | undefined,
  operations: Iterable<ActiveCommentOperation>,
): CommentListResponse {
  let comments = commentsFrom(response);
  for (const operation of operations) {
    if (operation.kind === "create") {
      const authoritativeMatches = comments.filter((comment) =>
        matchesCreatedComment(comment, operation),
      );
      if (authoritativeMatches.length === 1) {
        const authoritativeId = authoritativeMatches[0].id;
        comments = comments
          .filter(({ id }) => id !== operation.comment.id)
          .map((comment) =>
            comment.id === authoritativeId
              ? { ...comment, mutation: mutationState(operation) }
              : comment,
          );
        continue;
      }
      const withoutStaleCopy = comments.filter(
        ({ id }) => id !== operation.comment.id,
      );
      comments = [
        ...withoutStaleCopy,
        {
          ...operation.comment,
          mutation: mutationState(operation),
        },
      ];
      continue;
    }
    comments = comments.map((comment) => {
      const targeted =
        operation.kind === "edit"
          ? comment.id === operation.targetId
          : operation.targetIds.includes(comment.id);
      if (!targeted) return comment;
      if (operation.status === "error") {
        return { ...comment, mutation: mutationState(operation) };
      }
      return operation.kind === "edit"
        ? {
            ...comment,
            content: operation.content,
            mentions: operation.mentions ?? comment.mentions,
            mutation: mutationState(operation),
          }
        : {
            ...comment,
            resolved: operation.resolved,
            mutation: mutationState(operation),
          };
    });
  }
  return withComments(response, comments);
}

function commentQueryKey(documentId: string): CommentQueryKey {
  return ["action", "list-comments", { documentId }];
}

function mutationId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function commentsFrom(response: CommentListResponse | undefined): Comment[] {
  if (Array.isArray(response)) return response;
  return response?.comments ?? [];
}

function withComments(
  response: CommentListResponse | undefined,
  comments: Comment[],
): CommentListResponse {
  return Array.isArray(response) ? comments : { ...(response ?? {}), comments };
}

function updateComments(
  response: CommentListResponse | undefined,
  update: (comments: Comment[]) => Comment[],
): CommentListResponse {
  return withComments(response, update(commentsFrom(response)));
}

function parsedMentions(value: string): CommentMention[] {
  if (!value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error("Comment mentions metadata must be an array");
    }
    return parsed.map((entry) => {
      if (!entry || typeof entry !== "object") {
        throw new Error("Comment mentions metadata contains an invalid entry");
      }
      const email = (entry as Record<string, unknown>).email;
      const name = (entry as Record<string, unknown>).name;
      if (typeof email !== "string" || !email) {
        throw new Error("Comment mention email is required");
      }
      return { email, name: typeof name === "string" ? name : "" };
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Comment mention")) {
      throw error;
    }
    throw new Error("Comment mentions metadata is not valid JSON");
  }
}

function authorName(author: CommentAuthor): string | null {
  const explicit = author.name?.trim();
  if (explicit) return explicit;
  const localPart = author.email?.split("@")[0]?.trim();
  if (!localPart) return null;
  const words = localPart.split(/[._-]+/).filter(Boolean);
  return words.length
    ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ")
    : null;
}

function isAmbiguousCreateError(error: Error): boolean {
  const status = (error as Error & { status?: unknown }).status;
  const timedOut = (error as Error & { timedOut?: unknown }).timedOut;
  return (
    timedOut === true ||
    typeof status !== "number" ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function invalidateDocumentComments(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: CommentQueryKey,
) {
  return queryClient.invalidateQueries({
    queryKey,
    exact: true,
    refetchType: "active",
  });
}

function groupCommentThreads(data: unknown): CommentThread[] {
  const raw =
    data && typeof data === "object" && "comments" in data
      ? (data as { comments?: unknown }).comments
      : data;
  const comments: Comment[] = Array.isArray(raw) ? raw : [];
  const threadMap = new Map<string, CommentThread>();
  for (const comment of comments) {
    if (!threadMap.has(comment.thread_id)) {
      threadMap.set(comment.thread_id, {
        threadId: comment.thread_id,
        quotedText: comment.quoted_text,
        prefix: comment.anchor_prefix ?? null,
        suffix: comment.anchor_suffix ?? null,
        startOffset:
          typeof comment.anchor_start_offset === "number"
            ? comment.anchor_start_offset
            : null,
        resolved: !!comment.resolved,
        comments: [],
      });
    }
    const thread = threadMap.get(comment.thread_id)!;
    thread.comments.push(comment);
    thread.resolved = thread.resolved || !!comment.resolved;
  }
  return Array.from(threadMap.values());
}

export function useComments(documentId: string | null) {
  const queryClient = useQueryClient();
  return useActionQuery<CommentThread[]>(
    "list-comments",
    documentId ? { documentId } : undefined,
    {
      enabled: !!documentId,
      structuralSharing: false,
      select: (data) =>
        groupCommentThreads(
          documentId
            ? applyOperationOverlays(
                data as unknown as CommentListResponse,
                documentOperations(queryClient, documentId).values(),
              )
            : data,
        ),
    },
  );
}

export function useCreateComment(author: CommentAuthor = {}) {
  const queryClient = useQueryClient();
  const mutation = useActionMutation<
    { id: string; threadId: string },
    CreateCommentVariables
  >("add-comment", {
    skipActionQueryInvalidation: true,
    onMutate: async (variables) => {
      const queryKey = commentQueryKey(variables.documentId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      const operationId = mutationId();
      const temporaryId = `optimistic-${operationId}`;
      const current = queryClient.getQueryData<CommentListResponse>(queryKey);
      const now = new Date().toISOString();
      const optimistic: Comment = {
        id: temporaryId,
        document_id: variables.documentId,
        thread_id: variables.threadId ?? temporaryId,
        parent_id: variables.parentId ?? null,
        content: variables.content,
        quoted_text: variables.quotedText ?? null,
        anchor_prefix: variables.anchorPrefix ?? null,
        anchor_suffix: variables.anchorSuffix ?? null,
        anchor_start_offset: variables.anchorStartOffset ?? null,
        mentions:
          variables.mentions === undefined
            ? []
            : parsedMentions(variables.mentions),
        author_email: author.email?.trim() ?? "",
        author_name: authorName(author),
        resolved: 0,
        created_at: now,
        updated_at: now,
        notion_comment_id: null,
        mutation: { operationId, kind: "create", status: "pending" },
      };
      documentOperations(queryClient, variables.documentId).set(operationId, {
        operationId,
        sequence: nextOperationSequence++,
        kind: "create",
        status: "pending",
        comment: optimistic,
        existingIds: new Set(commentsFrom(current).map(({ id }) => id)),
      });
      queryClient.setQueryData<CommentListResponse>(queryKey, (response) =>
        updateComments(response, (comments) => [...comments, optimistic]),
      );
      return {
        operationId,
        queryKey,
        temporaryId,
      } satisfies CreateMutationContext;
    },
    onSuccess: (result, _variables, rawContext) => {
      const context = rawContext as CreateMutationContext | undefined;
      if (!context) return;
      const operations = documentOperations(
        queryClient,
        context.queryKey[2].documentId,
      );
      const operation = operations.get(context.operationId);
      operations.delete(context.operationId);
      queryClient.setQueryData<CommentListResponse>(
        context.queryKey,
        (response) =>
          updateComments(response, (comments) => {
            const withoutTemporary = comments.filter(
              ({ id }) => id !== context.temporaryId,
            );
            if (withoutTemporary.some(({ id }) => id === result.id)) {
              return withoutTemporary;
            }
            const optimistic =
              operation?.kind === "create" ? operation.comment : undefined;
            return optimistic
              ? [
                  ...withoutTemporary,
                  {
                    ...optimistic,
                    id: result.id,
                    thread_id: result.threadId,
                    mutation: undefined,
                  },
                ]
              : withoutTemporary;
          }),
      );
      void invalidateDocumentComments(queryClient, context.queryKey);
    },
    onError: (error, _variables, rawContext) => {
      const context = rawContext as CreateMutationContext | undefined;
      if (!context) return;
      const ambiguous = isAmbiguousCreateError(error);
      const operations = documentOperations(
        queryClient,
        context.queryKey[2].documentId,
      );
      const operation = operations.get(context.operationId);
      if (ambiguous && operation?.kind === "create") {
        operations.set(context.operationId, {
          ...operation,
          status: "error",
          error,
          ambiguous: true,
        });
      } else {
        operations.delete(context.operationId);
      }
      queryClient.setQueryData<CommentListResponse>(
        context.queryKey,
        (response) =>
          updateComments(response, (comments) =>
            ambiguous
              ? comments.map((comment) =>
                  comment.id === context.temporaryId &&
                  comment.mutation?.operationId === context.operationId
                    ? {
                        ...comment,
                        mutation: {
                          ...comment.mutation,
                          status: "error",
                          error,
                          ambiguous: true,
                        },
                      }
                    : comment,
                )
              : comments.filter(
                  (comment) =>
                    comment.id !== context.temporaryId ||
                    comment.mutation?.operationId !== context.operationId,
                ),
          ),
      );
      void invalidateDocumentComments(queryClient, context.queryKey);
    },
  });

  const reconcileAmbiguous = async (
    documentId: string,
    operationId: string,
  ): Promise<"confirmed" | "unresolved"> => {
    const queryKey = commentQueryKey(documentId);
    const operations = documentOperations(queryClient, documentId);
    const operation = operations.get(operationId);
    if (
      operation?.kind !== "create" ||
      operation.status !== "error" ||
      !operation.ambiguous
    ) {
      return "confirmed";
    }
    const optimistic = operation.comment;
    await queryClient.refetchQueries({ queryKey, exact: true, type: "all" });
    const authoritative =
      queryClient.getQueryData<CommentListResponse>(queryKey);
    const matches = commentsFrom(authoritative).filter((comment) =>
      matchesCreatedComment(comment, operation),
    );
    if (matches.length === 1) {
      operations.delete(operationId);
      queryClient.setQueryData<CommentListResponse>(queryKey, (response) =>
        updateComments(response, (comments) =>
          comments.filter(({ id }) => id !== optimistic.id),
        ),
      );
      return "confirmed";
    }
    queryClient.setQueryData<CommentListResponse>(queryKey, (response) =>
      updateComments(response, (comments) => [
        ...comments.filter(
          (comment) => comment.mutation?.operationId !== operationId,
        ),
        { ...optimistic, mutation: mutationState(operation) },
      ]),
    );
    return "unresolved";
  };

  return Object.assign(mutation, { reconcileAmbiguous });
}

function useOptimisticCommentUpdate<
  TVariables extends EditCommentVariables | ResolveCommentVariables,
>(
  kind: "edit" | "resolve",
  update: (comment: Comment, variables: TVariables) => Comment,
) {
  const queryClient = useQueryClient();
  return useActionMutation<{ ok: boolean; resolved?: boolean }, TVariables>(
    "update-comment",
    {
      skipActionQueryInvalidation: true,
      onMutate: async (variables) => {
        const queryKey = commentQueryKey(variables.documentId);
        await queryClient.cancelQueries({ queryKey, exact: true });
        const operationId = mutationId();
        const current = queryClient.getQueryData<CommentListResponse>(queryKey);
        const target = commentsFrom(current).find(
          ({ id }) => id === variables.id,
        );
        const affectedIds =
          kind === "resolve" && target
            ? commentsFrom(current)
                .filter(({ thread_id }) => thread_id === target.thread_id)
                .map(({ id }) => id)
            : [variables.id];
        const before = new Map(
          commentsFrom(current)
            .filter(({ id }) => affectedIds.includes(id))
            .map((comment) => [comment.id, comment]),
        );
        const operations = documentOperations(
          queryClient,
          variables.documentId,
        );
        for (const [id, operation] of operations) {
          if (operation.status !== "error" || operation.kind === "create") {
            continue;
          }
          const overlaps =
            operation.kind === "edit"
              ? affectedIds.includes(operation.targetId)
              : operation.targetIds.some((targetId) =>
                  affectedIds.includes(targetId),
                );
          if (overlaps) operations.delete(id);
        }
        if (kind === "edit") {
          const editVariables = variables as EditCommentVariables;
          operations.set(operationId, {
            operationId,
            sequence: nextOperationSequence++,
            kind,
            status: "pending",
            targetId: editVariables.id,
            content: editVariables.content,
            mentions:
              editVariables.mentions === undefined
                ? undefined
                : parsedMentions(editVariables.mentions),
          });
        } else {
          const resolveVariables = variables as ResolveCommentVariables;
          operations.set(operationId, {
            operationId,
            sequence: nextOperationSequence++,
            kind,
            status: "pending",
            targetIds: affectedIds,
            resolved: Number(resolveVariables.resolved),
          });
        }
        queryClient.setQueryData<CommentListResponse>(queryKey, (response) =>
          updateComments(response, (comments) =>
            comments.map((comment) =>
              affectedIds.includes(comment.id)
                ? {
                    ...update(comment, variables as TVariables),
                    mutation: { operationId, kind, status: "pending" },
                  }
                : comment,
            ),
          ),
        );
        return {
          operationId,
          queryKey,
          before,
        } satisfies UpdateMutationContext;
      },
      onSuccess: (_result, _variables, rawContext) => {
        const context = rawContext as UpdateMutationContext | undefined;
        if (!context) return;
        const operations = documentOperations(
          queryClient,
          context.queryKey[2].documentId,
        );
        const operation = operations.get(context.operationId);
        if (operation) pruneSupersededOperations(operations, operation);
        operations.delete(context.operationId);
        queryClient.setQueryData<CommentListResponse>(
          context.queryKey,
          (response) =>
            updateComments(response, (comments) =>
              comments.map((comment) => {
                if (!operation || operation.kind === "create") return comment;
                const targeted =
                  operation.kind === "edit"
                    ? comment.id === operation.targetId
                    : operation.targetIds.includes(comment.id);
                if (!targeted) return comment;
                const updated =
                  operation.kind === "edit"
                    ? {
                        ...comment,
                        content: operation.content,
                        mentions: operation.mentions ?? comment.mentions,
                      }
                    : { ...comment, resolved: operation.resolved };
                return comment.mutation?.operationId === context.operationId
                  ? { ...updated, mutation: undefined }
                  : updated;
              }),
            ),
        );
        void invalidateDocumentComments(queryClient, context.queryKey);
      },
      onError: (error, _variables, rawContext) => {
        const context = rawContext as UpdateMutationContext | undefined;
        if (!context) return;
        const operations = documentOperations(
          queryClient,
          context.queryKey[2].documentId,
        );
        const operation = operations.get(context.operationId);
        if (operation) {
          pruneSupersededOperations(operations, operation);
          operations.set(context.operationId, {
            ...operation,
            status: "error",
            error,
          });
        }
        queryClient.setQueryData<CommentListResponse>(
          context.queryKey,
          (response) =>
            updateComments(response, (comments) =>
              comments.map((comment) => {
                if (comment.mutation?.operationId !== context.operationId) {
                  return comment;
                }
                const prior = context.before.get(comment.id);
                return prior
                  ? {
                      ...prior,
                      mutation: {
                        operationId: context.operationId,
                        kind,
                        status: "error",
                        error,
                      },
                    }
                  : comment;
              }),
            ),
        );
        void invalidateDocumentComments(queryClient, context.queryKey);
      },
    },
  );
}

export function useEditComment() {
  return useOptimisticCommentUpdate<EditCommentVariables>(
    "edit",
    (comment, variables) => ({
      ...comment,
      content: variables.content,
      mentions:
        variables.mentions === undefined
          ? comment.mentions
          : parsedMentions(variables.mentions),
      updated_at: new Date().toISOString(),
    }),
  );
}

export function useResolveComment() {
  return useOptimisticCommentUpdate<ResolveCommentVariables>(
    "resolve",
    (comment, variables) => ({
      ...comment,
      resolved:
        variables.resolved !== undefined
          ? Number(variables.resolved)
          : comment.resolved,
      updated_at: new Date().toISOString(),
    }),
  );
}

export function useDeleteComment() {
  return useActionMutation<{ ok: boolean }, { id: string; documentId: string }>(
    "delete-comment",
  );
}
