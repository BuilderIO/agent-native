import {
  planNativeFeedback,
  planNativeFeedbackAdvance,
  type NativeFeedbackDefinition,
  type NativeFeedbackPlan,
} from "../../../../shared/native-feedback-plan";
import { assertNativeUniformTiming } from "../../../../shared/native-uniform-timing";
import {
  planNativeFeedbackInteractiveResume,
  type NativeFeedbackResumeClock,
  type NativeFeedbackPlaybackStatus,
} from "./native-feedback-resume";

declare const GPUTextureUsage: Readonly<{
  STORAGE_BINDING: number;
  TEXTURE_BINDING: number;
  COPY_DST: number;
}>;
declare const GPUBufferUsage: Readonly<{
  UNIFORM: number;
  COPY_DST: number;
}>;

export type NativeFeedbackFailureCode =
  | "feedback-definition-invalid"
  | "feedback-grid-limit"
  | "feedback-resource-budget"
  | "feedback-time-invalid"
  | "feedback-seek-backward"
  | "feedback-step-limit"
  | "feedback-params-invalid"
  | "feedback-shader-invalid"
  | "feedback-resource-unavailable"
  | "feedback-busy"
  | "feedback-aborted"
  | "feedback-device-lost"
  | "feedback-source-resized"
  | "feedback-target-invalid";

export class NativeFeedbackFailure extends Error {
  readonly code: NativeFeedbackFailureCode;

  constructor(code: NativeFeedbackFailureCode, cause?: unknown) {
    super(code);
    this.name = "NativeFeedbackFailure";
    this.code = code;
    if (cause !== undefined)
      (this as Error & { cause?: unknown }).cause = cause;
  }
}

export interface NativeFeedbackTextureAllocator {
  allocate(
    width: number,
    height: number,
    format: "rgba16float",
    usage: GPUTextureUsageFlags,
  ): GPUTexture;
  release(texture: GPUTexture): void;
}

export interface NativeFeedbackParams {
  intensity: number;
  blockSize: number;
  drift: number;
  churn: number;
  blend: number;
  seed: number;
}

export type NativeFeedbackProfilePass = {
  readonly kind: "compute" | "resolve";
  readonly stepIndex: number;
};

export interface NativeFeedbackEncodeOptions {
  encoder: GPUCommandEncoder;
  source: GPUTexture;
  target: GPUTexture;
  timeSeconds: number;
  initialLocalSeconds?: number;
  mode?: "deterministic" | "interactive";
  speed?: number;
  params: NativeFeedbackParams;
  sourceChanged?: boolean;
  signal?: AbortSignal;
  timestampWritesForPass?: (pass: NativeFeedbackProfilePass) => {
    timestampWrites?: GPURenderPassTimestampWrites;
  };
}

export interface NativeFeedbackEncodedFrame {
  readonly display: GPUTexture;
  readonly steps: number;
  commit(): Promise<void>;
  rejectSubmitted(reason: unknown): Promise<void>;
  abandon(): void;
}

const UNIFORM_BYTES = 32;
const MAX_PENDING_UNIFORM_BYTES = 1_048_576;
function assertAvailable(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new NativeFeedbackFailure("feedback-aborted", signal.reason);
}

function releaseTextures(
  allocator: NativeFeedbackTextureAllocator,
  textures: readonly GPUTexture[],
): unknown[] {
  const failures: unknown[] = [];
  for (const texture of textures) {
    try {
      allocator.release(texture);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function validParams(value: NativeFeedbackParams): boolean {
  return (
    Number.isFinite(value.intensity) &&
    value.intensity >= 0 &&
    value.intensity <= 1 &&
    Number.isFinite(value.blockSize) &&
    value.blockSize >= 30 &&
    value.blockSize <= 150 &&
    Number.isFinite(value.drift) &&
    value.drift >= 0 &&
    value.drift <= 1 &&
    Number.isFinite(value.churn) &&
    value.churn >= 0 &&
    value.churn <= 1 &&
    Number.isFinite(value.blend) &&
    value.blend >= 0 &&
    value.blend <= 1 &&
    Number.isFinite(value.seed) &&
    value.seed >= 0 &&
    value.seed <= 100
  );
}

export class NativeTextureFeedbackExecutor {
  private state: [GPUTexture, GPUTexture];
  private displayTexture: GPUTexture;
  private readIndex: 0 | 1 = 0;
  private completedStep = 0;
  private initializedState = false;
  private interactiveClock: NativeFeedbackResumeClock | null = null;
  private pending = new Set<GPUBuffer>();
  private openTransaction = false;
  private faulted = false;
  private disposed = false;
  private sourceSize: readonly [number, number] | null = null;
  private committedComputeParams:
    | readonly [number, number, number, number, number]
    | null = null;

  private constructor(
    private readonly device: GPUDevice,
    private readonly allocator: NativeFeedbackTextureAllocator,
    private readonly definition: NativeFeedbackDefinition,
    private readonly plan: NativeFeedbackPlan,
    private readonly pipeline: GPUComputePipeline,
    private readonly resolvePipeline: GPURenderPipeline,
    private readonly linearClamp: GPUSampler,
    textures: [GPUTexture, GPUTexture, GPUTexture],
  ) {
    this.state = [textures[0], textures[1]];
    this.displayTexture = textures[2];
  }

  static async create(
    device: GPUDevice,
    allocator: NativeFeedbackTextureAllocator,
    definition: NativeFeedbackDefinition,
    signal?: AbortSignal,
  ): Promise<NativeTextureFeedbackExecutor> {
    assertAvailable(signal);
    const planned = planNativeFeedback(definition, device.limits);
    if (!planned.ok) throw new NativeFeedbackFailure(planned.code);
    const module = device.createShaderModule({ code: definition.computeWgsl });
    const info = await module.getCompilationInfo();
    assertAvailable(signal);
    if (info.messages.some((message) => message.type === "error"))
      throw new NativeFeedbackFailure("feedback-shader-invalid", info.messages);
    let pipeline: GPUComputePipeline;
    try {
      pipeline = await device.createComputePipelineAsync({
        layout: "auto",
        compute: { module, entryPoint: "cs" },
      });
    } catch (error) {
      throw new NativeFeedbackFailure("feedback-shader-invalid", error);
    }
    assertAvailable(signal);
    let resolvePipeline: GPURenderPipeline;
    try {
      const resolveModule = device.createShaderModule({
        code: definition.resolveWgsl,
      });
      const resolveInfo = await resolveModule.getCompilationInfo();
      if (resolveInfo.messages.some((message) => message.type === "error"))
        throw new NativeFeedbackFailure(
          "feedback-shader-invalid",
          resolveInfo.messages,
        );
      resolvePipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: resolveModule, entryPoint: "vs" },
        fragment: {
          module: resolveModule,
          entryPoint: "fs",
          targets: [{ format: "rgba16float" }],
        },
        primitive: { topology: "triangle-list" },
      });
    } catch (error) {
      if (error instanceof NativeFeedbackFailure) throw error;
      throw new NativeFeedbackFailure("feedback-shader-invalid", error);
    }
    assertAvailable(signal);
    const linearClamp = device.createSampler({
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const storageUsage =
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST;
    const textures: GPUTexture[] = [];
    try {
      for (let index = 0; index < 3; index += 1) {
        assertAvailable(signal);
        textures.push(
          allocator.allocate(
            planned.plan.width,
            planned.plan.height,
            "rgba16float",
            storageUsage,
          ),
        );
      }
      return new NativeTextureFeedbackExecutor(
        device,
        allocator,
        definition,
        planned.plan,
        pipeline,
        resolvePipeline,
        linearClamp,
        textures as [GPUTexture, GPUTexture, GPUTexture],
      );
    } catch (error) {
      const cleanupFailures = releaseTextures(allocator, textures);
      if (cleanupFailures.length)
        throw new NativeFeedbackFailure("feedback-resource-unavailable", {
          primary: error,
          cleanupFailures,
        });
      if (error instanceof NativeFeedbackFailure) throw error;
      throw new NativeFeedbackFailure("feedback-resource-unavailable", error);
    }
  }

  get resourceBytes(): number {
    return this.plan.totalTextureBytes + this.pending.size * UNIFORM_BYTES;
  }

  get lastCompletedStep(): number {
    return this.completedStep;
  }

  get playbackStatus(): NativeFeedbackPlaybackStatus | null {
    const clock = this.interactiveClock;
    if (!clock) return null;
    return {
      mode: "interactive",
      disposition: clock.droppedLocalSeconds > 1e-9 ? "clamped" : "exact",
      requestedLocalSeconds: clock.requestedLocalSeconds,
      simulationLocalSeconds: clock.simulationLocalSeconds,
      droppedLocalSeconds: clock.droppedLocalSeconds,
    };
  }

  private ensureUsable(): void {
    if (this.disposed || this.faulted)
      throw new NativeFeedbackFailure("feedback-device-lost");
    if (this.openTransaction) throw new NativeFeedbackFailure("feedback-busy");
  }

  private ensureIdle(): void {
    this.ensureUsable();
    if (this.pending.size) throw new NativeFeedbackFailure("feedback-busy");
  }

  reset(): void {
    this.ensureIdle();
    const storageUsage =
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST;
    const next: GPUTexture[] = [];
    try {
      for (let index = 0; index < 3; index += 1)
        next.push(
          this.allocator.allocate(
            this.plan.width,
            this.plan.height,
            "rgba16float",
            storageUsage,
          ),
        );
    } catch (error) {
      const cleanupFailures = releaseTextures(this.allocator, next);
      throw new NativeFeedbackFailure(
        "feedback-resource-unavailable",
        cleanupFailures.length ? { primary: error, cleanupFailures } : error,
      );
    }
    const old = [...this.state, this.displayTexture];
    this.state = [next[0], next[1]];
    this.displayTexture = next[2];
    this.readIndex = 0;
    this.completedStep = 0;
    this.initializedState = false;
    this.interactiveClock = null;
    this.sourceSize = null;
    this.committedComputeParams = null;
    const cleanupFailures = releaseTextures(this.allocator, old);
    if (cleanupFailures.length)
      throw new NativeFeedbackFailure(
        "feedback-resource-unavailable",
        cleanupFailures,
      );
  }

  encode(options: NativeFeedbackEncodeOptions): NativeFeedbackEncodedFrame {
    this.ensureUsable();
    assertAvailable(options.signal);
    const sourceSize = [options.source.width, options.source.height] as const;
    if (
      options.target === options.source ||
      options.target === this.state[0] ||
      options.target === this.state[1] ||
      options.target === this.displayTexture ||
      options.target.width !== sourceSize[0] ||
      options.target.height !== sourceSize[1] ||
      options.target.format !== "rgba16float"
    )
      throw new NativeFeedbackFailure("feedback-target-invalid");
    if (
      this.sourceSize &&
      (this.sourceSize[0] !== sourceSize[0] ||
        this.sourceSize[1] !== sourceSize[1])
    )
      throw new NativeFeedbackFailure("feedback-source-resized");
    if (!validParams(options.params))
      throw new NativeFeedbackFailure("feedback-params-invalid");
    assertNativeUniformTiming(options.timeSeconds, "time");
    if (options.initialLocalSeconds !== undefined)
      assertNativeUniformTiming(options.initialLocalSeconds, "initial-time");
    if (options.speed !== undefined)
      assertNativeUniformTiming(options.speed, "speed");
    const mode = options.mode ?? "deterministic";
    const resume =
      mode === "interactive"
        ? planNativeFeedbackInteractiveResume({
            requestedLocalSeconds: options.timeSeconds,
            initialLocalSeconds: options.initialLocalSeconds ?? Number.NaN,
            completedStep: this.completedStep,
            speed: options.speed ?? Number.NaN,
            fixedDt: this.definition.timing.fixedDt,
            maxStepsPerCall: this.definition.timing.maxStepsPerCall,
            prior: this.interactiveClock,
          })
        : null;
    if (resume && !resume.ok) throw new NativeFeedbackFailure(resume.code);
    const simulationTimeSeconds = resume?.ok
      ? resume.simulationTimeSeconds
      : options.timeSeconds;
    const advance = planNativeFeedbackAdvance(
      this.definition,
      { completedStep: this.completedStep },
      simulationTimeSeconds,
      mode,
    );
    if (!advance.ok) throw new NativeFeedbackFailure(advance.code);
    const initializeState = !this.initializedState;
    const steps = initializeState ? [0, ...advance.steps] : [...advance.steps];
    const computeParams = [
      options.params.intensity,
      options.params.blockSize,
      options.params.drift,
      options.params.churn,
      options.params.seed,
    ] as const;
    const computeParamsChanged =
      !this.committedComputeParams ||
      computeParams.some(
        (value, index) => value !== this.committedComputeParams?.[index],
      );
    if (steps.length === 0 && (options.sourceChanged || computeParamsChanged))
      steps.push(this.completedStep);
    if (
      this.pending.size * UNIFORM_BYTES + (steps.length + 1) * UNIFORM_BYTES >
      MAX_PENDING_UNIFORM_BYTES
    )
      throw new NativeFeedbackFailure("feedback-resource-budget");
    const uniforms: GPUBuffer[] = [];
    let writeIndex = this.readIndex;
    this.openTransaction = true;
    try {
      for (const stepIndex of steps) {
        assertAvailable(options.signal);
        const inputIndex = writeIndex;
        writeIndex = (1 - inputIndex) as 0 | 1;
        const uniform = this.device.createBuffer({
          size: UNIFORM_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        uniforms.push(uniform);
        const zeroDt = initializeState && stepIndex === 0;
        const dt =
          zeroDt || advance.steps.length === 0
            ? 0
            : this.definition.timing.fixedDt;
        const localTime = zeroDt
          ? 0
          : advance.steps.length === 0
            ? simulationTimeSeconds
            : stepIndex * this.definition.timing.fixedDt;
        assertNativeUniformTiming(localTime, "step-time");
        assertNativeUniformTiming(dt, "delta-time");
        this.device.queue.writeBuffer(
          uniform,
          0,
          new Float32Array([
            localTime,
            dt,
            options.params.seed,
            options.params.intensity,
            options.params.blockSize,
            options.params.drift,
            options.params.churn,
            0,
          ]),
        );
        const group = this.device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: options.source.createView() },
            { binding: 1, resource: this.state[inputIndex].createView() },
            { binding: 2, resource: this.state[writeIndex].createView() },
            { binding: 3, resource: this.displayTexture.createView() },
            { binding: 4, resource: { buffer: uniform } },
          ],
        });
        const pass = options.encoder.beginComputePass(
          options.timestampWritesForPass?.({ kind: "compute", stepIndex }) ??
            {},
        );
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(this.plan.workgroupsX, this.plan.workgroupsY);
        pass.end();
      }
      assertAvailable(options.signal);
      const resolveUniform = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      uniforms.push(resolveUniform);
      this.device.queue.writeBuffer(
        resolveUniform,
        0,
        new Float32Array([options.params.blend, 0, 0, 0, 0, 0, 0, 0]),
      );
      const resolveGroup = this.device.createBindGroup({
        layout: this.resolvePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: options.source.createView() },
          { binding: 1, resource: this.displayTexture.createView() },
          { binding: 2, resource: this.linearClamp },
          { binding: 3, resource: { buffer: resolveUniform } },
        ],
      });
      const resolvePass = options.encoder.beginRenderPass({
        ...options.timestampWritesForPass?.({
          kind: "resolve",
          stepIndex: advance.targetStep,
        }),
        colorAttachments: [
          {
            view: options.target.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      resolvePass.setPipeline(this.resolvePipeline);
      resolvePass.setBindGroup(0, resolveGroup);
      resolvePass.draw(3);
      resolvePass.end();
    } catch (error) {
      for (const uniform of uniforms) uniform.destroy();
      this.openTransaction = false;
      if (error instanceof NativeFeedbackFailure) throw error;
      throw new NativeFeedbackFailure("feedback-resource-unavailable", error);
    }
    let closed = false;
    const abandon = () => {
      if (closed) return;
      closed = true;
      for (const uniform of uniforms) uniform.destroy();
      this.openTransaction = false;
    };
    const retireSubmitted = async (): Promise<void> => {
      for (const uniform of uniforms) this.pending.add(uniform);
      try {
        await this.device.queue.onSubmittedWorkDone();
      } catch (error) {
        this.faulted = true;
        throw new NativeFeedbackFailure("feedback-device-lost", error);
      } finally {
        for (const uniform of uniforms) {
          this.pending.delete(uniform);
          uniform.destroy();
        }
      }
    };
    return {
      display: this.displayTexture,
      steps: steps.length,
      abandon,
      rejectSubmitted: async (reason) => {
        if (closed) throw new NativeFeedbackFailure("feedback-busy");
        closed = true;
        this.faulted = true;
        this.openTransaction = false;
        try {
          await retireSubmitted();
        } catch (error) {
          throw new NativeFeedbackFailure("feedback-device-lost", {
            validation: reason,
            retirement: error,
          });
        }
      },
      commit: async () => {
        if (closed) throw new NativeFeedbackFailure("feedback-busy");
        closed = true;
        if (advance.steps.length || initializeState)
          this.readIndex = writeIndex;
        if (initializeState) this.initializedState = true;
        this.completedStep = advance.targetStep;
        this.interactiveClock = resume?.ok ? resume.nextClock : null;
        this.sourceSize = sourceSize;
        this.committedComputeParams = computeParams;
        this.openTransaction = false;
        await retireSubmitted();
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.openTransaction || this.pending.size)
      throw new NativeFeedbackFailure("feedback-busy");
    this.disposed = true;
    const cleanupFailures = releaseTextures(this.allocator, [
      ...this.state,
      this.displayTexture,
    ]);
    if (cleanupFailures.length)
      throw new NativeFeedbackFailure(
        "feedback-resource-unavailable",
        cleanupFailures,
      );
  }
}
