import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getRequestRunContext,
  getRequestUserEmail,
  getRunStatus,
  getRunTurnRef,
  getActiveRunForThreadAsync,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { documentRevisionToken } from "../../actions/_document-edit-mutation.js";
import { commentIdForIdempotency } from "../../actions/add-comment.js";
import type {
  CommentAiIntent,
  CommentAiRequest,
  StartCommentAiResult,
} from "../../shared/comment-ai.js";
import { CONTENT_SUGGESTED_EDITS_FLAG } from "../../shared/feature-flags.js";
import { getDb, schema } from "../db/index.js";

export const commentAiIntentSchema = z.enum([
  "suggest",
  "reply",
  "apply-resolve",
]);
export const commentAiScopeSchema = z
  .object({
    kind: z.literal("content-comment-ai"),
    requestId: z.string().uuid(),
  })
  .strict();
const statusSchema = z.enum([
  "queued",
  "running",
  "replied",
  "suggested",
  "resolved",
  "needs-review",
  "failed",
]);
const resultSchema = z.object({
  commentId: z.string().optional(),
  suggestionId: z.string().optional(),
  editApplied: z.boolean().optional(),
  resolved: z.boolean().optional(),
});
type RequestRow = typeof schema.commentAiRequests.$inferSelect;
type RequestSummaryRow = Pick<
  RequestRow,
  | "id"
  | "documentId"
  | "threadId"
  | "rootCommentId"
  | "intent"
  | "status"
  | "runId"
  | "agentThreadId"
  | "resultJson"
  | "error"
  | "createdAt"
  | "updatedAt"
>;
type CommentRow = typeof schema.documentComments.$inferSelect;

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
          .map((c) => ({
            id: c.id,
            parentId: c.parentId,
            content: c.content,
            resolved: c.resolved,
            quotedText: c.quotedText,
            anchorPrefix: c.anchorPrefix,
            anchorSuffix: c.anchorSuffix,
            anchorStartOffset: c.anchorStartOffset,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    )
    .digest("hex");
}

export function serializeCommentAiRequest(
  row: RequestSummaryRow,
): CommentAiRequest {
  return {
    requestId: row.id,
    documentId: row.documentId,
    threadId: row.threadId,
    rootCommentId: row.rootCommentId,
    intent: commentAiIntentSchema.parse(row.intent),
    status: statusSchema.parse(row.status),
    runId: row.runId,
    agentThreadId: row.agentThreadId,
    result:
      row.resultJson === null
        ? null
        : resultSchema.parse(JSON.parse(row.resultJson)),
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
  if (!document || document.trashedAt || document.sourceMode)
    throw new Error("This Page is unavailable for Ask AI");
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
    (c) => c.id === request.rootCommentId && c.parentId === null,
  );
  if (!root)
    throw new Error(
      "The selected comment no longer belongs to this Page and thread",
    );
  return { document, comments, root };
}

async function hasActiveSuccessor(
  request: RequestSummaryRow,
): Promise<boolean> {
  if (!request.runId || !request.agentThreadId) return false;
  const [origin, successor] = await Promise.all([
    getRunTurnRef(request.runId),
    getActiveRunForThreadAsync(request.agentThreadId),
  ]);
  return Boolean(
    origin &&
    successor &&
    successor.status === "running" &&
    origin.threadId === successor.threadId &&
    origin.turnId === successor.turnId,
  );
}

export async function startCommentAiRequest(
  args: {
    requestId: string;
    documentId: string;
    threadId: string;
    rootCommentId: string;
    intent: CommentAiIntent;
  },
  ctx?: ActionRunContext,
): Promise<StartCommentAiResult> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("Sign in to use Ask AI");
  let existing = await getDb()
    .select()
    .from(schema.commentAiRequests)
    .where(eq(schema.commentAiRequests.id, args.requestId))
    .limit(1);
  if (!existing.length) {
    existing = await getDb()
      .select()
      .from(schema.commentAiRequests)
      .where(
        and(
          eq(schema.commentAiRequests.documentId, args.documentId),
          eq(schema.commentAiRequests.threadId, args.threadId),
          eq(schema.commentAiRequests.requesterEmail, email),
          inArray(schema.commentAiRequests.status, ["queued", "running"]),
        ),
      )
      .limit(1);
  }
  let request: RequestRow;
  let dispatch = false;
  if (existing[0]) {
    request = await loadCommentAiRequest(existing[0].id);
    if (
      request.documentId !== args.documentId ||
      request.threadId !== args.threadId ||
      request.rootCommentId !== args.rootCommentId ||
      request.intent !== args.intent
    )
      throw new Error(
        "This request ID is already bound to another comment or intent",
      );
  } else {
    const { document, comments, root } = await readCommentAiSource(args);
    if (root.resolved) throw new Error("Reopen the comment before asking AI");
    if (
      args.intent === "suggest" &&
      !(await isFeatureFlagEnabled(CONTENT_SUGGESTED_EDITS_FLAG, ctx))
    )
      throw new Error("Suggested edits are not enabled for this account");
    if (
      comments.length > 100 ||
      comments.reduce((size, c) => size + c.content.length, 0) > 24000
    )
      throw new Error(
        "This conversation is too large for one comment AI request",
      );
    const inserted = await getDb()
      .insert(schema.commentAiRequests)
      .values({
        id: args.requestId,
        ownerEmail: document.ownerEmail,
        requesterEmail: email,
        documentId: args.documentId,
        threadId: args.threadId,
        rootCommentId: args.rootCommentId,
        fieldId: "body",
        intent: args.intent,
        threadDigest: commentThreadDigest(comments),
        snapshotJson: JSON.stringify(
          comments.map((c) => ({
            id: c.id,
            author: c.authorName,
            content: c.content,
          })),
        ),
        baseRevision: documentRevisionToken(
          document.bodyRevision,
          document.content,
        ),
        suggestionRevision: document.updatedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      request = inserted[0];
      dispatch = true;
    } else {
      const [winner] = await getDb()
        .select()
        .from(schema.commentAiRequests)
        .where(
          and(
            eq(schema.commentAiRequests.documentId, args.documentId),
            eq(schema.commentAiRequests.threadId, args.threadId),
            eq(schema.commentAiRequests.requesterEmail, email),
            inArray(schema.commentAiRequests.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      request = await loadCommentAiRequest(winner?.id ?? args.requestId);
    }
    if (
      request.documentId !== args.documentId ||
      request.threadId !== args.threadId ||
      request.rootCommentId !== args.rootCommentId ||
      request.intent !== args.intent
    )
      throw new Error(
        "This request ID is already bound to another comment or intent",
      );
  }
  if (
    !dispatch &&
    !["replied", "suggested", "resolved"].includes(request.status)
  ) {
    const recoverable =
      request.status === "needs-review" ||
      request.status === "failed" ||
      (request.runId
        ? (await getRunStatus(request.runId)) !== "running" &&
          !(await hasActiveSuccessor(request))
        : Date.now() - Date.parse(request.updatedAt) > 60000);
    if (recoverable) {
      const [claimed] = await getDb()
        .update(schema.commentAiRequests)
        .set({
          status: "queued",
          runId: null,
          error: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.commentAiRequests.id, request.id),
            eq(schema.commentAiRequests.status, request.status),
            eq(schema.commentAiRequests.updatedAt, request.updatedAt),
            request.runId
              ? eq(schema.commentAiRequests.runId, request.runId)
              : isNull(schema.commentAiRequests.runId),
          ),
        )
        .returning();
      dispatch = Boolean(claimed);
      request = claimed ?? (await loadCommentAiRequest(request.id));
    }
  }
  const intent = {
    suggest: "Suggest changes",
    reply: "Reply in thread",
    "apply-resolve": "Apply changes and resolve",
  }[args.intent];
  await writeAppState("comment-ai-request", {
    requestId: request.id,
    documentId: request.documentId,
    fieldId: request.fieldId,
    threadId: request.threadId,
    intent: request.intent,
  });
  return {
    ...serializeCommentAiRequest(request),
    dispatch,
    actionScope: { kind: "content-comment-ai", requestId: request.id },
    prompt: `${intent} for this comment.`,
    context: `Original comment: /page/${encodeURIComponent(request.documentId)}?comment=${encodeURIComponent(request.threadId)}. The scoped context action contains the submitted conversation and current Page body.`,
  };
}

export async function resolveCommentAiActionSurface(details: {
  actionScope?: unknown;
  ownerEmail: string | null;
  threadId?: string;
}) {
  if (details.actionScope === undefined) return { mode: "default" as const };
  const scope = commentAiScopeSchema.parse(details.actionScope);
  const request = await loadCommentAiRequest(
    scope.requestId,
    details.ownerEmail ?? undefined,
  );
  await getDb()
    .update(schema.commentAiRequests)
    .set({ agentThreadId: details.threadId ?? request.agentThreadId })
    .where(eq(schema.commentAiRequests.id, request.id));
  const operation = {
    reply: "reply-to-comment-ai-request",
    suggest: "create-comment-ai-suggestion",
    "apply-resolve": "apply-comment-ai-request",
  }[commentAiIntentSchema.parse(request.intent)];
  return {
    allowedActionNames: ["get-comment-ai-context", operation],
    actionScope: scope,
  };
}

export async function requireCommentAiRequest(intent?: CommentAiIntent) {
  const run = getRequestRunContext();
  if (!run) throw new Error("This operation requires a scoped comment AI run");
  const scope = commentAiScopeSchema.parse(run.actionScope);
  const request = await loadCommentAiRequest(scope.requestId);
  if (intent && request.intent !== intent)
    throw new Error(
      "This operation is not permitted by the selected comment intent",
    );
  if (request.fieldId !== "body")
    throw new Error("Unsupported Blocks field for this comment request");
  await getDb()
    .update(schema.commentAiRequests)
    .set({
      runId: run.runId,
      agentThreadId: run.threadId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.commentAiRequests.id, request.id));
  return request;
}

export async function assertCommentAiSourceUnchanged(request: RequestRow) {
  const source = await readCommentAiSource(request);
  const receiptId = commentIdForIdempotency(
    request.requesterEmail,
    request.documentId,
    `comment-ai:${request.id}:${request.intent === "reply" ? "reply" : "receipt"}`,
  );
  if (
    commentThreadDigest(source.comments.filter((c) => c.id !== receiptId)) !==
    request.threadDigest
  )
    throw new Error(
      "The comment changed during this request. Its thread remains open for review.",
    );
  return source;
}

export async function updateCommentAiRequest(
  request: RequestRow,
  updates: {
    status: CommentAiRequest["status"];
    result?: CommentAiRequest["result"];
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
        ]),
      ),
    )
    .returning();
  if (!row)
    return serializeCommentAiRequest(await loadCommentAiRequest(request.id));
  await writeAppState("refresh-signal", { ts: Date.now() });
  return serializeCommentAiRequest(row);
}

export async function retainCommentAiPayload<T>(
  request: RequestRow,
  payload: T,
): Promise<T> {
  await getDb()
    .update(schema.commentAiRequests)
    .set({
      payloadJson: JSON.stringify(payload),
      status: "running",
      error: null,
    })
    .where(
      and(
        eq(schema.commentAiRequests.id, request.id),
        isNull(schema.commentAiRequests.payloadJson),
      ),
    );
  const current = await loadCommentAiRequest(request.id);
  if (!current.payloadJson)
    throw new Error("Comment AI operation payload was not retained");
  return JSON.parse(current.payloadJson) as T;
}

export async function listCommentAiRequests(documentId: string) {
  await assertAccess("document", documentId, "viewer");
  const email = getRequestUserEmail();
  if (!email) throw new Error("Sign in to read comment AI requests");
  const rows = await getDb()
    .select({
      id: schema.commentAiRequests.id,
      documentId: schema.commentAiRequests.documentId,
      threadId: schema.commentAiRequests.threadId,
      rootCommentId: schema.commentAiRequests.rootCommentId,
      intent: schema.commentAiRequests.intent,
      status: schema.commentAiRequests.status,
      runId: schema.commentAiRequests.runId,
      agentThreadId: schema.commentAiRequests.agentThreadId,
      resultJson: schema.commentAiRequests.resultJson,
      error: schema.commentAiRequests.error,
      createdAt: schema.commentAiRequests.createdAt,
      updatedAt: schema.commentAiRequests.updatedAt,
    })
    .from(schema.commentAiRequests)
    .where(
      and(
        eq(schema.commentAiRequests.documentId, documentId),
        eq(schema.commentAiRequests.requesterEmail, email),
      ),
    )
    .orderBy(desc(schema.commentAiRequests.createdAt))
    .limit(100);
  const requests = await Promise.all(
    rows.map(async (row) => {
      const request = serializeCommentAiRequest(row);
      if (request.status !== "queued" && request.status !== "running")
        return request;
      if (request.runId) {
        const runStatus = await getRunStatus(request.runId);
        if (runStatus !== "running" && (await hasActiveSuccessor(row)))
          return request;
        if (runStatus !== "running")
          return {
            ...request,
            status: "needs-review" as const,
            error:
              runStatus === null
                ? "Run status is unavailable; reconcile this request before retrying"
                : `The agent run ended (${runStatus}) before this request completed`,
          };
      } else if (Date.now() - Date.parse(request.updatedAt) > 60000) {
        return {
          ...request,
          status: "needs-review" as const,
          error:
            "No operation has been recorded yet. Retry this same request to recover its result.",
        };
      }
      return request;
    }),
  );
  return { requests };
}
