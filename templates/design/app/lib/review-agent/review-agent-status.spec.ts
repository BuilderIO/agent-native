import type { ReviewComment } from "@agent-native/core/review";
import {
  REVIEW_AGENT_ACTIVE_STATUSES,
  REVIEW_AGENT_STATUSES,
  type ReviewAgentErrorCode,
  type ReviewAgentStatus,
} from "@shared/review-agent";
import { describe, expect, it } from "vitest";

import {
  freshResultRemainingMs,
  isReviewAgentRequestLive,
  latestReviewAgentRequest,
  REVIEW_AGENT_FRESH_RESULT_WINDOW_MS,
  reviewAgentChatThreadId,
  reviewAgentModelName,
  shouldShowStatus,
  statusPresentation,
} from "./review-agent-status";
import {
  makePendingSession,
  makeReviewAgentRequest,
  REVIEW_AGENT_TEST_NOW,
} from "./test-review-agent-request";

const NOW = REVIEW_AGENT_TEST_NOW;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function comment(overrides: Partial<ReviewComment>): ReviewComment {
  return {
    id: "comment-1",
    resourceType: "design",
    resourceId: "design-1",
    threadId: "thread-1",
    parentCommentId: null,
    targetId: "screen-1",
    kind: "comment",
    status: "open",
    anchor: null,
    body: "Make it bigger",
    authorEmail: "sam@example.com",
    authorName: "Sam",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    ownerEmail: null,
    orgId: null,
    visibility: "private",
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedBy: null,
    deletedAt: null,
    createdAt: iso(-120_000),
    updatedAt: iso(-120_000),
    metadata: null,
    ...overrides,
  };
}

const thread = { root: comment({}), replies: [] as ReviewComment[] };

describe("statusPresentation", () => {
  const expectedLabel: Record<ReviewAgentStatus, string> = {
    classifying: "review.agent.working",
    running: "review.agent.working",
    queued: "review.agent.queued",
    replied: "review.agent.replied",
    suggested: "review.agent.suggested",
    applied: "review.agent.applied",
    "needs-input": "review.agent.needsInput",
    failed: "review.agent.failed",
    cancelled: "review.agent.cancelled",
  };

  it.each(REVIEW_AGENT_STATUSES)("labels %s", (status) => {
    const presentation = statusPresentation(makeReviewAgentRequest({ status }));
    expect(presentation.labelKey).toBe(expectedLabel[status]);
    expect(presentation.namesAgent).toBe(status !== "cancelled");
  });

  it("offers each action to the requester only where the status allows it", () => {
    const actions = (status: ReviewAgentStatus) => {
      const p = statusPresentation(makeReviewAgentRequest({ status }));
      return {
        cancel: p.canCancel,
        open: p.canOpenChat,
        retry: p.canRetry,
      };
    };
    expect(actions("classifying")).toEqual({
      cancel: true,
      open: true,
      retry: false,
    });
    expect(actions("running")).toEqual({
      cancel: true,
      open: true,
      retry: false,
    });
    expect(actions("queued")).toEqual({
      cancel: true,
      open: false,
      retry: false,
    });
    for (const status of [
      "replied",
      "suggested",
      "applied",
      "needs-input",
    ] as const) {
      expect(actions(status)).toEqual({
        cancel: false,
        open: true,
        retry: false,
      });
    }
    expect(actions("failed")).toEqual({
      cancel: false,
      open: true,
      retry: true,
    });
    expect(actions("cancelled")).toEqual({
      cancel: false,
      open: false,
      retry: false,
    });
  });

  it.each(REVIEW_AGENT_STATUSES)(
    "gives someone else's %s run no buttons",
    (status) => {
      const presentation = statusPresentation(
        makeReviewAgentRequest({
          status,
          requesterIsMe: false,
          agentThreadId: null,
          agentTurnId: null,
          triggerCommentId: null,
          submitted: null,
        }),
      );
      expect(presentation.canCancel).toBe(false);
      expect(presentation.canOpenChat).toBe(false);
      expect(presentation.canRetry).toBe(false);
    },
  );

  it("cannot retry an automatic run whose trigger comment is unknown", () => {
    expect(
      statusPresentation(
        makeReviewAgentRequest({
          status: "failed",
          mode: "auto",
          triggerCommentId: null,
        }),
      ).canRetry,
    ).toBe(false);
    expect(
      statusPresentation(
        makeReviewAgentRequest({
          status: "failed",
          mode: "suggest",
          triggerCommentId: null,
        }),
      ).canRetry,
    ).toBe(true);
  });

  it("opens the run working now: the dispatch pending, else the execution thread", () => {
    const classifying = makeReviewAgentRequest({
      status: "classifying",
      agentThreadId: "execution-thread",
      pendingSession: makePendingSession({
        phase: "classification",
        threadId: "classifier-thread",
      }),
    });
    expect(reviewAgentChatThreadId(classifying)).toBe("classifier-thread");
    expect(
      reviewAgentChatThreadId(
        makeReviewAgentRequest({ agentThreadId: "execution-thread" }),
      ),
    ).toBe("execution-thread");
    expect(
      statusPresentation(
        makeReviewAgentRequest({
          status: "running",
          agentThreadId: null,
          agentTurnId: null,
        }),
      ).canOpenChat,
    ).toBe(false);
  });

  describe("error tooltip", () => {
    const tooltip = (
      status: ReviewAgentStatus,
      errorCode: ReviewAgentErrorCode | null,
    ) =>
      statusPresentation(makeReviewAgentRequest({ status, errorCode }))
        .tooltipKey;

    it.each([
      ["engine_not_configured", "review.agent.error.engineNotConfigured"],
      ["no_result", "review.agent.error.noResult"],
      ["run_timeout", "review.agent.error.timeout"],
      ["permission_changed", "review.agent.error.permission"],
      ["thread_unavailable", "review.agent.error.threadUnavailable"],
      ["target_changed", "review.agent.error.targetChanged"],
      ["apply_unavailable", "review.agent.error.applyUnavailable"],
      ["apply_incomplete", "review.agent.error.applyIncomplete"],
      ["cancelled_after_edit", "review.agent.error.cancelledAfterEdit"],
      ["dispatch_failed", "review.agent.error.generic"],
      ["run_failed", "review.agent.error.generic"],
      ["target_ambiguous", "review.agent.error.generic"],
      ["apply_attempts_exhausted", "review.agent.error.generic"],
    ] as const)("maps %s to %s", (code, key) => {
      expect(tooltip("failed", code)).toBe(key);
      expect(tooltip("needs-input", code)).toBe(key);
    });

    it("says something went wrong for a failure without a code, and nothing for a plain question", () => {
      expect(tooltip("failed", null)).toBe("review.agent.error.generic");
      expect(tooltip("needs-input", null)).toBeNull();
    });

    it("never explains a status that is not an ending with an error", () => {
      for (const status of [
        "running",
        "replied",
        "applied",
        "cancelled",
      ] as const) {
        expect(tooltip(status, "run_failed")).toBeNull();
      }
    });
  });
});

describe("reviewAgentModelName", () => {
  it("prefers the model the run used, then the submitted one, else nothing", () => {
    expect(
      reviewAgentModelName(
        makeReviewAgentRequest({ model: "gpt-5-4", submitted: null }),
      ),
    ).toBe("GPT-5.4");
    expect(
      reviewAgentModelName(
        makeReviewAgentRequest({
          model: null,
          submitted: { provider: null, model: "claude-opus-5-5", engine: null },
        }),
      ),
    ).toBe("Claude Opus 5.5");
    expect(
      reviewAgentModelName(
        makeReviewAgentRequest({ model: null, submitted: null }),
      ),
    ).toBeNull();
  });
});

describe("shouldShowStatus", () => {
  it.each(REVIEW_AGENT_ACTIVE_STATUSES)(
    "always shows an active %s run",
    (status) => {
      const request = makeReviewAgentRequest({
        status,
        updatedAt: iso(-3 * REVIEW_AGENT_FRESH_RESULT_WINDOW_MS),
      });
      expect(shouldShowStatus(request, thread, NOW)).toBe(true);
    },
  );

  it.each(["replied", "suggested", "applied", "cancelled"] as const)(
    "shows %s only inside the fresh window",
    (status) => {
      const at = (age: number) =>
        makeReviewAgentRequest({ status, updatedAt: iso(-age) });
      expect(shouldShowStatus(at(0), thread, NOW)).toBe(true);
      expect(
        shouldShowStatus(
          at(REVIEW_AGENT_FRESH_RESULT_WINDOW_MS - 1),
          thread,
          NOW,
        ),
      ).toBe(true);
      expect(
        shouldShowStatus(at(REVIEW_AGENT_FRESH_RESULT_WINDOW_MS), thread, NOW),
      ).toBe(false);
      expect(shouldShowStatus(at(10 * 60_000), thread, NOW)).toBe(false);
    },
  );

  it("hides a finished run whose timestamp cannot be read instead of showing it forever", () => {
    expect(
      shouldShowStatus(
        makeReviewAgentRequest({ status: "replied", updatedAt: "garbage" }),
        thread,
        NOW,
      ),
    ).toBe(false);
  });

  it("keeps needs-input until a human comments after it", () => {
    const request = makeReviewAgentRequest({
      status: "needs-input",
      updatedAt: iso(-60_000),
    });
    const agentReply = comment({
      id: "agent-reply",
      createdBy: "agent",
      createdAt: iso(-30_000),
    });
    expect(
      shouldShowStatus(
        request,
        { root: thread.root, replies: [agentReply] },
        NOW,
      ),
    ).toBe(true);
    const olderHuman = comment({ id: "older", createdAt: iso(-90_000) });
    expect(
      shouldShowStatus(
        request,
        { root: thread.root, replies: [olderHuman] },
        NOW,
      ),
    ).toBe(true);
    const newerHuman = comment({ id: "newer", createdAt: iso(-10_000) });
    expect(
      shouldShowStatus(
        request,
        { root: thread.root, replies: [newerHuman] },
        NOW,
      ),
    ).toBe(false);
  });

  it("keeps a failure visible; a newer request supersedes it as the thread's latest", () => {
    expect(
      shouldShowStatus(
        makeReviewAgentRequest({
          status: "failed",
          updatedAt: iso(-60 * 60_000),
        }),
        thread,
        NOW,
      ),
    ).toBe(true);
  });
});

describe("freshResultRemainingMs", () => {
  it("counts down for a fresh finished run and is null for the rest", () => {
    expect(
      freshResultRemainingMs(
        { status: "replied", updatedAt: iso(-30_000) },
        NOW,
      ),
    ).toBe(REVIEW_AGENT_FRESH_RESULT_WINDOW_MS - 30_000);
    expect(
      freshResultRemainingMs(
        { status: "applied", updatedAt: iso(-10 * 60_000) },
        NOW,
      ),
    ).toBe(0);
    expect(
      freshResultRemainingMs({ status: "running", updatedAt: iso(0) }, NOW),
    ).toBeNull();
    expect(
      freshResultRemainingMs({ status: "failed", updatedAt: iso(0) }, NOW),
    ).toBeNull();
  });
});

describe("latestReviewAgentRequest", () => {
  it("picks the most recently updated request for the thread", () => {
    const older = makeReviewAgentRequest({
      requestId: "older",
      updatedAt: iso(-60_000),
    });
    const newer = makeReviewAgentRequest({
      requestId: "newer",
      updatedAt: iso(-1_000),
    });
    const other = makeReviewAgentRequest({
      requestId: "other-thread",
      threadId: "thread-2",
      updatedAt: iso(0),
    });
    expect(
      latestReviewAgentRequest([older, newer, other], "thread-1")?.requestId,
    ).toBe("newer");
    expect(
      latestReviewAgentRequest([older, newer, other], "thread-9"),
    ).toBeUndefined();
  });
});

describe("isReviewAgentRequestLive", () => {
  it("holds a thread only while the run is active and not stale", () => {
    const run = (status: ReviewAgentStatus, updatedAt: string) =>
      isReviewAgentRequestLive({ status, updatedAt }, NOW);
    expect(run("running", iso(-60_000))).toBe(true);
    expect(run("running", iso(-29 * 60_000))).toBe(true);
    expect(run("running", iso(-31 * 60_000))).toBe(false);
    expect(run("replied", iso(0))).toBe(false);
    // An unreadable timestamp is not evidence the run is stale.
    expect(run("queued", "garbage")).toBe(true);
  });
});
