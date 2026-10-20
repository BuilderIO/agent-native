import { planNativeEffectTransform } from "../../../../shared/native-effect-transform";
import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
import { planNativeExportRegion } from "../../../../shared/native-export-region";
import { NativePreviewPolicyController } from "./native-preview-policy";
import { planNativeWorkerBackdropRoute } from "./native-worker-backdrop-route";
import {
  composeNativeWorkerScene,
  NativeWorkerCompositionError,
  type NativeWorkerBlendMode,
  type NativeWorkerCompositionSurface,
  type NativeWorkerResolveContext,
  type NativeWorkerResolvedRecord,
} from "./native-worker-compositor";
import {
  NativeWorkerFillError,
  renderNativeWorkerFill,
  type NativeWorkerFillCarry,
} from "./native-worker-fill";
import {
  NativeWorkerGpu,
  NativeWorkerGpuError,
  type NativeWorkerGpuBank,
} from "./native-worker-gpu";
import {
  finishWgsl,
  groupLocalBackdropSourceWgsl,
  inputMaskWgsl,
  nativeWorkerExportRegionWgsl,
  presentWgsl,
} from "./native-worker-gpu-wgsl";
import {
  NATIVE_WORKER_PROTOCOL_VERSION,
  type NativeWorkerEffectTarget,
  type NativeWorkerFromGpu,
  type NativeWorkerScene,
  type NativeWorkerSourceRecord,
  type NativeWorkerToGpu,
} from "./native-worker-protocol";

declare const GPUBufferUsage: Readonly<{ COPY_DST: number; MAP_READ: number }>;
declare const GPUMapMode: Readonly<{ READ: number }>;

type SceneMessage = Extract<NativeWorkerToGpu, { type: "export-scene" }>;

class NativeWorkerSceneError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeWorkerSceneError";
  }
}

function checkedScene(scene: NativeWorkerScene, gpu: NativeWorkerGpu): void {
  if (scene.sceneId !== gpu.sceneId)
    throw new NativeWorkerSceneError(
      "scene-id-mismatch",
      "The scene belongs to another GPU surface.",
    );
  if (
    !Number.isSafeInteger(scene.generation) ||
    scene.generation < 1 ||
    !Number.isSafeInteger(scene.sourceEpoch) ||
    !Number.isSafeInteger(scene.authoredEpoch) ||
    ![
      scene.viewport.x,
      scene.viewport.y,
      scene.viewport.width,
      scene.viewport.height,
      scene.pixelRatio,
      scene.clock.timeSeconds,
      scene.clock.speed,
    ].every(Number.isFinite) ||
    scene.viewport.width <= 0 ||
    scene.viewport.height <= 0 ||
    scene.pixelRatio <= 0 ||
    scene.width !== Math.ceil(scene.viewport.width * scene.pixelRatio) ||
    scene.height !== Math.ceil(scene.viewport.height * scene.pixelRatio) ||
    (scene.colorSpace !== "srgb" && scene.colorSpace !== "display-p3") ||
    (scene.frameRateTarget !== undefined &&
      scene.frameRateTarget !== 60 &&
      scene.frameRateTarget !== 120)
  )
    throw new NativeWorkerSceneError(
      "scene-geometry-invalid",
      "The scene snapshot has invalid full-resolution geometry.",
    );
  const requirements = new Set<string>();
  for (const asset of scene.requiredAssets) {
    if (
      requirements.has(asset.assetId) ||
      !gpu.hasAsset(asset.assetId, asset.revision, scene.generation)
    )
      throw new NativeWorkerSceneError(
        "scene-asset-missing",
        `Scene asset ${asset.assetId} revision ${asset.revision} is unavailable or duplicated.`,
      );
    requirements.add(asset.assetId);
  }
  const definitions = new Set(
    scene.definitions.map(
      (definition) => `${definition.id}:${definition.version}`,
    ),
  );
  const instances = new Set<string>();
  for (const instance of scene.instances) {
    if (
      !definitions.has(
        `${instance.definitionId}:${instance.definitionVersion}`,
      ) ||
      instances.has(instance.id)
    )
      throw new NativeWorkerSceneError(
        "scene-effect-invalid",
        `Effect ${instance.id} has no unique matching definition.`,
      );
    instances.add(instance.id);
  }
  if (
    scene.targets.length !== scene.instances.length ||
    scene.targets.some((target) => !instances.has(target.instanceId))
  )
    throw new NativeWorkerSceneError(
      "scene-target-invalid",
      "The scene target set does not match its effects.",
    );
  const instancesById = new Map(
    scene.instances.map((instance) => [instance.id, instance]),
  );
  for (const target of scene.targets) {
    if (!target.groupLocalOwnerId) continue;
    const child = instancesById.get(target.instanceId);
    const owner = instancesById.get(target.groupLocalOwnerId);
    if (
      child?.placement !== "backdrop" ||
      !owner ||
      (owner.placement !== "layer" && owner.placement !== "fill") ||
      child.id === owner.id
    )
      throw new NativeWorkerSceneError(
        "scene-group-local-owner-invalid",
        `Backdrop ${target.instanceId} has an invalid native owner.`,
      );
  }
}

function clockTime(
  scene: NativeWorkerScene,
  anchorMs: number,
  nowMs: number,
): number {
  return (
    scene.clock.timeSeconds +
    (scene.clock.playing
      ? (Math.max(0, nowMs - anchorMs) * scene.clock.speed) / 1000
      : 0)
  );
}

function localTime(instance: EffectInstance, globalTime: number): number {
  return (
    instance.timing.time +
    (instance.timing.paused ? 0 : globalTime * instance.timing.speed)
  );
}

export function sceneCompositionSignature(scene: NativeWorkerScene): string {
  const records = (values: readonly NativeWorkerSourceRecord[]) =>
    values.map((record) => [
      record.key,
      record.nodeId,
      record.kind,
      record.sourceRole,
      record.assetId,
      record.nativeInstanceId,
      record.imageSourceUrl,
      record.imageRendering,
      record.coordinateSpace,
      record.opacity,
      record.isolationPath,
      record.groupClips.map((group) => group.id),
    ]);
  return JSON.stringify([
    scene.sourceEpoch,
    scene.authoredEpoch,
    scene.pixelRatio,
    scene.colorSpace,
    scene.definitions,
    scene.instances,
    scene.requiredAssets,
    records(scene.records),
    scene.targets.map((target) => [
      target.instanceId,
      target.definitionHash,
      target.sourceAssetId,
      target.maskAssetId,
      target.textMaskAssetId,
      target.receiverGeometryAssetId,
      target.receiverInteriorAssetId,
      target.groupLocalOwnerId,
      records(target.sourceRecords),
      records(target.fillLocalSourceRecords ?? []),
      target.fillPhases &&
        Object.values(target.fillPhases).map((phase) => records(phase)),
    ]),
  ]);
}

function draw(
  encoder: GPUCommandEncoder,
  target: GPUTexture,
  pipeline: GPURenderPipeline,
  bind: GPUBindGroup,
): void {
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.draw(6);
  pass.end();
}

class NativeWorkerRenderer {
  private readonly instances = new Map<string, EffectInstance>();
  private readonly targets = new Map<string, NativeWorkerEffectTarget>();
  private readonly definitions = new Map<string, EffectDefinition>();
  private readonly revisions = new Map<string, number>();
  private readonly outputs = new Map<string, GPUTexture>();
  private readonly fillCarry = new Map<string, NativeWorkerFillCarry>();
  private readonly active = new Set<string>();
  private frozenBackdropOutputs = false;

  constructor(
    readonly scene: NativeWorkerScene,
    readonly timeSeconds: number,
    readonly gpu: NativeWorkerGpu,
    readonly bank: NativeWorkerGpuBank,
    readonly encoder: GPUCommandEncoder,
  ) {
    for (const instance of scene.instances)
      this.instances.set(instance.id, instance);
    for (const target of scene.targets)
      this.targets.set(target.instanceId, target);
    for (const definition of scene.definitions)
      this.definitions.set(
        `${definition.id}:${definition.version}`,
        definition,
      );
    for (const asset of scene.requiredAssets)
      this.revisions.set(asset.assetId, asset.revision);
  }

  private asset(assetId: string | undefined): GPUTexture {
    if (!assetId)
      throw new NativeWorkerSceneError(
        "native-dependency-missing",
        "A required source asset has no ID.",
      );
    const revision = this.revisions.get(assetId);
    if (revision === undefined)
      throw new NativeWorkerSceneError(
        "native-dependency-missing",
        `Asset ${assetId} is absent from the scene snapshot.`,
      );
    return this.gpu.asset(assetId, revision, this.scene.generation);
  }

  private async compose(
    records: readonly NativeWorkerSourceRecord[],
    key: string,
    surface?: NativeWorkerCompositionSurface,
    blendMode?: NativeWorkerBlendMode,
    overrides?: ReadonlyMap<string, GPUTexture>,
    composingOwnerId?: string,
  ): Promise<GPUTexture> {
    const bank = this.bank;
    return composeNativeWorkerScene({
      scene: this.scene,
      records,
      surface,
      outputName: key,
      blendMode:
        blendMode ??
        (this.scene.colorSpace === "srgb" && records.length > 1
          ? "srgb-css-linear"
          : "linear"),
      format: this.gpu.workingFormat,
      encoder: this.encoder,
      bank: {
        texture: (name, width, height) =>
          this.gpu.texture(bank, `composition:${name}`, width, height),
      },
      gpu: {
        pipeline: (wgsl, format, blend, textureCount) =>
          this.gpu.pipeline(wgsl, format, blend, textureCount),
        bind: (name, pipeline, source, mask, data, sampler, extras) =>
          this.gpu.bind(
            bank,
            `composition:${name}`,
            pipeline,
            source,
            mask,
            data,
            extras,
            sampler,
          ),
        sampler: (filter) =>
          filter === "nearest" ? this.gpu.nearestSampler : this.gpu.sampler,
      },
      resolveRecord: (record, context) =>
        this.resolve(record, context, overrides, composingOwnerId),
    });
  }

  private async resolve(
    record: NativeWorkerSourceRecord,
    context: NativeWorkerResolveContext,
    overrides?: ReadonlyMap<string, GPUTexture>,
    composingOwnerId?: string,
  ): Promise<NativeWorkerResolvedRecord> {
    if (!record.nativeInstanceId)
      return { texture: this.asset(record.assetId), premultiplied: false };
    const instance = this.instances.get(record.nativeInstanceId);
    const target = this.targets.get(record.nativeInstanceId);
    if (!instance || !target)
      throw new NativeWorkerSceneError(
        "native-dependency-missing",
        `Native record ${record.key} has no effect target.`,
      );
    const override = overrides?.get(instance.id);
    if (override)
      return {
        texture: override,
        premultiplied: true,
        backdropReplacement: instance.placement === "backdrop",
        receiverCoverage:
          instance.placement === "backdrop"
            ? this.asset(target.maskAssetId)
            : undefined,
      };
    if (record.sourceRole === "ancestor-fill-prefix")
      throw new NativeWorkerSceneError(
        "native-dependency-missing",
        "The staged ancestor Fill prefix is unavailable.",
      );
    if (instance.placement === "backdrop" && this.frozenBackdropOutputs) {
      const frozen = this.outputs.get(instance.id);
      if (!frozen)
        throw new NativeWorkerSceneError(
          "composition-backdrop-snapshot-missing",
          `Backdrop ${instance.id} was not rendered from the unfiltered scene.`,
        );
      return {
        texture: frozen,
        premultiplied: true,
        backdropReplacement: true,
        receiverCoverage: this.asset(target.maskAssetId),
      };
    }
    const backdropRoute =
      instance.placement === "backdrop"
        ? planNativeWorkerBackdropRoute(
            target.groupLocalOwnerId,
            composingOwnerId,
          )
        : null;
    if (backdropRoute === "owner-output") {
      const ownerId = target.groupLocalOwnerId!;
      const owner = this.instances.get(ownerId);
      const ownerTarget = this.targets.get(ownerId);
      if (!owner || !ownerTarget)
        throw new NativeWorkerSceneError(
          "native-dependency-missing",
          `Nested Glass ${instance.id} has no native owner.`,
        );
      if (!this.outputs.has(instance.id))
        await this.renderTarget(ownerTarget, owner, context);
      const ownedOutput = this.outputs.get(instance.id);
      if (!ownedOutput)
        throw new NativeWorkerSceneError(
          "native-dependency-missing",
          `Nested Glass ${instance.id} has no staged owner output.`,
        );
      return {
        texture: ownedOutput,
        premultiplied: true,
        backdropReplacement: true,
        receiverCoverage: this.asset(target.maskAssetId),
      };
    }
    if (instance.placement === "backdrop" && !context.currentScene)
      return {
        backdropReplacement: true,
        receiverCoverage: this.asset(target.maskAssetId),
        ...(backdropRoute === "group-local"
          ? {
              nestedBackdrop: {
                output: { width: target.width, height: target.height },
                extent: target.outputExtent,
              },
            }
          : {}),
      };
    return {
      texture: await this.renderTarget(target, instance, context),
      premultiplied: true,
      backdropReplacement: instance.placement === "backdrop",
      receiverCoverage:
        instance.placement === "backdrop"
          ? this.asset(target.maskAssetId)
          : undefined,
    };
  }

  private async backdropSource(
    target: NativeWorkerEffectTarget,
    context: NativeWorkerResolveContext,
  ): Promise<GPUTexture> {
    const incoming = context.incoming;
    const current = context.currentScene;
    if (!incoming || !current)
      throw new NativeWorkerSceneError(
        "backdrop-source-missing",
        "The live scene behind Glass is unavailable.",
      );
    const output = this.gpu.texture(
      this.bank,
      `backdrop:${target.instanceId}:source`,
      target.width,
      target.height,
    );
    if (!context.window)
      throw new NativeWorkerSceneError(
        "backdrop-geometry-unsupported",
        "Glass requires a validated source window.",
      );
    const packet = new Float32Array(context.window.packet);
    packet[2] = context.encodedScene ? 1 : 0;
    const pipeline = await this.gpu.pipeline(
      groupLocalBackdropSourceWgsl,
      this.gpu.workingFormat,
      false,
      1,
    );
    const bind = this.gpu.bind(
      this.bank,
      `backdrop:${target.instanceId}:source`,
      pipeline,
      current,
      null,
      packet,
    );
    draw(this.encoder, output, pipeline, bind);
    return output;
  }

  private async finish(
    target: NativeWorkerEffectTarget,
    instance: EffectInstance,
    definition: EffectDefinition,
    source: GPUTexture,
  ): Promise<GPUTexture> {
    if (instance.placement === "backdrop" && instance.clip === "text")
      throw new NativeWorkerSceneError(
        "backdrop-text-replacement-unsupported",
        "Text-clipped backdrop replacement needs separate coverage.",
      );
    const extent = target.outputExtent;
    const transform = planNativeEffectTransform(instance.transform, {
      width: target.width,
      height: target.height,
      pixelRatio: target.pixelRatio,
      target: {
        x: extent?.left ?? 0,
        y: extent?.top ?? 0,
        width: extent?.sourceWidth ?? target.width,
        height: extent?.sourceHeight ?? target.height,
      },
    });
    if (!transform.ok)
      throw new NativeWorkerSceneError(transform.code, transform.detail);
    const radii =
      instance.placement === "backdrop" ||
      instance.placement === "fill" ||
      extent?.expanded
        ? [0, 0, 0, 0, 0, 0, 0, 0]
        : (target.cornerRadii ?? [0, 0, 0, 0, 0, 0, 0, 0]);
    const textClip =
      instance.clip === "text" &&
      (instance.placement === "fill" ||
        (instance.placement === "layer" && definition.kind === "processor"));
    const mask = textClip
      ? this.asset(target.textMaskAssetId)
      : this.gpu.whiteTexture();
    const output = this.gpu.texture(
      this.bank,
      `effect:${instance.id}:finish`,
      target.width,
      target.height,
    );
    const pipeline = await this.gpu.pipeline(
      finishWgsl,
      this.gpu.workingFormat,
      false,
      2,
    );
    const values = new Float32Array([
      target.width,
      target.height,
      0,
      0,
      instance.placement === "backdrop" ? 1 : instance.opacity,
      textClip ? 1 : 0,
      0,
      0,
      0,
      0,
      target.width,
      target.height,
      ...radii,
      ...transform.rows[0],
      ...transform.rows[1],
    ]);
    const bind = this.gpu.bind(
      this.bank,
      `effect:${instance.id}:finish`,
      pipeline,
      source,
      mask,
      values,
    );
    draw(this.encoder, output, pipeline, bind);
    return output;
  }

  private async renderTarget(
    target: NativeWorkerEffectTarget,
    instance: EffectInstance,
    context: NativeWorkerResolveContext,
  ): Promise<GPUTexture> {
    const cached = this.outputs.get(instance.id);
    if (cached) return cached;
    if (this.active.has(instance.id))
      throw new NativeWorkerSceneError(
        "effect-dependency-cycle",
        `Effect ${instance.id} recursively depends on itself.`,
      );
    this.active.add(instance.id);
    try {
      const definition = this.definitions.get(
        `${instance.definitionId}:${instance.definitionVersion}`,
      );
      if (!definition)
        throw new NativeWorkerSceneError(
          "effect-definition-missing",
          `Effect ${instance.id} has no definition.`,
        );
      const surface: NativeWorkerCompositionSurface = {
        width: target.width,
        height: target.height,
        pixelRatio: target.pixelRatio,
        outputExtent: target.outputExtent,
        targetLocalSize: {
          width:
            (target.outputExtent?.sourceWidth ?? target.width) /
            target.pixelRatio,
          height:
            (target.outputExtent?.sourceHeight ?? target.height) /
            target.pixelRatio,
        },
        targetViewportSize: {
          width: target.rect.width,
          height: target.rect.height,
        },
      };
      const layerChain =
        instance.placement === "layer"
          ? this.scene.instances.filter(
              (candidate) =>
                candidate.placement === "layer" &&
                candidate.nodeId === instance.nodeId,
            )
          : [];
      const layerIndex = layerChain.findIndex(
        (candidate) => candidate.id === instance.id,
      );
      const previousLayer =
        layerIndex > 0 ? layerChain[layerIndex - 1] : undefined;
      let source: GPUTexture;
      if (previousLayer) {
        const previousTarget = this.targets.get(previousLayer.id);
        if (!previousTarget)
          throw new NativeWorkerSceneError(
            "effect-layer-dependency-unavailable",
            "The previous Layer target is unavailable.",
          );
        const previousOutput = await this.renderTarget(
          previousTarget,
          previousLayer,
          context,
        );
        source = await this.alignedLayerSource(
          target,
          previousTarget,
          previousOutput,
        );
      } else if (instance.placement === "backdrop" && context.window) {
        source = await this.backdropSource(target, context);
      } else if (instance.placement === "fill") {
        source = this.gpu.transparentTexture();
      } else {
        source = target.sourceRecords.length
          ? await this.compose(
              target.sourceRecords,
              `target:${instance.id}:source`,
              surface,
              undefined,
              undefined,
              instance.placement === "layer" ? instance.id : undefined,
            )
          : this.gpu.transparentTexture();
      }
      const finished = await this.runEffect(
        target,
        instance,
        definition,
        source,
      );
      if (instance.placement === "fill") {
        const sameNodeFills = this.scene.instances.filter(
          (candidate) =>
            candidate.nodeId === instance.nodeId &&
            candidate.placement === "fill",
        );
        const index = sameNodeFills.findIndex(
          (candidate) => candidate.id === instance.id,
        );
        const previous = sameNodeFills[index - 1];
        if (previous && !this.fillCarry.has(previous.id)) {
          const previousTarget = this.targets.get(previous.id);
          if (!previousTarget)
            throw new NativeWorkerSceneError(
              "fill-dependency-unavailable",
              "The previous Fill target is unavailable.",
            );
          await this.renderTarget(previousTarget, previous, context);
        }
        const fill = await renderNativeWorkerFill({
          scene: this.scene,
          target,
          instance,
          encoder: this.encoder,
          bank: this.bank,
          gpu: this.gpu,
          format: this.gpu.workingFormat,
          transparent: this.gpu.transparentTexture(),
          foreground: finished,
          previousFill: previous ? this.fillCarry.get(previous.id) : undefined,
          isTopFill:
            index === sameNodeFills.length - 1 &&
            !this.scene.instances
              .slice(
                this.scene.instances.findIndex(
                  (candidate) => candidate.id === instance.id,
                ) + 1,
              )
              .some(
                (candidate) =>
                  candidate.nodeId === instance.nodeId &&
                  candidate.placement === "layer",
              ),
          asset: (record) => this.asset(record.assetId),
          composeRecords: (records, key, surface, blendMode, overrides) =>
            this.compose(records, key, surface, blendMode, overrides),
          stageFillBackdrops: (records, backdrop, presentationExtent) =>
            this.stageFillBackdrops(
              instance,
              records,
              backdrop,
              presentationExtent,
            ),
        });
        this.fillCarry.set(instance.id, fill.carry);
        this.outputs.set(instance.id, fill.texture);
        return fill.texture;
      }
      this.outputs.set(instance.id, finished);
      return finished;
    } finally {
      this.active.delete(instance.id);
    }
  }

  private async runEffect(
    target: NativeWorkerEffectTarget,
    instance: EffectInstance,
    definition: EffectDefinition,
    source: GPUTexture,
  ): Promise<GPUTexture> {
    const mask = definition.passes.some((pass) => pass.reads.includes("mask"))
      ? await this.effectMask(target, instance)
      : this.gpu.whiteTexture();
    const result = await this.gpu.effect(
      this.bank,
      target,
      definition,
      instance,
      source,
      localTime(instance, this.timeSeconds),
      this.encoder,
      new Map([
        ...(target.receiverGeometryAssetId
          ? [
              [
                "receiverGeometry",
                this.asset(target.receiverGeometryAssetId),
              ] as const,
            ]
          : []),
        ...(target.receiverInteriorAssetId
          ? [
              [
                "receiverInterior",
                this.asset(target.receiverInteriorAssetId),
              ] as const,
            ]
          : []),
        ["mask", mask],
      ]),
    );
    return this.finish(
      target,
      instance.placement === "fill" && instance.clip === "text"
        ? { ...instance, opacity: 1 }
        : instance,
      definition,
      result,
    );
  }

  private async effectMask(
    target: NativeWorkerEffectTarget,
    instance: EffectInstance,
  ): Promise<GPUTexture> {
    if (instance.placement === "backdrop")
      return this.asset(target.maskAssetId);
    const text =
      instance.clip === "text"
        ? this.asset(target.textMaskAssetId)
        : this.gpu.whiteTexture();
    const extent = target.outputExtent;
    const radii = target.cornerRadii ?? [0, 0, 0, 0, 0, 0, 0, 0];
    if (!extent?.expanded && radii.every((radius) => radius === 0)) return text;
    const output = this.gpu.texture(
      this.bank,
      `effect:${instance.id}:input-mask`,
      target.width,
      target.height,
    );
    const pipeline = await this.gpu.pipeline(
      inputMaskWgsl,
      this.gpu.workingFormat,
      false,
      1,
    );
    const bind = this.gpu.bind(
      this.bank,
      `effect:${instance.id}:input-mask`,
      pipeline,
      text,
      null,
      new Float32Array([
        target.width,
        target.height,
        0,
        0,
        extent?.left ?? 0,
        extent?.top ?? 0,
        extent?.sourceWidth ?? target.width,
        extent?.sourceHeight ?? target.height,
        ...radii,
      ]),
    );
    draw(this.encoder, output, pipeline, bind);
    return output;
  }

  private async alignedLayerSource(
    target: NativeWorkerEffectTarget,
    previous: NativeWorkerEffectTarget,
    prior: GPUTexture,
  ): Promise<GPUTexture> {
    const extent = target.outputExtent;
    const priorExtent = previous.outputExtent;
    if (
      !extent ||
      !priorExtent ||
      prior.width !== priorExtent.width ||
      prior.height !== priorExtent.height ||
      prior.format !== this.gpu.workingFormat
    )
      throw new NativeWorkerSceneError(
        "effect-layer-dependency-stale",
        "The previous Layer output does not match its extent.",
      );
    const left = extent.left - priorExtent.left;
    const top = extent.top - priorExtent.top;
    if (
      left < 0 ||
      top < 0 ||
      left + prior.width > extent.width ||
      top + prior.height > extent.height
    )
      throw new NativeWorkerSceneError(
        "effect-layer-chain-geometry-invalid",
        "Chained Layer output cannot fit the next effect extent.",
      );
    if (
      !left &&
      !top &&
      prior.width === extent.width &&
      prior.height === extent.height
    )
      return prior;
    const aligned = this.gpu.texture(
      this.bank,
      `effect:${target.instanceId}:aligned-source`,
      extent.width,
      extent.height,
    );
    const clear = this.encoder.beginRenderPass({
      colorAttachments: [
        {
          view: aligned.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    clear.end();
    this.encoder.copyTextureToTexture(
      { texture: prior },
      { texture: aligned, origin: [left, top, 0] },
      [prior.width, prior.height],
    );
    return aligned;
  }

  private async stageFillBackdrops(
    parent: EffectInstance,
    records: readonly NativeWorkerSourceRecord[],
    base: GPUTexture,
    extent: NonNullable<NativeWorkerEffectTarget["outputExtent"]>,
  ): Promise<ReadonlyMap<string, GPUTexture>> {
    const staged = new Map<string, GPUTexture>();
    for (const record of records) {
      const childId = record.nativeInstanceId;
      if (!childId || staged.has(childId)) continue;
      const child = this.instances.get(childId);
      if (!child || child.placement !== "backdrop") continue;
      const target = this.targets.get(childId);
      const definition =
        child &&
        this.definitions.get(
          `${child.definitionId}:${child.definitionVersion}`,
        );
      if (!target || !definition || !target.fillLocalSourceRecords)
        throw new NativeWorkerSceneError(
          "fill-child-staging-unavailable",
          `Nested Glass ${childId} has no Fill-local source snapshot.`,
        );
      const prefixes = target.fillLocalSourceRecords.filter(
        (source) => source.sourceRole === "ancestor-fill-prefix",
      );
      if (prefixes.length !== 1 || prefixes[0]?.nativeInstanceId !== parent.id)
        throw new NativeWorkerSceneError(
          "fill-child-source-invalid",
          `Nested Glass ${childId} has no unique ancestor Fill prefix.`,
        );
      if (this.active.has(childId))
        throw new NativeWorkerSceneError(
          "effect-dependency-cycle",
          `Nested Glass ${childId} is recursively active.`,
        );
      this.active.add(childId);
      try {
        const overrides = new Map<string, GPUTexture>([
          [parent.id, base],
          ...staged,
        ]);
        const source = await this.compose(
          target.fillLocalSourceRecords,
          `fill-local:${parent.id}:${childId}`,
          {
            width: target.width,
            height: target.height,
            pixelRatio: target.pixelRatio,
            outputExtent: target.outputExtent,
            targetLocalSize: {
              width:
                (target.outputExtent?.sourceWidth ?? target.width) /
                target.pixelRatio,
              height:
                (target.outputExtent?.sourceHeight ?? target.height) /
                target.pixelRatio,
            },
            targetViewportSize: {
              width: extent.width / extent.pixelRatio,
              height: extent.height / extent.pixelRatio,
            },
          },
          undefined,
          overrides,
        );
        const output = await this.runEffect(target, child, definition, source);
        staged.set(childId, output);
        this.outputs.set(childId, output);
      } finally {
        this.active.delete(childId);
      }
    }
    return staged;
  }

  async render(
    records: readonly NativeWorkerSourceRecord[],
  ): Promise<GPUTexture> {
    return this.compose(records, "root", {
      width: this.scene.width,
      height: this.scene.height,
      pixelRatio: this.scene.pixelRatio,
      viewport: this.scene.viewport,
    });
  }

  async renderExport(): Promise<GPUTexture> {
    if (this.scene.backdropRecords) {
      await this.compose(this.scene.backdropRecords, "export:backdrop", {
        width: this.scene.width,
        height: this.scene.height,
        pixelRatio: this.scene.pixelRatio,
        viewport: this.scene.viewport,
      });
      this.frozenBackdropOutputs = true;
    }
    return this.compose(this.scene.records, "export:selection", {
      width: this.scene.width,
      height: this.scene.height,
      pixelRatio: this.scene.pixelRatio,
      viewport: this.scene.viewport,
    });
  }

  provenance() {
    return this.scene.instances.map((instance) => ({
      instanceId: instance.id,
      definitionHash: this.targets.get(instance.id)!.definitionHash,
      payload: JSON.stringify(instance),
      localTime: localTime(instance, this.timeSeconds),
    }));
  }
}

type SceneState = {
  gpu: NativeWorkerGpu;
  staged: NativeWorkerScene | null;
  current: NativeWorkerScene | null;
  currentSignature: string | null;
  stagedSignature: string | null;
  anchorMs: number;
  stagedAnchorMs: number;
  frame: number;
  lastPresentationMs: number;
  cadence: NativePreviewPolicyController;
  busy: boolean;
  disposed: boolean;
  visible: boolean;
  exports: SceneMessage[];
  cancelled: Set<string>;
  activeExportId: string | null;
  failedGeneration: number | null;
  pendingUploads: Map<string, Promise<void>>;
  unclaimedAssets: Map<string, number>;
};

type DueScene = {
  sceneId: string;
  state: SceneState;
  scene: NativeWorkerScene;
  staged: boolean;
};

export class NativeWorkerRuntime {
  private readonly scenes = new Map<string, SceneState>();
  private readonly animationCadence = new Map<
    60 | 120,
    NativePreviewPolicyController
  >();
  private timer: number | null = null;
  private pumpBusy = false;
  private stagedCursor = 0;
  private device: GPUDevice | null = null;
  private creatingDevice: Promise<GPUDevice> | null = null;
  private gpuTail: Promise<void> = Promise.resolve();
  private readonly pendingInit = new Set<string>();
  private readonly cancelledInit = new Set<string>();
  private static readonly MAX_SHARED_RESOURCE_BYTES = 2_147_483_648;

  constructor(
    private readonly post: (
      message: NativeWorkerFromGpu,
      transfer?: Transferable[],
    ) => void,
  ) {}

  private serializeGpu<T>(task: () => Promise<T>): Promise<T> {
    const result = this.gpuTail.then(task);
    this.gpuTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private cadenceForRate(rate: 60 | 120): NativePreviewPolicyController {
    let cadence = this.animationCadence.get(rate);
    if (!cadence) {
      cadence = new NativePreviewPolicyController();
      cadence.setPolicy({ quality: "quality", frameRateTarget: rate });
      this.animationCadence.set(rate, cadence);
    }
    return cadence;
  }

  private totalResourceBytes(): number {
    let bytes = 0;
    for (const state of this.scenes.values())
      bytes += state.gpu.resourceBytes();
    return bytes;
  }

  private async validateUploads(
    scene: NativeWorkerScene,
    state: SceneState,
  ): Promise<void> {
    await Promise.all(
      scene.requiredAssets.map((asset) =>
        state.pendingUploads.get(
          NativeWorkerGpu.assetKey(asset.assetId, asset.revision),
        ),
      ),
    );
    if (state.disposed)
      throw new NativeWorkerSceneError(
        "worker-scene-unavailable",
        "The GPU scene was disposed during asset validation.",
      );
  }

  private async sharedDevice(): Promise<GPUDevice> {
    if (this.device) return this.device;
    if (!this.creatingDevice)
      this.creatingDevice = (async () => {
        if (!navigator.gpu)
          throw new NativeWorkerSceneError(
            "gpu-unavailable",
            "WebGPU is unavailable in the worker.",
          );
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter)
          throw new NativeWorkerSceneError(
            "gpu-unavailable",
            "No WebGPU adapter is available.",
          );
        const device = await adapter.requestDevice();
        this.device = device;
        device.addEventListener("uncapturederror", (event) => {
          const error = (event as Event & { error?: { message?: string } })
            .error;
          for (const [sceneId, state] of this.scenes) {
            if (state.current)
              state.failedGeneration = state.current.generation;
            this.post({
              type: "error",
              sceneId,
              generation: state.current?.generation,
              code: "gpu-uncaptured-error",
              message:
                error?.message || "The GPU reported an uncaptured error.",
            });
          }
        });
        void device.lost.then((loss) => {
          for (const [sceneId, state] of this.scenes) {
            state.disposed = true;
            this.post({
              type: "error",
              sceneId,
              code: "gpu-device-lost",
              message: loss.message || "The GPU device was lost.",
            });
          }
        });
        return device;
      })();
    return this.creatingDevice;
  }

  private error(
    sceneId: string,
    error: unknown,
    requestId?: string,
    generation?: number,
  ): void {
    const known =
      error instanceof NativeWorkerGpuError ||
      error instanceof NativeWorkerSceneError ||
      error instanceof NativeWorkerCompositionError ||
      error instanceof NativeWorkerFillError;
    this.post({
      type: "error",
      sceneId,
      requestId,
      generation,
      code: known ? error.code : "worker-render-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  async handle(message: NativeWorkerToGpu): Promise<void> {
    if (message.type === "init") {
      if (
        this.scenes.has(message.sceneId) ||
        this.pendingInit.has(message.sceneId)
      ) {
        this.error(
          message.sceneId,
          new NativeWorkerSceneError(
            "worker-protocol-mismatch",
            "The GPU scene is already initializing.",
          ),
        );
        return;
      }
      this.pendingInit.add(message.sceneId);
      try {
        if (message.protocol !== NATIVE_WORKER_PROTOCOL_VERSION)
          throw new NativeWorkerSceneError(
            "worker-protocol-mismatch",
            "The GPU worker initialization is invalid.",
          );
        const gpu = await this.serializeGpu(async () => {
          if (
            this.totalResourceBytes() + 2_097_160 >
            NativeWorkerRuntime.MAX_SHARED_RESOURCE_BYTES
          )
            throw new NativeWorkerGpuError(
              "gpu-shared-budget-exceeded",
              "The shared GPU worker has reached its bounded resource budget.",
            );
          const created = await NativeWorkerGpu.create(
            message.sceneId,
            message.canvas,
            await this.sharedDevice(),
          );
          if (
            this.totalResourceBytes() + created.resourceBytes() >
            NativeWorkerRuntime.MAX_SHARED_RESOURCE_BYTES
          ) {
            created.dispose();
            throw new NativeWorkerGpuError(
              "gpu-shared-budget-exceeded",
              "The shared GPU worker has reached its bounded resource budget.",
            );
          }
          created.setSharedBudget((bytes, key) => {
            if (
              this.totalResourceBytes() + bytes >
              NativeWorkerRuntime.MAX_SHARED_RESOURCE_BYTES
            )
              throw new NativeWorkerGpuError(
                "gpu-shared-budget-exceeded",
                `The shared GPU worker cannot allocate ${key} within its bounded resource budget.`,
              );
          });
          return created;
        });
        if (this.cancelledInit.delete(message.sceneId)) {
          gpu.dispose();
          return;
        }
        this.scenes.set(message.sceneId, {
          gpu,
          staged: null,
          current: null,
          currentSignature: null,
          stagedSignature: null,
          anchorMs: 0,
          stagedAnchorMs: 0,
          frame: 0,
          busy: false,
          disposed: false,
          visible: true,
          exports: [],
          cancelled: new Set(),
          lastPresentationMs: -Infinity,
          activeExportId: null,
          failedGeneration: null,
          cadence: new NativePreviewPolicyController(),
          pendingUploads: new Map(),
          unclaimedAssets: new Map(),
        });
        this.post({
          type: "ready",
          sceneId: message.sceneId,
          protocol: NATIVE_WORKER_PROTOCOL_VERSION,
        });
      } catch (error) {
        this.error(message.sceneId, error);
      } finally {
        this.pendingInit.delete(message.sceneId);
        if (!this.scenes.size && !this.pendingInit.size && this.device) {
          this.device.destroy();
          this.device = null;
          this.creatingDevice = null;
        }
      }
      return;
    }
    if (message.type === "dispose" && this.pendingInit.has(message.sceneId)) {
      this.cancelledInit.add(message.sceneId);
      return;
    }
    const sceneId =
      message.type === "scene" ? message.scene.sceneId : message.sceneId;
    const state = this.scenes.get(sceneId);
    if (!state || state.disposed) {
      if (message.type === "asset" && message.kind === "bitmap")
        message.bitmap.close();
      this.error(
        sceneId,
        new NativeWorkerSceneError(
          "worker-scene-unavailable",
          "The worker scene is unavailable.",
        ),
      );
      return;
    }
    if (message.type === "visibility") {
      state.visible = message.visible;
      if (!state.visible)
        void this.serializeGpu(async () => {
          if (!state.disposed && !state.visible)
            state.gpu.reject(state.gpu.frontBank());
        }).catch((error) => this.error(sceneId, error));
      if (!this.hasScheduledWork() && this.timer !== null) {
        cancelAnimationFrame(this.timer);
        this.timer = null;
      }
      this.schedule();
      return;
    }
    if (message.type === "asset") {
      const key = NativeWorkerGpu.assetKey(message.assetId, message.revision);
      state.unclaimedAssets.set(key, message.generation);
      const task = this.serializeGpu(async () => {
        state.gpu.device.pushErrorScope("validation");
        let scopeOpen = true;
        try {
          state.gpu.uploadAsset(message);
          const validation = await state.gpu.device.popErrorScope();
          scopeOpen = false;
          if (validation)
            throw new NativeWorkerSceneError(
              "gpu-asset-validation",
              validation.message,
            );
          await state.gpu.device.queue.onSubmittedWorkDone();
        } catch (error) {
          if (scopeOpen) await state.gpu.device.popErrorScope();
          await state.gpu.device.queue.onSubmittedWorkDone();
          state.gpu.dropAsset(message.assetId, message.revision);
          state.unclaimedAssets.delete(key);
          throw error;
        }
      });
      state.pendingUploads.set(key, task);
      void task.then(
        () => {
          if (state.pendingUploads.get(key) === task)
            state.pendingUploads.delete(key);
        },
        () => {
          if (state.pendingUploads.get(key) === task)
            state.pendingUploads.delete(key);
        },
      );
      void task.catch((error) =>
        this.error(sceneId, error, undefined, message.generation),
      );
      return;
    }
    if (message.type === "cancel-export") {
      if (state.activeExportId === message.requestId)
        state.cancelled.add(message.requestId);
      state.exports = state.exports.filter(
        (request) => request.requestId !== message.requestId,
      );
      return;
    }
    if (message.type === "dispose") {
      state.disposed = true;
      if (!state.busy)
        void this.serializeGpu(async () => this.disposeScene(sceneId, state));
      if (!this.hasScheduledWork() && this.timer !== null) {
        cancelAnimationFrame(this.timer);
        this.timer = null;
      }
      return;
    }
    if (message.type === "scene") {
      try {
        await this.validateUploads(message.scene, state);
        checkedScene(message.scene, state.gpu);
        for (const asset of message.scene.requiredAssets)
          state.unclaimedAssets.delete(
            NativeWorkerGpu.assetKey(asset.assetId, asset.revision),
          );
        if (
          message.scene.generation <=
          Math.max(
            state.current?.generation ?? 0,
            state.staged?.generation ?? 0,
          )
        )
          throw new NativeWorkerSceneError(
            "scene-generation-stale",
            "The native scene generation did not advance.",
          );
        state.staged = message.scene;
        state.stagedSignature = sceneCompositionSignature(message.scene);
        state.stagedAnchorMs = performance.now();
        state.failedGeneration = null;
        this.post({
          type: "scene-staged",
          sceneId,
          generation: message.scene.generation,
          sourceEpoch: message.scene.sourceEpoch,
        });
        this.schedule();
      } catch (error) {
        this.error(sceneId, error, undefined, message.scene.generation);
      }
      return;
    }
    if (message.type === "export-scene") {
      try {
        await this.validateUploads(message.scene, state);
        checkedScene(message.scene, state.gpu);
        for (const asset of message.scene.requiredAssets)
          state.unclaimedAssets.delete(
            NativeWorkerGpu.assetKey(asset.assetId, asset.revision),
          );
        if (
          message.scene.sceneId !== message.sceneId ||
          message.scene.pixelRatio !== message.pixelRatio ||
          ((message.selectedNodeIds?.length ||
            message.selectedInstanceIds?.length) &&
            !message.selectionFiltered)
        )
          throw new NativeWorkerSceneError(
            "composition-export-snapshot-invalid",
            "The export scene is not an exact filtered density snapshot.",
          );
        state.exports.push(message);
        this.schedule();
      } catch (error) {
        this.error(sceneId, error, message.requestId);
      }
      return;
    }
    if (message.type === "export") {
      this.error(
        sceneId,
        new NativeWorkerSceneError(
          "composition-export-snapshot-required",
          "PNG requires a separate immutable export-density scene snapshot.",
        ),
        message.requestId,
      );
    }
  }

  private hasScheduledWork(): boolean {
    for (const state of this.scenes.values())
      if (
        !state.disposed &&
        (state.exports.length ||
          (state.visible &&
            (state.staged ||
              (state.current?.clock.playing &&
                state.failedGeneration !== state.current.generation))))
      )
        return true;
    return false;
  }

  private schedule(): void {
    if (this.timer !== null || this.pumpBusy || !this.hasScheduledWork())
      return;
    this.timer = requestAnimationFrame((now) => {
      this.timer = null;
      void this.pumpAll(now);
    });
  }

  private async pumpAll(now: number): Promise<void> {
    if (this.pumpBusy) return;
    this.pumpBusy = true;
    try {
      const due: DueScene[] = [];
      const dueRates = new Map<60 | 120, boolean>();
      for (const [sceneId, state] of this.scenes) {
        const staged =
          state.staged !== null &&
          state.current !== null &&
          state.stagedSignature !== null &&
          state.stagedSignature === state.currentSignature;
        const scene = staged ? state.staged : state.current;
        if (!scene || !state.visible || state.disposed) continue;
        if (!staged && !scene.clock.playing) continue;
        if (state.failedGeneration === scene.generation) continue;
        state.cadence.setPolicy({
          quality: "quality",
          frameRateTarget: scene.frameRateTarget ?? 60,
        });
        const rate = scene.frameRateTarget ?? 60;
        if (!dueRates.has(rate))
          dueRates.set(
            rate,
            this.cadenceForRate(rate).isSubmissionDue(now, false, 2),
          );
        if (dueRates.get(rate)) due.push({ sceneId, state, scene, staged });
      }
      if (due.length) {
        for (const item of due) item.state.busy = true;
        const priorFrames = new Map(
          due.map((item) => [item.state, item.state.frame]),
        );
        try {
          await this.serializeGpu(() => this.batchCurrent(due, now));
        } catch (batchError) {
          let isolated = false;
          for (const item of due) {
            if (
              item.state.disposed ||
              (item.staged
                ? item.state.staged !== item.scene
                : item.state.current !== item.scene)
            )
              continue;
            try {
              await this.serializeGpu(() =>
                this.frame(item.sceneId, item.state, item.scene, now),
              );
            } catch (error) {
              isolated = true;
              if (item.staged && item.state.staged === item.scene) {
                item.state.staged = null;
                item.state.stagedSignature = null;
              } else if (!item.staged)
                item.state.failedGeneration = item.scene.generation;
              this.error(item.sceneId, error, undefined, item.scene.generation);
            }
          }
          if (!isolated) {
            const first = due[0];
            if (first)
              this.error(
                first.sceneId,
                new NativeWorkerSceneError(
                  "gpu-batch-validation",
                  `The shared GPU batch failed validation before individual scenes recovered: ${String(batchError)}`,
                ),
                undefined,
                first.scene.generation,
              );
          }
        } finally {
          for (const rate of new Set(
            due
              .filter(
                (item) =>
                  item.state.frame >
                  (priorFrames.get(item.state) ?? item.state.frame),
              )
              .map((item) => item.scene.frameRateTarget ?? 60),
          ))
            this.cadenceForRate(rate).commitSubmission(now, false);
          for (const item of due) item.state.busy = false;
        }
      }

      const exports = [...this.scenes].find(
        ([, state]) => !state.disposed && state.exports.length,
      );
      if (exports) {
        const [sceneId, state] = exports;
        const request = state.exports.shift();
        if (request) {
          state.busy = true;
          try {
            await this.serializeGpu(() =>
              this.exportScene(sceneId, state, request),
            );
          } catch (error) {
            this.error(
              sceneId,
              error,
              request.requestId,
              request.scene.generation,
            );
          } finally {
            state.busy = false;
          }
        }
      }

      const scenes = [...this.scenes];
      for (let step = 0; step < scenes.length; step++) {
        const index = (this.stagedCursor + step) % scenes.length;
        const [sceneId, state] = scenes[index]!;
        const scene = state.staged;
        if (!scene || state.disposed || !state.visible) continue;
        if (
          state.current &&
          state.stagedSignature !== null &&
          state.stagedSignature === state.currentSignature
        )
          continue;
        state.cadence.setPolicy({
          quality: "quality",
          frameRateTarget: scene.frameRateTarget ?? 60,
        });
        if (!state.cadence.isSubmissionDue(now, true, 2)) continue;
        this.stagedCursor = (index + 1) % scenes.length;
        state.busy = true;
        try {
          await this.serializeGpu(() => this.frame(sceneId, state, scene, now));
        } catch (error) {
          if (state.staged === scene) {
            state.staged = null;
            state.stagedSignature = null;
          }
          this.error(sceneId, error, undefined, scene.generation);
        } finally {
          state.busy = false;
        }
        break;
      }
    } finally {
      for (const [sceneId, state] of this.scenes)
        if (state.disposed && !state.busy)
          await this.serializeGpu(async () =>
            this.disposeScene(sceneId, state),
          );
      this.pumpBusy = false;
      this.schedule();
    }
  }

  private async batchCurrent(
    due: readonly DueScene[],
    now: number,
  ): Promise<void> {
    const device = due[0]?.state.gpu.device;
    if (!device) return;
    if (due.some((item) => item.state.gpu.device !== device))
      throw new NativeWorkerSceneError(
        "gpu-shared-device-mismatch",
        "The worker batch contains scenes from different GPU devices.",
      );
    const rendered: Array<
      DueScene & {
        bank: NativeWorkerGpuBank;
        final: GPUTexture;
        renderer: NativeWorkerRenderer;
        timeSeconds: number;
        stagedAtStart: NativeWorkerScene | null;
        currentAtStart: NativeWorkerScene | null;
        anchorAtStart: number;
      }
    > = [];
    const renderBuffers: GPUCommandBuffer[] = [];
    device.pushErrorScope("validation");
    let scopeOpen = true;
    let renderSubmitted = false;
    try {
      for (const item of due) {
        const { state, scene } = item;
        if (
          state.disposed ||
          (item.staged ? state.staged !== scene : state.current !== scene)
        )
          continue;
        const gpu = state.gpu;
        const stagedAtStart = state.staged;
        const currentAtStart = state.current;
        const anchorAtStart = item.staged
          ? state.stagedAnchorMs
          : state.anchorMs;
        const bank = gpu.spareBank(
          scene,
          item.staged ? state.stagedSignature : state.currentSignature,
        );
        gpu.beginFrame();
        const encoder = device.createCommandEncoder();
        const timeSeconds = clockTime(scene, anchorAtStart, now);
        const renderer = new NativeWorkerRenderer(
          scene,
          timeSeconds,
          gpu,
          bank,
          encoder,
        );
        const composed = await renderer.render(scene.records);
        const final = gpu.stageFinal(scene, composed, encoder);
        gpu.uploadFrame();
        renderBuffers.push(encoder.finish());
        rendered.push({
          ...item,
          bank,
          final,
          renderer,
          timeSeconds,
          stagedAtStart,
          currentAtStart,
          anchorAtStart,
        });
      }
      if (renderBuffers.length) {
        device.queue.submit(renderBuffers);
        renderSubmitted = true;
      }
      const validation = await device.popErrorScope();
      scopeOpen = false;
      if (validation)
        throw new NativeWorkerSceneError("gpu-validation", validation.message);
    } catch (error) {
      let failure: unknown = error;
      if (scopeOpen)
        try {
          await device.popErrorScope();
        } catch (scopeError) {
          failure = new NativeWorkerSceneError(
            "gpu-validation",
            `Rendering failed and its validation scope failed: ${String(error)}; ${String(scopeError)}`,
          );
        }
      if (renderSubmitted)
        try {
          await device.queue.onSubmittedWorkDone();
        } catch (queueError) {
          failure = new NativeWorkerSceneError(
            "gpu-validation",
            `Rendering failed while draining GPU work: ${String(error)}; ${String(queueError)}`,
          );
        }
      throw failure;
    } finally {
      for (const item of due) item.state.gpu.finishFrame();
    }
    if (!rendered.length) return;

    const presentBuffers: GPUCommandBuffer[] = [];
    const prepared: typeof rendered = [];
    const restorePrepared = async () => {
      let failure: unknown;
      for (const item of prepared) {
        if (item.state.disposed) continue;
        const front = item.state.gpu.frontTexture();
        if (!front || !item.currentAtStart) {
          failure ??= new NativeWorkerSceneError(
            "presentation-restore-failed",
            "The shared scene has no retained validated frame.",
          );
          continue;
        }
        try {
          await this.present(
            item.state.gpu,
            item.bank,
            item.currentAtStart,
            front,
            null,
          );
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure)
        throw new NativeWorkerSceneError(
          "presentation-restore-failed",
          `A validated shared frame could not be restored: ${String(failure)}`,
        );
    };
    device.pushErrorScope("validation");
    scopeOpen = true;
    let presentationSubmitted = false;
    try {
      for (const item of rendered) {
        const { gpu } = item.state;
        if (
          item.state.disposed ||
          (item.staged
            ? item.state.staged !== item.scene
            : item.state.current !== item.scene)
        )
          continue;
        prepared.push(item);
        gpu.preparePresentation(item.scene);
        gpu.beginFrame();
        const encoder = device.createCommandEncoder();
        const pipeline = await gpu.pipeline(
          presentWgsl(item.scene.colorSpace),
          gpu.canvasFormat,
          false,
          2,
        );
        const bind = gpu.bind(
          item.bank,
          "presentation",
          pipeline,
          item.final,
          gpu.whiteTexture(),
          new Float32Array([
            item.scene.width,
            item.scene.height,
            0,
            0,
            1,
            0,
            0,
            0,
          ]),
        );
        draw(encoder, gpu.context.getCurrentTexture(), pipeline, bind);
        gpu.uploadFrame();
        presentBuffers.push(encoder.finish());
      }
      if (presentBuffers.length) {
        device.queue.submit(presentBuffers);
        presentationSubmitted = true;
      }
      const validation = await device.popErrorScope();
      scopeOpen = false;
      if (validation)
        throw new NativeWorkerSceneError("gpu-validation", validation.message);
      if (renderSubmitted || presentationSubmitted)
        await device.queue.onSubmittedWorkDone();
      renderSubmitted = false;
      presentationSubmitted = false;
    } catch (error) {
      let failure: unknown = error;
      if (scopeOpen)
        try {
          await device.popErrorScope();
        } catch (scopeError) {
          failure = new NativeWorkerSceneError(
            "gpu-validation",
            `Presentation failed and its validation scope failed: ${String(error)}; ${String(scopeError)}`,
          );
        }
      if (renderSubmitted || presentationSubmitted)
        try {
          await device.queue.onSubmittedWorkDone();
        } catch (queueError) {
          failure = new NativeWorkerSceneError(
            "gpu-validation",
            `Presentation failed while draining GPU work: ${String(error)}; ${String(queueError)}`,
          );
        }
      for (const item of prepared) item.state.gpu.finishFrame();
      await restorePrepared();
      throw failure;
    } finally {
      for (const item of prepared) item.state.gpu.finishFrame();
    }

    const remainsCurrent = (item: (typeof prepared)[number]) => {
      const { state, scene } = item;
      const stagedUnchanged = state.staged === item.stagedAtStart;
      const compatibleCameraArrived =
        !item.staged &&
        item.stagedAtStart === null &&
        state.staged !== null &&
        state.currentSignature !== null &&
        state.stagedSignature === state.currentSignature &&
        state.staged.sourceEpoch === scene.sourceEpoch &&
        state.staged.authoredEpoch === scene.authoredEpoch;
      return (
        !state.disposed &&
        state.current === item.currentAtStart &&
        (stagedUnchanged || compatibleCameraArrived) &&
        (item.staged ? state.staged === scene : state.current === scene)
      );
    };
    const superseded = prepared.filter((item) => !remainsCurrent(item));
    if (superseded.length) {
      try {
        for (const item of superseded) {
          if (item.state.disposed) continue;
          const front = item.state.gpu.frontTexture();
          if (!front || !item.currentAtStart)
            throw new NativeWorkerSceneError(
              "presentation-restore-failed",
              "The superseded scene has no retained validated frame.",
            );
          await this.present(
            item.state.gpu,
            item.bank,
            item.currentAtStart,
            front,
            null,
          );
        }
      } catch (error) {
        await restorePrepared();
        throw error;
      }
    }
    if (
      prepared.some(
        (item) => !superseded.includes(item) && !remainsCurrent(item),
      )
    ) {
      await restorePrepared();
      return;
    }
    try {
      for (const item of prepared)
        if (!superseded.includes(item))
          item.state.gpu.validatePublication(item.bank, item.final);
    } catch (error) {
      await restorePrepared();
      throw error;
    }
    for (const item of prepared) {
      const { state, scene, sceneId, bank, final, renderer, timeSeconds } =
        item;
      if (superseded.includes(item)) continue;
      state.gpu.publish(bank, final, scene);
      if (item.staged) state.anchorMs = item.anchorAtStart;
      this.completeFrame(
        sceneId,
        state,
        scene,
        item.staged,
        now,
        bank,
        renderer,
        timeSeconds,
      );
    }
  }

  private completeFrame(
    sceneId: string,
    state: SceneState,
    scene: NativeWorkerScene,
    staged: boolean,
    now: number,
    bank: NativeWorkerGpuBank,
    renderer: NativeWorkerRenderer,
    timeSeconds: number,
  ): void {
    state.gpu.trimWork(bank);
    if (
      staged &&
      scene.clock.playing &&
      !this.animationCadence.has(scene.frameRateTarget ?? 60)
    )
      this.cadenceForRate(scene.frameRateTarget ?? 60).commitSubmission(
        now,
        false,
      );
    if (staged) {
      state.current = scene;
      state.staged = null;
      state.currentSignature = state.stagedSignature;
      state.stagedSignature = null;
    }
    state.frame++;
    state.lastPresentationMs = now;
    state.cadence.commitSubmission(now, staged);
    for (const [key, generation] of state.unclaimedAssets)
      if (generation <= scene.generation) state.unclaimedAssets.delete(key);
    const held = new Set(
      [
        ...(state.current?.requiredAssets ?? []),
        ...(state.staged?.requiredAssets ?? []),
        ...state.exports.flatMap((pending) => pending.scene.requiredAssets),
      ].map((asset) => NativeWorkerGpu.assetKey(asset.assetId, asset.revision)),
    );
    for (const key of state.unclaimedAssets.keys()) held.add(key);
    state.gpu.retireAssets(held);
    this.post({
      type: "committed",
      sceneId,
      generation: scene.generation,
      sourceEpoch: scene.sourceEpoch,
      frame: state.frame,
      timeSeconds,
      presentedAtMs: performance.now(),
      ...(staged ? { committedInstances: renderer.provenance() } : {}),
    });
  }

  private async frame(
    sceneId: string,
    state: SceneState,
    scene: NativeWorkerScene,
    now: number,
  ): Promise<void> {
    const gpu = state.gpu;
    const staged = state.staged === scene;
    const anchor = staged ? state.stagedAnchorMs : state.anchorMs;
    const timeSeconds = clockTime(scene, anchor, now);
    const bank = gpu.spareBank(
      scene,
      staged ? state.stagedSignature : state.currentSignature,
    );
    gpu.device.pushErrorScope("validation");
    let scopeOpen = true;
    let submitted = false;
    gpu.beginFrame();
    let frameOpen = true;
    try {
      const encoder = gpu.device.createCommandEncoder();
      const renderer = new NativeWorkerRenderer(
        scene,
        timeSeconds,
        gpu,
        bank,
        encoder,
      );
      const composed = await renderer.render(scene.records);
      const final = gpu.stageFinal(scene, composed, encoder);
      gpu.uploadFrame();
      gpu.device.queue.submit([encoder.finish()]);
      submitted = true;
      const validation = await gpu.device.popErrorScope();
      scopeOpen = false;
      if (validation)
        throw new NativeWorkerSceneError("gpu-validation", validation.message);
      await gpu.device.queue.onSubmittedWorkDone();
      if (state.disposed || (staged && state.staged !== scene)) return;
      gpu.finishFrame();
      frameOpen = false;
      await this.present(gpu, bank, scene, final, state.current);
      if (state.disposed) return;
      if (staged && state.staged !== scene) {
        const front = gpu.frontTexture();
        if (state.current && front) {
          try {
            await this.present(gpu, bank, state.current, front, null);
          } catch (error) {
            throw new NativeWorkerSceneError(
              "presentation-restore-failed",
              `The last validated frame could not be restored: ${String(error)}`,
            );
          }
        }
        return;
      }
      gpu.publish(bank, final, scene);
      if (staged) state.anchorMs = anchor;
      this.completeFrame(
        sceneId,
        state,
        scene,
        staged,
        now,
        bank,
        renderer,
        timeSeconds,
      );
    } catch (error) {
      if (scopeOpen) {
        const validation = await gpu.device.popErrorScope();
        if (validation && !(error instanceof Error))
          error = new NativeWorkerSceneError(
            "gpu-validation",
            validation.message,
          );
      }
      if (submitted) await gpu.device.queue.onSubmittedWorkDone();
      if (staged && state.staged === scene) {
        state.staged = null;
        state.stagedSignature = null;
      }
      throw error;
    } finally {
      if (frameOpen) gpu.finishFrame();
    }
  }

  private async present(
    gpu: NativeWorkerGpu,
    bank: NativeWorkerGpuBank,
    scene: NativeWorkerScene,
    final: GPUTexture,
    previous: NativeWorkerScene | null,
  ): Promise<void> {
    gpu.preparePresentation(scene);
    gpu.beginFrame();
    let scopeOpen = false;
    let failure: unknown;
    try {
      gpu.device.pushErrorScope("validation");
      scopeOpen = true;
      const encoder = gpu.device.createCommandEncoder();
      const pipeline = await gpu.pipeline(
        presentWgsl(scene.colorSpace),
        gpu.canvasFormat,
        false,
        2,
      );
      const bind = gpu.bind(
        bank,
        "presentation",
        pipeline,
        final,
        gpu.whiteTexture(),
        new Float32Array([scene.width, scene.height, 0, 0, 1, 0, 0, 0]),
      );
      draw(encoder, gpu.context.getCurrentTexture(), pipeline, bind);
      gpu.uploadFrame();
      gpu.device.queue.submit([encoder.finish()]);
      const validation = await gpu.device.popErrorScope();
      scopeOpen = false;
      if (validation)
        throw new NativeWorkerSceneError("gpu-validation", validation.message);
      await gpu.device.queue.onSubmittedWorkDone();
    } catch (error) {
      failure = error;
      if (scopeOpen) await gpu.device.popErrorScope();
      await gpu.device.queue.onSubmittedWorkDone();
    } finally {
      gpu.finishFrame();
    }
    if (failure) {
      const front = gpu.frontTexture();
      if (previous && front) {
        try {
          await this.present(gpu, bank, previous, front, null);
        } catch (restoreError) {
          throw new NativeWorkerSceneError(
            "presentation-restore-failed",
            `The last validated frame could not be restored: ${String(restoreError)}`,
          );
        }
      }
      throw failure;
    }
  }

  private async exportScene(
    sceneId: string,
    state: SceneState,
    request: SceneMessage,
  ): Promise<void> {
    state.activeExportId = request.requestId;
    const gpu = state.gpu;
    let bank: NativeWorkerGpuBank | null = null;
    let frameOpen = false;
    let scopeOpen = false;
    let readback: GPUBuffer | null = null;
    let readbackBytes = 0;
    let readbackReserved = false;
    let submitted = false;
    let mapped = false;
    let cancelled = state.cancelled.delete(request.requestId);
    let failed = false;
    let failure: unknown;
    let response: Extract<NativeWorkerFromGpu, { type: "exported" }> | null =
      null;
    const cleanup = (action: () => void) => {
      try {
        action();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    };
    try {
      if (!cancelled) {
        const planned = planNativeExportRegion({
          viewport: {
            width: Math.ceil(request.scene.viewport.width),
            height: Math.ceil(request.scene.viewport.height),
          },
          cropRect: request.cropRect,
          pixelRatio: request.pixelRatio,
        });
        if (!planned.ok)
          throw new NativeWorkerSceneError(
            `composition-${planned.code}`,
            "The selected PNG region has unsupported geometry.",
          );
        bank = gpu.spareBank(request.scene);
        gpu.beginFrame();
        frameOpen = true;
        gpu.device.pushErrorScope("validation");
        scopeOpen = true;
        const encoder = gpu.device.createCommandEncoder();
        const renderer = new NativeWorkerRenderer(
          request.scene,
          request.timeSeconds,
          gpu,
          bank,
          encoder,
        );
        const composed = await renderer.renderExport();
        const output = gpu.texture(
          bank,
          "export:output",
          planned.width,
          planned.height,
          "rgba8unorm",
        );
        const pipeline = await gpu.pipeline(
          nativeWorkerExportRegionWgsl,
          "rgba8unorm",
          false,
          1,
        );
        const crop = planned.region;
        const bind = gpu.bind(
          bank,
          "export:color",
          pipeline,
          composed,
          null,
          new Float32Array([
            request.scene.width,
            request.scene.height,
            (crop.x - request.scene.viewport.x) * request.pixelRatio,
            (crop.y - request.scene.viewport.y) * request.pixelRatio,
            1,
            0,
            0,
            0,
          ]),
        );
        draw(encoder, output, pipeline, bind);
        const bytesPerRow = Math.ceil((planned.width * 4) / 256) * 256;
        readbackBytes = bytesPerRow * planned.height;
        gpu.reserveTransient(readbackBytes, "export:readback");
        readbackReserved = true;
        readback = gpu.device.createBuffer({
          size: readbackBytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyTextureToBuffer(
          { texture: output },
          { buffer: readback, bytesPerRow },
          [planned.width, planned.height],
        );
        gpu.uploadFrame();
        gpu.device.queue.submit([encoder.finish()]);
        submitted = true;
        const validation = await gpu.device.popErrorScope();
        scopeOpen = false;
        if (validation)
          throw new NativeWorkerSceneError(
            "gpu-validation",
            validation.message,
          );
        await gpu.device.queue.onSubmittedWorkDone();
        cancelled = state.cancelled.delete(request.requestId);
        if (!cancelled) {
          await readback.mapAsync(GPUMapMode.READ);
          mapped = true;
          cancelled = state.cancelled.delete(request.requestId);
          if (!cancelled) {
            const mappedBytes = new Uint8Array(readback.getMappedRange());
            const rgba = new Uint8Array(planned.width * planned.height * 4);
            for (let row = 0; row < planned.height; row++)
              rgba.set(
                mappedBytes.subarray(
                  row * bytesPerRow,
                  row * bytesPerRow + planned.width * 4,
                ),
                row * planned.width * 4,
              );
            response = {
              type: "exported",
              sceneId,
              requestId: request.requestId,
              generation: request.scene.generation,
              sourceEpoch: request.scene.sourceEpoch,
              width: planned.width,
              height: planned.height,
              rgba: rgba.buffer,
              timeSeconds: request.timeSeconds,
              committedInstances: renderer.provenance(),
            };
          }
        }
      }
    } catch (error) {
      failed = true;
      failure = error;
      if (scopeOpen) {
        try {
          await gpu.device.popErrorScope();
        } catch (scopeError) {
          failure = scopeError;
        }
      }
      if (submitted) {
        try {
          await gpu.device.queue.onSubmittedWorkDone();
        } catch (queueError) {
          failure = queueError;
        }
      }
    } finally {
      if (mapped) cleanup(() => readback?.unmap());
      if (readback) {
        const buffer = readback;
        cleanup(() => buffer.destroy());
      }
      if (readbackReserved) cleanup(() => gpu.releaseTransient(readbackBytes));
      if (frameOpen) cleanup(() => gpu.finishFrame());
      if (submitted && bank) {
        const finishedBank = bank;
        cleanup(() => gpu.trimWork(finishedBank));
      }
      state.activeExportId = null;
      cancelled = state.cancelled.delete(request.requestId) || cancelled;
      const held = new Set(
        [
          ...(state.current?.requiredAssets ?? []),
          ...(state.staged?.requiredAssets ?? []),
          ...state.exports.flatMap((pending) => pending.scene.requiredAssets),
        ].map((asset) =>
          NativeWorkerGpu.assetKey(asset.assetId, asset.revision),
        ),
      );
      for (const key of state.unclaimedAssets.keys()) held.add(key);
      cleanup(() => gpu.retireAssets(held));
    }
    if (cancelled) return;
    if (failed) this.error(sceneId, failure, request.requestId);
    else if (response) this.post(response, [response.rgba]);
  }

  private disposeScene(sceneId: string, state: SceneState): void {
    state.gpu.dispose();
    this.scenes.delete(sceneId);
    if (!this.scenes.size && this.device) {
      this.device.destroy();
      this.device = null;
      this.creatingDevice = null;
    }
  }
}

const workerScope = globalThis as typeof globalThis & {
  postMessage(message: NativeWorkerFromGpu, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<NativeWorkerToGpu>) => void) | null;
};
const runtime = new NativeWorkerRuntime((message, transfer) =>
  workerScope.postMessage(message, transfer),
);
workerScope.onmessage = (event) => {
  void runtime.handle(event.data);
};
