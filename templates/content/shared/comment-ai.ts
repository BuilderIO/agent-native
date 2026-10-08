export type CommentAiIntent = "suggest" | "reply" | "apply-resolve";
export type CommentAiSubmittedMode = "auto" | CommentAiIntent;

export type CommentAiStatus =
  | "classifying"
  | "classified"
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

/** A bounded preview of one applied edit, shown on the resolved thread. */
export interface CommentAiAppliedChange {
  before: string;
  after: string;
  /** Either side was cut to fit the preview. */
  truncated?: boolean;
}

export interface CommentAiOperationResult {
  commentId?: string;
  suggestionId?: string;
  editApplied?: boolean;
  resolved?: boolean;
  /** What Apply changes and resolve replaced, for the thread's receipt. */
  changes?: CommentAiAppliedChange[];
  /** Every applied edit can be reversed by exact text replacement. */
  undoable?: boolean;
  /** The requester reversed the applied edit and reopened the thread. */
  undone?: boolean;
}

export interface CommentAiRequest {
  operationId: string;
  requestId: string;
  documentId: string;
  threadId: string;
  rootCommentId: string;
  submittedMode?: CommentAiSubmittedMode;
  instructions?: string;
  submittedProvider?: string | null;
  submittedModel?: string | null;
  submittedEngine?: string | null;
  continuationOfRequestId?: string | null;
  intent: CommentAiIntent | null;
  status: CommentAiStatus;
  attemptId: string | null;
  attemptCount: number;
  runId: string | null;
  agentThreadId: string | null;
  agentTurnId: string | null;
  model: string | null;
  engine: string | null;
  result: CommentAiOperationResult | null;
  errorCode: CommentAiErrorCode;
  error: string | null;
  pendingSession?: CommentAiPendingSession | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommentAiBackgroundSession {
  operationId: string;
  threadId: string;
  turnId: string;
  scope: {
    type: "content-comment-ai" | "content-comment-ai-classifier";
    id: string;
  };
  actionScope: {
    kind: "content-comment-ai" | "content-comment-ai-classifier";
    requestId: string;
  };
  model?: string;
  engine?: string;
}

export interface CommentAiPendingSession {
  phase: "classification" | "execution";
  backgroundSession: CommentAiBackgroundSession;
  prompt: string;
  context?: string;
}

export interface StartCommentAiResult extends CommentAiRequest {
  outcome: "confirmed-start" | "busy";
  dispatch: boolean;
  pendingSession: CommentAiPendingSession;
  backgroundSession: CommentAiBackgroundSession;
  actionScope: CommentAiBackgroundSession["actionScope"];
  prompt: string;
  context?: string;
}

export interface CommentAiRefreshResult extends CommentAiRequest {
  operationCompleted: false;
  refreshRequired: true;
  nextAction: "get-comment-ai-context";
}
