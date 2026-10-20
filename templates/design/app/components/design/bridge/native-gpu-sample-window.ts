import type {
  NativeGpuProfile,
  NativeGpuProfileState,
  NativeGpuSampleEvent,
} from "./native-gpu-profiler";
import {
  nativeBenchmarkStats,
  type NativeBenchmarkStats,
} from "./native-mounted-benchmark";

type FailureCode =
  | "device-lost"
  | "disposed"
  | "target-changed"
  | "history-capacity"
  | "sample-order"
  | "profile-unavailable";
type SampleRecord = {
  frameIndex: number;
  phase: "warmup" | "measurement";
  status: "reserved" | "submitted" | "ready" | "error" | "abandoned";
  profile?: NativeGpuProfile;
  errorCode?: Extract<NativeGpuProfileState, { kind: "error" }>["code"];
};

export type NativeGpuSampleWindow = {
  scope: "sparse-target-mount-command-encoder";
  targetInstanceId: string;
  sampleEveryFrames: number;
  maxSamples: 128;
  warmupAfterFrameIndex: number;
  afterFrameIndex: number;
  throughFrameIndex: number;
  kind: "ready" | "pending" | "unavailable" | "error";
  code:
    | "complete"
    | "readback-pending"
    | "timestamp-query-unavailable"
    | "no-measured-samples"
    | "capacity"
    | "read-failed"
    | "invalid-timestamps"
    | "abandoned-sample"
    | FailureCode;
  samples: SampleRecord[];
  skippedCapacity: { warmup: number; measurement: number };
  omittedSamples: number;
  gpuPassSumMs: NativeBenchmarkStats | null;
};

export class NativeGpuSampleWindowCollector {
  private readonly samples = new Map<number, SampleRecord>();
  private readonly skippedCapacity = { warmup: 0, measurement: 0 };
  private omittedSamples = 0;
  private failure: FailureCode | null = null;
  private afterFrameIndex: number | null = null;
  private closed: NativeGpuSampleWindow | null = null;

  constructor(
    private readonly targetInstanceId: string,
    private readonly sampleEveryFrames: number,
    private readonly warmupAfterFrameIndex: number,
    private readonly timestampsSupported: boolean,
  ) {
    if (
      !targetInstanceId ||
      targetInstanceId.length > 64 ||
      !Number.isSafeInteger(sampleEveryFrames) ||
      sampleEveryFrames < 1 ||
      sampleEveryFrames > 600 ||
      !Number.isSafeInteger(warmupAfterFrameIndex) ||
      warmupAfterFrameIndex < -1
    )
      throw new RangeError("Invalid GPU sample window");
  }

  startMeasurement(afterFrameIndex: number): void {
    if (
      this.closed ||
      this.afterFrameIndex !== null ||
      !Number.isSafeInteger(afterFrameIndex) ||
      afterFrameIndex < this.warmupAfterFrameIndex
    )
      throw new RangeError("Invalid GPU sample window boundary");
    this.afterFrameIndex = afterFrameIndex;
  }

  reserve(frameIndex: number): void {
    if (this.closed || frameIndex <= this.warmupAfterFrameIndex) return;
    if (
      !Number.isSafeInteger(frameIndex) ||
      frameIndex < 0 ||
      this.samples.has(frameIndex)
    ) {
      this.invalidate("sample-order");
      return;
    }
    if (this.samples.size === 128) {
      this.omittedSamples += 1;
      this.invalidate("history-capacity");
      return;
    }
    this.samples.set(frameIndex, {
      frameIndex,
      phase: this.afterFrameIndex === null ? "warmup" : "measurement",
      status: "reserved",
    });
  }

  capacity(): void {
    if (this.closed) return;
    this.skippedCapacity[
      this.afterFrameIndex === null ? "warmup" : "measurement"
    ] += 1;
  }

  onEvent(event: NativeGpuSampleEvent): void {
    if (this.closed || event.frameIndex <= this.warmupAfterFrameIndex) return;
    const sample = this.samples.get(event.frameIndex);
    if (!sample) {
      // An overflow already records an incomplete history; do not retain its later events.
      if (this.failure !== "history-capacity") this.invalidate("sample-order");
      return;
    }
    if (
      event.kind === "capacity" &&
      (sample.status === "reserved" || sample.status === "submitted")
    ) {
      this.skippedCapacity[sample.phase] += 1;
      return;
    }
    if (event.kind === "submitted" && sample.status === "reserved") {
      sample.status = "submitted";
      return;
    }
    if (
      event.kind === "abandoned" &&
      (sample.status === "reserved" || sample.status === "submitted")
    ) {
      sample.status = "abandoned";
      return;
    }
    if (event.kind === "completed" && sample.status === "submitted") {
      if (event.result.kind === "ready") {
        if (
          !Number.isSafeInteger(event.result.passCount) ||
          event.result.passCount < 1 ||
          event.result.passCount > 32 ||
          event.result.passes.length !== event.result.passCount ||
          !Number.isFinite(event.result.gpuPassSumMs) ||
          event.result.gpuPassSumMs < 0 ||
          event.result.gpuPassSumMs > 120_000 ||
          !Number.isSafeInteger(event.result.estimatedResourceBytes) ||
          event.result.estimatedResourceBytes < 0 ||
          event.result.estimatedResourceBytes > 16 * 1024 * 1024 * 1024 ||
          !event.result.passes.every(
            (pass) =>
              pass.label.length >= 1 &&
              pass.label.length <= 140 &&
              Number.isFinite(pass.gpuMs) &&
              pass.gpuMs >= 0 &&
              pass.gpuMs <= 120_000,
          )
        ) {
          this.invalidate("profile-unavailable");
          return;
        }
        if (
          event.result.frameIndex !== event.frameIndex ||
          !event.result.passes.every((pass) =>
            pass.label.startsWith(`${this.targetInstanceId}:`),
          )
        ) {
          this.invalidate("sample-order");
          return;
        }
        sample.status = "ready";
        sample.profile = {
          ...event.result,
          passes: event.result.passes.map((pass) => ({ ...pass })),
        };
      } else {
        sample.status = "error";
        sample.errorCode = event.result.code;
      }
      return;
    }
    this.invalidate("sample-order");
  }

  invalidate(code: FailureCode): void {
    if (!this.closed) this.failure ??= code;
  }

  finish(throughFrameIndex: number): NativeGpuSampleWindow {
    if (this.closed) return this.closed;
    const afterFrameIndex = this.afterFrameIndex;
    if (
      afterFrameIndex === null ||
      !Number.isSafeInteger(throughFrameIndex) ||
      throughFrameIndex < afterFrameIndex
    )
      throw new RangeError("Invalid GPU sample window boundary");
    const samples = [...this.samples.values()].sort(
      (a, b) => a.frameIndex - b.frameIndex,
    );
    if (
      samples.some((sample) => {
        const outsideUpper = throughFrameIndex < sample.frameIndex;
        const beforeOrAtLower = sample.frameIndex <= afterFrameIndex;
        return (
          outsideUpper ||
          (sample.phase === "warmup" ? !beforeOrAtLower : beforeOrAtLower)
        );
      })
    )
      this.invalidate("sample-order");
    const measured = samples.filter((sample) => sample.phase === "measurement");
    let kind: NativeGpuSampleWindow["kind"] = "ready";
    let code: NativeGpuSampleWindow["code"] = "complete";
    if (this.failure) {
      kind =
        this.failure === "device-lost" || this.failure === "disposed"
          ? "unavailable"
          : "error";
      code = this.failure;
    } else if (!this.timestampsSupported) {
      kind = "unavailable";
      code = "timestamp-query-unavailable";
    } else if (this.skippedCapacity.measurement > 0) {
      kind = "error";
      code = "capacity";
    } else if (measured.some((sample) => sample.status === "error")) {
      kind = "error";
      code = measured.find((sample) => sample.status === "error")!.errorCode!;
    } else if (measured.some((sample) => sample.status === "abandoned")) {
      kind = "error";
      code = "abandoned-sample";
    } else if (
      measured.some(
        (sample) =>
          sample.status === "reserved" || sample.status === "submitted",
      )
    ) {
      kind = "pending";
      code = "readback-pending";
    } else if (measured.length === 0) {
      kind = "unavailable";
      code = "no-measured-samples";
    }
    const result: NativeGpuSampleWindow = {
      scope: "sparse-target-mount-command-encoder",
      targetInstanceId: this.targetInstanceId,
      sampleEveryFrames: this.sampleEveryFrames,
      maxSamples: 128,
      warmupAfterFrameIndex: this.warmupAfterFrameIndex,
      afterFrameIndex,
      throughFrameIndex,
      kind,
      code,
      samples,
      skippedCapacity: { ...this.skippedCapacity },
      omittedSamples: this.omittedSamples,
      gpuPassSumMs:
        kind === "ready"
          ? nativeBenchmarkStats(
              measured.map((sample) => sample.profile!.gpuPassSumMs),
            )
          : null,
    };
    for (const sample of samples) {
      if (sample.profile) {
        for (const pass of sample.profile.passes) Object.freeze(pass);
        Object.freeze(sample.profile.passes);
        Object.freeze(sample.profile);
      }
      Object.freeze(sample);
    }
    Object.freeze(samples);
    Object.freeze(result.skippedCapacity);
    if (result.gpuPassSumMs) Object.freeze(result.gpuPassSumMs);
    this.closed = Object.freeze(result);
    this.samples.clear();
    return this.closed;
  }
}
