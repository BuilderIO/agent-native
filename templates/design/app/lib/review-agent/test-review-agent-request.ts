import type {
  ReviewAgentPendingSession,
  ReviewAgentRequest,
} from "@shared/review-agent";

export const REVIEW_AGENT_TEST_NOW = Date.parse("2026-10-27T12:00:00.000Z");

export function makePendingSession(
  overrides: Partial<ReviewAgentPendingSession> = {},
): ReviewAgentPendingSession {
  return {
    phase: "execution",
    operationId: "request-1",
    threadId: "design-review-agent-1",
    turnId: "turn-1",
    scope: { type: "design-review-agent", id: "request-1" },
    actionScope: { kind: "design-review-agent", requestId: "request-1" },
    message: "Reply in thread: Make it bigger",
    instructions: "You are answering a design review comment.",
    model: "claude-sonnet-5-5",
    engine: "anthropic",
    usageLabel: "design:review-agent",
    ...overrides,
  };
}

export function makeReviewAgentRequest(
  overrides: Partial<ReviewAgentRequest> = {},
): ReviewAgentRequest {
  return {
    requestId: "request-1",
    designId: "design-1",
    threadId: "thread-1",
    rootCommentId: "comment-1",
    screenId: "screen-1",
    mode: "auto",
    intent: "reply",
    status: "running",
    requesterIsMe: true,
    model: "claude-sonnet-5-5",
    engine: "anthropic",
    result: null,
    errorCode: null,
    error: null,
    createdAt: "2026-10-27T11:59:00.000Z",
    updatedAt: "2026-10-27T11:59:30.000Z",
    instructions: "Make it bigger",
    triggerCommentId: "comment-1",
    submitted: {
      provider: "Anthropic",
      model: "claude-sonnet-5-5",
      engine: "anthropic",
    },
    agentThreadId: "design-review-agent-1",
    agentTurnId: "turn-1",
    pendingSession: null,
    ...overrides,
  };
}
