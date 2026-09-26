import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => undefined),
  compareAndSetAppState: vi.fn(async () => true),
  readAppState: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: (...args: unknown[]) =>
    mocks.compareAndSetAppState(...args),
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

import action from "./complete-workflow";

const requestedAt = "2026-09-25T12:00:00.000Z";
const requestId = "workflow-request-current";
const content = "Subject: Clip summary\n\nHello team.";
const generating = {
  kind: "email",
  status: "generating",
  recordingId: "rec_1",
  requestedAt,
  requestId,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.compareAndSetAppState.mockResolvedValue(true);
});

describe("complete-workflow", () => {
  it("saves and verifies the matching generated workflow", async () => {
    mocks.readAppState.mockResolvedValueOnce(generating).mockResolvedValueOnce({
      ...generating,
      status: "ready",
      content,
      completedAt: "2026-09-25T12:01:00.000Z",
    });

    await expect(
      action.run({ recordingId: "rec_1", requestedAt, requestId, content }),
    ).resolves.toEqual({
      saved: true,
      recordingId: "rec_1",
      requestedAt,
      requestId,
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_1",
      "viewer",
    );
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "clips-workflow-rec_1",
      generating,
      expect.objectContaining({ status: "ready", content }),
    );
  });

  it("rejects a stale request without overwriting newer work", async () => {
    mocks.readAppState.mockResolvedValueOnce({
      ...generating,
      requestId: "workflow-request-newer",
    });

    await expect(
      action.run({ recordingId: "rec_1", requestedAt, requestId, content }),
    ).rejects.toThrow("replaced by a newer request");
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("treats an identical completed retry as saved", async () => {
    mocks.readAppState.mockResolvedValueOnce({
      ...generating,
      status: "ready",
      content,
    });

    await expect(
      action.run({ recordingId: "rec_1", requestedAt, requestId, content }),
    ).resolves.toEqual({
      saved: true,
      recordingId: "rec_1",
      requestedAt,
      requestId,
      alreadySaved: true,
    });
    expect(mocks.compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("accepts a matching completion that wins the compare-and-set race", async () => {
    mocks.compareAndSetAppState.mockResolvedValueOnce(false);
    mocks.readAppState
      .mockResolvedValueOnce(generating)
      .mockResolvedValueOnce({ ...generating, status: "ready", content });

    await expect(
      action.run({ recordingId: "rec_1", requestedAt, requestId, content }),
    ).resolves.toEqual({
      saved: true,
      recordingId: "rec_1",
      requestedAt,
      requestId,
      alreadySaved: true,
    });
  });

  it("accepts a legacy request state without a request ID", async () => {
    const legacyGenerating = {
      kind: "email",
      status: "generating",
      recordingId: "rec_1",
      requestedAt,
    };
    mocks.readAppState
      .mockResolvedValueOnce(legacyGenerating)
      .mockResolvedValueOnce({ ...legacyGenerating, status: "ready", content });

    await expect(
      action.run({ recordingId: "rec_1", requestedAt, content }),
    ).resolves.toEqual({ saved: true, recordingId: "rec_1", requestedAt });
  });
});
