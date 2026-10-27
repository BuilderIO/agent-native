import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bumpChangeVersion: vi.fn(),
  callAction: vi.fn(),
  getChangeVersion: vi.fn(() => 0),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  bumpChangeVersion: (...args: unknown[]) => mocks.bumpChangeVersion(...args),
  callAction: (...args: unknown[]) => mocks.callAction(...args),
  getChangeVersion: mocks.getChangeVersion,
  useChangeVersion: vi.fn(() => 0),
  useActionQuery: vi.fn(() => ({ data: undefined })),
}));

import {
  notifyAiRequestQueued,
  nextAutoTitleFallbackDelay,
  retryWorkflowAction,
  WORKFLOW_ACTION_MAX_ATTEMPTS,
} from "./use-auto-title";

describe("notifyAiRequestQueued", () => {
  it("wakes the bridge through the AI request refresh signal", () => {
    notifyAiRequestQueued("rec_123");

    expect(mocks.bumpChangeVersion).toHaveBeenCalledWith(
      "app-state:refresh-signal",
      expect.any(Number),
    );
  });
});

describe("retryWorkflowAction", () => {
  const request = {
    operation: "stop",
    recordingId: "rec_123",
    requestedAt: "2026-07-11T12:00:00.000Z",
    tabId: "clips-workflow:rec_123:test",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.callAction.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries transient failures and returns success", async () => {
    mocks.callAction
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValue({ reconciled: true });

    const result = retryWorkflowAction(request, "reconciled");
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe(true);
    expect(mocks.callAction).toHaveBeenCalledTimes(3);
  });

  it("stops after the maximum number of failed attempts", async () => {
    mocks.callAction.mockRejectedValue(new Error("Network unavailable"));

    const result = retryWorkflowAction(request, "reconciled");
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe(false);
    expect(mocks.callAction).toHaveBeenCalledTimes(
      WORKFLOW_ACTION_MAX_ATTEMPTS,
    );
  });

  it("does not retry permanent action results", async () => {
    mocks.callAction.mockResolvedValue({
      reconciled: false,
      reason: "missing",
    });

    await expect(retryWorkflowAction(request, "reconciled")).resolves.toBe(
      false,
    );
    expect(mocks.callAction).toHaveBeenCalledOnce();
  });
});

describe("nextAutoTitleFallbackDelay", () => {
  const now = Date.parse("2026-07-11T12:02:00.000Z");
  const candidate = { id: "rec_123", createdAt: "2026-07-11T12:01:00.000Z" };

  it("schedules one wake-up when a fallback becomes eligible", () => {
    expect(nextAutoTitleFallbackDelay([candidate], new Set(), now)).toBe(
      60_000,
    );
  });

  it("runs an overdue fallback immediately", () => {
    expect(
      nextAutoTitleFallbackDelay(
        [{ ...candidate, createdAt: "2026-07-11T11:59:00.000Z" }],
        new Set(),
        now,
      ),
    ).toBe(0);
  });

  it("does not schedule work for dispatched fallbacks", () => {
    expect(
      nextAutoTitleFallbackDelay(
        [candidate],
        new Set(["rec_123:fallback"]),
        now,
      ),
    ).toBeNull();
  });
});
