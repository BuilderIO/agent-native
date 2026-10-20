import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => {}),
  releaseHostedClipRecording: vi.fn(async () => ({ released: true })),
  trashRecording: vi.fn(),
  authUserId: "user-1" as string | null,
  recording: { storageMode: "hosted" as string | null } as {
    storageMode: string | null;
  } | null,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () =>
    mocks.authUserId ? { authUserId: mocks.authUserId } : null,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));
vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => (mocks.recording ? [mocks.recording] : []),
      }),
    }),
  }),
  schema: {
    recordings: { id: "recordings.id", storageMode: "recordings.storageMode" },
  },
}));
vi.mock("../server/lib/video-storage.js", () => ({
  releaseHostedClipRecording: (...args: unknown[]) =>
    mocks.releaseHostedClipRecording(...args),
}));
vi.mock("./trash-recording.js", () => ({
  default: { run: (...args: unknown[]) => mocks.trashRecording(...args) },
}));

import abandonRecordingStart from "./abandon-recording-start";

describe("abandon-recording-start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUserId = "user-1";
    mocks.recording = { storageMode: "hosted" };
    mocks.trashRecording.mockResolvedValue({
      id: "rec-1",
      trashedAt: "2026-10-20T10:00:00.000Z",
      skipped: false,
    });
  });

  it("releases the hosted allowance after confirming the start was not ready", async () => {
    const action = abandonRecordingStart as unknown as {
      run: (
        args: Record<string, unknown>,
        context?: unknown,
      ) => Promise<unknown>;
    };

    await expect(action.run({ id: "rec-1" })).resolves.toMatchObject({
      id: "rec-1",
      skipped: false,
    });
    expect(mocks.trashRecording).toHaveBeenCalledWith(
      { id: "rec-1", skipIfReady: true },
      undefined,
    );
    expect(mocks.releaseHostedClipRecording).toHaveBeenCalledWith({
      recordingId: "rec-1",
      userId: "user-1",
    });
  });

  it("keeps the hosted allowance when upload finalization won the race", async () => {
    mocks.trashRecording.mockResolvedValueOnce({
      id: "rec-1",
      trashedAt: null,
      skipped: true,
    });
    const action = abandonRecordingStart as unknown as {
      run: (
        args: Record<string, unknown>,
        context?: unknown,
      ) => Promise<unknown>;
    };

    await expect(action.run({ id: "rec-1" })).resolves.toMatchObject({
      skipped: true,
    });
    expect(mocks.releaseHostedClipRecording).not.toHaveBeenCalled();
  });

  it("does not release a hosted allowance for recordings on user storage", async () => {
    mocks.recording = { storageMode: "own" };
    const action = abandonRecordingStart as unknown as {
      run: (
        args: Record<string, unknown>,
        context?: unknown,
      ) => Promise<unknown>;
    };

    await action.run({ id: "rec-1" });
    expect(mocks.releaseHostedClipRecording).not.toHaveBeenCalled();
  });
});
