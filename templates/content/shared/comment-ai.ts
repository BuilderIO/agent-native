export type CommentAiIntent = "suggest" | "reply" | "apply-resolve";

export type CommentAiStatus =
  | "queued"
  | "running"
  | "replied"
  | "suggested"
  | "resolved"
  | "needs-review"
  | "failed";

export interface CommentAiRequest {
  requestId: string;
  documentId: string;
  threadId: string;
  rootCommentId: string;
  intent: CommentAiIntent;
  status: CommentAiStatus;
  runId: string | null;
  agentThreadId: string | null;
  result: {
    commentId?: string;
    suggestionId?: string;
    editApplied?: boolean;
    resolved?: boolean;
  } | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StartCommentAiResult extends CommentAiRequest {
  dispatch: boolean;
  actionScope: { kind: "content-comment-ai"; requestId: string };
  prompt: string;
  context?: string;
}
