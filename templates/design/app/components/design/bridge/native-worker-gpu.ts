import { planEffectGraph } from "../../../../shared/effect-graph";
import {
  packNativeProperties,
  type EffectDefinition,
  type EffectInstance,
} from "../../../../shared/native-effects";
import { resolveNativeParameterAnimation } from "../../../../shared/native-parameter-animation";
import { packNativeUniformClock } from "../../../../shared/native-uniform-timing";
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

declare const GPUTextureUsage: Readonly<{
  COPY_SRC: number;
  COPY_DST: number;
  TEXTURE_BINDING: number;
  RENDER_ATTACHMENT: number;
}>;
declare const GPUBufferUsage: Readonly<{ UNIFORM: number; COPY_DST: number }>;
declare const GPUShaderStage: Readonly<{ VERTEX: number; FRAGMENT: number }>;

const MAX_DIMENSION = 4096;
const MAX_PIXELS = 8_388_608;
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
  bindings: Map<string, BindingResource>;
  usedTextures: Set<string>;
  usedBindings: Set<string>;
  sceneTexture: GPUTexture | null;
  generation: number;
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
    bindings: new Map(),
    usedTextures: new Set(),
    usedBindings: new Set(),
    sceneTexture: null,
    generation: -1,
    compositionSignature: null,
    width: 0,
    height: 0,
    pixelRatio: 0,
  };
}

function validSize(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION &&
    width * height <= MAX_PIXELS
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
  private finalTextures: [TextureResource | null, TextureResource | null] = [
    null,
    null,
  ];
  private frontFinal = 0;
  private allocatedBytes = 0;
  private allocatedUniformBytes = 0;
  private transientBytes = 0;
  private sharedBudget: ((bytes: number, key: string) => void) | null = null;
  private readonly uniformBuffer: GPUBuffer;
  private uniformArena: NativePackedUniformArena<GPUBuffer>;
  private uniformFrame: NativePackedUniformFrame | null = null;
  private uniformUploaded = false;
  private uniformCount = 0;
  private readonly uniformOccurrences = new Map<string, number>();
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
    this.uniformBuffer = device.createBuffer({
      size: uniformCapacity,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformArena = this.createUniformArena(uniformCapacity);
    this.allocatedUniformBytes += uniformCapacity;
    this.white = this.createSolid([255, 255, 255, 255]);
    this.transparent = this.createSolid([0, 0, 0, 0]);
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
    return this.bank;
  }

  frontTexture(): GPUTexture | null {
    return this.finalTextures[this.frontFinal]?.texture ?? null;
  }

  beginFrame(): void {
    if (this.uniformFrame)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "A worker GPU frame is already recording.",
      );
    this.uniformFrame = this.uniformArena.beginFrame();
    this.uniformUploaded = false;
    this.uniformCount = 0;
    this.uniformOccurrences.clear();
  }

  uploadFrame(): void {
    const frame = this.uniformFrame;
    if (!frame)
      throw new NativeWorkerGpuError(
        "uniform-frame-missing",
        "The GPU frame has no packed uniforms.",
      );
    if (!this.uniformCount) return;
    this.uniformArena.upload(frame);
    this.uniformUploaded = true;
  }

  finishFrame(): void {
    const frame = this.uniformFrame;
    if (!frame) return;
    if (this.uniformUploaded) this.uniformArena.finishFrame(frame);
    else this.uniformArena.abortFrame(frame);
    this.uniformFrame = null;
    this.uniformUploaded = false;
    this.uniformCount = 0;
  }

  spareBank(
    scene: NativeWorkerScene,
    compositionSignature: string | null = null,
  ): NativeWorkerGpuBank {
    this.assertLive();
    if (
      !validSize(scene.width, scene.height) ||
      !Number.isFinite(scene.pixelRatio) ||
      scene.pixelRatio <= 0
    )
      throw new NativeWorkerGpuError(
        "scene-size-invalid",
        "The native worker scene has invalid full-resolution geometry.",
      );
    const bank = this.bank;
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
      if (this.uniformFrame)
        throw new NativeWorkerGpuError(
          "frame-pipeline-busy",
          "The GPU scene changed during an active packed frame.",
        );
      if (!reuseBindings) {
        bank.bindings.clear();
        this.uniformArena = this.createUniformArena(2_097_152);
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
    bank.usedBindings.clear();
    return bank;
  }

  trimWork(bank: NativeWorkerGpuBank): void {
    if (bank !== this.bank || this.uniformFrame)
      throw new NativeWorkerGpuError(
        "frame-pipeline-busy",
        "GPU work must finish before resource retirement.",
      );
    for (const [key, resource] of bank.textures) {
      if (bank.usedTextures.has(key)) continue;
      resource.texture.destroy();
      this.allocatedBytes -= resource.bytes;
      bank.textures.delete(key);
    }
    for (const key of bank.bindings.keys())
      if (!bank.usedBindings.has(key)) bank.bindings.delete(key);
  }

  stageFinal(
    scene: NativeWorkerScene,
    sceneTexture: GPUTexture,
    encoder: GPUCommandEncoder,
  ): GPUTexture {
    this.assertLive();
    const index = 1 - this.frontFinal;
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
      this.ensureBudget(bytes, `final:${index}`);
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
    bank: NativeWorkerGpuBank,
    validatedFinal: GPUTexture,
    scene: NativeWorkerScene,
  ): void {
    this.validatePublication(bank, validatedFinal);
    bank.sceneTexture = validatedFinal;
    this.frontFinal = 1 - this.frontFinal;
    void scene;
  }

  validatePublication(
    bank: NativeWorkerGpuBank,
    validatedFinal: GPUTexture,
  ): void {
    this.assertLive();
    if (
      bank !== this.bank ||
      this.finalTextures[1 - this.frontFinal]?.texture !== validatedFinal
    )
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
    if (bank !== this.bank) return;
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
    if (!validSize(width, height))
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
    this.ensureBudget(bytes, `work:${key}`);
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
    this.allocatedBytes += bytes;
    return texture;
  }

  async pipeline(
    wgsl: string,
    format: GPUTextureFormat,
    blend: boolean,
    textureCount: number,
    placement?: EffectInstance["placement"],
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
    const key = JSON.stringify([format, blend, textureCount, constants]);
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
    const frame = this.uniformFrame;
    if (!frame)
      throw new NativeWorkerGpuError(
        "uniform-frame-missing",
        "A draw was encoded without a worker uniform frame.",
      );
    const occurrence = this.uniformOccurrences.get(key) ?? 0;
    this.uniformOccurrences.set(key, occurrence + 1);
    key = `${key}:${occurrence}`;
    bank.usedBindings.add(key);
    const packed = this.uniformArena.write(frame, key, values);
    this.uniformCount++;
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
    const plan = planEffectGraph(definition);
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
      if (!width || !height || !validSize(width, height))
        throw new NativeWorkerGpuError(
          "resource-size-unsupported",
          `Pass ${pass.id} exceeds effect bounds.`,
        );
      resourceBytes += textureSize(width, height, format);
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
      );
      const values = new Float32Array(136);
      values.set([width, height, 1 / width, 1 / height], 0);
      values.set(
        packNativeUniformClock({
          time: timeSeconds,
          seed: instance.seed,
          pixelRatio: target.pixelRatio,
        }),
        4,
      );
      values.set(packNativeProperties(definition, params), 8);
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
      const render = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: output.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      render.setPipeline(pipeline);
      render.setBindGroup(0, bind);
      render.draw(3);
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
        asset.kind === "bitmap" ? "rgba8unorm-srgb" : "rgba16float";
      if (!validSize(width, height))
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
      this.allocatedBytes + this.allocatedUniformBytes + this.transientBytes
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
    this.clearBank(this.bank);
    this.retireAssets(new Set());
    for (const resource of this.finalTextures)
      if (resource) {
        resource.texture.destroy();
        this.allocatedBytes -= resource.bytes;
      }
    this.finalTextures = [null, null];
    this.white.destroy();
    this.transparent.destroy();
    this.allocatedBytes -= 8;
    this.uniformBuffer.destroy();
    this.allocatedUniformBytes -= 2_097_152;
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
  ): NativePackedUniformArena<GPUBuffer> {
    return new NativePackedUniformArena({
      buffer: this.uniformBuffer,
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

  private ensureBudget(bytes: number, key: string): void {
    const allocated = this.resourceBytes();
    if (allocated + bytes <= MAX_RESOURCE_BYTES) {
      this.sharedBudget?.(bytes, key);
      return;
    }
    const work = [...this.bank.textures.values()].reduce(
      (total, resource) => total + resource.bytes,
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
    throw new NativeWorkerGpuError(
      "gpu-budget-exceeded",
      `The native worker GPU resources exceed their bounded budget: ${key} requests ${bytes} bytes with ${allocated} bytes allocated; work ${work} bytes/${this.bank.textures.size} textures, assets ${assets} bytes/${this.assets.size} textures, finals ${finals} bytes/${this.finalTextures.filter(Boolean).length} textures.`,
    );
  }

  private clearBank(bank: NativeWorkerGpuBank): void {
    for (const resource of bank.textures.values()) {
      resource.texture.destroy();
      this.allocatedBytes -= resource.bytes;
    }
    bank.textures.clear();
    bank.bindings.clear();
    bank.usedTextures.clear();
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
