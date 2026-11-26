import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadRecordingMediaBytes: vi.fn(),
  extractMotionEvidenceFrames: vi.fn(),
  preCompressionSourceMedia: vi.fn(),
}));

vi.mock("./builder-media-compression.js", () => ({
  preCompressionSourceMedia: (...args: unknown[]) =>
    mocks.preCompressionSourceMedia(...args),
}));

vi.mock("./public-agent-context.js", () => ({
  loadRecordingMediaBytes: (...args: unknown[]) =>
    mocks.loadRecordingMediaBytes(...args),
  RecordingMediaFetchError: class RecordingMediaFetchError extends Error {
    constructor(
      message: string,
      readonly statusCode = 502,
    ) {
      super(message);
    }
  },
}));

vi.mock("./motion-evidence.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./motion-evidence.js")>();
  return {
    ...original,
    extractMotionEvidenceFrames: (...args: unknown[]) =>
      mocks.extractMotionEvidenceFrames(...args),
  };
});

import type { PublicAgentRecording } from "./public-agent-context.js";
import {
  decodeSourceFrameCursor,
  inspectSourceFrames,
  type SourceFrameEvidenceInput,
  type SourceFramePage,
} from "./source-frame-evidence.js";

const recording = {
  id: "rec-1",
  status: "ready",
  videoUrl: "https://media.example.test/rec-1.mp4",
} as PublicAgentRecording;

function request(
  overrides: Partial<SourceFrameEvidenceInput> = {},
): SourceFrameEvidenceInput {
  return {
    recording,
    recordingId: "rec-1",
    mode: "consecutive",
    startMs: 250,
    endMs: 750,
    maxFrames: 4,
    ...overrides,
  };
}

const inspect = (overrides: Partial<SourceFrameEvidenceInput> = {}) =>
  inspectSourceFrames(request(overrides), { maxImageBase64Chars: 2_000_000 });

function nextCursorOf(page: SourceFramePage): string {
  const cursor = page.evidence.pagination.nextCursor;
  if (cursor === null) throw new Error("expected a next cursor");
  return cursor;
}

function frame(ptsUs: number, bytes: number[] = [1, 2, 3], pts = ptsUs) {
  return {
    pts,
    ptsUs,
    ptsMs: ptsUs / 1000,
    samePtsOrdinal: 1,
    jpegBytes: new Uint8Array(bytes),
  };
}

describe("inspectSourceFrames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preCompressionSourceMedia.mockResolvedValue(null);
    mocks.loadRecordingMediaBytes.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "video/mp4",
    });
    mocks.extractMotionEvidenceFrames.mockResolvedValue({
      frames: [frame(300_000), frame(316_700, [4, 5, 6])],
      hasMore: true,
      sourceDimensions: { width: 1920, height: 1080 },
      crop: null,
    });
  });

  it("reads the original media when a compressed playback copy replaced it", async () => {
    mocks.preCompressionSourceMedia.mockResolvedValue({
      videoUrl: "https://media.example.test/rec-1-original.webm",
      sizeBytes: 4_096,
    });

    await inspect();

    expect(mocks.preCompressionSourceMedia).toHaveBeenCalledWith(recording);
    expect(mocks.loadRecordingMediaBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-1",
        videoUrl: "https://media.example.test/rec-1-original.webm",
        videoSizeBytes: 4_096,
      }),
    );
  });

  it("returns measured gaps, attached images and an interval-bound cursor", async () => {
    const page = await inspect();

    expect(page.evidence.frames).toEqual([
      expect.objectContaining({
        id: "rec-1:300000:1",
        ptsMs: 300,
        gapFromPreviousMs: null,
        imageAttached: true,
      }),
      expect.objectContaining({
        ptsMs: 316.7,
        gapFromPreviousMs: 16.7,
        imageAttached: true,
      }),
    ]);
    expect(page.evidence.gapMeasurements).toEqual(
      expect.objectContaining({ count: 1, medianMs: 16.7, maxMs: 16.7 }),
    );
    expect(page.evidence.coverage).toEqual(
      expect.objectContaining({
        allDecodedFramesEnumerated: false,
        enumerationStartedAtRequestedRange: true,
        enumerationExhausted: false,
        frameObservation: {
          returnedFrameCount: 2,
          leadingUnobservedMs: 50,
          trailingUnobservedMs: null,
        },
        interpolationUsed: false,
        captureContinuity: "unavailable",
      }),
    );
    expect(page.evidence.pagination.truncated).toBe(true);
    expect(page.images.map((image) => image.ptsMs)).toEqual([300, 316.7]);
    expect(
      decodeSourceFrameCursor(nextCursorOf(page), {
        recordingId: "rec-1",
        mode: "consecutive",
        startMs: 250,
        endMs: 750,
      }),
    ).toEqual(
      expect.objectContaining({
        mode: "consecutive",
        pts: 316_700,
        ptsUs: 316_700,
        samePtsSeen: 1,
      }),
    );
  });

  it("continues a consecutive page after the cursor's frame", async () => {
    const first = await inspect();
    mocks.extractMotionEvidenceFrames.mockResolvedValue({
      frames: [frame(333_400)],
      hasMore: false,
      sourceDimensions: { width: 1920, height: 1080 },
      crop: null,
    });

    const second = await inspect({ cursor: nextCursorOf(first) });

    expect(mocks.extractMotionEvidenceFrames).toHaveBeenLastCalledWith(
      expect.objectContaining({
        after: { pts: 316_700, ptsUs: 316_700, samePtsSeen: 1 },
      }),
    );
    expect(second.evidence.frames).toEqual([
      expect.objectContaining({ gapFromPreviousMs: expect.closeTo(16.7) }),
    ]);
    expect(second.evidence.gapMeasurements.includesPreviousPageBoundary).toBe(
      true,
    );
    expect(second.evidence.coverage.allDecodedFramesEnumerated).toBe(false);
    expect(second.evidence.coverage.enumerationExhausted).toBe(true);
    expect(second.evidence.pagination.nextCursor).toBeNull();
  });

  it("labels filmstrip coverage as sparse and pages through target samples", async () => {
    mocks.extractMotionEvidenceFrames.mockResolvedValue({
      frames: [{ ...frame(100_000, [1]), targetMs: 83.33333333333333 }],
      hasMore: false,
      sourceDimensions: { width: 1920, height: 1080 },
      crop: null,
    });

    const page = await inspect({
      mode: "filmstrip",
      startMs: 0,
      endMs: 1_000,
      maxFrames: 1,
      sampleCount: 6,
    });

    expect(mocks.extractMotionEvidenceFrames).toHaveBeenCalledWith(
      expect.objectContaining({ filmstripTargetsMs: [83.33333333333333] }),
    );
    expect(page.evidence.coverage.sparse).toBe(true);
    expect(page.evidence.coverage.allDecodedFramesEnumerated).toBe(false);
    expect(page.evidence.pagination.truncated).toBe(true);
    expect(page.evidence.frames[0]).toEqual(
      expect.objectContaining({ targetMs: 83.33333333333333 }),
    );
    expect(
      decodeSourceFrameCursor(nextCursorOf(page), {
        recordingId: "rec-1",
        mode: "filmstrip",
        startMs: 0,
        endMs: 1_000,
      }),
    ).toEqual(expect.objectContaining({ nextSampleIndex: 1, sampleCount: 6 }));
  });

  it("binds a source-pixel crop into extraction, results and pagination", async () => {
    const crop = { x: 100, y: 50, width: 640, height: 360 };
    mocks.extractMotionEvidenceFrames.mockResolvedValue({
      frames: [frame(300_000, [1])],
      hasMore: true,
      sourceDimensions: { width: 1920, height: 1080 },
      crop,
    });

    const page = await inspect({ startMs: 0, endMs: 500, crop });

    expect(mocks.extractMotionEvidenceFrames).toHaveBeenCalledWith(
      expect.objectContaining({ crop }),
    );
    expect(page.evidence.sourceDimensions).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(page.evidence.crop).toEqual({
      sourcePixels: crop,
      representation: "cropped supplement",
    });
    expect(page.evidence.coverage.limitations).toContain(
      "This crop supplements a full-surface overview; it does not show behavior outside the selected source-pixel rectangle.",
    );
    await expect(
      inspect({
        startMs: 0,
        endMs: 500,
        crop: { ...crop, x: 101 },
        cursor: nextCursorOf(page),
      }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("refuses sampleCount outside filmstrip sampling", async () => {
    await expect(inspect({ sampleCount: 6 })).rejects.toMatchObject({
      code: "invalid_input",
      statusCode: 400,
    });
    expect(mocks.loadRecordingMediaBytes).not.toHaveBeenCalled();
  });

  it("refuses a filmstrip cursor issued for another sampleCount or past its last sample", async () => {
    mocks.extractMotionEvidenceFrames.mockResolvedValue({
      frames: [{ ...frame(100_000, [1]), targetMs: 83.33333333333333 }],
      hasMore: false,
      sourceDimensions: { width: 1920, height: 1080 },
      crop: null,
    });
    const filmstrip = {
      mode: "filmstrip" as const,
      startMs: 0,
      endMs: 1_000,
      maxFrames: 1,
    };
    const cursor = nextCursorOf(
      await inspect({ ...filmstrip, sampleCount: 6 }),
    );
    mocks.loadRecordingMediaBytes.mockClear();

    await expect(
      inspect({ ...filmstrip, sampleCount: 8, cursor }),
    ).rejects.toMatchObject({ code: "invalid_cursor", statusCode: 400 });
    const pastEnd = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
        nextSampleIndex: 6,
      }),
    ).toString("base64url");
    await expect(
      inspect({ ...filmstrip, cursor: pastEnd }),
    ).rejects.toMatchObject({ code: "invalid_cursor", statusCode: 400 });
    expect(mocks.loadRecordingMediaBytes).not.toHaveBeenCalled();

    await inspect({ ...filmstrip, cursor });
    expect(mocks.extractMotionEvidenceFrames).toHaveBeenLastCalledWith(
      expect.objectContaining({ filmstripTargetsMs: [250] }),
    );
  });

  it("refuses a consecutive cursor positioned outside the requested interval", async () => {
    const cursor = nextCursorOf(await inspect());
    const outside = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
        ptsUs: 900_000,
      }),
    ).toString("base64url");

    await expect(inspect({ cursor: outside })).rejects.toMatchObject({
      code: "invalid_cursor",
    });
  });

  it("refuses a cursor from another recording before loading media", async () => {
    const first = await inspect({ startMs: 0, endMs: 500 });
    mocks.loadRecordingMediaBytes.mockClear();

    await expect(
      inspect({
        recordingId: "rec-2",
        startMs: 0,
        endMs: 500,
        cursor: nextCursorOf(first),
      }),
    ).rejects.toMatchObject({ code: "invalid_cursor", statusCode: 400 });
    expect(mocks.loadRecordingMediaBytes).not.toHaveBeenCalled();
  });

  it("refuses a later page when the stored media changed", async () => {
    const first = await inspect({ startMs: 0, endMs: 500 });
    mocks.loadRecordingMediaBytes.mockResolvedValue({
      bytes: new Uint8Array([9, 8, 7]),
      mimeType: "video/mp4",
    });

    await expect(
      inspect({ startMs: 0, endMs: 500, cursor: nextCursorOf(first) }),
    ).rejects.toMatchObject({ code: "source_media_changed", statusCode: 409 });
    expect(mocks.extractMotionEvidenceFrames).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty or oversized interval before loading media", async () => {
    await expect(inspect({ startMs: 500, endMs: 500 })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(inspect({ startMs: 0, endMs: 30_001 })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(mocks.loadRecordingMediaBytes).not.toHaveBeenCalled();
  });

  it("maps decode failures to typed codes", async () => {
    const { MotionEvidenceExtractionError } =
      await import("./motion-evidence.js");
    mocks.extractMotionEvidenceFrames.mockRejectedValue(
      new MotionEvidenceExtractionError("crop_out_of_bounds", "too wide"),
    );
    await expect(inspect()).rejects.toMatchObject({
      code: "crop_out_of_bounds",
      statusCode: 422,
    });
    mocks.extractMotionEvidenceFrames.mockRejectedValue(
      new MotionEvidenceExtractionError("decode_failed", "bad media"),
    );
    await expect(inspect()).rejects.toMatchObject({
      code: "frame_extraction_failed",
    });
  });

  it("keeps the metadata of a frame too large to attach", async () => {
    const page = await inspectSourceFrames(request(), {
      maxImageBase64Chars: 3,
    });

    expect(page.images).toEqual([]);
    expect(page.evidence.frames.map((entry) => entry.imageAttached)).toEqual([
      false,
      false,
    ]);
    expect(page.evidence.coverage.limitations).toContain(
      "One or more decoded JPEGs exceeded the live agent-image limit and were omitted; their timestamp metadata remains in this page.",
    );
  });

  it("reports an empty interval as unobserved without endpoint claims", async () => {
    mocks.extractMotionEvidenceFrames.mockResolvedValue({
      frames: [],
      hasMore: false,
      sourceDimensions: { width: 1920, height: 1080 },
      crop: null,
    });

    const page = await inspect();

    expect(page.evidence.returnedRange).toBeNull();
    expect(page.evidence.coverage).toEqual(
      expect.objectContaining({
        allDecodedFramesEnumerated: true,
        enumerationStartedAtRequestedRange: true,
        enumerationExhausted: true,
        frameObservation: {
          returnedFrameCount: 0,
          leadingUnobservedMs: 500,
          trailingUnobservedMs: 500,
        },
      }),
    );
  });

  it("measures the trailing gap from the previous page when the last page is empty", async () => {
    const first = await inspect({ startMs: 0, endMs: 500 });
    mocks.extractMotionEvidenceFrames.mockResolvedValue({
      frames: [],
      hasMore: false,
      sourceDimensions: { width: 1920, height: 1080 },
      crop: null,
    });

    const final = await inspect({
      startMs: 0,
      endMs: 500,
      cursor: nextCursorOf(first),
    });

    expect(final.evidence.coverage.frameObservation).toEqual({
      returnedFrameCount: 0,
      leadingUnobservedMs: null,
      trailingUnobservedMs: 183.3,
    });
  });
});
