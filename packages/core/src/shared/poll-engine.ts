export interface PollEngineOptions {
  intervalMs: number | (() => number);
  timeoutMs?: number | (() => number);
  timeoutFloorMs?: number;
  onError?: (err: unknown) => void;
  leading?: boolean;
}

export interface PollEngineHandle {
  start(): void;
  stop(): void;
  pollNow(): void;
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
