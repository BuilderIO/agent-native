import { describe, expect, it, vi } from "vitest";

import {
  createRealtimeVoiceTurnMetrics,
  REALTIME_VOICE_TURN_EVENT,
} from "./realtime-voice-turn-metrics.js";

function metrics() {
  const emit = vi.fn();
  const tracker = createRealtimeVoiceTurnMetrics(emit);
  tracker.setContext({
    protocol: "live",
    intelligence: "balanced",
    intelligenceSource: "default",
  });
  return { emit, tracker };
}

describe("realtime voice turn metrics", () => {
  it("times speech end to first audio on the provider's session clock", () => {
    const { emit, tracker } = metrics();
    tracker.userSpeechEnded(1_000, 40_000);
    tracker.userSpeechEnded(1_100, 40_200);
    tracker.assistantAudioStarted(1_500, 41_100);
    tracker.assistantAudioStarted(1_600, 41_400);
    tracker.sessionEnded();

    expect(emit).toHaveBeenCalledWith(REALTIME_VOICE_TURN_EVENT, {
      protocol: "live",
      intelligence: "balanced",
      intelligence_source: "default",
      turn_index: 0,
      speech_to_audio_ms: 900,
      latency_clock: "session",
      tool_calls: 0,
      write_tool_calls: 0,
      failed_tool_calls: 0,
      spoke_again_after_edit: null,
      ms_after_edit: null,
    });
  });

  it("flags speech within the window after an edit as a likely correction", () => {
    const { emit, tracker } = metrics();
    tracker.userSpeechStarted(0);
    tracker.userSpeechEnded(1_000);
    tracker.assistantAudioStarted(1_400);
    tracker.toolCallStarted();
    tracker.toolCallFinished(2_000, { status: "completed", readOnly: true });
    tracker.toolCallStarted();
    tracker.toolCallFinished(3_000, { status: "completed" });
    tracker.userSpeechStarted(7_000);

    expect(emit.mock.calls[0]![1]).toMatchObject({
      speech_to_audio_ms: 400,
      latency_clock: "browser",
      tool_calls: 2,
      write_tool_calls: 1,
      spoke_again_after_edit: true,
      ms_after_edit: 4_000,
    });
  });

  it("does not count a reply long after the edit, or a failed edit", () => {
    const { emit, tracker } = metrics();
    tracker.userSpeechEnded(0);
    tracker.toolCallStarted();
    tracker.toolCallFinished(500, { status: "completed" });
    tracker.userSpeechStarted(20_000);
    tracker.userSpeechEnded(21_000);
    tracker.toolCallStarted();
    tracker.toolCallFinished(21_500, { status: "failed" });
    tracker.userSpeechStarted(22_000);

    expect(emit.mock.calls.map(([, properties]) => properties)).toMatchObject([
      { turn_index: 0, spoke_again_after_edit: false, ms_after_edit: 19_500 },
      {
        turn_index: 1,
        failed_tool_calls: 1,
        write_tool_calls: 0,
        spoke_again_after_edit: null,
      },
    ]);
  });

  it("keeps one turn while the user pauses with no reply yet", () => {
    const { emit, tracker } = metrics();
    tracker.userSpeechStarted(0);
    tracker.userSpeechEnded(1_000);
    tracker.userSpeechStarted(1_200);
    tracker.userSpeechEnded(2_000);
    tracker.assistantAudioStarted(2_300);
    tracker.sessionEnded();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![1]).toMatchObject({ speech_to_audio_ms: 300 });
  });

  it("skips a greeting nobody asked for and an empty session", () => {
    const { emit, tracker } = metrics();
    tracker.assistantAudioStarted(100);
    tracker.sessionEnded();
    tracker.sessionEnded();

    expect(emit).not.toHaveBeenCalled();
  });
});
