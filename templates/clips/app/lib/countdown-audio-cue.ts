export interface CountdownAudioCue {
  play(): Promise<void>;
  cleanup(): void;
}

const noopCountdownAudioCue: CountdownAudioCue = {
  async play() {},
  cleanup() {},
};

/**
 * A soft, modern "ready" chime: a rising two-note (D5 → A5) with a faint high
 * shimmer. Each voice has a fast attack and a smooth exponential tail so it
 * reads as a gentle confirmation rather than a harsh beep. Kept under ~380ms so
 * it lands cleanly just before capture.
 */
function scheduleCountdownTone(ctx: AudioContext): Promise<void> {
  return new Promise<void>((resolve) => {
    const t0 = ctx.currentTime + 0.005;
    const voices = [
      { freq: 587.33, at: 0.0, dur: 0.22, peak: 0.06 }, // D5
      { freq: 880.0, at: 0.06, dur: 0.26, peak: 0.075 }, // A5
      { freq: 1760.0, at: 0.065, dur: 0.14, peak: 0.02 }, // A6 shimmer
    ];

    let lastStop = t0;
    for (const voice of voices) {
      const startAt = t0 + voice.at;
      const stopAt = startAt + voice.dur;
      lastStop = Math.max(lastStop, stopAt);

      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(voice.freq, startAt);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(voice.peak, startAt + 0.012);
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

export function createCountdownAudioCue(): CountdownAudioCue {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return noopCountdownAudioCue;

    const ctx = new AudioCtx();
    let played = false;
    let closed = false;
    let idleTimer: number | null = null;

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
      if (played || closed) return;
      played = true;
      try {
        if (ctx.state !== "running") await ctx.resume();
        if (closed) return;
        await scheduleCountdownTone(ctx);
      } catch (err) {
        console.warn("[recorder] countdown cue unavailable:", err);
        cleanup();
      }
    };

    // Unlock while we're still inside the user's record gesture. If the
    // recording never reaches countdown, clean it up quietly later.
    ctx.resume().catch((err) => {
      console.warn("[recorder] AudioContext resume failed:", err);
    });
    idleTimer = window.setTimeout(cleanup, 5 * 60_000);

    return { play, cleanup };
  } catch (err) {
    console.warn("[recorder] countdown cue unavailable:", err);
    return noopCountdownAudioCue;
  }
}
