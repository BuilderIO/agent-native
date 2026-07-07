import { describe, expect, it } from "vitest";

import { createRecordingSchema } from "./lib/create-recording-schema";

describe("create-recording schema", () => {
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
