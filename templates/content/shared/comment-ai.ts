export type CommentAiIntent = "suggest" | "reply" | "apply-resolve";

export type CommentAiStatus =
  | "queued"
  | "running"
  | "refreshing"
  | "replied"
  | "suggested"
  | "resolved"
  | "needs-review"
  | "failed"
  | "cancelled";

export type CommentAiAttemptStatus =
  | "reasoning"
  | "committing"
  | "superseded"
  | "completed"
  | "cancelled"
  | "needs-review"
  | "failed";

export type CommentAiSessionStatus =
  | "queued"
  | "running"
  | "completed"
  | "truncated"
  | "errored"
  | "aborted"
  | "unavailable";

export type CommentAiErrorCode =
  | "page_changed"
  | "attempt_superseded"
  | "root_comment_changed"
  | "discussion_changed"
  | "target_deleted"
  | "target_ambiguous"
  | "permission_changed"
  | "refresh_exhausted"
  | "operation_failed"
  | "run_unavailable"
  | null;

export interface CommentAiOperationResult {
  commentId?: string;
  suggestionId?: string;
  editApplied?: boolean;
  resolved?: boolean;
}

export interface CommentAiRequest {
  operationId: string;
  requestId: string;
  documentId: string;
  threadId: string;
  rootCommentId: string;
  intent: CommentAiIntent;
  status: CommentAiStatus;
  attemptId: string | null;
  attemptCount: number;
  runId: string | null;
  agentThreadId: string;
  model: string | null;
  engine: string | null;
  result: CommentAiOperationResult | null;
  errorCode: CommentAiErrorCode;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentAiBackgroundSession {
  operationId: string;
  threadId: string;
  scope: { type: "content-comment-ai"; id: string };
}

export interface StartCommentAiResult extends CommentAiRequest {
  dispatch: boolean;
  backgroundSession: CommentAiBackgroundSession;
  prompt: string;
  context?: string;
}

export interface CommentAiRefreshResult extends CommentAiRequest {
  operationCompleted: false;
  refreshRequired: true;
  nextAction: "get-comment-ai-context";
}
