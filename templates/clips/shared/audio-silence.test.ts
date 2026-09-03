import { describe, expect, it } from "vitest";

import {
  audioSignalEvidence,
  createAudioSilenceState,
  isSustainedDigitalSilence,
  recordAudioSignalSample,
} from "./audio-silence";

describe("audio silence evidence", () => {
  it("classifies sustained near-digital silence without guessing intent", () => {
    let state = createAudioSilenceState();
    state = recordAudioSignalSample(state, -91, 0);
    state = recordAudioSignalSample(state, -91, 10_100);
    const evidence = audioSignalEvidence(state, 10_100);
    expect(evidence).toMatchObject({
      durationMs: 10_100,
      silentDurationMs: 10_100,
      peakDb: -91,
      thresholdDb: -70,
    });
    expect(isSustainedDigitalSilence(evidence)).toBe(true);
  });

  it("does not classify ordinary audible signal as silent", () => {
    let state = createAudioSilenceState();
    state = recordAudioSignalSample(state, -42, 0);
    state = recordAudioSignalSample(state, -38, 12_000);
    expect(isSustainedDigitalSilence(audioSignalEvidence(state, 12_000))).toBe(
      false,
    );
  });
});
