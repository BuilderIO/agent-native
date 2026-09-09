// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompletionAudioCue } from "./use-completion-audio-cue";

const audioMocks = vi.hoisted(() => ({
  scheduleReadyChime: vi.fn(async () => undefined),
}));

vi.mock("@shared/recording-audio", () => ({
  scheduleReadyChime: audioMocks.scheduleReadyChime,
}));

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: AudioContextState = "suspended";
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

describe("useCompletionAudioCue", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controls: ReturnType<typeof useCompletionAudioCue>;

  function Probe() {
    controls = useCompletionAudioCue();
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    FakeAudioContext.instances = [];
    audioMocks.scheduleReadyChime.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("primes from a gesture and plays one completion chime", async () => {
    act(() => controls.prime());
    const context = FakeAudioContext.instances[0];
    expect(context.resume).toHaveBeenCalledOnce();

    await act(async () => {
      controls.play();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(audioMocks.scheduleReadyChime).toHaveBeenCalledOnce();
    expect(audioMocks.scheduleReadyChime).toHaveBeenCalledWith(context);
    expect(context.close).toHaveBeenCalledOnce();

    act(() => controls.play());
    expect(audioMocks.scheduleReadyChime).toHaveBeenCalledOnce();
  });

  it("closes a primed context when the owner unmounts", () => {
    act(() => controls.prime());
    const context = FakeAudioContext.instances[0];

    act(() => root.unmount());

    expect(context.close).toHaveBeenCalledOnce();
    root = createRoot(container);
  });
});
