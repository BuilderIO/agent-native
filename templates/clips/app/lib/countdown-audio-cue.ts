export interface CountdownAudioCue {
  play(): Promise<void>;
  cleanup(): void;
}

const noopCountdownAudioCue: CountdownAudioCue = {
  async play() {},
  cleanup() {},
};

function scheduleCountdownTone(ctx: AudioContext): Promise<void> {
  return new Promise<void>((resolve) => {
    const startedAt = ctx.currentTime + 0.005;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, startedAt);
    oscillator.frequency.exponentialRampToValueAtTime(660, startedAt + 0.14);

    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.07, startedAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.18);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 500);
    oscillator.addEventListener("ended", finish, { once: true });

    oscillator.start(startedAt);
    oscillator.stop(startedAt + 0.2);
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
