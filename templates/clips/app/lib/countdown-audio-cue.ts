import { scheduleReadyChime } from "@shared/recording-audio";

export interface CountdownAudioCue {
  play(): Promise<void>;
  cleanup(): void;
}

const noopCountdownAudioCue: CountdownAudioCue = {
  async play() {},
  cleanup() {},
};

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
        await scheduleReadyChime(ctx);
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
