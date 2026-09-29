import { beforeEach, describe, expect, it, vi } from "vitest";

const recording = vi.hoisted(() => ({
  id: "rec_1",
  title: "Test recording",
  kind: "video" as string,
  ownerEmail: "owner@example.com",
  videoUrl: "https://cdn.example.com/media/clips/rec_1.webm",
  videoFormat: "webm" as string,
  durationMs: 10_000,
  thumbnailUrl: "https://cdn.example.com/media/clips/rec_1.jpg",
  animatedThumbnailUrl: "https://cdn.example.com/media/clips/rec_1.gif",
  filmstripUrl: "https://cdn.example.com/media/clips/rec_1-strip.jpg",
  editsJson: JSON.stringify({
    version: 1,
    trims: [{ id: "cut-1", startMs: 1_000, endMs: 2_000, excluded: true }],
    blurs: [],
    overlays: [
      {
        id: "redact-1",
        kind: "redact",
        style: "solid",
        startMs: 2_000,
        endMs: 5_000,
        keys: [{ atMs: 2_000, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
      },
    ],
  }),
}));

const state = vi.hoisted(() => ({
  updated: [] as Array<Record<string, unknown>>,
  updateReturns: [{ id: "rec_1" }] as Array<{ id: string }>,
  deleted: [] as string[],
  deleteFails: new Set<string>(),
  deletedAppState: [] as string[],
  ffmpegRuns: 0,
  uploadUrl: "https://cdn.example.com/media/clips/rec_1.mp4" as string | null,
  burnedDurationMs: 10_000 as number | null,
  probedDurationMs: 10_000 as number | null,
  ffmpegArgs: [] as string[],
  probedWidth: 1920 as number | null,
  burnedHasAudio: true as boolean | null,
  thumbnailCalls: [] as Array<Record<string, unknown>>,
  progressWrites: [] as number[],
  progressCleared: 0,
  failures: [] as string[],
  canStart: true,
  filmstripCalls: [] as Array<Record<string, unknown>>,
  duringEncode: null as null | (() => void),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(async () => undefined),
  deleteAppState: vi.fn(async (key: string) => {
    state.deletedAppState.push(key);
  }),
}));
vi.mock("../server/lib/redaction-burn-progress.js", () => ({
  setBurnProgress: (_id: string, percent: number) => {
    state.progressWrites.push(percent);
  },
  startBurn: () => state.canStart,
  finishBurn: () => {
    state.progressCleared += 1;
  },
  failBurn: (_id: string, error: string) => {
    state.progressCleared += 1;
    state.failures.push(error);
  },
}));
vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: vi.fn(async () =>
    state.uploadUrl ? { url: state.uploadUrl, provider: "s3" } : null,
  ),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => [recording] }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updated.push(values);
        return {
          where: () => ({ returning: async () => state.updateReturns }),
        };
      },
    }),
  }),
  schema: { recordings: { id: "id", videoUrl: "videoUrl", title: "title" } },
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
}));
vi.mock("../server/lib/public-agent-context.js", () => ({
  loadRecordingMediaBytes: async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "video/webm",
  }),
}));
vi.mock("../server/lib/recording-media-cleanup.js", () => ({
  deleteStoredMediaUrl: async (url: string) => {
    if (state.deleteFails.has(url)) return false;
    state.deleted.push(url);
    return true;
  },
}));
vi.mock("../server/lib/ensure-recording-thumbnail.js", () => ({
  ensureRecordingThumbnail: async (params: Record<string, unknown>) => {
    state.thumbnailCalls.push(params);
    return { recordingId: "rec_1", status: "generated", changed: true };
  },
}));
vi.mock("./lib/ensure-recording-filmstrip.js", () => ({
  ensureRecordingFilmstrip: async (params: Record<string, unknown>) => {
    state.filmstripCalls.push(params);
    return { recordingId: "rec_1", status: "generated", changed: true };
  },
}));
vi.mock("../server/lib/video-storage.js", () => ({
  STORAGE_SETUP_REQUIRED_REASON: "storage not set up",
}));
vi.mock("../server/lib/video-remux.js", () => ({
  isFfmpegAvailable: () => true,
  runFfmpegWithProgress: async (
    args: string[],
    options: { onProgress: (fraction: number) => void },
  ) => {
    state.ffmpegRuns += 1;
    state.ffmpegArgs = args;
    state.duringEncode?.();
    options.onProgress(0.5);
  },
  withRemuxSlot: async (fn: () => Promise<unknown>) => fn(),
  probeHasAudioStream: async (_bytes: Uint8Array, ext: string) =>
    ext === "mp4" ? state.burnedHasAudio : true,
  probeDurationMs: async (_bytes: Uint8Array, ext: string) =>
    ext === "mp4" ? state.burnedDurationMs : 10_000,
  probeMediaInfo: async (_bytes: Uint8Array, ext: string) => ({
    durationMs: ext === "mp4" ? state.burnedDurationMs : state.probedDurationMs,
    width: state.probedWidth,
    height: state.probedWidth === null ? null : 1080,
  }),
}));
vi.mock("node:fs/promises", () => ({
  mkdtemp: async () => "/tmp/burn-test",
  writeFile: async () => undefined,
  readFile: async () => Buffer.from([9, 9, 9, 9]),
  stat: async () => ({ size: 4 }),
  rm: async () => undefined,
}));

import action, {
  burnRedactionsFor,
  redactedTitle,
} from "./burn-recording-redactions";

const run = () =>
  burnRedactionsFor({ recordingId: "rec_1", ownerEmail: "owner@example.com" });
const start = () => (action as any).run({ recordingId: "rec_1" });

describe("burning redactions into a recording", () => {
  beforeEach(() => {
    state.updated = [];
    state.updateReturns = [{ id: "rec_1" }];
    state.deleted = [];
    state.deleteFails = new Set();
    state.deletedAppState = [];
    state.ffmpegRuns = 0;
    state.uploadUrl = "https://cdn.example.com/media/clips/rec_1.mp4";
    state.burnedDurationMs = 10_000;
    state.burnedHasAudio = true;
    state.probedDurationMs = 10_000;
    state.ffmpegArgs = [];
    recording.title = "Test recording";
    recording.durationMs = 10_000;
    state.probedWidth = 1920;
    state.thumbnailCalls = [];
    state.filmstripCalls = [];
    state.progressWrites = [];
    state.progressCleared = 0;
    state.failures = [];
    state.canStart = true;
    state.duringEncode = null;
    recording.videoUrl = "https://cdn.example.com/media/clips/rec_1.webm";
    recording.kind = "video";
  });

  it("refuses to burn when the frame size cannot be read", async () => {
    state.probedWidth = null;

    await expect(run()).rejects.toThrow(/frame size/i);
    expect(state.ffmpegRuns).toBe(0);
    expect(state.updated).toHaveLength(0);
    expect(state.deleted).toHaveLength(0);
  });

  it("clips the boxes against the file's length, not the row's", async () => {
    recording.durationMs = 2_000;
    state.probedDurationMs = 10_000;

    await run();

    const filter = state.ffmpegArgs.join(" ");
    expect(filter).toMatch(/5(\.\d+)?\)/);
    expect(state.ffmpegRuns).toBe(1);
  });

  it("marks the title as redacted, once however many times it is burned", async () => {
    await run();
    expect(state.updated[0].title).toBe("(Redacted) Test recording");

    state.updated = [];
    recording.title = "(Redacted) Test recording";
    await run();
    expect(state.updated[0].title).toBe("(Redacted) Test recording");

    state.updated = [];
    recording.title = "Test recording (edited)";
    await run();
    expect(state.updated[0].title).toBe("(Redacted) Test recording");
    recording.title = "Test recording";
  });

  it("keeps a rename made while the encode was running", async () => {
    state.duringEncode = () => {
      recording.title = "Renamed mid-burn";
    };

    await run();

    expect(state.updated[0].title).toBe("(Redacted) Renamed mid-burn");
  });

  it("marks a title the same way wherever it starts from", () => {
    expect(redactedTitle("Clip")).toBe("(Redacted) Clip");
    expect(redactedTitle("Clip (edited)")).toBe("(Redacted) Clip");
    expect(redactedTitle("(Redacted) Clip")).toBe("(Redacted) Clip");
    expect(redactedTitle("  Clip  ")).toBe("(Redacted) Clip");
    expect(redactedTitle("")).toBe("");
    expect(redactedTitle(null)).toBe(null);
  });

  it("moves the marker off the end rather than leaving two", () => {
    expect(redactedTitle("Clip (redacted)")).toBe("(Redacted) Clip");
    expect(redactedTitle("Clip (edited) (redacted)")).toBe("(Redacted) Clip");
    expect(redactedTitle("(redacted) Clip (redacted)")).toBe("(Redacted) Clip");
    expect(redactedTitle("(redacted)")).toBe("(Redacted)");
  });

  it("renders the video, repoints the row, then deletes the original", async () => {
    const result = await run();

    expect(state.ffmpegRuns).toBe(1);
    expect(result.redactionsBurned).toBe(1);
    const [values] = state.updated;
    expect(values.videoUrl).toBe(
      "https://cdn.example.com/media/clips/rec_1.mp4",
    );
    expect(values.videoFormat).toBe("mp4");
    expect(state.deleted).toContain(
      "https://cdn.example.com/media/clips/rec_1.webm",
    );
  });

  it("deletes every image that was made from the unredacted frames", async () => {
    await run();
    expect(state.deleted).toEqual(
      expect.arrayContaining([
        "https://cdn.example.com/media/clips/rec_1.jpg",
        "https://cdn.example.com/media/clips/rec_1.gif",
        "https://cdn.example.com/media/clips/rec_1-strip.jpg",
      ]),
    );
    const [values] = state.updated;
    expect(values.thumbnailUrl).toBeNull();
    expect(values.animatedThumbnailUrl).toBeNull();
    expect(values.filmstripUrl).toBeNull();
    expect(values.filmstripFrameCount).toBe(0);
  });

  it("rebuilds the thumbnail and filmstrip from the redacted file", async () => {
    await run();
    expect(state.thumbnailCalls[0]).toMatchObject({ mimeType: "video/mp4" });
    expect(state.filmstripCalls[0]).toMatchObject({ force: true });
  });

  it("keeps the cuts, and takes the burned boxes off the timeline", async () => {
    await run();
    const release = state.updated.find((u) => u.editsJson !== undefined);
    const edits = JSON.parse(String(release?.editsJson));
    expect(edits.trims).toEqual([
      { id: "cut-1", startMs: 1_000, endMs: 2_000, excluded: true },
    ]);
    expect(edits.overlays).toEqual([]);
    expect(edits.burnedRedactions).toHaveLength(1);
    expect(edits.burnedRedactions[0]).toMatchObject({
      id: "redact-1",
      startMs: 2_000,
      endMs: 5_000,
    });
  });

  it("keeps the clip held when the original cannot be deleted", async () => {
    state.deleteFails = new Set([recording.videoUrl]);

    await expect(run()).rejects.toThrow(/could not be deleted/i);

    const cleared = state.updated.find((u) => u.editsJson !== undefined);
    expect(cleared).toBeUndefined();
  });

  it("clears the local dev blob, which storage cleanup cannot see", async () => {
    recording.videoUrl = "/api/video/rec_1";
    await run();
    expect(state.deletedAppState).toEqual(["recording-blob-rec_1"]);
  });

  it("refuses when there is nothing to burn", async () => {
    const previous = recording.editsJson;
    recording.editsJson = JSON.stringify({ version: 1, trims: [], blurs: [] });
    await expect(run()).rejects.toThrow(/no redactions/i);
    expect(state.deleted).toEqual([]);
    recording.editsJson = previous;
  });

  it("deletes nothing when the render comes out a different length", async () => {
    state.burnedDurationMs = 7_000;
    await expect(run()).rejects.toThrow(/timestamp/i);
    expect(state.updated).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it("deletes nothing when the render's length cannot be read", async () => {
    state.burnedDurationMs = null;
    await expect(run()).rejects.toThrow(/could not be read/i);
    expect(state.updated).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it("deletes nothing when the render loses the audio", async () => {
    state.burnedHasAudio = false;
    await expect(run()).rejects.toThrow(/audio/i);
    expect(state.deleted).toEqual([]);
  });

  it("keeps the original when the recording moved under it, and tidies the orphan", async () => {
    state.updateReturns = [];
    await expect(run()).rejects.toThrow(/changed while/i);
    expect(state.deleted).toEqual([
      "https://cdn.example.com/media/clips/rec_1.mp4",
    ]);
  });

  it("says so loudly when the original could not be deleted", async () => {
    state.deleteFails.add("https://cdn.example.com/media/clips/rec_1.webm");
    await expect(run()).rejects.toThrow(/still exposed/i);
    expect(state.updated).toHaveLength(1);
  });
});

describe("starting a burn", () => {
  beforeEach(() => {
    state.updated = [];
    state.updateReturns = [{ id: "rec_1" }];
    state.deleted = [];
    state.deleteFails = new Set();
    state.progressWrites = [];
    state.progressCleared = 0;
    state.failures = [];
    state.canStart = true;
    recording.videoUrl = "https://cdn.example.com/media/clips/rec_1.webm";
    recording.kind = "video";
    recording.title = "Test recording";
  });

  it("hands the work over and comes straight back", async () => {
    const result = await start();
    expect(result).toMatchObject({ started: true, redactions: 1 });
  });

  it("gives back a reason it can act on rather than throwing", async () => {
    const previous = recording.editsJson;
    recording.editsJson = JSON.stringify({ version: 1, trims: [], blurs: [] });
    const result = await start();
    expect(result).toMatchObject({ started: false });
    expect(result.reason).toMatch(/no redactions/i);
    recording.editsJson = previous;
  });

  it("joins a burn that is already running rather than failing", async () => {
    state.canStart = false;
    const result = await start();
    expect(result).toMatchObject({ started: true, alreadyRunning: true });
  });

  it("records a failure against the job rather than losing it", async () => {
    state.burnedDurationMs = 7_000;
    await start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.failures[0]).toMatch(/timestamp/i);
  });
});
