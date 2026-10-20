import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  returning: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    update: () => ({
      set: (values: unknown) => {
        mocks.set(values);
        return { where: () => ({ returning: mocks.returning }) };
      },
    }),
  }),
  schema: { recordings: { id: "id", durationMs: "durationMs" } },
}));

import action from "./set-embed-duration";

const youtubeClip = {
  id: "rec-yt",
  sourceAppName: "YouTube",
  sourceWindowTitle: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  videoUrl: "https://www.youtube.com/embed/jNQXAC9IVRw",
  durationMs: 0,
};

describe("set-embed-duration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: youtubeClip,
    });
  });

  it("stores the duration YouTube's player measured", async () => {
    mocks.returning.mockResolvedValue([{ durationMs: 19_000 }]);

    await expect(
      action.run({ recordingId: "rec-yt", durationMs: 19_000 }),
    ).resolves.toEqual({
      recordingId: "rec-yt",
      durationMs: 19_000,
      updated: true,
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec-yt",
      "editor",
    );
    expect(mocks.set).toHaveBeenCalledWith({ durationMs: 19_000 });
  });

  it("reports the stored duration when one was already recorded", async () => {
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: { ...youtubeClip, durationMs: 18_500 },
    });
    mocks.returning.mockResolvedValue([]);

    await expect(
      action.run({ recordingId: "rec-yt", durationMs: 19_000 }),
    ).resolves.toEqual({
      recordingId: "rec-yt",
      durationMs: 18_500,
      updated: false,
    });
  });

  it("refuses clips whose duration Clips measures itself", async () => {
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: { id: "rec-1", videoUrl: "https://store.example/clip.mp4" },
    });

    await expect(
      action.run({ recordingId: "rec-1", durationMs: 19_000 }),
    ).rejects.toMatchObject({ errorCode: "embed_duration_unsupported" });
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
