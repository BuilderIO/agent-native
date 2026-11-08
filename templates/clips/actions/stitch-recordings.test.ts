import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  appState: [] as Array<{ key: string; value: unknown }>,
  jobs: [] as Array<Record<string, unknown>>,
  sources: [] as Array<Record<string, unknown>>,
  ffmpeg: true,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: async (key: string, value: unknown) => {
    state.appState.push({ key, value });
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org_1",
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
      },
    }),
  }),
  schema: { recordings: {} },
}));

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

vi.mock("../server/lib/stitch-job.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/stitch-job.js")
  >("../server/lib/stitch-job.js");
  return {
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
    startStitchJob: (input: Record<string, unknown>) => {
      state.jobs.push(input);
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
  state.ffmpeg = true;
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
  it("creates a processing recording at once and starts the server job", async () => {
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
      },
    ]);
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
