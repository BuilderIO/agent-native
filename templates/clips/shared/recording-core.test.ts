import { describe, expect, it } from "vitest";

import {
  chunkUploadParallelism,
  chunkUploadQuery,
  normalizeChunkUploadNumber,
} from "./recording-core";

describe("recording upload URL helpers", () => {
  it("serializes resumable chunks while keeping buffered upload parallelism", () => {
    expect(chunkUploadParallelism("streaming", 4)).toBe(1);
    expect(chunkUploadParallelism("buffered", 4)).toBe(4);
    expect(chunkUploadParallelism(undefined, 0)).toBe(1);
  });

  it("normalizes finite upload metadata before encoding", () => {
    expect(normalizeChunkUploadNumber("1200.6")).toBe(1201);
    expect(normalizeChunkUploadNumber(-12)).toBe(0);

    const params = new URLSearchParams(
      chunkUploadQuery({
        index: 0,
        isFinal: true,
        mimeType: "video/webm",
        durationMs: 1200.4,
        width: 3840.2,
        height: 2954.7,
        hasAudio: true,
        hasCamera: false,
      }),
    );

    expect(params.get("durationMs")).toBe("1200");
    expect(params.get("width")).toBe("3840");
    expect(params.get("height")).toBe("2955");
    expect(params.get("hasAudio")).toBe("1");
    expect(params.get("hasCamera")).toBe("0");
  });

  it("omits null, empty, and non-finite upload metadata", () => {
    expect(normalizeChunkUploadNumber(null)).toBeUndefined();
    expect(normalizeChunkUploadNumber("")).toBeUndefined();
    expect(normalizeChunkUploadNumber("Infinity")).toBeUndefined();
    expect(normalizeChunkUploadNumber(Number.NaN)).toBeUndefined();

    const params = new URLSearchParams(
      chunkUploadQuery({
        index: 44,
        total: 45,
        isFinal: true,
        mimeType: "video/webm",
        durationMs: Number.POSITIVE_INFINITY,
        width: Number.NaN,
        height: null,
        hasAudio: true,
        hasCamera: false,
      }),
    );

    expect(params.get("durationMs")).toBeNull();
    expect(params.get("width")).toBeNull();
    expect(params.get("height")).toBeNull();
    expect(params.get("hasAudio")).toBe("1");
    expect(params.get("hasCamera")).toBe("0");
  });
});
