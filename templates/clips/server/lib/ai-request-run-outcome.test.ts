import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSettle = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../../actions/lib/ai-request-status.js", () => ({
  settleAiRequestStatus: mockSettle,
}));

import { aiRequestTabId } from "../../shared/ai-request-status.js";
import { settleAiRequestRunOutcome } from "./ai-request-run-outcome.js";

const requestedAt = "2026-10-08T12:00:00.000Z";
const identity = {
  recordingId: "rec_1",
  kind: "remove-filler-words" as const,
  requestedAt,
};
const threadId = aiRequestTabId(identity.recordingId, identity.kind, requestedAt);

describe("settleAiRequestRunOutcome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores threads that are not AI requests", async () => {
    await settleAiRequestRunOutcome(
      { threadId: "thread-1", status: "errored", events: [] },
      { turnContinues: false },
    );
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("waits for the turn to finish across continuations", async () => {
    await settleAiRequestRunOutcome(
      { threadId, status: "completed", events: [] },
      { turnContinues: true },
    );
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("reports a truncated run as failed, not completed", async () => {
    await settleAiRequestRunOutcome(
      { threadId, status: "truncated", events: [] },
      { turnContinues: false },
    );
    expect(mockSettle).toHaveBeenCalledWith(
      identity,
      "failed",
      "The agent run stopped before finishing.",
    );
  });

  it("carries the run's error message", async () => {
    await settleAiRequestRunOutcome(
      {
        threadId,
        status: "errored",
        events: [{ event: { type: "error", error: "Provider unavailable" } }],
      },
      { turnContinues: false },
    );
    expect(mockSettle).toHaveBeenCalledWith(
      identity,
      "failed",
      "Provider unavailable",
    );
  });

  it("marks a stopped run cancelled", async () => {
    await settleAiRequestRunOutcome(
      { threadId, status: "aborted", abortReason: "user", events: [] },
      { turnContinues: false },
    );
    expect(mockSettle).toHaveBeenCalledWith(identity, "cancelled", "user");
  });

  it("flags a completed run that never reported its result", async () => {
    await settleAiRequestRunOutcome(
      { threadId, status: "completed", events: [] },
      { turnContinues: false },
    );
    expect(mockSettle).toHaveBeenCalledWith(
      identity,
      "failed",
      expect.stringContaining("without reporting a result"),
    );
  });
});
