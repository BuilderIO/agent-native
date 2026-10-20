import {
  NativeGpuProfiler,
  type NativeGpuProfileState,
  type NativeGpuSample,
  type NativeGpuPassReservation,
} from "./native-gpu-profiler";
import {
  NativeGpuSampleWindowCollector,
  type NativeGpuSampleWindow,
} from "./native-gpu-sample-window";

type WindowLease = {
  scope: object;
  definition: string;
  instance: string;
  collector: NativeGpuSampleWindowCollector;
};
export type NativeGpuSampleWindowToken = object;

type Scope = {
  definition: string;
  instance: string;
  profiler: NativeGpuProfiler;
  remaining: number;
};
export type NativeGpuScopedSample = {
  readonly profiler: NativeGpuProfiler;
  readonly sample: NativeGpuSample;
  readonly instanceId: string;
};

export class NativeGpuScopeProfiler {
  private readonly scopes = new Map<object, Scope>();
  private readonly interval: number;
  private readonly maxScopes: number;
  private sequence = 0;
  private window: WindowLease | null = null;
  private latestScope: Scope | null = null;
  private disposed: "disposed" | "device-lost" | null = null;

  constructor(
    private readonly device: GPUDevice,
    options: { sampleEveryFrames?: number; maxScopes?: number } = {},
  ) {
    this.interval = options.sampleEveryFrames ?? 60;
    this.maxScopes = options.maxScopes ?? 256;
    if (
      !Number.isSafeInteger(this.interval) ||
      this.interval < 1 ||
      this.interval > 600
    )
      throw new RangeError("Invalid GPU profile sample interval");
    if (
      !Number.isSafeInteger(this.maxScopes) ||
      this.maxScopes < 1 ||
      this.maxScopes > 256
    )
      throw new RangeError("Invalid GPU profile scope count");
    void device.lost.then(() => this.dispose("device-lost"));
  }

  sampleBoundary(): number {
    return this.sequence - 1;
  }

  beginWindow(
    scope: object,
    definition: string,
    instance: string,
    instanceId: string,
  ): NativeGpuSampleWindowToken {
    if (this.window) throw new Error("GPU sample window already active");
    const entry = this.scopes.get(scope);
    if (
      entry &&
      (entry.definition !== definition || entry.instance !== instance)
    )
      this.forget(scope);
    const collector = new NativeGpuSampleWindowCollector(
      instanceId,
      this.interval,
      this.sampleBoundary(),
      this.device.features.has("timestamp-query"),
    );
    if (this.disposed) collector.invalidate(this.disposed);
    this.window = { scope, definition, instance, collector };
    return this.window;
  }

  startWindowMeasurement(token: NativeGpuSampleWindowToken): number {
    const window = this.window;
    if (!window || window !== token)
      throw new Error("GPU sample window owner changed");
    const boundary = this.sampleBoundary();
    window.collector.startMeasurement(boundary);
    return boundary;
  }

  endWindow(token: NativeGpuSampleWindowToken): NativeGpuSampleWindow {
    const window = this.window;
    if (!window || window !== token)
      throw new Error("GPU sample window owner changed");
    const result = window.collector.finish(this.sampleBoundary());
    this.window = null;
    return result;
  }

  cancelWindow(token: NativeGpuSampleWindowToken): void {
    if (this.window === token) this.window = null;
  }

  latestResult(
    scope?: object,
    definition?: string,
    instance?: string,
  ): NativeGpuProfileState {
    if (this.disposed) return { kind: "unavailable", code: this.disposed };
    if (!this.device.features.has("timestamp-query"))
      return { kind: "unavailable", code: "timestamp-query-unavailable" };
    if (scope) {
      const entry = this.scopes.get(scope);
      if (
        entry &&
        entry.definition === definition &&
        entry.instance === instance
      )
        return entry.profiler.latestResult();
      if (entry) this.forget(scope);
      return this.scopes.size >= this.maxScopes
        ? { kind: "error", code: "capacity", estimatedResourceBytes: 0 }
        : { kind: "pending", estimatedResourceBytes: 0 };
    }
    return (
      this.latestScope?.profiler.latestResult() ?? {
        kind: "pending",
        estimatedResourceBytes: 0,
      }
    );
  }

  beginSample(
    scope: object,
    definition: string,
    instance: string,
    instanceId: string,
  ):
    | { kind: "sample"; sample: NativeGpuScopedSample }
    | { kind: "skipped"; code: "sparse" | "capacity" | "unavailable" } {
    if (this.disposed || !this.device.features.has("timestamp-query"))
      return { kind: "skipped", code: "unavailable" };
    const window = this.window?.scope === scope ? this.window : null;
    if (
      window &&
      (window.definition !== definition || window.instance !== instance)
    )
      window.collector.invalidate("target-changed");
    const selectedWindow =
      window?.definition === definition && window.instance === instance
        ? window
        : null;
    let entry = this.scopes.get(scope);
    if (
      entry &&
      (entry.definition !== definition || entry.instance !== instance)
    ) {
      this.forget(scope);
      entry = undefined;
    }
    if (!entry) {
      if (this.scopes.size >= this.maxScopes) {
        selectedWindow?.collector.capacity();
        return { kind: "skipped", code: "capacity" };
      }
      entry = {
        definition,
        instance,
        profiler: new NativeGpuProfiler(this.device, {
          sampleEveryFrames: 1,
          observeDeviceLoss: false,
          onSampleEvent: (event) => {
            const active = this.window;
            if (
              active?.scope === scope &&
              active.definition === definition &&
              active.instance === instance &&
              this.scopes.get(scope) === entry
            )
              active.collector.onEvent(event);
          },
        }),
        remaining: 0,
      };
      this.scopes.set(scope, entry);
    }
    if (entry.remaining > 0) {
      entry.remaining -= 1;
      return { kind: "skipped", code: "sparse" };
    }
    if (!Number.isSafeInteger(this.sequence))
      throw new RangeError("Invalid GPU profile frame index");
    const reservation = entry.profiler.beginSample(this.sequence++);
    this.latestScope = entry;
    if (reservation.kind === "sample") {
      entry.remaining = this.interval - 1;
      selectedWindow?.collector.reserve(reservation.sample.frameIndex);
      return {
        kind: "sample",
        sample: {
          profiler: entry.profiler,
          sample: reservation.sample,
          instanceId,
        },
      };
    }
    // A full ring stays due until a slot drains; capacity is not a successful sample.
    if (reservation.code === "capacity") selectedWindow?.collector.capacity();
    if (reservation.code === "unavailable")
      selectedWindow?.collector.invalidate("profile-unavailable");
    return reservation;
  }

  timestampWritesForPass(
    sample: NativeGpuScopedSample,
    label: string,
  ): NativeGpuPassReservation {
    return sample.profiler.timestampWritesForPass(
      sample.sample,
      `${sample.instanceId}:${label}`,
    );
  }
  finishSample(
    sample: NativeGpuScopedSample,
    encoder: GPUCommandEncoder,
  ): boolean {
    return sample.profiler.finishSample(sample.sample, encoder);
  }
  afterSubmit(sample: NativeGpuScopedSample): void {
    sample.profiler.afterSubmit(sample.sample);
  }
  abandonSample(sample: NativeGpuScopedSample): void {
    sample.profiler.abandonSample(sample.sample);
  }
  forget(scope: object): void {
    if (this.window?.scope === scope)
      this.window.collector.invalidate("target-changed");
    const entry = this.scopes.get(scope);
    if (!entry) return;
    entry.profiler.dispose();
    if (this.latestScope === entry) this.latestScope = null;
    this.scopes.delete(scope);
  }
  dispose(reason: "disposed" | "device-lost" = "disposed"): void {
    if (this.disposed) return;
    this.disposed = reason;
    this.window?.collector.invalidate(reason);
    for (const entry of this.scopes.values()) entry.profiler.dispose(reason);
    this.scopes.clear();
    this.latestScope = null;
  }
}
