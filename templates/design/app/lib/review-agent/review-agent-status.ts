import type { ReviewComment } from "@agent-native/core/review";
import {
  isReviewAgentActive,
  REVIEW_AGENT_LIMITS,
  type ReviewAgentErrorCode,
  type ReviewAgentRequest,
  type ReviewAgentStatus,
} from "@shared/review-agent";
import { modelDisplayName } from "@shared/review-agent-identity";

/** How long a finished run's status stays on the card; the agent's reply is the lasting record. */
export const REVIEW_AGENT_FRESH_RESULT_WINDOW_MS = 2 * 60_000;

export type ReviewAgentStatusIcon =
  | "spinner"
  | "replied"
  | "suggested"
  | "applied"
  | "needs-input"
  | "failed"
  | "cancelled";

export interface ReviewAgentStatusPresentation {
  labelKey: string;
  /** Whether the label interpolates `{{agent}}`. */
  namesAgent: boolean;
  icon: ReviewAgentStatusIcon;
  /** Why the run ended, shown as a tooltip instead of a visible description. */
  tooltipKey: string | null;
  canCancel: boolean;
  canOpenChat: boolean;
  canRetry: boolean;
}

interface StatusRow {
  labelKey: string;
  namesAgent: boolean;
  icon: ReviewAgentStatusIcon;
  cancel: boolean;
  openChat: boolean;
  retry: boolean;
}

const STATUS_ROWS: Record<ReviewAgentStatus, StatusRow> = {
  classifying: {
    labelKey: "review.agent.working",
    namesAgent: true,
    icon: "spinner",
    cancel: true,
    openChat: true,
    retry: false,
  },
  running: {
    labelKey: "review.agent.working",
    namesAgent: true,
    icon: "spinner",
    cancel: true,
    openChat: true,
    retry: false,
  },
  queued: {
    labelKey: "review.agent.queued",
    namesAgent: true,
    icon: "spinner",
    cancel: true,
    openChat: false,
    retry: false,
  },
  replied: {
    labelKey: "review.agent.replied",
    namesAgent: true,
    icon: "replied",
    cancel: false,
    openChat: true,
    retry: false,
  },
  suggested: {
    labelKey: "review.agent.suggested",
    namesAgent: true,
    icon: "suggested",
    cancel: false,
    openChat: true,
    retry: false,
  },
  applied: {
    labelKey: "review.agent.applied",
    namesAgent: true,
    icon: "applied",
    cancel: false,
    openChat: true,
    retry: false,
  },
  "needs-input": {
    labelKey: "review.agent.needsInput",
    namesAgent: true,
    icon: "needs-input",
    cancel: false,
    openChat: true,
    retry: false,
  },
  failed: {
    labelKey: "review.agent.failed",
    namesAgent: true,
    icon: "failed",
    cancel: false,
    openChat: true,
    retry: true,
  },
  cancelled: {
    labelKey: "review.agent.cancelled",
    namesAgent: false,
    icon: "cancelled",
    cancel: false,
    openChat: false,
    retry: false,
  },
};

const ERROR_TOOLTIP_KEYS: Record<ReviewAgentErrorCode, string> = {
  engine_not_configured: "review.agent.error.engineNotConfigured",
  dispatch_failed: "review.agent.error.generic",
  run_failed: "review.agent.error.generic",
  no_result: "review.agent.error.noResult",
  run_timeout: "review.agent.error.timeout",
  permission_changed: "review.agent.error.permission",
  thread_unavailable: "review.agent.error.threadUnavailable",
  target_changed: "review.agent.error.targetChanged",
  target_ambiguous: "review.agent.error.generic",
  apply_unavailable: "review.agent.error.applyUnavailable",
  apply_incomplete: "review.agent.error.applyIncomplete",
  apply_attempts_exhausted: "review.agent.error.generic",
  cancelled_after_edit: "review.agent.error.cancelledAfterEdit",
};

function parseTime(iso: string): number | null {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/** The agent chat thread to show for this run: the run working now, else its execution thread. */
export function reviewAgentChatThreadId(
  request: Pick<ReviewAgentRequest, "pendingSession" | "agentThreadId">,
): string | null {
  return request.pendingSession?.threadId ?? request.agentThreadId;
}

export function reviewAgentErrorTooltipKey(
  request: Pick<ReviewAgentRequest, "status" | "errorCode">,
): string | null {
  if (request.status !== "failed" && request.status !== "needs-input") {
    return null;
  }
  if (request.errorCode) return ERROR_TOOLTIP_KEYS[request.errorCode];
  // A run that ends needing input without an error is the agent asking a question.
  return request.status === "failed" ? "review.agent.error.generic" : null;
}

export function statusPresentation(
  request: ReviewAgentRequest,
): ReviewAgentStatusPresentation {
  const row = STATUS_ROWS[request.status];
  return {
    labelKey: row.labelKey,
    namesAgent: row.namesAgent,
    icon: row.icon,
    tooltipKey: reviewAgentErrorTooltipKey(request),
    canCancel: row.cancel && request.requesterIsMe,
    canOpenChat:
      row.openChat &&
      request.requesterIsMe &&
      reviewAgentChatThreadId(request) !== null,
    canRetry:
      row.retry &&
      request.requesterIsMe &&
      (request.mode !== "auto" || request.triggerCommentId !== null),
  };
}

/** The model's display name, or null when neither the run nor the submission named one. */
export function reviewAgentModelName(
  request: Pick<ReviewAgentRequest, "model" | "submitted">,
): string | null {
  const model = request.model ?? request.submitted?.model ?? null;
  return model ? modelDisplayName(model) : null;
}

interface ThreadForStatus {
  root: ReviewComment;
  replies: readonly ReviewComment[];
}

function hasHumanCommentAfter(
  thread: ThreadForStatus,
  updatedAt: string,
): boolean {
  const since = parseTime(updatedAt);
  if (since === null) return false;
  return [thread.root, ...thread.replies].some((comment) => {
    const created = parseTime(comment.createdAt);
    return comment.createdBy === "human" && created !== null && created > since;
  });
}

const FRESH_RESULT_STATUSES: readonly ReviewAgentStatus[] = [
  "replied",
  "suggested",
  "applied",
  "cancelled",
];

/** Milliseconds a finished run's status stays visible; null when it never expires by time. */
export function freshResultRemainingMs(
  request: Pick<ReviewAgentRequest, "status" | "updatedAt">,
  now: number,
): number | null {
  if (!FRESH_RESULT_STATUSES.includes(request.status)) return null;
  const updated = parseTime(request.updatedAt);
  if (updated === null) return 0;
  return Math.max(0, updated + REVIEW_AGENT_FRESH_RESULT_WINDOW_MS - now);
}

/**
 * Whether the card shows this run's status. `request` is the latest one for the
 * thread, so a newer request already supersedes a failed one.
 */
export function shouldShowStatus(
  request: ReviewAgentRequest,
  thread: ThreadForStatus,
  now: number,
): boolean {
  const remaining = freshResultRemainingMs(request, now);
  if (remaining !== null) return remaining > 0;
  if (request.status === "needs-input") {
    return !hasHumanCommentAfter(thread, request.updatedAt);
  }
  return true;
}

/** The newest request for a thread, by last update. */
export function latestReviewAgentRequest(
  requests: readonly ReviewAgentRequest[],
  threadId: string,
): ReviewAgentRequest | undefined {
  const order = (request: ReviewAgentRequest) =>
    parseTime(request.updatedAt) ?? Number.NEGATIVE_INFINITY;
  let latest: ReviewAgentRequest | undefined;
  for (const request of requests) {
    if (request.threadId !== threadId) continue;
    if (!latest || order(request) > order(latest)) latest = request;
  }
  return latest;
}

/**
 * Whether a request still holds its thread. A run stuck active past the stale
 * window does not: the server expires it on the next start, so blocking here
 * would leave nothing to trigger that.
 */
export function isReviewAgentRequestLive(
  request: Pick<ReviewAgentRequest, "status" | "updatedAt">,
  now: number,
): boolean {
  if (!isReviewAgentActive(request.status)) return false;
  const updated = parseTime(request.updatedAt);
  return updated === null || now - updated < REVIEW_AGENT_LIMITS.staleActiveMs;
}
