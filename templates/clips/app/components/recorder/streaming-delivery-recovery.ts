export interface StreamingDeliveryRecoveryOptions {
  canRecover: () => boolean;
  recover: (restartRequired: boolean) => Promise<void>;
  onPermanentFailure: (error: Error) => void;
  onSettled: () => void;
}

export class StreamingDeliveryRecovery {
  private active = false;
  private attempt: Promise<void> | null = null;
  private timer: number | null = null;
  private wake: (() => void) | null = null;
  private attempts = 0;
  private paused = false;
  private restartRequired = false;
  private generation = 0;

  constructor(private readonly opts: StreamingDeliveryRecoveryOptions) {}

  get isActive(): boolean {
    return this.active;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  isBrowserOffline(): boolean {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  isRecoverableFailure(error: Error): boolean {
    const details = error as Error & {
      status?: unknown;
      restartRequired?: unknown;
      transport?: unknown;
    };
    return (
      details.restartRequired === true ||
      details.transport === true ||
      (typeof details.status === "number" &&
        [408, 425, 429, 500, 502, 503, 504].includes(details.status))
    );
  }

  pause(error?: Error): void {
    this.restartRequired ||=
      (error as { restartRequired?: unknown })?.restartRequired === true;
    if (this.paused) return;
    this.paused = true;
    this.registerWake();
    this.schedule(true);
  }

  reset(): void {
    this.generation += 1;
    this.clear();
    this.active = false;
    this.attempt = null;
    this.attempts = 0;
    this.paused = false;
    this.restartRequired = false;
  }

  clear(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.wake) return;
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
    this.wake = null;
  }

  async drainForStop(): Promise<void> {
    this.clearTimer();
    await this.attempt;
    this.clearTimer();
    if (!this.paused) return;
    await this.runAttempt(false, this.generation);
    if (!this.paused) return;
    this.clear();
    this.paused = false;
    this.restartRequired = false;
    throw new Error(
      "Upload failed while reconnecting. Retry uploading your recording.",
    );
  }

  private schedule(immediate = false): void {
    if (this.timer !== null || this.active || !this.opts.canRecover()) return;
    const delay = immediate
      ? 0
      : Math.min(30_000, 500 * 2 ** this.attempts++) *
        (0.5 + Math.random() * 0.5);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.retry();
    }, delay);
  }

  private async retry(): Promise<void> {
    if (this.active || !this.opts.canRecover()) return;
    const generation = this.generation;
    const attempt = this.runAttempt(true, generation);
    this.attempt = attempt;
    try {
      await attempt;
    } finally {
      if (generation !== this.generation) return;
      if (this.attempt === attempt) this.attempt = null;
    }
  }

  private async runAttempt(
    skipWhileOffline: boolean,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation) return;
    if (skipWhileOffline && this.isBrowserOffline()) {
      this.schedule();
      return;
    }

    this.active = true;
    let shouldRetry = false;
    try {
      await this.opts.recover(this.restartRequired);
      if (generation !== this.generation) return;
      this.attempts = 0;
      this.paused = false;
      this.restartRequired = false;
      this.clear();
    } catch (error) {
      if (generation !== this.generation) return;
      const failure = error instanceof Error ? error : new Error(String(error));
      if (failure.name === "AbortError") return;
      if (this.isRecoverableFailure(failure)) {
        shouldRetry = true;
        return;
      }
      this.stop(failure);
    } finally {
      if (generation !== this.generation) return;
      this.active = false;
      if (shouldRetry) this.schedule();
      this.opts.onSettled();
    }
  }

  private stop(error: Error): void {
    this.clear();
    this.paused = false;
    this.restartRequired = false;
    this.opts.onPermanentFailure(error);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
  }

  private registerWake(): void {
    if (this.wake || typeof window === "undefined") return;
    this.wake = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      this.clearTimer();
      this.schedule(true);
    };
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
  }
}
