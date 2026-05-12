import { describe, expect, it } from "vitest";
import createRecording from "./create-recording";

describe("create-recording schema", () => {
  it("does not require spaceIds for recorder clients", () => {
    const parsed = createRecording.schema.safeParse({
      title: "Screen recording - 12 May 2026",
      titleSource: "context",
      sourceAppName: null,
      sourceWindowTitle: null,
      hasCamera: true,
      hasAudio: true,
      visibility: "public",
    });

    expect(parsed.success).toBe(true);
    expect(createRecording.tool.parameters.required ?? []).not.toContain(
      "spaceIds",
    );
  });

  it("accepts explicit empty spaceIds for compatibility", () => {
    const parsed = createRecording.schema.safeParse({
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
