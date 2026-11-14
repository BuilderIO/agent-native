/**
 * The countdown runs while the recording is still being set up (server
 * recording, capture warm-up). When the countdown ends first, the user starts
 * talking but nothing is captured yet: a slow server once cost the first
 * 8 seconds of a take. While capture is not ready shortly after the countdown,
 * show "Preparing recording" so nobody talks into a recording that has not
 * started.
 */
export const PREPARING_AFTER_COUNTDOWN_DELAY_MS = 300;

export interface PreparingAfterCountdown {
  /** Hides "Preparing recording" if it was shown. Call once capture is live
   * or the start failed; safe to call more than once. */
  done(): Promise<void>;
}

export function showPreparingAfterCountdown(
  countdown: Promise<unknown>,
  ready: Promise<unknown>,
  options: {
    show(): Promise<void>;
    hide(): Promise<void>;
    delayMs?: number;
  },
): PreparingAfterCountdown {
  const delayMs = options.delayMs ?? PREPARING_AFTER_COUNTDOWN_DELAY_MS;
  let readySettled = false;
  let finished = false;
  let showing: Promise<void> | null = null;
  void ready.then(
    () => {
      readySettled = true;
    },
    () => {
      readySettled = true;
    },
  );
  void countdown.then(
    async () => {
      if (readySettled || finished) return;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      if (readySettled || finished) return;
      showing = options.show().catch(() => {});
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
