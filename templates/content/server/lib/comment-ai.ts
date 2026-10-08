import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestRunContext,
  getRequestUserEmail,
  getThread,
} from "@agent-native/core/server";
import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { documentRevisionToken } from "../../actions/_document-edit-mutation.js";
import { commentIdForIdempotency } from "../../actions/add-comment.js";
import type {
  CommentAiErrorCode,
  CommentAiIntent,
  CommentAiPendingSession,
  CommentAiRequest,
  CommentAiSessionStatus,
  CommentAiStatus,
  CommentAiSubmittedMode,
  StartCommentAiResult,
} from "../../shared/comment-ai.js";
import { getDb, schema } from "../db/index.js";

const ACTIVE_STATUSES = [
  "classifying",
  "classified",
  "queued",
  "running",
  "refreshing",
] as const;
const TERMINAL_SUCCESS = ["replied", "suggested", "resolved"] as const;
const MAX_ATTEMPTS = 2;

export const commentAiIntentSchema = z.enum([
  "suggest",
  "reply",
  "apply-resolve",
]);
export const commentAiSubmittedModeSchema = z.union([
  z.literal("auto"),
  commentAiIntentSchema,
]);
export const commentAiScopeSchema = z
  .object({
    type: z.literal("content-comment-ai"),
    id: z.string().uuid(),
  })
  .strict();
export const commentAiActionScopeSchema = z
  .object({
    kind: z.literal("content-comment-ai"),
    requestId: z.string().uuid(),
  })
  .strict();
export const commentAiClassifierScopeSchema = z
  .object({
    type: z.literal("content-comment-ai-classifier"),
    id: z.string().uuid(),
  })
  .strict();
export const commentAiClassifierActionScopeSchema = z
  .object({
    kind: z.literal("content-comment-ai-classifier"),
    requestId: z.string().uuid(),
  })
  .strict();
const statusSchema = z.enum([
  "classifying",
  "classified",
  "queued",
  "running",
  "refreshing",
  "replied",
  "suggested",
  "resolved",
  "needs-review",
  "failed",
  "cancelled",
]);
const errorCodeSchema = z
  .enum([
    "page_changed",
    "attempt_superseded",
    "root_comment_changed",
    "discussion_changed",
    "target_deleted",
    "target_ambiguous",
    "permission_changed",
    "refresh_exhausted",
    "operation_failed",
    "run_unavailable",
  ])
  .nullable();
const resultSchema = z.object({
  commentId: z.string().optional(),
  suggestionId: z.string().optional(),
  editApplied: z.boolean().optional(),
  resolved: z.boolean().optional(),
  changes: z
    .array(
      z.object({
        before: z.string(),
        after: z.string(),
        truncated: z.boolean().optional(),
      }),
    )
    .optional(),
  undoable: z.boolean().optional(),
  undone: z.boolean().optional(),
});
type RequestRow = typeof schema.commentAiRequests.$inferSelect;
export type CommentAiAttemptRow = typeof schema.commentAiAttempts.$inferSelect;
type CommentRow = typeof schema.documentComments.$inferSelect;
type CommentSource = Awaited<ReturnType<typeof readCommentAiSource>>;
type CommentAiActionSurfaceDetails = {
  ownerEmail: string | null;
  threadId?: string;
  requestedTurnId?: string;
  queuedMessageId?: string;
  actionScope?: Readonly<Record<string, unknown>>;
};

export class CommentAiOperationError extends Error {
  constructor(
    readonly code: Exclude<CommentAiErrorCode, null>,
    message: string,
    readonly recoverable: boolean,
  ) {
    super(message);
    this.name = "CommentAiOperationError";
  }
}

function operationError(
  code: Exclude<CommentAiErrorCode, null>,
  message: string,
  recoverable = false,
): CommentAiOperationError {
  return new CommentAiOperationError(code, message, recoverable);
}

function terminalSuccess(status: string) {
  return TERMINAL_SUCCESS.includes(status as (typeof TERMINAL_SUCCESS)[number]);
}

function snapshotComments(comments: CommentRow[]) {
  return comments.map((comment) => ({
    id: comment.id,
    parentId: comment.parentId,
    content: comment.content,
    resolved: comment.resolved,
    quotedText: comment.quotedText,
    anchorPrefix: comment.anchorPrefix,
    anchorSuffix: comment.anchorSuffix,
    anchorStartOffset: comment.anchorStartOffset,
    actorKind: comment.submissionSource === "agent" ? "agent" : null,
    author: comment.authorName,
  }));
}

export function commentThreadDigest(
  comments: Pick<
    CommentRow,
    | "id"
    | "parentId"
    | "content"
    | "resolved"
    | "quotedText"
    | "anchorPrefix"
    | "anchorSuffix"
    | "anchorStartOffset"
  >[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        comments
          .map((comment) => ({
            id: comment.id,
            parentId: comment.parentId,
            content: comment.content,
            resolved: comment.resolved,
            quotedText: comment.quotedText,
            anchorPrefix: comment.anchorPrefix,
            anchorSuffix: comment.anchorSuffix,
            anchorStartOffset: comment.anchorStartOffset,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    )
    .digest("hex");
}

function receiptCommentIds(request: RequestRow) {
  return new Set(
    ["reply", "receipt"].map((kind) =>
      commentIdForIdempotency(
        request.requesterEmail,
        request.documentId,
        `comment-ai:${request.id}:${kind}`,
      ),
    ),
  );
}

function relevantComments(request: RequestRow, comments: CommentRow[]) {
  const receipts = receiptCommentIds(request);
  return comments.filter((comment) => !receipts.has(comment.id));
}

function currentThreadDigest(request: RequestRow, comments: CommentRow[]) {
  return commentThreadDigest(relevantComments(request, comments));
}

export function serializeCommentAiRequest(
  row: Pick<
    RequestRow,
    | "id"
    | "documentId"
    | "threadId"
    | "rootCommentId"
    | "submittedMode"
    | "instructions"
    | "intent"
    | "status"
    | "activeAttemptId"
    | "attemptCount"
    | "runId"
    | "submittedProvider"
    | "submittedModel"
    | "submittedEngine"
    | "classificationThreadId"
    | "classificationTurnId"
    | "continuationOfRequestId"
    | "agentThreadId"
    | "agentTurnId"
    | "model"
    | "engine"
    | "resultJson"
    | "errorCode"
    | "error"
    | "createdAt"
    | "updatedAt"
  >,
): CommentAiRequest {
  return {
    operationId: row.id,
    requestId: row.id,
    documentId: row.documentId,
    threadId: row.threadId,
    rootCommentId: row.rootCommentId,
    submittedMode: commentAiSubmittedModeSchema.parse(row.submittedMode),
    instructions: row.instructions,
    submittedProvider: row.submittedProvider,
    submittedModel: row.submittedModel,
    submittedEngine: row.submittedEngine,
    continuationOfRequestId: row.continuationOfRequestId,
    intent:
      row.intent === "unresolved"
        ? null
        : commentAiIntentSchema.parse(row.intent),
    status: statusSchema.parse(row.status),
    attemptId: row.activeAttemptId,
    attemptCount: row.attemptCount,
    runId: row.runId,
    agentThreadId: row.agentThreadId,
    agentTurnId: row.agentTurnId,
    model: row.model,
    engine: row.engine,
    result:
      row.resultJson === null
        ? null
        : resultSchema.parse(JSON.parse(row.resultJson)),
    errorCode: errorCodeSchema.parse(row.errorCode),
    error: row.error,
    pendingSession: pendingSession(row as RequestRow),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function loadCommentAiRequest(
  id: string,
  email = getRequestUserEmail(),
) {
  if (!email) throw new Error("Sign in to use Ask AI");
  const [request] = await getDb()
    .select()
    .from(schema.commentAiRequests)
    .where(
      and(
        eq(schema.commentAiRequests.id, id),
        eq(schema.commentAiRequests.requesterEmail, email),
      ),
    )
    .limit(1);
  if (!request) throw new Error("Comment AI request not found");
  await assertAccess(
    "document",
    request.documentId,
    request.intent === "apply-resolve" ? "editor" : "commenter",
  );
  return request;
}

export async function readCommentAiSource(
  request: Pick<
    RequestRow,
    "documentId" | "threadId" | "rootCommentId" | "intent"
  >,
) {
  const access = await assertAccess(
    "document",
    request.documentId,
    request.intent === "apply-resolve" ? "editor" : "commenter",
  );
  const [document] = await getDb()
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, request.documentId),
        eq(schema.documents.ownerEmail, access.resource.ownerEmail as string),
      ),
    )
    .limit(1);
  if (!document || document.trashedAt || document.sourceMode) {
    throw operationError(
      "permission_changed",
      "This Page is unavailable for Ask AI",
    );
  }
  const comments = await getDb()
    .select()
    .from(schema.documentComments)
    .where(
      and(
        eq(schema.documentComments.documentId, request.documentId),
        eq(schema.documentComments.threadId, request.threadId),
        eq(schema.documentComments.ownerEmail, document.ownerEmail),
      ),
    )
    .orderBy(
      asc(schema.documentComments.createdAt),
      asc(schema.documentComments.id),
    );
  const root = comments.find(
    (comment) =>
      comment.id === request.rootCommentId && comment.parentId === null,
  );
  if (!root) {
    throw operationError(
      "root_comment_changed",
      "The selected comment no longer belongs to this Page and thread",
    );
  }
  return { document, comments, root };
}

function assertSubmittedCommentContext(
  request: RequestRow,
  source: CommentSource,
) {
  const submitted = z
    .array(
      z.object({
        id: z.string(),
        parentId: z.string().nullable(),
        content: z.string(),
        resolved: z.number(),
        quotedText: z.string().nullable(),
        anchorPrefix: z.string().nullable(),
        anchorSuffix: z.string().nullable(),
        anchorStartOffset: z.number().nullable(),
      }),
    )
    .parse(JSON.parse(request.submittedSnapshotJson ?? request.snapshotJson));
  const submittedRoot = submitted.find(
    (comment) =>
      comment.id === request.rootCommentId && comment.parentId === null,
  );
  const rootFields = [
    "content",
    "resolved",
    "quotedText",
    "anchorPrefix",
    "anchorSuffix",
    "anchorStartOffset",
  ] as const;
  if (
    !submittedRoot ||
    rootFields.some((field) => submittedRoot[field] !== source.root[field])
  ) {
    throw operationError(
      "root_comment_changed",
      "The original comment changed after Ask AI was submitted",
    );
  }
  if (
    currentThreadDigest(request, source.comments) !==
    (request.submittedThreadDigest ?? request.threadDigest)
  ) {
    throw operationError(
      "discussion_changed",
      "The comment discussion changed after Ask AI was submitted",
    );
  }
}

export async function assertCommentAiSourceUnchanged(request: RequestRow) {
  const source = await readCommentAiSource(request);
  try {
    assertSubmittedCommentContext(request, source);
  } catch {
    throw new Error(
      "The comment changed during this request. Its thread remains open for review.",
    );
  }
  return source;
}

function backgroundSession(request: RequestRow) {
  if (!request.agentThreadId || !request.agentTurnId) {
    throw new Error(
      "Comment AI operation is missing its agent session binding",
    );
  }
  return {
    operationId: request.id,
    threadId: request.agentThreadId,
    turnId: request.agentTurnId,
    scope: { type: "content-comment-ai" as const, id: request.id },
    actionScope: {
      kind: "content-comment-ai" as const,
      requestId: request.id,
    },
    ...(request.submittedModel ? { model: request.submittedModel } : {}),
    ...(request.submittedEngine ? { engine: request.submittedEngine } : {}),
  };
}

function classificationBackgroundSession(request: RequestRow) {
  if (!request.classificationThreadId || !request.classificationTurnId) {
    throw new Error(
      "Comment AI operation is missing its classifier session binding",
    );
  }
  return {
    operationId: `${request.id}:classification`,
    threadId: request.classificationThreadId,
    turnId: request.classificationTurnId,
    scope: {
      type: "content-comment-ai-classifier" as const,
      id: request.id,
    },
    actionScope: {
      kind: "content-comment-ai-classifier" as const,
      requestId: request.id,
    },
    ...(request.submittedModel ? { model: request.submittedModel } : {}),
    ...(request.submittedEngine ? { engine: request.submittedEngine } : {}),
  };
}

function executionPrompt(request: RequestRow) {
  const intent = {
    suggest: "Suggest changes",
    reply: "Reply in thread",
    "apply-resolve": "Apply changes and resolve",
  }[commentAiIntentSchema.parse(request.intent)];
  return `${intent}: ${request.instructions}`;
}

function executionContext(request: RequestRow) {
  const continuation = request.continuationOfRequestId
    ? ` This operation continues the prior request ${request.continuationOfRequestId} on the same comment; use only the current scoped comment context as authority.`
    : "";
  return `Original comment: /page/${encodeURIComponent(request.documentId)}?comment=${encodeURIComponent(request.threadId)}.${continuation} Read the scoped context before acting and follow any refresh instruction before publishing.`;
}

function pendingSession(request: RequestRow): CommentAiPendingSession | null {
  if (request.status === "classifying") {
    return {
      phase: "classification",
      backgroundSession: classificationBackgroundSession(request),
      prompt: request.instructions,
      context:
        "Classify this request by calling submit-comment-ai-classification exactly once. Choose reply for conversation or explanation, suggest for uncertain or reviewable action, and apply-resolve only for a clear instruction to change the Page and resolve the comment. No other actions are authorized.",
    };
  }
  if (request.status === "classified" || request.status === "queued") {
    return {
      phase: "execution",
      backgroundSession: backgroundSession(request),
      prompt: executionPrompt(request),
      context: executionContext(request),
    };
  }
  return null;
}

type StartCommentAiRequestArgs = {
  requestId: string;
  agentThreadId?: string;
  documentId: string;
  threadId: string;
  rootCommentId: string;
  continuationOfRequestId?: string;
  submittedMode?: CommentAiSubmittedMode;
  instructions?: string;
  provider?: string;
  model?: string;
  engine?: string;
  /** Compatibility for callers that predate the submitted-mode contract. */
  intent?: CommentAiIntent;
};

function normalizeStartArgs(args: StartCommentAiRequestArgs) {
  const submittedMode = commentAiSubmittedModeSchema.parse(
    args.submittedMode ?? args.intent,
  );
  if (args.submittedMode && args.intent) {
    throw new Error("Pass submittedMode, not both submittedMode and intent");
  }
  const instructions =
    args.instructions?.trim() ||
    (submittedMode === "auto"
      ? ""
      : {
          suggest: "Suggest changes for this comment.",
          reply: "Reply in this comment thread.",
          "apply-resolve":
            "Apply the requested changes and resolve this comment.",
        }[submittedMode]);
  if (!instructions) throw new Error("Comment AI instructions are required");
  return {
    submittedMode,
    instructions,
    provider: args.provider?.trim() || null,
    model: args.model?.trim() || null,
    engine: args.engine?.trim() || null,
    continuationOfRequestId: args.continuationOfRequestId ?? null,
  };
}

export async function startCommentAiRequest(
  args: StartCommentAiRequestArgs,
): Promise<StartCommentAiResult> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("Sign in to use Ask AI");
  const submission = normalizeStartArgs(args);
  const db = getDb();
  const [sameId] = await db
    .select()
    .from(schema.commentAiRequests)
    .where(eq(schema.commentAiRequests.id, args.requestId))
    .limit(1);
  let request: RequestRow;
  let dispatch = false;
  let outcome: StartCommentAiResult["outcome"] = "confirmed-start";

  if (sameId) {
    if (sameId.requesterEmail !== email) {
      throw new Error("Comment AI operation not found");
    }
    request = await loadCommentAiRequest(sameId.id);
    if (
      request.documentId !== args.documentId ||
      request.threadId !== args.threadId ||
      request.rootCommentId !== args.rootCommentId ||
      request.submittedMode !== submission.submittedMode ||
      request.instructions !== submission.instructions ||
      request.submittedProvider !== submission.provider ||
      request.submittedModel !== submission.model ||
      request.submittedEngine !== submission.engine ||
      request.continuationOfRequestId !== submission.continuationOfRequestId ||
      (args.agentThreadId &&
        request.agentThreadId !== args.agentThreadId.trim())
    ) {
      fail("This operation ID is already bound to another comment or intent", {
        statusCode: 409,
        errorCode: "comment_ai_operation_conflict",
      });
    }
  } else {
    const resolvedIntent =
      submission.submittedMode === "auto"
        ? null
        : commentAiIntentSchema.parse(submission.submittedMode);
    const continuation = submission.continuationOfRequestId
      ? await loadCommentAiRequest(submission.continuationOfRequestId)
      : null;
    if (
      continuation &&
      (continuation.id === args.requestId ||
        continuation.documentId !== args.documentId ||
        continuation.threadId !== args.threadId ||
        continuation.rootCommentId !== args.rootCommentId ||
        !continuation.agentThreadId)
    ) {
      fail("The prior Comment AI request cannot continue this comment", {
        statusCode: 409,
        errorCode: "comment_ai_operation_conflict",
      });
    }
    if (
      continuation &&
      resolvedIntent === "reply" &&
      args.agentThreadId?.trim() &&
      args.agentThreadId.trim() !== continuation.agentThreadId
    ) {
      fail("The continuation thread does not match the prior request", {
        statusCode: 409,
        errorCode: "comment_ai_thread_conflict",
      });
    }
    const source = await readCommentAiSource({
      ...args,
      intent: resolvedIntent ?? "reply",
    });
    if (source.root.resolved)
      throw new Error("Reopen the comment before asking AI");
    if (
      source.comments.length > 100 ||
      source.comments.reduce(
        (size, comment) => size + comment.content.length,
        0,
      ) > 24000
    ) {
      throw new Error(
        "This conversation is too large for one comment AI operation",
      );
    }
    const agentThreadId =
      (resolvedIntent === "reply" ? continuation?.agentThreadId : null) ||
      args.agentThreadId?.trim() ||
      `comment-ai-${crypto.randomUUID()}`;
    const classificationThreadId =
      submission.submittedMode === "auto"
        ? `comment-ai-classifier-${crypto.randomUUID()}`
        : null;
    const snapshot = snapshotComments(source.comments);
    const inserted = await db
      .insert(schema.commentAiRequests)
      .values({
        id: args.requestId,
        ownerEmail: source.document.ownerEmail,
        requesterEmail: email,
        documentId: args.documentId,
        threadId: args.threadId,
        rootCommentId: args.rootCommentId,
        fieldId: "body",
        intent: resolvedIntent ?? "unresolved",
        submittedMode: submission.submittedMode,
        instructions: submission.instructions,
        submittedProvider: submission.provider,
        submittedModel: submission.model,
        submittedEngine: submission.engine,
        status: resolvedIntent ? "queued" : "classifying",
        submittedThreadDigest: commentThreadDigest(source.comments),
        submittedSnapshotJson: JSON.stringify(snapshot),
        threadDigest: commentThreadDigest(source.comments),
        snapshotJson: JSON.stringify(snapshot),
        baseRevision: documentRevisionToken(
          source.document.bodyRevision,
          source.document.content,
        ),
        suggestionRevision: source.document.updatedAt,
        agentThreadId,
        classificationThreadId,
        continuationOfRequestId: continuation?.id ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      request = inserted[0];
      dispatch = true;
    } else {
      const [winner] = await db
        .select()
        .from(schema.commentAiRequests)
        .where(
          and(
            eq(schema.commentAiRequests.documentId, args.documentId),
            eq(schema.commentAiRequests.rootCommentId, args.rootCommentId),
            inArray(schema.commentAiRequests.status, [...ACTIVE_STATUSES]),
          ),
        )
        .limit(1);
      if (!winner || winner.requesterEmail !== email) {
        fail("Another Ask AI operation is already active for this comment", {
          statusCode: 409,
          errorCode: "comment_ai_already_active",
        });
      }
      request = await loadCommentAiRequest(winner.id);
      outcome = "busy";
      if (
        request.submittedMode !== submission.submittedMode ||
        request.instructions !== submission.instructions ||
        request.submittedProvider !== submission.provider ||
        request.submittedModel !== submission.model ||
        request.submittedEngine !== submission.engine ||
        request.continuationOfRequestId !== submission.continuationOfRequestId
      ) {
        fail("Another Ask AI submission is already active for this comment", {
          statusCode: 409,
          errorCode: "comment_ai_operation_conflict",
        });
      }
    }
  }

  const sessionThreadId =
    request.status === "classifying"
      ? request.classificationThreadId
      : request.agentThreadId;
  if (!sessionThreadId) throw new Error("Comment AI session is unavailable");
  const sessionOperationId =
    request.status === "classifying"
      ? `${request.id}:classification`
      : request.id;
  const sessionTurnId = backgroundAgentTurnIdForReceipt(
    sessionThreadId,
    sessionOperationId,
  );
  const storedTurnId =
    request.status === "classifying"
      ? request.classificationTurnId
      : request.agentTurnId;
  if (!storedTurnId) {
    const [bound] = await db
      .update(schema.commentAiRequests)
      .set({
        ...(request.status === "classifying"
          ? { classificationTurnId: sessionTurnId }
          : { agentTurnId: sessionTurnId }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.commentAiRequests.id, request.id))
      .returning();
    request = bound ?? (await loadCommentAiRequest(request.id));
  } else if (storedTurnId !== sessionTurnId) {
    fail("This agent turn is not bound to the selected comment operation", {
      statusCode: 409,
      errorCode: "comment_ai_turn_conflict",
    });
  }

  const pending = pendingSession(request);
  const next =
    pending ??
    ({
      phase: "execution",
      backgroundSession: backgroundSession(request),
      prompt: executionPrompt(request),
      context: executionContext(request),
    } satisfies CommentAiPendingSession);
  await writeAppState("comment-ai-request", {
    operationId: request.id,
    documentId: request.documentId,
    fieldId: request.fieldId,
    threadId: request.threadId,
    intent: request.intent === "unresolved" ? null : request.intent,
  });
  return {
    ...serializeCommentAiRequest(request),
    outcome,
    dispatch:
      outcome === "confirmed-start" &&
      (dispatch ||
        request.status === "classifying" ||
        request.status === "classified"),
    pendingSession: next,
    backgroundSession: next.backgroundSession,
    actionScope: next.backgroundSession.actionScope,
    prompt: next.prompt,
    context: next.context,
  };
}

export async function resolveCommentAiActionSurface(
  details: CommentAiActionSurfaceDetails,
) {
  const parsedClassifierActionScope =
    commentAiClassifierActionScopeSchema.safeParse(details.actionScope);
  const declaresClassifierScope =
    typeof details.actionScope === "object" &&
    details.actionScope !== null &&
    details.actionScope.kind === "content-comment-ai-classifier";
  if (declaresClassifierScope && !parsedClassifierActionScope.success) {
    fail("This comment classifier scope is invalid", {
      statusCode: 409,
      errorCode: "comment_ai_binding_missing",
    });
  }
  const classifierThread = details.threadId
    ? await getThread(details.threadId)
    : null;
  const protectedClassifierScope = commentAiClassifierScopeSchema.safeParse(
    classifierThread?.scope,
  );
  if (parsedClassifierActionScope.success || protectedClassifierScope.success) {
    const requestId = parsedClassifierActionScope.success
      ? parsedClassifierActionScope.data.requestId
      : protectedClassifierScope.data!.id;
    const request = await loadCommentAiRequest(
      requestId,
      details.ownerEmail ?? undefined,
    );
    if (
      classifierThread &&
      classifierThread.ownerEmail !== details.ownerEmail
    ) {
      fail("This classifier thread is unavailable", {
        statusCode: 409,
        errorCode: "comment_ai_thread_conflict",
      });
    }
    if (
      !details.threadId ||
      details.threadId !== request.classificationThreadId ||
      (protectedClassifierScope.success &&
        protectedClassifierScope.data!.id !== request.id)
    ) {
      fail("This classifier thread is not bound to the selected operation", {
        statusCode: 409,
        errorCode: "comment_ai_thread_conflict",
      });
    }
    if (details.queuedMessageId === `${request.id}:classification`) {
      if (
        !details.requestedTurnId ||
        details.requestedTurnId !== request.classificationTurnId
      ) {
        fail("This classifier turn is not bound to the selected operation", {
          statusCode: 409,
          errorCode: "comment_ai_turn_conflict",
        });
      }
    } else if (!request.classificationTurnId) {
      fail("This classifier operation is missing its turn binding", {
        statusCode: 409,
        errorCode: "comment_ai_binding_missing",
      });
    }
    return {
      allowedActionNames: ["submit-comment-ai-classification"],
      actionScope: {
        kind: "content-comment-ai-classifier" as const,
        requestId: request.id,
      },
    };
  }
  const parsedActionScope = commentAiActionScopeSchema.safeParse(
    details.actionScope,
  );
  const declaresCommentAiScope =
    typeof details.actionScope === "object" &&
    details.actionScope !== null &&
    details.actionScope.kind === "content-comment-ai";
  if (declaresCommentAiScope && !parsedActionScope.success) {
    fail("This comment operation scope is invalid", {
      statusCode: 409,
      errorCode: "comment_ai_binding_missing",
    });
  }
  let requestId = parsedActionScope.success
    ? parsedActionScope.data.requestId
    : null;
  const thread = details.threadId ? await getThread(details.threadId) : null;
  const protectedScope = commentAiScopeSchema.safeParse(thread?.scope);

  if (thread && thread.ownerEmail !== details.ownerEmail) {
    fail("This agent thread is unavailable", {
      statusCode: 404,
      errorCode: "comment_ai_thread_unavailable",
    });
  }
  if (!requestId && details.threadId) {
    const bindings = await getDb()
      .select({ id: schema.commentAiRequests.id })
      .from(schema.commentAiRequests)
      .where(
        and(
          eq(schema.commentAiRequests.agentThreadId, details.threadId),
          eq(schema.commentAiRequests.requesterEmail, details.ownerEmail ?? ""),
        ),
      )
      .limit(2);
    if (bindings.length > 1) {
      fail("This agent thread has conflicting comment operation bindings", {
        statusCode: 409,
        errorCode: "comment_ai_thread_conflict",
      });
    }
    requestId = bindings[0]?.id ?? null;
  }
  if (!requestId) {
    if (protectedScope.success) {
      fail("This protected comment conversation has no authorized operation", {
        statusCode: 409,
        errorCode: "comment_ai_binding_missing",
      });
    }
    return { mode: "default" as const };
  }

  const request = await loadCommentAiRequest(
    requestId,
    details.ownerEmail ?? undefined,
  );
  if (!details.threadId || details.threadId !== request.agentThreadId) {
    fail("This agent thread is not bound to the selected comment operation", {
      statusCode: 409,
      errorCode: "comment_ai_thread_conflict",
    });
  }
  if (protectedScope.success && protectedScope.data.id !== request.id) {
    fail("This agent thread is bound to another comment operation", {
      statusCode: 409,
      errorCode: "comment_ai_thread_conflict",
    });
  }
  if (details.queuedMessageId === request.id) {
    if (!details.requestedTurnId) {
      fail("This comment operation is missing its initial agent turn binding", {
        statusCode: 409,
        errorCode: "comment_ai_binding_missing",
      });
    }
    await getDb().transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.commentAiRequests)
        .where(eq(schema.commentAiRequests.id, request.id))
        .for("update");
      if (!locked || locked.agentThreadId !== details.threadId) {
        fail(
          "This agent thread is not bound to the selected comment operation",
          {
            statusCode: 409,
            errorCode: "comment_ai_thread_conflict",
          },
        );
      }
      if (
        locked.agentTurnId &&
        locked.agentTurnId !== details.requestedTurnId
      ) {
        fail("This agent turn is not bound to the selected comment operation", {
          statusCode: 409,
          errorCode: "comment_ai_turn_conflict",
        });
      }
      if (!locked.agentTurnId) {
        await tx
          .update(schema.commentAiRequests)
          .set({
            agentTurnId: details.requestedTurnId,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.commentAiRequests.id, locked.id));
      }
    });
  } else if (!request.agentTurnId) {
    fail("This comment operation is missing its initial agent turn binding", {
      statusCode: 409,
      errorCode: "comment_ai_binding_missing",
    });
  }
  const operation = {
    reply: "reply-to-comment-ai-request",
    suggest: "create-comment-ai-suggestion",
    "apply-resolve": "apply-comment-ai-request",
  }[commentAiIntentSchema.parse(request.intent)];
  return {
    allowedActionNames: ["get-comment-ai-context", operation],
    actionScope: {
      kind: "content-comment-ai",
      requestId: request.id,
    },
  };
}

export async function submitCommentAiClassification(intent: CommentAiIntent) {
  const run = getRequestRunContext();
  if (!run) throw new Error("This classification requires a scoped agent run");
  const scope = commentAiClassifierActionScopeSchema.parse(run.actionScope);
  let request = await loadCommentAiRequest(scope.requestId);
  if (run.threadId !== request.classificationThreadId) {
    throw new Error("This classifier thread is not bound to the operation");
  }
  const resolvedIntent = commentAiIntentSchema.parse(intent);
  if (request.status !== "classifying") {
    if (
      request.submittedMode === "auto" &&
      request.intent === resolvedIntent &&
      request.status === "classified"
    ) {
      const next = pendingSession(request);
      if (!next)
        throw new Error("Classified operation has no execution session");
      return {
        request: serializeCommentAiRequest(request),
        pendingSession: next,
      };
    }
    fail("This comment operation is no longer awaiting classification", {
      statusCode: 409,
      errorCode: "comment_ai_operation_conflict",
    });
  }

  await readCommentAiSource({ ...request, intent: resolvedIntent });
  const continuation = request.continuationOfRequestId
    ? await loadCommentAiRequest(request.continuationOfRequestId)
    : null;
  const executionThreadId =
    resolvedIntent === "reply" && continuation?.agentThreadId
      ? continuation.agentThreadId
      : request.agentThreadId;
  if (!executionThreadId) {
    throw new Error("Classified operation has no execution thread");
  }
  const turnId = backgroundAgentTurnIdForReceipt(executionThreadId, request.id);
  const [updated] = await getDb()
    .update(schema.commentAiRequests)
    .set({
      intent: resolvedIntent,
      status: "classified",
      agentThreadId: executionThreadId,
      agentTurnId: turnId,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.commentAiRequests.id, request.id),
        eq(schema.commentAiRequests.status, "classifying"),
      ),
    )
    .returning();
  request = updated ?? (await loadCommentAiRequest(request.id));
  if (request.intent !== resolvedIntent || request.status !== "classified") {
    fail("A different classifier result already won this operation", {
      statusCode: 409,
      errorCode: "comment_ai_operation_conflict",
    });
  }
  await writeAppState("comment-ai-request", {
    operationId: request.id,
    documentId: request.documentId,
    fieldId: request.fieldId,
    threadId: request.threadId,
    intent: resolvedIntent,
  });
  const next = pendingSession(request);
  if (!next) throw new Error("Classified operation has no execution session");
  return { request: serializeCommentAiRequest(request), pendingSession: next };
}

export async function requireCommentAiRequest(intent?: CommentAiIntent) {
  const run = getRequestRunContext();
  if (!run) throw new Error("This operation requires a scoped comment AI run");
  const scope = commentAiActionScopeSchema.parse(run.actionScope);
  const request = await loadCommentAiRequest(scope.requestId);
  if (run.threadId !== request.agentThreadId) {
    throw new Error("This agent thread is not bound to the comment operation");
  }
  if (intent && request.intent !== intent) {
    throw new Error(
      "This operation is not permitted by the selected comment intent",
    );
  }
  if (request.fieldId !== "body") {
    throw new Error("Unsupported Blocks field for this comment operation");
  }
  const now = new Date().toISOString();
  const [updated] = await getDb()
    .update(schema.commentAiRequests)
    .set({
      status:
        request.status === "queued" || request.status === "classified"
          ? "running"
          : request.status,
      runId: run.runId ?? request.runId,
      model: run.model?.trim().slice(0, 120) || request.model,
      engine: run.engine?.name ?? request.engine,
      updatedAt: now,
    })
    .where(eq(schema.commentAiRequests.id, request.id))
    .returning();
  return updated ?? request;
}

export async function getCommentAiAttempt(
  request: RequestRow,
  attemptId: string,
) {
  const [attempt] = await getDb()
    .select()
    .from(schema.commentAiAttempts)
    .where(
      and(
        eq(schema.commentAiAttempts.id, attemptId),
        eq(schema.commentAiAttempts.requestId, request.id),
      ),
    )
    .limit(1);
  if (!attempt) {
    throw operationError(
      "operation_failed",
      "The comment AI reasoning attempt is unavailable",
    );
  }
  return attempt;
}

async function recordConflict(
  request: RequestRow,
  attempt: CommentAiAttemptRow | null,
  error: CommentAiOperationError,
) {
  const now = new Date().toISOString();
  await getDb().transaction(async (tx) => {
    if (attempt) {
      await tx
        .update(schema.commentAiAttempts)
        .set({
          status: "needs-review",
          errorCode: error.code,
          error: error.message,
          updatedAt: now,
        })
        .where(eq(schema.commentAiAttempts.id, attempt.id));
    }
    await tx
      .update(schema.commentAiRequests)
      .set({
        status: "needs-review",
        errorCode: error.code,
        error: error.message,
        updatedAt: now,
      })
      .where(eq(schema.commentAiRequests.id, request.id));
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
}

export async function beginCommentAiAttempt(request: RequestRow) {
  let source: CommentSource;
  try {
    source = await readCommentAiSource(request);
    assertSubmittedCommentContext(request, source);
  } catch (error) {
    const typed =
      error instanceof CommentAiOperationError
        ? error
        : operationError(
            "permission_changed",
            error instanceof Error
              ? error.message
              : "Comment context could not be read",
          );
    await recordConflict(request, null, typed);
    throw typed;
  }

  const sourceRevision = documentRevisionToken(
    source.document.bodyRevision,
    source.document.content,
  );
  const threadDigest = currentThreadDigest(request, source.comments);
  const now = new Date().toISOString();

  return getDb().transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, request.id))
      .for("update");
    if (!locked) throw new Error("Comment AI operation not found");
    if (terminalSuccess(locked.status)) {
      return { request: locked, attempt: null, source };
    }
    if (locked.activeAttemptId) {
      const [active] = await tx
        .select()
        .from(schema.commentAiAttempts)
        .where(eq(schema.commentAiAttempts.id, locked.activeAttemptId))
        .limit(1);
      const retainedResult = serializeCommentAiRequest(locked).result;
      if (
        locked.intent === "apply-resolve" &&
        !terminalSuccess(locked.status) &&
        locked.status !== "cancelled" &&
        active &&
        retainedResult?.editApplied &&
        active.payloadJson &&
        active.threadDigest === threadDigest
      ) {
        const [resumedAttempt] = await tx
          .update(schema.commentAiAttempts)
          .set({
            status: "reasoning",
            errorCode: null,
            error: null,
            updatedAt: now,
          })
          .where(eq(schema.commentAiAttempts.id, active.id))
          .returning();
        const [resumedRequest] = await tx
          .update(schema.commentAiRequests)
          .set({
            status: "running",
            errorCode: null,
            error: null,
            updatedAt: now,
          })
          .where(eq(schema.commentAiRequests.id, locked.id))
          .returning();
        return {
          request: resumedRequest,
          attempt: resumedAttempt,
          source,
        };
      }
      if (
        active &&
        active.sourceRevision === sourceRevision &&
        active.threadDigest === threadDigest &&
        ["reasoning", "committing"].includes(active.status)
      ) {
        return { request: locked, attempt: active, source };
      }
    }
    if (locked.attemptCount >= MAX_ATTEMPTS) {
      const exhausted = operationError(
        "refresh_exhausted",
        "The Page kept changing while AI worked. Review the retained operation before retrying.",
      );
      await tx
        .update(schema.commentAiRequests)
        .set({
          status: "needs-review",
          errorCode: exhausted.code,
          error: exhausted.message,
          updatedAt: now,
        })
        .where(eq(schema.commentAiRequests.id, locked.id));
      throw exhausted;
    }
    if (locked.activeAttemptId) {
      await tx
        .update(schema.commentAiAttempts)
        .set({ status: "superseded", updatedAt: now })
        .where(eq(schema.commentAiAttempts.id, locked.activeAttemptId));
    }
    const attemptNumber = locked.attemptCount + 1;
    const attemptId = `${locked.id}:attempt:${attemptNumber}`;
    const [attempt] = await tx
      .insert(schema.commentAiAttempts)
      .values({
        id: attemptId,
        ownerEmail: locked.ownerEmail,
        requestId: locked.id,
        attemptNumber,
        sourceRevision,
        suggestionRevision: source.document.updatedAt,
        threadDigest,
        snapshotJson: JSON.stringify(snapshotComments(source.comments)),
        runId: locked.runId,
        model: locked.model,
      })
      .returning();
    const [updated] = await tx
      .update(schema.commentAiRequests)
      .set({
        status: "running",
        activeAttemptId: attemptId,
        attemptCount: attemptNumber,
        errorCode: null,
        error: null,
        updatedAt: now,
      })
      .where(eq(schema.commentAiRequests.id, locked.id))
      .returning();
    return { request: updated, attempt, source };
  });
}

export async function verifyCommentAiAttempt(
  request: RequestRow,
  attemptId: string,
) {
  const attempt = await getCommentAiAttempt(request, attemptId);
  if (
    request.activeAttemptId !== attempt.id ||
    !["reasoning", "committing"].includes(attempt.status)
  ) {
    throw operationError(
      "attempt_superseded",
      "This reasoning attempt was superseded. Read the latest comment AI context before acting.",
      true,
    );
  }
  let source: CommentSource;
  try {
    source = await readCommentAiSource(request);
    assertSubmittedCommentContext(request, source);
  } catch (error) {
    const typed =
      error instanceof CommentAiOperationError
        ? error
        : operationError(
            "permission_changed",
            error instanceof Error ? error.message : "Comment source changed",
          );
    await recordConflict(request, attempt, typed);
    throw typed;
  }
  return {
    attempt,
    source,
    currentRevision: documentRevisionToken(
      source.document.bodyRevision,
      source.document.content,
    ),
    sourceRevisionMatches:
      documentRevisionToken(
        source.document.bodyRevision,
        source.document.content,
      ) === attempt.sourceRevision,
  };
}

export async function markCommentAiRefreshRequired(
  request: RequestRow,
  attempt: CommentAiAttemptRow,
) {
  const now = new Date().toISOString();
  if (request.attemptCount >= MAX_ATTEMPTS) {
    const exhausted = operationError(
      "refresh_exhausted",
      "The Page kept changing while AI worked. Review the retained operation before retrying.",
    );
    await recordConflict(request, attempt, exhausted);
    throw exhausted;
  }
  await getDb().transaction(async (tx) => {
    await tx
      .update(schema.commentAiAttempts)
      .set({
        status: "superseded",
        errorCode: "page_changed",
        error: "The Page changed during this reasoning attempt",
        updatedAt: now,
      })
      .where(eq(schema.commentAiAttempts.id, attempt.id));
    await tx
      .update(schema.commentAiRequests)
      .set({
        status: "refreshing",
        errorCode: "page_changed",
        error:
          "The Page changed during reasoning. Read the latest context and reason again before publishing.",
        updatedAt: now,
      })
      .where(eq(schema.commentAiRequests.id, request.id));
  });
  const current = await loadCommentAiRequest(request.id);
  return {
    ...serializeCommentAiRequest(current),
    operationCompleted: false as const,
    refreshRequired: true as const,
    nextAction: "get-comment-ai-context" as const,
  };
}

export async function retainCommentAiAttemptPayload<T>(
  request: RequestRow,
  attemptId: string,
  payload: T,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    const [lockedRequest] = await tx
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, request.id))
      .for("update");
    const [attempt] = await tx
      .select()
      .from(schema.commentAiAttempts)
      .where(
        and(
          eq(schema.commentAiAttempts.id, attemptId),
          eq(schema.commentAiAttempts.requestId, request.id),
        ),
      );
    if (
      !lockedRequest ||
      !attempt ||
      lockedRequest.activeAttemptId !== attempt.id ||
      !["reasoning", "committing"].includes(attempt.status)
    ) {
      throw operationError(
        "attempt_superseded",
        "This reasoning attempt was superseded. Read the latest comment AI context before acting.",
        true,
      );
    }
    if (attempt.payloadJson) return JSON.parse(attempt.payloadJson) as T;
    const retained = JSON.stringify(payload);
    await tx
      .update(schema.commentAiAttempts)
      .set({
        payloadJson: retained,
        status: "committing",
        errorCode: null,
        error: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.commentAiAttempts.id, attempt.id));
    return JSON.parse(retained) as T;
  });
}

export async function completeCommentAiAttempt(
  attemptId: string,
  status: "completed" | "failed" | "needs-review",
  error?: CommentAiOperationError | Error,
) {
  await getDb()
    .update(schema.commentAiAttempts)
    .set({
      status,
      errorCode:
        error instanceof CommentAiOperationError
          ? error.code
          : error
            ? "operation_failed"
            : null,
      error: error?.message ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.commentAiAttempts.id, attemptId));
}

export async function updateCommentAiRequest(
  request: RequestRow,
  updates: {
    status: CommentAiStatus;
    result?: CommentAiRequest["result"];
    errorCode?: CommentAiErrorCode;
    error?: string | null;
  },
) {
  const [row] = await getDb()
    .update(schema.commentAiRequests)
    .set({
      status: updates.status,
      ...(updates.result != null
        ? {
            resultJson: sql`(COALESCE(${schema.commentAiRequests.resultJson}, '{}')::jsonb || ${JSON.stringify(updates.result)}::jsonb)::text`,
          }
        : {}),
      errorCode: updates.errorCode ?? null,
      error: updates.error ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.commentAiRequests.id, request.id),
        notInArray(schema.commentAiRequests.status, [
          "replied",
          "suggested",
          "resolved",
          "cancelled",
        ]),
      ),
    )
    .returning();
  const current = row ?? (await loadCommentAiRequest(request.id));
  await writeAppState("refresh-signal", { ts: Date.now() });
  return serializeCommentAiRequest(current);
}

export async function reconcileCommentAiSession(args: {
  operationId: string;
  threadId: string;
  turnId: string;
  status: CommentAiSessionStatus;
  runId?: string;
  terminalReason?: string;
}) {
  await loadCommentAiRequest(args.operationId);
  const current = await getDb().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, args.operationId))
      .for("update");
    if (!request) throw new Error("Comment AI operation not found");
    const classifierSession = args.threadId === request.classificationThreadId;
    if (classifierSession) {
      if (
        !request.classificationTurnId ||
        request.classificationTurnId !== args.turnId
      ) {
        fail(
          "This classifier turn is not bound to the selected comment operation",
          {
            statusCode: 409,
            errorCode: "comment_ai_turn_conflict",
          },
        );
      }
      if (request.status !== "classifying") return request;
      if (args.status === "queued" || args.status === "running") return request;

      const now = new Date().toISOString();
      const status: CommentAiStatus =
        args.status === "aborted"
          ? "cancelled"
          : args.status === "errored"
            ? "failed"
            : "needs-review";
      const errorCode: CommentAiErrorCode =
        status === "cancelled" ? null : "run_unavailable";
      const error =
        status === "cancelled"
          ? null
          : args.terminalReason?.trim().slice(0, 500) ||
            (args.status === "errored"
              ? "The classifier run failed before selecting an intent"
              : "The classifier ended without selecting an intent. Review or retry this operation.");
      const [updated] = await tx
        .update(schema.commentAiRequests)
        .set({ status, errorCode, error, updatedAt: now })
        .where(
          and(
            eq(schema.commentAiRequests.id, request.id),
            eq(schema.commentAiRequests.status, "classifying"),
          ),
        )
        .returning();
      return updated ?? request;
    }
    if (request.agentThreadId !== args.threadId) {
      fail("This agent thread is not bound to the selected comment operation", {
        statusCode: 409,
        errorCode: "comment_ai_thread_conflict",
      });
    }
    if (!request.agentTurnId || request.agentTurnId !== args.turnId) {
      fail("This agent turn is not bound to the selected comment operation", {
        statusCode: 409,
        errorCode: "comment_ai_turn_conflict",
      });
    }
    if (terminalSuccess(request.status) || request.status === "cancelled") {
      return request;
    }

    const [attempt] = request.activeAttemptId
      ? await tx
          .select()
          .from(schema.commentAiAttempts)
          .where(eq(schema.commentAiAttempts.id, request.activeAttemptId))
          .limit(1)
      : [];
    const result = serializeCommentAiRequest(request).result;
    let status: CommentAiStatus = request.status as CommentAiStatus;
    let errorCode = errorCodeSchema.parse(request.errorCode);
    let error = request.error;
    let attemptStatus: CommentAiAttemptRow["status"] | null = null;

    if (args.status === "aborted") {
      if (result?.editApplied || attempt?.status === "committing") {
        status = "needs-review";
        errorCode = "operation_failed";
        error = result?.editApplied
          ? "AI stopped after a verified Page edit. Review the retained result; cancellation did not undo the edit."
          : "AI stopped while a write was being committed. Review the operation before retrying.";
        attemptStatus = "needs-review";
      } else {
        status = "cancelled";
        attemptStatus = "cancelled";
      }
    } else if (args.status === "completed" || args.status === "truncated") {
      status = "needs-review";
      errorCode = "run_unavailable";
      error =
        args.status === "truncated"
          ? "The agent stopped before completing this operation. Review the retained attempt before retrying."
          : "The agent finished without recording an operation result. Review the retained attempt before retrying.";
      attemptStatus = "needs-review";
    } else if (args.status === "unavailable") {
      status = "needs-review";
      errorCode = "run_unavailable";
      error =
        "The agent run could not be confirmed. Its durable state may still arrive; review or retry this same operation before starting another.";
      attemptStatus = attempt ? "needs-review" : null;
    } else if (args.status === "errored") {
      if (result?.editApplied || attempt?.status === "committing") {
        status = "needs-review";
        errorCode = "operation_failed";
        error = result?.editApplied
          ? "The agent run ended after a verified Page edit. Review the retained result before retrying."
          : "The agent run ended while a write was being committed. Review the operation before retrying.";
        attemptStatus = "needs-review";
      } else {
        status = "failed";
        errorCode = "run_unavailable";
        error =
          args.terminalReason?.trim().slice(0, 500) ||
          "The agent run failed before completing this operation";
        attemptStatus = "failed";
      }
    }

    const now = new Date().toISOString();
    const [updated] = await tx
      .update(schema.commentAiRequests)
      .set({
        status,
        runId: args.runId?.trim() || request.runId,
        errorCode,
        error,
        updatedAt: now,
      })
      .where(eq(schema.commentAiRequests.id, request.id))
      .returning();
    if (attempt && attemptStatus) {
      await tx
        .update(schema.commentAiAttempts)
        .set({ status: attemptStatus, errorCode, error, updatedAt: now })
        .where(eq(schema.commentAiAttempts.id, attempt.id));
    }
    return updated;
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
  return serializeCommentAiRequest(current);
}

export async function listCommentAiRequests(documentId: string) {
  await assertAccess("document", documentId, "viewer");
  const email = getRequestUserEmail();
  if (!email) throw new Error("Sign in to read comment AI operations");
  const rows = await getDb()
    .select()
    .from(schema.commentAiRequests)
    .where(
      and(
        eq(schema.commentAiRequests.documentId, documentId),
        eq(schema.commentAiRequests.requesterEmail, email),
      ),
    )
    .orderBy(desc(schema.commentAiRequests.createdAt))
    .limit(100);
  return { requests: rows.map(serializeCommentAiRequest) };
}
