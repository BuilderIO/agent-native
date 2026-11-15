/**
 * The countdown runs while the recording is still being set up (server
 * recording, start cue, capture warm-up, native begin). When the countdown
 * ends first, the user starts talking but nothing is captured yet: a slow
 * server once cost the first 8 seconds of a take. While capture is not live
 * shortly after the countdown, show "Preparing recording" so nobody talks into
 * a recording that has not started.
 *
 * The caller owns the whole capture-start lifecycle: it calls done() once,
 * from a `finally` that covers everything from the countdown to capture being
 * live (or the start failing / being cancelled). Until then, Preparing may be
 * shown.
 */
/** The start cue (up to 1 s, its timeout) and capture activation follow the
 * countdown on every take; only a wait past that is worth a Preparing screen. */
export const PREPARING_AFTER_COUNTDOWN_DELAY_MS = 1_500;

export interface PreparingAfterCountdown {
  /** Capture is live, or the start failed or was cancelled: never show
   * Preparing from now on, and hide it if it was shown. Safe to call more
   * than once. */
  done(): Promise<void>;
}

export interface PreparingOverlay {
  show(): Promise<void>;
  hide(): Promise<void>;
  delayMs?: number;
}

export function showPreparingAfterCountdown(
  countdown: Promise<unknown>,
  options: PreparingOverlay,
): PreparingAfterCountdown {
  const delayMs = options.delayMs ?? PREPARING_AFTER_COUNTDOWN_DELAY_MS;
  let finished = false;
  let showing: Promise<void> | null = null;
  void countdown.then(
    async () => {
      if (finished) return;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      if (finished) return;
      showing = options.show().catch((err) => {
        console.error("[clips-recorder] showing Preparing failed:", err);
      });
    },
    () => {},
  );
  return {
    // Never waits for the delay: a start that is already live must not be
    // slowed down. Only a "Preparing" that is (being) shown is awaited.
    async done() {
      finished = true;
      const pending = showing;
      if (!pending) return;
      showing = null;
      await pending;
      // A failed hide would leave the full-screen overlay over the recording,
      // so try twice and log it. It never fails the start: capture is live.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await options.hide();
          return;
        } catch (err) {
          console.error(
            `[clips-recorder] hiding Preparing failed (attempt ${attempt}/2):`,
            err,
          );
        }
      }
    },
  };
}
