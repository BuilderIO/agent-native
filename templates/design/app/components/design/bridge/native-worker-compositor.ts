import {
  planNativeSourceComposition,
  type NativeSourcePaintGroup,
  type NativeSourcePaintNode,
} from "../../../../shared/native-source-composition-tree";
import { planNativePhysicalRootBox } from "./native-capture-roi";
import type { NativeEffectExtentPlan } from "./native-effect-extent";
import {
  planNativeGroupLocalBackdropWindow,
  type NativeGroupLocalBackdropWindowPlan,
} from "./native-group-local-backdrop-window";
import {
  planNativeSourceAffine,
  type NativeAffine2D,
  type NativeAffineBox,
} from "./native-source-affine-geometry";
import { planNativeSourceCoordinateScale } from "./native-source-coordinate-scale";
import type { NativeSourceClip } from "./native-source-provider";
import { planNativeImageSampling } from "./native-source-sampling";
import {
  backdropReplaceWgsl,
  compositeWgsl,
  cssSceneDecodeWgsl,
} from "./native-worker-gpu-wgsl";
import type {
  NativeWorkerScene,
  NativeWorkerSourceRecord,
} from "./native-worker-protocol";

const MAX_SOURCE_CLIPS = 8;
const IDENTITY: NativeAffine2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

type Box = { x: number; y: number; width: number; height: number };
export type NativeWorkerBlendMode = "linear" | "srgb-css" | "srgb-css-linear";

export class NativeWorkerCompositionError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "NativeWorkerCompositionError";
  }
}

export interface NativeWorkerCompositionSurface {
  width: number;
  height: number;
  pixelRatio: number;
  viewport?: Box;
  outputExtent?: NativeEffectExtentPlan | null;
  targetLocalSize?: { width: number; height: number };
  targetViewportSize?: { width: number; height: number };
}

export interface NativeWorkerNestedBackdrop {
  output: { width: number; height: number };
  extent: NativeEffectExtentPlan | null;
}

export interface NativeWorkerResolvedRecord {
  texture?: GPUTexture;
  opacity?: number;
  premultiplied?: boolean;
  encodedScene?: boolean;
  backdropReplacement?: boolean;
  receiverCoverage?: GPUTexture;
  nestedBackdrop?: NativeWorkerNestedBackdrop;
}

export interface NativeWorkerResolveContext {
  encoder: GPUCommandEncoder;
  currentScene: GPUTexture | null;
  incoming: Box | null;
  encodedScene: boolean;
  window?: NativeGroupLocalBackdropWindowPlan;
}

export interface NativeWorkerCompositionGpu {
  pipeline(
    wgsl: string,
    format: GPUTextureFormat,
    blend: boolean,
    textureCount: number,
  ): Promise<GPURenderPipeline>;
  bind(
    key: string,
    pipeline: GPURenderPipeline,
    source: GPUTexture,
    mask: GPUTexture | null,
    data: Float32Array,
    sampler?: GPUSampler,
    extraTextures?: readonly GPUTexture[],
  ): GPUBindGroup;
  sampler(filter: "nearest" | "linear"): GPUSampler;
}

export interface NativeWorkerCompositionBank {
  texture(key: string, width: number, height: number): GPUTexture;
}

export interface NativeWorkerCompositionInput {
  scene: NativeWorkerScene;
  records: readonly NativeWorkerSourceRecord[];
  surface?: NativeWorkerCompositionSurface;
  outputName?: string;
  blendMode?: NativeWorkerBlendMode;
  format: GPUTextureFormat;
  encoder: GPUCommandEncoder;
  bank: NativeWorkerCompositionBank;
  gpu: NativeWorkerCompositionGpu;
  resolveRecord(
    record: NativeWorkerSourceRecord,
    context: NativeWorkerResolveContext,
  ): Promise<NativeWorkerResolvedRecord>;
}

type DrawItem = {
  id: string;
  record?: NativeWorkerSourceRecord;
  texture?: GPUTexture;
  rect: Box;
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  clip: Box;
  clips: readonly NativeSourceClip[];
  opacity: number;
  premultiplied: boolean;
  encodedScene: boolean;
  backdropReplacement: boolean;
  receiverCoverage?: GPUTexture;
  nestedBackdrop?: NativeWorkerNestedBackdrop;
  groupResolve?: boolean;
  uv?: Box;
  imageSampling?: {
    imageRendering: NativeWorkerSourceRecord["imageRendering"];
    sourceSize: { width: number; height: number };
  };
};
type DeferredGroup = {
  kind: "deferred-group";
  node: NativeSourcePaintGroup;
  children: Paint[];
};
type Paint = DrawItem | DeferredGroup;
type PlaneScope = { primary: GPUTexture; companion?: GPUTexture; key: string };

function failure(code: string, message = code): never {
  throw new NativeWorkerCompositionError(code, message);
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function validateTexture(
  texture: GPUTexture | undefined,
  id: string,
): GPUTexture {
  if (!texture)
    failure(
      "native-dependency-missing",
      `Source ${id} has no rendered GPU texture.`,
    );
  return texture;
}

export function packNativeWorkerCompositeDraw(input: {
  item: Pick<
    DrawItem,
    | "id"
    | "rect"
    | "localBox"
    | "localToTarget"
    | "clips"
    | "opacity"
    | "premultiplied"
    | "encodedScene"
    | "groupResolve"
    | "uv"
  >;
  physicalScale: { x: number; y: number };
  origin: { x: number; y: number };
  viewport: { width: number; height: number };
  pixelated?: { x: number; y: number };
  blendMode: NativeWorkerBlendMode;
}): Float32Array {
  const { item, physicalScale, origin, viewport, blendMode } = input;
  if (item.clips.length > MAX_SOURCE_CLIPS)
    failure(
      "source-clip-depth-unsupported",
      `A source requires more than ${MAX_SOURCE_CLIPS} nested clips.`,
    );
  const affine = planNativeSourceAffine({
    localBox: item.localBox,
    localToTarget: item.localToTarget,
    physicalScale,
  });
  if (!affine.ok)
    failure(
      `source-affine-${affine.reason}`,
      `Source ${item.id} has unsupported affine geometry: ${affine.reason}.`,
    );
  const data = new Float32Array(36 + MAX_SOURCE_CLIPS * 20);
  data.set([
    item.rect.x * physicalScale.x,
    item.rect.y * physicalScale.y,
    item.rect.width * physicalScale.x,
    item.rect.height * physicalScale.y,
    viewport.width,
    viewport.height,
    input.pixelated?.x ?? 0,
    input.pixelated?.y ?? 0,
    item.opacity,
    item.premultiplied ? 1 : 0,
    item.groupResolve ? 0 : blendMode !== "linear" ? 1 : 0,
    item.groupResolve ? 1 : item.encodedScene ? 1 : 0,
    item.uv?.x ?? 0,
    item.uv?.y ?? 0,
    item.uv?.width ?? 1,
    item.uv?.height ?? 1,
    item.clips.length,
    0,
    0,
    0,
    origin.x,
    origin.y,
    0,
    0,
    item.localBox.x,
    item.localBox.y,
    item.localBox.width,
    item.localBox.height,
    affine.physicalToLocal.a,
    affine.physicalToLocal.c,
    affine.physicalToLocal.e,
    0,
    affine.physicalToLocal.b,
    affine.physicalToLocal.d,
    affine.physicalToLocal.f,
    0,
  ]);
  for (let index = 0; index < item.clips.length; index += 1) {
    const clip = item.clips[index];
    const clipAffine = planNativeSourceAffine({
      localBox: clip.localBox,
      localToTarget: clip.localToTarget,
      physicalScale,
    });
    if (!clipAffine.ok)
      failure(
        `source-affine-${clipAffine.reason}`,
        `Source clip ${index} has unsupported affine geometry: ${clipAffine.reason}.`,
      );
    data.set(
      [
        clip.localBox.x,
        clip.localBox.y,
        clip.localBox.width,
        clip.localBox.height,
        clip.radii.topLeft.x,
        clip.radii.topLeft.y,
        clip.radii.topRight.x,
        clip.radii.topRight.y,
        clip.radii.bottomRight.x,
        clip.radii.bottomRight.y,
        clip.radii.bottomLeft.x,
        clip.radii.bottomLeft.y,
        clipAffine.physicalToLocal.a,
        clipAffine.physicalToLocal.c,
        clipAffine.physicalToLocal.e,
        0,
        clipAffine.physicalToLocal.b,
        clipAffine.physicalToLocal.d,
        clipAffine.physicalToLocal.f,
        0,
      ],
      36 + index * 20,
    );
  }
  return data;
}

export async function composeNativeWorkerScene(
  input: NativeWorkerCompositionInput,
): Promise<GPUTexture> {
  const { scene, records, encoder, bank, gpu, format, resolveRecord } = input;
  const surface = input.surface ?? {
    width: scene.width,
    height: scene.height,
    pixelRatio: scene.pixelRatio,
    viewport: scene.viewport,
  };
  const outputName = input.outputName ?? "source";
  const blendMode = input.blendMode ?? "linear";
  const extent = surface.outputExtent;
  const physicalRoot = planNativePhysicalRootBox({
    width: surface.width,
    height: surface.height,
    left: extent?.left ?? 0,
    top: extent?.top ?? 0,
    origin: surface.viewport
      ? {
          x: Math.round(surface.viewport.x * surface.pixelRatio),
          y: Math.round(surface.viewport.y * surface.pixelRatio),
        }
      : undefined,
  });
  if (!physicalRoot.ok) failure("source-capture-geometry-invalid");
  const rootBox = physicalRoot.box;
  const globalLocal = records.some(
    (record) => record.coordinateSpace === "target-local-global",
  );
  const local = surface.targetLocalSize ?? {
    width: surface.width / surface.pixelRatio,
    height: surface.height / surface.pixelRatio,
  };
  const viewportSize = surface.targetViewportSize ?? surface.viewport ?? local;
  const sourceScale =
    surface.viewport && surface.pixelRatio
      ? { ok: true as const, x: surface.pixelRatio, y: surface.pixelRatio }
      : planNativeSourceCoordinateScale({
          spaces: records.map((record) => record.coordinateSpace),
          sourceWidth: globalLocal
            ? local.width * surface.pixelRatio
            : (extent?.sourceWidth ?? surface.width),
          sourceHeight: globalLocal
            ? local.height * surface.pixelRatio
            : (extent?.sourceHeight ?? surface.height),
          localWidth:
            !extent && surface.pixelRatio
              ? surface.width / surface.pixelRatio
              : local.width,
          localHeight:
            !extent && surface.pixelRatio
              ? surface.height / surface.pixelRatio
              : local.height,
          viewportWidth: viewportSize.width,
          viewportHeight: viewportSize.height,
        });
  if (!sourceScale.ok) failure(sourceScale.code);
  const scaleX = sourceScale.x;
  const scaleY = sourceScale.y;
  const source = bank.texture(outputName, surface.width, surface.height);
  let compositionTarget =
    blendMode === "srgb-css-linear"
      ? bank.texture(
          `css-intermediate:${outputName}`,
          surface.width,
          surface.height,
        )
      : source;
  const rootPlanes: PlaneScope = {
    primary: compositionTarget,
    companion: blendMode === "srgb-css-linear" ? source : undefined,
    key: outputName,
  };
  const replacementTarget = (
    planes: PlaneScope,
    current: GPUTexture,
    width: number,
    height: number,
  ): GPUTexture => {
    if (
      (current !== planes.primary && current !== planes.companion) ||
      planes.primary.width !== width ||
      planes.primary.height !== height
    )
      failure("source-composition-plane-unavailable");
    if (!planes.companion)
      planes.companion = bank.texture(
        `backdrop-replacement:${planes.key}`,
        width,
        height,
      );
    const next = current === planes.primary ? planes.companion : planes.primary;
    if (next === current || next.width !== width || next.height !== height)
      failure("source-composition-plane-unavailable");
    return next;
  };
  const compositePipeline = await gpu.pipeline(compositeWgsl, format, true, 1);
  const groupClips = new Map<string, NativeSourceClip>();
  for (const record of records)
    for (const group of record.groupClips) {
      const previous = groupClips.get(group.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(group.clip))
        failure(
          "source-clip-inconsistent",
          `Source clip ${group.id} changed within one composition frame.`,
        );
      groupClips.set(group.id, group.clip);
    }
  const leaves = new Map(
    records.map((record) => [`leaf:${record.key}`, record]),
  );
  const planned = planNativeSourceComposition(
    records.map((record) => ({
      id: `leaf:${record.key}`,
      box: record.rect,
      opacity: record.opacity,
      ownOpacityBaked: !!record.nativeInstanceId,
      isolationPath: record.isolationPath,
    })),
  );
  if (!planned.ok) failure(`source-${planned.reason}`, planned.detail);
  const resolved = new Map<string, NativeWorkerResolvedRecord>();
  for (const record of records) {
    if (
      surface.viewport &&
      (!intersects(surface.viewport, record.rect) ||
        !intersects(surface.viewport, record.clip))
    )
      continue;
    const value = await resolveRecord(record, {
      encoder,
      currentScene: null,
      incoming: null,
      encodedScene: blendMode !== "linear",
    });
    if (!value.texture && !value.backdropReplacement)
      failure(
        "native-dependency-missing",
        `Source ${record.key} has no texture.`,
      );
    if (record.sourceRole === "ancestor-fill-prefix" && !value.texture)
      failure(
        "native-dependency-missing",
        "The staged ancestor Fill prefix is unavailable.",
      );
    if (
      record.nativeInstanceId &&
      value.texture &&
      record.imageRendering &&
      (record.width !== value.texture.width ||
        record.height !== value.texture.height)
    )
      failure("source-image-rendering-geometry");
    resolved.set(`leaf:${record.key}`, value);
  }
  const hasBackdropReplacement = (node: NativeSourcePaintNode): boolean =>
    node.kind === "group"
      ? node.children.some(hasBackdropReplacement)
      : !!resolved.get(node.id)?.backdropReplacement;
  const drawItems = async (
    items: Paint[],
    destination: GPUTexture,
    originX: number,
    originY: number,
    width: number,
    height: number,
    scratchKey: string,
    initiallyDrawn = false,
    planes: PlaneScope = { primary: destination, key: scratchKey },
  ): Promise<GPUTexture> => {
    let current = destination;
    let drawn = initiallyDrawn;
    let commands: {
      bind: GPUBindGroup;
      x: number;
      y: number;
      w: number;
      h: number;
    }[] = [];
    const flush = (): void => {
      if (!commands.length && drawn) return;
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: current.createView(),
            loadOp: drawn ? "load" : "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      for (const command of commands) {
        pass.setPipeline(compositePipeline);
        pass.setBindGroup(0, command.bind);
        pass.setScissorRect(command.x, command.y, command.w, command.h);
        pass.draw(6);
      }
      pass.end();
      commands = [];
      drawn = true;
    };
    for (const item of items) {
      if ("kind" in item) {
        flush();
        const groupKey = `${scratchKey}:deferred:${item.node.isolationKind}:${item.node.id}`;
        const clipShape = item.node.clipId
          ? groupClips.get(item.node.clipId)
          : undefined;
        if (item.node.isolationKind === "clip" && !clipShape)
          failure(
            "source-clip-missing",
            `Group ${item.node.id} has no clip geometry.`,
          );
        const parentBox = {
          x: originX / scaleX,
          y: originY / scaleY,
          width: width / scaleX,
          height: height / scaleY,
        };
        const containsParent = (box: Box): boolean =>
          box.x <= parentBox.x &&
          box.y <= parentBox.y &&
          box.x + box.width >= parentBox.x + parentBox.width &&
          box.y + box.height >= parentBox.y + parentBox.height;
        const radii = clipShape?.radii;
        const squareClip =
          radii &&
          Object.values(radii).every(
            (corner) => corner.x === 0 && corner.y === 0,
          );
        if (
          item.node.opacity === 1 &&
          (item.node.isolationKind === "opacity" ||
            (clipShape &&
              squareClip &&
              containsParent(clipShape.rect) &&
              clipShape.localToTarget.b === 0 &&
              clipShape.localToTarget.c === 0))
        ) {
          current = await drawItems(
            item.children,
            current,
            originX,
            originY,
            width,
            height,
            groupKey,
            true,
            planes,
          );
          drawn = true;
          continue;
        }
        const clipBox = clipShape?.rect ?? item.node.box;
        const left = Math.max(
          originX,
          Math.floor(Math.max(item.node.box.x, clipBox.x) * scaleX),
        );
        const top = Math.max(
          originY,
          Math.floor(Math.max(item.node.box.y, clipBox.y) * scaleY),
        );
        const right = Math.min(
          originX + width,
          Math.ceil(
            Math.min(
              item.node.box.x + item.node.box.width,
              clipBox.x + clipBox.width,
            ) * scaleX,
          ),
        );
        const bottom = Math.min(
          originY + height,
          Math.ceil(
            Math.min(
              item.node.box.y + item.node.box.height,
              clipBox.y + clipBox.height,
            ) * scaleY,
          ),
        );
        if (right <= left || bottom <= top) continue;
        const groupWidth = right - left;
        const groupHeight = bottom - top;
        const groupTexture = bank.texture(
          `${groupKey}:working`,
          groupWidth,
          groupHeight,
        );
        const fullBox = parentBox;
        const groupBox = {
          x: left / scaleX,
          y: top / scaleY,
          width: groupWidth / scaleX,
          height: groupHeight / scaleY,
        };
        const seed: DrawItem = {
          id: `${groupKey}:incoming`,
          texture: current,
          rect: fullBox,
          localBox: fullBox,
          localToTarget: IDENTITY,
          clip: fullBox,
          clips: [],
          opacity: 1,
          premultiplied: true,
          encodedScene: blendMode !== "linear",
          backdropReplacement: false,
        };
        const groupResult = await drawItems(
          [seed, ...item.children],
          groupTexture,
          left,
          top,
          groupWidth,
          groupHeight,
          groupKey,
        );
        const resolve: DrawItem = {
          id: `${groupKey}:resolve`,
          texture: groupResult,
          rect: item.node.box,
          localBox: groupBox,
          localToTarget: IDENTITY,
          clip: item.node.box,
          clips: clipShape ? [clipShape] : [],
          opacity: item.node.opacity,
          premultiplied: true,
          encodedScene: blendMode !== "linear",
          backdropReplacement: true,
          groupResolve: true,
        };
        current = await drawItems(
          [resolve],
          current,
          originX,
          originY,
          width,
          height,
          `${groupKey}:resolve`,
          true,
          planes,
        );
        drawn = true;
        continue;
      }
      const clip = item.clip;
      const x = Math.max(0, Math.floor(clip.x * scaleX) - originX);
      const y = Math.max(0, Math.floor(clip.y * scaleY) - originY);
      const w =
        Math.min(width, Math.ceil((clip.x + clip.width) * scaleX) - originX) -
        x;
      const h =
        Math.min(height, Math.ceil((clip.y + clip.height) * scaleY) - originY) -
        y;
      if (w <= 0 || h <= 0) continue;
      if (item.backdropReplacement && item.record) {
        flush();
        let window: NativeGroupLocalBackdropWindowPlan | undefined;
        if (item.nestedBackdrop) {
          const plannedWindow = planNativeGroupLocalBackdropWindow({
            incoming: { x: originX, y: originY, width, height },
            output: item.nestedBackdrop.output,
            extent: item.nestedBackdrop.extent,
            localBox: item.localBox,
            localToTarget: item.localToTarget,
            physicalScale: { x: scaleX, y: scaleY },
            receiverClip: item.clip,
          });
          if (!plannedWindow.ok)
            failure(
              "source-group-local-geometry-unsupported",
              plannedWindow.reason,
            );
          window = plannedWindow.plan;
        }
        const staged = await resolveRecord(item.record, {
          encoder,
          currentScene: current,
          incoming: { x: originX, y: originY, width, height },
          encodedScene: blendMode !== "linear",
          window,
        });
        if (staged.backdropReplacement === false)
          failure("backdrop-replacement-unavailable");
        item.texture = validateTexture(staged.texture, item.id);
        if (
          item.imageSampling &&
          (item.imageSampling.sourceSize.width !== item.texture.width ||
            item.imageSampling.sourceSize.height !== item.texture.height)
        )
          failure("source-image-rendering-geometry");
        item.opacity = staged.opacity ?? item.opacity;
        item.premultiplied = staged.premultiplied ?? item.premultiplied;
        item.encodedScene = staged.encodedScene ?? item.encodedScene;
        item.receiverCoverage =
          staged.receiverCoverage ?? item.receiverCoverage;
      }
      const texture = validateTexture(item.texture, item.id);
      const sampling = planNativeImageSampling({
        imageRendering: item.imageSampling?.imageRendering,
        sourceSize: item.imageSampling?.sourceSize ?? {
          width: texture.width,
          height: texture.height,
        },
        uploadedSize: { width: texture.width, height: texture.height },
        localBox: item.localBox,
        localToTarget: item.localToTarget,
        physicalScale: { x: scaleX, y: scaleY },
        uv: item.uv,
      });
      if (!sampling.ok) failure(`source-image-rendering-${sampling.reason}`);
      const data = packNativeWorkerCompositeDraw({
        item,
        physicalScale: { x: scaleX, y: scaleY },
        origin: { x: originX, y: originY },
        viewport: { width, height },
        pixelated: sampling.pixelated,
        blendMode,
      });
      if (item.backdropReplacement) {
        flush();
        const pipeline = await gpu.pipeline(
          backdropReplaceWgsl(!!item.receiverCoverage),
          format,
          false,
          item.receiverCoverage ? 3 : 2,
        );
        const next = replacementTarget(planes, current, width, height);
        if (next === texture) failure("source-composition-plane-unavailable");
        const bind = gpu.bind(
          `scene:${item.id}:replace`,
          pipeline,
          current,
          texture,
          data,
          gpu.sampler(sampling.filter),
          item.receiverCoverage ? [item.receiverCoverage] : [],
        );
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: next.createView(),
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        current = next;
        drawn = true;
        continue;
      }
      commands.push({
        bind: gpu.bind(
          `scene:${item.id}`,
          compositePipeline,
          texture,
          null,
          data,
          gpu.sampler(sampling.filter),
        ),
        x,
        y,
        w,
        h,
      });
    }
    flush();
    return current;
  };
  const renderNode = async (
    node: NativeSourcePaintNode,
  ): Promise<Paint | null> => {
    if (node.kind === "leaf") {
      const record = leaves.get(node.id);
      if (!record)
        failure("source-record-missing", `Source ${node.id} was not found.`);
      if (
        surface.viewport &&
        (!intersects(surface.viewport, record.rect) ||
          !intersects(surface.viewport, record.clip))
      )
        return null;
      const value = resolved.get(node.id);
      if (!value)
        failure(
          "native-dependency-missing",
          `Source ${node.id} was not resolved.`,
        );
      return {
        id: node.id,
        record,
        texture: value.texture,
        rect: record.rect,
        localBox: record.localBox,
        localToTarget: record.localToTarget,
        clip: record.clip,
        clips: record.clips,
        opacity: value.opacity ?? node.opacity,
        premultiplied: value.premultiplied ?? !!record.nativeInstanceId,
        encodedScene: value.encodedScene ?? false,
        backdropReplacement: value.backdropReplacement ?? false,
        receiverCoverage: value.receiverCoverage,
        nestedBackdrop: value.nestedBackdrop,
        uv: record.uv,
        imageSampling: record.imageRendering
          ? {
              imageRendering: record.imageRendering,
              sourceSize: { width: record.width, height: record.height },
            }
          : undefined,
      };
    }
    const children: Paint[] = [];
    for (const child of node.children) {
      const item = await renderNode(child);
      if (item) children.push(item);
    }
    if (hasBackdropReplacement(node))
      return { kind: "deferred-group", node, children };
    if (node.isolationKind === "root" || !node.isolate)
      failure("source-isolation-invalid", `Group ${node.id} was not isolated.`);
    const clipShape = node.clipId ? groupClips.get(node.clipId) : undefined;
    if (node.isolationKind === "clip" && !clipShape)
      failure("source-clip-missing", `Group ${node.id} has no clip geometry.`);
    const box = clipShape
      ? {
          x: Math.max(node.box.x, clipShape.rect.x),
          y: Math.max(node.box.y, clipShape.rect.y),
          width: Math.max(
            0,
            Math.min(
              node.box.x + node.box.width,
              clipShape.rect.x + clipShape.rect.width,
            ) - Math.max(node.box.x, clipShape.rect.x),
          ),
          height: Math.max(
            0,
            Math.min(
              node.box.y + node.box.height,
              clipShape.rect.y + clipShape.rect.height,
            ) - Math.max(node.box.y, clipShape.rect.y),
          ),
        }
      : node.box;
    const left = Math.max(rootBox.x, Math.floor(box.x * scaleX));
    const top = Math.max(rootBox.y, Math.floor(box.y * scaleY));
    const right = Math.min(
      rootBox.x + rootBox.width,
      Math.ceil((box.x + box.width) * scaleX),
    );
    const bottom = Math.min(
      rootBox.y + rootBox.height,
      Math.ceil((box.y + box.height) * scaleY),
    );
    if (right <= left || bottom <= top) return null;
    const width = right - left;
    const height = bottom - top;
    const groupKey = `${blendMode}:${node.isolationKind}:${node.id}`;
    const groupTexture = await drawItems(
      children,
      bank.texture(groupKey, width, height),
      left,
      top,
      width,
      height,
      groupKey,
    );
    const rect = {
      x: left / scaleX,
      y: top / scaleY,
      width: width / scaleX,
      height: height / scaleY,
    };
    return {
      id: `group:${groupKey}`,
      texture: groupTexture,
      rect,
      localBox: rect,
      localToTarget: IDENTITY,
      clip: clipShape?.rect ?? rect,
      clips: clipShape ? [clipShape] : [],
      opacity: node.opacity,
      premultiplied: true,
      encodedScene: blendMode !== "linear",
      backdropReplacement: false,
    };
  };
  const rootItems: Paint[] = [];
  for (const child of planned.root.children) {
    const item = await renderNode(child);
    if (item) rootItems.push(item);
  }
  compositionTarget = await drawItems(
    rootItems,
    compositionTarget,
    rootBox.x,
    rootBox.y,
    rootBox.width,
    rootBox.height,
    outputName,
    false,
    rootPlanes,
  );
  if (blendMode !== "srgb-css-linear") return compositionTarget;
  const decoded = compositionTarget === source ? rootPlanes.primary : source;
  if (
    (compositionTarget !== rootPlanes.primary &&
      compositionTarget !== rootPlanes.companion) ||
    decoded === compositionTarget
  )
    failure("source-composition-plane-unavailable");
  const decodePipeline = await gpu.pipeline(
    cssSceneDecodeWgsl,
    format,
    false,
    1,
  );
  const bind = gpu.bind(
    `scene:${outputName}:decode-srgb`,
    decodePipeline,
    compositionTarget,
    null,
    new Float32Array([surface.width, surface.height, 0, 0]),
  );
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: decoded.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      },
    ],
  });
  pass.setPipeline(decodePipeline);
  pass.setBindGroup(0, bind);
  pass.draw(6);
  pass.end();
  return decoded;
}
