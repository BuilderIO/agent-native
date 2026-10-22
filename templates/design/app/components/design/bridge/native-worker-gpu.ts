import { planEffectGraph } from "../../../../shared/effect-graph";
import type { EffectMeshSpec } from "../../../../shared/effect-graph";
import {
  nativeEffectUniformFloats,
  packNativeProperties,
  type EffectDefinition,
  type EffectInstance,
} from "../../../../shared/native-effects";
import { resolveNativeParameterAnimation } from "../../../../shared/native-parameter-animation";
import { packNativeUniformClock } from "../../../../shared/native-uniform-timing";
import {
  acquireNativeMeshGrid,
  nativeMeshGridBytes,
  type NativeMeshGridLease,
} from "./native-mesh-grid";
import {
  NativePackedUniformArena,
  type NativePackedUniformFrame,
} from "./native-packed-uniform-arena";
import { nativeRenderPlacementConstants } from "./native-render-placement";
import type {
  NativeWorkerAsset,
  NativeWorkerEffectTarget,
  NativeWorkerScene,
} from "./native-worker-protocol";
import {
  NATIVE_WORKER_MAX_DIMENSION,
  NATIVE_WORKER_MAX_PIXELS,
} from "./native-worker-protocol";

declare const GPUTextureUsage: Readonly<{
  COPY_SRC: number;
  COPY_DST: number;
  TEXTURE_BINDING: number;
  RENDER_ATTACHMENT: number;
}>;
declare const GPUBufferUsage: Readonly<{ UNIFORM: number; COPY_DST: number }>;
declare const GPUShaderStage: Readonly<{ VERTEX: number; FRAGMENT: number }>;

const MAX_RESOURCE_BYTES = 402_653_184;
const MAX_EFFECT_BYTES = 134_217_728;

export class NativeWorkerGpuError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeWorkerGpuError";
  }
}

type TextureResource = {
  texture: GPUTexture;
  width: number;
  height: number;
  format: GPUTextureFormat;
  bytes: number;
};

type BindingResource = {
  buffer: GPUBuffer;
  offset: number;
  size: number;
  pipeline: GPURenderPipeline | null;
  sources: readonly GPUTexture[];
  sampler: GPUSampler | null;
  group: GPUBindGroup | null;
};

export type NativeWorkerGpuBank = {
  textures: Map<string, TextureResource>;
  depths: Map<string, TextureResource>;
  bindings: Map<string, BindingResource>;
  usedTextures: Set<string>;
  usedDepths: Set<string>;
  usedBindings: Set<string>;
  sceneTexture: GPUTexture | null;
  generation: number;
  compositionSignature: string | null;
  width: number;
  height: number;
  pixelRatio: number;
};

export type NativeWorkerGpuFlightLease = {
  readonly bank: NativeWorkerGpuBank;
};

export type NativeWorkerGpuFlightAcquisition =
  | { status: "acquired"; lease: NativeWorkerGpuFlightLease }
  | {
      status: "capacity";
      reason: "flight-limit" | "memory-budget" | "incompatible-scene";
    };

export class NativeWorkerGpuFlightCapacityError extends Error {
  readonly reason = "memory-budget" as const;

  constructor(message: string) {
    super(message);
    this.name = "NativeWorkerGpuFlightCapacityError";
  }
}

type NativeWorkerGpuFlightSlot = {
  bank: NativeWorkerGpuBank;
  uniformBuffer: GPUBuffer | null;
  uniformArena: NativePackedUniformArena<GPUBuffer> | null;
  uniformFrame: NativePackedUniformFrame | null;
  uniformUploaded: boolean;
  uniformCount: number;
  uniformOccurrences: Map<string, number>;
  pendingFinalIndex: number;
  reservedBytes: number;
  uniformReservationBytes: number;
  finalReservationBytes: number;
  workReservationBytes: number;
  activeLease: NativeWorkerGpuFlightLease | null;
  submitted: boolean;
  compositionSignature: string | null;
  width: number;
  height: number;
  pixelRatio: number;
};

export type NativeWorkerGpuFacade = {
  texture(
    bank: NativeWorkerGpuBank,
    key: string,
    width: number,
    height: number,
    format?: GPUTextureFormat,
  ): GPUTexture;
  pipeline(
    wgsl: string,
    format: GPUTextureFormat,
    blend: boolean,
    textureCount: number,
    placement?: EffectInstance["placement"],
    mesh?: boolean,
  ): Promise<GPURenderPipeline>;
  bind(
    bank: NativeWorkerGpuBank,
    key: string,
    pipeline: GPURenderPipeline,
    source: GPUTexture | null,
    mask: GPUTexture | null,
    values: Float32Array,
    extraTextures?: readonly GPUTexture[],
    sampler?: GPUSampler,
  ): GPUBindGroup;
  sampler: GPUSampler;
};

function createBank(): NativeWorkerGpuBank {
  return {
    textures: new Map(),
    depths: new Map(),
    bindings: new Map(),
    usedTextures: new Set(),
    usedDepths: new Set(),
    usedBindings: new Set(),
    sceneTexture: null,
    generation: -1,
    compositionSignature: null,
    width: 0,
    height: 0,
    pixelRatio: 0,
  };
}

export function nativeWorkerTextureSizeValid(
  width: number,
  height: number,
): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= NATIVE_WORKER_MAX_DIMENSION &&
    height <= NATIVE_WORKER_MAX_DIMENSION &&
    width * height <= NATIVE_WORKER_MAX_PIXELS
  );
}

function textureSize(width: number, height: number, format: GPUTextureFormat) {
  return width * height * (format === "rgba16float" ? 8 : 4);
}

export class NativeWorkerGpu implements NativeWorkerGpuFacade {
  readonly sampler: GPUSampler;
  readonly nearestSampler: GPUSampler;
  readonly bank = createBank();
  readonly context: GPUCanvasContext;
  readonly canvasFormat: GPUTextureFormat;
  readonly workingFormat: GPUTextureFormat = "rgba16float";
  private presentedColorSpace: NativeWorkerScene["colorSpace"] = "srgb";
  private finalTextures: [
    TextureResource | null,
    TextureResource | null,
    TextureResource | null,
  ] = [null, null, null];
  private frontFinalIndex = 0;
  private frontSlot: NativeWorkerGpuFlightSlot | null = null;
  private allocatedBytes = 0;
  private allocatedUniformBytes = 0;
  private reservedBytes = 0;
  private transientBytes = 0;
  private sharedBudget: ((bytes: number, key: string) => void) | null = null;
  private readonly flightSlots: NativeWorkerGpuFlightSlot[] = [];
  private readonly leaseSlots = new WeakMap<
    NativeWorkerGpuFlightLease,
    NativeWorkerGpuFlightSlot
  >();
  private readonly bankSlots = new WeakMap<
    NativeWorkerGpuBank,
    NativeWorkerGpuFlightSlot
  >();
  private legacyLease: NativeWorkerGpuFlightLease | null = null;
  private readonly pipelineCache = new Map<
    string,
    Map<string, GPURenderPipeline>
  >();
  private readonly pipelineOrder: [string, string][] = [];
  private readonly pipelineTextureCounts = new WeakMap<
    GPURenderPipeline,
    number
  >();
  private readonly effectLayouts = new Map<number, GPUPipelineLayout>();
  private readonly preparedPlans = new WeakMap<
    EffectDefinition,
    ReturnType<typeof planEffectGraph>
  >();
  private readonly preparedProperties = new WeakMap<
    EffectInstance,
    {
      definition: EffectDefinition;
      params: EffectInstance["params"];
      packed: Float32Array;
    }
  >();
  private readonly meshGrids = new Map<string, NativeMeshGridLease>();
  private readonly assets = new Map<string, TextureResource>();
  private white: GPUTexture;
  private transparent: GPUTexture;
  private disposed = false;

  private constructor(
    readonly sceneId: string,
    readonly canvas: OffscreenCanvas,
    readonly device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    private readonly ownsDevice: boolean,
  ) {
    this.context = context;
    this.canvasFormat = format;
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    this.nearestSampler = device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
    });
    const uniformCapacity = 2_097_152;
    const uniformBuffer = device.createBuffer({
      size: uniformCapacity,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const slot: NativeWorkerGpuFlightSlot = {
      bank: this.bank,
      uniformBuffer,
      uniformArena: this.createUniformArena(uniformCapacity, uniformBuffer),
      uniformFrame: null,
      uniformUploaded: false,
      uniformCount: 0,
      uniformOccurrences: new Map(),
      pendingFinalIndex: 1,
      reservedBytes: 0,
      uniformReservationBytes: 0,
      finalReservationBytes: 0,
      workReservationBytes: 0,
      activeLease: null,
      submitted: false,
      compositionSignature: null,
      width: 0,
      height: 0,
      pixelRatio: 0,
    };
    this.flightSlots.push(slot);
    this.bankSlots.set(this.bank, slot);
    this.allocatedUniformBytes += uniformCapacity;
    this.white = this.createSolid([255, 255, 255, 255]);
    this.transparent = this.createSolid([0, 0, 0, 0]);
  }

  private get uniformArena(): NativePackedUniformArena<GPUBuffer> {
    return this.flightSlots[0]!.uniformArena!;
  }

  private set uniformArena(value: NativePackedUniformArena<GPUBuffer>) {
    this.flightSlots[0]!.uniformArena = value;
  }

  private get uniformBuffer(): GPUBuffer {
    return this.flightSlots[0]!.uniformBuffer!;
  }

  private get uniformFrame(): NativePackedUniformFrame | null {
    return this.flightSlots[0]!.uniformFrame;
  }

  private set uniformFrame(value: NativePackedUniformFrame | null) {
    this.flightSlots[0]!.uniformFrame = value;
  }

  private get uniformUploaded(): boolean {
    return this.flightSlots[0]!.uniformUploaded;
  }

  private set uniformUploaded(value: boolean) {
    this.flightSlots[0]!.uniformUploaded = value;
  }

  private get uniformCount(): number {
    return this.flightSlots[0]!.uniformCount;
  }

  private set uniformCount(value: number) {
    this.flightSlots[0]!.uniformCount = value;
  }

  private get uniformOccurrences(): Map<string, number> {
    return this.flightSlots[0]!.uniformOccurrences;
  }

  static async create(
    sceneId: string,
    canvas: OffscreenCanvas,
    sharedDevice?: GPUDevice,
  ): Promise<NativeWorkerGpu> {
    if (!navigator.gpu)
      throw new NativeWorkerGpuError(
        "gpu-unavailable",
        "WebGPU is unavailable in the worker.",
      );
    const adapter = sharedDevice ? null : await navigator.gpu.requestAdapter();
    if (!sharedDevice && !adapter)
      throw new NativeWorkerGpuError(
        "gpu-unavailable",
        "No WebGPU adapter is available.",
      );
    const device = sharedDevice ?? (await adapter!.requestDevice());
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context)
      throw new NativeWorkerGpuError(
        "canvas-unavailable",
        "The transferred canvas has no WebGPU context.",
      );
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: "premultiplied",
      colorSpace: "srgb",
    });
    return new NativeWorkerGpu(
      sceneId,
      canvas,
      device,
      context,
      format,
      !sharedDevice,
    );
  }

  frontBank(): NativeWorkerGpuBank {
    return this.frontSlot?.bank ?? this.bank;
  }

  frontTexture(): GPUTexture | null {
    return this.finalTextures[this.frontFinalIndex]?.texture ?? null;
  }

  tryAcquireFlight(
    scene: NativeWorkerScene,
    compositionSignature: string | null,
  ): NativeWorkerGpuFlightAcquisition {
    this.assertLive();
    this.assertSceneSize(scene);
    const active = this.flightSlots.filter((slot) => slot.activeLease);
    if (active.length >= 2 || this.legacyLease)
      return { status: "capacity", reason: "flight-limit" };
    const slot =
      this.flightSlots.find((candidate) => !candidate.activeLease) ?? null;
    const reference = active[0];
    if (
      reference &&
      (reference.compositionSignature !== compositionSignature ||
        reference.width !== scene.width ||
        reference.height !== scene.height ||
        reference.pixelRatio !== scene.pixelRatio)
    )
      return { status: "capacity", reason: "incompatible-scene" };

    const targetSlot = slot ?? this.createEmptyFlightSlot();
    const pendingFinalIndex = this.findPendingFinalIndex(targetSlot);
    if (pendingFinalIndex === null)
      return { status: "capacity", reason: "flight-limit" };
    targetSlot.pendingFinalIndex = pendingFinalIndex;
    const isSecond = active.length > 0;
    const uniformBytes = targetSlot.uniformBuffer ? 0 : 2_097_152;
    const finalBytes = textureSize(
      scene.width,
      scene.height,
      this.workingFormat,
    );
    const pendingFinal = this.finalTextures[targetSlot.pendingFinalIndex];
    const finalReserve = Math.max(0, finalBytes - (pendingFinal?.bytes ?? 0));
    const reusableWork =
      targetSlot.compositionSignature === compositionSignature &&
      targetSlot.width === scene.width &&
      targetSlot.height === scene.height &&
      targetSlot.pixelRatio === scene.pixelRatio;
    const workReserve =
      isSecond && !reusableWork && reference
        ? this.bankBytes(reference.bank)
        : 0;
    const reservation = uniformBytes + finalReserve + workReserve;
    try {
      this.prepareBank(targetSlot, scene, compositionSignature);
      this.reserveFlightBytes(
        targetSlot,
        reservation,
        "flight:reserve",
        uniformBytes,
        finalReserve,
        workReserve,
      );
      if (!targetSlot.uniformBuffer) this.createFlightUniforms(targetSlot);
    } catch (error) {
      this.releaseFlightReservation(targetSlot);
      if (
        isSecond &&
        error instanceof NativeWorkerGpuError &&
        (error.code === "gpu-budget-exceeded" ||
          error.code === "gpu-shared-budget-exceeded")
      )
        return { status: "capacity", reason: "memory-budget" };
      throw error;
    }

    const lease: NativeWorkerGpuFlightLease = Object.freeze({
      bank: targetSlot.bank,
    });
    targetSlot.activeLease = lease;
    targetSlot.submitted = false;
    this.leaseSlots.set(lease, targetSlot);
    return { status: "acquired", lease };
  }

  beginFrame(lease?: NativeWorkerGpuFlightLease): void {
    const slot = lease
      ? this.slotForLease(lease)
      : this.legacySlotForRecording();
    if (slot.uniformFrame)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "A worker GPU frame is already recording.",
      );
    slot.uniformFrame = slot.uniformArena!.beginFrame();
    slot.uniformUploaded = false;
    slot.uniformCount = 0;
    slot.uniformOccurrences.clear();
  }

  uploadFrame(lease?: NativeWorkerGpuFlightLease): void {
    const slot = lease
      ? this.slotForLease(lease)
      : this.legacySlotForRecording();
    const frame = slot.uniformFrame;
    if (!frame)
      throw new NativeWorkerGpuError(
        "uniform-frame-missing",
        "The GPU frame has no packed uniforms.",
      );
    if (!slot.uniformCount) return;
    slot.uniformArena!.upload(frame);
    slot.uniformUploaded = true;
  }

  finishFrame(lease?: NativeWorkerGpuFlightLease): void {
    const slot = lease
      ? this.slotForLease(lease)
      : this.legacySlotForRecording();
    const frame = slot.uniformFrame;
    if (!frame) return;
    if (slot.uniformUploaded) slot.uniformArena!.finishFrame(frame);
    else slot.uniformArena!.abortFrame(frame);
    slot.uniformFrame = null;
    slot.uniformUploaded = false;
    slot.uniformCount = 0;
  }

  spareBank(
    scene: NativeWorkerScene,
    compositionSignature: string | null = null,
  ): NativeWorkerGpuBank {
    this.assertLive();
    if (this.legacyLease)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "The prior exclusive GPU operation has not released its lease.",
      );
    if (this.flightSlots.some((slot) => slot.activeLease))
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "An explicit worker flight is active during an exclusive GPU operation.",
      );
    this.assertSceneSize(scene);
    const slot = this.frontSlot ?? this.flightSlots[0]!;
    const pendingFinalIndex = this.findPendingFinalIndex(slot);
    if (pendingFinalIndex === null)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "No non-visible final texture is available for an exclusive GPU operation.",
      );
    slot.pendingFinalIndex = pendingFinalIndex;
    this.prepareBank(slot, scene, compositionSignature);
    this.legacyLease = Object.freeze({ bank: slot.bank });
    this.leaseSlots.set(this.legacyLease, slot);
    slot.activeLease = this.legacyLease;
    slot.submitted = false;
    return slot.bank;
  }

  private prepareBank(
    slot: NativeWorkerGpuFlightSlot,
    scene: NativeWorkerScene,
    compositionSignature: string | null,
  ): NativeWorkerGpuBank {
    const bank = slot.bank;
    const densityChanged = bank.pixelRatio !== scene.pixelRatio;
    const resized =
      bank.width !== scene.width ||
      bank.height !== scene.height ||
      densityChanged;
    const changed =
      bank.generation < 0 ||
      bank.generation !== scene.generation ||
      bank.compositionSignature !== compositionSignature;
    const reuseBindings =
      compositionSignature !== null &&
      bank.compositionSignature === compositionSignature &&
      !densityChanged;
    if (changed || resized) {
      if (slot.uniformFrame)
        throw new NativeWorkerGpuError(
          "frame-pipeline-busy",
          "The GPU scene changed during an active packed frame.",
        );
      if (!reuseBindings) {
        bank.bindings.clear();
        slot.uniformArena = this.createUniformArena(
          2_097_152,
          slot.uniformBuffer!,
        );
      }
    }
    if (resized) {
      if (reuseBindings) bank.sceneTexture = null;
      else this.clearBank(bank);
      bank.width = scene.width;
      bank.height = scene.height;
      bank.pixelRatio = scene.pixelRatio;
    }
    bank.generation = scene.generation;
    bank.compositionSignature = compositionSignature;
    bank.usedTextures.clear();
    bank.usedDepths.clear();
    bank.usedBindings.clear();
    slot.compositionSignature = compositionSignature;
    slot.width = scene.width;
    slot.height = scene.height;
    slot.pixelRatio = scene.pixelRatio;
    return bank;
  }

  markFlightSubmitted(lease: NativeWorkerGpuFlightLease): void {
    this.slotForLease(lease).submitted = true;
  }

  releaseFlight(lease: NativeWorkerGpuFlightLease): void {
    const slot = this.slotForLease(lease);
    if (slot.uniformFrame)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "A worker GPU flight cannot be released while recording uniforms.",
      );
    if (!slot.submitted) this.clearBank(slot.bank);
    this.releaseFlightReservation(slot);
    slot.activeLease = null;
    slot.submitted = false;
    if (this.legacyLease === lease) this.legacyLease = null;
  }

  endLegacyFlight(): void {
    const lease = this.legacyLease;
    if (!lease) return;
    this.slotForLease(lease).submitted = true;
    this.releaseFlight(lease);
  }

  private legacySlotForRecording(): NativeWorkerGpuFlightSlot {
    if (this.legacyLease) return this.slotForLease(this.legacyLease);
    if (this.flightSlots.some((slot) => slot.activeLease))
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "An exclusive GPU frame cannot overlap a worker flight.",
      );
    const slot = this.frontSlot ?? this.flightSlots[0]!;
    const lease = Object.freeze({ bank: slot.bank });
    this.legacyLease = lease;
    slot.activeLease = lease;
    slot.submitted = false;
    this.leaseSlots.set(lease, slot);
    return slot;
  }

  private assertSceneSize(scene: NativeWorkerScene): void {
    if (
      !nativeWorkerTextureSizeValid(scene.width, scene.height) ||
      !Number.isFinite(scene.pixelRatio) ||
      scene.pixelRatio <= 0
    )
      throw new NativeWorkerGpuError(
        "scene-size-invalid",
        "The native worker scene has invalid full-resolution geometry.",
      );
  }

  private createEmptyFlightSlot(): NativeWorkerGpuFlightSlot {
    const slot: NativeWorkerGpuFlightSlot = {
      bank: createBank(),
      uniformBuffer: null,
      uniformArena: null,
      uniformFrame: null,
      uniformUploaded: false,
      uniformCount: 0,
      uniformOccurrences: new Map(),
      pendingFinalIndex: 2,
      reservedBytes: 0,
      uniformReservationBytes: 0,
      finalReservationBytes: 0,
      workReservationBytes: 0,
      activeLease: null,
      submitted: false,
      compositionSignature: null,
      width: 0,
      height: 0,
      pixelRatio: 0,
    };
    this.flightSlots.push(slot);
    this.bankSlots.set(slot.bank, slot);
    return slot;
  }

  private createFlightUniforms(slot: NativeWorkerGpuFlightSlot): void {
    const capacityBytes = 2_097_152;
    const buffer = this.device.createBuffer({
      size: capacityBytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    let arena: NativePackedUniformArena<GPUBuffer>;
    try {
      arena = this.createUniformArena(capacityBytes, buffer);
    } catch (error) {
      buffer.destroy();
      throw error;
    }
    slot.uniformBuffer = buffer;
    slot.uniformArena = arena;
    this.commitFlightReservation(slot, capacityBytes, "uniform");
    this.allocatedUniformBytes += capacityBytes;
  }

  private reserveFlightBytes(
    slot: NativeWorkerGpuFlightSlot,
    bytes: number,
    key: string,
    uniformBytes: number,
    finalBytes: number,
    workBytes: number,
  ): void {
    if (bytes <= 0) return;
    if (this.resourceBytes() + bytes > MAX_RESOURCE_BYTES)
      throw this.budgetError(bytes, key);
    this.sharedBudget?.(bytes, key);
    slot.reservedBytes += bytes;
    slot.uniformReservationBytes += uniformBytes;
    slot.finalReservationBytes += finalBytes;
    slot.workReservationBytes += workBytes;
    this.reservedBytes += bytes;
  }

  private findPendingFinalIndex(
    slot: NativeWorkerGpuFlightSlot,
  ): number | null {
    const occupied = new Set<number>();
    if (this.finalTextures[this.frontFinalIndex])
      occupied.add(this.frontFinalIndex);
    for (const candidate of this.flightSlots)
      if (candidate !== slot && candidate.activeLease)
        occupied.add(candidate.pendingFinalIndex);
    for (let index = 0; index < this.finalTextures.length; index++)
      if (!occupied.has(index)) return index;
    return null;
  }

  private commitFlightReservation(
    slot: NativeWorkerGpuFlightSlot,
    bytes: number,
    category: "uniform" | "final" | "work",
  ): void {
    const categoryKey = `${category}ReservationBytes` as const;
    const committed = Math.min(bytes, slot[categoryKey]);
    slot[categoryKey] -= committed;
    slot.reservedBytes -= committed;
    this.reservedBytes -= committed;
  }

  private releaseFlightReservation(slot: NativeWorkerGpuFlightSlot): void {
    this.reservedBytes -= slot.reservedBytes;
    slot.reservedBytes = 0;
    slot.uniformReservationBytes = 0;
    slot.finalReservationBytes = 0;
    slot.workReservationBytes = 0;
  }

  private bankBytes(bank: NativeWorkerGpuBank): number {
    return [...bank.textures.values(), ...bank.depths.values()].reduce(
      (total, resource) => total + resource.bytes,
      0,
    );
  }

  private slotForLease(
    lease: NativeWorkerGpuFlightLease,
  ): NativeWorkerGpuFlightSlot {
    const slot = this.leaseSlots.get(lease);
    if (!slot || slot.activeLease !== lease)
      throw new NativeWorkerGpuError(
        "flight-lease-invalid",
        "The GPU flight lease is no longer active.",
      );
    return slot;
  }

  private slotForBank(bank: NativeWorkerGpuBank): NativeWorkerGpuFlightSlot {
    const slot = this.bankSlots.get(bank);
    if (!slot)
      throw new NativeWorkerGpuError(
        "flight-bank-invalid",
        "The GPU work bank does not belong to this scene.",
      );
    return slot;
  }

  private capacityError(slot: NativeWorkerGpuFlightSlot): Error | null {
    return this.flightSlots.indexOf(slot) > 0 &&
      slot.activeLease !== null &&
      !slot.submitted
      ? new NativeWorkerGpuFlightCapacityError(
          "The second native worker flight exceeded the reserved GPU budget.",
        )
      : null;
  }

  trimWork(target: NativeWorkerGpuBank | NativeWorkerGpuFlightLease): void {
    const isLease = !this.bankSlots.has(target as NativeWorkerGpuBank);
    const slot = isLease
      ? this.slotForLease(target as NativeWorkerGpuFlightLease)
      : this.slotForBank(target as NativeWorkerGpuBank);
    if (slot.uniformFrame)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "GPU work must finish before resource retirement.",
      );
    const bank = slot.bank;
    this.trimBank(bank);
  }

  // The caller must await the GPU submission fence before retiring encoded textures.
  trimWorkExcept(
    target: NativeWorkerGpuBank | NativeWorkerGpuFlightLease,
    retained: GPUTexture | null,
  ): void {
    const isLease = !this.bankSlots.has(target as NativeWorkerGpuBank);
    const slot = isLease
      ? this.slotForLease(target as NativeWorkerGpuFlightLease)
      : this.slotForBank(target as NativeWorkerGpuBank);
    if (slot.activeLease && slot.activeLease !== this.legacyLease)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "Work cannot be retired while an explicit worker flight owns the bank.",
      );
    if (slot.uniformFrame)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "GPU work must finish before resource retirement.",
      );
    const bank = slot.bank;
    bank.usedTextures.clear();
    for (const [key, resource] of bank.textures)
      if (resource.texture === retained) bank.usedTextures.add(key);
    bank.usedDepths.clear();
    bank.usedBindings.clear();
    this.trimBank(bank);
    if (!retained) bank.sceneTexture = null;
  }

  private trimBank(bank: NativeWorkerGpuBank): void {
    for (const [key, resource] of bank.textures) {
      if (bank.usedTextures.has(key)) continue;
      resource.texture.destroy();
      this.allocatedBytes -= resource.bytes;
      bank.textures.delete(key);
    }
    for (const [key, resource] of bank.depths) {
      if (bank.usedDepths.has(key)) continue;
      resource.texture.destroy();
      this.allocatedBytes -= resource.bytes;
      bank.depths.delete(key);
    }
    for (const key of bank.bindings.keys())
      if (!bank.usedBindings.has(key)) bank.bindings.delete(key);
  }

  stageFinal(
    lease: NativeWorkerGpuFlightLease,
    scene: NativeWorkerScene,
    sceneTexture: GPUTexture,
    encoder: GPUCommandEncoder,
  ): GPUTexture;
  stageFinal(
    scene: NativeWorkerScene,
    sceneTexture: GPUTexture,
    encoder: GPUCommandEncoder,
  ): GPUTexture;
  stageFinal(
    leaseOrScene: NativeWorkerGpuFlightLease | NativeWorkerScene,
    sceneOrTexture: NativeWorkerScene | GPUTexture,
    textureOrEncoder: GPUTexture | GPUCommandEncoder,
    maybeEncoder?: GPUCommandEncoder,
  ): GPUTexture {
    this.assertLive();
    const explicitLease = this.leaseSlots.has(
      leaseOrScene as NativeWorkerGpuFlightLease,
    );
    const lease = explicitLease
      ? (leaseOrScene as NativeWorkerGpuFlightLease)
      : this.legacyLease;
    if (!lease)
      throw new NativeWorkerGpuError(
        "flight-lease-invalid",
        "Final textures require an active GPU flight lease.",
      );
    const slot = this.slotForLease(lease);
    const scene = (
      explicitLease ? sceneOrTexture : leaseOrScene
    ) as NativeWorkerScene;
    const sceneTexture = (
      explicitLease ? textureOrEncoder : sceneOrTexture
    ) as GPUTexture;
    const encoder = (
      explicitLease ? maybeEncoder : textureOrEncoder
    ) as GPUCommandEncoder;
    const index = slot.pendingFinalIndex;
    let resource = this.finalTextures[index];
    if (
      resource &&
      (resource.width !== scene.width || resource.height !== scene.height)
    ) {
      resource.texture.destroy();
      this.allocatedBytes -= resource.bytes;
      resource = null;
    }
    if (!resource) {
      const bytes = textureSize(scene.width, scene.height, this.workingFormat);
      this.ensureBudget(bytes, `final:${index}`, slot, "final");
      resource = {
        texture: this.device.createTexture({
          size: [scene.width, scene.height],
          format: this.workingFormat,
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.COPY_DST,
        }),
        width: scene.width,
        height: scene.height,
        format: this.workingFormat,
        bytes,
      };
      this.finalTextures[index] = resource;
      this.commitFlightReservation(slot, bytes, "final");
      this.allocatedBytes += bytes;
    }
    encoder.copyTextureToTexture(
      { texture: sceneTexture },
      { texture: resource.texture },
      [scene.width, scene.height],
    );
    return resource.texture;
  }

  publish(
    lease: NativeWorkerGpuFlightLease,
    validatedFinal: GPUTexture,
    scene: NativeWorkerScene,
  ): void;
  publish(
    bank: NativeWorkerGpuBank,
    validatedFinal: GPUTexture,
    scene: NativeWorkerScene,
  ): void;
  publish(
    leaseOrBank: NativeWorkerGpuFlightLease | NativeWorkerGpuBank,
    validatedFinal: GPUTexture,
    scene: NativeWorkerScene,
  ): void {
    const explicitLease = this.leaseSlots.has(
      leaseOrBank as NativeWorkerGpuFlightLease,
    );
    const slot = explicitLease
      ? this.slotForLease(leaseOrBank as NativeWorkerGpuFlightLease)
      : this.slotForBank(leaseOrBank as NativeWorkerGpuBank);
    if (explicitLease)
      this.validatePublication(
        leaseOrBank as NativeWorkerGpuFlightLease,
        validatedFinal,
      );
    else this.validatePublication(slot.bank, validatedFinal);
    const previousFront = this.frontFinalIndex;
    const nextFront = slot.pendingFinalIndex;
    slot.bank.sceneTexture = validatedFinal;
    this.frontFinalIndex = nextFront;
    slot.pendingFinalIndex = previousFront;
    this.frontSlot = slot;
    slot.submitted = true;
    void scene;
  }

  validatePublication(
    lease: NativeWorkerGpuFlightLease,
    validatedFinal: GPUTexture,
  ): void;
  validatePublication(
    bank: NativeWorkerGpuBank,
    validatedFinal: GPUTexture,
  ): void;
  validatePublication(
    leaseOrBank: NativeWorkerGpuFlightLease | NativeWorkerGpuBank,
    validatedFinal: GPUTexture,
  ): void {
    this.assertLive();
    const explicitLease = this.leaseSlots.has(
      leaseOrBank as NativeWorkerGpuFlightLease,
    );
    const slot = explicitLease
      ? this.slotForLease(leaseOrBank as NativeWorkerGpuFlightLease)
      : this.slotForBank(leaseOrBank as NativeWorkerGpuBank);
    if (this.finalTextures[slot.pendingFinalIndex]?.texture !== validatedFinal)
      throw new NativeWorkerGpuError(
        "frame-order-invalid",
        "The validated GPU final texture is no longer spare.",
      );
  }

  preparePresentation(scene: NativeWorkerScene): void {
    this.assertLive();
    if (this.canvas.width !== scene.width) this.canvas.width = scene.width;
    if (this.canvas.height !== scene.height) this.canvas.height = scene.height;
    if (this.presentedColorSpace !== scene.colorSpace) {
      this.context.configure({
        device: this.device,
        format: this.canvasFormat,
        alphaMode: "premultiplied",
        colorSpace: scene.colorSpace,
      });
      this.presentedColorSpace = scene.colorSpace;
    }
  }

  reject(bank: NativeWorkerGpuBank): void {
    const slot = this.bankSlots.get(bank);
    if (!slot || slot === this.frontSlot) return;
    if (slot.activeLease && slot.submitted) return;
    if (slot.activeLease) this.releaseFlight(slot.activeLease);
    this.clearBank(bank);
  }

  texture(
    bank: NativeWorkerGpuBank,
    key: string,
    width: number,
    height: number,
    format: GPUTextureFormat = this.workingFormat,
  ): GPUTexture {
    this.assertLive();
    if (!nativeWorkerTextureSizeValid(width, height))
      throw new NativeWorkerGpuError(
        "resource-size-unsupported",
        "The native GPU texture exceeds its dimension limit.",
      );
    const existing = bank.textures.get(key);
    bank.usedTextures.add(key);
    if (
      existing?.width === width &&
      existing.height === height &&
      existing.format === format
    )
      return existing.texture;
    if (existing) {
      this.allocatedBytes -= existing.bytes;
      existing.texture.destroy();
      bank.textures.delete(key);
    }
    const bytes = textureSize(width, height, format);
    const slot = this.slotForBank(bank);
    this.ensureBudget(bytes, `work:${key}`, slot, "work");
    const texture = this.device.createTexture({
      size: [width, height],
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    bank.textures.set(key, { texture, width, height, format, bytes });
    this.commitFlightReservation(slot, bytes, "work");
    this.allocatedBytes += bytes;
    return texture;
  }

  private meshDepth(
    bank: NativeWorkerGpuBank,
    width: number,
    height: number,
  ): GPUTexture {
    const key = `depth24plus:${width}x${height}`;
    bank.usedDepths.add(key);
    const existing = bank.depths.get(key);
    if (existing?.width === width && existing.height === height)
      return existing.texture;
    if (existing) {
      existing.texture.destroy();
      this.allocatedBytes -= existing.bytes;
      bank.depths.delete(key);
    }
    const bytes = width * height * 4;
    const slot = this.slotForBank(bank);
    this.ensureBudget(bytes, `depth:${key}`, slot, "work");
    const texture = this.device.createTexture({
      size: [width, height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    bank.depths.set(key, {
      texture,
      width,
      height,
      format: "depth24plus",
      bytes,
    });
    this.commitFlightReservation(slot, bytes, "work");
    this.allocatedBytes += bytes;
    return texture;
  }

  private meshGrid(
    mesh: EffectMeshSpec,
    slot: NativeWorkerGpuFlightSlot,
  ): NativeMeshGridLease {
    const key = `${mesh.columns}x${mesh.rows}`;
    const existing = this.meshGrids.get(key);
    if (existing) return existing;
    const bytes = nativeMeshGridBytes(mesh);
    this.ensureBudget(bytes, `mesh:${key}`, slot, "work");
    const lease = acquireNativeMeshGrid(this.device, mesh);
    this.meshGrids.set(key, lease);
    this.commitFlightReservation(slot, bytes, "work");
    this.allocatedBytes += bytes;
    return lease;
  }

  async pipeline(
    wgsl: string,
    format: GPUTextureFormat,
    blend: boolean,
    textureCount: number,
    placement?: EffectInstance["placement"],
    mesh = false,
  ): Promise<GPURenderPipeline> {
    this.assertLive();
    if (
      !Number.isSafeInteger(textureCount) ||
      textureCount < 0 ||
      textureCount > this.device.limits.maxSampledTexturesPerShaderStage
    )
      throw new NativeWorkerGpuError(
        "effect-input-limit",
        "The shader has more texture inputs than the GPU supports.",
      );
    const constants = nativeRenderPlacementConstants(wgsl, placement);
    const key = JSON.stringify([format, blend, textureCount, constants, mesh]);
    const cached = this.pipelineCache.get(wgsl)?.get(key);
    if (cached) return cached;
    const module = this.device.createShaderModule({ code: wgsl });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === "error");
    if (errors.length)
      throw new NativeWorkerGpuError(
        "shader-pipeline-failed",
        errors
          .map(
            (message) =>
              `${message.lineNum}:${message.linePos} ${message.message}`,
          )
          .join("; "),
      );
    const layout =
      this.effectLayouts.get(textureCount) ??
      this.createEffectLayout(textureCount);
    this.effectLayouts.set(textureCount, layout);
    const pipeline = await this.device.createRenderPipelineAsync({
      layout,
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        constants,
        targets: [
          {
            format,
            ...(blend
              ? {
                  blend: {
                    color: {
                      operation: "add" as const,
                      srcFactor: "one" as const,
                      dstFactor: "one-minus-src-alpha" as const,
                    },
                    alpha: {
                      operation: "add" as const,
                      srcFactor: "one" as const,
                      dstFactor: "one-minus-src-alpha" as const,
                    },
                  },
                }
              : {}),
          },
        ],
      },
      primitive: { topology: "triangle-list" },
      ...(mesh
        ? {
            depthStencil: {
              format: "depth24plus" as const,
              depthWriteEnabled: true,
              depthCompare: "less" as const,
            },
          }
        : {}),
    });
    if (this.disposed)
      throw new NativeWorkerGpuError(
        "device-disposed",
        "The GPU worker was disposed during pipeline creation.",
      );
    let variants = this.pipelineCache.get(wgsl);
    if (!variants) {
      variants = new Map();
      this.pipelineCache.set(wgsl, variants);
    }
    variants.set(key, pipeline);
    this.pipelineTextureCounts.set(pipeline, textureCount);
    this.pipelineOrder.push([wgsl, key]);
    while (this.pipelineOrder.length > 256) {
      const [oldWgsl, oldKey] = this.pipelineOrder.shift()!;
      const oldVariants = this.pipelineCache.get(oldWgsl);
      oldVariants?.delete(oldKey);
      if (!oldVariants?.size) this.pipelineCache.delete(oldWgsl);
    }
    return pipeline;
  }

  bind(
    bank: NativeWorkerGpuBank,
    key: string,
    pipeline: GPURenderPipeline,
    source: GPUTexture | null,
    mask: GPUTexture | null,
    values: Float32Array,
    extraTextures: readonly GPUTexture[] = [],
    sampler = this.sampler,
  ): GPUBindGroup {
    this.assertLive();
    const slot = this.slotForBank(bank);
    const frame = slot.uniformFrame;
    if (!frame)
      throw new NativeWorkerGpuError(
        "uniform-frame-missing",
        "A draw was encoded without a worker uniform frame.",
      );
    key = `${key}:uniform${values.byteLength}`;
    const occurrence = slot.uniformOccurrences.get(key) ?? 0;
    slot.uniformOccurrences.set(key, occurrence + 1);
    key = `${key}:${occurrence}`;
    bank.usedBindings.add(key);
    const packed = slot.uniformArena!.write(frame, key, values);
    slot.uniformCount++;
    const { size, offset } = packed;
    let binding = bank.bindings.get(key);
    if (
      !binding ||
      binding.buffer !== packed.buffer ||
      binding.size !== size ||
      binding.offset !== offset
    ) {
      binding = {
        buffer: packed.buffer,
        offset,
        size,
        pipeline: null,
        sources: [],
        sampler: null,
        group: null,
      };
      bank.bindings.set(key, binding);
    }
    const textureCount = this.pipelineTextureCounts.get(pipeline);
    const inputs = [
      ...(source ? [source] : []),
      ...(mask ? [mask] : []),
      ...extraTextures,
    ];
    if (textureCount === undefined || inputs.length !== textureCount)
      throw new NativeWorkerGpuError(
        "pipeline-binding-arity-mismatch",
        `A draw supplied ${inputs.length} textures to a pipeline requiring ${textureCount ?? "unknown"}.`,
      );
    if (
      !binding.group ||
      binding.pipeline !== pipeline ||
      binding.sampler !== sampler ||
      binding.sources.length !== inputs.length ||
      inputs.some((texture, index) => texture !== binding.sources[index])
    ) {
      binding.group = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: binding.buffer, offset, size } },
          ...(textureCount ? [{ binding: 1, resource: sampler }] : []),
          ...inputs.map((texture, index) => ({
            binding: index + 2,
            resource: texture.createView(),
          })),
        ],
      });
      binding.pipeline = pipeline;
      binding.sampler = sampler;
      binding.sources = inputs;
    }
    return binding.group;
  }

  async effect(
    bank: NativeWorkerGpuBank,
    target: NativeWorkerEffectTarget,
    definition: EffectDefinition,
    instance: EffectInstance,
    source: GPUTexture,
    timeSeconds: number,
    encoder: GPUCommandEncoder,
    inputs: ReadonlyMap<string, GPUTexture>,
  ): Promise<GPUTexture> {
    if (
      definition.feedback ||
      definition.simulation ||
      definition.statelessCompute ||
      definition.resourceGraph
    )
      throw new NativeWorkerGpuError(
        "worker-capability-backend",
        `Effect ${instance.id} uses a GPU backend that is not available in the worker.`,
      );
    if (
      definition.passes.some(
        (pass) => pass.kind !== "render" || pass.previousFrameReads?.length,
      )
    )
      throw new NativeWorkerGpuError(
        "worker-capability-pass",
        `Effect ${instance.id} needs a temporal or non-render pass.`,
      );
    const plan =
      this.preparedPlans.get(definition) ?? planEffectGraph(definition);
    if (plan.errors.length)
      throw new NativeWorkerGpuError(
        "effect-graph-invalid",
        plan.errors.join("; "),
      );
    const params = instance.animation
      ? resolveNativeParameterAnimation(
          definition,
          instance.params,
          instance.animation,
          timeSeconds,
        )
      : instance.params;
    const cached = this.preparedProperties.get(instance);
    const packedProperties =
      !instance.animation &&
      cached?.definition === definition &&
      cached.params === instance.params
        ? cached.packed
        : packNativeProperties(definition, params);
    this.preparedPlans.set(definition, plan);
    if (!instance.animation)
      this.preparedProperties.set(instance, {
        definition,
        params: instance.params,
        packed: packedProperties,
      });
    const resources = new Map<string, GPUTexture>([
      ["source", source],
      ...inputs,
    ]);
    let resourceBytes = 0;
    for (const pass of plan.passes) {
      if (pass.kind !== "render")
        throw new NativeWorkerGpuError(
          "worker-capability-pass",
          `Pass ${pass.id} cannot run in the worker render graph.`,
        );
      const spec = definition.resources?.find(
        (resource) => resource.name === pass.output,
      );
      if (spec?.kind && spec.kind !== "texture-2d")
        throw new NativeWorkerGpuError(
          "resource-kind-unsupported",
          `Pass ${pass.id} needs a non-texture output.`,
        );
      const format = spec?.format ?? "rgba8unorm";
      if (format !== "rgba8unorm" && format !== "rgba16float")
        throw new NativeWorkerGpuError(
          "resource-format-unsupported",
          `Pass ${pass.id} requests unsupported output format.`,
        );
      const width = spec?.size === "fixed" ? spec.width : target.width;
      const height = spec?.size === "fixed" ? spec.height : target.height;
      if (!width || !height || !nativeWorkerTextureSizeValid(width, height))
        throw new NativeWorkerGpuError(
          "resource-size-unsupported",
          `Pass ${pass.id} exceeds effect bounds.`,
        );
      resourceBytes +=
        textureSize(width, height, format) +
        (pass.mesh ? width * height * 4 : 0);
      if (resourceBytes > MAX_EFFECT_BYTES)
        throw new NativeWorkerGpuError(
          "resource-budget-exceeded",
          `Effect ${instance.id} exceeds its texture budget.`,
        );
      const output = this.texture(
        bank,
        `effect:${instance.id}:${pass.output}`,
        width,
        height,
        format,
      );
      const reads = pass.reads.map((name) => {
        const texture = resources.get(name);
        if (!texture)
          throw new NativeWorkerGpuError(
            "pass-input-missing",
            `Pass ${pass.id} has no texture for ${name}.`,
          );
        return texture;
      });
      const pipeline = await this.pipeline(
        pass.wgsl,
        format,
        false,
        reads.length,
        instance.placement,
        pass.mesh !== undefined,
      );
      const values = new Float32Array(
        8 + nativeEffectUniformFloats(definition),
      );
      values.set([width, height, 1 / width, 1 / height], 0);
      values.set(
        packNativeUniformClock({
          time: timeSeconds,
          seed: instance.seed,
          pixelRatio: target.pixelRatio,
        }),
        4,
      );
      values.set(packedProperties, 8);
      const input = reads[0] ?? null;
      const bind = this.bind(
        bank,
        `effect:${instance.id}:${pass.id}`,
        pipeline,
        input,
        reads[1] ?? null,
        values,
        reads.slice(2),
      );
      const depth = pass.mesh ? this.meshDepth(bank, width, height) : null;
      const grid = pass.mesh
        ? this.meshGrid(pass.mesh, this.slotForBank(bank))
        : null;
      const render = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: output.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
        ...(depth
          ? {
              depthStencilAttachment: {
                view: depth.createView(),
                depthLoadOp: "clear" as const,
                depthStoreOp: "discard" as const,
                depthClearValue: 1,
              },
            }
          : {}),
      });
      render.setPipeline(pipeline);
      render.setBindGroup(0, bind);
      if (grid) {
        render.setIndexBuffer(grid.buffer, "uint32");
        render.drawIndexed(grid.indexCount);
      } else render.draw(3);
      render.end();
      resources.set(pass.output, output);
    }
    const outputName =
      definition.output ?? plan.passes[plan.passes.length - 1]?.output;
    if (!outputName) return source;
    const output = resources.get(outputName);
    if (!output)
      throw new NativeWorkerGpuError(
        "effect-output-missing",
        `Effect ${instance.id} has no output texture.`,
      );
    return output;
  }

  asset(assetId: string, revision: number, generation: number): GPUTexture {
    void generation;
    const entry = this.assets.get(NativeWorkerGpu.assetKey(assetId, revision));
    if (!entry)
      throw new NativeWorkerGpuError(
        "asset-missing",
        `Asset ${assetId} revision ${revision} is unavailable.`,
      );
    return entry.texture;
  }

  hasAsset(assetId: string, revision: number, generation: number): boolean {
    void generation;
    return this.assets.has(NativeWorkerGpu.assetKey(assetId, revision));
  }

  static assetKey(assetId: string, revision: number): string {
    return JSON.stringify([assetId, revision]);
  }

  retireIdleWorkForAssetUpload(asset: NativeWorkerAsset): void {
    if (
      this.flightSlots.some(
        (slot) => slot.activeLease && slot.activeLease !== this.legacyLease,
      )
    )
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "Asset uploads cannot retire work while an explicit worker flight is active.",
      );
    if (
      this.assets.has(NativeWorkerGpu.assetKey(asset.assetId, asset.revision))
    )
      return;
    const width = asset.kind === "bitmap" ? asset.bitmap.width : asset.width;
    const height = asset.kind === "bitmap" ? asset.bitmap.height : asset.height;
    if (!nativeWorkerTextureSizeValid(width, height)) return;
    const format =
      asset.kind === "bitmap"
        ? asset.sampleEncoding === "linear-data"
          ? "rgba8unorm"
          : "rgba8unorm-srgb"
        : "rgba16float";
    if (
      this.resourceBytes() + textureSize(width, height, format) >
      MAX_RESOURCE_BYTES
    )
      this.trimWorkExcept(this.bank, null);
  }

  uploadAsset(asset: NativeWorkerAsset): void {
    try {
      this.assertLive();
      if (asset.sceneId !== this.sceneId)
        throw new NativeWorkerGpuError(
          "scene-id-mismatch",
          "The asset belongs to another worker scene.",
        );
      const key = NativeWorkerGpu.assetKey(asset.assetId, asset.revision);
      if (this.assets.has(key)) return;
      const width = asset.kind === "bitmap" ? asset.bitmap.width : asset.width;
      const height =
        asset.kind === "bitmap" ? asset.bitmap.height : asset.height;
      const format: GPUTextureFormat =
        asset.kind === "bitmap"
          ? asset.sampleEncoding === "linear-data"
            ? "rgba8unorm"
            : "rgba8unorm-srgb"
          : "rgba16float";
      if (!nativeWorkerTextureSizeValid(width, height))
        throw new NativeWorkerGpuError(
          "asset-size-invalid",
          `Asset ${asset.assetId} exceeds texture limits.`,
        );
      const bytes = textureSize(width, height, format);
      this.ensureBudget(bytes, `asset:${asset.assetId}`);
      const texture = this.device.createTexture({
        size: [width, height],
        format,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC |
          (asset.kind === "bitmap" ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
      });
      try {
        if (asset.kind === "bitmap") {
          this.device.queue.copyExternalImageToTexture(
            { source: asset.bitmap },
            { texture, colorSpace: "srgb", premultipliedAlpha: false },
            [width, height],
          );
        } else {
          const expected = width * height * 8;
          if (asset.data.byteLength !== expected)
            throw new NativeWorkerGpuError(
              "asset-data-invalid",
              `Asset ${asset.assetId} has invalid RGBA16F bytes.`,
            );
          this.device.queue.writeTexture(
            { texture },
            asset.data,
            { bytesPerRow: width * 8, rowsPerImage: height },
            [width, height],
          );
        }
      } catch (error) {
        texture.destroy();
        throw error;
      }
      this.assets.set(key, { texture, width, height, format, bytes });
      this.allocatedBytes += bytes;
    } finally {
      if (asset.kind === "bitmap") asset.bitmap.close();
    }
  }

  retireAssets(keptKeys: ReadonlySet<string>): void {
    for (const [key, resource] of this.assets) {
      if (keptKeys.has(key)) continue;
      resource.texture.destroy();
      this.allocatedBytes -= resource.bytes;
      this.assets.delete(key);
    }
  }

  dropAsset(assetId: string, revision: number): void {
    const key = NativeWorkerGpu.assetKey(assetId, revision);
    const resource = this.assets.get(key);
    if (!resource) return;
    resource.texture.destroy();
    this.allocatedBytes -= resource.bytes;
    this.assets.delete(key);
  }

  transparentTexture(): GPUTexture {
    return this.transparent;
  }

  whiteTexture(): GPUTexture {
    return this.white;
  }

  resourceBytes(): number {
    return (
      this.allocatedBytes +
      this.allocatedUniformBytes +
      this.reservedBytes +
      this.transientBytes
    );
  }

  setSharedBudget(check: (bytes: number, key: string) => void): void {
    this.sharedBudget = check;
  }

  reserveTransient(bytes: number, key: string): void {
    this.ensureBudget(bytes, key);
    this.transientBytes += bytes;
  }

  releaseTransient(bytes: number): void {
    this.transientBytes -= bytes;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.flightSlots) {
      this.clearBank(slot.bank);
      this.releaseFlightReservation(slot);
      slot.activeLease = null;
      if (slot.uniformBuffer) {
        slot.uniformBuffer.destroy();
        this.allocatedUniformBytes -= 2_097_152;
        slot.uniformBuffer = null;
        slot.uniformArena = null;
      }
    }
    this.legacyLease = null;
    for (const grid of this.meshGrids.values()) {
      grid.release();
      this.allocatedBytes -= grid.bytes;
    }
    this.meshGrids.clear();
    this.retireAssets(new Set());
    for (const resource of this.finalTextures)
      if (resource) {
        resource.texture.destroy();
        this.allocatedBytes -= resource.bytes;
      }
    this.finalTextures = [null, null, null];
    this.white.destroy();
    this.transparent.destroy();
    this.allocatedBytes -= 8;
    this.context.unconfigure();
    if (this.ownsDevice) this.device.destroy();
  }

  private createSolid(
    color: readonly [number, number, number, number],
  ): GPUTexture {
    const texture = this.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture },
      new Uint8Array(color),
      { bytesPerRow: 4 },
      [1, 1],
    );
    this.allocatedBytes += 4;
    return texture;
  }

  private createUniformArena(
    capacityBytes: number,
    buffer: GPUBuffer,
  ): NativePackedUniformArena<GPUBuffer> {
    return new NativePackedUniformArena({
      buffer,
      capacityBytes,
      alignment: this.device.limits.minUniformBufferOffsetAlignment,
      upload: (buffer, bytes) =>
        this.device.queue.writeBuffer(buffer, 0, bytes),
    });
  }

  private createEffectLayout(count: number): GPUPipelineLayout {
    return this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform" },
            },
            ...(count
              ? [
                  {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: "filtering" as const },
                  },
                ]
              : []),
            ...Array.from({ length: count }, (_, index) => ({
              binding: index + 2,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float" as const },
            })),
          ],
        }),
      ],
    });
  }

  private ensureBudget(
    bytes: number,
    key: string,
    slot?: NativeWorkerGpuFlightSlot,
    category?: "uniform" | "final" | "work",
  ): void {
    const reservedBytes =
      category === "uniform"
        ? slot?.uniformReservationBytes
        : category === "final"
          ? slot?.finalReservationBytes
          : category === "work"
            ? slot?.workReservationBytes
            : 0;
    const credit = Math.min(bytes, reservedBytes ?? 0);
    const additional = bytes - credit;
    const allocated = this.resourceBytes();
    if (allocated + additional > MAX_RESOURCE_BYTES)
      throw (
        this.capacityError(slot ?? this.flightSlots[0]!) ??
        this.budgetError(bytes, key)
      );
    try {
      if (additional) this.sharedBudget?.(additional, key);
    } catch (error) {
      if (
        slot &&
        error instanceof NativeWorkerGpuError &&
        (error.code === "gpu-budget-exceeded" ||
          error.code === "gpu-shared-budget-exceeded")
      ) {
        const capacityError = this.capacityError(slot);
        if (capacityError) throw capacityError;
      }
      throw error;
    }
  }

  private budgetError(bytes: number, key: string): NativeWorkerGpuError {
    const work = this.flightSlots.reduce(
      (total, slot) =>
        total +
        [...slot.bank.textures.values(), ...slot.bank.depths.values()].reduce(
          (subtotal, resource) => subtotal + resource.bytes,
          0,
        ),
      0,
    );
    const assets = [...this.assets.values()].reduce(
      (total, resource) => total + resource.bytes,
      0,
    );
    const finals = this.finalTextures.reduce(
      (total, resource) => total + (resource?.bytes ?? 0),
      0,
    );
    const allocated = this.resourceBytes();
    return new NativeWorkerGpuError(
      "gpu-budget-exceeded",
      `The native worker GPU resources exceed their bounded budget: ${key} requests ${bytes} bytes with ${allocated} bytes allocated; work ${work} bytes, assets ${assets} bytes/${this.assets.size} textures, finals ${finals} bytes/${this.finalTextures.filter(Boolean).length} textures.`,
    );
  }

  private clearBank(bank: NativeWorkerGpuBank): void {
    for (const resource of bank.textures.values()) {
      resource.texture.destroy();
      this.allocatedBytes -= resource.bytes;
    }
    bank.textures.clear();
    for (const resource of bank.depths.values()) {
      resource.texture.destroy();
      this.allocatedBytes -= resource.bytes;
    }
    bank.depths.clear();
    bank.bindings.clear();
    bank.usedTextures.clear();
    bank.usedDepths.clear();
    bank.usedBindings.clear();
    bank.sceneTexture = null;
    bank.generation = -1;
    bank.compositionSignature = null;
  }

  private assertLive(): void {
    if (this.disposed)
      throw new NativeWorkerGpuError(
        "device-disposed",
        "The native worker GPU is disposed.",
      );
  }
}
