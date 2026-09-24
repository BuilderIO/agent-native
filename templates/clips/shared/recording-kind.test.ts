import { describe, expect, it } from "vitest";

import {
  isImageRecording,
  isRecordingKind,
  resolveRecordingKind,
} from "./recording-kind";

describe("recording kind", () => {
  it("treats a missing kind as a video", () => {
    // Every row written before the column existed reads back as null.
    expect(resolveRecordingKind(null)).toBe("video");
    expect(resolveRecordingKind(undefined)).toBe("video");
    expect(isImageRecording({})).toBe(false);
    expect(isImageRecording(null)).toBe(false);
  });

  it("does not let an unrecognised value pass as a kind", () => {
    expect(isRecordingKind("gif")).toBe(false);
    expect(resolveRecordingKind("gif")).toBe("video");
  });

  it("recognises image rows", () => {
    expect(isRecordingKind("image")).toBe(true);
    expect(isImageRecording({ kind: "image" })).toBe(true);
    expect(isImageRecording({ kind: "video" })).toBe(false);
  });
});
