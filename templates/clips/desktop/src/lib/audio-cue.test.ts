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
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createAudioCue", () => {
  it("primes audio synchronously and keeps the context open through the full cue", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
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
    expect(info).toHaveBeenCalledWith(
      "[clips-recorder] start cue outcome=played",
    );

    cue.cleanup();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("reports when a throttled cue misses its playback deadline", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scheduleTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      handler,
      timeout,
      ...args
    ) =>
      scheduleTimeout(
        handler,
        typeof timeout === "number" && timeout > 100 && timeout < 1000
          ? 1500
          : timeout,
        ...args,
      )) as typeof window.setTimeout);
    const cue = createAudioCue();
    const play = cue.playBeforeCapture();

    await vi.advanceTimersByTimeAsync(1000);
    await play;

    expect(warn).toHaveBeenCalledWith(
      "[clips-recorder] start cue outcome=timed_out",
    );
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("does not let delayed playback completion beat the deadline", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const scheduleTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      handler,
      timeout,
      ...args
    ) =>
      scheduleTimeout(
        handler,
        typeof timeout === "number" && timeout > 100 && timeout < 1000
          ? 1500
          : timeout,
        ...args,
      )) as typeof window.setTimeout);
    const cue = createAudioCue();
    const play = cue.playBeforeCapture();

    await vi.advanceTimersByTimeAsync(3000);
    await play;

    expect(warn).toHaveBeenCalledWith(
      "[clips-recorder] start cue outcome=timed_out",
    );
    expect(info).not.toHaveBeenCalledWith(
      "[clips-recorder] start cue outcome=played",
    );
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("reports cancellation while the cue is playing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cue = createAudioCue();
    const abort = new AbortController();
    const play = cue.playBeforeCapture(abort.signal);

    abort.abort();
    await play;

    expect(warn).toHaveBeenCalledWith(
      "[clips-recorder] start cue outcome=cancelled",
    );
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("does not start playback when the signal is already aborted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const createOscillator = vi.spyOn(
      MockAudioContext.prototype,
      "createOscillator",
    );
    const cue = createAudioCue();
    const abort = new AbortController();
    abort.abort();

    await cue.playBeforeCapture(abort.signal);

    expect(createOscillator).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[clips-recorder] start cue outcome=cancelled",
    );
    expect(context.close).toHaveBeenCalledOnce();
  });
});
