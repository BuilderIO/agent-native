import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => undefined),
  readAppState: vi.fn(),
  writeAppState: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

import action from "./reconcile-workflow-generation";

const requestedAt = "2026-07-14T12:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconcile-workflow-generation", () => {
  it("fails the matching generation when its agent run ends", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt,
    });

    await expect(
      action.run({ recordingId: "rec_123", requestedAt }),
    ).resolves.toEqual({ reconciled: true });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_123",
      "viewer",
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_123",
      expect.objectContaining({
        kind: "email",
        status: "failed",
        requestedAt,
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
    });

    await expect(
      action.run({ recordingId: "rec_123", requestedAt }),
    ).resolves.toEqual({ reconciled: false, reason: "terminal" });
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("does not fail a newer generation", async () => {
    mocks.readAppState.mockResolvedValue({
      kind: "email",
      status: "generating",
      recordingId: "rec_123",
      requestedAt: "2026-07-14T12:01:00.000Z",
    });

    await expect(
      action.run({ recordingId: "rec_123", requestedAt }),
    ).resolves.toEqual({ reconciled: false, reason: "newer-request" });
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });
});
