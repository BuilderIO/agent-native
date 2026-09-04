/**
 * Recording-start audio cue.
 *
 * A short, soft "ready" chime played the instant capture begins so the user
 * gets audible confirmation. Two design constraints shape this module:
 *
 *   1. Browser audio needs a user gesture to start. We therefore build the
 *      cue (and `resume()` its AudioContext) inside the start click, then
 *      `play()` it later once streams have settled — the gesture activation
 *      is preserved across that gap.
 *   2. The cue must not bleed into the recording. `cue.playBeforeCapture()`
 *      plays it and waits a short settle before the caller starts the
 *      recorder, so the beep lands just ahead of capture.
 */

export interface AudioCue {
  /**
   * Play the cue (bounded by a timeout) and wait a short settle so the tone
   * sits just before capture rather than inside the recording. Call this at the
   * exact moment recording starts (right before the recorder/native capture is
   * kicked off) so the chime lines up with the real start, not the countdown.
   */
  playBeforeCapture(): Promise<void>;
  cleanup(): void;
}

/** Hard cap on waiting for the cue to finish before we start capturing. */
const CUE_PLAY_TIMEOUT_MS = 450;
/** Quiet gap after the cue so it isn't captured in the recording. */
const CUE_SETTLE_MS = 80;
/** Abandon an unplayed cue (recording never started) after this long. */
const CUE_IDLE_CLEANUP_MS = 5 * 60_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** A cue that does nothing — used when Web Audio is unavailable. */
const noopAudioCue: AudioCue = {
  async playBeforeCapture() {},
  cleanup() {},
};

/**
 * Play `play` bounded by a timeout, then wait a short settle so the tone sits
 * just before capture rather than inside the recording.
 */
async function playBeforeCapture(
  play: () => Promise<void>,
  cleanup: () => void,
): Promise<void> {
  let timedOut = false;
  await Promise.race([
    play(),
    wait(CUE_PLAY_TIMEOUT_MS).then(() => {
      timedOut = true;
    }),
  ]).catch((err) => {
    console.warn("[clips-recorder] start cue unavailable:", err);
  });
  if (timedOut) {
    cleanup();
    return;
  }
  await wait(CUE_SETTLE_MS);
}

/**
 * Schedule the recording-start chime on an already-running context.
 *
 * A warm, bell-like rising two-note "ding-dong" (G5 → C6, a perfect fourth)
 * voiced on triangle oscillators for a rounder, less electronic timbre, with a
 * quiet octave overtone (C7) sparkling on top of the second note. Each note has
 * a soft 18ms attack and a long exponential decay so it rings out gently — a
 * confident "you're rolling" confirmation that sounds nothing like a flat
 * countdown blip. Kept under ~420ms so it still fits inside
 * `CUE_PLAY_TIMEOUT_MS` and lands right as capture begins.
 */
function scheduleTone(ctx: AudioContext): Promise<void> {
  return new Promise<void>((resolve) => {
    const t0 = ctx.currentTime + 0.005;
    const voices = [
      // Rising perfect fourth: a gentle "ding … dong".
      { freq: 783.99, at: 0.0, dur: 0.26, peak: 0.07, type: "triangle" }, // G5
      { freq: 1046.5, at: 0.11, dur: 0.34, peak: 0.085, type: "triangle" }, // C6
      // Faint octave overtone gives the second note a soft bell shimmer.
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
      // Smooth attack/decay envelope — ramps avoid the click of a hard gate.
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(voice.peak, startAt + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.02);
    }

    // Resolve a touch after the final voice ends.
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

/**
 * Create a recording-start cue. Call this inside the user gesture that starts
 * recording so the AudioContext can unlock; then `play()` it once you're ready.
 */
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
      if (played || closed) return playPromise ?? Promise.resolve();
      played = true;
      playPromise = (async () => {
        if (ctx.state !== "running") await ctx.resume();
        await scheduleTone(ctx);
      })();
      try {
        await playPromise;
      } catch (err) {
        console.warn("[clips-recorder] start cue unavailable:", err);
        cleanup();
      }
    };

    // Unlock eagerly inside the gesture; drop the context if never played.
    ctx.resume().catch((err) => {
      console.warn("[clips-recorder] AudioContext resume failed:", err);
    });
    idleTimer = window.setTimeout(cleanup, CUE_IDLE_CLEANUP_MS);

    return {
      playBeforeCapture: () => playBeforeCapture(play, cleanup),
      cleanup,
    };
  } catch (err) {
    console.warn("[clips-recorder] start cue unavailable:", err);
    return noopAudioCue;
  }
}
