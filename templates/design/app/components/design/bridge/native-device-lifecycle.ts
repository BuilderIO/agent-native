export class NativeDeviceScope {
  private cleanups: Array<() => void> = [];
  private closed = false;

  get active(): boolean {
    return !this.closed;
  }

  own(cleanup: () => void): void {
    if (this.closed) {
      cleanup();
      return;
    }
    this.cleanups.push(cleanup);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.reverse())
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    this.cleanups = [];
    if (errors.length) {
      const failure = new Error("device-cleanup-failed") as Error & {
        causes: unknown[];
      };
      failure.causes = errors;
      throw failure;
    }
  }
}

export class NativeDeviceLifecycleError extends Error {
  constructor(
    readonly code:
      | "device-disposed"
      | "device-backoff"
      | "device-attempts-exhausted",
  ) {
    super(code);
    this.name = "NativeDeviceLifecycleError";
  }
}

export class NativeDeviceLifecycle<T> {
  private current: { value: T; scope: NativeDeviceScope } | null = null;
  private pending: Promise<T> | null = null;
  private pendingScope: NativeDeviceScope | null = null;
  private attempts = 0;
  private nextRetryAt = 0;
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly create: (scope: NativeDeviceScope) => Promise<T>,
    private readonly now: () => number = () => performance.now(),
    private readonly maxAttempts = 2,
    private readonly backoffMs = 500,
  ) {}

  retryAfterMs(): number {
    return Math.max(0, this.nextRetryAt - this.now());
  }

  exhausted(): boolean {
    return this.attempts >= this.maxAttempts && !this.current;
  }

  acquire(): Promise<T> {
    if (this.disposed)
      return Promise.reject(new NativeDeviceLifecycleError("device-disposed"));
    if (this.current) return Promise.resolve(this.current.value);
    if (this.pending) return this.pending;
    if (this.exhausted())
      return Promise.reject(
        new NativeDeviceLifecycleError("device-attempts-exhausted"),
      );
    if (this.retryAfterMs() > 0)
      return Promise.reject(new NativeDeviceLifecycleError("device-backoff"));

    this.attempts += 1;
    const generation = this.generation;
    const scope = new NativeDeviceScope();
    this.pendingScope = scope;
    let pending!: Promise<T>;
    pending = (async () => {
      try {
        const value = await Promise.resolve().then(() => this.create(scope));
        if (this.disposed)
          throw new NativeDeviceLifecycleError("device-disposed");
        if (generation !== this.generation)
          throw new NativeDeviceLifecycleError("device-backoff");
        this.current = { value, scope };
        return value;
      } catch (error) {
        scope.dispose();
        if (!this.disposed && generation === this.generation)
          this.nextRetryAt =
            this.now() + this.backoffMs * 2 ** (this.attempts - 1);
        throw error;
      } finally {
        if (this.pending === pending) {
          this.pending = null;
          this.pendingScope = null;
        }
      }
    })();
    this.pending = pending;
    return pending;
  }

  lost(value: T): void {
    if (this.current?.value !== value) return;
    const scope = this.current.scope;
    this.current = null;
    this.nextRetryAt =
      this.now() + this.backoffMs * 2 ** Math.max(0, this.attempts - 1);
    scope.dispose();
  }

  reset(): void {
    if (this.disposed) throw new NativeDeviceLifecycleError("device-disposed");
    this.generation += 1;
    this.pending = null;
    const pendingScope = this.pendingScope;
    this.pendingScope = null;
    const scope = this.current?.scope;
    this.current = null;
    this.attempts = 0;
    this.nextRetryAt = 0;
    try {
      pendingScope?.dispose();
    } finally {
      scope?.dispose();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.pending = null;
    const pendingScope = this.pendingScope;
    this.pendingScope = null;
    const scope = this.current?.scope;
    this.current = null;
    try {
      pendingScope?.dispose();
    } finally {
      scope?.dispose();
    }
  }
}
