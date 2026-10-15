export interface AudioCue {
  playBeforeCapture(signal?: AbortSignal): Promise<void>;
  cleanup(): void;
}

type CueOutcome = "played" | "timed_out" | "failed" | "cancelled";

const CUE_PLAY_TIMEOUT_MS = 1000;
const CUE_SETTLE_MS = 80;
const CUE_IDLE_CLEANUP_MS = 5 * 60_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const noopAudioCue: AudioCue = {
  async playBeforeCapture(signal) {
    console.warn(
      `[clips-recorder] start cue outcome=${signal?.aborted ? "cancelled" : "unavailable"}`,
    );
  },
  cleanup() {},
};

async function playBeforeCapture(
  play: () => Promise<void>,
  cleanup: () => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    console.warn("[clips-recorder] start cue outcome=cancelled");
    cleanup();
    return;
  }
  let timer: ReturnType<typeof window.setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  const deadline = performance.now() + CUE_PLAY_TIMEOUT_MS;
  const playback = play().then<CueOutcome, CueOutcome>(
    () => (performance.now() < deadline ? "played" : "timed_out"),
    (err) => {
      console.warn("[clips-recorder] start cue outcome=failed:", err);
      return "failed";
    },
  );
  const timeout = new Promise<CueOutcome>((resolve) => {
    timer = window.setTimeout(() => resolve("timed_out"), CUE_PLAY_TIMEOUT_MS);
  });
  const cancellation = signal
    ? new Promise<CueOutcome>((resolve) => {
        abortHandler = () => resolve("cancelled");
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      })
    : new Promise<CueOutcome>(() => {});
  const outcome = await Promise.race([playback, timeout, cancellation]);
  if (timer !== null && outcome !== "timed_out") {
    window.clearTimeout(timer);
  }
  if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  if (outcome !== "played") {
    if (outcome !== "failed") {
      console.warn(`[clips-recorder] start cue outcome=${outcome}`);
    }
    cleanup();
    return;
  }
  console.info("[clips-recorder] start cue outcome=played");
  await wait(CUE_SETTLE_MS);
}

function scheduleTone(ctx: AudioContext): Promise<void> {
  return new Promise<void>((resolve) => {
    const t0 = ctx.currentTime + 0.005;
    const voices = [
      { freq: 783.99, at: 0.0, dur: 0.26, peak: 0.07, type: "triangle" }, // G5
      { freq: 1046.5, at: 0.11, dur: 0.34, peak: 0.085, type: "triangle" }, // C6
      { freq: 2093.0, at: 0.115, dur: 0.18, peak: 0.022, type: "sine" }, // C7
    ] as const;

    let lastStop = t0;
    for (const voice of voices) {
      const startAt = t0 + voice.at;
      const stopAt = startAt + voice.dur;
      lastStop = Math.max(lastStop, stopAt);

      const oscillator = ctx.createOscillator();
      oscillator.type = voice.type;
      oscillator.frequency.setValueAtTime(voice.freq, startAt);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(voice.peak, startAt + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.02);
    }

    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    window.setTimeout(
      finish,
      Math.ceil((lastStop - ctx.currentTime) * 1000) + 60,
    );
  });
}

export function createAudioCue(): AudioCue {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return noopAudioCue;

    const ctx: AudioContext = new AudioCtx();
    let played = false;
    let playPromise: Promise<void> | null = null;
    let closed = false;
    let idleTimer: ReturnType<typeof window.setTimeout> | null = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (idleTimer) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
      ctx.close().catch(() => {});
    };

    const play = async () => {
      if (closed) throw new Error("Audio cue context is closed");
      if (played) return playPromise ?? Promise.resolve();
      played = true;
      playPromise = (async () => {
        if (ctx.state !== "running") await ctx.resume();
        await scheduleTone(ctx);
      })();
      await playPromise;
    };

    ctx.resume().catch((err) => {
      console.warn("[clips-recorder] AudioContext resume failed:", err);
    });
    idleTimer = window.setTimeout(cleanup, CUE_IDLE_CLEANUP_MS);

    return {
      playBeforeCapture: (signal) => playBeforeCapture(play, cleanup, signal),
      cleanup,
    };
  } catch (err) {
    console.warn("[clips-recorder] start cue unavailable:", err);
    return noopAudioCue;
  }
}
