import { describe, expect, it } from "vitest";

import {
  completionCardState,
  isCompletionForSession,
  resolveCompletion,
} from "./pill-completion";

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

describe("isCompletionForSession", () => {
  it("governs progress events on the same rule as completions", () => {
    // The pill's window is reused across takes, so an earlier upload's
    // progress must not move a newer take's card or refresh its timeout.
    expect(isCompletionForSession("rec-2", { recordingId: "rec-1" })).toBe(
      false,
    );
    expect(isCompletionForSession("rec-2", { recordingId: "rec-2" })).toBe(
      true,
    );
  });

  it("takes an event when either side is unidentified", () => {
    expect(isCompletionForSession(null, { recordingId: "rec-1" })).toBe(true);
    expect(isCompletionForSession("rec-1", {})).toBe(true);
    expect(isCompletionForSession(undefined, {})).toBe(true);
  });
});

describe("completionCardState", () => {
  const noLink = { hasLink: false, savedLocally: false };

  it("does not claim a save while the stop is still running", () => {
    // The card is on screen from the click, before the export returned.
    expect(completionCardState("finishing", noLink)).toEqual({
      title: "Finishing up",
      detail: "",
      tone: "pending",
    });
    expect(completionCardState("uploading", noLink)).toEqual({
      title: "Uploading",
      detail: "",
      tone: "pending",
    });
  });

  it("leads with the failure rather than burying it in the sub-line", () => {
    expect(completionCardState("failed", noLink)).toEqual({
      title: "Upload paused",
      detail: "",
      tone: "warn",
    });
    expect(
      completionCardState("failed", { hasLink: true, savedLocally: true }),
    ).toEqual({
      title: "Upload paused",
      detail: "saved on this device",
      tone: "warn",
    });
  });

  it("says where a linkless success went", () => {
    expect(
      completionCardState("uploaded", { hasLink: false, savedLocally: true }),
    ).toEqual({
      title: "Recording saved",
      detail: "saved on this device",
      tone: "ok",
    });
  });

  it("leaves the detail to the link row when there is a link", () => {
    expect(
      completionCardState("uploaded", { hasLink: true, savedLocally: false }),
    ).toEqual({ title: "Recording saved", detail: "", tone: "ok" });
  });
});
