import { describe, expect, it } from "vitest";

import { S3MultipartStartError } from "../server/lib/s3-upload-provider.js";
import { classifyInitialUploadFailure } from "./create-recording.js";
import { createRecordingSchema } from "./lib/create-recording-schema";

describe("create-recording schema", () => {
  it("classifies initial multipart startup failures separately", () => {
    expect(
      classifyInitialUploadFailure(new S3MultipartStartError(503)),
    ).toEqual({
      failureCode: "multipart_start_failed",
      failureStage: "multipart_start",
      httpStatus: 503,
    });
    expect(
      classifyInitialUploadFailure(new Error("storage unavailable")),
    ).toEqual({
      failureCode: "multipart_start_failed",
      failureStage: "multipart_start",
    });
  });

  it("keeps transient Builder resumable startup failures out of setup state", () => {
    expect(
      classifyInitialUploadFailure(
        new Error("GCS resumable session initiation failed (503): unavailable"),
      ),
    ).toEqual({
      failureCode: "multipart_start_failed",
      failureStage: "multipart_start",
      httpStatus: 503,
    });
    expect(
      classifyInitialUploadFailure(
        new Error("GCS did not return a Location header for the session"),
      ),
    ).toEqual({
      failureCode: "multipart_start_failed",
      failureStage: "multipart_start",
    });
  });

  it("preserves typed provider failures and marks real auth setup failures", () => {
    expect(
      classifyInitialUploadFailure({
        failureCode: "upload_timed_out",
        failureStage: "multipart_start",
        status: 504,
        retryable: true,
      }),
    ).toEqual({
      failureCode: "upload_timed_out",
      failureStage: "multipart_start",
      httpStatus: 504,
    });
    expect(
      classifyInitialUploadFailure({
        errorCode: "builder_oauth_reauthorization_required",
        message: "Builder.io is not connected.",
        statusCode: 400,
      }),
    ).toEqual({
      failureCode: "storage_setup_required",
      failureStage: "multipart_start",
      httpStatus: 400,
    });
    expect(
      classifyInitialUploadFailure(
        new Error("S3 credentials are not configured"),
      ),
    ).toEqual({
      failureCode: "storage_setup_required",
      failureStage: "multipart_start",
    });
  });

  it("leaves visibility unset so the organization default can apply", () => {
    const parsed = createRecordingSchema.parse({
      title: "Uploaded demo",
      titleSource: "upload",
    });

    expect(parsed.visibility).toBeUndefined();
  });

  it("does not require spaceIds for recorder clients", () => {
    const parsed = createRecordingSchema.safeParse({
      title: "Screen recording - 12 May 2026",
      titleSource: "context",
      sourceAppName: null,
      sourceWindowTitle: null,
      hasCamera: true,
      hasAudio: true,
      visibility: "public",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts explicit empty spaceIds for compatibility", () => {
    const parsed = createRecordingSchema.safeParse({
      title: "Screen recording - 12 May 2026",
      titleSource: "context",
      spaceIds: [],
      hasCamera: true,
      hasAudio: true,
      visibility: "public",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts the desktop native streaming client marker", () => {
    const parsed = createRecordingSchema.safeParse({
      hasCamera: false,
      hasAudio: true,
      mimeType: "video/mp4",
      requestStreaming: true,
      streamingUploadClient: "desktop-native",
    });

    expect(parsed.success).toBe(true);
  });

  it("normalizes the recorder platform", () => {
    const parsed = createRecordingSchema.parse({
      recordingPlatform: " Desktop ",
    });

    expect(parsed.recordingPlatform).toBe("desktop");
    expect(
      createRecordingSchema.safeParse({ recordingPlatform: "mobile" }).success,
    ).toBe(true);
  });

  it("keeps streaming opt-in optional for buffered-default recorder clients", () => {
    const parsed = createRecordingSchema.safeParse({
      hasCamera: true,
      hasAudio: true,
      mimeType: "video/webm",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.requestStreaming).toBeUndefined();
    }
  });
});
