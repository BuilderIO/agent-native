import { describe, expect, it } from "vitest";

import {
  classifyUploadResponseError,
  chunkUploadParallelism,
  chunkUploadQuery,
  chunkUploadUrl,
  normalizeChunkUploadNumber,
} from "./recording-core";

describe("recording upload URL helpers", () => {
  it("classifies HTML upload errors without retaining their body", () => {
    expect(
      classifyUploadResponseError({
        contentType: "text/html; charset=utf-8",
        body: "<html>private proxy error</html>",
        status: 502,
        stage: "chunk_upload",
      }),
    ).toEqual({
      isHtml: true,
      responseText: null,
      status: 502,
      failureCode: "chunk_html_error",
      failureStage: "chunk_upload",
    });

    expect(
      classifyUploadResponseError({
        contentType: "application/octet-stream",
        body: " \n<!DOCTYPE html><html>private proxy error</html>",
        status: 503,
        stage: "reset_chunks",
      }).failureCode,
    ).toBe("chunk_html_error");
  });

  it("redacts HTML embedded after a proxy error prefix", () => {
    expect(
      classifyUploadResponseError({
        contentType: "text/plain",
        body: "upstream returned: <!DOCTYPE html><html>private proxy content</html>",
        status: 502,
        stage: "chunk_upload",
      }),
    ).toEqual({
      isHtml: true,
      responseText: null,
      status: 502,
      failureCode: "chunk_html_error",
      failureStage: "chunk_upload",
    });
  });

  it("preserves plain-text upload errors and their response metadata", () => {
    expect(
      classifyUploadResponseError({
        contentType: "text/plain",
        body: "storage quota exceeded",
        status: 413,
        stage: "chunk_upload",
      }),
    ).toEqual({
      isHtml: false,
      responseText: "storage quota exceeded",
      status: 413,
      failureCode: "upload_failed",
      failureStage: "chunk_upload",
    });
  });

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
        attemptId: "attempt-1",
        uploadGenerationId: "generation-1",
      }),
    );

    expect(params.get("durationMs")).toBe("1200");
    expect(params.get("width")).toBe("3840");
    expect(params.get("height")).toBe("2955");
    expect(params.get("hasAudio")).toBe("1");
    expect(params.get("hasCamera")).toBe("0");
    expect(params.get("attemptId")).toBe("attempt-1");
    expect(params.get("uploadGenerationId")).toBe("generation-1");
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
        attemptId: "",
        uploadGenerationId: "",
      }),
    );

    expect(params.get("durationMs")).toBeNull();
    expect(params.get("width")).toBeNull();
    expect(params.get("height")).toBeNull();
    expect(params.get("hasAudio")).toBe("1");
    expect(params.get("hasCamera")).toBe("0");
    expect(params.get("attemptId")).toBeNull();
    expect(params.get("uploadGenerationId")).toBeNull();
  });

  it("preserves capability query parameters on intake upload URLs", () => {
    const url = new URL(
      chunkUploadUrl("/api/clip-intake?recordingId=rec-1&clip_intake=token", {
        index: 0,
        total: 1,
        isFinal: true,
        mimeType: "video/webm",
      }),
      "https://clips.example.com",
    );

    expect(url.searchParams.get("recordingId")).toBe("rec-1");
    expect(url.searchParams.get("clip_intake")).toBe("token");
    expect(url.searchParams.get("index")).toBe("0");
    expect(url.searchParams.get("isFinal")).toBe("1");
  });
});
