import { describe, expect, it } from "vitest";

import { readyRecordingFromPublicPayload } from "./finalize-recovery";

describe("readyRecordingFromPublicPayload", () => {
  it("carries the received source bytes so a client can prove its copy uploaded", () => {
    const probe = readyRecordingFromPublicPayload(
      {
        recording: {
          id: "rec-1",
          status: "ready",
          videoUrl: "https://cdn.example.com/rec-1.webm",
          durationMs: 60_000,
          sourceSizeBytes: 1_234,
        },
      },
      "rec-1",
    );

    expect(probe).toMatchObject({
      ready: true,
      result: { sourceSizeBytes: 1_234, durationMs: 60_000 },
    });
  });
});
