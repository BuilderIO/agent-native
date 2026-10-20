declare const GPUBufferUsage: Readonly<{
  QUERY_RESOLVE: number;
  COPY_SRC: number;
  COPY_DST: number;
  MAP_READ: number;
}>;
declare const GPUMapMode: Readonly<{ READ: number }>;

export type NativeGpuProfile = {
  kind: "ready";
  frameIndex: number;
  passCount: number;
  gpuPassSumMs: number;
  passes: readonly { label: string; gpuMs: number }[];
  estimatedResourceBytes: number;
};

export type NativeGpuProfileState =
  | NativeGpuProfile
  | {
      kind: "unavailable";
      code:
        | "timestamp-query-unavailable"
        | "device-lost"
        | "disposed"
        | "target-unavailable";
    }
  | { kind: "pending"; estimatedResourceBytes: number }
  | {
      kind: "error";
      code: "capacity" | "read-failed" | "invalid-timestamps";
      estimatedResourceBytes: number;
    };

export type NativeGpuSampleEvent =
  | { kind: "submitted" | "abandoned" | "capacity"; frameIndex: number }
  | {
      kind: "completed";
      frameIndex: number;
      result:
        | NativeGpuProfile
        | Extract<NativeGpuProfileState, { kind: "error" }>;
    };

export type NativeGpuSample = {
  readonly frameIndex: number;
  readonly slot: number;
  readonly generation: number;
};

export type NativeGpuSampleStart =
  | { kind: "sample"; sample: NativeGpuSample }
  | { kind: "skipped"; code: "sparse" | "capacity" | "unavailable" };

export type NativeGpuPassReservation =
  | {
      kind: "pass";
      label: string;
      timestampWrites: GPURenderPassTimestampWrites;
    }
  | { kind: "skipped"; code: "capacity" | "unavailable" };

type Slot = {
  querySet: GPUQuerySet;
  resolve: GPUBuffer;
  readback: GPUBuffer;
  phase: "idle" | "recording" | "submitted" | "mapping";
  passCount: number;
  overflowed: boolean;
  labels: string[];
  frameIndex: number;
  generation: number;
};

const MAX_PASS_COUNT = 32;
const MAX_RING_SLOTS = 4;
const MAX_SAMPLE_INTERVAL = 600;
const MAX_GPU_PASS_NS = 60_000_000_000n;

export function nativeGpuTimestampFeature(
  adapter: GPUAdapter,
): GPUFeatureName[] {
  return adapter.features.has("timestamp-query") ? ["timestamp-query"] : [];
}

export class NativeGpuProfiler {
  private readonly slots: Slot[] = [];
  private readonly maxPasses: number;
  private readonly sampleEveryFrames: number;
  private readonly bytes: number;
  private state: NativeGpuProfileState;
  private generation = 1;
  private stateFrameIndex = -1;
  private disposed = false;
  private readonly onSampleEvent?: (event: NativeGpuSampleEvent) => void;

  constructor(
    private readonly device: GPUDevice,
    options: {
      sampleEveryFrames?: number;
      maxPassesPerSample?: number;
      ringSlots?: number;
      observeDeviceLoss?: boolean;
      onSampleEvent?: (event: NativeGpuSampleEvent) => void;
    } = {},
  ) {
    this.onSampleEvent = options.onSampleEvent;
    const sampleEveryFrames = options.sampleEveryFrames ?? 60;
    const maxPasses = options.maxPassesPerSample ?? 16;
    const ringSlots = options.ringSlots ?? 3;
    if (
      !Number.isSafeInteger(sampleEveryFrames) ||
      sampleEveryFrames < 1 ||
      sampleEveryFrames > MAX_SAMPLE_INTERVAL
    ) {
      throw new RangeError("Invalid GPU profile sample interval");
    }
    if (
      !Number.isSafeInteger(maxPasses) ||
      maxPasses < 1 ||
      maxPasses > MAX_PASS_COUNT
    ) {
      throw new RangeError("Invalid GPU profile pass count");
    }
    if (
      !Number.isSafeInteger(ringSlots) ||
      ringSlots < 1 ||
      ringSlots > MAX_RING_SLOTS
    ) {
      throw new RangeError("Invalid GPU profile ring size");
    }
    this.sampleEveryFrames = sampleEveryFrames;
    this.maxPasses = maxPasses;
    this.bytes = ringSlots * maxPasses * 2 * 8 * 3;
    this.state = { kind: "unavailable", code: "timestamp-query-unavailable" };
    if (!device.features.has("timestamp-query")) return;
    try {
      for (let index = 0; index < ringSlots; index += 1) {
        const size = maxPasses * 2 * 8;
        const querySet = device.createQuerySet({
          type: "timestamp",
          count: maxPasses * 2,
        });
        let resolve: GPUBuffer | undefined;
        try {
          resolve = device.createBuffer({
            size,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
          });
          const readback = device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          this.slots.push({
            querySet,
            resolve,
            readback,
            phase: "idle",
            passCount: 0,
            overflowed: false,
            labels: [],
            frameIndex: -1,
            generation: this.generation,
          });
        } catch (error) {
          resolve?.destroy();
          querySet.destroy();
          throw error;
        }
      }
      this.state = { kind: "pending", estimatedResourceBytes: this.bytes };
    } catch {
      this.disposeResources();
      this.state = {
        kind: "error",
        code: "read-failed",
        estimatedResourceBytes: this.bytes,
      };
    }
    if (options.observeDeviceLoss !== false)
      void device.lost.then(() => this.dispose("device-lost"));
  }

  latestResult(): NativeGpuProfileState {
    return this.state;
  }

  beginSample(frameIndex: number): NativeGpuSampleStart {
    if (
      this.disposed ||
      this.state.kind === "unavailable" ||
      this.slots.length === 0
    ) {
      return { kind: "skipped", code: "unavailable" };
    }
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0)
      throw new RangeError("Invalid GPU profile frame index");
    if (frameIndex % this.sampleEveryFrames !== 0)
      return { kind: "skipped", code: "sparse" };
    const slotIndex = this.slots.findIndex((slot) => slot.phase === "idle");
    if (slotIndex < 0) {
      this.state = {
        kind: "error",
        code: "capacity",
        estimatedResourceBytes: this.bytes,
      };
      return { kind: "skipped", code: "capacity" };
    }
    const slot = this.slots[slotIndex];
    slot.phase = "recording";
    slot.passCount = 0;
    slot.overflowed = false;
    slot.labels = [];
    slot.frameIndex = frameIndex;
    slot.generation = this.generation;
    return {
      kind: "sample",
      sample: { frameIndex, slot: slotIndex, generation: this.generation },
    };
  }

  timestampWritesForPass(
    sample: NativeGpuSample,
    label: string,
  ): NativeGpuPassReservation {
    const slot = this.recordingSlot(sample);
    if (!slot) return { kind: "skipped", code: "unavailable" };
    if (slot.overflowed || slot.passCount >= this.maxPasses) {
      this.publish(
        {
          kind: "error",
          code: "capacity",
          estimatedResourceBytes: this.bytes,
        },
        sample.frameIndex,
      );
      if (!slot.overflowed)
        this.onSampleEvent?.({
          kind: "capacity",
          frameIndex: sample.frameIndex,
        });
      slot.overflowed = true;
      return { kind: "skipped", code: "capacity" };
    }
    const first = slot.passCount * 2;
    slot.passCount += 1;
    slot.labels.push(label);
    return {
      kind: "pass",
      label,
      timestampWrites: {
        querySet: slot.querySet,
        beginningOfPassWriteIndex: first,
        endOfPassWriteIndex: first + 1,
      },
    };
  }

  finishSample(sample: NativeGpuSample, encoder: GPUCommandEncoder): boolean {
    const slot = this.recordingSlot(sample);
    if (!slot) return false;
    if (slot.passCount === 0) {
      slot.phase = "idle";
      this.onSampleEvent?.({
        kind: "abandoned",
        frameIndex: sample.frameIndex,
      });
      return false;
    }
    const size = slot.passCount * 2 * 8;
    encoder.resolveQuerySet(
      slot.querySet,
      0,
      slot.passCount * 2,
      slot.resolve,
      0,
    );
    encoder.copyBufferToBuffer(slot.resolve, 0, slot.readback, 0, size);
    slot.phase = "submitted";
    return true;
  }

  // Call after queue.submit; mapping is deliberately launched without awaiting the GPU.
  afterSubmit(sample: NativeGpuSample): void {
    const slot = this.slots[sample.slot];
    if (
      !slot ||
      slot.phase !== "submitted" ||
      slot.generation !== sample.generation ||
      slot.frameIndex !== sample.frameIndex
    )
      return;
    slot.phase = "mapping";
    this.onSampleEvent?.({ kind: "submitted", frameIndex: sample.frameIndex });
    void this.read(slot, sample.generation);
  }

  abandonSample(sample: NativeGpuSample): void {
    const slot = this.slots[sample.slot];
    if (
      slot &&
      slot.generation === sample.generation &&
      slot.frameIndex === sample.frameIndex &&
      (slot.phase === "recording" || slot.phase === "submitted")
    ) {
      slot.phase = "idle";
      this.onSampleEvent?.({
        kind: "abandoned",
        frameIndex: sample.frameIndex,
      });
    }
  }

  dispose(reason: "disposed" | "device-lost" = "disposed"): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.disposeResources();
    this.state = { kind: "unavailable", code: reason };
  }

  private publish(state: NativeGpuProfileState, frameIndex: number): void {
    if (frameIndex < this.stateFrameIndex) return;
    this.stateFrameIndex = frameIndex;
    this.state = state;
  }

  private recordingSlot(sample: NativeGpuSample): Slot | undefined {
    const slot = this.slots[sample.slot];
    return slot?.phase === "recording" &&
      slot.frameIndex === sample.frameIndex &&
      slot.generation === sample.generation
      ? slot
      : undefined;
  }

  private async read(slot: Slot, generation: number): Promise<void> {
    let result:
      | Extract<NativeGpuSampleEvent, { kind: "completed" }>["result"]
      | null = null;
    try {
      await slot.readback.mapAsync(GPUMapMode.READ);
      if (this.disposed || generation !== this.generation) return;
      if (slot.overflowed) {
        result = {
          kind: "error",
          code: "capacity",
          estimatedResourceBytes: this.bytes,
        };
      } else {
        const times = new BigUint64Array(
          slot.readback.getMappedRange(0, slot.passCount * 2 * 8),
        );
        let sum = 0n;
        const passes: { label: string; gpuMs: number }[] = [];
        for (let index = 0; index < slot.passCount; index += 1) {
          const begin = times[index * 2];
          const end = times[index * 2 + 1];
          if (end < begin || end - begin > MAX_GPU_PASS_NS) {
            result = {
              kind: "error",
              code: "invalid-timestamps",
              estimatedResourceBytes: this.bytes,
            };
            break;
          }
          sum += end - begin;
          passes.push({
            label: slot.labels[index],
            gpuMs: Number(end - begin) / 1_000_000,
          });
        }
        result ??= {
          kind: "ready",
          frameIndex: slot.frameIndex,
          passCount: slot.passCount,
          gpuPassSumMs: Number(sum) / 1_000_000,
          passes,
          estimatedResourceBytes: this.bytes,
        };
      }
    } catch {
      if (!this.disposed && generation === this.generation)
        result = {
          kind: "error",
          code: "read-failed",
          estimatedResourceBytes: this.bytes,
        };
    } finally {
      if (!this.disposed && generation === this.generation) {
        try {
          slot.readback.unmap();
        } catch {
          result = {
            kind: "error",
            code: "read-failed",
            estimatedResourceBytes: this.bytes,
          };
        }
        slot.phase = "idle";
        if (result) {
          this.publish(result, slot.frameIndex);
          // Every completion belongs to a window even when it is older than latestResult.
          this.onSampleEvent?.({
            kind: "completed",
            frameIndex: slot.frameIndex,
            result,
          });
        }
      }
    }
  }

  private disposeResources(): void {
    for (const slot of this.slots) {
      if (slot.readback.mapState === "mapped") slot.readback.unmap();
      slot.querySet.destroy();
      slot.resolve.destroy();
      slot.readback.destroy();
      slot.phase = "idle";
    }
    this.slots.length = 0;
  }
}
