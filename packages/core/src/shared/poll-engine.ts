/**
 * Shared recurring-poll engine used by both `usePollLoop` (client) and
 * `startIntervalJob` (server) so every polling loop in the codebase gets the
 * same three properties for free instead of hand-rolling them per call site:
 *
 * 1. Never overlaps: the next attempt is scheduled via `setTimeout` only
 *    after the current one settles, not on a fixed `setInterval` cadence.
 *    This also avoids the latency `setInterval` + skip-if-busy introduces —
 *    a skipped tick there means waiting a full extra cadence before the next
 *    retry; here the gap after completion is always exactly `intervalMs`.
 * 2. Never stalls silently: every attempt is bounded by a timeout (paired
 *    with an `AbortController` so a `fetch` can actually cancel, not just be
 *    abandoned), and that timeout reports through `onError` the moment it
 *    fires. An attempt that ignores its `signal` keeps holding the loop —
 *    reported, not hidden — because releasing the slot to the next attempt
 *    would trade a visible stall for a silent overlap.
 * 3. Never double-fires: a single internal in-flight flag, owned by this
 *    engine rather than duplicated in every caller.
 */

export interface PollEngineOptions {
  /** Delay in ms before the next attempt. Evaluated fresh before each schedule. */
  intervalMs: number | (() => number);
  /** Per-attempt timeout. Default: `Math.max(timeoutFloorMs, intervalMs * 4)`. */
  timeoutMs?: number | (() => number);
  /** Floor used by the default `timeoutMs`. Default: 10_000. */
  timeoutFloorMs?: number;
  /** Called when an attempt throws or times out. Default: swallow. */
  onError?: (err: unknown) => void;
  /** Run the first attempt immediately on `start()`. Default: true. */
  leading?: boolean;
}

export interface PollEngineHandle {
  /** Arm the loop. No-op if already running. */
  start(): void;
  /** Halt the loop and abort any in-flight attempt; its eventual settlement is a no-op. */
  stop(): void;
  /** Cancel the pending wait and run now. No-op if not running or an attempt is already in flight. */
  pollNow(): void;
  /**
   * Re-arm the pending wait using a freshly resolved `intervalMs`, without
   * running an attempt. Use this when `intervalMs` is a function whose
   * result can change externally (e.g. tab visibility) — otherwise a
   * change only takes effect the next time an attempt completes. No-op if
   * there's no pending wait (not running, or an attempt is in flight).
   */
  reschedule(): void;
  readonly isRunning: boolean;
}

const DEFAULT_TIMEOUT_FLOOR_MS = 10_000;

function resolve(value: number | (() => number)): number {
  return typeof value === "function" ? value() : value;
}

function maybeUnref(timer: unknown): void {
  if (
    timer &&
    typeof timer === "object" &&
    "unref" in timer &&
    typeof (timer as { unref?: unknown }).unref === "function"
  ) {
    (timer as { unref: () => void }).unref();
  }
}

export function createPollEngine(
  attempt: (signal: AbortSignal) => Promise<void>,
  options: PollEngineOptions,
): PollEngineHandle {
  const timeoutFloorMs = options.timeoutFloorMs ?? DEFAULT_TIMEOUT_FLOOR_MS;
  const getTimeoutMs = (): number =>
    options.timeoutMs != null
      ? resolve(options.timeoutMs)
      : Math.max(timeoutFloorMs, resolve(options.intervalMs) * 4);
  const onError = options.onError ?? (() => {});
  const leading = options.leading ?? true;

  let generation = 0;
  let running = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeController: AbortController | null = null;

  function clearTimer(): void {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(gen: number): void {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void tick(gen);
    }, resolve(options.intervalMs));
    maybeUnref(timer);
  }

  async function tick(gen: number): Promise<void> {
    if (gen !== generation || !running) return;
    if (inFlight) {
      // An attempt from a superseded generation is still settling — stop()
      // aborted it but the caller has not returned yet. Its own `finally`
      // sees a stale generation and will not reschedule, so re-arming here
      // is what keeps a stop()/start() cycle (tab hidden then visible) from
      // leaving the engine alive-but-timerless, i.e. permanently dead.
      schedule(gen);
      return;
    }
    inFlight = true;
    const controller = new AbortController();
    activeController = controller;
    const timeoutMs = getTimeoutMs();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    maybeUnref(abortTimer);

    let reported = false;
    const report = (err: unknown): void => {
      if (reported) return;
      reported = true;
      onError(err);
    };

    // The attempt is retained separately from the timeout race below. The
    // timeout reports a slow attempt immediately, but the in-flight slot is
    // only released once the attempt itself settles: releasing on the
    // timeout would let the next tick start while an attempt that ignores
    // `signal` is still doing work, which is the overlap (duplicate external
    // requests, racing writes) this engine exists to prevent. An attempt that
    // never settles blocks further attempts by design — `onError` has already
    // fired, so it is loud rather than silent.
    const settled = Promise.resolve()
      .then(() => attempt(controller.signal))
      .then(
        () => {},
        (err: unknown) => report(err),
      );

    try {
      await Promise.race([
        settled,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () =>
              reject(new Error(`poll attempt timed out after ${timeoutMs}ms`)),
            { once: true },
          );
        }),
      ]);
    } catch (err) {
      report(err);
    } finally {
      await settled;
      clearTimeout(abortTimer);
      if (activeController === controller) activeController = null;
      inFlight = false;
      if (gen === generation && running) schedule(gen);
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      generation++;
      const gen = generation;
      if (leading) void tick(gen);
      else schedule(gen);
    },
    stop(): void {
      running = false;
      generation++;
      clearTimer();
      activeController?.abort();
    },
    pollNow(): void {
      if (!running || inFlight) return;
      clearTimer();
      void tick(generation);
    },
    reschedule(): void {
      if (!running || inFlight || timer == null) return;
      schedule(generation);
    },
    get isRunning(): boolean {
      return running;
    },
  };
}
