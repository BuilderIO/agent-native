import { describe, expect, it, vi } from "vitest";

import {
  createRealtimeVoiceAudioLevelStore,
  normalizeRealtimeVoiceRms,
  smoothRealtimeVoiceLevel,
} from "./realtime-voice-audio-level.js";

describe("realtime voice audio levels", () => {
  it("normalizes silence and clamps loud audio", () => {
    expect(normalizeRealtimeVoiceRms(new Uint8Array(32).fill(128))).toBe(0);
    expect(normalizeRealtimeVoiceRms(new Uint8Array(32).fill(255))).toBe(1);
  });

  it("makes ordinary speech visibly responsive above the noise floor", () => {
    const quietSpeech = Uint8Array.from({ length: 32 }, (_, index) =>
      index % 2 === 0 ? 124 : 132,
    );
    const typicalSpeech = Uint8Array.from({ length: 32 }, (_, index) =>
      index % 2 === 0 ? 120 : 136,
    );

    expect(normalizeRealtimeVoiceRms(quietSpeech)).toBeGreaterThan(0.3);
    expect(normalizeRealtimeVoiceRms(typicalSpeech)).toBeGreaterThan(0.5);
    expect(normalizeRealtimeVoiceRms(typicalSpeech)).toBeGreaterThan(
      normalizeRealtimeVoiceRms(quietSpeech),
    );
  });

  it("attacks faster than it decays", () => {
    expect(smoothRealtimeVoiceLevel(0, 1)).toBe(0.55);
    expect(smoothRealtimeVoiceLevel(1, 0)).toBe(0.8);
  });

  it("notifies only on changes and resets both channels", () => {
    const store = createRealtimeVoiceAudioLevelStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ input: 0.5, output: 0.25 });
    store.set({ input: 0.5, output: 0.25 });
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual({ input: 0.5, output: 0.25 });
    store.reset();
    expect(store.getSnapshot()).toEqual({ input: 0, output: 0 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
