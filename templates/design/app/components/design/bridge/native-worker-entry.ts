import { planNativeEffectTransform } from "../../../../shared/native-effect-transform";
import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
import { planNativeExportRegion } from "../../../../shared/native-export-region";
import {
  nativeWorkerInputAssetId,
  planNativeInputResources,
} from "../../../../shared/native-input-resources";
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
  NativeWorkerGpuFlightCapacityError,
  nativeWorkerTextureSizeValid,
  type NativeWorkerGpuBank,
  type NativeWorkerGpuFlightLease,
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
  nativeWorkerClockSampleValid,
  type NativeWorkerEffectTarget,
  type NativeWorkerFromGpu,
  type NativeWorkerCamera,
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
    typeof scene.clock.playing !== "boolean" ||
    !nativeWorkerClockSampleValid(
      scene.clock,
      performance.timeOrigin + performance.now(),
    ) ||
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
    !nativeWorkerTextureSizeValid(scene.width, scene.height) ||
    scene.width !== Math.ceil(scene.viewport.width * scene.pixelRatio) ||
    scene.height !== Math.ceil(scene.viewport.height * scene.pixelRatio) ||
    (scene.colorSpace !== "srgb" && scene.colorSpace !== "display-p3") ||
    (scene.frameRateTarget !== undefined &&
      scene.frameRateTarget !== 60 &&
      scene.frameRateTarget !== 120) ||
    (scene.compact !== undefined && typeof scene.compact !== "boolean")
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
  const definitionsByKey = new Map(
    scene.definitions.map((definition) => [
      `${definition.id}:${definition.version}`,
      definition,
    ]),
  );
  for (const target of scene.targets) {
    const instance = instancesById.get(target.instanceId);
    const definition = instance
      ? definitionsByKey.get(
          `${instance.definitionId}:${instance.definitionVersion}`,
        )
      : undefined;
    if (!instance || !definition)
      throw new NativeWorkerSceneError(
        "scene-effect-invalid",
        `Effect ${target.instanceId} has no matching definition.`,
      );
    const plan = planNativeInputResources(definition, instance);
    if (!plan.ok) throw new NativeWorkerSceneError(plan.code, plan.detail);
    const expectedInputAssets = [...plan.inputs].flatMap(([resource, input]) =>
      input.kind === "asset"
        ? ([[resource, nativeWorkerInputAssetId(input)]] as const)
        : [],
    );
    const supplied = Object.entries(target.inputAssetIds ?? {});
    if (
      expectedInputAssets.length !== supplied.length ||
      expectedInputAssets.some(
        ([resource, assetId]) =>
          assetId === null ||
          target.inputAssetIds?.[resource] !== assetId ||
          !requirements.has(assetId),
      )
    )
      throw new NativeWorkerSceneError(
        "scene-input-asset-invalid",
        `Effect ${target.instanceId} has invalid input asset bindings.`,
      );
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

function compatibleCameraContent(
  base: NativeWorkerScene,
  candidate: NativeWorkerScene,
): boolean {
  return (
    candidate.sceneId === base.sceneId &&
    candidate.sourceEpoch === base.sourceEpoch &&
    candidate.authoredEpoch === base.authoredEpoch &&
    candidate.pixelRatio === base.pixelRatio &&
    candidate.colorSpace === base.colorSpace &&
    candidate.frameRateTarget === base.frameRateTarget &&
    candidate.compact === base.compact &&
    candidate.definitions === base.definitions &&
    candidate.instances === base.instances &&
    candidate.targets === base.targets &&
    candidate.records === base.records &&
    candidate.backdropRecords === base.backdropRecords &&
    candidate.requiredAssets === base.requiredAssets
  );
}

function checkedCamera(
  camera: NativeWorkerCamera,
  state: SceneState,
): NativeWorkerScene {
  const current = state.current;
  const staged = state.staged;
  if (
    !current ||
    !state.currentSignature ||
    camera.baseGeneration !== current.generation ||
    camera.sceneId !== current.sceneId ||
    camera.sourceEpoch !== current.sourceEpoch ||
    camera.authoredEpoch !== current.authoredEpoch ||
    camera.pixelRatio !== current.pixelRatio ||
    (staged !== null && !compatibleCameraContent(current, staged))
  )
    throw new NativeWorkerSceneError(
      "worker-camera-base-stale",
      "The camera update no longer matches the committed native scene.",
    );
  if (
    !Number.isSafeInteger(camera.generation) ||
    camera.generation <=
      Math.max(current.generation, staged?.generation ?? 0) ||
    !nativeWorkerTextureSizeValid(camera.width, camera.height) ||
    !camera.viewport ||
    !camera.clock ||
    typeof camera.clock.playing !== "boolean" ||
    !nativeWorkerClockSampleValid(
      camera.clock,
      performance.timeOrigin + performance.now(),
    ) ||
    ![
      camera.viewport.x,
      camera.viewport.y,
      camera.viewport.width,
      camera.viewport.height,
      camera.clock.timeSeconds,
      camera.clock.speed,
    ].every(Number.isFinite) ||
    camera.viewport.width <= 0 ||
    camera.viewport.height <= 0 ||
    camera.width !== Math.ceil(camera.viewport.width * camera.pixelRatio) ||
    camera.height !== Math.ceil(camera.viewport.height * camera.pixelRatio)
  )
    throw new NativeWorkerSceneError(
      "scene-geometry-invalid",
      "The camera update has invalid full-resolution geometry.",
    );
  return {
    ...current,
    generation: camera.generation,
    viewport: camera.viewport,
    width: camera.width,
    height: camera.height,
    clock: camera.clock,
  };
}

function clockTime(
  scene: NativeWorkerScene,
  anchorMs: number,
  nowMs: number,
): number {
  const elapsedMs =
    scene.clock.sampledAtEpochMs === undefined
      ? Math.max(0, nowMs - anchorMs)
      : Math.max(
          0,
          performance.timeOrigin + nowMs - scene.clock.sampledAtEpochMs,
        );
  return (
    scene.clock.timeSeconds +
    (scene.clock.playing ? (elapsedMs * scene.clock.speed) / 1000 : 0)
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
        ...Object.entries(target.inputAssetIds ?? {}).map(
          ([resource, assetId]) => [resource, this.asset(assetId)] as const,
        ),
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

type FlightItem = DueScene & {
  lease: NativeWorkerGpuFlightLease;
  final: GPUTexture;
  renderer: NativeWorkerRenderer;
  timeSeconds: number;
  stagedAtStart: NativeWorkerScene | null;
  currentAtStart: NativeWorkerScene | null;
  anchorAtStart: number;
  signatureAtStart: string | null;
};

type BatchFlight = {
  items: FlightItem[];
  due: readonly DueScene[];
  now: number;
  fence: Promise<FlightFenceResult> | null;
  presentation: Promise<void> | null;
  presentationSubmittedAtMs: number | null;
};

type FlightFenceResult =
  | { status: "completed" }
  | { status: "failed"; error: unknown };

export class NativeWorkerRuntime {
  private readonly scenes = new Map<string, SceneState>();
  private readonly animationCadence = new Map<
    60 | 120 | "compact",
    NativePreviewPolicyController
  >();
  private timer: number | null = null;
  private pumpBusy = false;
  private stagedCursor = 0;
  private device: GPUDevice | null = null;
  private creatingDevice: Promise<GPUDevice> | null = null;
  private gpuTail: Promise<void> = Promise.resolve();
  private readonly flights: BatchFlight[] = [];
  private readonly flightWaiters: Array<() => void> = [];
  private recordingFlights = 0;
  private settlingFlight = false;
  private flightRecovery = false;
  private pendingFlightFailure: unknown | null = null;
  private secondFlightUnavailable = false;
  private pendingExclusiveOperations = 0;
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

  private waitForFlights(): Promise<void> {
    if (!this.flights.length && !this.flightRecovery && !this.recordingFlights)
      return Promise.resolve();
    return new Promise((resolve) => this.flightWaiters.push(resolve));
  }

  private async withExclusiveGpu<T>(task: () => Promise<T>): Promise<T> {
    this.pendingExclusiveOperations++;
    try {
      await this.waitForFlights();
      return await this.serializeGpu(task);
    } finally {
      this.pendingExclusiveOperations--;
      this.schedule();
    }
  }

  private finishFlightWaiters(): void {
    if (this.flights.length || this.flightRecovery || this.recordingFlights)
      return;
    this.secondFlightUnavailable = false;
    for (const resolve of this.flightWaiters.splice(0)) resolve();
  }

  private sceneHasFlight(state: SceneState): boolean {
    return this.flights.some((flight) =>
      flight.items.some((item) => item.state === state),
    );
  }

  private flightItemCurrent(item: FlightItem): boolean {
    const { state, scene } = item;
    const compatibleNewerCamera =
      state.staged !== null &&
      state.currentSignature !== null &&
      state.stagedSignature === state.currentSignature &&
      compatibleCameraContent(scene, state.staged);
    const predecessorAdopted =
      item.staged &&
      state.current === scene &&
      state.currentSignature === item.signatureAtStart &&
      (state.staged === null || compatibleNewerCamera);
    const compatibleCameraArrived =
      !item.staged && item.stagedAtStart === null && compatibleNewerCamera;
    return (
      !state.disposed &&
      (predecessorAdopted ||
        (state.current === item.currentAtStart &&
          (state.staged === item.stagedAtStart || compatibleCameraArrived) &&
          (item.staged ? state.staged === scene : state.current === scene)))
    );
  }

  private async settleFlights(): Promise<void> {
    if (this.settlingFlight) return;
    this.settlingFlight = true;
    try {
      while (this.flights.length) {
        const flight = this.flights[0]!;
        try {
          if (this.pendingFlightFailure !== null) {
            const failure = this.pendingFlightFailure;
            this.pendingFlightFailure = null;
            await this.recoverFlights(failure);
            return;
          }
          if (!flight.fence)
            await this.serializeGpu(() => this.presentFlight(flight));
          const pendingFence = flight.fence;
          if (!pendingFence)
            throw new NativeWorkerSceneError(
              "gpu-flight-fence-missing",
              "The shared GPU flight has no completion fence.",
            );
          const fence = await pendingFence;
          if (fence.status === "failed") throw fence.error;
          let superseded = false;
          await this.serializeGpu(async () => {
            superseded = flight.items.some(
              (item) => !this.flightItemCurrent(item),
            );
            if (superseded) return;
            for (const item of flight.items)
              item.state.gpu.validatePublication(item.lease, item.final);
            for (const item of flight.items) {
              const { state, scene, lease } = item;
              state.gpu.publish(lease, item.final, scene);
              const staged = item.staged && state.staged === scene;
              if (staged) state.anchorMs = item.anchorAtStart;
              this.completeFrame(
                item.sceneId,
                state,
                scene,
                staged,
                flight.now,
                lease.bank,
                item.renderer,
                item.timeSeconds,
                lease,
                flight.presentationSubmittedAtMs,
              );
            }
          });
          if (superseded) {
            await this.recoverFlights(null);
            return;
          }
          this.flights.shift();
          for (const item of flight.items) {
            item.state.gpu.releaseFlight(item.lease);
            item.state.busy = this.sceneHasFlight(item.state);
          }
          this.secondFlightUnavailable = false;
          this.schedule();
        } catch (error) {
          try {
            await this.recoverFlights(error);
          } catch (recoveryError) {
            const first = flight.items[0];
            if (first)
              this.error(
                first.sceneId,
                recoveryError,
                undefined,
                first.scene.generation,
              );
          }
          return;
        }
      }
    } finally {
      this.settlingFlight = false;
      this.finishFlightWaiters();
      for (const [sceneId, state] of this.scenes)
        if (state.disposed && !state.busy)
          void this.serializeGpu(async () =>
            this.disposeScene(sceneId, state),
          ).catch((error) => this.error(sceneId, error));
      this.schedule();
    }
  }

  private async recoverFlights(error: unknown): Promise<void> {
    this.flightRecovery = true;
    const failed = this.flights.splice(0);
    try {
      await this.serializeGpu(async () => {
        const device = failed[0]?.items[0]?.state.gpu.device;
        let drainFailure: unknown = null;
        try {
          if (device) await device.queue.onSubmittedWorkDone();
        } catch (failure) {
          drainFailure = failure;
        }
        let releaseFailure: unknown = null;
        for (const flight of failed)
          for (const item of flight.items)
            try {
              item.state.gpu.releaseFlight(item.lease);
            } catch (failure) {
              releaseFailure ??= failure;
            }
        if (drainFailure || releaseFailure)
          throw new NativeWorkerSceneError(
            "gpu-flight-drain-failed",
            `The shared GPU flight could not drain safely: ${String(drainFailure ?? releaseFailure)}`,
          );
        let restorationFailure: unknown = null;
        const affected = new Map<SceneState, FlightItem>();
        for (const flight of failed)
          for (const item of flight.items) affected.set(item.state, item);
        for (const item of affected.values()) {
          const current = item.state.current;
          if (item.state.disposed || !current) continue;
          const front = item.state.gpu.frontTexture();
          if (front) {
            try {
              const bank = item.state.gpu.spareBank(
                current,
                item.state.currentSignature,
              );
              try {
                await this.present(item.state.gpu, bank, current, front, null);
              } finally {
                item.state.gpu.endLegacyFlight();
              }
            } catch (restoreError) {
              restorationFailure ??= restoreError;
            }
          }
        }
        if (restorationFailure)
          throw new NativeWorkerSceneError(
            "presentation-restore-failed",
            `A validated shared frame could not be restored: ${String(restorationFailure)}`,
          );
      });
      if (error !== null) {
        const dueByState = new Map<SceneState, DueScene>();
        for (const flight of failed)
          for (const item of flight.due) dueByState.set(item.state, item);
        const due = [...dueByState.values()];
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
              this.frame(
                item.sceneId,
                item.state,
                item.scene,
                performance.now(),
              ),
            );
          } catch (sceneError) {
            isolated = true;
            if (item.staged && item.state.staged === item.scene) {
              item.state.staged = null;
              item.state.stagedSignature = null;
            } else if (!item.staged)
              item.state.failedGeneration = item.scene.generation;
            this.error(
              item.sceneId,
              sceneError,
              undefined,
              item.scene.generation,
            );
          }
        }
        if (!isolated && due[0])
          this.error(
            due[0].sceneId,
            new NativeWorkerSceneError(
              "gpu-batch-validation",
              `The shared GPU batch failed validation before individual scenes recovered: ${String(error)}`,
            ),
            undefined,
            due[0].scene.generation,
          );
      }
    } finally {
      for (const flight of failed)
        for (const item of flight.items) item.state.busy = false;
      this.flightRecovery = false;
      this.secondFlightUnavailable = false;
      this.finishFlightWaiters();
    }
  }

  private cadenceForRate(
    rate: 60 | 120,
    compact = false,
  ): NativePreviewPolicyController {
    const key = compact ? "compact" : rate;
    let cadence = this.animationCadence.get(key);
    if (!cadence) {
      cadence = new NativePreviewPolicyController();
      cadence.setPolicy({ quality: "quality", frameRateTarget: rate });
      cadence.setOverviewCompact(compact);
      this.animationCadence.set(key, cadence);
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
        void this.withExclusiveGpu(async () => {
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
      const task = this.withExclusiveGpu(async () => {
        state.gpu.device.pushErrorScope("validation");
        let scopeOpen = true;
        try {
          state.gpu.retireIdleWorkForAssetUpload(message);
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
        void this.withExclusiveGpu(async () =>
          this.disposeScene(sceneId, state),
        ).catch((error) => this.error(sceneId, error));
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
    if (message.type === "camera") {
      try {
        const scene = checkedCamera(message, state);
        state.staged = scene;
        state.stagedSignature = state.currentSignature;
        state.stagedAnchorMs = performance.now();
        state.failedGeneration = null;
        this.post({
          type: "scene-staged",
          sceneId,
          generation: scene.generation,
          sourceEpoch: scene.sourceEpoch,
        });
        this.schedule();
      } catch (error) {
        this.error(sceneId, error, undefined, message.generation);
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
            ((state.staged &&
              (!this.sceneHasFlight(state) || state.staged.clock.playing)) ||
              (state.current?.clock.playing &&
                state.failedGeneration !== state.current.generation))))
      )
        return true;
    return false;
  }

  private schedule(): void {
    if (
      this.timer !== null ||
      this.pumpBusy ||
      this.flightRecovery ||
      this.pendingExclusiveOperations > 0 ||
      this.recordingFlights > 0 ||
      this.flightWaiters.length > 0 ||
      this.flights.length === 2 ||
      (this.flights.length > 0 && this.secondFlightUnavailable) ||
      !this.hasScheduledWork()
    )
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
      const needsExclusive =
        this.pendingExclusiveOperations > 0 ||
        [...this.scenes.values()].some(
          (state) =>
            !state.disposed &&
            (state.exports.length > 0 ||
              (state.visible &&
                state.staged !== null &&
                (state.current === null ||
                  state.stagedSignature !== state.currentSignature))),
        );
      if (this.flights.length && needsExclusive) return;
      const due: DueScene[] = [];
      const dueRates = new Map<60 | 120 | "compact", boolean>();
      for (const [sceneId, state] of this.scenes) {
        const staged =
          state.staged !== null &&
          state.current !== null &&
          state.stagedSignature !== null &&
          state.stagedSignature === state.currentSignature;
        const scene = staged ? state.staged : state.current;
        if (!scene || !state.visible || state.disposed) continue;
        if (
          staged &&
          this.sceneHasFlight(state) &&
          (!scene.clock.playing ||
            !this.flights.some((flight) =>
              flight.items.some(
                (item) =>
                  item.state === state &&
                  ((item.staged && item.scene === scene) ||
                    (item.scene === state.current &&
                      compatibleCameraContent(item.scene, scene))),
              ),
            ))
        )
          continue;
        if (!staged && !scene.clock.playing) continue;
        if (state.failedGeneration === scene.generation) continue;
        const rate = scene.frameRateTarget ?? 60;
        const compact = scene.compact === true;
        state.cadence.setPolicy({ quality: "quality", frameRateTarget: rate });
        state.cadence.setOverviewCompact(compact);
        const key = compact ? "compact" : rate;
        if (!dueRates.has(key))
          dueRates.set(
            key,
            this.cadenceForRate(rate, compact).isSubmissionDue(now, false, 2),
          );
        if (dueRates.get(key)) due.push({ sceneId, state, scene, staged });
      }
      if (due.length && !needsExclusive) {
        for (const item of due) item.state.busy = true;
        try {
          this.recordingFlights++;
          let flight: BatchFlight | null;
          try {
            flight = await this.serializeGpu(() => this.recordFlight(due, now));
            if (flight) this.flights.push(flight);
          } finally {
            this.recordingFlights--;
            this.finishFlightWaiters();
          }
          if (flight) {
            await this.serializeGpu(() => this.presentFlight(flight));
            const committedCadences = new Set<NativePreviewPolicyController>();
            for (const item of flight.items) {
              const cadence = this.cadenceForRate(
                item.scene.frameRateTarget ?? 60,
                item.scene.compact === true,
              );
              if (committedCadences.has(cadence)) continue;
              committedCadences.add(cadence);
              cadence.commitSubmission(now, false);
            }
            void this.settleFlights();
          } else if (this.flights.length) {
            this.secondFlightUnavailable = true;
          }
        } catch (error) {
          if (this.flights.length) {
            this.pendingFlightFailure = error;
            void this.settleFlights();
          } else {
            for (const item of due) {
              if (item.state.disposed) continue;
              try {
                await this.serializeGpu(() =>
                  this.frame(item.sceneId, item.state, item.scene, now),
                );
              } catch (sceneError) {
                if (item.staged && item.state.staged === item.scene) {
                  item.state.staged = null;
                  item.state.stagedSignature = null;
                } else if (!item.staged)
                  item.state.failedGeneration = item.scene.generation;
                this.error(
                  item.sceneId,
                  sceneError,
                  undefined,
                  item.scene.generation,
                );
              }
            }
          }
        } finally {
          for (const item of due)
            if (!this.sceneHasFlight(item.state)) item.state.busy = false;
        }
      }

      if (this.flights.length) return;

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
        state.cadence.setOverviewCompact(scene.compact === true);
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

  private async recordFlight(
    due: readonly DueScene[],
    now: number,
  ): Promise<BatchFlight | null> {
    const device = due[0]?.state.gpu.device;
    if (!device) return null;
    if (due.some((item) => item.state.gpu.device !== device))
      throw new NativeWorkerSceneError(
        "gpu-shared-device-mismatch",
        "The worker batch contains scenes from different GPU devices.",
      );
    const acquired: Array<DueScene & { lease: NativeWorkerGpuFlightLease }> =
      [];
    let acquisitionComplete = false;
    try {
      for (const item of due) {
        if (
          item.state.disposed ||
          (item.staged
            ? item.state.staged !== item.scene
            : item.state.current !== item.scene)
        )
          continue;
        const result = item.state.gpu.tryAcquireFlight(
          item.scene,
          item.staged
            ? item.state.stagedSignature
            : item.state.currentSignature,
        );
        if (result.status === "capacity") {
          if (this.flights.length) return null;
          throw new NativeWorkerSceneError(
            "gpu-flight-capacity",
            `The first GPU flight could not acquire a candidate: ${result.reason}`,
          );
        }
        acquired.push({ ...item, lease: result.lease });
      }
      acquisitionComplete = true;
    } finally {
      if (!acquisitionComplete)
        for (const held of acquired) held.state.gpu.releaseFlight(held.lease);
    }
    if (!acquired.length) return null;

    const rendered: FlightItem[] = [];
    const buffers: GPUCommandBuffer[] = [];
    let scopeOpen = false;
    let submitted = false;
    let failed = false;
    try {
      device.pushErrorScope("validation");
      scopeOpen = true;
      for (const item of acquired) {
        const { state, scene, lease } = item;
        const stagedAtStart = state.staged;
        const currentAtStart = state.current;
        const anchorAtStart = item.staged
          ? state.stagedAnchorMs
          : state.anchorMs;
        const signatureAtStart = item.staged
          ? state.stagedSignature
          : state.currentSignature;
        state.gpu.beginFrame(lease);
        const encoder = device.createCommandEncoder();
        const timeSeconds = clockTime(scene, anchorAtStart, now);
        const renderer = new NativeWorkerRenderer(
          scene,
          timeSeconds,
          state.gpu,
          lease.bank,
          encoder,
        );
        const composed = await renderer.render(scene.records);
        const final = state.gpu.stageFinal(lease, scene, composed, encoder);
        state.gpu.uploadFrame(lease);
        buffers.push(encoder.finish());
        rendered.push({
          ...item,
          final,
          renderer,
          timeSeconds,
          stagedAtStart,
          currentAtStart,
          anchorAtStart,
          signatureAtStart,
        });
      }
      device.queue.submit(buffers);
      submitted = true;
      for (const item of acquired)
        item.state.gpu.markFlightSubmitted(item.lease);
      const validationPromise = device.popErrorScope();
      scopeOpen = false;
      const validation = await validationPromise;
      if (validation)
        throw new NativeWorkerSceneError("gpu-validation", validation.message);
      return {
        items: rendered,
        due,
        now,
        fence: null,
        presentation: null,
        presentationSubmittedAtMs: null,
      };
    } catch (error) {
      failed = true;
      if (scopeOpen) await device.popErrorScope();
      if (submitted) await device.queue.onSubmittedWorkDone();
      if (
        !submitted &&
        this.flights.length &&
        error instanceof NativeWorkerGpuFlightCapacityError
      )
        return null;
      throw error;
    } finally {
      for (const item of acquired) item.state.gpu.finishFrame(item.lease);
      if (failed)
        for (const item of acquired) item.state.gpu.releaseFlight(item.lease);
    }
  }

  private presentFlight(flight: BatchFlight): Promise<void> {
    return (flight.presentation ??= this.submitPresentation(flight));
  }

  private async submitPresentation(flight: BatchFlight): Promise<void> {
    const device = flight.items[0]?.state.gpu.device;
    if (!device) return;
    if (flight.items.some((item) => !this.flightItemCurrent(item))) {
      flight.fence = device.queue.onSubmittedWorkDone().then(
        (): FlightFenceResult => ({ status: "completed" }),
        (error): FlightFenceResult => ({ status: "failed", error }),
      );
      return;
    }
    const buffers: GPUCommandBuffer[] = [];
    let scopeOpen = false;
    let submitted = false;
    try {
      device.pushErrorScope("validation");
      scopeOpen = true;
      for (const item of flight.items) {
        const gpu = item.state.gpu;
        gpu.preparePresentation(item.scene);
        gpu.beginFrame(item.lease);
        const encoder = device.createCommandEncoder();
        const pipeline = await gpu.pipeline(
          presentWgsl(item.scene.colorSpace),
          gpu.canvasFormat,
          false,
          2,
        );
        const bind = gpu.bind(
          item.lease.bank,
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
        gpu.uploadFrame(item.lease);
        buffers.push(encoder.finish());
      }
      if (flight.items.every((item) => this.flightItemCurrent(item))) {
        device.queue.submit(buffers);
        submitted = true;
        flight.presentationSubmittedAtMs = performance.now();
      }
      const validationPromise = device.popErrorScope();
      scopeOpen = false;
      const completionPromise = device.queue.onSubmittedWorkDone();
      flight.fence = Promise.allSettled([
        validationPromise,
        completionPromise,
      ]).then(([validation, completion]): FlightFenceResult => {
        const failures: unknown[] = [];
        if (validation.status === "rejected") failures.push(validation.reason);
        else if (validation.value)
          failures.push(
            new NativeWorkerSceneError(
              "gpu-validation",
              validation.value.message,
            ),
          );
        if (completion.status === "rejected") failures.push(completion.reason);
        return failures.length
          ? {
              status: "failed",
              error:
                failures.length === 1
                  ? failures[0]
                  : Object.assign(
                      new NativeWorkerSceneError(
                        "gpu-presentation-failed",
                        `GPU presentation validation and completion both failed: ${failures.map(String).join("; ")}`,
                      ),
                      { errors: failures },
                    ),
            }
          : { status: "completed" };
      });
    } catch (error) {
      if (scopeOpen) await device.popErrorScope();
      if (submitted) await device.queue.onSubmittedWorkDone();
      throw error;
    } finally {
      for (const item of flight.items) item.state.gpu.finishFrame(item.lease);
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
    lease?: NativeWorkerGpuFlightLease,
    presentationSubmittedAtMs?: number | null,
  ): void {
    if (lease) state.gpu.trimWork(lease);
    else state.gpu.trimWork(bank);
    const cadenceKey = scene.compact
      ? "compact"
      : (scene.frameRateTarget ?? 60);
    if (staged && scene.clock.playing && !this.animationCadence.has(cadenceKey))
      this.cadenceForRate(
        scene.frameRateTarget ?? 60,
        scene.compact === true,
      ).commitSubmission(now, false);
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
        ...this.flights.flatMap((flight) =>
          flight.items
            .filter((item) => item.state === state)
            .flatMap((item) => item.scene.requiredAssets),
        ),
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
      ...(presentationSubmittedAtMs !== null &&
      presentationSubmittedAtMs !== undefined
        ? { presentationSubmittedAtMs }
        : {}),
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
      gpu.endLegacyFlight();
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
        gpu.uploadFrame();
        gpu.device.queue.submit([encoder.finish()]);
        submitted = true;
        const compositionValidation = await gpu.device.popErrorScope();
        scopeOpen = false;
        if (compositionValidation)
          throw new NativeWorkerSceneError(
            "gpu-validation",
            compositionValidation.message,
          );
        await gpu.device.queue.onSubmittedWorkDone();
        gpu.finishFrame();
        frameOpen = false;
        gpu.trimWorkExcept(bank, composed);

        gpu.beginFrame();
        frameOpen = true;
        gpu.device.pushErrorScope("validation");
        scopeOpen = true;
        const outputEncoder = gpu.device.createCommandEncoder();
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
        draw(outputEncoder, output, pipeline, bind);
        const bytesPerRow = Math.ceil((planned.width * 4) / 256) * 256;
        readbackBytes = bytesPerRow * planned.height;
        gpu.reserveTransient(readbackBytes, "export:readback");
        readbackReserved = true;
        readback = gpu.device.createBuffer({
          size: readbackBytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        outputEncoder.copyTextureToBuffer(
          { texture: output },
          { buffer: readback, bytesPerRow },
          [planned.width, planned.height],
        );
        gpu.uploadFrame();
        gpu.device.queue.submit([outputEncoder.finish()]);
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
      if (bank) {
        const finishedBank = bank;
        cleanup(() => gpu.trimWorkExcept(finishedBank, null));
      }
      cleanup(() => gpu.endLegacyFlight());
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
