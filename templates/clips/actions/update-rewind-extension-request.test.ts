import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  compare: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: vi.fn(async () => mocks.current),
  compareAndSetAppState: (...args: unknown[]) => mocks.compare(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));
vi.mock("./request-rewind-extension.js", () => ({
  rewindExtensionKey: (recordingId: string) =>
    `rewind-extension-request-${recordingId}`,
}));

import action from "./update-rewind-extension-request";

const applying = {
  requestId: "request-1",
  recordingId: "recording-1",
  preRollRecordingId: "pre-roll-1",
  status: "applying",
  requestedAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
};

beforeEach(() => {
  mocks.current = { ...applying, status: "ready" };
  mocks.compare.mockReset().mockImplementation(async (_key, expected, next) => {
    if (mocks.current !== expected) return false;
    mocks.current = next;
    return true;
  });
  mocks.assertAccess.mockReset().mockResolvedValue(undefined);
});

describe("update-rewind-extension-request", () => {
  it("does not downgrade a request already applying", async () => {
    mocks.current = { ...applying };

    await expect(
      action.run({
        recordingId: "recording-1",
        requestId: "request-1",
        status: "failed",
        error: "late worker failure",
      }),
    ).resolves.toEqual(applying);
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("returns the applied state when a stale failure loses its compare-and-set", async () => {
    const ready = { ...applying, status: "ready" };
    const applied = { ...applying, status: "applied" };
    mocks.current = ready;
    mocks.compare.mockImplementationOnce(async () => {
      mocks.current = applied;
      return false;
    });

    await expect(
      action.run({
        recordingId: "recording-1",
        requestId: "request-1",
        status: "failed",
        error: "late worker failure",
      }),
    ).resolves.toEqual(applied);
    expect(mocks.compare).toHaveBeenCalledTimes(1);
  });
});
