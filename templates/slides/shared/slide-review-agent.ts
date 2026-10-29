import { z } from "zod";

/** Scope type a request's background session runs under. */
export const SLIDE_REVIEW_AGENT_SCOPE = "slides-review-agent";

/**
 * Agent thread ids carry this reserved prefix, so the tool surface can tell a
 * request's thread apart from an ordinary chat without a lookup.
 */
export const SLIDE_REVIEW_AGENT_THREAD_PREFIX = "slides-review-agent-";

export const SLIDE_REVIEW_AGENT_USAGE_LABEL = "slides:review-agent";

export const SLIDE_REVIEW_AGENT_STATUSES = [
  "queued",
  "running",
  "replied",
  "applied",
  "needs-input",
  "failed",
  "cancelled",
] as const;
export type SlideReviewAgentStatus =
  (typeof SLIDE_REVIEW_AGENT_STATUSES)[number];

export const SLIDE_REVIEW_AGENT_ACTIVE_STATUSES = [
  "queued",
  "running",
] as const satisfies readonly SlideReviewAgentStatus[];

export function isSlideReviewAgentActive(
  status: SlideReviewAgentStatus,
): boolean {
  return (SLIDE_REVIEW_AGENT_ACTIVE_STATUSES as readonly string[]).includes(
    status,
  );
}

/**
 * Every tool a review-agent run may call. It reads its thread, edits slides
 * with the ordinary slide actions, and finishes with exactly one of the two
 * finishing actions. Nothing outside this list exists for the run.
 */
export const SLIDE_REVIEW_AGENT_ALLOWED_ACTIONS = [
  "get-review-agent-context",
  "get-deck",
  "update-slide",
  "patch-deck",
  "add-slide",
  "get-layout-overflows",
  "audit-contrast",
  "post-review-agent-reply",
  "apply-review-agent-changes",
] as const;

export const slideReviewAgentSessionSchema = z.object({
  operationId: z.string(),
  threadId: z.string(),
  turnId: z.string(),
  scope: z.object({ type: z.string(), id: z.string() }),
  actionScope: z.object({ kind: z.string(), requestId: z.string() }),
  message: z.string(),
  instructions: z.string(),
  model: z.string().optional(),
  engine: z.string().optional(),
  usageLabel: z.string(),
});
export type SlideReviewAgentSession = z.infer<
  typeof slideReviewAgentSessionSchema
>;

export const slideReviewAgentRequestSchema = z.object({
  requestId: z.string(),
  deckId: z.string(),
  threadId: z.string(),
  slideId: z.string().nullable(),
  status: z.enum(SLIDE_REVIEW_AGENT_STATUSES),
  agentName: z.string(),
  mine: z.boolean(),
  /** The agent's chat thread; the requester's alone. */
  agentThreadId: z.string().nullable(),
  replyCommentId: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The background session to dispatch; only for the requester's active request. */
  session: slideReviewAgentSessionSchema.nullable(),
});
export type SlideReviewAgentRequest = z.infer<
  typeof slideReviewAgentRequestSchema
>;
