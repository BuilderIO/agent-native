import { describe, expect, it } from "vitest";

import {
  isRecentWorkflowGeneration,
  matchesWorkflowRequest,
  shouldScheduleWorkflowTimeoutFallback,
  shouldRetryWorkflowStop,
  WORKFLOW_STOP_MAX_ATTEMPTS,
  WORKFLOW_STOP_RETRY_DELAY_MS,
  workflowStopAttemptAfterFailure,
  workflowGenerationProgressAt,
  workflowGenerationStaleAt,
  workflowSessionTabId,
} from "./workflow.js";

describe("matchesWorkflowRequest", () => {
  it("requires both the request ID and timestamp to match", () => {
    expect(
      matchesWorkflowRequest(
        {
          requestId: "workflow-request-123",
          requestedAt: "2026-10-18T19:51:00.000Z",
        },
        {
          requestId: "workflow-request-123",
          requestedAt: "2026-10-18T19:52:00.000Z",
        },
      ),
    ).toBe(false);
  });

  it("matches requests without an ID only when the timestamp matches", () => {
    expect(
      matchesWorkflowRequest(
        { requestedAt: "2026-10-18T19:51:00.000Z" },
        { requestedAt: "2026-10-18T19:51:00.000Z" },
      ),
    ).toBe(true);
  });
});

describe("shouldRetryWorkflowStop", () => {
  it("stops retrying permanent client errors", () => {
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(shouldRetryWorkflowStop(error, 1)).toBe(false);
  });

  it("retries transient failures up to the attempt limit", () => {
    const error = Object.assign(new Error("Unavailable"), { status: 503 });
    expect(shouldRetryWorkflowStop(error, WORKFLOW_STOP_MAX_ATTEMPTS - 1)).toBe(
      true,
    );
    expect(shouldRetryWorkflowStop(error, WORKFLOW_STOP_MAX_ATTEMPTS)).toBe(
      false,
    );
    expect(shouldRetryWorkflowStop(new Error("Network unavailable"), 1)).toBe(
      true,
    );
  });
});

describe("workflowStopAttemptAfterFailure", () => {
  const attempt = {
    recordingId: "rec_123",
    requestedAt: "2026-10-18T19:51:00.000Z",
    reason: "cancelled" as const,
    failedAttempts: 0,
    exhausted: false,
    retryAt: null,
  };

  it("persists the retry deadline and failure count with the attempt", () => {
    const now = Date.parse("2026-10-18T20:00:00.000Z");
    expect(
      workflowStopAttemptAfterFailure(
        attempt,
        Object.assign(new Error("Unavailable"), { status: 503 }),
        now,
      ),
    ).toEqual({
      ...attempt,
      failedAttempts: 1,
      retryAt: now + WORKFLOW_STOP_RETRY_DELAY_MS,
    });
  });

  it("keeps permanent failures and the attempt limit exhausted", () => {
    expect(
      workflowStopAttemptAfterFailure(
        { ...attempt, failedAttempts: WORKFLOW_STOP_MAX_ATTEMPTS - 1 },
        Object.assign(new Error("Unavailable"), { status: 503 }),
      ),
    ).toEqual({
      ...attempt,
      failedAttempts: WORKFLOW_STOP_MAX_ATTEMPTS,
      exhausted: true,
      retryAt: null,
    });
  });
});

describe("workflowSessionTabId", () => {
  it("uses the same stable session id for matching requests", () => {
    expect(
      workflowSessionTabId(
        "rec_123",
        "2026-10-18T19:51:00.000Z",
        "workflow-request-123",
      ),
    ).toBe(
      "clips-workflow:rec_123:2026-10-18T19%3A51%3A00.000Z:workflow-request-123:run",
    );
  });
});

describe("isRecentWorkflowGeneration", () => {
  const now = Date.parse("2026-10-18T20:00:00.000Z");

  it("keeps a recent generation active", () => {
    expect(
      isRecentWorkflowGeneration(
        { status: "generating", requestedAt: "2026-10-18T19:51:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("allows retrying a generation after the server timeout", () => {
    expect(
      isRecentWorkflowGeneration(
        { status: "generating", requestedAt: "2026-10-18T19:50:00.000Z" },
        now,
      ),
    ).toBe(false);
  });

  it("returns the exact retry boundary for a generating workflow", () => {
    expect(
      workflowGenerationStaleAt({
        status: "generating",
        requestedAt: "2026-10-18T19:51:00.000Z",
      }),
    ).toBe(Date.parse("2026-10-18T20:01:00.000Z"));
  });

  it("does not schedule retry timers for terminal or malformed workflows", () => {
    expect(
      workflowGenerationStaleAt({ status: "failed", requestedAt: "invalid" }),
    ).toBeNull();
    expect(
      workflowGenerationStaleAt({
        status: "generating",
        requestedAt: "invalid",
      }),
    ).toBeNull();
  });

  it("keeps malformed generation timestamps active until their run is known to have ended", () => {
    expect(
      isRecentWorkflowGeneration(
        { status: "generating", requestedAt: "invalid" },
        now,
      ),
    ).toBe(true);
    expect(isRecentWorkflowGeneration({ status: "generating" }, now)).toBe(
      true,
    );
  });

  it("does not treat terminal workflows as active", () => {
    expect(
      isRecentWorkflowGeneration(
        { status: "failed", requestedAt: "2026-10-18T19:59:00.000Z" },
        now,
      ),
    ).toBe(false);
  });
});

describe("shouldScheduleWorkflowTimeoutFallback", () => {
  const workflow = {
    recordingId: "rec_123",
    requestedAt: "2026-10-18T19:51:00.000Z",
    requestId: "workflow-request-123",
  };

  it("does not replace an active cancel attempt", () => {
    expect(
      shouldScheduleWorkflowTimeoutFallback(
        Date.parse("2026-10-18T20:01:00.000Z"),
        { ...workflow, reason: "cancelled", exhausted: false },
        workflow,
      ),
    ).toBe(false);
  });

  it("allows a timeout fallback after cancel attempts are exhausted", () => {
    expect(
      shouldScheduleWorkflowTimeoutFallback(
        Date.parse("2026-10-18T20:01:00.000Z"),
        { ...workflow, reason: "cancelled", exhausted: true },
        workflow,
      ),
    ).toBe(true);
  });

  it("does not repeat an exhausted timeout attempt", () => {
    expect(
      shouldScheduleWorkflowTimeoutFallback(
        Date.parse("2026-10-18T20:01:00.000Z"),
        { ...workflow, reason: "timed_out", exhausted: true },
        workflow,
      ),
    ).toBe(false);
  });

  it("allows a timeout for a different workflow request", () => {
    expect(
      shouldScheduleWorkflowTimeoutFallback(
        Date.parse("2026-10-18T20:01:00.000Z"),
        { ...workflow, reason: "cancelled", exhausted: false },
        { ...workflow, requestId: "workflow-request-new" },
      ),
    ).toBe(true);
  });

  it("does not stop a workflow whose timestamp cannot establish a timeout", () => {
    expect(
      shouldScheduleWorkflowTimeoutFallback(null, null, {
        ...workflow,
        requestedAt: "invalid",
      }),
    ).toBe(false);
  });
});

describe("workflowGenerationProgressAt", () => {
  const requestedAt = "2026-10-18T19:59:00.000Z";

  it("reports a long-running generation after thirty seconds", () => {
    expect(
      workflowGenerationProgressAt(
        { status: "generating", requestedAt },
        Date.parse("2026-10-18T19:59:30.000Z"),
      ),
    ).toBe("still_generating");
  });

  it("marks a generation taking longer after two minutes", () => {
    expect(
      workflowGenerationProgressAt(
        { status: "generating", requestedAt },
        Date.parse("2026-10-18T20:01:00.000Z"),
      ),
    ).toBe("taking_longer");
  });

  it("does not report progress for terminal or malformed workflows", () => {
    expect(
      workflowGenerationProgressAt(
        { status: "ready", requestedAt },
        Date.parse("2026-10-18T20:01:00.000Z"),
      ),
    ).toBeNull();
    expect(
      workflowGenerationProgressAt(
        { status: "generating", requestedAt: "invalid" },
        Date.parse("2026-10-18T20:01:00.000Z"),
      ),
    ).toBeNull();
  });
});
