import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAudioCue } from "./audio-cue";

const context = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  resume: vi.fn(async () => {}),
}));

class MockAudioContext {
  currentTime = 0;
  destination = {};
  state: AudioContextState = "suspended";

  close = context.close;
  resume = context.resume.mockImplementation(async () => {
    this.state = "running";
  });

  createOscillator() {
    return {
      connect: vi.fn(),
      frequency: { setValueAtTime: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
      type: "sine",
    };
  }

  createGain() {
    return {
      connect: vi.fn(),
      gain: {
        exponentialRampToValueAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
    };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  context.close.mockClear();
  context.resume.mockClear();
  vi.stubGlobal("window", {
    AudioContext: MockAudioContext,
    clearTimeout,
    setTimeout,
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createAudioCue", () => {
  it("primes audio synchronously and keeps the context open through the full cue", async () => {
    const cue = createAudioCue();
    expect(context.resume).toHaveBeenCalledOnce();

    let finished = false;
    const play = cue.playBeforeCapture().then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(450);
    expect(context.close).not.toHaveBeenCalled();
    expect(finished).toBe(false);

    await vi.advanceTimersByTimeAsync(150);
    await play;
    expect(context.close).not.toHaveBeenCalled();

    cue.cleanup();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
