// templates/design/shared/review-agent.ts
export const REVIEW_AGENT_INTENTS = [
  "reply",
  "suggest",
  "apply-resolve",
] as const;
export type ReviewAgentIntent = (typeof REVIEW_AGENT_INTENTS)[number];
export const REVIEW_AGENT_MODES = ["auto", ...REVIEW_AGENT_INTENTS] as const;
export type ReviewAgentMode = (typeof REVIEW_AGENT_MODES)[number];

export const REVIEW_AGENT_STATUSES = [
  "classifying",
  "queued",
  "running",
  "replied",
  "suggested",
  "applied",
  "needs-input",
  "failed",
  "cancelled",
] as const;
export type ReviewAgentStatus = (typeof REVIEW_AGENT_STATUSES)[number];
export const REVIEW_AGENT_ACTIVE_STATUSES = [
  "classifying",
  "queued",
  "running",
] as const satisfies readonly ReviewAgentStatus[];
export const isReviewAgentActive = (s: ReviewAgentStatus) =>
  (REVIEW_AGENT_ACTIVE_STATUSES as readonly string[]).includes(s);

export type ReviewAgentErrorCode =
  | "engine_not_configured"
  | "dispatch_failed"
  | "run_failed"
  | "no_result"
  | "run_timeout"
  | "permission_changed"
  | "thread_unavailable"
  | "target_changed"
  | "target_ambiguous"
  | "apply_unavailable"
  | "apply_incomplete"
  | "apply_attempts_exhausted"
  | "cancelled_after_edit";

export interface ReviewAgentAppliedChange {
  before: string;
  after: string;
  truncated?: boolean;
} // each side <= 300 chars, <= 5 entries
export interface ReviewAgentResult {
  replyCommentId?: string;
  proposal?: {
    summary: string;
    editCount: number;
    edits?: { search: string; replace: string }[];
    truncated?: boolean;
  };
  editApplied?: boolean;
  fileId?: string;
  editsApplied?: number;
  changes?: ReviewAgentAppliedChange[];
  receiptCommentId?: string;
  resolved?: boolean;
  applyAttempts?: number;
  versionId?: string | null;
}

export interface ReviewAgentRequest {
  requestId: string;
  designId: string;
  threadId: string;
  rootCommentId: string;
  screenId: string | null;
  mode: ReviewAgentMode;
  intent: ReviewAgentIntent | null;
  status: ReviewAgentStatus;
  requesterIsMe: boolean;
  model: string | null; // observed, else submitted; display only
  engine: string | null;
  result: ReviewAgentResult | null;
  errorCode: ReviewAgentErrorCode | null;
  error: string | null; // <= 500 chars
  createdAt: string;
  updatedAt: string;
  // requester only; null for everyone else
  instructions: string | null;
  triggerCommentId: string | null;
  submitted: {
    provider: string | null;
    model: string | null;
    engine: string | null;
  } | null;
  agentThreadId: string | null;
  agentTurnId: string | null;
  /** Set only while the row still needs a dispatch (`classifying`, or `queued` with no run yet). */
  pendingSession: ReviewAgentPendingSession | null;
}

export interface ReviewAgentPendingSession {
  phase: "classification" | "execution";
  operationId: string;
  threadId: string;
  turnId: string;
  scope: {
    type: "design-review-agent" | "design-review-agent-classifier";
    id: string;
  };
  actionScope: {
    kind: "design-review-agent" | "design-review-agent-classifier";
    requestId: string;
  };
  message: string;
  instructions: string;
  model?: string;
  engine?: string;
  usageLabel: string;
}

export interface StartReviewAgentResult {
  outcome: "started" | "replayed" | "busy";
  dispatch: boolean;
  request: ReviewAgentRequest;
  pendingSession: ReviewAgentPendingSession | null;
}

export const REVIEW_AGENT_ACTIONS = {
  start: "start-review-agent-request",
  list: "list-review-agent-requests",
  cancel: "cancel-review-agent-request",
  reconcile: "reconcile-review-agent-session",
  context: "get-review-agent-context",
  classify: "submit-review-agent-classification",
  reply: "post-review-agent-reply",
  propose: "propose-review-agent-changes",
  apply: "apply-review-agent-changes",
} as const;

export const REVIEW_AGENT_ALLOWED_ACTIONS = {
  classification: [REVIEW_AGENT_ACTIONS.context, REVIEW_AGENT_ACTIONS.classify],
  reply: [
    REVIEW_AGENT_ACTIONS.context,
    "get-design-snapshot",
    REVIEW_AGENT_ACTIONS.reply,
  ],
  suggest: [
    REVIEW_AGENT_ACTIONS.context,
    "get-design-snapshot",
    REVIEW_AGENT_ACTIONS.propose,
    REVIEW_AGENT_ACTIONS.reply,
  ],
  "apply-resolve": [
    REVIEW_AGENT_ACTIONS.context,
    "get-design-snapshot",
    REVIEW_AGENT_ACTIONS.apply,
    REVIEW_AGENT_ACTIONS.reply,
  ],
  terminal: [REVIEW_AGENT_ACTIONS.context],
} as const;

export const REVIEW_AGENT_LIMITS = {
  instructionsMax: 4_000,
  threadCommentsMax: 100,
  threadCharsMax: 24_000,
  editsMax: 20,
  editCharsMax: 24_000,
  applyAttemptsMax: 3,
  maxActivePerRequester: 3,
  maxStartsPerHour: 30,
  staleActiveMs: 30 * 60_000,
  resultJsonMaxBytes: 8_192,
} as const;

export const REVIEW_AGENT_DEFAULT_INSTRUCTIONS: Record<
  ReviewAgentIntent,
  string
> = {
  reply: "Reply in this review thread.", // i18n-ignore agent dispatch prompt
  suggest: "Suggest changes for this review thread.", // i18n-ignore agent dispatch prompt
  "apply-resolve":
    "Apply the requested changes in this review thread and resolve it.", // i18n-ignore agent dispatch prompt
};
