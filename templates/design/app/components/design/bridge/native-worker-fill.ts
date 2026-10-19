import type { EffectInstance } from "../../../../shared/native-effects";
import {
  planNativeFillPresentationExtent,
  type NativeEffectExtentPlan,
} from "./native-effect-extent";
import type {
  NativeWorkerBlendMode,
  NativeWorkerCompositionSurface,
} from "./native-worker-compositor";
import type {
  NativeWorkerGpuBank,
  NativeWorkerGpuFacade,
} from "./native-worker-gpu";
import {
  fillCompositeWgsl,
  fillCoveredBoxWgsl,
  fillCoveredUnderlayWgsl,
  fillPresentationWgsl,
  fillTextMixWgsl,
} from "./native-worker-gpu-wgsl";
import type {
  NativeWorkerEffectTarget,
  NativeWorkerScene,
  NativeWorkerSourceRecord,
} from "./native-worker-protocol";

const MAX_DIMENSION = 4096;
const MAX_PIXELS = 8_388_608;

export class NativeWorkerFillError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "NativeWorkerFillError";
  }
}

export interface NativeWorkerFillCarry {
  underlay: GPUTexture;
  glyph?: GPUTexture;
  border: GPUTexture;
  outerCoverage: GPUTexture;
  innerCoverage: GPUTexture;
}

export interface NativeWorkerFillResult {
  texture: GPUTexture;
  carry: NativeWorkerFillCarry;
  presentationExtent: NativeEffectExtentPlan;
}

export interface NativeWorkerFillInput {
  scene: NativeWorkerScene;
  target: NativeWorkerEffectTarget;
  instance: EffectInstance;
  encoder: GPUCommandEncoder;
  bank: NativeWorkerGpuBank;
  gpu: NativeWorkerGpuFacade;
  format: GPUTextureFormat;
  transparent: GPUTexture;
  foreground: GPUTexture;
  previousFill?: NativeWorkerFillCarry;
  isTopFill: boolean;
  asset(record: NativeWorkerSourceRecord): GPUTexture;
  composeRecords(
    records: readonly NativeWorkerSourceRecord[],
    key: string,
    surface: NativeWorkerCompositionSurface,
    blendMode: NativeWorkerBlendMode,
    stagedNativeTextures?: ReadonlyMap<string, GPUTexture>,
  ): Promise<GPUTexture>;
  stageFillBackdrops?(
    records: readonly NativeWorkerSourceRecord[],
    backdrop: GPUTexture,
    extent: NativeEffectExtentPlan,
  ): Promise<ReadonlyMap<string, GPUTexture>>;
}

function failure(code: string, message = code): never {
  throw new NativeWorkerFillError(code, message);
}

function requireSize(
  texture: GPUTexture,
  width: number,
  height: number,
  transparent: GPUTexture,
  code: string,
): void {
  if (
    texture !== transparent &&
    (texture.width !== width || texture.height !== height)
  )
    failure(code);
}

function fillSurface(
  target: NativeWorkerEffectTarget,
  extent: NativeEffectExtentPlan,
): NativeWorkerCompositionSurface {
  return {
    width: extent.width,
    height: extent.height,
    pixelRatio: target.pixelRatio,
    outputExtent: extent,
    targetLocalSize: {
      width: extent.sourceWidth / target.pixelRatio,
      height: extent.sourceHeight / target.pixelRatio,
    },
    targetViewportSize: {
      width: target.rect.width,
      height: target.rect.height,
    },
  };
}

export async function renderNativeWorkerFill(
  input: NativeWorkerFillInput,
): Promise<NativeWorkerFillResult> {
  const {
    scene,
    target,
    instance,
    encoder,
    bank,
    gpu,
    format,
    transparent,
    foreground,
    previousFill,
    isTopFill,
    composeRecords,
    stageFillBackdrops,
  } = input;
  if (instance.placement !== "fill") failure("fill-placement-invalid");
  const extent = target.outputExtent;
  if (
    !extent ||
    extent.width !== target.width ||
    extent.height !== target.height
  )
    failure("fill-presentation-geometry-unavailable");
  const phases = target.fillPhases;
  if (!phases)
    failure(
      "fill-background-unavailable",
      "The authored Fill paint phases are required.",
    );
  if (foreground.width !== target.width || foreground.height !== target.height)
    failure("fill-effect-size-mismatch");
  const cssBlend = scene.colorSpace === "srgb" ? 1 : 0;
  const prefix = `fill:${instance.id}:`;
  const compose = (
    records: readonly NativeWorkerSourceRecord[],
    key: string,
    outputExtent: NativeEffectExtentPlan = extent,
    blendMode: NativeWorkerBlendMode = "linear",
    stagedNativeTextures?: ReadonlyMap<string, GPUTexture>,
  ): Promise<GPUTexture> =>
    composeRecords(
      records,
      `${prefix}${key}`,
      fillSurface(target, outputExtent),
      blendMode,
      stagedNativeTextures,
    );
  const draw = async (
    key: string,
    wgsl: string,
    front: GPUTexture,
    back: GPUTexture,
    values: Float32Array,
    width = target.width,
    height = target.height,
    extras: readonly GPUTexture[] = [],
  ): Promise<GPUTexture> => {
    const output = gpu.texture(bank, `${prefix}${key}`, width, height, format);
    if ([front, back, ...extras].includes(output)) failure("fill-output-alias");
    const pipeline = await gpu.pipeline(wgsl, format, false, 2 + extras.length);
    const binding = gpu.bind(
      bank,
      `${prefix}${key}:bind`,
      pipeline,
      front,
      back,
      values,
      extras,
    );
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: output.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, binding);
    pass.draw(6);
    pass.end();
    return output;
  };
  const covered = async (
    key: string,
    wgsl: string,
    front: GPUTexture,
    back: GPUTexture,
    extras: readonly GPUTexture[],
    initialBackground: boolean,
  ): Promise<GPUTexture> => {
    for (const texture of [front, back, ...extras])
      requireSize(
        texture,
        target.width,
        target.height,
        transparent,
        "fill-phase-size-mismatch",
      );
    return draw(
      key,
      wgsl,
      front,
      back,
      new Float32Array([
        target.width,
        target.height,
        initialBackground ? 1 : 0,
        0,
        cssBlend,
        0,
        0,
        0,
      ]),
      target.width,
      target.height,
      extras,
    );
  };
  const composite = async (
    key: string,
    front: GPUTexture,
    back: GPUTexture,
    width = target.width,
    height = target.height,
  ): Promise<GPUTexture> => {
    requireSize(
      front,
      width,
      height,
      transparent,
      "fill-foreground-size-mismatch",
    );
    requireSize(
      back,
      width,
      height,
      transparent,
      "fill-background-size-mismatch",
    );
    return draw(
      key,
      fillCompositeWgsl,
      front,
      back,
      new Float32Array([width, height, cssBlend, 0]),
      width,
      height,
    );
  };
  const compositePresentation = async (
    key: string,
    children: GPUTexture,
    fill: GPUTexture,
    presentationExtent: NativeEffectExtentPlan,
    fillOnTop = false,
  ): Promise<GPUTexture> => {
    if (
      children.width !== presentationExtent.width ||
      children.height !== presentationExtent.height ||
      fill.width !== target.width ||
      fill.height !== target.height
    )
      failure("fill-presentation-size-mismatch");
    return draw(
      key,
      fillPresentationWgsl,
      children,
      fill,
      new Float32Array([
        presentationExtent.width,
        presentationExtent.height,
        cssBlend,
        0,
        presentationExtent.left - extent.left,
        presentationExtent.top - extent.top,
        fillOnTop ? 1 : 0,
        0,
      ]),
      presentationExtent.width,
      presentationExtent.height,
    );
  };
  let underlayBase: GPUTexture;
  let border: GPUTexture;
  let outerCoverage: GPUTexture;
  let innerCoverage: GPUTexture;
  let glyphBase: GPUTexture | undefined;
  if (previousFill) {
    ({ border, outerCoverage, innerCoverage } = previousFill);
    underlayBase = previousFill.underlay;
    glyphBase = previousFill.glyph;
    for (const value of [underlayBase, border, outerCoverage, innerCoverage])
      requireSize(
        value,
        target.width,
        target.height,
        transparent,
        "fill-dependency-unavailable",
      );
  } else {
    const phase = (
      records: readonly NativeWorkerSourceRecord[],
      name: string,
    ): GPUTexture => {
      if (records.length !== 1 || !records[0]?.assetId)
        failure(
          "fill-box-phase-unavailable",
          `The authored Fill ${name} phase is unavailable.`,
        );
      const texture = input.asset(records[0]);
      requireSize(
        texture,
        target.width,
        target.height,
        transparent,
        "fill-phase-size-mismatch",
      );
      return texture;
    };
    underlayBase = phase(phases.backgroundRecords, "background");
    border = phase(phases.borderRecords, "border");
    outerCoverage = phase(phases.outerCoverageRecords, "coverage");
    innerCoverage = phase(phases.innerCoverageRecords, "inner-coverage");
    glyphBase = phases.glyphRecords.length
      ? await compose(
          phases.glyphRecords,
          "glyph",
          extent,
          cssBlend && phases.glyphRecords.length > 1
            ? "srgb-css-linear"
            : "linear",
        )
      : undefined;
  }
  const textFill = instance.clip === "text";
  let underlay = await covered(
    "underlay",
    fillCoveredUnderlayWgsl,
    textFill ? transparent : foreground,
    underlayBase,
    [outerCoverage, innerCoverage],
    !previousFill,
  );
  if (isTopFill && phases.insetShadowRecords.length) {
    const inset = await compose(phases.insetShadowRecords, "inset-shadow");
    underlay = await composite("underlay-inset", inset, underlay);
  }
  let glyph = glyphBase;
  if (textFill) {
    const opacity = instance.opacity;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      failure("fill-opacity-invalid");
    glyph = await draw(
      "text",
      fillTextMixWgsl,
      foreground,
      glyphBase ?? transparent,
      new Float32Array([target.width, target.height, opacity, cssBlend]),
    );
  }
  const carry: NativeWorkerFillCarry = {
    underlay,
    glyph,
    border,
    outerCoverage,
    innerCoverage,
  };
  if (!isTopFill)
    return { texture: underlay, carry, presentationExtent: extent };
  const box = await covered(
    "box",
    fillCoveredBoxWgsl,
    underlay,
    border,
    [outerCoverage],
    false,
  );
  const fillPhase = await composite("phase", glyph ?? transparent, box);
  const outer = phases.outerShadowRecords;
  const outline = phases.outlineRecords;
  const children = phases.foregroundRecords;
  const visible = [...children, ...outer, ...outline];
  const planned = planNativeFillPresentationExtent({
    fill: extent,
    foreground: visible,
    maxDimension: MAX_DIMENSION,
    maxPixels: MAX_PIXELS,
  });
  if (!planned.ok) failure(planned.code, planned.detail);
  const presentationExtent = planned.plan;
  if (!visible.length) return { texture: fillPhase, carry, presentationExtent };
  const expanded =
    presentationExtent.width !== target.width ||
    presentationExtent.height !== target.height ||
    presentationExtent.left !== extent.left ||
    presentationExtent.top !== extent.top;
  let base = fillPhase;
  if (outer.length) {
    const outerTexture = await compose(
      outer,
      "outer-shadow",
      presentationExtent,
    );
    base = expanded
      ? await compositePresentation(
          "expanded-base",
          outerTexture,
          fillPhase,
          presentationExtent,
          true,
        )
      : await composite("expanded-base", fillPhase, outerTexture);
  }
  const nestedBackdrop = children.some((record) =>
    scene.instances.some(
      (candidate) =>
        candidate.id === record.nativeInstanceId &&
        candidate.placement === "backdrop",
    ),
  );
  if (nestedBackdrop && !stageFillBackdrops)
    failure(
      "fill-child-staging-unavailable",
      "Nested native Fill children require a staging transaction.",
    );
  const stagedNativeTextures = stageFillBackdrops
    ? await stageFillBackdrops(children, base, presentationExtent)
    : undefined;
  const overlay = [...children, ...outline];
  if (!overlay.length) return { texture: base, carry, presentationExtent };
  const overlayTexture = await compose(
    overlay,
    "child",
    presentationExtent,
    cssBlend && overlay.length > 1 ? "srgb-css-linear" : "linear",
    stagedNativeTextures,
  );
  const texture = outer.length
    ? await composite(
        "final",
        overlayTexture,
        base,
        presentationExtent.width,
        presentationExtent.height,
      )
    : expanded
      ? await compositePresentation(
          "final",
          overlayTexture,
          fillPhase,
          presentationExtent,
        )
      : await composite("final", overlayTexture, fillPhase);
  return { texture, carry, presentationExtent };
}
