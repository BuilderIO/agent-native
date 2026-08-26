import { describe, expect, it } from "vitest";

import { resolveCompletion } from "./pill-completion";

describe("resolveCompletion", () => {
  it("reports a hosted upload as uploaded with its link", () => {
    expect(
      resolveCompletion("rec-1", {
        recordingId: "rec-1",
        ok: true,
        viewUrl: "https://clips.example.com/r/rec-1",
      }),
    ).toEqual({
      stage: "uploaded",
      savedLocally: false,
      viewUrl: "https://clips.example.com/r/rec-1",
    });
  });

  it("reports a local-only success as uploaded even with no link", () => {
    expect(
      resolveCompletion(null, {
        ok: true,
        localFilePath: "/Users/x/Movies/Clips/take.mp4",
      }),
    ).toEqual({ stage: "uploaded", savedLocally: true, viewUrl: null });
  });

  it("reports a failed stop as failed rather than saved", () => {
    expect(
      resolveCompletion(null, { ok: false, error: "export failed" }),
    ).toEqual({ stage: "failed", savedLocally: false, viewUrl: null });
  });

  it("treats a payload with no ok flag as a failure", () => {
    expect(resolveCompletion(null, {})).toEqual({
      stage: "failed",
      savedLocally: false,
      viewUrl: null,
    });
  });

  it("ignores a late completion from a recording the card moved past", () => {
    expect(
      resolveCompletion("rec-2", {
        recordingId: "rec-1",
        ok: true,
        viewUrl: "https://clips.example.com/r/rec-1",
      }),
    ).toBeNull();
  });

  it("takes the payload when either side has no recording id", () => {
    expect(
      resolveCompletion(null, { recordingId: "rec-1", ok: true }),
    ).not.toBeNull();
    expect(resolveCompletion("rec-1", { ok: true })).not.toBeNull();
  });
});
