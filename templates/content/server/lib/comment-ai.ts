import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestRunContext,
  getRequestUserEmail,
  getThread,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { documentRevisionToken } from "../../actions/_document-edit-mutation.js";
import { commentIdForIdempotency } from "../../actions/add-comment.js";
import type {
  CommentAiErrorCode,
  CommentAiIntent,
  CommentAiRequest,
  CommentAiSessionStatus,
  CommentAiStatus,
  StartCommentAiResult,
} from "../../shared/comment-ai.js";
import { getDb, schema } from "../db/index.js";

const ACTIVE_STATUSES = ["queued", "running", "refreshing"] as const;
const TERMINAL_SUCCESS = ["replied", "suggested", "resolved"] as const;
const MAX_ATTEMPTS = 2;

export const commentAiIntentSchema = z.enum([
  "suggest",
  "reply",
  "apply-resolve",
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
const statusSchema = z.enum([
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
    | "intent"
    | "status"
    | "activeAttemptId"
    | "attemptCount"
    | "runId"
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
    intent: commentAiIntentSchema.parse(row.intent),
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
  if (!request.agentThreadId) {
    throw new Error("Comment AI operation is missing its agent thread");
  }
  return {
    operationId: request.id,
    threadId: request.agentThreadId,
    scope: { type: "content-comment-ai" as const, id: request.id },
    actionScope: {
      kind: "content-comment-ai" as const,
      requestId: request.id,
    },
  };
}

export async function startCommentAiRequest(args: {
  requestId: string;
  agentThreadId?: string;
  documentId: string;
  threadId: string;
  rootCommentId: string;
  intent: CommentAiIntent;
}): Promise<StartCommentAiResult> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("Sign in to use Ask AI");
  const db = getDb();
  const [sameId] = await db
    .select()
    .from(schema.commentAiRequests)
    .where(eq(schema.commentAiRequests.id, args.requestId))
    .limit(1);
  let request: RequestRow;
  let dispatch = false;

  if (sameId) {
    if (sameId.requesterEmail !== email) {
      throw new Error("Comment AI operation not found");
    }
    request = await loadCommentAiRequest(sameId.id);
    if (
      request.documentId !== args.documentId ||
      request.threadId !== args.threadId ||
      request.rootCommentId !== args.rootCommentId ||
      request.intent !== args.intent ||
      (args.agentThreadId &&
        request.agentThreadId !== args.agentThreadId.trim())
    ) {
      fail("This operation ID is already bound to another comment or intent", {
        statusCode: 409,
        errorCode: "comment_ai_operation_conflict",
      });
    }
    if (["needs-review", "failed", "cancelled"].includes(request.status)) {
      const [reclaimed] = await db
        .update(schema.commentAiRequests)
        .set({
          status: "queued",
          errorCode: null,
          error: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.commentAiRequests.id, request.id),
            inArray(schema.commentAiRequests.status, [
              "needs-review",
              "failed",
              "cancelled",
            ]),
          ),
        )
        .returning();
      request = reclaimed ?? (await loadCommentAiRequest(request.id));
      dispatch = Boolean(reclaimed);
    }
  } else {
    const source = await readCommentAiSource(args);
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
      args.agentThreadId?.trim() || `comment-ai-${crypto.randomUUID()}`;
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
        intent: args.intent,
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
    }
  }

  const intent = {
    suggest: "Suggest changes",
    reply: "Reply in thread",
    "apply-resolve": "Apply changes and resolve",
  }[commentAiIntentSchema.parse(request.intent)];
  await writeAppState("comment-ai-request", {
    operationId: request.id,
    documentId: request.documentId,
    fieldId: request.fieldId,
    threadId: request.threadId,
    intent: request.intent,
  });
  return {
    ...serializeCommentAiRequest(request),
    dispatch,
    backgroundSession: backgroundSession(request),
    actionScope: {
      kind: "content-comment-ai" as const,
      requestId: request.id,
    },
    prompt: `${intent} for this comment.`,
    context: `Original comment: /page/${encodeURIComponent(request.documentId)}?comment=${encodeURIComponent(request.threadId)}. Read the scoped context before acting and follow any refresh instruction before publishing.`,
  };
}

export async function resolveCommentAiActionSurface(
  details: CommentAiActionSurfaceDetails,
) {
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
    mode: "allowlist" as const,
    allowedActionNames: ["get-comment-ai-context", operation],
    actionScope: {
      kind: "content-comment-ai",
      requestId: request.id,
    },
  };
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
      status: request.status === "queued" ? "running" : request.status,
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
