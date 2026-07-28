import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => undefined),
  readAppState: vi.fn(),
  compareAndSetAppState: vi.fn(async () => true),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
  compareAndSetAppState: (...args: unknown[]) =>
    mocks.compareAndSetAppState(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

import action from "./reconcile-workflow-generation";

const requestedAt = "2026-07-14T12:00:00.000Z";
const tabId = "clips-workflow:rec_123:request:chat-123";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.compareAndSetAppState.mockResolvedValue(true);
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
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({ requestedAt }),
      expect.objectContaining({ tabId, requestedAt }),
    );
  });

  it("persists confirmed delivery before consuming the request", async () => {
    const request = {
      kind: "generate-workflow",
      workflowKind: "email",
      recordingId: "rec_123",
      requestedAt,
    };
    mocks.readAppState.mockResolvedValue(request);

    await expect(
      action.run({
        operation: "mark-delivered",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, delivered: true });
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-ai-request-rec_123",
      request,
      expect.objectContaining({ deliveredTabId: tabId }),
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

  it("fails the matching generation when its agent run ends", async () => {
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
      "viewer",
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

  it("does not fail a different agent run", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
      tabId: "clips-workflow:rec_123:request:chat-newer",
    });

    await expect(
      action.run({
        operation: "stop",
        recordingId: "rec_123",
        requestedAt,
        tabId,
      }),
    ).resolves.toEqual({ reconciled: false, reason: "different-run" });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });
});
