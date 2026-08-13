import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MIC_AUDIO_EXPANDER_CLOSE_DB,
  MIC_AUDIO_EXPANDER_FLOOR_GAIN,
  MIC_AUDIO_EXPANDER_INTERVAL_MS,
  MIC_AUDIO_EXPANDER_OPEN_DB,
  MIC_AUDIO_HIGH_PASS_HZ,
  MIC_AUDIO_HUM_NOTCH_FREQUENCIES,
  MIC_AUDIO_HUM_NOTCH_Q,
  createMicAudioCleanup,
} from "./mic-audio-cleanup";

class FakeTrack {
  public readyState: "live" | "ended" = "live";
  public stopCalls = 0;
  stop(): void {
    this.stopCalls += 1;
    this.readyState = "ended";
  }
}

class FakeStream {
  constructor(public readonly tracks: FakeTrack[]) {}

  getAudioTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
}

class FakeAudioParam {
  public value = 0;
  public targetCalls: Array<{
    value: number;
    startTime: number;
    timeConstant: number;
  }> = [];

  setTargetAtTime(value: number, startTime: number, timeConstant: number): void {
    this.value = value;
    this.targetCalls.push({ value, startTime, timeConstant });
  }
}

class FakeNode {
  public connections: unknown[] = [];
  public disconnectCalls = 0;

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

class FakeGainNode extends FakeNode {
  public gain = new FakeAudioParam();
}

class FakeFilterNode extends FakeNode {
  public type: BiquadFilterType = "lowpass";
  public frequency = new FakeAudioParam();
  public Q = new FakeAudioParam();
}

class FakeAnalyserNode extends FakeNode {
  public fftSize = 0;
  public sampleValue = 0;

  getFloatTimeDomainData(dataArray: Float32Array): void {
    dataArray.fill(this.sampleValue);
  }
}

class FakeMediaStreamSourceNode extends FakeNode {}

class FakeMediaStreamDestinationNode extends FakeNode {
  constructor(public readonly stream: FakeStream) {
    super();
  }
}

class FakeAudioContext {
  public state: AudioContextState = "running";
  public currentTime = 17.25;
  public resume = vi.fn(() => Promise.resolve());
  public close = vi.fn(() => Promise.resolve());
  public sourceNodes: FakeMediaStreamSourceNode[] = [];
  public filters: FakeFilterNode[] = [];
  public analyser = new FakeAnalyserNode();
  public destination = new FakeMediaStreamDestinationNode(
    new FakeStream([new FakeTrack()]),
  );
  public gain = new FakeGainNode();

  createAnalyser = vi.fn(() => this.analyser);
  createBiquadFilter = vi.fn(() => {
    const filter = new FakeFilterNode();
    this.filters.push(filter);
    return filter;
  });
  createGain = vi.fn(() => this.gain);
  createMediaStreamDestination = vi.fn(() => this.destination);
  createMediaStreamSource = vi.fn(() => {
    const source = new FakeMediaStreamSourceNode();
    this.sourceNodes.push(source);
    return source;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createMicAudioCleanup", () => {
  it("builds the conservative cleanup graph and tears it down cleanly", () => {
    vi.useFakeTimers();
    const ctx = new FakeAudioContext();
    ctx.analyser.sampleValue = 0;
    const inputStream = new FakeStream([new FakeTrack()]) as unknown as MediaStream;

    const handle = createMicAudioCleanup(inputStream, {
      audioContext: ctx as unknown as AudioContext,
    });

    expect(handle.active).toBe(true);
    expect(handle.stream).toBe(ctx.destination.stream as unknown as MediaStream);
    expect(ctx.sourceNodes).toHaveLength(1);
    expect(ctx.filters).toHaveLength(MIC_AUDIO_HUM_NOTCH_FREQUENCIES.length + 1);

    const [highPass, ...notches] = ctx.filters;
    expect(highPass.type).toBe("highpass");
    expect(highPass.frequency.value).toBe(MIC_AUDIO_HIGH_PASS_HZ);
    expect(highPass.Q.value).toBeCloseTo(0.707);
    expect(notches.map((filter) => filter.frequency.value)).toEqual(
      [...MIC_AUDIO_HUM_NOTCH_FREQUENCIES],
    );
    expect(notches.every((filter) => filter.type === "notch")).toBe(true);
    expect(notches.every((filter) => filter.Q.value === MIC_AUDIO_HUM_NOTCH_Q)).toBe(true);

    expect(ctx.sourceNodes[0].connections[0]).toBe(highPass);
    expect(highPass.connections[0]).toBe(notches[0]);
    expect(notches.at(-1)?.connections[0]).toBe(ctx.gain);
    expect(notches.at(-1)?.connections[1]).toBe(ctx.analyser);
    expect(ctx.gain.connections[0]).toBe(ctx.destination);

    expect(ctx.gain.gain.targetCalls).toHaveLength(0);
    vi.advanceTimersByTime(MIC_AUDIO_EXPANDER_INTERVAL_MS);
    expect(ctx.gain.gain.targetCalls).toHaveLength(1);
    expect(ctx.gain.gain.targetCalls[0]).toMatchObject({
      value: MIC_AUDIO_EXPANDER_FLOOR_GAIN,
      startTime: ctx.currentTime,
      timeConstant: expect.any(Number),
    });
    expect(ctx.gain.gain.targetCalls[0].timeConstant).toBeCloseTo(0.09);

    handle.stop();
    expect(ctx.destination.stream.getTracks()[0].stopCalls).toBe(1);
    expect(ctx.close).not.toHaveBeenCalled();
    expect(ctx.sourceNodes[0].disconnectCalls).toBeGreaterThan(0);
    expect(ctx.gain.disconnectCalls).toBeGreaterThan(0);

    vi.advanceTimersByTime(MIC_AUDIO_EXPANDER_INTERVAL_MS * 2);
    expect(ctx.gain.gain.targetCalls).toHaveLength(1);
  });

  it("falls back to the original stream when the browser cannot build the graph", () => {
    const inputTrack = new FakeTrack();
    const inputStream = new FakeStream([inputTrack]) as unknown as MediaStream;
    const ctx = {
      state: "running" as AudioContextState,
      currentTime: 0,
      resume: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      createAnalyser: undefined,
      createBiquadFilter: vi.fn(),
      createGain: vi.fn(),
      createMediaStreamDestination: vi.fn(),
      createMediaStreamSource: vi.fn(),
    } as unknown as AudioContext;

    const handle = createMicAudioCleanup(inputStream, {
      audioContext: ctx,
    });

    expect(handle.active).toBe(false);
    expect(handle.stream).toBe(inputStream);
    expect(() => handle.stop()).not.toThrow();
    expect(inputTrack.stopCalls).toBe(0);
    expect(ctx.close).not.toHaveBeenCalled();
  });
});
