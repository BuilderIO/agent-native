import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockLoadPublicAgentAccess = vi.hoisted(() => vi.fn());
const mockLoadRecordingMediaFile = vi.hoisted(() => vi.fn());
const mockExtractJpegFrameSheetFromFile = vi.hoisted(() => vi.fn());
const mockProbeFrameSheetFpsFromFile = vi.hoisted(() => vi.fn());
const mockProbeMediaDurationMsFromFile = vi.hoisted(() => vi.fn());
const mockCleanupMediaFile = vi.hoisted(() => vi.fn());
const MockVideoFrameExtractionError = vi.hoisted(
  () =>
    class VideoFrameExtractionError extends Error {
      code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
);
const MockRecordingMediaFetchError = vi.hoisted(
  () =>
    class RecordingMediaFetchError extends Error {
      statusCode: number;
      constructor(message: string, statusCode = 502) {
        super(message);
        this.statusCode = statusCode;
      }
    },
);

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../lib/public-agent-context.js", () => ({
  CLIPS_AGENT_ACCESS_PARAM: "agent_access",
  describeAgentAccessFailure: (failure: unknown) => failure,
  loadPublicAgentAccess: (...args: unknown[]) =>
    mockLoadPublicAgentAccess(...args),
  loadRecordingMediaFile: (...args: unknown[]) =>
    mockLoadRecordingMediaFile(...args),
  RecordingMediaFetchError: MockRecordingMediaFetchError,
  queryString: (value: unknown) => (typeof value === "string" ? value : ""),
}));

vi.mock("../../lib/video-frame.js", () => ({
  extractJpegFrameSheetFromFile: (...args: unknown[]) =>
    mockExtractJpegFrameSheetFromFile(...args),
  probeFrameSheetFpsFromFile: (...args: unknown[]) =>
    mockProbeFrameSheetFpsFromFile(...args),
  probeMediaDurationMsFromFile: (...args: unknown[]) =>
    mockProbeMediaDurationMsFromFile(...args),
  VideoFrameExtractionError: MockVideoFrameExtractionError,
}));

import handler from "./agent-frames.jpg.get";

function makeAccess(recording: Record<string, unknown> = {}) {
  return {
    recording: {
      id: "rec-1",
      visibility: "public",
      password: null,
      status: "ready",
      updatedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 10_000,
      width: 1920,
      height: 1080,
      videoUrl: "https://media.example.com/rec-1.mp4",
      ...recording,
    },
    viewerIsOwner: false,
    apiToken: null,
  };
}

function makeEvent(query: Record<string, string>) {
  return {
    query: { id: "rec-1", ...query },
    headers: new Map<string, string>(),
    status: 200,
  };
}

async function run(query: Record<string, string>) {
  const event = makeEvent(query);
  const body = await (handler as unknown as (event: unknown) => unknown)(event);
  return { event, body: body as any };
}

function lastPlan() {
  const calls = mockExtractJpegFrameSheetFromFile.mock.calls;
  return calls[calls.length - 1]?.[0]?.plan;
}

describe("agent-frames.jpg route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockImplementation((event) => event.query);
    mockSetResponseHeader.mockImplementation((event, name, value) => {
      event.headers.set(String(name).toLowerCase(), String(value));
    });
    mockSetResponseStatus.mockImplementation((event, status) => {
      event.status = status;
    });
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: makeAccess(),
    });
    mockLoadRecordingMediaFile.mockResolvedValue({
      path: "/tmp/recording.mp4",
      mimeType: "video/mp4",
      cleanup: mockCleanupMediaFile,
    });
    mockCleanupMediaFile.mockResolvedValue(undefined);
    mockExtractJpegFrameSheetFromFile.mockResolvedValue(
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
    mockProbeFrameSheetFpsFromFile.mockResolvedValue(30);
  });

  it("returns one JPEG sheet with each cell's time in the headers", async () => {
    const { event, body } = await run({
      startMs: "1000",
      endMs: "1200",
      fps: "30",
    });

    expect(event.status).toBe(200);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(mockLoadRecordingMediaFile).toHaveBeenCalledTimes(1);
    expect(mockProbeFrameSheetFpsFromFile).not.toHaveBeenCalled();
    expect(lastPlan()).toMatchObject({
      startMs: 1000,
      fps: 30,
      frameCount: 6,
      columns: 4,
      rows: 2,
    });
    expect(event.headers.get("content-type")).toBe("image/jpeg");
    expect(event.headers.get("cache-control")).toBe(
      "private, max-age=0, no-store",
    );
    expect(event.headers.get("x-clips-frame-sheet-fps")).toBe("30");
    expect(event.headers.get("x-clips-frame-sheet-grid")).toBe("4x2");
    expect(event.headers.get("x-clips-frame-sheet-times")).toBe(
      "1000,1033,1067,1100,1133,1167",
    );
    expect(mockCleanupMediaFile).toHaveBeenCalledTimes(1);
  });

  it("uses the video's own frame rate when fps is left out", async () => {
    mockProbeFrameSheetFpsFromFile.mockResolvedValue(24);
    const { event } = await run({ startMs: "0", endMs: "1000" });

    expect(mockProbeFrameSheetFpsFromFile).toHaveBeenCalledWith(
      "/tmp/recording.mp4",
    );
    expect(lastPlan()).toMatchObject({ fps: 24, frameCount: 24 });
    expect(event.headers.get("x-clips-frame-sheet-fps")).toBe("24");
  });

  it("fills the sheet from startMs without passing the end of the clip", async () => {
    await run({ startMs: "9900", fps: "30" });
    expect(lastPlan()).toMatchObject({ startMs: 9900, frameCount: 3 });
  });

  it("plans again inside the real duration when the stored one is too long", async () => {
    mockExtractJpegFrameSheetFromFile.mockRejectedValueOnce(
      new MockVideoFrameExtractionError(
        "NO_FRAME_AT_TIMESTAMP",
        "No frame was available at the requested timestamp.",
      ),
    );
    mockProbeMediaDurationMsFromFile.mockResolvedValue(5000);
    const { event, body } = await run({ startMs: "8000", fps: "30" });

    expect(event.status).toBe(200);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(mockProbeMediaDurationMsFromFile).toHaveBeenCalledWith(
      "/tmp/recording.mp4",
    );
    expect(mockExtractJpegFrameSheetFromFile).toHaveBeenCalledTimes(2);
    expect(lastPlan()).toMatchObject({
      startMs: 4997,
      frameCount: 1,
      columns: 1,
      rows: 1,
    });
    expect(event.headers.get("x-clips-frame-sheet-times")).toBe("4997");
    expect(mockLoadRecordingMediaFile).toHaveBeenCalledTimes(1);
    expect(mockCleanupMediaFile).toHaveBeenCalledTimes(1);
  });

  it("reports a missing frame when the real duration doesn't move the range", async () => {
    mockExtractJpegFrameSheetFromFile.mockRejectedValue(
      new MockVideoFrameExtractionError(
        "NO_FRAME_AT_TIMESTAMP",
        "No frame was available at the requested timestamp.",
      ),
    );
    mockProbeMediaDurationMsFromFile.mockResolvedValue(10_000);
    const { event, body } = await run({ startMs: "8000", fps: "30" });

    expect(event.status).toBe(422);
    expect(body.failureKind).toBe("processing");
    expect(mockExtractJpegFrameSheetFromFile).toHaveBeenCalledTimes(1);
  });

  it("refuses an oversized range before downloading the video", async () => {
    const { event, body } = await run({
      startMs: "0",
      endMs: "5000",
      fps: "30",
    });

    expect(event.status).toBe(400);
    expect(body).toMatchObject({
      failureKind: "request",
      maxFrames: 36,
      nextStep: expect.stringContaining("endMs=1200"),
    });
    expect(mockLoadRecordingMediaFile).not.toHaveBeenCalled();
  });

  it("refuses a range that needs too many frames at the video's own rate", async () => {
    mockProbeFrameSheetFpsFromFile.mockResolvedValue(60);
    const { event, body } = await run({ startMs: "0", endMs: "1000" });

    expect(event.status).toBe(400);
    expect(body.nextStep).toContain("fps=36");
    expect(mockExtractJpegFrameSheetFromFile).not.toHaveBeenCalled();
    expect(mockCleanupMediaFile).toHaveBeenCalledTimes(1);
  });

  it("refuses malformed values and ranges over a minute", async () => {
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: makeAccess({ durationMs: 120_000 }),
    });
    const queries: Record<string, string>[] = [
      { startMs: "{startMs}" },
      { startMs: "1000", endMs: "500" },
      { startMs: "0", fps: "120" },
      { startMs: "0", endMs: "70000", fps: "0.5" },
    ];
    for (const query of queries) {
      mockSetResponseStatus.mockClear();
      const { event, body } = await run(query);
      expect(event.status).toBe(400);
      expect(body).toMatchObject({
        failureKind: "request",
        nextStep: expect.any(String),
      });
    }
    expect(mockLoadRecordingMediaFile).not.toHaveBeenCalled();
  });

  it("points a screenshot at the single-frame API", async () => {
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: makeAccess({
        kind: "image",
        imageUrl: "https://media.example.com/rec-1.png",
      }),
    });
    const { event, body } = await run({ startMs: "0" });

    expect(event.status).toBe(422);
    expect(body).toMatchObject({
      failureKind: "unsupported",
      nextStep: expect.stringContaining("apis.frame"),
    });
    expect(mockLoadRecordingMediaFile).not.toHaveBeenCalled();
  });

  it("refuses clips the single-frame route refuses", async () => {
    mockLoadPublicAgentAccess.mockResolvedValueOnce({
      ok: false,
      failure: { status: 403, body: { failureKind: "access" } },
    });
    expect(await run({ startMs: "0" })).toMatchObject({
      event: { status: 403 },
      body: { failureKind: "access" },
    });

    mockLoadPublicAgentAccess.mockResolvedValueOnce({
      ok: true,
      access: makeAccess({ status: "processing" }),
    });
    const preparing = await run({ startMs: "0" });
    expect(preparing.event.status).toBe(409);
    expect(preparing.event.headers.get("retry-after")).toBe("15");

    mockLoadPublicAgentAccess.mockResolvedValueOnce({
      ok: true,
      access: makeAccess({
        sourceAppName: "Loom",
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        videoUrl: "/api/video/rec-1",
      }),
    });
    const loom = await run({ startMs: "0" });
    expect([loom.event.status, loom.body.failureKind]).toEqual([
      422,
      "unsupported",
    ]);
    expect(mockLoadRecordingMediaFile).not.toHaveBeenCalled();
  });

  it("classifies extraction and storage failures like single frames", async () => {
    mockExtractJpegFrameSheetFromFile.mockRejectedValueOnce(
      new MockVideoFrameExtractionError(
        "NO_VIDEO_TRACK",
        "This recording does not contain a video track.",
      ),
    );
    const audioOnly = await run({ startMs: "0", fps: "10" });
    expect(audioOnly.event.status).toBe(422);
    expect(audioOnly.body.failureKind).toBe("unsupported");
    expect(mockCleanupMediaFile).toHaveBeenCalledTimes(1);

    mockLoadRecordingMediaFile.mockRejectedValueOnce(
      new MockRecordingMediaFetchError("Recording media is missing.", 404),
    );
    const missing = await run({ startMs: "0", fps: "10" });
    expect(missing.event.status).toBe(404);
    expect(missing.body.failureKind).toBe("media");
  });
});
