import type {
  EffectDefinition,
  EffectPass,
  EffectResourceSpec,
} from "../../../../shared/native-effects";

declare const GPUTextureUsage: Readonly<{
  TEXTURE_BINDING: number;
  STORAGE_BINDING: number;
  RENDER_ATTACHMENT: number;
  COPY_SRC: number;
  COPY_DST: number;
}>;
declare const GPUBufferUsage: Readonly<{
  STORAGE: number;
  UNIFORM: number;
  COPY_SRC: number;
  COPY_DST: number;
  MAP_READ: number;
}>;
declare const GPUMapMode: Readonly<{ READ: number }>;

type Resource = GPUTexture | GPUBuffer;
type StateBanks = {
  spec: EffectResourceSpec;
  banks: [Resource, Resource, Resource];
};

export class NativeStatefulResourceError extends Error {
  constructor(
    readonly code: string,
    cause?: unknown,
  ) {
    super(code);
    this.name = "NativeStatefulResourceError";
    if (cause !== undefined)
      (this as Error & { cause?: unknown }).cause = cause;
  }
}

export interface NativeStatefulSourceClock {
  completedStep: number;
  fixedDt: number;
  timeOffset: number;
  speed: number;
  paused: boolean;
}

export function resolveNativeStatefulTargetStep(
  time: number,
  fixedDt: number,
  maxStepIndex: number,
  deterministic: boolean,
): number | null {
  if (
    !Number.isFinite(time) ||
    time < 0 ||
    !Number.isFinite(fixedDt) ||
    fixedDt <= 0 ||
    !Number.isSafeInteger(maxStepIndex) ||
    maxStepIndex < 0
  )
    return null;
  const target = Math.floor(time / fixedDt + 1e-7);
  return Number.isSafeInteger(target) &&
    target >= 0 &&
    (!deterministic || target <= maxStepIndex)
    ? target
    : null;
}

export function planNativeStatefulSourceCaptureTimes(
  clocks: readonly NativeStatefulSourceClock[],
  finalTime: number,
  maxCaptures = 32,
): number[] {
  if (
    !Number.isFinite(finalTime) ||
    finalTime < 0 ||
    !Number.isSafeInteger(maxCaptures) ||
    maxCaptures < 1 ||
    maxCaptures > 32
  )
    throw new NativeStatefulResourceError("stateful-capture-time-invalid");
  const times: number[] = [];
  for (const clock of clocks) {
    if (
      !Number.isSafeInteger(clock.completedStep) ||
      clock.completedStep < -1 ||
      !Number.isFinite(clock.fixedDt) ||
      clock.fixedDt <= 0 ||
      !Number.isFinite(clock.timeOffset) ||
      clock.timeOffset < 0 ||
      !Number.isFinite(clock.speed) ||
      clock.speed < 0
    )
      throw new NativeStatefulResourceError("stateful-capture-time-invalid");
    const target = Math.floor(
      (clock.timeOffset + (clock.paused ? 0 : finalTime * clock.speed)) /
        clock.fixedDt +
        1e-7,
    );
    if (!Number.isSafeInteger(target) || target < clock.completedStep)
      throw new NativeStatefulResourceError("stateful-capture-time-invalid");
    const first = clock.completedStep + 1;
    if (target - first + 1 > maxCaptures + 1)
      throw new NativeStatefulResourceError("stateful-capture-budget-exceeded");
    if (clock.paused || clock.speed === 0) continue;
    for (let step = first; step <= target; step += 1) {
      const time = (step * clock.fixedDt - clock.timeOffset) / clock.speed;
      if (time < -1e-8 || time >= finalTime - 1e-8) continue;
      times.push(Math.max(0, time));
    }
  }
  times.sort((a, b) => a - b);
  const unique = times.filter(
    (time, index) => index === 0 || time - times[index - 1]! > 1e-8,
  );
  if (unique.length > maxCaptures)
    throw new NativeStatefulResourceError("stateful-capture-budget-exceeded");
  return unique;
}

export function acquireNativeStatefulOutput<
  Texture extends { width: number; height: number; format: string },
>(
  resources: Map<string, Texture>,
  outputName: string,
  presented: Texture | null,
  source: Texture | null,
  width: number,
  height: number,
  format: string,
  create: () => Texture,
  retire: (texture: Texture) => void,
): Texture {
  const usable = (texture: Texture | undefined): texture is Texture =>
    !!texture &&
    texture !== presented &&
    texture !== source &&
    texture.width === width &&
    texture.height === height &&
    texture.format === format;
  const oldOutput = resources.get(outputName);
  if (usable(oldOutput)) return oldOutput;
  const back = resources.get("__native_final_back");
  const output = usable(back) ? back : create();
  if (back && back !== presented && back !== source)
    resources.delete("__native_final_back");
  resources.set(outputName, output);
  for (const displaced of new Set([oldOutput, back]))
    if (
      displaced &&
      displaced !== presented &&
      displaced !== source &&
      displaced !== output
    )
      retire(displaced);
  return output;
}

export interface NativeStatefulAllocator {
  texture(
    width: number,
    height: number,
    format: GPUTextureFormat,
    usage: number,
  ): GPUTexture;
  buffer(byteLength: number): GPUBuffer;
  releaseTexture(texture: GPUTexture): void;
  releaseBuffer(buffer: GPUBuffer): void;
  lease(textures: Set<GPUTexture>, buffers: Set<GPUBuffer>): () => void;
}

export interface NativeStatefulEncodeOptions {
  encoder: GPUCommandEncoder;
  source: GPUTexture | null;
  externalTextures?: ReadonlyMap<string, GPUTexture>;
  inputEpochs?: ReadonlyMap<string, number | null>;
  target: GPUTexture;
  pipelines: ReadonlyMap<string, GPURenderPipeline | GPUComputePipeline>;
  passes: readonly EffectPass[];
  steps: readonly number[];
  fixedDt: number;
  seed: number;
  sourceIdentity: string;
  sourceRevision: string;
  sourceEpoch: number | null;
  drawCount(property: string, maximum: number, time: number): number;
  uniforms(
    pass: EffectPass,
    width: number,
    height: number,
    time: number,
    dt: number,
  ): Float32Array;
}

export interface NativeStatefulEncodedFrame {
  output: GPUTexture;
  completedStep: number;
  markSubmitted(): void;
  commit(validateBeforeCommit?: () => void): Promise<void>;
  abandon(): void;
  rejectSubmitted(reason: unknown): Promise<void>;
}

const MAX_SESSION_BYTES = 67_108_864;
const MAX_ENCODED_PASSES = 128;
const MAX_UNIFORM_BYTES = 4_194_304;
const MAX_SNAPSHOT_BYTES = 16_777_216;

function resourceSize(
  spec: EffectResourceSpec,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (spec.kind === "buffer") return spec.byteLength ?? 0;
  const width = spec.size === "fixed" ? (spec.width ?? 0) : viewportWidth;
  const height = spec.size === "fixed" ? (spec.height ?? 0) : viewportHeight;
  return width * height * (spec.format === "rgba16float" ? 8 : 4);
}

function textureSize(
  spec: EffectResourceSpec,
  viewportWidth: number,
  viewportHeight: number,
): [number, number] {
  return spec.size === "fixed"
    ? [spec.width ?? 0, spec.height ?? 0]
    : [viewportWidth, viewportHeight];
}

export class NativeStatefulResourceSession {
  private readonly states = new Map<string, StateBanks>();
  private readonly scratch = new Map<string, Resource>();
  private readonly ownedTextures = new Set<GPUTexture>();
  private readonly ownedBuffers = new Set<GPUBuffer>();
  private committedBank: 0 | 1 | 2 = 0;
  private completed = -1;
  private committedSeed = 0;
  private committedSourceIdentity = "";
  private committedSourceRevision = "";
  private committedSourceEpoch: number | null = null;
  private committedInputEpochs: Record<string, number | null> | null = null;
  private busy = false;
  private disposed = false;
  private faulted = false;
  private readonly sampler: GPUSampler;

  private constructor(
    private readonly device: GPUDevice,
    private readonly allocator: NativeStatefulAllocator,
    readonly resources: ReadonlyMap<string, EffectResourceSpec>,
    readonly outputName: string,
    readonly width: number,
    readonly height: number,
    readonly abi:
      | "stateful-resource-v1"
      | "stateful-resource-v2"
      | "stateful-resource-v3",
  ) {
    this.sampler = device.createSampler({
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  static create(
    device: GPUDevice,
    allocator: NativeStatefulAllocator,
    definition: EffectDefinition,
    width: number,
    height: number,
  ): NativeStatefulResourceSession {
    const graph = definition.resourceGraph;
    if (
      !graph ||
      (graph.abi !== "stateful-resource-v1" &&
        graph.abi !== "stateful-resource-v2" &&
        graph.abi !== "stateful-resource-v3") ||
      !definition.output
    )
      throw new NativeStatefulResourceError("stateful-definition-invalid");
    const resources = new Map(
      (definition.resources ?? []).map((spec) => [spec.name, spec]),
    );
    const session = new NativeStatefulResourceSession(
      device,
      allocator,
      resources,
      definition.output,
      width,
      height,
      graph.abi,
    );
    const stateNames = new Set(graph.stateResources);
    let total = 0;
    for (const pass of definition.passes) {
      const spec = resources.get(pass.output);
      if (!spec || spec.external)
        throw new NativeStatefulResourceError("stateful-definition-invalid");
      const bytes = resourceSize(spec, width, height);
      const replicas =
        spec.name === definition.output ? 0 : stateNames.has(spec.name) ? 3 : 1;
      if (
        !Number.isSafeInteger(bytes) ||
        bytes < 1 ||
        total + bytes * replicas > MAX_SESSION_BYTES
      )
        throw new NativeStatefulResourceError("stateful-resource-budget");
      total += bytes * replicas;
      if (spec.kind === "texture-2d") {
        const [w, h] = textureSize(spec, width, height);
        if (
          w > device.limits.maxTextureDimension2D ||
          h > device.limits.maxTextureDimension2D
        )
          throw new NativeStatefulResourceError("stateful-device-limit");
      } else if (
        bytes > device.limits.maxStorageBufferBindingSize ||
        bytes > device.limits.maxBufferSize
      )
        throw new NativeStatefulResourceError("stateful-device-limit");
    }
    try {
      for (const pass of definition.passes) {
        const spec = resources.get(pass.output)!;
        if (pass.output === definition.output) continue;
        const count = stateNames.has(spec.name) ? 3 : 1;
        const allocated: Resource[] = [];
        for (let index = 0; index < count; index += 1)
          allocated.push(session.allocate(spec));
        if (count === 3)
          session.states.set(spec.name, {
            spec,
            banks: allocated as [Resource, Resource, Resource],
          });
        else session.scratch.set(spec.name, allocated[0]!);
      }
      return session;
    } catch (error) {
      session.dispose();
      throw error;
    }
  }

  private allocate(spec: EffectResourceSpec): Resource {
    if (spec.kind === "buffer") {
      const buffer = this.allocator.buffer(spec.byteLength!);
      this.ownedBuffers.add(buffer);
      return buffer;
    }
    const [width, height] = textureSize(spec, this.width, this.height);
    const texture = this.allocator.texture(
      width,
      height,
      spec.format as GPUTextureFormat,
      GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    );
    this.ownedTextures.add(texture);
    return texture;
  }

  get bytes(): number {
    let total = 0;
    for (const spec of this.resources.values()) {
      if (spec.external) continue;
      total +=
        resourceSize(spec, this.width, this.height) *
        (spec.name === this.outputName
          ? 0
          : this.states.has(spec.name)
            ? 3
            : 1);
    }
    return total;
  }

  get lastCompletedStep(): number {
    return this.completed;
  }
  get textureSet(): ReadonlySet<GPUTexture> {
    return this.ownedTextures;
  }
  get bufferSet(): ReadonlySet<GPUBuffer> {
    return this.ownedBuffers;
  }

  async snapshotState(maxBytes = MAX_SNAPSHOT_BYTES): Promise<{
    scope: "exact-stateful-resource-state";
    completedStep: number;
    seed: number;
    sourceIdentity: string;
    sourceRevision: string;
    sourceEpoch: number | null;
    inputEpochs?: Record<string, number | null>;
    resources: {
      name: string;
      kind: EffectResourceSpec["kind"];
      byteLength: number;
      sha256: string;
    }[];
  }> {
    this.assertUsable();
    if (this.completed < 0)
      throw new NativeStatefulResourceError("stateful-state-uninitialized");
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 0 ||
      maxBytes > MAX_SNAPSHOT_BYTES
    )
      throw new NativeStatefulResourceError("stateful-state-snapshot-budget");
    const total = [...this.states.values()].reduce(
      (sum, state) => sum + resourceSize(state.spec, this.width, this.height),
      0,
    );
    if (total > maxBytes)
      throw new NativeStatefulResourceError("stateful-state-snapshot-budget");
    const readBank = this.committedBank;
    const step = this.completed;
    const releaseLease = this.allocator.lease(
      this.ownedTextures,
      this.ownedBuffers,
    );
    const staging: {
      name: string;
      spec: EffectResourceSpec;
      buffer: GPUBuffer;
      bytesPerRow: number;
      rowBytes: number;
      height: number;
      byteLength: number;
    }[] = [];
    this.busy = true;
    try {
      const encoder = this.device.createCommandEncoder();
      for (const [name, state] of [...this.states].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const { spec } = state;
        const byteLength = resourceSize(spec, this.width, this.height);
        const [width, height] =
          spec.kind === "buffer"
            ? [byteLength, 1]
            : textureSize(spec, this.width, this.height);
        const rowBytes =
          spec.kind === "buffer"
            ? byteLength
            : width * (spec.format === "rgba16float" ? 8 : 4);
        const bytesPerRow =
          spec.kind === "buffer" ? byteLength : Math.ceil(rowBytes / 256) * 256;
        const buffer = this.device.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        staging.push({
          name,
          spec,
          buffer,
          bytesPerRow,
          rowBytes,
          height,
          byteLength,
        });
        if (spec.kind === "buffer")
          encoder.copyBufferToBuffer(
            state.banks[readBank] as GPUBuffer,
            0,
            buffer,
            0,
            byteLength,
          );
        else
          encoder.copyTextureToBuffer(
            { texture: state.banks[readBank] as GPUTexture },
            { buffer, bytesPerRow, rowsPerImage: height },
            { width, height, depthOrArrayLayers: 1 },
          );
      }
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      if (
        this.disposed ||
        this.faulted ||
        this.committedBank !== readBank ||
        this.completed !== step
      )
        throw new NativeStatefulResourceError("stateful-state-snapshot-stale");
      const resources = [];
      for (const item of staging) {
        await item.buffer.mapAsync(GPUMapMode.READ);
        try {
          const mapped = new Uint8Array(item.buffer.getMappedRange());
          const packed = new Uint8Array(item.byteLength);
          for (let row = 0; row < item.height; row += 1)
            packed.set(
              mapped.subarray(
                row * item.bytesPerRow,
                row * item.bytesPerRow + item.rowBytes,
              ),
              row * item.rowBytes,
            );
          const digest = new Uint8Array(
            await crypto.subtle.digest("SHA-256", packed),
          );
          resources.push({
            name: item.name,
            kind: item.spec.kind,
            byteLength: item.byteLength,
            sha256: [...digest]
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(""),
          });
        } finally {
          item.buffer.unmap();
        }
      }
      return {
        scope: "exact-stateful-resource-state",
        completedStep: step,
        seed: this.committedSeed,
        sourceIdentity: this.committedSourceIdentity,
        sourceRevision: this.committedSourceRevision,
        sourceEpoch: this.committedSourceEpoch,
        ...(this.committedInputEpochs
          ? { inputEpochs: { ...this.committedInputEpochs } }
          : {}),
        resources,
      };
    } catch (error) {
      if (error instanceof NativeStatefulResourceError) throw error;
      throw new NativeStatefulResourceError(
        "stateful-state-readback-failed",
        error,
      );
    } finally {
      for (const item of staging) item.buffer.destroy();
      this.busy = false;
      releaseLease();
    }
  }

  private assertUsable(): void {
    if (this.disposed || this.faulted)
      throw new NativeStatefulResourceError("stateful-device-lost");
    if (this.busy) throw new NativeStatefulResourceError("stateful-busy");
  }

  encode(options: NativeStatefulEncodeOptions): NativeStatefulEncodedFrame {
    this.assertUsable();
    const committedSeed = options.seed;
    const committedSourceIdentity = options.sourceIdentity;
    const committedSourceRevision = options.sourceRevision;
    const committedSourceEpoch = options.sourceEpoch;
    const externalNames = [...this.resources.values()]
      .filter((resource) => resource.external)
      .map((resource) => resource.name)
      .sort();
    const externalTextures =
      this.abi === "stateful-resource-v1"
        ? options.source
          ? new Map<string, GPUTexture>([["source", options.source]])
          : undefined
        : options.externalTextures
          ? new Map(options.externalTextures)
          : undefined;
    const inputEpochs = options.inputEpochs
      ? new Map(options.inputEpochs)
      : undefined;
    if (
      !externalTextures ||
      externalTextures.size !== externalNames.length ||
      externalNames.some((name) => !externalTextures.has(name)) ||
      (externalNames.includes("source")
        ? !options.source || externalTextures.get("source") !== options.source
        : options.source !== null) ||
      (this.abi === "stateful-resource-v3" &&
        externalNames.length === 0 &&
        options.sourceEpoch !== null) ||
      ((this.abi === "stateful-resource-v2" ||
        this.abi === "stateful-resource-v3") &&
        (!inputEpochs ||
          inputEpochs.size !== externalNames.length ||
          externalNames.some((name) => {
            const epoch = inputEpochs.get(name);
            return (
              epoch === undefined ||
              (epoch !== null && (!Number.isSafeInteger(epoch) || epoch < 0))
            );
          })))
    )
      throw new NativeStatefulResourceError("stateful-input-missing");
    if (
      !options.steps.length ||
      options.passes.length * options.steps.length > MAX_ENCODED_PASSES
    )
      throw new NativeStatefulResourceError("stateful-step-limit");
    const targetSpec = this.resources.get(this.outputName);
    if (
      targetSpec?.kind !== "texture-2d" ||
      options.target.width !== this.width ||
      options.target.height !== this.height ||
      options.target.format !== targetSpec.format ||
      [...externalTextures.values()].some(
        (texture) =>
          !texture ||
          !Number.isSafeInteger(texture.width) ||
          texture.width < 1 ||
          !Number.isSafeInteger(texture.height) ||
          texture.height < 1 ||
          options.target === texture,
      ) ||
      this.ownedTextures.has(options.target)
    )
      throw new NativeStatefulResourceError("stateful-target-invalid");
    const bank0 = this.committedBank;
    const work = ([0, 1, 2] as const).filter((index) => index !== bank0);
    let readBank: 0 | 1 | 2 = bank0;
    let workIndex = 0;
    let result: GPUTexture | null = null;
    const uniforms: GPUBuffer[] = [];
    const releaseLease = this.allocator.lease(
      new Set([
        ...this.ownedTextures,
        ...externalTextures.values(),
        options.target,
      ]),
      this.ownedBuffers,
    );
    let closed = false;
    let submitted = false;
    this.busy = true;
    try {
      if (this.completed < 0) {
        for (const state of this.states.values()) {
          for (const resource of state.banks) {
            if (state.spec.kind === "buffer")
              options.encoder.clearBuffer(resource as GPUBuffer);
            else {
              const clear = options.encoder.beginRenderPass({
                colorAttachments: [
                  {
                    view: (resource as GPUTexture).createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                  },
                ],
              });
              clear.end();
            }
          }
        }
      }
      for (const [ordinal, step] of options.steps.entries()) {
        const repeat = this.completed >= 0 && step === this.completed;
        const writeBank = work[workIndex % 2]!;
        const values = new Map<string, Resource>(externalTextures);
        if (repeat)
          for (const [name, state] of this.states)
            values.set(name, state.banks[readBank]);
        const stepTime = step * options.fixedDt;
        const dt =
          (this.completed < 0 && ordinal === 0) || step === this.completed
            ? 0
            : options.fixedDt;
        for (const pass of options.passes) {
          if (repeat && this.states.has(pass.output)) continue;
          const spec = this.resources.get(pass.output);
          const pipeline = options.pipelines.get(pass.id);
          if (!spec || !pipeline)
            throw new NativeStatefulResourceError(
              "stateful-definition-invalid",
            );
          const output =
            pass.output === this.outputName
              ? options.target
              : (this.states.get(pass.output)?.banks[writeBank] ??
                this.scratch.get(pass.output));
          if (!output)
            throw new NativeStatefulResourceError(
              "stateful-resource-unavailable",
            );
          const [width, height] =
            spec.kind === "buffer"
              ? [spec.byteLength! / 16, 1]
              : textureSize(spec, this.width, this.height);
          const data = options.uniforms(pass, width, height, stepTime, dt);
          if (
            data.byteLength !== 544 ||
            (uniforms.length + 1) * 544 > MAX_UNIFORM_BYTES
          )
            throw new NativeStatefulResourceError("stateful-uniform-budget");
          const uniform = this.device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          uniforms.push(uniform);
          this.device.queue.writeBuffer(uniform, 0, data);
          const entries: GPUBindGroupEntry[] = [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: this.sampler },
          ];
          for (const [index, name] of [
            ...pass.reads,
            ...(pass.previousFrameReads ?? []),
          ].entries()) {
            const resource =
              index < pass.reads.length
                ? values.get(name)
                : this.states.get(name)?.banks[readBank];
            const readSpec = this.resources.get(name);
            if (!resource || !readSpec)
              throw new NativeStatefulResourceError("stateful-input-missing");
            entries.push({
              binding: index + 2,
              resource:
                readSpec.kind === "buffer"
                  ? { buffer: resource as GPUBuffer }
                  : (resource as GPUTexture).createView(),
            });
          }
          const bindLayout = pipeline.getBindGroupLayout(0);
          if (pass.kind === "compute")
            entries.push({
              binding: 18,
              resource:
                spec.kind === "buffer"
                  ? { buffer: output as GPUBuffer }
                  : (output as GPUTexture).createView(),
            });
          const bind = this.device.createBindGroup({
            layout: bindLayout,
            entries,
          });
          if (pass.kind === "compute") {
            const dispatch = pass.dispatch;
            if (!dispatch || !Array.isArray(dispatch.workgroupSize))
              throw new NativeStatefulResourceError(
                "stateful-definition-invalid",
              );
            const [x, y] = dispatch.workgroupSize;
            const groupsX = Math.ceil(width / x);
            const groupsY = Math.ceil(height / y);
            if (
              groupsX > this.device.limits.maxComputeWorkgroupsPerDimension ||
              groupsY > this.device.limits.maxComputeWorkgroupsPerDimension
            )
              throw new NativeStatefulResourceError("stateful-device-limit");
            const compute = options.encoder.beginComputePass();
            compute.setPipeline(pipeline as GPUComputePipeline);
            compute.setBindGroup(0, bind);
            compute.dispatchWorkgroups(groupsX, groupsY);
            compute.end();
          } else {
            const render = options.encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: (output as GPUTexture).createView(),
                  loadOp: "clear",
                  storeOp: "store",
                  clearValue: { r: 0, g: 0, b: 0, a: 0 },
                },
              ],
            });
            render.setPipeline(pipeline as GPURenderPipeline);
            render.setBindGroup(0, bind);
            const draw = pass.draw;
            render.draw(
              draw && typeof draw.instances === "object" ? draw.vertices : 3,
              draw && typeof draw.instances === "object"
                ? options.drawCount(
                    draw.instances.property,
                    draw.instances.max,
                    stepTime,
                  )
                : 1,
            );
            render.end();
          }
          values.set(pass.output, output);
          if (pass.output === this.outputName) result = output as GPUTexture;
        }
        if (!repeat) {
          readBank = writeBank;
          workIndex += 1;
        }
      }
      if (!result)
        throw new NativeStatefulResourceError("stateful-output-missing");
      const finalBank = readBank;
      const finalStep = options.steps[options.steps.length - 1]!;
      const release = () => {
        for (const uniform of uniforms) uniform.destroy();
        releaseLease();
        this.busy = false;
      };
      return {
        output: result,
        completedStep: finalStep,
        markSubmitted: () => {
          if (closed || submitted)
            throw new NativeStatefulResourceError("stateful-busy");
          submitted = true;
        },
        abandon: () => {
          if (closed) return;
          closed = true;
          if (submitted) {
            void this.device.queue.onSubmittedWorkDone().then(release, release);
          } else release();
        },
        rejectSubmitted: async (_reason) => {
          if (closed) return;
          closed = true;
          this.faulted = true;
          try {
            await this.device.queue.onSubmittedWorkDone();
          } finally {
            release();
          }
        },
        commit: async (validateBeforeCommit) => {
          if (closed) throw new NativeStatefulResourceError("stateful-busy");
          closed = true;
          try {
            try {
              await this.device.queue.onSubmittedWorkDone();
            } catch (error) {
              this.faulted = true;
              throw new NativeStatefulResourceError(
                "stateful-device-lost",
                error,
              );
            }
            if (this.disposed || this.faulted)
              throw new NativeStatefulResourceError("stateful-device-lost");
            validateBeforeCommit?.();
            this.committedBank = finalBank;
            this.completed = finalStep;
            this.committedSeed = committedSeed;
            this.committedSourceIdentity = committedSourceIdentity;
            this.committedSourceRevision = committedSourceRevision;
            this.committedSourceEpoch = committedSourceEpoch;
            this.committedInputEpochs =
              this.abi !== "stateful-resource-v1"
                ? Object.fromEntries(
                    [...inputEpochs!].sort(([a], [b]) => a.localeCompare(b)),
                  )
                : null;
          } finally {
            release();
          }
        },
      };
    } catch (error) {
      for (const uniform of uniforms) uniform.destroy();
      releaseLease();
      this.busy = false;
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.ownedTextures)
      this.allocator.releaseTexture(texture);
    for (const buffer of this.ownedBuffers)
      this.allocator.releaseBuffer(buffer);
    this.ownedTextures.clear();
    this.ownedBuffers.clear();
  }
}
