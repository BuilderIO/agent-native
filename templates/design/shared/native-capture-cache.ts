export class NativeCaptureCacheError extends Error {
  readonly code: "source-capture-stale" | "source-disposed";

  constructor(code: "source-capture-stale" | "source-disposed") {
    super(
      code === "source-disposed"
        ? "The source capture was disposed."
        : "The source changed while its paint was being captured.",
    );
    this.name = "NativeCaptureCacheError";
    this.code = code;
  }
}

interface CaptureEntry<T> {
  revision: number;
  promise: Promise<T>;
  settled: boolean;
  factory: () => Promise<T>;
  onCommit: (value: T) => void;
  onDiscard: (value: T) => void;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  invalidate: (code: NativeCaptureCacheError["code"]) => void;
}

export class NativeCaptureCache<T> {
  private revision = 0;
  private entry: CaptureEntry<T> | null = null;
  private active: CaptureEntry<T> | null = null;
  private scheduled = false;
  private disposed = false;

  invalidate(): void {
    if (this.disposed) return;
    this.revision++;
    this.entry?.invalidate("source-capture-stale");
    this.entry = null;
  }

  read(
    factory: () => Promise<T>,
    onCommit: (value: T) => void,
    onDiscard: (value: T) => void,
  ): Promise<T> {
    if (this.disposed)
      return Promise.reject(new NativeCaptureCacheError("source-disposed"));
    if (this.entry) return this.entry.promise;

    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const entry: CaptureEntry<T> = {
      revision: this.revision,
      promise,
      settled: false,
      factory,
      onCommit,
      onDiscard,
      resolve,
      reject,
      invalidate: (code) => {
        if (entry.settled) return;
        entry.settled = true;
        entry.reject(new NativeCaptureCacheError(code));
      },
    };
    this.entry = entry;
    this.schedule();
    return promise;
  }

  private schedule(): void {
    if (this.scheduled || this.active || !this.entry || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.active || this.disposed) return;
      const entry = this.entry;
      if (!entry || entry.settled) return;
      this.active = entry;
      void this.run(entry);
    });
  }

  private async run(entry: CaptureEntry<T>): Promise<void> {
    try {
      const value = await entry.factory();
      if (
        entry.settled ||
        this.disposed ||
        this.revision !== entry.revision ||
        this.entry !== entry
      ) {
        entry.onDiscard(value);
        if (!entry.settled)
          entry.invalidate(
            this.disposed ? "source-disposed" : "source-capture-stale",
          );
        return;
      }
      entry.onCommit(value);
      entry.settled = true;
      entry.resolve(value);
    } catch (error) {
      if (!entry.settled) {
        entry.settled = true;
        entry.reject(error);
      }
    } finally {
      this.active = null;
      this.schedule();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.entry?.invalidate("source-disposed");
    this.entry = null;
  }
}
