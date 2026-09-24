// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => (key === "preRecord.noAudio" ? "No audio" : key),
}));

vi.mock("@shared/live-waveform", () => ({
  LiveWaveform: ({
    level,
    dimmed,
  }: {
    level: number | null;
    dimmed: boolean;
  }) => (
    <span
      data-waveform
      data-level={level === null ? "null" : String(level)}
      data-dimmed={String(dimmed)}
    />
  ),
}));

vi.mock("@shared/recording-playhead", () => ({
  RecordingPlayhead: ({ meter }: { meter: React.ReactNode }) => (
    <div data-playhead>{meter}</div>
  ),
}));

import { RecordingToolbar } from "./recording-toolbar";

class MockTrack extends EventTarget {
  readyState: MediaStreamTrackState = "live";
  stop = vi.fn();

  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

class MockStream {
  constructor(readonly tracks: MediaStreamTrack[]) {}
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

describe("RecordingToolbar live microphone meter", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let track: MockTrack;
  let sampleValue: number;
  let contexts: Array<{
    close: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    sourceDisconnect: ReturnType<typeof vi.fn>;
    analyserDisconnect: ReturnType<typeof vi.fn>;
  }>;
  let audioContextCtor: typeof AudioContext;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => Date.now(),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    cancelAnimationFrameSpy = vi.fn((id: number) => window.clearTimeout(id));
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameSpy);
    vi.stubGlobal("MediaStream", MockStream);

    sampleValue = 128;
    contexts = [];
    class MockAudioContext {
      state: AudioContextState = "running";
      close = vi.fn().mockImplementation(async () => {
        this.state = "closed";
      });
      resume = vi.fn().mockResolvedValue(undefined);
      sourceDisconnect = vi.fn();
      analyserDisconnect = vi.fn();

      constructor() {
        contexts.push(this);
      }

      createMediaStreamSource() {
        return {
          connect: vi.fn(),
          disconnect: this.sourceDisconnect,
        };
      }

      createAnalyser() {
        return {
          fftSize: 512,
          smoothingTimeConstant: 0,
          getByteTimeDomainData: (data: Uint8Array) => data.fill(sampleValue),
          disconnect: this.analyserDisconnect,
        };
      }
    }
    audioContextCtor = MockAudioContext as unknown as typeof AudioContext;
    vi.stubGlobal("AudioContext", audioContextCtor);

    track = new MockTrack();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function renderToolbar({
    active = true,
    isPaused = false,
    microphoneEnabled = true,
    microphoneTrack = track as unknown as MediaStreamTrack,
    readMicrophoneTrack,
  }: {
    active?: boolean;
    isPaused?: boolean;
    microphoneEnabled?: boolean;
    microphoneTrack?: MediaStreamTrack | null;
    readMicrophoneTrack?: () => MediaStreamTrack | null;
  } = {}) {
    await act(async () => {
      root?.render(
        <RecordingToolbar
          active={active}
          getElapsedMs={() => 0}
          getMicrophoneTrack={readMicrophoneTrack ?? (() => microphoneTrack)}
          microphoneEnabled={microphoneEnabled}
          isPaused={isPaused}
          onTogglePause={vi.fn()}
          onStop={vi.fn()}
          onCancel={vi.fn()}
          onConfirmAction={vi.fn()}
          onConfirmChange={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
  }

  function waveform() {
    return container.querySelector<HTMLElement>("[data-waveform]");
  }

  function noAudioWarning() {
    return container.querySelector<HTMLElement>(
      '[role="status"][aria-label="No audio"]',
    );
  }

  it("drives the waveform from audible microphone samples", async () => {
    sampleValue = 180;
    await renderToolbar();
    await act(async () => vi.advanceTimersByTime(20));

    expect(Number(waveform()?.dataset.level)).toBeGreaterThan(0);
    expect(waveform()?.dataset.dimmed).toBe("false");
    expect(noAudioWarning()).toBeNull();
  });

  it("treats sub-threshold input as zero without warning before the grace period", async () => {
    sampleValue = 129;
    await renderToolbar();
    await act(async () => vi.advanceTimersByTime(4_900));

    expect(waveform()?.dataset.level).toBe("0");
    expect(noAudioWarning()).toBeNull();
  });

  it("replaces the waveform with an accessible warning after sustained silence", async () => {
    await renderToolbar();
    await act(async () => vi.advanceTimersByTime(5_100));

    expect(waveform()).toBeNull();
    expect(noAudioWarning()?.querySelector("svg")).not.toBeNull();
    expect(noAudioWarning()?.style.color).toBe("var(--playhead-rec)");
  });

  it("clears on audible input and restarts the grace period when silence resumes", async () => {
    await renderToolbar();
    await act(async () => vi.advanceTimersByTime(5_100));
    expect(noAudioWarning()).not.toBeNull();

    sampleValue = 180;
    await act(async () => vi.advanceTimersByTime(20));
    expect(noAudioWarning()).toBeNull();
    expect(Number(waveform()?.dataset.level)).toBeGreaterThan(0);

    sampleValue = 128;
    await act(async () => vi.advanceTimersByTime(4_900));
    expect(noAudioWarning()).toBeNull();
    expect(waveform()?.dataset.level).toBe("0");

    await act(async () => vi.advanceTimersByTime(200));
    expect(noAudioWarning()).not.toBeNull();
  });

  it("holds the meter flat and dim while paused or stopped", async () => {
    sampleValue = 180;
    await renderToolbar();
    await act(async () => vi.advanceTimersByTime(20));
    expect(Number(waveform()?.dataset.level)).toBeGreaterThan(0);

    await renderToolbar({ isPaused: true });
    expect(waveform()?.dataset.level).toBe("null");
    expect(waveform()?.dataset.dimmed).toBe("true");
    expect(noAudioWarning()).toBeNull();

    await renderToolbar({ active: false });
    expect(waveform()?.dataset.level).toBe("null");
    expect(waveform()?.dataset.dimmed).toBe("true");
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
  });

  it("warns immediately without creating an analyser when recording opted out of microphone audio", async () => {
    await renderToolbar({
      microphoneEnabled: false,
      microphoneTrack: null,
    });

    expect(contexts).toHaveLength(0);
    expect(waveform()).toBeNull();
    expect(noAudioWarning()).not.toBeNull();
    expect(noAudioWarning()?.style.color).toBe("var(--playhead-rec)");

    await act(async () => vi.advanceTimersByTime(6_000));
    expect(noAudioWarning()).not.toBeNull();
    expect(contexts).toHaveLength(0);

    await renderToolbar({
      isPaused: true,
      microphoneEnabled: false,
      microphoneTrack: null,
    });
    expect(noAudioWarning()).toBeNull();
    expect(waveform()?.dataset.dimmed).toBe("true");

    await renderToolbar({
      microphoneEnabled: false,
      microphoneTrack: null,
    });
    expect(noAudioWarning()).not.toBeNull();
    expect(contexts).toHaveLength(0);
  });

  it("warns after the grace period when an enabled microphone track is missing", async () => {
    await renderToolbar({ microphoneEnabled: true, microphoneTrack: null });

    expect(waveform()?.dataset.level).toBe("null");
    expect(noAudioWarning()).toBeNull();

    await act(async () => vi.advanceTimersByTime(4_900));

    expect(contexts).toHaveLength(0);
    expect(waveform()?.dataset.level).toBe("null");
    expect(noAudioWarning()).toBeNull();

    await act(async () => vi.advanceTimersByTime(200));

    expect(waveform()).toBeNull();
    expect(noAudioWarning()?.querySelector("svg")).not.toBeNull();
    expect(noAudioWarning()?.style.color).toBe("var(--playhead-rec)");
  });

  it("attaches a microphone track that appears during the grace period", async () => {
    let currentTrack: MediaStreamTrack | null = null;
    sampleValue = 180;
    await renderToolbar({
      microphoneEnabled: true,
      readMicrophoneTrack: () => currentTrack,
    });

    await act(async () => vi.advanceTimersByTime(2_000));
    expect(contexts).toHaveLength(0);
    expect(waveform()?.dataset.level).toBe("null");
    expect(noAudioWarning()).toBeNull();

    currentTrack = track as unknown as MediaStreamTrack;
    await act(async () => vi.advanceTimersByTime(250));

    expect(contexts).toHaveLength(1);
    expect(Number(waveform()?.dataset.level)).toBeGreaterThan(0);
    expect(noAudioWarning()).toBeNull();
  });

  it("uses the prefixed AudioContext constructor when the standard constructor is unavailable", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", audioContextCtor);
    sampleValue = 180;

    await renderToolbar();
    await act(async () => vi.advanceTimersByTime(20));

    expect(contexts).toHaveLength(1);
    expect(Number(waveform()?.dataset.level)).toBeGreaterThan(0);
    expect(noAudioWarning()).toBeNull();
  });

  it("keeps the meter quiet and static when Web Audio is unsupported", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);

    await renderToolbar();
    await act(async () => vi.advanceTimersByTime(6_000));

    expect(contexts).toHaveLength(0);
    expect(waveform()?.dataset.level).toBe("null");
    expect(noAudioWarning()).toBeNull();
  });

  it("warns immediately and cleans up when a live microphone track ends", async () => {
    await renderToolbar();
    expect(contexts).toHaveLength(1);

    await act(async () => track.end());

    expect(contexts[0]?.sourceDisconnect).toHaveBeenCalledOnce();
    expect(contexts[0]?.analyserDisconnect).toHaveBeenCalledOnce();
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
    expect(cancelAnimationFrameSpy).toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(waveform()).toBeNull();
    expect(noAudioWarning()).not.toBeNull();
    expect(noAudioWarning()?.style.color).toBe("var(--playhead-rec)");

    act(() => root?.unmount());
    root = null;
    expect(contexts[0]?.close).toHaveBeenCalledOnce();
  });
});
