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
});
