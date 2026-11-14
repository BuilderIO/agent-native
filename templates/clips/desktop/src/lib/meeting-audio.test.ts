import { describe, expect, it } from "vitest";

import { meetingAudioPlan } from "./meeting-audio";

describe("meetingAudioPlan", () => {
  const base = {
    audioKey: "key-1",
    alreadySettled: false,
    stopReason: "manual",
    recordingId: "rec-1",
  };

  it("uploads a stopped meeting's audio to its recording", () => {
    expect(meetingAudioPlan(base)).toEqual({
      action: "upload",
      recordingId: "rec-1",
    });
    expect(meetingAudioPlan({ ...base, stopReason: "call-ended" })).toEqual({
      action: "upload",
      recordingId: "rec-1",
    });
  });

  it("does nothing when no audio was kept or it was already handled", () => {
    expect(meetingAudioPlan({ ...base, audioKey: null })).toEqual({
      action: "none",
    });
    expect(meetingAudioPlan({ ...base, alreadySettled: true })).toEqual({
      action: "none",
    });
  });

  it("throws the audio away rather than hold a quit for an upload", () => {
    expect(meetingAudioPlan({ ...base, stopReason: "app-quit" })).toEqual({
      action: "discard",
      reason: "app-quit",
    });
  });

  it("throws the audio away when there is no recording to upload to", () => {
    expect(meetingAudioPlan({ ...base, recordingId: null })).toEqual({
      action: "discard",
      reason: "no-recording",
    });
  });
});
