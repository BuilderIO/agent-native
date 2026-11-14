import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  appState: [] as Array<{ key: string; value: unknown }>,
  jobs: [] as Array<Record<string, unknown>>,
  dispatched: [] as string[],
  sources: [] as Array<Record<string, unknown>>,
  ffmpeg: true,
  provider: { id: "s3" } as { id: string } | null,
  queueFull: null as "owner" | "total" | null,
  dispatchFails: false,
  refreshFails: false,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: async (key: string, value: unknown) => {
    if (key === "refresh-signal" && state.refreshFails) {
      throw new Error("app state unavailable");
    }
    state.appState.push({ key, value });
  },
}));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: async () => state.provider,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org_1",
}));

vi.mock("../server/db/index.js", () => {
  const insert = () => ({
    values: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
  });
  return {
    getDb: () => ({
      insert,
      transaction: async (work: (tx: unknown) => Promise<void>) => {
        // Rolls back what the work inserted when it throws, like a real one.
        const before = state.inserted.length;
        try {
          await work({ insert });
        } catch (error) {
          state.inserted.length = before;
          throw error;
        }
      },
    }),
    schema: { recordings: {} },
  };
});

vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: vi.fn(async () => {}),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  getDefaultRecordingVisibility: async () => "org",
}));

vi.mock("../server/lib/s3-upload-provider.js", () => ({
  isS3ObjectUrlBoundToRecording: async () => true,
}));

vi.mock("../server/lib/video-remux.js", () => ({
  isFfmpegAvailable: () => state.ffmpeg,
}));

vi.mock("../server/lib/stitch-job-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/stitch-job-store.js")
  >("../server/lib/stitch-job-store.js");
  return {
    ...actual,
    assertStitchCapacity: async () => {
      if (state.queueFull) {
        throw new actual.StitchQueueFullError(state.queueFull);
      }
    },
    insertStitchJob: async (input: Record<string, unknown>) => {
      state.jobs.push(input);
    },
  };
});

vi.mock("../server/lib/stitch-job.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/stitch-job.js")
  >("../server/lib/stitch-job.js");
  return {
    StitchLimitError: actual.StitchLimitError,
    parseSourceRecordingIds: actual.parseSourceRecordingIds,
    isFfprobeAvailable: () => state.ffmpeg,
    loadOwnedStitchSources: async (ids: string[]) => {
      if (ids.length < 2) {
        throw new Error(
          "stitch-recordings needs at least 2 sourceRecordingIds",
        );
      }
      return ids.map((id) => {
        const source = state.sources.find((s) => s.id === id);
        if (!source) throw new Error("Not all source recordings were found");
        return source;
      });
    },
    dispatchStitchJob: async (recordingId: string) => {
      if (state.dispatchFails) throw new Error("worker unreachable");
      state.dispatched.push(recordingId);
    },
  };
});

import action from "./stitch-recordings.js";

function source(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: "org_1",
    title: id,
    durationMs: 60_000,
    width: 1280,
    height: 720,
    hasAudio: true,
    hasCamera: false,
    thumbnailUrl: `https://cdn.example.com/clips/thumb-${id}/t.jpg`,
    ...extra,
  };
}

beforeEach(() => {
  state.inserted = [];
  state.appState = [];
  state.jobs = [];
  state.dispatched = [];
  state.ffmpeg = true;
  state.provider = { id: "s3" };
  state.queueFull = null;
  state.dispatchFails = false;
  state.refreshFails = false;
  state.sources = [
    source("recording-one"),
    source("recording-two", { width: 1920, height: 1080, hasAudio: false }),
  ];
});

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

describe("stitch-recordings run (server stitch)", () => {
  it("creates a processing recording with a durable job and dispatches it", async () => {
    const result = await action.run(
      {
        title: "Combined",
        sourceRecordingIds: ["recording-one", "recording-two"],
      } as never,
      undefined as never,
    );

    expect(result.status).toBe("processing");
    expect(result.sourceRecordingIds).toEqual([
      "recording-one",
      "recording-two",
    ]);
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0];
    expect(row).toMatchObject({
      id: result.id,
      title: "Combined",
      status: "processing",
      videoUrl: null,
      ownerEmail: "owner@example.com",
      visibility: "org",
      width: 1920,
      height: 1080,
      durationMs: 120_000,
      thumbnailUrl: null,
      storageMode: "own",
    });
    expect(JSON.parse(String(row.editsJson)).stitchedFrom).toEqual([
      "recording-one",
      "recording-two",
    ]);
    expect(state.jobs).toEqual([
      {
        recordingId: result.id,
        ownerEmail: "owner@example.com",
        orgId: "org_1",
        sourceRecordingIds: ["recording-one", "recording-two"],
        storageProviderId: "s3",
      },
    ]);
    expect(state.dispatched).toEqual([result.id]);
  });

  it("keeps the recording and its job when the dispatch is lost", async () => {
    state.dispatchFails = true;
    state.refreshFails = true;
    const result = await action.run(
      { sourceRecordingIds: ["recording-one", "recording-two"] } as never,
      undefined as never,
    );
    // The recovery sweep dispatches the queued job later.
    expect(result.status).toBe("processing");
    expect(state.inserted).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.dispatched).toHaveLength(0);
  });

  it("refuses a stitch over the queue limit before creating anything", async () => {
    state.queueFull = "owner";
    await expect(
      action.run(
        { sourceRecordingIds: ["recording-one", "recording-two"] } as never,
        undefined as never,
      ),
    ).rejects.toMatchObject({
      errorCode: "stitch_queue_full",
      statusCode: 429,
    });
    expect(state.inserted).toHaveLength(0);
    expect(state.jobs).toHaveLength(0);
    expect(state.dispatched).toHaveLength(0);
  });

  it("leaves hosted-only accounts on the browser stitch", async () => {
    state.provider = null;
    // The editor falls back to the browser stitch on this message.
    await expect(
      action.run(
        { sourceRecordingIds: ["recording-one", "recording-two"] } as never,
        undefined as never,
      ),
    ).rejects.toThrow(/not available on this server/);
    expect(state.inserted).toHaveLength(0);
    expect(state.jobs).toHaveLength(0);
  });

  it("accepts the ids as a JSON string", async () => {
    await action.run(
      { sourceRecordingIds: '["recording-two","recording-one"]' } as never,
      undefined as never,
    );
    expect(state.jobs[0]?.sourceRecordingIds).toEqual([
      "recording-two",
      "recording-one",
    ]);
  });

  it("still creates a ready recording when given a combined videoUrl", async () => {
    const result = await action.run(
      {
        recordingId: "reserved-recording-id",
        sourceRecordingIds: ["recording-one", "recording-two"],
        videoUrl: "https://cdn.example.com/clips/reserved-recording-id.mp4",
      } as never,
      undefined as never,
    );
    expect(result.status).toBe("ready");
    expect(state.inserted[0]).toMatchObject({
      status: "ready",
      videoUrl: "https://cdn.example.com/clips/reserved-recording-id.mp4",
    });
    expect(state.jobs).toHaveLength(0);
    expect(state.dispatched).toHaveLength(0);
  });

  it("refuses before creating anything when ffmpeg is missing", async () => {
    state.ffmpeg = false;
    await expect(
      action.run(
        { sourceRecordingIds: ["recording-one", "recording-two"] } as never,
        undefined as never,
      ),
    ).rejects.toThrow(/ffmpeg/);
    expect(state.inserted).toHaveLength(0);
    expect(state.jobs).toHaveLength(0);
  });

  it("refuses fewer than two sources", async () => {
    await expect(
      action.run(
        { sourceRecordingIds: ["recording-one"] } as never,
        undefined as never,
      ),
    ).rejects.toThrow(/at least 2/);
    expect(state.inserted).toHaveLength(0);
  });
});
