import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => undefined),
  abortTurnByRefDurably: vi.fn(async () => "aborted" as const),
  getActiveRunForThreadAsync: vi.fn(async () => null as unknown),
  getRunStatus: vi.fn(async () => null as unknown),
  getRunTurnRef: vi.fn(async () => null as unknown),
  readAppState: vi.fn(),
  compareAndSetAppState: vi.fn(async () => true),
  compareAndSetManyAppState: vi.fn(async () => true),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
  compareAndSetAppState: (...args: unknown[]) =>
    mocks.compareAndSetAppState(...args),
  compareAndSetManyAppState: (...args: unknown[]) =>
    mocks.compareAndSetManyAppState(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));
vi.mock("@agent-native/core/server", () => ({
  abortTurnByRefDurably: (...args: unknown[]) =>
    mocks.abortTurnByRefDurably(...args),
  getActiveRunForThreadAsync: (...args: unknown[]) =>
    mocks.getActiveRunForThreadAsync(...args),
  getRunStatus: (...args: unknown[]) => mocks.getRunStatus(...args),
  getRunTurnRef: (...args: unknown[]) => mocks.getRunTurnRef(...args),
}));

import { backgroundAgentTurnIdForReceipt } from "@agent-native/core/shared";

import { workflowSessionTabId } from "../shared/workflow";
import action from "./reconcile-workflow-generation";

const requestedAt = "2026-07-14T12:00:00.000Z";
const tabId = workflowSessionTabId("rec_123", requestedAt);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.abortTurnByRefDurably.mockResolvedValue("aborted");
  mocks.getActiveRunForThreadAsync.mockResolvedValue(null);
  mocks.getRunStatus.mockResolvedValue(null);
  mocks.getRunTurnRef.mockResolvedValue(null);
  mocks.compareAndSetAppState.mockResolvedValue(true);
  mocks.compareAndSetManyAppState.mockResolvedValue(true);
});

describe("reconcile-workflow-generation", () => {
  it("persists the matching agent tab before generation starts", async () => {
    mocks.readAppState
      .mockResolvedValueOnce({
        kind: "email",
        status: "generating",
        recordingId: "rec_123",
        requestedAt,
      })
      .mockResolvedValueOnce({
        kind: "generate-workflow",
        workflowKind: "email",
        recordingId: "rec_123",
        requestedAt,
      });

    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, tracked: true });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "viewer",
    );
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({ requestedAt }),
      expect.objectContaining({ tabId, requestedAt }),
    );
  });

  it("rejects a forged session ID before reading workflow state", async () => {
    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        tabId: "another-thread",
      }),
    ).rejects.toThrow("Invalid workflow generation session");

    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("requires the request ID when timestamps collide", async () => {
    const requestId = "workflow-request-current";
    const requestTabId = workflowSessionTabId(
      "rec_123",
      requestedAt,
      requestId,
    );
    mocks.readAppState
      .mockResolvedValueOnce({
        kind: "email",
        status: "generating",
        recordingId: "rec_123",
        requestedAt,
        requestId,
      })
      .mockResolvedValueOnce({
        kind: "generate-workflow",
        workflowKind: "email",
        recordingId: "rec_123",
        requestedAt,
        requestId: "workflow-request-old",
      });

    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        requestId,
        tabId: requestTabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "newer-request" });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("rejects a matching request ID with a forged timestamp", async () => {
    const requestId = "workflow-request-current";
    const requestTabId = workflowSessionTabId(
      "rec_123",
      requestedAt,
      requestId,
    );
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt: "2026-07-14T12:01:00.000Z",
      requestId,
      tabId: requestTabId,
    });

    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        requestId,
        tabId: requestTabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "newer-request" });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not replace another tab's active claim", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId: "clips-workflow:rec_123:request:chat-other",
      claimedAt: new Date().toISOString(),
    });

    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({
      reconciled: false,
      tracked: false,
      reason: "claimed",
    });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not replace a claim with a malformed lease timestamp", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId: "clips-workflow:rec_123:request:chat-other",
      claimedAt: "not-a-date",
    });

    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({
      reconciled: false,
      tracked: false,
      reason: "claimed",
    });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("recovers an abandoned claim after its lease expires", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId: "clips-workflow:rec_123:request:chat-abandoned",
      claimedAt: "2026-07-14T11:00:00.000Z",
    });

    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, tracked: true });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({
        tabId: "clips-workflow:rec_123:request:chat-abandoned",
      }),
      expect.objectContaining({ tabId, claimedAt: expect.any(String) }),
    );
  });

  it("releases a rejected delivery claim", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
    });

    await expect(
      action.run({
        operation: "release",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, released: true });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({ tabId }),
      expect.not.objectContaining({ tabId: expect.anything() }),
    );
  });

  it("persists confirmed delivery before consuming the request", async () => {
    const request = {
      kind: "generate-workflow",
      workflowKind: "email",
      recordingId: "rec_123",
      requestedAt,
    };
    mocks.readAppState.mockResolvedValueOnce(request).mockResolvedValueOnce({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
      claimedAt: new Date().toISOString(),
    });

    await expect(
      action.run({
        operation: "mark-delivered",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, delivered: true });
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith([
      {
        key: "clips-workflow-rec_123",
        expectedValue: expect.objectContaining({ tabId }),
        nextValue: expect.objectContaining({
          tabId,
          claimedAt: expect.any(String),
        }),
      },
      {
        key: "clips-ai-request-rec_123",
        expectedValue: request,
        nextValue: expect.objectContaining({ deliveredTabId: tabId }),
      },
    ]);
  });

  it("consumes the request when generation finishes before delivery marking", async () => {
    const request = {
      kind: "generate-workflow",
      workflowKind: "email",
      recordingId: "rec_123",
      requestedAt,
    };
    mocks.readAppState.mockResolvedValueOnce(request).mockResolvedValueOnce({
      kind: "email",
      status: "ready",
      content: "Subject: Recap",
      recordingId: "rec_123",
      requestedAt,
    });

    await expect(
      action.run({
        operation: "mark-delivered",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({
      reconciled: false,
      delivered: true,
      consumed: true,
      reason: "terminal",
    });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-rec_123",
      request,
      null,
    );
  });

  it("consumes the matching request after dispatch", async () => {
    const request = {
      kind: "generate-workflow",
      workflowKind: "email",
      recordingId: "rec_123",
      requestedAt,
      deliveredTabId: tabId,
    };
    mocks.readAppState.mockResolvedValue(request);

    await expect(
      action.run({
        operation: "consume",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, consumed: true });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-rec_123",
      request,
      null,
    );
  });

  it("requires editor access before stopping when no reason is supplied", async () => {
    const denied = new Error("Forbidden");
    mocks.assertAccess.mockRejectedValueOnce(denied);

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).rejects.toBe(denied);

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "editor",
    );
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.abortTurnByRefDurably).not.toHaveBeenCalled();
  });

  it("settles a terminal viewer session without aborting its run", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
      claimedAt: new Date().toISOString(),
    });
    mocks.getActiveRunForThreadAsync.mockResolvedValue({
      status: "errored",
      inFlight: false,
      awaitingRedispatch: false,
      hasInFlightWork: false,
    });

    await expect(
      action.run({
        operation: "settle",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: true });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "viewer",
    );
    expect(mocks.getActiveRunForThreadAsync).toHaveBeenCalledWith(tabId);
    expect(mocks.abortTurnByRefDurably).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({ status: "generating", tabId }),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("leaves a session generating when no registered run proves it ended", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
      claimedAt: new Date().toISOString(),
    });

    await expect(
      action.run({
        operation: "settle",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "run-not-found" });

    expect(mocks.getActiveRunForThreadAsync).toHaveBeenCalledWith(tabId);
    expect(mocks.abortTurnByRefDurably).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("settles a terminal run from its durable record after the reconnect window", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
    });
    mocks.getRunTurnRef.mockResolvedValue({
      threadId: tabId,
      turnId: "turn-1",
    });
    mocks.getRunStatus.mockResolvedValue("errored");

    await expect(
      action.run({
        operation: "settle-terminal",
        recordingId: "rec_123",
        requestedAt,
        tabId,
        terminalRunId: "run-1",
      }),
    ).resolves.toEqual({ reconciled: true });

    expect(mocks.getRunTurnRef).toHaveBeenCalledWith("run-1");
    expect(mocks.getRunStatus).toHaveBeenCalledWith("run-1");
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({ status: "generating", tabId }),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("does not settle terminal evidence from a different workflow thread", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
    });
    mocks.getRunTurnRef.mockResolvedValue({
      threadId: "another-thread",
      turnId: "turn-1",
    });
    mocks.getRunStatus.mockResolvedValue("errored");

    await expect(
      action.run({
        operation: "settle-terminal",
        recordingId: "rec_123",
        requestedAt,
        tabId,
        terminalRunId: "run-1",
      }),
    ).resolves.toEqual({ reconciled: false, reason: "run-not-found" });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("fails and consumes a matching request after confirmed dispatch rejection", async () => {
    const state = {
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
    };
    const request = {
      kind: "generate-workflow",
      recordingId: "rec_123",
      requestedAt,
    };
    mocks.readAppState
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(request);

    await expect(
      action.run({
        operation: "reject",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: true });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "viewer",
    );
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledWith([
      {
        key: "clips-workflow-rec_123",
        expectedValue: state,
        nextValue: expect.objectContaining({
          status: "failed",
          failureReason: "session-rejected",
        }),
      },
      {
        key: "clips-ai-request-rec_123",
        expectedValue: request,
        nextValue: null,
      },
    ]);
  });

  it("keeps a rejected request while a matching run is still in progress", async () => {
    const request = {
      kind: "generate-workflow",
      recordingId: "rec_123",
      requestedAt,
    };
    mocks.readAppState
      .mockResolvedValueOnce({
        kind: "email",
        status: "generating",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      })
      .mockResolvedValueOnce(request);
    mocks.getActiveRunForThreadAsync.mockResolvedValue({
      runId: "run-1",
      status: "running",
      inFlight: true,
      awaitingRedispatch: false,
      hasInFlightWork: false,
    });

    await expect(
      action.run({
        operation: "reject",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "in-progress" });
    expect(mocks.compareAndSetManyAppState).not.toHaveBeenCalled();
  });

  it("does not accept stop reasons on viewer settle operations", async () => {
    await expect(
      action.run({
        operation: "settle",
        recordingId: "rec_123",
        requestedAt,
        tabId,
        stopReason: "cancelled",
      }),
    ).rejects.toThrow("only valid when stopping");

    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it.each([
    [
      "in flight",
      {
        status: "running",
        inFlight: true,
        awaitingRedispatch: false,
        hasInFlightWork: false,
      },
    ],
    [
      "awaiting redispatch",
      {
        status: "running",
        inFlight: false,
        awaitingRedispatch: true,
        hasInFlightWork: false,
      },
    ],
    [
      "finishing in-flight work",
      {
        status: "errored",
        inFlight: false,
        awaitingRedispatch: false,
        hasInFlightWork: true,
      },
    ],
  ])("does not settle a session while its run is %s", async (_, activeRun) => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
      claimedAt: new Date().toISOString(),
    });
    mocks.getActiveRunForThreadAsync.mockResolvedValue(activeRun);

    await expect(
      action.run({
        operation: "settle",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "in-progress" });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "viewer",
    );
    expect(mocks.abortTurnByRefDurably).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("aborts the matching workflow turn before reconciling its generation", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: true });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "editor",
    );
    expect(mocks.abortTurnByRefDurably).toHaveBeenCalledWith(
      tabId,
      backgroundAgentTurnIdForReceipt(tabId, tabId),
      "workflow-session-ended",
    );
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({ status: "generating", requestedAt, tabId }),
      expect.objectContaining({
        kind: "email",
        status: "failed",
        requestedAt,
        tabId,
      }),
    );
  });

  it("does not abort a session outside the recording's deterministic ID", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId: "arbitrary-thread",
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId: "arbitrary-thread",
      }),
    ).rejects.toThrow("Invalid workflow generation session");

    expect(mocks.abortTurnByRefDurably).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("requires editor access before stopping a shared generation", async () => {
    const denied = new Error("Forbidden");
    mocks.assertAccess.mockRejectedValueOnce(denied);

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
        stopReason: "cancelled",
      }),
    ).rejects.toBe(denied);

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "editor",
    );
    expect(mocks.readAppState).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("stops a matching generation before an agent tab claims it", async () => {
    const requestId = "workflow-request-123";
    const requestTabId = workflowSessionTabId(
      "rec_123",
      requestedAt,
      requestId,
    );
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      requestId,
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        requestId,
        tabId: requestTabId,
        stopReason: "cancelled",
      }),
    ).resolves.toEqual({ reconciled: true });

    expect(mocks.abortTurnByRefDurably).toHaveBeenCalledWith(
      requestTabId,
      backgroundAgentTurnIdForReceipt(requestTabId, requestTabId),
      "cancelled",
    );
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({ status: "generating", requestedAt }),
      expect.objectContaining({ status: "failed", failureReason: "cancelled" }),
    );
  });

  it("does not overwrite completed output", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "ready",
      content: "Subject: Recap",
      recordingId: "rec_123",
      requestedAt,
      tabId,
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "terminal" });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not fail a newer generation", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt: "2026-07-14T12:01:00.000Z",
      tabId,
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "newer-request" });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not fail a newer generation with the same timestamp", async () => {
    const requestId = "workflow-request-old";
    const newerRequestId = "workflow-request-newer";
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      requestId: newerRequestId,
      tabId: workflowSessionTabId("rec_123", requestedAt, newerRequestId),
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        requestId,
        tabId: workflowSessionTabId("rec_123", requestedAt, requestId),
      }),
    ).resolves.toEqual({ reconciled: false, reason: "newer-request" });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not overwrite output completed during reconciliation", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId,
    });
    mocks.compareAndSetAppState.mockResolvedValue(false);

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "stale" });
  });

  it("lets canonical editor cancellation ignore a stale session claim", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId: "arbitrary-thread",
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: true });
    expect(mocks.abortTurnByRefDurably).toHaveBeenCalledWith(
      tabId,
      backgroundAgentTurnIdForReceipt(tabId, tabId),
      "workflow-session-ended",
    );
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({ tabId: "arbitrary-thread" }),
      expect.objectContaining({ status: "failed" }),
    );
  });
  it("consumes the matching request when tracking a finished workflow", async () => {
    const request = {
      kind: "generate-workflow",
      workflowKind: "email",
      recordingId: "rec_123",
      requestedAt,
    };
    mocks.readAppState
      .mockResolvedValueOnce({
        kind: "email",
        status: "failed",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      })
      .mockResolvedValueOnce(request);

    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({
      reconciled: false,
      tracked: false,
      consumed: true,
      reason: "terminal",
    });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-rec_123",
      request,
      null,
    );
  });

  it("leaves a newer request queued when tracking a finished workflow", async () => {
    mocks.readAppState
      .mockResolvedValueOnce({
        kind: "email",
        status: "ready",
        recordingId: "rec_123",
        requestedAt,
      })
      .mockResolvedValueOnce({
        kind: "generate-workflow",
        recordingId: "rec_123",
        requestedAt: "2026-07-14T12:05:00.000Z",
      });

    await expect(
      action.run({
        operation: "track",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toMatchObject({ tracked: false, consumed: true });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not consume anything for non-track operations on a finished workflow", async () => {
    mocks.readAppState.mockResolvedValueOnce({
      kind: "email",
      status: "failed",
      recordingId: "rec_123",
      requestedAt,
      tabId,
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "terminal" });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });
});
