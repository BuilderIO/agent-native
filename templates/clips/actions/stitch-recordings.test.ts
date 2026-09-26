import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sourceRows: [] as Array<Record<string, unknown>>,
  insertValues: vi.fn(async () => undefined),
  writeAppState: vi.fn(async () => undefined),
  dispatchPostFinalizeJob: vi.fn(async () => undefined),
  getCurrentAuthUserId: vi.fn(),
  getCurrentOwnerEmail: vi.fn(),
  getDefaultRecordingVisibility: vi.fn(),
  track: vi.fn(),
  recordingTrackingSource: vi.fn(
    (userId: string, authUserId?: string | null) => ({
      userId,
      ...(authUserId ? { authUserId } : {}),
    }),
  ),
}));

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => mocks.sourceRows),
    })),
  })),
  insert: vi.fn(() => ({
    values: (...args: unknown[]) => mocks.insertValues(...args),
  })),
};

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));
vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mocks.track(...args),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
    },
  },
}));
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mocks.dispatchPostFinalizeJob(...args),
}));
vi.mock("../server/lib/recording-failures.js", () => ({
  recordingTrackingSource: (...args: [string, string?]) =>
    mocks.recordingTrackingSource(...args),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentAuthUserId: (...args: unknown[]) =>
    mocks.getCurrentAuthUserId(...args),
  getCurrentOwnerEmail: (...args: unknown[]) =>
    mocks.getCurrentOwnerEmail(...args),
  getDefaultRecordingVisibility: (...args: unknown[]) =>
    mocks.getDefaultRecordingVisibility(...args),
  ownerEmailMatches: (...args: unknown[]) => ({ ownerEmailMatches: args }),
}));
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  isS3ObjectUrlBoundToRecording: vi.fn(async () => true),
}));
vi.mock("./lib/native-media.js", () => ({
  assertNativeRecordingMedia: vi.fn(),
}));

import action from "./stitch-recordings.js";

describe("stitch-recordings schema", () => {
  const sourceRecordingIds = ["recording-one", "recording-two"];

  it("keeps recordingId optional for existing action callers", () => {
    const parsed = action.schema.parse({ sourceRecordingIds });

    expect(parsed.recordingId).toBeUndefined();
  });

  it("accepts a pre-reserved recordingId for recording-bound uploads", () => {
    const parsed = action.schema.parse({
      recordingId: "reserved-recording-id",
      sourceRecordingIds,
    });

    expect(parsed.recordingId).toBe("reserved-recording-id");
  });
});

describe("stitch-recordings readiness tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sourceRows = [
      {
        id: "recording-one",
        organizationId: "org-1",
        ownerEmail: "owner@example.com",
        durationMs: 5_000,
        width: 1280,
        height: 720,
        hasAudio: true,
        hasCamera: false,
        thumbnailUrl: "https://cdn.example.com/thumbnail.jpg",
      },
      {
        id: "recording-two",
        organizationId: "org-1",
        ownerEmail: "owner@example.com",
        durationMs: 7_000,
        width: 1920,
        height: 1080,
        hasAudio: false,
        hasCamera: true,
        thumbnailUrl: null,
      },
    ];
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.dispatchPostFinalizeJob.mockResolvedValue(undefined);
    mocks.getCurrentAuthUserId.mockReturnValue("auth-user-1");
    mocks.getCurrentOwnerEmail.mockReturnValue("owner@example.com");
    mocks.getDefaultRecordingVisibility.mockResolvedValue("private");
  });

  it("emits recording_ready once after a ready stitched recording is inserted", async () => {
    mocks.track.mockImplementationOnce(() => {
      throw new Error("analytics unavailable");
    });

    const result = await action.run(
      {
        recordingId: "stitched-1",
        sourceRecordingIds: ["recording-one", "recording-two"],
        videoUrl: "https://cdn.example.com/stitched.mp4",
        durationMs: 12_000,
      },
      { userEmail: "owner@example.com" },
    );

    expect(result).toMatchObject({ id: "stitched-1", status: "ready" });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "stitched-1",
        authUserId: "auth-user-1",
        status: "ready",
      }),
    );
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(
      "recording_ready",
      {
        app_name: "clips",
        template_name: "clips",
        output_id: "stitched-1",
        output_type: "clip",
        recording_attempt_id: "stitched-1",
        duration_s: 12,
        video_format: "mp4",
        has_audio: true,
        has_camera: true,
        width: 1920,
        height: 1080,
      },
      { userId: "owner@example.com", authUserId: "auth-user-1" },
    );
    expect(mocks.track.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.insertValues.mock.invocationCallOrder[0],
    );
  });

  it("does not emit ready for a stitched recording awaiting upload", async () => {
    const result = await action.run(
      {
        recordingId: "stitched-pending",
        sourceRecordingIds: ["recording-one", "recording-two"],
      },
      { userEmail: "owner@example.com" },
    );

    expect(result).toMatchObject({
      id: "stitched-pending",
      status: "processing",
    });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing", videoUrl: null }),
    );
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("does not emit ready when persistence fails", async () => {
    mocks.insertValues.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      action.run(
        {
          recordingId: "stitched-failed",
          sourceRecordingIds: ["recording-one", "recording-two"],
          videoUrl: "https://cdn.example.com/stitched.mp4",
        },
        { userEmail: "owner@example.com" },
      ),
    ).rejects.toThrow("database unavailable");
    expect(mocks.track).not.toHaveBeenCalled();
  });
});
