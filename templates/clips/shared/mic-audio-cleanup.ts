/**
 * Conservative browser-side mic cleanup for Clips recorders.
 *
 * The goal is not to "fix" bad audio with a heavy denoiser. Instead we trim
 * obvious AC rumble, notch the mains hum that sits under cheap mics, and only
 * apply a gentle downward expander when the signal is already quiet.
 *
 * Safe failure rule: if the browser does not support the needed Web Audio
 * pieces, or if graph setup fails for any reason, callers get the original
 * stream back with a no-op cleanup handle rather than a thrown error.
 */

export const MIC_AUDIO_HIGH_PASS_HZ = 70;
export const MIC_AUDIO_HUM_NOTCH_FREQUENCIES = [50, 60] as const;
export const MIC_AUDIO_HUM_NOTCH_Q = 35;
export const MIC_AUDIO_EXPANDER_INTERVAL_MS = 40;
export const MIC_AUDIO_EXPANDER_FLOOR_GAIN = 0.24;
export const MIC_AUDIO_EXPANDER_OPEN_DB = -42;
export const MIC_AUDIO_EXPANDER_CLOSE_DB = -58;
export const MIC_AUDIO_EXPANDER_SMOOTHING_SECONDS = 0.09;

export type MicAudioCleanupPreset = "balanced" | "strong";

export interface MicAudioCleanupOptions {
  audioContext?: AudioContext | null;
  preset?: MicAudioCleanupPreset;
  intervalMs?: number;
}

export interface MicAudioCleanupHandle {
  readonly inputStream: MediaStream;
  readonly stream: MediaStream;
  readonly active: boolean;
  stop(): void;
}

type AudioContextLike = Pick<
  AudioContext,
  | "state"
  | "currentTime"
  | "resume"
  | "close"
  | "createAnalyser"
  | "createBiquadFilter"
  | "createGain"
  | "createMediaStreamDestination"
  | "createMediaStreamSource"
>;

type AudioNodeLike = {
  connect(destination: unknown): unknown;
  disconnect(): void;
};

type GainNodeLike = AudioNodeLike & {
  gain: AudioParam & {
    setTargetAtTime?: (
      value: number,
      startTime: number,
      timeConstant: number,
    ) => void;
  };
};

type BiquadFilterNodeLike = AudioNodeLike & {
  type: BiquadFilterType;
  frequency: AudioParam;
  Q: AudioParam;
};

type AnalyserNodeLike = AudioNodeLike & {
  fftSize: number;
  getFloatTimeDomainData: (dataArray: Float32Array) => void;
};

type MediaStreamDestinationNodeLike = AudioNodeLike & {
  stream: MediaStream;
};

type MediaStreamSourceNodeLike = AudioNodeLike;

interface MicAudioCleanupRuntime {
  ctx: AudioContextLike;
  ownsContext: boolean;
  source: MediaStreamSourceNodeLike;
  highPass: BiquadFilterNodeLike;
  notches: BiquadFilterNodeLike[];
  gain: GainNodeLike;
  analyser: AnalyserNodeLike;
  destination: MediaStreamDestinationNodeLike;
  intervalId: ReturnType<typeof setInterval>;
}

function getAudioContextCtor(): typeof AudioContext | null {
  const global = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return global.AudioContext ?? global.webkitAudioContext ?? null;
}

function normalizePreset(preset: MicAudioCleanupPreset | undefined) {
  return preset === "strong"
    ? {
        floorGain: 0.16,
        openDb: -38,
        closeDb: -56,
        smoothingSeconds: 0.07,
        intervalMs: 32,
      }
    : {
        floorGain: MIC_AUDIO_EXPANDER_FLOOR_GAIN,
        openDb: MIC_AUDIO_EXPANDER_OPEN_DB,
        closeDb: MIC_AUDIO_EXPANDER_CLOSE_DB,
        smoothingSeconds: MIC_AUDIO_EXPANDER_SMOOTHING_SECONDS,
        intervalMs: MIC_AUDIO_EXPANDER_INTERVAL_MS,
      };
}

function hasAudioTrack(stream: MediaStream): boolean {
  try {
    return stream.getAudioTracks().length > 0;
  } catch {
    return false;
  }
}

function buildTargetGain(
  levelDb: number,
  preset: ReturnType<typeof normalizePreset>,
) {
  if (!Number.isFinite(levelDb)) return preset.floorGain;
  if (levelDb >= preset.openDb) return 1;
  if (levelDb <= preset.closeDb) return preset.floorGain;

  const span = preset.openDb - preset.closeDb;
  const t = (levelDb - preset.closeDb) / span;
  // Ease in so the expander stays out of the way until the signal is
  // genuinely quiet, then falls away a little more decisively.
  return preset.floorGain + (1 - preset.floorGain) * t * t;
}

function measureRmsDb(samples: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0;
    sumSquares += sample * sample;
  }
  if (sumSquares <= 0) return Number.NEGATIVE_INFINITY;
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(rms);
}

function disconnectNode(node: AudioNodeLike | null | undefined): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // ignore — cleanup must be best-effort.
  }
}

function stopDestinationStream(stream: MediaStream): void {
  try {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function createInactiveHandle(stream: MediaStream): MicAudioCleanupHandle {
  return {
    inputStream: stream,
    stream,
    active: false,
    stop() {
      // no-op
    },
  };
}

function tryBuildMicAudioCleanup(
  stream: MediaStream,
  options: MicAudioCleanupOptions,
): MicAudioCleanupHandle {
  // The browser path can hand us the actual `AudioContext` instance, while
  // tests can inject a fake object. If neither exists, there is nothing to do.
  const audioContextCtor = getAudioContextCtor();
  const providedContext = options.audioContext ?? null;
  const audioContext: AudioContextLike | null =
    providedContext ?? (audioContextCtor ? new audioContextCtor() : null);
  const ownsContext = !providedContext;

  if (!audioContext || !hasAudioTrack(stream)) {
    return createInactiveHandle(stream);
  }

  const preset = normalizePreset(options.preset);
  const intervalMs = Math.max(
    16,
    Math.round(options.intervalMs ?? preset.intervalMs),
  );
  const supportsNodes =
    typeof audioContext.createAnalyser === "function" &&
    typeof audioContext.createBiquadFilter === "function" &&
    typeof audioContext.createGain === "function" &&
    typeof audioContext.createMediaStreamDestination === "function" &&
    typeof audioContext.createMediaStreamSource === "function";
  if (!supportsNodes) {
    return createInactiveHandle(stream);
  }

  let runtime: MicAudioCleanupRuntime | null = null;
  try {
    const source = audioContext.createMediaStreamSource(stream);
    const highPass = audioContext.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = MIC_AUDIO_HIGH_PASS_HZ;
    highPass.Q.value = 0.707;

    const notches = MIC_AUDIO_HUM_NOTCH_FREQUENCIES.map((frequency) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = "notch";
      filter.frequency.value = frequency;
      filter.Q.value = MIC_AUDIO_HUM_NOTCH_Q;
      return filter;
    });

    const gain = audioContext.createGain();
    gain.gain.value = 1;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const destination = audioContext.createMediaStreamDestination();

    source.connect(highPass);
    let node: AudioNodeLike = highPass;
    for (const notch of notches) {
      node.connect(notch);
      node = notch;
    }
    node.connect(gain);
    node.connect(analyser);
    gain.connect(destination);

    if (
      audioContext.state === "suspended" &&
      typeof audioContext.resume === "function"
    ) {
      void audioContext.resume().catch(() => {});
    }

    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!runtime) return;
      try {
        runtime.analyser.getFloatTimeDomainData(samples);
        const nextGain = buildTargetGain(measureRmsDb(samples), preset);
        const now = runtime.ctx.currentTime;
        if (typeof runtime.gain.gain.setTargetAtTime === "function") {
          runtime.gain.gain.setTargetAtTime(
            nextGain,
            now,
            preset.smoothingSeconds,
          );
        } else {
          runtime.gain.gain.value = nextGain;
        }
      } catch {
        // Keep the recording alive even if the meter path glitches.
      }
    };

    const intervalId = globalThis.setInterval(tick, intervalMs);
    runtime = {
      ctx: audioContext,
      ownsContext,
      source,
      highPass,
      notches,
      gain,
      analyser,
      destination,
      intervalId,
    };

    return {
      inputStream: stream,
      stream: destination.stream,
      active: true,
      stop() {
        if (!runtime) return;
        const current = runtime;
        runtime = null;
        try {
          clearInterval(current.intervalId);
        } catch {
          // ignore
        }
        disconnectNode(current.source);
        disconnectNode(current.highPass);
        for (const notch of current.notches) disconnectNode(notch);
        disconnectNode(current.gain);
        disconnectNode(current.analyser);
        stopDestinationStream(current.destination.stream);
        if (current.ownsContext && typeof current.ctx.close === "function") {
          void current.ctx.close().catch(() => {});
        }
      },
    };
  } catch {
    if (runtime) {
      try {
        clearInterval(runtime.intervalId);
      } catch {
        // ignore
      }
      disconnectNode(runtime.source);
      disconnectNode(runtime.highPass);
      for (const notch of runtime.notches) disconnectNode(notch);
      disconnectNode(runtime.gain);
      disconnectNode(runtime.analyser);
      stopDestinationStream(runtime.destination.stream);
    }
    return createInactiveHandle(stream);
  }
}

export function createMicAudioCleanup(
  stream: MediaStream,
  options: MicAudioCleanupOptions = {},
): MicAudioCleanupHandle {
  try {
    return tryBuildMicAudioCleanup(stream, options);
  } catch {
    return createInactiveHandle(stream);
  }
}
