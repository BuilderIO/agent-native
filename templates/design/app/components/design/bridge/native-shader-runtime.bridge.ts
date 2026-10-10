import {
  feedbackUniformProperties,
  planEffectGraph,
} from "../../../../shared/effect-graph";
import { resolveNativeClipRadii } from "../../../../shared/native-clip-geometry";
import type {
  NativeDraftPreviewControl,
  NativeDraftPreviewDiagnostic,
  NativeDraftPreviewRequest,
  NativeDraftPreviewResult,
} from "../../../../shared/native-draft-preview-contract";
import {
  nativeEffectAnimationCapability,
  type NativeEffectAnimationCapability,
} from "../../../../shared/native-effect-animation-capability";
import { planNativeSceneFrame } from "../../../../shared/native-effect-frame-policy";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "../../../../shared/native-effect-presets";
import { planNativeEffectTransform } from "../../../../shared/native-effect-transform";
import {
  hashEffectDefinition,
  parseNativeEffectApprovalState,
} from "../../../../shared/native-effect-trust";
import {
  packNativeProperties,
  validateEffectDocument,
  usesRetiredNativeImageAbi,
  type EffectDefinition,
  type EffectDocument,
  type EffectInstance,
} from "../../../../shared/native-effects";
import {
  NATIVE_EMBEDDED_ASSETS_ATTR,
  NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE,
  parseNativeEmbeddedAssetRegistryText,
  type NativeEmbeddedAssetEntry,
} from "../../../../shared/native-embedded-assets";
import {
  adaptNativeFeedbackDefinition,
  type NativeFeedbackDefinition,
} from "../../../../shared/native-feedback-plan";
import { planNativeInputResources } from "../../../../shared/native-input-resources";
import {
  hashEffectInstance,
  type NativeInstancePreviewClear,
  type NativeInstancePreviewRequest,
  type NativeInstancePreviewResult,
  type NativeInstancePreviewSet,
} from "../../../../shared/native-instance-preview-contract";
import { NativePipelineCache } from "../../../../shared/native-pipeline-cache";
import {
  NativePresentationFaultLatch,
  type NativePresentationFaultGrant,
} from "../../../../shared/native-presentation-fault-gate";
import { REVIEWED_LOCAL_RUNTIME_TARGET } from "../../../../shared/native-presentation-fault-pin";
import type {
  NativeExpectedLinearSamples,
  NativeLinearGoldenSummary,
  NativeMountedOutputSummary,
} from "../../../../shared/native-shader-validation";
import {
  planNativeSourceComposition,
  type NativeSourcePaintGroup,
  type NativeSourcePaintNode,
} from "../../../../shared/native-source-composition-tree";
import {
  isStatelessComputeDispatch,
  NativeStatelessComputeError,
  planStatelessCompute,
} from "../../../../shared/native-stateless-compute";
import {
  assertNativeUniformTiming,
  NativeUniformTimingError,
  packNativeUniformClock,
} from "../../../../shared/native-uniform-timing";
import {
  clearNativeAuthoredOpacityIfUnsuppressed,
  readNativeAuthoredPaint,
} from "./native-authored-paint";
import { planNativePhysicalRootBox } from "./native-capture-roi";
import {
  detectNativeDisplayDynamicRange,
  hasFloatColorPath,
  LINEAR_SRGB_TO_DISPLAY_P3_WGSL,
  usesDisplayP3Color,
  type NativeColorCapability,
  type NativeColorMode,
  type NativeDynamicRangeMode,
} from "./native-color-mode";
import { summarizeNativeCompositionBudget } from "./native-composition-budget";
import type {
  NativeCompositionFrame,
  NativeCompositionFrameOptions,
} from "./native-composition-clock";
import { runNativeCompositionSession } from "./native-composition-session";
import {
  NativeDeviceLifecycle,
  NativeDeviceLifecycleError,
  type NativeDeviceScope,
} from "./native-device-lifecycle";
import {
  planNativeChainedEffectExtent,
  type NativeEffectExtentPlan,
} from "./native-effect-extent";
import {
  planNativeOutputGeometry,
  supportsNativeOutput2D,
} from "./native-effect-output-geometry";
import { NativeFrameResourceScratch } from "./native-frame-resource-scratch";
import { nativeGpuTimestampFeature } from "./native-gpu-profiler";
import type { NativeGpuSampleWindow } from "./native-gpu-sample-window";
import {
  NativeGpuScopeProfiler,
  type NativeGpuScopedSample,
} from "./native-gpu-scope-profiler";
import {
  isCurrentNativeGroupLocalBackdropWindow,
  planNativeGroupLocalBackdropWindow,
  type NativeGroupLocalBackdropWindowPlan,
} from "./native-group-local-backdrop-window";
import {
  evaluateNativeLinearGoldenBytes,
  planNativeLinearGoldenReadback,
  NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW,
} from "./native-linear-golden";
import {
  emptyNativeBenchmarkPhaseValues,
  emptyNativeBenchmarkFullFrameValues,
  NativeMountedBenchmarkError,
  NativeMountedBenchmarkRun,
  type NativeBenchmarkPhaseValues,
  type NativeBenchmarkFullFrameValues,
  type NativeMountedBenchmarkRequest,
  type NativeMountedBenchmarkWindow,
} from "./native-mounted-benchmark";
import {
  evaluateNativeMountedOutputBytes,
  planNativeMountedOutputReadback,
  withNativeMountedTextureReadback,
} from "./native-mounted-output-summary";
import {
  NativePixelCleanupError,
  rgbaFromAlignedRows,
} from "./native-pixel-readback";
import { updateNativePlaybackClock } from "./native-playback-clock";
import {
  isNativePresentationPairSwap,
  canDetachPresentationFromSources,
  NativePresentationPair,
} from "./native-presentation-pair";
import {
  compactNativePresentationReadback,
  NativePublishedPresentationMirror,
  planNativePresentationReadback,
} from "./native-presentation-readback";
import {
  DEFAULT_NATIVE_PREVIEW_POLICY,
  NativePreviewPolicyController,
  type NativePreviewStatus,
} from "./native-preview-policy";
import { NativeRafIntervalTelemetry } from "./native-raf-interval";
import { createNativeRuntimeEpoch } from "./native-runtime-epoch";
import { planNativeSimulationSteps } from "./native-simulation-timeline";
import {
  planNativeSourceAffine,
  type NativeAffine2D,
  type NativeAffineBox,
} from "./native-source-affine-geometry";
import { planNativeSourceCoordinateScale } from "./native-source-coordinate-scale";
import {
  createNativeSceneProvider,
  cloneNativeTextFlow,
  nativeDocumentOrigin,
  nativePresentationVisible,
  nativeTargetOverflowInsets,
  nativeTextFlowUsesDocumentFont,
  NativeSourceError,
  paintNativeTextFlow,
  solidBackgroundAlpha,
  type NativeFillBackgroundPaint,
  type NativeSceneProvider,
  type NativeSourceClip,
  type NativeSourceRecord,
} from "./native-source-provider";
import {
  planNativeImageSampling,
  planNativeImageUpload,
  nativePixelatedImageSamplingWgsl,
} from "./native-source-sampling";
import {
  NativeStatelessComputePipelines,
  type NativeStatelessComputeFrame,
} from "./native-stateless-compute";
import {
  NativeFeedbackFailure,
  NativeTextureFeedbackExecutor,
  type NativeFeedbackEncodedFrame,
} from "./native-texture-feedback";

// TS 7 declares WebGPU objects but has not yet declared these browser constants.
declare const GPUTextureUsage: Readonly<{
  COPY_SRC: number;
  COPY_DST: number;
  TEXTURE_BINDING: number;
  RENDER_ATTACHMENT: number;
  STORAGE_BINDING: number;
}>;
declare const GPUBufferUsage: Readonly<{
  MAP_READ: number;
  UNIFORM: number;
  STORAGE: number;
  COPY_SRC: number;
  COPY_DST: number;
}>;
declare const GPUMapMode: Readonly<{ READ: number }>;
declare const GPUShaderStage: Readonly<{
  VERTEX: number;
  FRAGMENT: number;
  COMPUTE: number;
}>;

type Diagnostic = {
  code: string;
  message: string;
  instanceId?: string;
  passId?: string;
  line?: number;
  column?: number;
  issues?: NativeShaderCompilationIssue[];
};

type NativeShaderCompilationIssue = {
  passId?: string;
  line: number;
  column: number;
  message: string;
};

class NativeShaderCompilationError extends NativeSourceError {
  constructor(readonly issues: NativeShaderCompilationIssue[]) {
    super(
      "shader-compile-failed",
      issues
        .map(
          (issue) =>
            `${issue.passId ? `${issue.passId}: ` : ""}${issue.line}:${issue.column}: ${issue.message}`,
        )
        .join("\n"),
    );
  }

  withPass(passId: string): NativeShaderCompilationError {
    return new NativeShaderCompilationError(
      this.issues.map((issue) => ({ ...issue, passId })),
    );
  }
}
type NativeRenderResult = {
  time: number;
  rendered: number;
  failures: Diagnostic[];
  renderWallMs: number;
};
type NativeProfileStats = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};
type NativeStatus = "ready" | "last-good" | "error" | "unavailable";
type ApprovalStatus = "ready" | "pending" | "unreadable";
class NativeRenderFailure extends Error {
  readonly code = "native-render-incomplete";
  constructor(
    readonly result: NativeRenderResult,
    readonly stage: "frame" | "preview-density" = "frame",
  ) {
    super(
      result.failures
        .slice(0, 8)
        .map(
          (failure) =>
            `${stage}:${failure.instanceId ?? "scene"}:${failure.code}: ${failure.message.slice(0, 160)}`,
        )
        .join("; "),
    );
    this.name = "NativeRenderFailure";
  }
}
type Manifest = EffectDocument;
type NativeDeviceResources = {
  device: GPUDevice;
  format: GPUTextureFormat;
  colorMode: NativeColorMode;
  colorReason?: NativeColorCapability["reason"];
  dynamicRangeMode: NativeDynamicRangeMode;
  dynamicRangeReason?: NativeColorCapability["dynamicRangeReason"];
  canvasToneMappingStandard: NativeColorCapability["canvasToneMappingStandard"];
  sampler: GPUSampler;
  transparent: GPUTexture;
  white: GPUTexture;
};
type DrawBinding = {
  buffer: GPUBuffer;
  size: number;
  bindGroup: GPUBindGroup | null;
  pipeline: GPURenderPipeline | null;
  source: GPUTexture | null;
  mask: GPUTexture | null;
  sampler: GPUSampler | null;
  secondSampler: GPUSampler | null;
  extraTextures: readonly GPUTexture[] | null;
  lastFrame: number;
};
type NativeComposedItem = {
  id: string;
  texture: GPUTexture;
  rect: NativeSourceRecord["rect"];
  localBox: NativeAffineBox;
  localToTarget: NativeAffine2D;
  clip: NativeSourceRecord["clip"];
  clips: NativeSourceClip[];
  opacity: number;
  premultiplied: boolean;
  encodedScene: boolean;
  backdropReplacement?: boolean;
  groupResolve?: boolean;
  nestedBackdropId?: string;
  uv?: NativeSourceRecord["uv"];
  imageSampling?: {
    imageRendering: NativeSourceRecord["imageRendering"];
    sourceSize: { width: number; height: number };
  };
};
type NativeDeferredGroup = {
  kind: "deferred-group";
  node: NativeSourcePaintGroup;
  children: NativeComposedPaint[];
};
type NativeComposedPaint = NativeComposedItem | NativeDeferredGroup;
type NestedBackdropTransaction = {
  time: number;
  deterministic: boolean;
  active: Set<string>;
  staged: Map<string, { mount: Mount; texture: GPUTexture }>;
  noncontributing: Set<string>;
};
type Mount = {
  instance: EffectInstance;
  definition: EffectDefinition;
  definitionHash: string;
  animationCapability: NativeEffectAnimationCapability;
  target: HTMLElement;
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  presentationPair: NativePresentationPair<GPUCanvasContext> | null;
  provider: NativeSceneProvider | null;
  resourceTextures: Map<string, GPUTexture>;
  statelessBuffers: Set<GPUBuffer>;
  statelessInputs: Map<GPUTexture, number>;
  isolationTextures: Map<
    string,
    { texture: GPUTexture; width: number; height: number; lastFrame: number }
  >;
  drawBindings: Map<string, DrawBinding>;
  sourceTextures: Map<
    number,
    {
      texture: GPUTexture;
      revision: number;
      width: number;
      height: number;
      lastFrame: number;
    }
  >;
  assetTextures: Map<string, { texture: GPUTexture; lastFrame: number }>;
  assetPending: Map<string, Promise<GPUTexture>>;
  assetFailures: Map<string, NativeSourceError>;
  assetAbort: AbortController;
  outputTexture: GPUTexture | null;
  groupLocalCommittedChildren: Set<string>;
  groupLocalNoncontributingChildren: Set<string>;
  width: number;
  height: number;
  pixelRatio: number;
  outputExtent: NativeEffectExtentPlan | null;
  captureInsets: { top: number; right: number; bottom: number; left: number };
  maskTexture: GPUTexture | null;
  maskSignature: string;
  inputMaskSignature: string;
  inputMaskUsedFrame: number;
  suppressed: boolean;
  frameCount: number;
  imageRasters: number;
  sourceDownsamples: number;
  previousLayerId?: string;
  previousFillId?: string;
  layerSourceOpacityDeferred: boolean;
  layerOpacityModeTransitionPending: boolean;
  fillTextTexture: GPUTexture | null;
  fillUnderlayTexture: GPUTexture | null;
  fillPhaseTexture: GPUTexture | null;
  fillBorderTexture: GPUTexture | null;
  fillOuterCoverageTexture: GPUTexture | null;
  fillInnerCoverageTexture: GPUTexture | null;
  isTopLayer: boolean;
  clock: { global: number; local: number; speed: number; paused: boolean };
  renderWallSamples: number[];
  frozenReason: Diagnostic | null;
  reportedStatus: { status: NativeStatus; diagnostic?: Diagnostic } | null;
  authoredStyleDirty: boolean;
  authoredFillPaint: NativeFillBackgroundPaint | null;
  simulation: {
    buffers: [GPUBuffer, GPUBuffer];
    readIndex: 0 | 1;
    completedStep: number;
    count: number;
    byteLength: number;
    width: number;
    height: number;
    definitionKey: string;
    seed: number;
    trailOutput: string;
    pointer: { x: number; y: number; vx: number; vy: number; active: boolean };
  } | null;
  pointerListener: ((event: PointerEvent) => void) | null;
  pointerLeaveListener: (() => void) | null;
  simulationCaughtUp: boolean;
  feedback: {
    executor: NativeTextureFeedbackExecutor;
    definition: NativeFeedbackDefinition;
    textures: Set<GPUTexture>;
    definitionHash: string;
    seed: number;
    seekRevision: number;
    sourceRevision: string;
    pendingSourceRevision: string | null;
    sourceWidth: number;
    sourceHeight: number;
    retirements: Set<Promise<void>>;
  } | null;
  feedbackFrame: NativeFeedbackEncodedFrame | null;
};
type DraftPreview = {
  instanceId: string;
  nodeId: string;
  baseExecutionHash: string;
  executionHash: string;
  definition: EffectDefinition;
  instance: EffectInstance;
  generation: number;
  showDraft: boolean;
  playing: boolean;
  time: number;
  clockOrigin: number;
  publishedTexture: GPUTexture | null;
  lastGoodTexture: GPUTexture | null;
  failedReason: NativeDraftPreviewDiagnostic | null;
};
type CompositionSurface = Pick<
  Mount,
  | "target"
  | "width"
  | "height"
  | "resourceTextures"
  | "isolationTextures"
  | "drawBindings"
  | "sourceTextures"
  | "imageRasters"
  | "sourceDownsamples"
> & {
  instance?: EffectInstance;
  pixelRatio?: number;
  outputExtent?: NativeEffectExtentPlan | null;
  assetTextures?: Mount["assetTextures"];
  feedback?: Mount["feedback"];
  statelessBuffers?: Mount["statelessBuffers"];
  statelessInputs?: Mount["statelessInputs"];
};
type NativeCompositionPixels = {
  width: number;
  height: number;
  colorSpace: "srgb";
  alpha: "straight";
  rgba: Uint8Array;
};
type NativeCompositionSceneDiagnostic = {
  stage: "not-captured" | "scene-read";
  viewport: { width: number; height: number };
  expectedVisibleMountIds: string[];
  nativeRecordIds: string[];
  missingVisibleMountIds: string[];
  mounts: Array<{
    instanceId: string;
    nodeId: string;
    status: string | null;
    canvasVisibility: string;
    canvasDisplay: string;
    outputWidth: number;
    outputHeight: number;
    sceneRecords: number;
  }>;
  omittedMounts: number;
  omittedRecords: number;
};
type NativeHeldPixelFrame = {
  document: Document;
  pixels: NativeCompositionPixels;
  runtimeCanvases: readonly HTMLCanvasElement[];
  viewport: { width: number; height: number };
  pixelRatio: number;
  signal: AbortSignal;
};
type NativePixelFrameOptions = RuntimeCompositionOptions & {
  viewport: { width: number; height: number };
  pixelRatio?: number;
  simulationSessionId?: string;
};
type NativeClockSnapshot = {
  playing: boolean;
  time: number;
  timeOverride: number | null;
  clockOrigin: number;
  clocks: Map<Mount, Mount["clock"]>;
};
type NativeSimulationExportSession = {
  id: string;
  fps: number;
  totalFrames: number;
  startTimeSeconds: number;
  nextFrame: number;
  clock: NativeClockSnapshot;
  saved: {
    mount: Mount;
    simulation: Mount["simulation"];
    feedback: Mount["feedback"];
    resources: Map<string, GPUTexture>;
    output: GPUTexture | null;
  }[];
  failed: boolean;
  deviceEpoch: number;
};
type RuntimeCompositionOptions = Pick<
  NativeCompositionFrameOptions,
  | "frameIndex"
  | "fps"
  | "startTimeSeconds"
  | "signal"
  | "timeoutMs"
  | "sourceContract"
>;

const SCRIPT_TYPE = "application/x-agent-native-effects";
const APPROVALS_SCRIPT_TYPE = "application/x-agent-native-effect-approvals";
const definitionKey = (id: string, version: number): string =>
  JSON.stringify([id, version]);
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 8_388_608;
const MAX_RESOURCE_BYTES = 134_217_728;
const MAX_REALM_TEXTURE_BYTES = 402_653_184;
const MAX_INPUT_ASSET_BYTES = 16_777_216;
const MAX_PIPELINES = 64;
const MAX_SOURCE_CLIPS = 8;
const MAX_UNIFORM_BYTES = 16_777_216;
const EMPTY_SOURCE = new Uint8Array([0, 0, 0, 0]);
const WHITE_SOURCE = new Uint8Array([255, 255, 255, 255]);

function awaitInputDecode<T>(
  work: Promise<T>,
  signal: AbortSignal,
  releaseLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = (): void => {
      if (settled) return;
      settled = true;
      reject(
        new NativeSourceError(
          "input-asset-timeout",
          "The input image decode was cancelled or exceeded its deadline.",
        ),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (settled) {
          releaseLate?.(value);
          return;
        }
        settled = true;
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

const nativeClipCoverageWgsl = `
fn ellipseCoverage(p: vec2f, center: vec2f, radii: vec2f, pixelScale: f32) -> f32 {
  let q = p - center;
  let r = max(radii, vec2f(0.0001));
  let k0 = length(q / r);
  if (k0 < 0.00001) { return 1.0; }
  let k1 = length(q / (r * r));
  let distance = k0 * (k0 - 1.0) / max(k1, 0.00001);
  return clamp(0.5 - distance / pixelScale, 0.0, 1.0);
}
fn clipCoverage(p: vec2f, clip: Clip) -> f32 {
  let projected = vec3f(p, 1.0);
  let point = vec2f(dot(clip.inverseX.xyz, projected), dot(clip.inverseY.xyz, projected));
  let local = point - clip.rect.xy;
  let size = clip.rect.zw;
  let pixelScale = max(max(length(clip.inverseX.xy), length(clip.inverseY.xy)), 0.00001);
  if (local.x < -pixelScale || local.y < -pixelScale || local.x > size.x + pixelScale || local.y > size.y + pixelScale) {
    return 0.0;
  }
  var coverage = clamp(min(min(local.x, local.y), min(size.x - local.x, size.y - local.y)) / pixelScale + 0.5, 0.0, 1.0);
  let tl = clip.radiiTop.xy;
  let tr = clip.radiiTop.zw;
  let br = clip.radiiBottom.xy;
  let bl = clip.radiiBottom.zw;
  if (tl.x > 0.0 && tl.y > 0.0 && local.x < tl.x && local.y < tl.y) {
    coverage = min(coverage, ellipseCoverage(local, tl, tl, pixelScale));
  }
  if (tr.x > 0.0 && tr.y > 0.0 && local.x > size.x - tr.x && local.y < tr.y) {
    coverage = min(coverage, ellipseCoverage(local, vec2f(size.x - tr.x, tr.y), tr, pixelScale));
  }
  if (br.x > 0.0 && br.y > 0.0 && local.x > size.x - br.x && local.y > size.y - br.y) {
    coverage = min(coverage, ellipseCoverage(local, size - br, br, pixelScale));
  }
  if (bl.x > 0.0 && bl.y > 0.0 && local.x < bl.x && local.y > size.y - bl.y) {
    coverage = min(coverage, ellipseCoverage(local, vec2f(bl.x, size.y - bl.y), bl, pixelScale));
  }
  return coverage;
}
`;

const compositeWgsl = `
struct Clip {
  rect: vec4f,
  radiiTop: vec4f,
  radiiBottom: vec4f,
  inverseX: vec4f,
  inverseY: vec4f,
};
struct Draw {
  rect: vec4f,
  viewport: vec4f,
  opacity: vec4f,
  uv: vec4f,
  clipCount: vec4f,
  origin: vec4f,
  localBox: vec4f,
  inverseX: vec4f,
  inverseY: vec4f,
  clips: array<Clip, 8>
};
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  let p = draw.rect.xy - draw.origin.xy + xy * draw.rect.zw;
  var out: VOut;
  out.position = vec4f(2.0 * p.x / draw.viewport.x - 1.0, 1.0 - 2.0 * p.y / draw.viewport.y, 0.0, 1.0);
  return out;
}
${nativeClipCoverageWgsl}
${nativePixelatedImageSamplingWgsl}
fn cssEncode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(1.055 * pow(bounded, 1.0 / 2.4) - 0.055, 12.92 * bounded, bounded <= 0.0031308);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let point = input.position.xy + draw.origin.xy;
  let projected = vec3f(point, 1.0);
  let local = vec2f(dot(draw.inverseX.xyz, projected), dot(draw.inverseY.xyz, projected));
  let localUv = (local - draw.localBox.xy) / draw.localBox.zw;
  var sample = vec4f(0.0);
  if (all(draw.viewport.zw > vec2f(0.0))) {
    sample = nativeSamplePixelated(source, draw.uv.xy + localUv * draw.uv.zw, draw.viewport.zw, draw.opacity.y > 0.5);
  } else {
    sample = textureSample(source, samp, draw.uv.xy + localUv * draw.uv.zw);
  }
  if (any(localUv < vec2f(0.0)) || any(localUv > vec2f(1.0))) {
    return vec4f(0.0);
  }
  var rgb = select(sample.rgb * sample.a, sample.rgb, draw.opacity.y > 0.5);
  if (draw.opacity.z > 0.5 && draw.opacity.w < 0.5) {
    let straight = select(vec3f(0.0), rgb / max(sample.a, 0.00001), sample.a > 0.00001);
    rgb = vec3f(cssEncode(straight.r), cssEncode(straight.g), cssEncode(straight.b)) * sample.a;
  }
  var coverage = 1.0;
  for (var i = 0u; i < 8u; i = i + 1u) {
    if (f32(i) >= draw.clipCount.x) { break; }
    coverage = min(coverage, clipCoverage(point, draw.clips[i]));
  }
  return vec4f(rgb, sample.a) * (draw.opacity.x * coverage);
}`;
const backdropReplaceWgsl = `
struct Clip {
  rect: vec4f,
  radiiTop: vec4f,
  radiiBottom: vec4f,
  inverseX: vec4f,
  inverseY: vec4f,
};
struct Draw {
  rect: vec4f,
  viewport: vec4f,
  opacity: vec4f,
  uv: vec4f,
  clipCount: vec4f,
  origin: vec4f,
  localBox: vec4f,
  inverseX: vec4f,
  inverseY: vec4f,
  clips: array<Clip, 8>
};
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var priorScene: texture_2d<f32>;
@group(0) @binding(3) var processedBackdrop: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = array<vec2f, 3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0))[i];
  var output: VOut;
  output.position = vec4f(p, 0.0, 1.0);
  return output;
}
${nativeClipCoverageWgsl}
${nativePixelatedImageSamplingWgsl}
fn cssEncode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(1.055 * pow(bounded, 1.0 / 2.4) - 0.055, 12.92 * bounded, bounded <= 0.0031308);
}
fn cssDecode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
fn decodePremult(value: vec4f) -> vec4f {
  let straight = select(vec3f(0.0), value.rgb / max(value.a, 0.00001), value.a > 0.00001);
  return vec4f(vec3f(cssDecode(straight.r), cssDecode(straight.g), cssDecode(straight.b)) * value.a, value.a);
}
fn encodePremult(value: vec4f) -> vec4f {
  let straight = select(vec3f(0.0), value.rgb / max(value.a, 0.00001), value.a > 0.00001);
  return vec4f(vec3f(cssEncode(straight.r), cssEncode(straight.g), cssEncode(straight.b)) * value.a, value.a);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let previous = textureLoad(priorScene, vec2i(input.position.xy), 0);
  let point = input.position.xy + draw.origin.xy;
  if (draw.opacity.w > 0.5 &&
      (point.x < draw.rect.x || point.y < draw.rect.y ||
       point.x >= draw.rect.x + draw.rect.z || point.y >= draw.rect.y + draw.rect.w)) {
    return previous;
  }
  let projected = vec3f(point, 1.0);
  let local = vec2f(dot(draw.inverseX.xyz, projected), dot(draw.inverseY.xyz, projected));
  let localUv = (local - draw.localBox.xy) / draw.localBox.zw;
  if (any(localUv < vec2f(0.0)) || any(localUv > vec2f(1.0))) { return previous; }
  var effect = vec4f(0.0);
  if (all(draw.viewport.zw > vec2f(0.0))) {
    effect = nativeSamplePixelated(processedBackdrop, draw.uv.xy + localUv * draw.uv.zw, draw.viewport.zw, true);
  } else {
    effect = textureSampleLevel(processedBackdrop, samp, draw.uv.xy + localUv * draw.uv.zw, 0.0);
  }
  var coverage = 1.0;
  for (var i = 0u; i < 8u; i = i + 1u) {
    if (f32(i) >= draw.clipCount.x) { break; }
    coverage = min(coverage, clipCoverage(point, draw.clips[i]));
  }
  let weight = coverage * draw.opacity.x;
  if (weight <= 0.0) { return previous; }
  if (draw.opacity.z > 0.5 && draw.opacity.w < 0.5) {
    return encodePremult(mix(decodePremult(previous), effect, weight));
  }
  return mix(previous, effect, weight);
}`;

const cssPremultBlendWgsl = `
fn cssEncodeChannel(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(1.055 * pow(bounded, 1.0 / 2.4) - 0.055, 12.92 * bounded, bounded <= 0.0031308);
}
fn cssDecodeChannel(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
fn cssToEncoded(value: vec4f) -> vec4f {
  let alpha = clamp(value.a, 0.0, 1.0);
  let straight = select(vec3f(0.0), value.rgb / max(alpha, 0.00001), alpha > 0.00001);
  return vec4f(vec3f(cssEncodeChannel(straight.r), cssEncodeChannel(straight.g), cssEncodeChannel(straight.b)) * alpha, alpha);
}
fn cssToLinear(value: vec4f) -> vec4f {
  let alpha = clamp(value.a, 0.0, 1.0);
  let straight = select(vec3f(0.0), value.rgb / max(alpha, 0.00001), alpha > 0.00001);
  return vec4f(vec3f(cssDecodeChannel(straight.r), cssDecodeChannel(straight.g), cssDecodeChannel(straight.b)) * alpha, alpha);
}
fn cssSourceOver(front: vec4f, back: vec4f) -> vec4f {
  let encodedFront = cssToEncoded(front);
  let encodedBack = cssToEncoded(back);
  let remaining = 1.0 - encodedFront.a;
  return cssToLinear(encodedFront + encodedBack * remaining);
}
fn cssMix(front: vec4f, back: vec4f, weight: f32) -> vec4f {
  return cssToLinear(mix(cssToEncoded(back), cssToEncoded(front), weight));
}`;

const cssSceneDecodeWgsl = `
struct Draw { viewport: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
fn cssDecode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let uv = input.position.xy / draw.viewport.xy;
  let encoded = textureSample(source, samp, uv);
  let straight = select(vec3f(0.0), encoded.rgb / max(encoded.a, 0.00001), encoded.a > 0.00001);
  return vec4f(vec3f(cssDecode(straight.r), cssDecode(straight.g), cssDecode(straight.b)) * encoded.a, encoded.a);
}`;

const groupLocalBackdropSourceWgsl = `
struct Draw { extent: vec4f, sourceBox: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  return out;
}
fn cssDecode(v: f32) -> f32 {
  let bounded = clamp(v, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
fn linearPremult(encoded: vec4f) -> vec4f {
  let alpha = clamp(encoded.a, 0.0, 1.0);
  let straight = select(vec3f(0.0), encoded.rgb / max(alpha, 0.00001), alpha > 0.00001);
  return vec4f(vec3f(cssDecode(straight.r), cssDecode(straight.g), cssDecode(straight.b)) * alpha, alpha);
}
fn samplePixel(pixel: vec2i) -> vec4f {
  return textureLoad(source, pixel, 0);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  if (draw.extent.w > 0.5) {
    let pixel = vec2i(input.position.xy) + vec2i(draw.sourceBox.xy);
    let encoded = samplePixel(pixel);
    return select(encoded, linearPremult(encoded), draw.extent.z > 0.5);
  }
  let scaled = input.position.xy * draw.sourceBox.zw;
  let normalized = scaled / draw.extent.xy;
  let coordinate = draw.sourceBox.xy + normalized - vec2f(0.5);
  let base = vec2i(floor(coordinate));
  let fraction = fract(coordinate);
  var p00 = samplePixel(base);
  var p10 = samplePixel(base + vec2i(1, 0));
  var p01 = samplePixel(base + vec2i(0, 1));
  var p11 = samplePixel(base + vec2i(1, 1));
  if (draw.extent.z > 0.5) {
    p00 = linearPremult(p00);
    p10 = linearPremult(p10);
    p01 = linearPremult(p01);
    p11 = linearPremult(p11);
  }
  return mix(mix(p00, p10, fraction.x), mix(p01, p11, fraction.x), fraction.y);
}`;

const fillCompositeWgsl = `
struct Draw { viewport: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var foreground: texture_2d<f32>;
@group(0) @binding(3) var background: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let uv = input.position.xy / draw.viewport.xy;
  let front = textureSample(foreground, samp, uv);
  let back = textureSample(background, samp, uv);
  let remaining = 1.0 - clamp(front.a, 0.0, 1.0);
  if (draw.viewport.z > 0.5) { return cssSourceOver(front, back); }
  return vec4f(front.rgb + back.rgb * remaining, front.a + back.a * remaining);
}`;

const fillCoveredUnderlayWgsl = `
struct Draw { viewport: vec4f, cssBlend: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var effect: texture_2d<f32>;
@group(0) @binding(3) var previous: texture_2d<f32>;
@group(0) @binding(4) var outerCoverage: texture_2d<f32>;
@group(0) @binding(5) var innerCoverage: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let outer = clamp(textureSample(outerCoverage, samp, input.uv).a, 0.0, 1.0);
  let sampledInner = textureSample(innerCoverage, samp, input.uv).a;
  let prior = textureSample(previous, samp, input.uv);
  let sampledEffect = textureSample(effect, samp, input.uv);
  if (outer <= 0.000001) { return vec4f(0.0); }
  let inner = min(outer, clamp(sampledInner, 0.0, 1.0));
  let back = select(prior, vec4f(prior.rgb * prior.a, prior.a) / outer, draw.viewport.z > 0.5);
  let front = select(sampledEffect * (inner / outer), sampledEffect / outer, draw.viewport.w > 0.5);
  let remaining = 1.0 - clamp(front.a, 0.0, 1.0);
  if (draw.cssBlend.x > 0.5) { return cssSourceOver(front, back); }
  return vec4f(front.rgb + back.rgb * remaining, front.a + back.a * remaining);
}`;

const fillCoveredBoxWgsl = `
struct Draw { viewport: vec4f, cssBlend: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var underlay: texture_2d<f32>;
@group(0) @binding(3) var border: texture_2d<f32>;
@group(0) @binding(4) var outerCoverage: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let uv = input.position.xy / draw.viewport.xy;
  let outer = clamp(textureSample(outerCoverage, samp, uv).a, 0.0, 1.0);
  let prior = textureSample(underlay, samp, uv);
  let sampledBorder = textureSample(border, samp, uv);
  if (outer <= 0.000001) { return vec4f(0.0); }
  let borderPixel = vec4f(sampledBorder.rgb * sampledBorder.a, sampledBorder.a) / outer;
  let remaining = 1.0 - clamp(borderPixel.a, 0.0, 1.0);
  if (draw.cssBlend.x > 0.5) { return cssSourceOver(borderPixel, prior) * outer; }
  return vec4f(borderPixel.rgb + prior.rgb * remaining, borderPixel.a + prior.a * remaining) * outer;
}`;

const fillTextMixWgsl = `
struct Draw { viewport: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var effectAtUnitOpacity: texture_2d<f32>;
@group(0) @binding(3) var previousGlyph: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${cssPremultBlendWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let front = textureSample(effectAtUnitOpacity, samp, input.uv);
  let previous = textureSample(previousGlyph, samp, input.uv);
  let weight = clamp(draw.viewport.z, 0.0, 1.0);
  if (draw.viewport.w > 0.5) { return cssMix(front, previous, weight); }
  return mix(previous, front, weight);
}`;

const srgbEncodeWgsl = `
fn encode(v: f32) -> f32 {
  return select(1.055 * pow(max(v, 0.0), 1.0 / 2.4) - 0.055, 12.92 * v, v <= 0.0031308);
}`;

const presentWgsl = (mode: NativeColorMode): string => `
struct Draw { viewport: vec4f, opacity: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
@group(0) @binding(3) var mask: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${srgbEncodeWgsl}
${mode === "display-p3" ? LINEAR_SRGB_TO_DISPLAY_P3_WGSL : ""}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let c = textureSample(source, samp, input.uv);
  let m = textureSample(mask, samp, input.uv).a;
  let a = clamp(c.a * m * draw.opacity.x, 0.0, 1.0);
  let straight = select(vec3f(0.0), c.rgb / max(c.a, 0.00001), c.a > 0.00001);
  let displayColor = ${mode === "display-p3" ? "linearSrgbToDisplayP3(straight)" : "straight"};
  return vec4f(vec3f(encode(displayColor.r), encode(displayColor.g), encode(displayColor.b)) * a, a);
}`;

const exportCssPixelsWgsl = `
struct Draw { viewport: vec4f, opacity: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let encoded = textureSample(source, samp, input.uv);
  let straight = select(vec3f(0.0), encoded.rgb / max(encoded.a, 0.00001), encoded.a > 0.00001);
  return vec4f(clamp(straight, vec3f(0.0), vec3f(1.0)), clamp(encoded.a * draw.opacity.x, 0.0, 1.0));
}`;

const exportPixelsWgsl = `
struct Draw { viewport: vec4f, opacity: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
${srgbEncodeWgsl}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let premult = textureSample(source, samp, input.uv);
  let straight = select(vec3f(0.0), premult.rgb / max(premult.a, 0.00001), premult.a > 0.00001);
  return vec4f(encode(straight.r), encode(straight.g), encode(straight.b), clamp(premult.a * draw.opacity.x, 0.0, 1.0));
}`;

const finishWgsl = `
struct Draw { viewport: vec4f, opacity: vec4f, clipRect: vec4f, radiiTop: vec4f, radiiBottom: vec4f, transformX: vec4f, transformY: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
@group(0) @binding(3) var mask: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let p = input.uv * draw.viewport.xy - draw.clipRect.xy;
  let size = draw.clipRect.zw;
  var inside = 1.0;
  let tl = draw.radiiTop.xy;
  let tr = draw.radiiTop.zw;
  let br = draw.radiiBottom.xy;
  let bl = draw.radiiBottom.zw;
  if (tl.x > 0.0 && tl.y > 0.0 && p.x < tl.x && p.y < tl.y) {
    let q = (p - tl) / tl;
    if (dot(q, q) > 1.0) { inside = 0.0; }
  }
  if (tr.x > 0.0 && tr.y > 0.0 && p.x > size.x - tr.x && p.y < tr.y) {
    let q = (p - vec2f(size.x - tr.x, tr.y)) / tr;
    if (dot(q, q) > 1.0) { inside = 0.0; }
  }
  if (br.x > 0.0 && br.y > 0.0 && p.x > size.x - br.x && p.y > size.y - br.y) {
    let q = (p - (size - br)) / br;
    if (dot(q, q) > 1.0) { inside = 0.0; }
  }
  if (bl.x > 0.0 && bl.y > 0.0 && p.x < bl.x && p.y > size.y - bl.y) {
    let q = (p - vec2f(bl.x, size.y - bl.y)) / bl;
    if (dot(q, q) > 1.0) { inside = 0.0; }
  }
  let sourceUv = vec2f(
    dot(draw.transformX.xyz, vec3f(input.uv, 1.0)),
    dot(draw.transformY.xyz, vec3f(input.uv, 1.0))
  );
  let withinSource = all(sourceUv >= vec2f(0.0)) && all(sourceUv <= vec2f(1.0));
  let sampled = textureSample(source, samp, clamp(sourceUv, vec2f(0.0), vec2f(1.0)));
  let c = select(vec4f(0.0), sampled, withinSource);
  let maskAlpha = textureSample(mask, samp, input.uv).a;
  let opacity = clamp(draw.opacity.x * inside, 0.0, 1.0);
  if (draw.opacity.y > 0.5) {
    let alpha = min(clamp(c.a, 0.0, 1.0), maskAlpha) * opacity;
    let rgb = select(vec3f(0.0), c.rgb * (alpha / max(c.a, 0.00001)), c.a > 0.00001);
    return vec4f(rgb, alpha);
  }
  return c * (opacity * maskAlpha);
}`;

const linearPremultInputWgsl = `
@group(0) @binding(0) var encodedStraight: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(triangle[index], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let straight = textureLoad(encodedStraight, vec2i(position.xy), 0);
  return vec4f(straight.rgb * straight.a, straight.a);
}
`;

const encodedMipWgsl = `
@group(0) @binding(0) var previousLevel: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let triangle = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(triangle[index], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let sourceSize = vec2u(textureDimensions(previousLevel));
  let destinationSize = max(sourceSize / 2u, vec2u(1u));
  let pixel = vec2u(position.xy);
  let low = pixel * sourceSize / destinationSize;
  let high = (pixel + vec2u(1u)) * sourceSize / destinationSize;
  var sum = vec4f(0.0);
  var count = 0u;
  for (var y = low.y; y < high.y; y += 1u) {
    for (var x = low.x; x < high.x; x += 1u) {
      sum += textureLoad(previousLevel, vec2i(i32(x), i32(y)), 0);
      count += 1u;
    }
  }
  return sum / f32(max(count, 1u));
}
`;

const inputMaskWgsl = `
struct Draw { viewport: vec4f, targetRect: vec4f, radiiTop: vec4f, radiiBottom: vec4f };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var textCoverage: texture_2d<f32>;
struct VOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1))[i];
  var out: VOut;
  out.position = vec4f(2.0 * xy.x - 1.0, 1.0 - 2.0 * xy.y, 0.0, 1.0);
  out.uv = xy;
  return out;
}
fn ellipseCoverage(p: vec2f, center: vec2f, radii: vec2f) -> f32 {
  let q = p - center;
  let r = max(radii, vec2f(0.0001));
  let k0 = length(q / r);
  if (k0 < 0.00001) { return 1.0; }
  let k1 = length(q / (r * r));
  return clamp(0.5 - k0 * (k0 - 1.0) / max(k1, 0.00001), 0.0, 1.0);
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let p = input.uv * draw.viewport.xy - draw.targetRect.xy;
  let size = draw.targetRect.zw;
  var coverage = clamp(min(min(p.x, p.y), min(size.x - p.x, size.y - p.y)) + 0.5, 0.0, 1.0);
  let tl = draw.radiiTop.xy;
  let tr = draw.radiiTop.zw;
  let br = draw.radiiBottom.xy;
  let bl = draw.radiiBottom.zw;
  if (tl.x > 0.0 && tl.y > 0.0 && p.x < tl.x && p.y < tl.y) {
    coverage = min(coverage, ellipseCoverage(p, tl, tl));
  }
  if (tr.x > 0.0 && tr.y > 0.0 && p.x > size.x - tr.x && p.y < tr.y) {
    coverage = min(coverage, ellipseCoverage(p, vec2f(size.x - tr.x, tr.y), tr));
  }
  if (br.x > 0.0 && br.y > 0.0 && p.x > size.x - br.x && p.y > size.y - br.y) {
    coverage = min(coverage, ellipseCoverage(p, size - br, br));
  }
  if (bl.x > 0.0 && bl.y > 0.0 && p.x < bl.x && p.y > size.y - bl.y) {
    coverage = min(coverage, ellipseCoverage(p, vec2f(bl.x, size.y - bl.y), bl));
  }
  let alpha = coverage * textureSample(textCoverage, samp, input.uv).a;
  return vec4f(alpha, alpha, alpha, alpha);
}`;

class NativeShaderRuntime {
  readonly version = 2;
  readonly epoch = createNativeRuntimeEpoch();
  private readonly exportInitialPixelRatio: number | null;
  constructor(private readonly runtimeScript: Node | null) {
    const encoded =
      runtimeScript instanceof HTMLScriptElement
        ? runtimeScript.getAttribute(
            "data-agent-native-export-initial-pixel-ratio",
          )
        : null;
    if (encoded === null) {
      this.exportInitialPixelRatio = null;
      return;
    }
    const ratio = Number(encoded);
    if (
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      ratio > 4 ||
      String(ratio) !== encoded
    )
      throw new NativeSourceError(
        "export-initial-density-invalid",
        "export-initial-density-invalid",
      );
    this.exportInitialPixelRatio = ratio;
  }
  private device: GPUDevice | null = null;
  private deviceLifecycle = new NativeDeviceLifecycle<NativeDeviceResources>(
    (scope) => this.initializeDevice(scope),
  );
  private deviceRetryTimer = 0;
  private contextOwners = new WeakMap<GPUCanvasContext, GPUDevice>();
  private format: GPUTextureFormat = "bgra8unorm";
  private colorRequested: NativeColorMode = "srgb";
  private colorPresented: NativeColorMode = "srgb";
  private colorReason?: NativeColorCapability["reason"];
  private dynamicRangeRequested: NativeDynamicRangeMode = "sdr";
  private dynamicRangePresented: NativeDynamicRangeMode = "sdr";
  private documentColorRequested: NativeColorMode | null = null;
  private documentDynamicRangeRequested: NativeDynamicRangeMode | null = null;
  private dynamicRangeReason?: NativeColorCapability["dynamicRangeReason"];
  private canvasToneMappingStandard: NativeColorCapability["canvasToneMappingStandard"] =
    "unreadable";
  private workingFormat: GPUTextureFormat = "rgba16float";
  private colorChanging = false;
  private sampler: GPUSampler | null = null;
  private sourceSizingSamplers = new Map<string, GPUSampler>();
  private transparent: GPUTexture | null = null;
  private white: GPUTexture | null = null;
  private compositePipeline: GPURenderPipeline | null = null;
  private fillCompositePipeline: GPURenderPipeline | null = null;
  private fillTextPipeline: GPURenderPipeline | null = null;
  private presentPipeline: GPURenderPipeline | null = null;
  private finishPipeline: GPURenderPipeline | null = null;
  private effectLayout: GPUBindGroupLayout | null = null;
  private effectPipelineLayout: GPUPipelineLayout | null = null;
  private pipelines = new NativePipelineCache<GPURenderPipeline>(MAX_PIPELINES);
  private simulationComputePipelines =
    new NativePipelineCache<GPUComputePipeline>(16);
  private simulationRenderPipelines =
    new NativePipelineCache<GPURenderPipeline>(16);
  private simulationLayout: GPUBindGroupLayout | null = null;
  private simulationPipelineLayout: GPUPipelineLayout | null = null;
  private simulationBuffers = new Map<GPUBuffer, number>();
  private allocatedSimulationBytes = 0;
  private deviceEpoch = 0;
  private gpuProfiler: NativeGpuScopeProfiler | null = null;
  private gpuSamples = new WeakMap<GPUCommandEncoder, NativeGpuScopedSample>();
  private instancePreview: {
    instanceId: string;
    nodeId: string;
    baseInstanceSignature: string;
    instance: EffectInstance;
  } | null = null;
  private instancePreviewPending = false;
  private instancePreviewGeneration = 0;
  private instancePreviewSequence = new Map<string, number>();
  private embeddedAssets:
    | Map<string, NativeEmbeddedAssetEntry>
    | null
    | undefined;
  private embeddedAssetBlobs = new Map<string, Promise<Blob>>();
  private mounts = new Map<string, Mount>();
  private positionedParents = new Map<HTMLElement, number>();
  private presentationSheet: CSSStyleSheet | null = null;
  private readonly sceneCanvasIdentities = new WeakSet<HTMLCanvasElement>();
  private scenePresentation: {
    canvas: HTMLCanvasElement;
    context: GPUCanvasContext;
    provider: NativeSceneProvider;
    surface: CompositionSurface;
    suppressedElements: Set<HTMLElement>;
    committedInstances: Set<string>;
    onViewportChange: () => void;
    epoch: number;
  } | null = null;
  private issues: Diagnostic[] = [];
  private playing = true;
  private presentationFaultLatch = new NativePresentationFaultLatch();
  private presentationFaultHold = false;
  private presentationFaultTriggered = false;
  private presentationFaultRuntimeHash: string | null = null;
  private presentationMirrorCapture = false;
  private publishedPresentationMirror =
    new NativePublishedPresentationMirror<GPUTexture>((texture) =>
      this.destroyTexture(texture),
    );
  private compositionPixelRatio: number | null = null;
  private compositionPixelBusy = false;
  private lastCompositionSceneDiagnostic: NativeCompositionSceneDiagnostic = {
    stage: "not-captured",
    viewport: { width: 0, height: 0 },
    expectedVisibleMountIds: [],
    nativeRecordIds: [],
    missingVisibleMountIds: [],
    mounts: [],
    omittedMounts: 0,
    omittedRecords: 0,
  };
  private simulationExportSession: NativeSimulationExportSession | null = null;
  private simulationExportStarting = false;
  private simulationSessionSerial = 0;
  private previewRestoreWork: Promise<NativeRenderResult> | null = null;
  private compositionAbort: AbortController | null = null;
  private compositionDone: Promise<void> | null = null;
  private resolveCompositionDone: (() => void) | null = null;
  private compositionUnsafe = false;
  private timeOverride: number | null = null;
  private clockOrigin = performance.now();
  private raf = 0;
  private idleSourceTimer = 0;
  private running: Promise<NativeRenderResult> | null = null;
  private disposed = false;
  private started = false;
  private rescanObserver: MutationObserver | null = null;
  private authoredStyleObserver: MutationObserver | null = null;
  private rescanTimer = 0;
  private renderEpoch = 0;
  private retirement: GPUBuffer[] = [];
  private textureRetirement: GPUTexture[] = [];
  private retirementInFlightTextures = new Set<GPUTexture>();
  private retirementPending = false;
  private textureBytes = new Map<GPUTexture, number>();
  private destroyedTextures = new WeakSet<GPUTexture>();
  private allocatedTextureBytes = 0;
  private uniformBytes = new Map<GPUBuffer, number>();
  private allocatedUniformBytes = 0;
  private statelessBufferBytes = new Map<GPUBuffer, number>();
  private allocatedStatelessBytes = 0;
  private statelessTextureLeases = new Map<GPUTexture, number>();
  private statelessDeviceLeases = new Map<GPUDevice, number>();
  private statelessTextureDestruction = new Set<GPUTexture>();
  private statelessDeviceDestruction = new Set<GPUDevice>();
  private statelessPipelines =
    new NativePipelineCache<NativeStatelessComputePipelines>(16);
  private statelessFrames = new Map<
    GPUCommandEncoder,
    NativeStatelessComputeFrame[]
  >();
  private statelessRetirements = new Set<Promise<void>>();
  private activeMounts = new Set<Mount>();
  private renderWallSamples: number[] = [];
  private rafIntervalSamples: number[] = [];
  private mountedBenchmark: NativeMountedBenchmarkRun | null = null;
  private mountedBenchmarkRenderMetrics: {
    sourceWallMs: number;
    composeWallMs: number;
    hostWallPhases: NativeBenchmarkPhaseValues;
    fullFrameWallPhases: NativeBenchmarkFullFrameValues;
  } | null = null;
  private previewPolicy = new NativePreviewPolicyController();
  private previewDirty = true;
  private rafIntervalTelemetry = new NativeRafIntervalTelemetry();
  private profileFrames = 0;
  private rejectedTargets = new Set<HTMLElement>();
  private scanFailures: Diagnostic[] = [];
  private parseFailure: Diagnostic | null = null;
  private approvedHashes = new Set<string>();
  private approvalStatus: ApprovalStatus =
    window.parent === window ? "ready" : "pending";
  private rejectedById = new Map<string, Diagnostic & { nodeId: string }>();
  private sentStatus = new Map<string, { signature: string; at: number }>();
  private builtinHashesPromise: Promise<Set<string>> | null = null;
  private scanning: Promise<void> | null = null;
  private rescanPending = false;
  private draft: DraftPreview | null = null;
  private draftGeneration = 0;
  private draftRequestPending = false;

  diagnostics = (): Diagnostic[] => [...this.issues];

  private ensurePresentationStyles(): void {
    if (this.presentationSheet) return;
    if (typeof CSSStyleSheet === "undefined" || !document.adoptedStyleSheets)
      throw new NativeSourceError(
        "presentation-style-unavailable",
        "This browser cannot isolate native shader presentation styles.",
      );
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      [data-an-native-fill-host] { isolation: isolate !important; }
      [data-an-native-fill-positioned], [data-an-native-parent-positioned] { position: relative !important; }
      [data-an-native-fill-suppressed] { opacity: 0 !important; }
      [data-an-native-text-suppressed], [data-an-native-text-suppressed] * { color: transparent !important; -webkit-text-fill-color: transparent !important; }
      [data-an-native-layer-suppressed] { opacity: 0 !important; }
      [data-an-native-scene-suppressed] { opacity: 0 !important; }
    `);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    this.presentationSheet = sheet;
  }

  private unpublishScenePresentation(
    scene: NonNullable<NativeShaderRuntime["scenePresentation"]>,
  ): void {
    window.removeEventListener("scroll", scene.onViewportChange, true);
    window.removeEventListener("resize", scene.onViewportChange);
    for (const child of scene.suppressedElements) {
      child.removeAttribute("data-an-native-scene-suppressed");
      clearNativeAuthoredOpacityIfUnsuppressed(child);
    }
    scene.suppressedElements.clear();
    scene.canvas.style.visibility = "hidden";
    scene.canvas.remove();
  }

  private releaseScenePresentation(): void {
    const scene = this.scenePresentation;
    if (!scene) return;
    this.scenePresentation = null;
    this.unpublishScenePresentation(scene);
    scene.provider.dispose();
    scene.context.unconfigure();
    for (const entry of scene.surface.sourceTextures.values())
      this.destroyTexture(entry.texture);
    for (const texture of scene.surface.resourceTextures.values())
      this.destroyTexture(texture);
    for (const entry of scene.surface.isolationTextures.values())
      this.destroyTexture(entry.texture);
    for (const entry of scene.surface.drawBindings.values())
      this.destroyUniform(entry.buffer);
  }

  private groupLocalNoncontributing(mount: Mount): boolean {
    const owners = this.enclosingLayerMounts(mount.target);
    if (owners.length !== 1) return false;
    const owner = owners[0];
    if (
      !owner.outputTexture ||
      !owner.groupLocalNoncontributingChildren.has(mount.instance.id)
    )
      return false;
    if (!owner.provider)
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    return owner.provider.groupLocalBackdropClipState(mount.canvas) === "empty";
  }

  private representedNativeInstances(directIds: Set<string>): Set<string> {
    const represented = new Set(directIds);
    for (const id of directIds) {
      const parent = this.mounts.get(id);
      if (
        parent?.instance.placement !== "layer" ||
        !parent.outputTexture ||
        !parent.target.hasAttribute("data-an-native-layer-group-local-source")
      )
        continue;
      for (const childId of parent.groupLocalCommittedChildren) {
        const child = this.mounts.get(childId);
        if (
          child?.instance.placement === "backdrop" &&
          child.outputTexture &&
          parent.target.contains(child.target)
        )
          represented.add(childId);
      }
    }
    return represented;
  }

  private async presentScene(): Promise<void> {
    const sceneWallPhases =
      this.mountedBenchmarkRenderMetrics?.fullFrameWallPhases.scene;
    const body = document.body;
    if (!body || !this.device || this.disposed)
      throw new NativeSourceError(
        "scene-presentation-unavailable",
        "The full-scene native presentation is unavailable.",
      );
    if (
      [...body.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim(),
      )
    )
      throw new NativeSourceError(
        "scene-direct-text-unsupported",
        "Direct body text needs a scene presentation source record.",
      );
    if ([...body.children].some((child) => !(child instanceof HTMLElement)))
      throw new NativeSourceError(
        "scene-direct-element-unsupported",
        "A direct non-HTML body child needs an atomic presentation source.",
      );
    const scrolling = document.scrollingElement;
    if (
      window.scrollX !== 0 ||
      window.scrollY !== 0 ||
      (scrolling &&
        (scrolling.scrollWidth > innerWidth + 1 ||
          scrolling.scrollHeight > innerHeight + 1))
    )
      throw new NativeSourceError(
        "scene-scroll-unsupported",
        "A scrolling document needs a scroll-aware native scene presentation.",
      );
    const bodyStyle = getComputedStyle(body);
    const rootStyle = getComputedStyle(document.documentElement);
    for (const style of [rootStyle, bodyStyle])
      if (
        style.backgroundImage !== "none" ||
        solidBackgroundAlpha(style.backgroundColor) === null
      )
        throw new NativeSourceError(
          "scene-background-unsupported",
          "A translucent or image root background needs a single captured presentation layer.",
        );
    if (
      bodyStyle.transform !== "none" ||
      bodyStyle.translate !== "none" ||
      bodyStyle.rotate !== "none" ||
      bodyStyle.scale !== "none" ||
      bodyStyle.opacity !== "1"
    )
      throw new NativeSourceError(
        "scene-presentation-transform-unsupported",
        "A transformed or translucent body needs a viewport presentation transform.",
      );
    const dpr =
      this.compositionPixelRatio ?? this.previewStatus().effectivePixelRatio;
    const width = Math.ceil(innerWidth * dpr);
    const height = Math.ceil(innerHeight * dpr);
    if (
      width <= 0 ||
      height <= 0 ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION ||
      width * height > MAX_PIXELS
    )
      throw new NativeSourceError(
        "scene-presentation-limit",
        "The full-scene presentation exceeds the native canvas budget.",
      );
    let scene = this.scenePresentation;
    if (
      scene &&
      (scene.epoch !== this.deviceEpoch ||
        scene.surface.width !== width ||
        scene.surface.height !== height)
    ) {
      this.releaseScenePresentation();
      scene = null;
    }
    if (!scene) {
      if (
        this.estimatedResourceBytes() + width * height * 8 >
        MAX_REALM_TEXTURE_BYTES
      )
        throw new NativeSourceError(
          "gpu-budget-exceeded",
          "The full-scene native canvas exceeds the GPU budget.",
        );
      const canvas = document.createElement("canvas");
      this.sceneCanvasIdentities.add(canvas);
      canvas.setAttribute("data-an-native-scene-presentation", "");
      canvas.setAttribute("data-an-native-presentation", "");
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText =
        "position:fixed;left:0;top:0;pointer-events:none;visibility:hidden;z-index:0;max-width:none;max-height:none;";
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
      canvas.width = width;
      canvas.height = height;
      body.prepend(canvas);
      const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!context) {
        canvas.remove();
        throw new NativeSourceError(
          "scene-presentation-unavailable",
          "A native scene presentation canvas is unavailable.",
        );
      }
      try {
        context.configure({
          device: this.device,
          format: this.format,
          alphaMode: "premultiplied",
          colorSpace: this.colorPresented,
          ...(this.dynamicRangePresented === "hdr"
            ? { toneMapping: { mode: "extended" as const } }
            : {}),
        });
      } catch (error) {
        canvas.remove();
        throw new NativeSourceError(
          "scene-presentation-unavailable",
          `The native scene canvas could not be configured: ${String(error)}.`,
        );
      }
      const provider = createNativeSceneProvider(
        document.documentElement,
        "layer",
        this.requestSourceFrame,
      );
      if (!provider) {
        context.unconfigure();
        canvas.remove();
        throw new NativeSourceError(
          "scene-source-unavailable",
          "The authored full scene cannot be captured.",
        );
      }
      scene = {
        canvas,
        context,
        provider,
        surface: {
          target: document.documentElement,
          width,
          height,
          pixelRatio: dpr,
          resourceTextures: new Map(),
          statelessBuffers: new Set(),
          statelessInputs: new Map(),
          isolationTextures: new Map(),
          drawBindings: new Map(),
          sourceTextures: new Map(),
          imageRasters: 0,
          sourceDownsamples: 0,
        },
        suppressedElements: new Set(),
        committedInstances: new Set(),
        onViewportChange: () => {
          if (this.scenePresentation !== scene) return;
          this.releaseScenePresentation();
          for (const mounted of this.mounts.values()) {
            if (mounted.instance.placement !== "backdrop") continue;
            this.showOriginal(mounted);
            mounted.target.setAttribute("data-an-native-status", "error");
            mounted.target.setAttribute(
              "data-an-native-error",
              "scene-viewport-changed",
            );
            mounted.target.setAttribute(
              "data-an-native-error-message",
              "scene-viewport-changed",
            );
            this.postStatus(
              mounted.instance.id,
              mounted.instance.nodeId,
              "error",
              {
                code: "scene-viewport-changed",
                message: "scene-viewport-changed",
                instanceId: mounted.instance.id,
              },
            );
          }
          this.requestSourceFrame();
        },
        epoch: this.deviceEpoch,
      };
      this.scenePresentation = scene;
      window.addEventListener("scroll", scene.onViewportChange, true);
      window.addEventListener("resize", scene.onViewportChange);
    }
    const viewportMatches = (): boolean => {
      const currentScroll = document.scrollingElement;
      return (
        window.scrollX === 0 &&
        window.scrollY === 0 &&
        Math.ceil(innerWidth * dpr) === width &&
        Math.ceil(innerHeight * dpr) === height &&
        (!currentScroll ||
          (currentScroll.scrollWidth <= innerWidth + 1 &&
            currentScroll.scrollHeight <= innerHeight + 1))
      );
    };
    scene.provider.setDensity(dpr);
    for (const child of scene.suppressedElements) {
      if (child.parentElement !== body) {
        child.removeAttribute("data-an-native-scene-suppressed");
        clearNativeAuthoredOpacityIfUnsuppressed(child);
        scene.suppressedElements.delete(child);
        continue;
      }
      const opacity = readNativeAuthoredPaint(child).opacity;
      child.setAttribute("data-an-native-authored-opacity", String(opacity));
    }
    const authoredEpochBeforeRead = scene.provider.authoredSourceEpoch?.();
    let source: NativeSourceRecord[];
    const sceneSourceStarted = sceneWallPhases ? performance.now() : 0;
    try {
      source = await scene.provider.readScene();
    } catch (error) {
      this.releaseScenePresentation();
      throw error;
    } finally {
      if (sceneWallPhases)
        sceneWallPhases.sourceReadWallMs +=
          performance.now() - sceneSourceStarted;
    }
    const sourceEpoch = scene.provider.sourceEpoch?.();
    const authoredEpochAfterRead = scene.provider.authoredSourceEpoch?.();
    if (
      sourceEpoch === undefined ||
      !Number.isSafeInteger(sourceEpoch) ||
      authoredEpochBeforeRead === undefined ||
      !Number.isSafeInteger(authoredEpochBeforeRead) ||
      authoredEpochAfterRead !== authoredEpochBeforeRead
    ) {
      this.releaseScenePresentation();
      throw new NativeSourceError(
        "scene-source-unavailable",
        "The authored scene revision is unavailable.",
      );
    }
    const expectedBackdropIds = [...this.mounts.values()]
      .filter(
        (mount) =>
          mount.instance.placement === "backdrop" &&
          mount.isTopLayer &&
          mount.suppressed &&
          !!mount.outputTexture &&
          !this.groupLocalNoncontributing(mount) &&
          nativePresentationVisible(mount.canvas, {
            width: innerWidth,
            height: innerHeight,
          }),
      )
      .map((mount) => mount.instance.id);
    const nativeRecordIds = this.representedNativeInstances(
      new Set(
        source.flatMap((record) =>
          record.nativeInstanceId ? [record.nativeInstanceId] : [],
        ),
      ),
    );
    if (expectedBackdropIds.some((id) => !nativeRecordIds.has(id))) {
      this.releaseScenePresentation();
      throw new NativeSourceError(
        "composition-native-record-missing",
        "The authored scene omitted an expected native backdrop surface.",
      );
    }
    const device = this.device;
    const epoch = this.deviceEpoch;
    device.pushErrorScope("validation");
    let scopeOpen = true;
    try {
      const encoder = device.createCommandEncoder();
      const sceneComposeStarted = sceneWallPhases ? performance.now() : 0;
      const composed = await this.composeScene(
        scene.surface,
        source,
        encoder,
        "source",
        this.colorPresented === "srgb" &&
          this.dynamicRangePresented === "sdr" &&
          source.length > 1
          ? "srgb-css-linear"
          : "linear",
      );
      if (sceneWallPhases)
        sceneWallPhases.composeWallMs +=
          performance.now() - sceneComposeStarted;
      const sceneEncodeStarted = sceneWallPhases ? performance.now() : 0;
      const pipeline =
        this.presentPipeline ??
        (await this.pipeline(presentWgsl(this.colorPresented), this.format));
      this.presentPipeline = pipeline;
      const bind = this.bind(
        scene.surface,
        "scene:present",
        pipeline,
        composed,
        this.white!,
        new Float32Array([width, height, 0, 0, 1, 0, 0, 0]),
      );
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: scene.context.getCurrentTexture().createView(),
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
      if (
        this.device !== device ||
        this.deviceEpoch !== epoch ||
        this.scenePresentation !== scene ||
        this.disposed ||
        !viewportMatches() ||
        scene.provider.sourceEpoch?.() !== sourceEpoch
      )
        throw new NativeSourceError(
          "scene-generation-changed",
          "The native scene changed before presentation.",
        );
      if (sceneWallPhases)
        sceneWallPhases.encodeWallMs += performance.now() - sceneEncodeStarted;
      const sceneSubmitStarted = sceneWallPhases ? performance.now() : 0;
      device.queue.submit([encoder.finish()]);
      if (sceneWallPhases)
        sceneWallPhases.submitWallMs += performance.now() - sceneSubmitStarted;
      const sceneErrorScopeStarted = sceneWallPhases ? performance.now() : 0;
      const gpuError = await device.popErrorScope();
      if (sceneWallPhases)
        sceneWallPhases.errorScopeWallMs +=
          performance.now() - sceneErrorScopeStarted;
      scopeOpen = false;
      if (gpuError)
        throw new NativeSourceError("gpu-validation", gpuError.message);
      if (
        this.device !== device ||
        this.deviceEpoch !== epoch ||
        this.scenePresentation !== scene ||
        this.disposed ||
        !viewportMatches() ||
        scene.provider.sourceEpoch?.() !== sourceEpoch
      )
        throw new NativeSourceError(
          "scene-generation-changed",
          "The native scene changed during presentation.",
        );
      const scenePublicationStarted = sceneWallPhases ? performance.now() : 0;
      for (const [key, entry] of scene.surface.isolationTextures)
        if (entry.lastFrame !== this.renderEpoch) {
          scene.surface.isolationTextures.delete(key);
          this.textureRetirement.push(entry.texture);
        }
      const backdropCanvases = new Set<HTMLElement>(
        [...this.mounts.values()]
          .filter((mount) => mount.instance.placement === "backdrop")
          .map((mount) => mount.canvas),
      );
      const paintedChildren = new Set<Element>();
      for (const record of source) {
        const nativeTarget = record.nativeInstanceId
          ? this.mounts.get(record.nativeInstanceId)?.target
          : undefined;
        for (let child of nativeTarget
          ? [record.node, nativeTarget]
          : [record.node]) {
          while (child.parentElement && child.parentElement !== body)
            child = child.parentElement;
          if (child.parentElement === body) paintedChildren.add(child);
        }
      }
      for (const child of scene.suppressedElements) {
        if (paintedChildren.has(child)) continue;
        child.removeAttribute("data-an-native-scene-suppressed");
        clearNativeAuthoredOpacityIfUnsuppressed(child);
        scene.suppressedElements.delete(child);
      }
      for (const child of body.children) {
        if (!(child instanceof HTMLElement) || child === scene.canvas) continue;
        if (!paintedChildren.has(child)) continue;
        if (backdropCanvases.has(child)) continue;
        if (
          child.matches(
            "[data-agent-native-edit-overlay],[data-agent-native-editor-chrome],[data-agent-native-editor-chrome-host]",
          )
        )
          continue;
        if (!child.hasAttribute("data-an-native-authored-opacity")) {
          const opacity = Number(getComputedStyle(child).opacity);
          if (!Number.isFinite(opacity))
            throw new NativeSourceError(
              "scene-opacity-unreadable",
              "An authored scene opacity is unreadable.",
            );
          child.setAttribute(
            "data-an-native-authored-opacity",
            String(opacity),
          );
        }
        child.setAttribute("data-an-native-scene-suppressed", "");
        scene.suppressedElements.add(child);
      }
      const committedInstances = new Set(nativeRecordIds);
      const visitCommittedInputs = (instanceId: string): void => {
        const mounted = this.mounts.get(instanceId);
        if (!mounted) return;
        for (const previousId of [
          mounted.previousLayerId,
          mounted.previousFillId,
        ]) {
          if (!previousId || committedInstances.has(previousId)) continue;
          const previous = this.mounts.get(previousId);
          if (!previous?.outputTexture) continue;
          committedInstances.add(previousId);
          visitCommittedInputs(previousId);
        }
      };
      for (const id of nativeRecordIds) visitCommittedInputs(id);
      scene.committedInstances = committedInstances;
      scene.canvas.style.visibility = "visible";
      if (sceneWallPhases)
        sceneWallPhases.publicationWallMs +=
          performance.now() - scenePublicationStarted;
    } catch (error) {
      if (scopeOpen) {
        try {
          await device.popErrorScope();
        } catch {
          /* preserve original error */
        }
      }
      this.releaseScenePresentation();
      throw error;
    }
  }

  private profileStats(samples: number[]): NativeProfileStats {
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = (value: number): number =>
      sorted.length
        ? Number(
            sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)].toFixed(
              2,
            ),
          )
        : 0;
    return {
      count: sorted.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: percentile(1),
    };
  }

  profile = (options?: {
    instanceId: string;
  }): {
    gpuTargetInstanceId?: string;
    gpuScope?: "target-mount-command-encoder-not-full-scene";
    renderWallMs: NativeProfileStats;
    rafIntervalMs: NativeProfileStats;
    gpu: ReturnType<NativeGpuScopeProfiler["latestResult"]>;
    textures: ReturnType<NativeShaderRuntime["textureAccounting"]>;
    sources: {
      mounts: Array<{
        id: string;
        placement: EffectInstance["placement"];
        diagnostic: ReturnType<NativeSceneProvider["diagnosticSnapshot"]>;
      }>;
      omittedMounts: number;
    };
  } => ({
    renderWallMs: this.profileStats(this.renderWallSamples),
    rafIntervalMs: this.profileStats(this.rafIntervalSamples),
    ...(options
      ? {
          gpuTargetInstanceId: options.instanceId,
          gpuScope: "target-mount-command-encoder-not-full-scene" as const,
        }
      : {}),
    gpu: this.targetGpuProfile(options?.instanceId) ?? {
      kind: "unavailable",
      code: "timestamp-query-unavailable",
    },
    textures: this.textureAccounting(),
    sources: (() => {
      const providers = [...this.mounts.values()].filter(
        (mount) => mount.provider,
      );
      return {
        mounts: providers.slice(0, 8).map((mount) => ({
          id: mount.instance.id,
          placement: mount.instance.placement,
          diagnostic: mount.provider!.diagnosticSnapshot(),
        })),
        omittedMounts: Math.max(0, providers.length - 8),
      };
    })(),
  });

  private targetGpuIdentity(instanceId: string): {
    mount: Mount;
    definition: string;
    instance: string;
  } | null {
    const mount = this.mounts.get(instanceId);
    if (!mount) return null;
    const draft =
      this.draft?.instanceId === instanceId && this.draft.showDraft
        ? this.draft
        : null;
    const instance =
      draft?.instance ??
      (this.instancePreview?.instanceId === instanceId
        ? this.instancePreview.instance
        : mount.instance);
    return {
      mount,
      definition: draft?.executionHash ?? mount.definitionHash,
      instance: JSON.stringify(instance),
    };
  }

  private targetGpuProfile(
    instanceId?: string,
  ): ReturnType<NativeGpuScopeProfiler["latestResult"]> | undefined {
    if (instanceId === undefined) return this.gpuProfiler?.latestResult();
    const target = this.targetGpuIdentity(instanceId);
    if (!target) return { kind: "unavailable", code: "target-unavailable" };
    return this.gpuProfiler?.latestResult(
      target.mount,
      target.definition,
      target.instance,
    );
  }

  private mountedBenchmarkVisibility(): "visible" | "hidden" | "offscreen" {
    if (document.visibilityState !== "visible") return "hidden";
    const frame = window.frameElement;
    if (
      !frame ||
      !frame.isConnected ||
      typeof frame.getBoundingClientRect !== "function"
    )
      return "offscreen";
    const rect = frame.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.right <= 0 ||
      rect.bottom <= 0 ||
      rect.left >= window.parent.innerWidth ||
      rect.top >= window.parent.innerHeight
    )
      return "offscreen";
    return "visible";
  }

  private assertMountedMeasurementSource(
    target: Mount | undefined,
    executionHash: string,
  ): void {
    this.assertCompositionIdle();
    if (
      this.draft?.showDraft ||
      this.instancePreview ||
      this.draftRequestPending ||
      this.instancePreviewPending ||
      this.previewRestoreWork
    )
      throw new NativeMountedBenchmarkError("benchmark-unpersisted-preview");
    if (target && target.definitionHash !== executionHash)
      throw new NativeMountedBenchmarkError("benchmark-source-stale");
  }

  measureMountedScene = async (options: {
    instanceId: string;
    executionHash: string;
    request: NativeMountedBenchmarkRequest;
    signal: AbortSignal;
  }): Promise<
    NativeMountedBenchmarkWindow & {
      scope: "live-mounted-scene";
      sourceCaptureDelta: number;
      gpuScope: "target-mount-command-encoder-not-full-scene";
      gpuTargetInstanceId: string;
      gpuAfterFrameIndex: number;
      gpuThroughFrameIndex: number;
      gpuWindow: NativeGpuSampleWindow;
    }
  > => {
    if (this.mountedBenchmark)
      throw new NativeMountedBenchmarkError("benchmark-busy");
    const target = this.mounts.get(options.instanceId);
    const executionHash = options.executionHash;
    this.assertMountedMeasurementSource(target, executionHash);
    if (
      !target ||
      !this.playing ||
      !this.device ||
      !this.mounts.size ||
      [...this.mounts.values()].some(
        (mount) =>
          mount.target.getAttribute("data-an-native-status") !== "ready",
      )
    )
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    const visibility = this.mountedBenchmarkVisibility();
    if (visibility !== "visible")
      throw new NativeMountedBenchmarkError(
        visibility === "hidden" ? "benchmark-hidden" : "benchmark-offscreen",
      );
    const captures = () =>
      [...this.mounts.values()].reduce(
        (sum, mount) => sum + (mount.provider?.captureCount() ?? 0),
        0,
      );
    let measuredCaptureStart: number | null = null;
    let gpuAfterFrameIndex: number | null = null;
    const measuredGpuProfiler = this.gpuProfiler;
    const gpuIdentity = this.targetGpuIdentity(options.instanceId);
    if (!measuredGpuProfiler || !gpuIdentity)
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    const deviceAtStart = this.device;
    const deviceEpochAtStart = this.deviceEpoch;
    const draftGenerationAtStart = this.draftGeneration;
    const instancePreviewGenerationAtStart = this.instancePreviewGeneration;
    const assertSavedSource = () => {
      this.assertMountedMeasurementSource(target, executionHash);
      if (
        this.draftGeneration !== draftGenerationAtStart ||
        this.instancePreviewGeneration !== instancePreviewGenerationAtStart
      )
        throw new NativeMountedBenchmarkError("benchmark-unpersisted-preview");
    };
    const gpuWindowToken = measuredGpuProfiler.beginWindow(
      gpuIdentity.mount,
      gpuIdentity.definition,
      gpuIdentity.instance,
      options.instanceId,
    );
    let gpuWindow: NativeGpuSampleWindow | null = null;
    const mountedAtStart = new Map(this.mounts);
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible")
        this.mountedBenchmark?.fail(
          new NativeMountedBenchmarkError("benchmark-hidden"),
        );
    };
    let run: NativeMountedBenchmarkRun;
    try {
      run = new NativeMountedBenchmarkRun(
        options.request,
        options.signal,
        40_000,
        () => {
          assertSavedSource();
          measuredCaptureStart = captures();
          gpuAfterFrameIndex =
            measuredGpuProfiler.startWindowMeasurement(gpuWindowToken);
        },
        () => {
          assertSavedSource();
          gpuWindow = measuredGpuProfiler.endWindow(gpuWindowToken);
        },
      );
    } catch (error) {
      measuredGpuProfiler.cancelWindow(gpuWindowToken);
      throw error;
    }
    this.mountedBenchmark = run;
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
    try {
      const windowResult = await run.done;
      assertSavedSource();
      const currentGpuIdentity = this.targetGpuIdentity(options.instanceId);
      if (
        this.gpuProfiler !== measuredGpuProfiler ||
        this.device !== deviceAtStart ||
        this.deviceEpoch !== deviceEpochAtStart ||
        currentGpuIdentity?.mount !== gpuIdentity.mount ||
        currentGpuIdentity.definition !== gpuIdentity.definition ||
        currentGpuIdentity.instance !== gpuIdentity.instance ||
        this.mounts.get(options.instanceId) !== target ||
        this.disposed ||
        mountedAtStart.size !== this.mounts.size ||
        [...mountedAtStart].some(([id, mount]) => this.mounts.get(id) !== mount)
      )
        throw new NativeMountedBenchmarkError("benchmark-unavailable");
      const finishedGpuWindow = gpuWindow as NativeGpuSampleWindow | null;
      if (
        measuredCaptureStart === null ||
        gpuAfterFrameIndex === null ||
        !finishedGpuWindow
      )
        throw new NativeMountedBenchmarkError("benchmark-unavailable");
      const sourceCaptureDelta = captures() - measuredCaptureStart;
      if (sourceCaptureDelta < 0)
        throw new NativeMountedBenchmarkError("benchmark-unavailable");
      return {
        scope: "live-mounted-scene",
        ...windowResult,
        sourceCaptureDelta,
        gpuScope: "target-mount-command-encoder-not-full-scene",
        gpuTargetInstanceId: options.instanceId,
        gpuAfterFrameIndex,
        gpuThroughFrameIndex: finishedGpuWindow.throughFrameIndex,
        gpuWindow: finishedGpuWindow,
      };
    } finally {
      measuredGpuProfiler.cancelWindow(gpuWindowToken);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (this.mountedBenchmark === run) this.mountedBenchmark = null;
    }
  };

  private textureAccounting(): {
    allocatedBytes: number;
    mountedBytes: number;
    queuedRetirementBytes: number;
    inFlightRetirementBytes: number;
    sharedBytes: number;
    unattributedBytes: number;
    mounts: Array<{
      id: string;
      sourceBytes: number;
      assetBytes: number;
      graphBytes: number;
      isolationBytes: number;
      finalBytes: number;
      maskBytes: number;
    }>;
    omittedMounts: number;
  } {
    const seen = new Set<GPUTexture>();
    const bytes = (
      textures: Iterable<GPUTexture | null | undefined>,
    ): number => {
      let total = 0;
      for (const texture of textures) {
        if (!texture || seen.has(texture)) continue;
        seen.add(texture);
        total += this.textureBytes.get(texture) ?? 0;
      }
      return total;
    };
    const mounts = [...this.mounts.values()].map((mount) => ({
      id: mount.instance.id,
      sourceBytes: bytes(
        [...mount.sourceTextures.values()].map((entry) => entry.texture),
      ),
      assetBytes: bytes(
        [...mount.assetTextures.values()].map((entry) => entry.texture),
      ),
      graphBytes: bytes([
        ...mount.resourceTextures.values(),
        ...(mount.feedback?.textures ?? []),
      ]),
      isolationBytes: bytes(
        [...mount.isolationTextures.values()].map((entry) => entry.texture),
      ),
      finalBytes: bytes([mount.outputTexture]),
      maskBytes: bytes([mount.maskTexture]),
    }));
    const mountedBytes = mounts.reduce(
      (sum, mount) =>
        sum +
        mount.sourceBytes +
        mount.assetBytes +
        mount.graphBytes +
        mount.isolationBytes +
        mount.finalBytes +
        mount.maskBytes,
      0,
    );
    const queuedRetirementBytes = bytes(this.textureRetirement);
    const inFlightRetirementBytes = bytes(this.retirementInFlightTextures);
    const sharedBytes = bytes([this.transparent, this.white]);
    return {
      allocatedBytes: this.allocatedTextureBytes,
      mountedBytes,
      queuedRetirementBytes,
      inFlightRetirementBytes,
      sharedBytes,
      unattributedBytes:
        this.allocatedTextureBytes -
        mountedBytes -
        queuedRetirementBytes -
        inFlightRetirementBytes -
        sharedBytes,
      mounts: mounts.slice(0, 16),
      omittedMounts: Math.max(0, mounts.length - 16),
    };
  }

  private gpuTimestampWrites(
    encoder: GPUCommandEncoder,
    label: string,
  ): { timestampWrites?: GPURenderPassTimestampWrites } {
    const sample = this.gpuSamples.get(encoder);
    if (!sample || !this.gpuProfiler) return {};
    const reservation = this.gpuProfiler.timestampWritesForPass(sample, label);
    return reservation.kind === "pass"
      ? { timestampWrites: reservation.timestampWrites }
      : {};
  }

  private beginGpuSample(
    encoder: GPUCommandEncoder,
    mount: Mount,
    deterministic: boolean,
    definitionRevision: string,
    instance: EffectInstance,
  ): NativeGpuScopedSample | null {
    if (deterministic || !this.gpuProfiler) return null;
    const reservation = this.gpuProfiler.beginSample(
      mount,
      definitionRevision,
      JSON.stringify(instance),
      mount.instance.id,
    );
    if (reservation.kind !== "sample") return null;
    this.gpuSamples.set(encoder, reservation.sample);
    return reservation.sample;
  }

  previewStatus = (): NativePreviewStatus => {
    const status = this.previewPolicy.status(
      devicePixelRatio || 1,
      this.renderWallSamples[this.renderWallSamples.length - 1],
      this.rafIntervalSamples[this.rafIntervalSamples.length - 1],
    );
    return this.exportInitialPixelRatio === null
      ? status
      : { ...status, effectivePixelRatio: this.exportInitialPixelRatio };
  };

  private updatePreviewAttributes(): void {
    const status = this.previewStatus();
    const root = document.documentElement;
    for (const [name, value] of [
      ["data-an-native-preview-quality", status.requestedQuality],
      ["data-an-native-preview-target-fps", String(status.frameRateTarget)],
      [
        "data-an-native-preview-pixel-ratio",
        String(Number(status.effectivePixelRatio.toFixed(3))),
      ],
    ])
      if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }

  private recordProfile(samples: number[], value: number): void {
    samples.push(value);
    if (samples.length > 120) samples.shift();
  }

  private issue(
    code: string,
    message: string,
    instanceId?: string,
    passId?: string,
  ): void {
    if (
      this.issues.some(
        (item) =>
          item.code === code &&
          item.instanceId === instanceId &&
          item.passId === passId &&
          item.message === message,
      )
    )
      return;
    this.issues.push({ code, message, instanceId, passId });
    if (this.issues.length > 80) this.issues.shift();
  }

  private postStatus(
    instanceId: string,
    nodeId: string,
    status: NativeStatus,
    diagnostic?: Diagnostic,
    requestId?: string,
    force = false,
  ): void {
    const mount = this.mounts.get(instanceId);
    const reportedDiagnostic =
      diagnostic &&
      (diagnostic.code.startsWith("scene-") ||
        diagnostic.code.startsWith("backdrop-"))
        ? { ...diagnostic, message: diagnostic.code }
        : diagnostic;
    if (mount && !force)
      mount.reportedStatus = { status, diagnostic: reportedDiagnostic };
    const playback =
      status === "ready" ? mount?.feedback?.executor.playbackStatus : null;
    const signature = `${status}:${reportedDiagnostic?.code ?? ""}:${reportedDiagnostic?.message ?? ""}:${playback?.disposition ?? ""}`;
    const now = performance.now();
    const previous = this.sentStatus.get(instanceId);
    if (!force && previous?.signature === signature && now - previous.at < 1000)
      return;
    const payload = {
      type: "native-shader-status",
      schemaVersion: 1,
      runtimeEpoch: this.epoch,
      instanceId: instanceId.slice(0, 128),
      nodeId: nodeId.slice(0, 128),
      status,
      backend:
        status !== "unavailable" && this.device ? "webgpu" : "unavailable",
      ...(reportedDiagnostic
        ? {
            code: reportedDiagnostic.code.slice(0, 80),
            message: reportedDiagnostic.message.slice(0, 300),
          }
        : {}),
      ...(requestId ? { requestId: requestId.slice(0, 80) } : {}),
      ...(playback ? { playback } : {}),
      frames: mount?.frameCount ?? 0,
      sourceCaptures: mount?.provider?.captureCount() ?? 0,
      estimatedResourceBytes: this.estimatedResourceBytes(),
      ...(mount && mount.renderWallSamples.length
        ? {
            renderWallMs:
              mount.renderWallSamples[mount.renderWallSamples.length - 1],
          }
        : {}),
    };
    window.dispatchEvent(
      new CustomEvent("native-shader-status", { detail: payload }),
    );
    this.sentStatus.set(instanceId, { signature, at: now });
    if (this.sentStatus.size > 512)
      this.sentStatus.delete(this.sentStatus.keys().next().value!);
    if (window.parent !== window)
      try {
        window.parent.postMessage(payload, nativeDocumentOrigin());
      } catch (error) {
        this.issue("status-post-failed", String(error), instanceId);
      }
  }

  private emitCurrentStatus(
    instanceId: string,
    nodeId: string,
    requestId?: string,
  ): void {
    const mount = this.mounts.get(instanceId);
    if (mount?.instance.nodeId === nodeId) {
      const diagnostic = mount.frozenReason ?? mount.reportedStatus?.diagnostic;
      const status: NativeStatus = mount.frozenReason
        ? mount.outputTexture
          ? "last-good"
          : "error"
        : (mount.reportedStatus?.status ??
          (mount.outputTexture && mount.suppressed ? "ready" : "unavailable"));
      this.postStatus(
        instanceId,
        nodeId,
        status,
        diagnostic ??
          (status === "unavailable"
            ? { code: "render-pending", message: "render-pending" }
            : undefined),
        requestId,
        true,
      );
      return;
    }
    const rejected = this.rejectedById.get(instanceId);
    const diagnostic =
      rejected?.nodeId === nodeId
        ? rejected
        : this.scanFailures.find((issue) => !issue.instanceId);
    this.postStatus(
      instanceId,
      nodeId,
      diagnostic ? "error" : "unavailable",
      diagnostic ?? {
        code: "instance-not-mounted",
        message: "instance-not-mounted",
      },
      requestId,
      true,
    );
  }

  private markMountRenderPending(mount: Mount): void {
    const present = mount.outputTexture !== null && mount.suppressed;
    this.postStatus(
      mount.instance.id,
      mount.instance.nodeId,
      present ? "last-good" : "unavailable",
      {
        code: "render-pending",
        message: "render-pending",
        instanceId: mount.instance.id,
      },
    );
  }

  requestStatusSnapshot = (): void => {
    for (const mount of this.mounts.values())
      this.emitCurrentStatus(mount.instance.id, mount.instance.nodeId);
    for (const [instanceId, diagnostic] of this.rejectedById)
      if (!this.mounts.has(instanceId))
        this.emitCurrentStatus(instanceId, diagnostic.nodeId);
  };

  private async initializeDevice(
    scope: NativeDeviceScope,
  ): Promise<NativeDeviceResources> {
    if (!scope.active || this.disposed)
      throw new NativeDeviceLifecycleError("device-disposed");
    const gpu = navigator.gpu;
    if (!gpu)
      throw new NativeSourceError(
        "webgpu-unavailable",
        "WebGPU is unavailable in this browser.",
      );
    let adapter: GPUAdapter | null;
    try {
      adapter = await gpu.requestAdapter();
    } catch (error) {
      if (!scope.active)
        throw new NativeDeviceLifecycleError("device-disposed");
      throw new NativeSourceError(
        "webgpu-adapter-refused",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!scope.active || this.disposed)
      throw new NativeDeviceLifecycleError("device-disposed");
    if (!adapter)
      throw new NativeSourceError(
        "webgpu-adapter-unavailable",
        "No WebGPU adapter is available.",
      );
    let device: GPUDevice;
    const optionalFeatures = nativeGpuTimestampFeature(adapter);
    try {
      device = await adapter.requestDevice(
        optionalFeatures.length ? { requiredFeatures: optionalFeatures } : {},
      );
    } catch (error) {
      if (!scope.active)
        throw new NativeDeviceLifecycleError("device-disposed");
      if (!optionalFeatures.length)
        throw new NativeSourceError(
          "webgpu-device-refused",
          error instanceof Error ? error.message : String(error),
        );
      this.issue("timestamp-query-device-refused", String(error));
      try {
        device = await adapter.requestDevice();
      } catch (fallbackError) {
        if (!scope.active)
          throw new NativeDeviceLifecycleError("device-disposed");
        throw new NativeSourceError(
          "webgpu-device-refused",
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
        );
      }
    }
    scope.own(() => this.destroyDevice(device));
    if (!scope.active || this.disposed)
      throw new NativeDeviceLifecycleError("device-disposed");
    let format = gpu.getPreferredCanvasFormat();
    const sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    const solid = (bytes: Uint8Array): GPUTexture => {
      const texture = device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      scope.own(() => this.destroyTexture(texture));
      device.queue.writeTexture({ texture }, bytes, { bytesPerRow: 4 }, [1, 1]);
      return texture;
    };
    const transparent = solid(EMPTY_SOURCE);
    const white = solid(WHITE_SOURCE);
    let canvasToneMappingStandard: NativeColorCapability["canvasToneMappingStandard"] =
      "unreadable";
    const toneMappingProbe = document
      .createElement("canvas")
      .getContext("webgpu") as GPUCanvasContext | null;
    if (toneMappingProbe) {
      try {
        toneMappingProbe.configure({
          device,
          format,
          alphaMode: "premultiplied",
          toneMapping: { mode: "standard" },
        });
        canvasToneMappingStandard =
          toneMappingProbe.getConfiguration()?.toneMapping?.mode === "standard"
            ? "observed"
            : "member-not-observed";
      } catch {
        canvasToneMappingStandard = "unreadable";
      }
      try {
        toneMappingProbe.unconfigure();
      } catch {
        canvasToneMappingStandard = "unreadable";
      }
    }
    let colorMode: NativeColorMode = "srgb";
    let colorReason: NativeColorCapability["reason"];
    if (this.colorRequested === "display-p3") {
      const probe = document
        .createElement("canvas")
        .getContext("webgpu") as GPUCanvasContext | null;
      if (!probe) colorReason = "p3-canvas-unavailable";
      else {
        try {
          probe.configure({
            device,
            format,
            alphaMode: "premultiplied",
            colorSpace: "display-p3",
          });
          if (probe.getConfiguration()?.colorSpace === "display-p3")
            colorMode = "display-p3";
          else colorReason = "p3-canvas-unavailable";
        } catch {
          colorReason = "p3-canvas-unavailable";
        } finally {
          probe.unconfigure();
        }
      }
    }
    let dynamicRangeMode: NativeDynamicRangeMode = "sdr";
    let dynamicRangeReason: NativeColorCapability["dynamicRangeReason"];
    if (this.dynamicRangeRequested === "hdr") {
      const displayCapability = detectNativeDisplayDynamicRange(
        typeof window.matchMedia === "function"
          ? (media) => window.matchMedia(media).matches
          : undefined,
      );
      if (displayCapability !== "high-capable")
        dynamicRangeReason =
          displayCapability === "standard-only"
            ? "display-not-high-capable"
            : "display-capability-unreadable";
      else {
        const floatProbe = document
          .createElement("canvas")
          .getContext("webgpu") as GPUCanvasContext | null;
        let floatSupported = false;
        if (floatProbe) {
          try {
            floatProbe.configure({
              device,
              format: "rgba16float",
              alphaMode: "premultiplied",
              colorSpace: colorMode,
            });
            floatSupported =
              floatProbe.getConfiguration()?.format === "rgba16float";
          } catch {
            floatSupported = false;
          } finally {
            try {
              floatProbe.unconfigure();
            } catch {
              floatSupported = false;
            }
          }
        }
        if (!floatSupported) dynamicRangeReason = "float-canvas-unavailable";
        else {
          const extendedProbe = document
            .createElement("canvas")
            .getContext("webgpu") as GPUCanvasContext | null;
          if (!extendedProbe)
            dynamicRangeReason = "extended-tone-mapping-unavailable";
          else {
            try {
              extendedProbe.configure({
                device,
                format: "rgba16float",
                alphaMode: "premultiplied",
                colorSpace: colorMode,
                toneMapping: { mode: "extended" },
              });
              const configured = extendedProbe.getConfiguration();
              if (
                configured?.format !== "rgba16float" ||
                configured.toneMapping?.mode !== "extended"
              )
                dynamicRangeReason = "extended-tone-mapping-unavailable";
              else {
                dynamicRangeMode = "hdr";
                format = "rgba16float";
                if (
                  colorMode === "display-p3" &&
                  configured.colorSpace !== "display-p3"
                ) {
                  colorMode = "srgb";
                  colorReason = "p3-canvas-unavailable";
                }
              }
            } catch {
              dynamicRangeReason = "extended-tone-mapping-unavailable";
            } finally {
              try {
                extendedProbe.unconfigure();
              } catch {
                dynamicRangeMode = "sdr";
                dynamicRangeReason = "extended-tone-mapping-unavailable";
                format = gpu.getPreferredCanvasFormat();
              }
            }
          }
        }
      }
    }
    for (const mount of this.mounts.values()) {
      if (!scope.active || this.disposed)
        throw new NativeDeviceLifecycleError("device-disposed");
      const ownedContext = mount.context;
      scope.own(() => {
        const contexts = new Set([
          ownedContext,
          ...(mount.presentationPair
            ?.surfaces()
            .map((surface) => surface.context) ?? []),
        ]);
        for (const context of contexts) {
          if (this.contextOwners.get(context) !== device) continue;
          context.unconfigure();
          this.contextOwners.delete(context);
        }
      });
      this.contextOwners.set(mount.context, device);
      mount.context.configure({
        device,
        format,
        alphaMode: "premultiplied",
        colorSpace: colorMode,
        ...(dynamicRangeMode === "hdr"
          ? { toneMapping: { mode: "extended" as const } }
          : {}),
      });
      const configured = mount.context.getConfiguration();
      if (
        dynamicRangeMode === "hdr" &&
        (configured?.format !== "rgba16float" ||
          configured.toneMapping?.mode !== "extended")
      )
        throw new NativeSourceError(
          "hdr-canvas-unavailable",
          "hdr-canvas-unavailable",
        );
    }
    return {
      device,
      format,
      colorMode,
      colorReason,
      dynamicRangeMode,
      dynamicRangeReason,
      canvasToneMappingStandard,
      sampler,
      transparent,
      white,
    };
  }

  private clearDeviceResources(code: string, message: string): void {
    this.releaseScenePresentation();
    this.presentationMirrorCapture = false;
    this.publishedPresentationMirror.clear();
    this.gpuProfiler?.dispose(
      code === "device-lost" ? "device-lost" : "disposed",
    );
    this.gpuProfiler = null;
    if (this.simulationExportSession) {
      this.simulationExportSession.failed = true;
      this.releaseSimulationExportSaved(this.simulationExportSession);
    }
    for (const mount of this.mounts.values()) {
      this.showOriginal(mount);
      mount.target.setAttribute("data-an-native-status", "error");
      mount.target.setAttribute("data-an-native-error", code);
      mount.target.setAttribute(
        "data-an-native-error-message",
        message.slice(0, 300),
      );
      this.releaseMountTextures(mount);
      for (const binding of mount.drawBindings.values())
        this.destroyUniform(binding.buffer);
      mount.drawBindings.clear();
      mount.width = 0;
      mount.height = 0;
    }
    this.destroyTexture(this.transparent);
    this.destroyTexture(this.white);
    this.transparent = null;
    this.white = null;
    this.sampler = null;
    this.sourceSizingSamplers.clear();
    this.device = null;
    this.colorPresented = "srgb";
    this.colorReason = "gpu-unavailable";
    this.dynamicRangePresented = "sdr";
    this.dynamicRangeReason =
      this.dynamicRangeRequested === "hdr" ? "gpu-unavailable" : undefined;
    this.canvasToneMappingStandard = "unreadable";
    this.workingFormat = "rgba16float";
    this.publishColorCapability();
    this.pipelines.reset();
    this.simulationComputePipelines.reset();
    this.statelessPipelines.reset();
    this.simulationRenderPipelines.reset();
    this.simulationLayout = null;
    this.simulationPipelineLayout = null;
    this.compositePipeline = null;
    this.fillCompositePipeline = null;
    this.fillTextPipeline = null;
    this.presentPipeline = null;
    this.finishPipeline = null;
    this.effectLayout = null;
    this.effectPipelineLayout = null;
    for (const buffer of this.retirement.splice(0)) this.destroyUniform(buffer);
    for (const texture of this.textureRetirement.splice(0))
      this.destroyTexture(texture);
    for (const mount of this.mounts.values())
      this.postStatus(mount.instance.id, mount.instance.nodeId, "error", {
        code,
        message,
        instanceId: mount.instance.id,
      });
  }

  private async ensureDevice(): Promise<GPUDevice> {
    if (this.device) return this.device;
    const resources = await this.deviceLifecycle.acquire();
    if (this.disposed) throw new NativeDeviceLifecycleError("device-disposed");
    if (!this.device) {
      this.device = resources.device;
      this.gpuProfiler = new NativeGpuScopeProfiler(resources.device);
      this.deviceEpoch += 1;
      this.format = resources.format;
      this.colorPresented = resources.colorMode;
      this.colorReason = resources.colorReason;
      this.dynamicRangePresented = resources.dynamicRangeMode;
      this.dynamicRangeReason = resources.dynamicRangeReason;
      this.canvasToneMappingStandard = resources.canvasToneMappingStandard;
      this.workingFormat = "rgba16float";
      this.publishColorCapability();
      this.sampler = resources.sampler;
      this.transparent = resources.transparent;
      this.white = resources.white;
      this.textureBytes.set(resources.transparent, 4);
      this.textureBytes.set(resources.white, 4);
      this.allocatedTextureBytes += 8;
      resources.device.lost.then((reason) => {
        if (this.disposed || this.device !== resources.device) return;
        const message = reason.message || "The WebGPU device was lost.";
        this.issue("device-lost", message);
        this.clearDeviceResources("device-lost", message);
        try {
          this.deviceLifecycle.lost(resources);
        } catch (error) {
          this.issue("device-cleanup-failed", String(error));
        }
        if (this.playing && this.mounts.size) {
          this.rafIntervalTelemetry.reset();
          cancelAnimationFrame(this.raf);
          this.raf = 0;
          this.scheduleDeviceRetry();
        }
      });
    }
    return resources.device;
  }

  private scheduleDeviceRetry(): void {
    if (this.disposed || !this.playing || this.deviceRetryTimer) return;
    if (this.deviceLifecycle.exhausted()) return;
    this.deviceRetryTimer = window.setTimeout(
      () => {
        this.deviceRetryTimer = 0;
        if (this.disposed || !this.playing) return;
        this.requestScan();
      },
      Math.max(1, this.deviceLifecycle.retryAfterMs()),
    );
  }

  resetDevice = async (): Promise<void> => {
    if (this.compositionDone) {
      this.compositionAbort?.abort(
        new NativeSourceError(
          "composition-aborted",
          "A device reset interrupted full-scene composition.",
        ),
      );
      await this.compositionDone;
    }
    if (!this.device) this.deviceLifecycle.reset();
    if (this.scanning) await this.scanning;
    if (this.previewRestoreWork) await this.previewRestoreWork;
    if (this.running) await this.running;
    this.clearDeviceResources("device-reset", "device-reset");
    this.deviceLifecycle.reset();
    clearTimeout(this.deviceRetryTimer);
    this.deviceRetryTimer = 0;
    await this.scan();
    if (this.scanFailures.length)
      throw new NativeRenderFailure({
        time: this.currentTime(),
        rendered: 0,
        failures: [...this.scanFailures],
        renderWallMs: 0,
      });
  };

  colorCapability = (): NativeColorCapability => {
    const displayDynamicRangeCapability = detectNativeDisplayDynamicRange(
      typeof window.matchMedia === "function"
        ? (media) => window.matchMedia(media).matches
        : undefined,
    );
    const base = {
      requested: this.colorRequested,
      presented: this.colorPresented,
      sourceGamut: "dom-srgb-only" as const,
      displayDynamicRangeCapability,
      canvasToneMappingStandard: this.canvasToneMappingStandard,
      ...(this.colorReason ? { reason: this.colorReason } : {}),
    };
    if (this.dynamicRangeRequested === "sdr")
      return {
        ...base,
        hdr: "unavailable",
        outputDynamicRange: "sdr",
        requestedDynamicRange: "sdr",
        presentedDynamicRange: "sdr",
      };
    if (
      this.dynamicRangePresented === "hdr" &&
      displayDynamicRangeCapability === "high-capable"
    )
      return {
        ...base,
        hdr: "configured",
        outputDynamicRange: "hdr",
        requestedDynamicRange: "hdr",
        presentedDynamicRange: "hdr",
      };
    return {
      ...base,
      hdr: "unavailable",
      outputDynamicRange: "sdr",
      requestedDynamicRange: "hdr",
      presentedDynamicRange: "sdr",
      dynamicRangeReason:
        displayDynamicRangeCapability === "high-capable"
          ? (this.dynamicRangeReason ?? "gpu-unavailable")
          : displayDynamicRangeCapability === "standard-only"
            ? "display-not-high-capable"
            : "display-capability-unreadable",
    };
  };

  private publishColorCapability(): void {
    const root = document.documentElement;
    root.setAttribute("data-an-native-color-requested", this.colorRequested);
    root.setAttribute("data-an-native-color-presented", this.colorPresented);
    root.setAttribute("data-an-native-color-source-gamut", "dom-srgb-only");
    const capability = this.colorCapability();
    root.setAttribute("data-an-native-hdr", capability.hdr);
    root.setAttribute(
      "data-an-native-display-dynamic-range-capability",
      capability.displayDynamicRangeCapability,
    );
    root.setAttribute(
      "data-an-native-canvas-tone-mapping-standard",
      capability.canvasToneMappingStandard,
    );
    root.setAttribute(
      "data-an-native-output-dynamic-range",
      capability.outputDynamicRange,
    );
    root.setAttribute(
      "data-an-native-dynamic-range-requested",
      capability.requestedDynamicRange ?? "sdr",
    );
    root.setAttribute(
      "data-an-native-dynamic-range-presented",
      capability.presentedDynamicRange ?? "sdr",
    );
    if (capability.dynamicRangeReason)
      root.setAttribute(
        "data-an-native-dynamic-range-reason",
        capability.dynamicRangeReason,
      );
    else root.removeAttribute("data-an-native-dynamic-range-reason");
    if (this.colorReason)
      root.setAttribute("data-an-native-color-reason", this.colorReason);
    else root.removeAttribute("data-an-native-color-reason");
  }

  setColorMode = async (
    mode: NativeColorMode,
  ): Promise<NativeColorCapability> => {
    if (mode !== "srgb" && mode !== "display-p3")
      throw new NativeSourceError(
        "color-mode-invalid",
        "The requested output color mode is unsupported.",
      );
    this.assertCompositionIdle();
    if (this.disposed)
      throw new NativeSourceError("runtime-disposed", "runtime-disposed");
    if (mode === this.colorRequested) return this.colorCapability();
    if (mode === "display-p3")
      for (const mount of this.mounts.values())
        if (
          usesDisplayP3Color(mount.definition, mount.instance.params) &&
          !hasFloatColorPath(mount.definition)
        )
          throw new NativeSourceError(
            "color-working-format-unsupported",
            `Effect ${mount.instance.id} needs rgba16float pass outputs to preserve its Display-P3 colors.`,
          );
    const wasPlaying = this.playing;
    this.pause();
    this.colorChanging = true;
    try {
      this.colorRequested = mode;
      await this.resetDevice();
      await this.ensureDevice();
      return this.colorCapability();
    } finally {
      this.colorChanging = false;
      if (wasPlaying && !this.disposed && !this.compositionUnsafe) this.play();
    }
  };

  setDynamicRangeMode = async (
    mode: NativeDynamicRangeMode,
  ): Promise<NativeColorCapability> => {
    if (mode !== "sdr" && mode !== "hdr")
      throw new NativeSourceError(
        "dynamic-range-mode-invalid",
        "dynamic-range-mode-invalid",
      );
    this.assertCompositionIdle();
    if (this.disposed)
      throw new NativeSourceError("runtime-disposed", "runtime-disposed");
    if (
      mode === this.dynamicRangeRequested &&
      (mode === "sdr" || this.colorCapability().presentedDynamicRange === "hdr")
    )
      return this.colorCapability();
    const wasPlaying = this.playing;
    this.pause();
    this.colorChanging = true;
    try {
      this.dynamicRangeRequested = mode;
      await this.resetDevice();
      await this.ensureDevice();
      return this.colorCapability();
    } finally {
      this.colorChanging = false;
      if (wasPlaying && !this.disposed && !this.compositionUnsafe) this.play();
    }
  };

  private texture(
    width: number,
    height: number,
    format: GPUTextureFormat = this.workingFormat,
    extraUsage = 0,
    mipLevelCount = 1,
  ): GPUTexture {
    let bytes = 0;
    let levelWidth = width;
    let levelHeight = height;
    for (let level = 0; level < mipLevelCount; level += 1) {
      bytes += levelWidth * levelHeight * (format === "rgba16float" ? 8 : 4);
      levelWidth = Math.max(1, Math.floor(levelWidth / 2));
      levelHeight = Math.max(1, Math.floor(levelHeight / 2));
    }
    this.ensureTextureBudget(bytes);
    const texture = this.device!.createTexture({
      size: [width, height],
      format,
      mipLevelCount,
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        extraUsage,
    });
    this.textureBytes.set(texture, bytes);
    this.allocatedTextureBytes += bytes;
    return texture;
  }

  private destroyTexture(texture: GPUTexture | null | undefined): void {
    if (!texture || this.destroyedTextures.has(texture)) return;
    if (this.statelessTextureLeases.has(texture)) {
      this.statelessTextureDestruction.add(texture);
      return;
    }
    const bytes = this.textureBytes.get(texture);
    if (bytes !== undefined) {
      this.allocatedTextureBytes -= bytes;
      this.textureBytes.delete(texture);
    }
    this.destroyedTextures.add(texture);
    texture.destroy();
  }

  private destroyDevice(device: GPUDevice): void {
    if (this.statelessDeviceLeases.has(device)) {
      this.statelessDeviceDestruction.add(device);
      return;
    }
    device.destroy();
  }

  private retainStatelessTextures(
    device: GPUDevice,
    textures: Set<GPUTexture>,
  ): () => void {
    for (const texture of textures)
      if (
        !this.textureBytes.has(texture) ||
        this.statelessTextureDestruction.has(texture)
      )
        throw new NativeStatelessComputeError(
          "stateless-compute-bytes-unavailable",
        );
    if (this.statelessDeviceDestruction.has(device))
      throw new NativeStatelessComputeError("stateless-compute-frame-invalid");
    for (const texture of textures)
      this.statelessTextureLeases.set(
        texture,
        (this.statelessTextureLeases.get(texture) ?? 0) + 1,
      );
    this.statelessDeviceLeases.set(
      device,
      (this.statelessDeviceLeases.get(device) ?? 0) + 1,
    );
    let released = false;
    return () => {
      const deviceRefs = this.statelessDeviceLeases.get(device);
      if (released || deviceRefs === undefined || deviceRefs < 1)
        throw new NativeStatelessComputeError(
          "stateless-compute-frame-invalid",
        );
      for (const texture of textures) {
        const refs = this.statelessTextureLeases.get(texture);
        if (refs === undefined || refs < 1)
          throw new NativeStatelessComputeError(
            "stateless-compute-frame-invalid",
          );
      }
      released = true;
      for (const texture of textures) {
        const refs = this.statelessTextureLeases.get(texture)!;
        if (refs > 1) this.statelessTextureLeases.set(texture, refs - 1);
        else {
          this.statelessTextureLeases.delete(texture);
          if (this.statelessTextureDestruction.delete(texture))
            this.destroyTexture(texture);
        }
      }
      if (deviceRefs > 1)
        this.statelessDeviceLeases.set(device, deviceRefs - 1);
      else {
        this.statelessDeviceLeases.delete(device);
        if (this.statelessDeviceDestruction.delete(device))
          this.destroyDevice(device);
      }
    };
  }

  private ensureCompositionBudget(
    mount: CompositionSurface,
    bytes: number,
  ): void {
    const budget = summarizeNativeCompositionBudget(
      {
        resource: mount.resourceTextures.values(),
        feedback: mount.feedback?.textures ?? [],
        source: [...mount.sourceTextures.values()].map(
          (entry) => entry.texture,
        ),
        asset: [...(mount.assetTextures?.values() ?? [])].map(
          (entry) => entry.texture,
        ),
        isolation: [...mount.isolationTextures.values()].map(
          (entry) => entry.texture,
        ),
        compute: [
          ...(mount.statelessBuffers ?? []),
          ...(mount.statelessInputs?.keys() ?? []),
        ],
      },
      new Map<GPUTexture | GPUBuffer, number>([
        ...this.textureBytes,
        ...this.statelessBufferBytes,
      ]),
      bytes,
      MAX_RESOURCE_BYTES,
    );
    if (budget.status === "incomplete") {
      console.error(
        `native-composition-bytes-unavailable: ${JSON.stringify({
          surface: mount.instance ? "mount" : "scene",
          instanceId: mount.instance?.id ?? null,
          width: mount.width,
          height: mount.height,
          pixelRatio: mount.pixelRatio ?? null,
          ...budget,
        })}`,
      );
      throw new NativeSourceError(
        "source-composition-bytes-unavailable",
        "source-composition-bytes-unavailable",
      );
    }
    if (budget.exceeds) {
      console.error(
        `native-composition-budget-exceeded: ${JSON.stringify({
          surface: mount.instance ? "mount" : "scene",
          instanceId: mount.instance?.id ?? null,
          width: mount.width,
          height: mount.height,
          pixelRatio: mount.pixelRatio ?? null,
          ...budget,
        })}`,
      );
      throw new NativeSourceError(
        "source-composition-budget-exceeded",
        "The source and isolated groups exceed the per-instance texture budget.",
      );
    }
  }

  private offscreen(mount: Mount): boolean {
    const rect = mount.target.getBoundingClientRect();
    const dpr = mount.pixelRatio || Math.min(devicePixelRatio || 1, 2);
    const halo = mount.outputExtent;
    const outside =
      rect.right + (halo?.right ?? 0) / dpr <= 0 ||
      rect.bottom + (halo?.bottom ?? 0) / dpr <= 0 ||
      rect.left - (halo?.left ?? 0) / dpr >= innerWidth ||
      rect.top - (halo?.top ?? 0) / dpr >= innerHeight;
    if (!outside) return false;
    const style = getComputedStyle(mount.target);
    const authoredChildren = [...mount.target.children].some(
      (child) => !child.hasAttribute("data-an-native-canvas"),
    );
    return (
      !authoredChildren ||
      (style.overflowX !== "visible" && style.overflowY !== "visible")
    );
  }

  private releaseMountTextures(mount: Mount): void {
    this.releaseSimulation(mount);
    this.releaseFeedback(mount);
    for (const asset of mount.assetTextures.values())
      this.destroyTexture(asset.texture);
    mount.assetTextures.clear();
    for (const source of mount.sourceTextures.values())
      this.destroyTexture(source.texture);
    mount.sourceTextures.clear();
    for (const texture of mount.resourceTextures.values())
      this.destroyTexture(texture);
    mount.resourceTextures.clear();
    for (const entry of mount.isolationTextures.values())
      this.destroyTexture(entry.texture);
    mount.isolationTextures.clear();
    this.destroyTexture(mount.outputTexture);
    mount.outputTexture = null;
    this.destroyTexture(mount.maskTexture);
    mount.maskTexture = null;
    mount.maskSignature = "";
    mount.inputMaskSignature = "";
  }

  private ensureTextureBudget(bytes: number): void {
    if (this.estimatedResourceBytes() + bytes <= MAX_REALM_TEXTURE_BYTES)
      return;
    for (const mount of this.mounts.values()) {
      if (this.activeMounts.has(mount) || !this.offscreen(mount)) continue;
      this.releaseMountTextures(mount);
      if (this.estimatedResourceBytes() + bytes <= MAX_REALM_TEXTURE_BYTES)
        return;
    }
    throw new NativeSourceError(
      "gpu-budget-exceeded",
      `Native effects need more than the ${MAX_REALM_TEXTURE_BYTES} byte texture budget.`,
    );
  }

  private estimatedResourceBytes(): number {
    let canvasBytes = 0;
    for (const mount of this.mounts.values())
      canvasBytes +=
        mount.width * mount.height * 8 * (mount.presentationPair ? 2 : 1);
    if (this.scenePresentation)
      canvasBytes +=
        this.scenePresentation.surface.width *
        this.scenePresentation.surface.height *
        8;
    return (
      this.allocatedTextureBytes +
      this.allocatedUniformBytes +
      this.allocatedSimulationBytes +
      this.allocatedStatelessBytes +
      (this.pipelines.size +
        this.simulationComputePipelines.size +
        this.simulationRenderPipelines.size +
        this.statelessPipelines.size * 2) *
        524_288 +
      canvasBytes
    );
  }

  private destroyUniform(buffer: GPUBuffer): void {
    const bytes = this.uniformBytes.get(buffer);
    if (bytes !== undefined) {
      this.allocatedUniformBytes -= bytes;
      this.uniformBytes.delete(buffer);
    }
    buffer.destroy();
  }

  private destroySimulationBuffer(buffer: GPUBuffer): void {
    const bytes = this.simulationBuffers.get(buffer);
    if (bytes !== undefined) {
      this.simulationBuffers.delete(buffer);
      this.allocatedSimulationBytes -= bytes;
    }
    buffer.destroy();
  }

  private releaseSimulation(mount: Mount): void {
    if (!mount.simulation) return;
    const simulation = mount.simulation;
    for (const buffer of simulation.buffers)
      this.destroySimulationBuffer(buffer);
    mount.simulation = null;
    for (const name of [simulation.trailOutput, "__native_trail_back"])
      if (name) {
        this.destroyTexture(mount.resourceTextures.get(name));
        mount.resourceTextures.delete(name);
      }
    mount.simulationCaughtUp = true;
    mount.target.removeAttribute("data-an-native-simulation-step");
    mount.target.removeAttribute("data-an-native-simulation-target-step");
    mount.target.removeAttribute("data-an-native-particle-count");
  }

  private async disposeFeedback(
    feedback: NonNullable<Mount["feedback"]>,
  ): Promise<void> {
    const retired = await Promise.allSettled([...feedback.retirements]);
    feedback.executor.dispose();
    const rejected = retired.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected")
      throw new NativeSourceError(
        "feedback-device-lost",
        String(rejected.reason),
      );
  }

  private clearFeedbackTelemetry(mount: Mount): void {
    for (const name of [
      "data-an-native-feedback-playback",
      "data-an-native-feedback-dropped-seconds",
      "data-an-native-feedback-requested-seconds",
      "data-an-native-feedback-simulated-seconds",
      "data-an-native-feedback-completed-step",
      "data-an-native-feedback-runtime-epoch",
    ])
      mount.target.removeAttribute(name);
  }

  private reflectCommittedFeedbackTelemetry(mount: Mount): void {
    const feedback = mount.feedback;
    const playback = feedback?.executor.playbackStatus;
    if (!feedback || !playback) {
      this.clearFeedbackTelemetry(mount);
      return;
    }
    mount.target.setAttribute(
      "data-an-native-feedback-playback",
      playback.disposition,
    );
    mount.target.setAttribute(
      "data-an-native-feedback-dropped-seconds",
      String(playback.droppedLocalSeconds),
    );
    mount.target.setAttribute(
      "data-an-native-feedback-requested-seconds",
      String(playback.requestedLocalSeconds),
    );
    mount.target.setAttribute(
      "data-an-native-feedback-simulated-seconds",
      String(playback.simulationLocalSeconds),
    );
    mount.target.setAttribute(
      "data-an-native-feedback-completed-step",
      String(feedback.executor.lastCompletedStep),
    );
    mount.target.setAttribute(
      "data-an-native-feedback-runtime-epoch",
      this.epoch,
    );
  }

  private releaseFeedback(mount: Mount): void {
    mount.feedbackFrame?.abandon();
    mount.feedbackFrame = null;
    this.clearFeedbackTelemetry(mount);
    const feedback = mount.feedback;
    if (!feedback) return;
    mount.feedback = null;
    void this.disposeFeedback(feedback).catch((error) =>
      this.issue("feedback-cleanup-failed", String(error), mount.instance.id),
    );
  }

  private releaseSimulationExportSaved(
    session: NativeSimulationExportSession,
  ): void {
    for (const saved of session.saved.splice(0)) {
      if (saved.simulation)
        for (const buffer of saved.simulation.buffers)
          this.destroySimulationBuffer(buffer);
      if (saved.feedback)
        void this.disposeFeedback(saved.feedback).catch((error) =>
          this.issue(
            "feedback-cleanup-failed",
            String(error),
            saved.mount.instance.id,
          ),
        );
      for (const texture of new Set(saved.resources.values()))
        this.destroyTexture(texture);
      if (saved.output) this.destroyTexture(saved.output);
    }
  }

  private parse(): Manifest[] | null {
    this.parseFailure = null;
    const manifests: Manifest[] = [];
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      `script[type="${SCRIPT_TYPE}"]`,
    );
    const templates = [...document.querySelectorAll("template")];
    let inertManifest = false;
    for (let index = 0; index < templates.length; index += 1) {
      const content = templates[index].content;
      if (content.querySelector(`script[type="${SCRIPT_TYPE}"]`))
        inertManifest = true;
      templates.push(...content.querySelectorAll("template"));
    }
    if (inertManifest || scripts.length > 1) {
      this.parseFailure = {
        code: inertManifest ? "manifest-inert" : "manifest-duplicate",
        message: inertManifest
          ? "An effect manifest inside a template is inert and cannot be rendered."
          : "A document must contain exactly one active effect manifest.",
      };
      this.issue(this.parseFailure.code, this.parseFailure.message);
      return null;
    }
    for (const script of scripts) {
      try {
        const value: unknown = JSON.parse(script.textContent || "");
        const validation = validateEffectDocument(value);
        if (!validation.valid || !validation.document) {
          if (
            validation.errors.some((error) =>
              error.includes("stateless-compute-definition-invalid"),
            )
          )
            throw new NativeSourceError(
              "stateless-compute-definition-invalid",
              "stateless-compute-definition-invalid",
            );
          throw new Error(validation.errors.join("; "));
        }
        manifests.push(validation.document);
      } catch (error) {
        this.parseFailure = {
          code:
            error instanceof NativeSourceError &&
            error.code === "stateless-compute-definition-invalid"
              ? error.code
              : "manifest-invalid",
          message: error instanceof Error ? error.message : String(error),
        };
        this.issue(this.parseFailure.code, this.parseFailure.message);
      }
    }
    return this.parseFailure ? null : manifests;
  }

  private builtinHashes(): Promise<Set<string>> {
    this.builtinHashesPromise ??= Promise.all(
      NATIVE_EFFECT_DEFINITION_CATALOG.map(hashEffectDefinition),
    ).then((hashes) => new Set(hashes));
    return this.builtinHashesPromise;
  }

  private loadStandaloneApprovals(): void {
    if (window.parent !== window) return;
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      `script[type="${APPROVALS_SCRIPT_TYPE}"]`,
    );
    if (scripts.length > 1)
      throw new NativeSourceError(
        "approvals-unreadable",
        "The standalone document has more than one approval record.",
      );
    if (!scripts.length) return;
    const raw: unknown = JSON.parse(scripts[0].textContent || "");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new NativeSourceError(
        "approvals-unreadable",
        "The standalone approval record is malformed.",
      );
    const parsed = parseNativeEffectApprovalState(
      raw as Record<string, unknown>,
    );
    this.approvedHashes = new Set(parsed.hashes);
  }

  scan = async (): Promise<void> => {
    if (this.compositionDone) {
      this.compositionAbort?.abort();
      await this.compositionDone;
    }
    if (this.compositionUnsafe)
      throw new NativeSourceError(
        "composition-restore-failed",
        "Source restoration did not complete; reload before rescanning effects.",
      );
    this.rescanPending = true;
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      do {
        this.rescanPending = false;
        await this.scanOnce();
      } while (this.rescanPending && !this.disposed);
    })();
    try {
      await this.scanning;
    } finally {
      this.scanning = null;
    }
  };

  private requestScan(): void {
    void this.scan().catch((error) =>
      this.issue(
        "rescan-failed",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  private scanOnce = async (): Promise<void> => {
    if (this.disposed) return;
    if (this.running) await this.running;
    this.clearDraftState();
    this.instancePreview = null;
    this.instancePreviewGeneration += 1;
    this.instancePreviewPending = false;
    this.scanFailures = [];
    this.rejectedById.clear();
    let builtinHashes: Set<string>;
    try {
      builtinHashes = await this.builtinHashes();
    } catch (error) {
      this.issue("definition-hash-unavailable", String(error));
      this.scanFailures.push({
        code: "definition-hash-unavailable",
        message: String(error),
      });
      for (const mount of this.mounts.values()) {
        mount.frozenReason = {
          code: "definition-hash-unavailable",
          message: String(error),
          instanceId: mount.instance.id,
        };
        mount.target.setAttribute(
          "data-an-native-status",
          mount.outputTexture ? "last-good" : "error",
        );
        mount.target.setAttribute(
          "data-an-native-error",
          "definition-hash-unavailable",
        );
        mount.target.setAttribute(
          "data-an-native-error-message",
          String(error).slice(0, 300),
        );
        this.rejectedTargets.add(mount.target);
        this.postStatus(
          mount.instance.id,
          mount.instance.nodeId,
          mount.outputTexture ? "last-good" : "error",
          mount.frozenReason,
        );
      }
      return;
    }
    const documents = this.parse();
    if (!documents) {
      const diagnostic = this.parseFailure ?? {
        code: "manifest-invalid",
        message: "manifest-invalid",
      };
      this.scanFailures.push(diagnostic);
      for (const mount of this.mounts.values()) {
        mount.frozenReason = {
          code: diagnostic.code,
          message: diagnostic.message,
          instanceId: mount.instance.id,
        };
        mount.target.setAttribute(
          "data-an-native-status",
          mount.outputTexture ? "last-good" : "error",
        );
        mount.target.setAttribute("data-an-native-error", diagnostic.code);
        mount.target.setAttribute(
          "data-an-native-error-message",
          diagnostic.message.slice(0, 300),
        );
        this.rejectedTargets.add(mount.target);
        this.postStatus(
          mount.instance.id,
          mount.instance.nodeId,
          mount.outputTexture ? "last-good" : "error",
          diagnostic,
        );
      }
      return;
    }
    const documentColorRequested = documents[0]?.preview?.colorMode ?? "srgb";
    const documentDynamicRangeRequested =
      documents[0]?.preview?.dynamicRange ?? "sdr";
    if (
      this.documentColorRequested !== documentColorRequested ||
      this.documentDynamicRangeRequested !== documentDynamicRangeRequested
    ) {
      this.documentColorRequested = documentColorRequested;
      this.documentDynamicRangeRequested = documentDynamicRangeRequested;
      const configurationChanged =
        this.colorRequested !== documentColorRequested ||
        this.dynamicRangeRequested !== documentDynamicRangeRequested;
      this.colorRequested = documentColorRequested;
      this.dynamicRangeRequested = documentDynamicRangeRequested;
      if (configurationChanged && this.device) {
        this.rafIntervalTelemetry.reset();
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        clearTimeout(this.deviceRetryTimer);
        this.deviceRetryTimer = 0;
        this.clearDeviceResources(
          "color-policy-changed",
          "color-policy-changed",
        );
        this.deviceLifecycle.reset();
      }
      this.publishColorCapability();
    }
    if (
      this.previewPolicy.setPolicy(
        documents[0]?.preview ?? DEFAULT_NATIVE_PREVIEW_POLICY,
      )
    )
      this.previewDirty = true;
    this.updatePreviewAttributes();
    for (const target of this.rejectedTargets) {
      target.removeAttribute("data-an-native-error");
      target.removeAttribute("data-an-native-error-message");
      if (![...this.mounts.values()].some((mount) => mount.target === target))
        target.removeAttribute("data-an-native-status");
    }
    this.rejectedTargets.clear();
    const wanted = new Map<
      string,
      {
        instance: EffectInstance;
        definition: EffectDefinition;
        hash: string;
        target: HTMLElement;
        previousLayerId?: string;
        previousFillId?: string;
      }
    >();
    const lastLayerByNode = new Map<string, string>();
    const lastFillByNode = new Map<string, string>();
    const rejected = new Map<HTMLElement, Diagnostic>();
    const rejectedIds = new Set<string>();
    const definitionHashes = new Map<EffectDefinition, string>();
    const targets = new Map<string, HTMLElement>();
    const duplicateTargets = new Set<string>();
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-agent-native-node-id]",
    )) {
      const id = element.getAttribute("data-agent-native-node-id");
      if (id) {
        if (targets.has(id)) duplicateTargets.add(id);
        else targets.set(id, element);
      }
    }
    const reject = (
      instance: EffectInstance,
      target: HTMLElement | undefined,
      code: string,
      message: string,
    ): void => {
      this.issue(code, message, instance.id);
      this.scanFailures.push({ code, message, instanceId: instance.id });
      this.rejectedById.set(instance.id, {
        code,
        message,
        instanceId: instance.id,
        nodeId: instance.nodeId,
      });
      rejectedIds.add(instance.id);
      if (!target) return;
      const diagnostic = { code, message, instanceId: instance.id };
      rejected.set(target, diagnostic);
      const existing = this.mounts.get(instance.id);
      if (
        existing?.target === target &&
        existing.instance.placement === instance.placement
      ) {
        existing.frozenReason = diagnostic;
        wanted.set(instance.id, {
          instance: existing.instance,
          definition: existing.definition,
          hash: existing.definitionHash,
          target,
          previousLayerId: existing.previousLayerId,
        });
        if (instance.placement === "layer")
          lastLayerByNode.set(instance.nodeId, instance.id);
      }
    };
    for (const doc of documents) {
      const definitions = new Map(
        doc.definitions.map((definition) => [
          definitionKey(definition.id, definition.version),
          definition,
        ]),
      );
      for (const instance of doc.instances) {
        if (!instance.enabled) continue;
        const definition = definitions.get(
          definitionKey(instance.definitionId, instance.definitionVersion),
        );
        const target = targets.get(instance.nodeId);
        if (duplicateTargets.has(instance.nodeId)) {
          reject(
            instance,
            target,
            "target-duplicate",
            `Effect ${instance.id} has more than one live authored target.`,
          );
          continue;
        }
        if (
          !definition ||
          !target ||
          definition.version !== instance.definitionVersion ||
          !definition.placements.includes(instance.placement)
        ) {
          reject(
            instance,
            target,
            "instance-unresolved",
            `Effect ${instance.id} has no compatible definition or authored target.`,
          );
          continue;
        }
        const plan = planEffectGraph(definition);
        if (plan.errors.length) {
          const statelessInvalid = plan.errors.includes(
            "stateless-compute-definition-invalid",
          );
          reject(
            instance,
            target,
            statelessInvalid
              ? "stateless-compute-definition-invalid"
              : "graph-invalid",
            statelessInvalid
              ? "stateless-compute-definition-invalid"
              : plan.errors.join("; "),
          );
          continue;
        }
        if (
          definition.passes.some((pass) =>
            ["source", "__native_final_back"].includes(pass.output),
          )
        ) {
          reject(
            instance,
            target,
            "resource-reserved",
            "An effect pass writes a reserved compositor resource name.",
          );
          continue;
        }
        let hash = definitionHashes.get(definition);
        if (!hash) {
          try {
            hash = await hashEffectDefinition(definition);
          } catch (error) {
            reject(
              instance,
              target,
              "definition-hash-unavailable",
              `The effect execution hash could not be verified: ${String(error)}`,
            );
            continue;
          }
          definitionHashes.set(definition, hash);
        }
        if (!builtinHashes.has(hash) && this.approvalStatus !== "ready") {
          reject(
            instance,
            target,
            this.approvalStatus === "pending"
              ? "approvals-pending"
              : "approvals-unreadable",
            "Custom effect approval could not be verified.",
          );
          continue;
        }
        if (!builtinHashes.has(hash) && !this.approvedHashes.has(hash)) {
          reject(
            instance,
            target,
            "definition-untrusted",
            `Effect ${instance.id} has no approval for execution hash ${hash}.`,
          );
          continue;
        }
        if (
          !definition.simulation &&
          !definition.feedback &&
          !definition.statelessCompute &&
          definition.passes.some(
            (pass) =>
              pass.kind !== "render" ||
              pass.reads.length > 2 ||
              (pass.previousFrameReads?.length ?? 0) > 0,
          )
        ) {
          reject(
            instance,
            target,
            "pass-unsupported",
            "This native runtime supports up to two current-frame render textures; compute and temporal inputs need a different path.",
          );
          continue;
        }
        const inputPlan = planNativeInputResources(definition, instance);
        if (!inputPlan.ok) {
          reject(instance, target, inputPlan.code, inputPlan.detail);
          continue;
        }
        const previousLayerId =
          instance.placement === "layer"
            ? lastLayerByNode.get(instance.nodeId)
            : undefined;
        const previousFillId =
          instance.placement === "fill"
            ? lastFillByNode.get(instance.nodeId)
            : undefined;
        wanted.set(instance.id, {
          instance,
          definition,
          hash,
          target,
          previousLayerId,
          previousFillId,
        });
        if (instance.placement === "layer")
          lastLayerByNode.set(instance.nodeId, instance.id);
        if (instance.placement === "fill")
          lastFillByNode.set(instance.nodeId, instance.id);
      }
    }
    const fillsByNode = new Map<
      string,
      Array<NonNullable<ReturnType<typeof wanted.get>>>
    >();
    for (const entry of wanted.values()) {
      if (entry.instance.placement !== "fill") continue;
      const entries = fillsByNode.get(entry.instance.nodeId) ?? [];
      entries.push(entry);
      fillsByNode.set(entry.instance.nodeId, entries);
    }
    for (const entries of fillsByNode.values()) {
      let sawTextFill = false;
      let unsupportedInterleaving = false;
      for (const entry of entries) {
        if (entry.instance.clip === "text") sawTextFill = true;
        else if (sawTextFill) unsupportedInterleaving = true;
      }
      if (!unsupportedInterleaving) continue;
      for (const entry of entries) {
        reject(
          entry.instance,
          entry.target,
          "fill-order-unsupported",
          "A bounds Fill after a text Fill needs ordered group compositing.",
        );
        wanted.delete(entry.instance.id);
      }
    }
    const pairedBackdropTargets = new Set(
      [...wanted.values()]
        .filter(
          (entry) =>
            entry.instance.placement === "backdrop" &&
            !rejectedIds.has(entry.instance.id),
        )
        .map((entry) => entry.target),
    );
    for (const mount of this.mounts.values()) {
      if (
        mount.instance.placement !== "layer" ||
        !mount.outputTexture ||
        mount.layerSourceOpacityDeferred ===
          pairedBackdropTargets.has(mount.target)
      )
        continue;
      mount.canvas.style.visibility = "hidden";
      mount.suppressed = false;
      mount.layerOpacityModeTransitionPending = true;
      mount.target.removeAttribute("data-an-native-layer-suppressed");
      mount.target.removeAttribute("data-an-native-layer-instance");
      clearNativeAuthoredOpacityIfUnsuppressed(mount.target);
      this.markMountRenderPending(mount);
    }
    for (const [id, mount] of this.mounts) {
      if (
        !wanted.has(id) ||
        wanted.get(id)!.target !== mount.target ||
        wanted.get(id)!.instance.placement !== mount.instance.placement
      ) {
        this.unmount(mount);
        this.mounts.delete(id);
      }
    }
    for (const [id, entry] of wanted) {
      const existing = this.mounts.get(id);
      if (existing) {
        if (!rejectedIds.has(id)) existing.frozenReason = null;
        if (
          existing.definitionHash !== entry.hash ||
          JSON.stringify(existing.instance) !==
            JSON.stringify(entry.instance) ||
          existing.previousLayerId !== entry.previousLayerId ||
          existing.previousFillId !== entry.previousFillId
        )
          this.markMountRenderPending(existing);
        if (
          existing.feedback &&
          (!entry.definition.feedback ||
            existing.feedback.definitionHash !== entry.hash)
        )
          this.releaseFeedback(existing);
        existing.assetFailures.clear();
        existing.authoredStyleDirty = true;
        const clock = existing.clock;
        const next = entry.instance.timing;
        if (
          clock.speed !== next.speed ||
          clock.paused !== next.paused ||
          existing.instance.timing.time !== next.time ||
          (existing.instance.timing.seekRevision ?? 0) !==
            (next.seekRevision ?? 0)
        ) {
          const now = this.currentTime();
          existing.clock = updateNativePlaybackClock(
            clock,
            existing.instance.timing.time,
            next,
            now,
            (existing.instance.timing.seekRevision ?? 0) !==
              (next.seekRevision ?? 0),
          );
        }
        if (existing.definitionHash !== entry.hash)
          existing.animationCapability = nativeEffectAnimationCapability(
            entry.definition,
          );
        existing.instance = entry.instance;
        existing.definition = entry.definition;
        existing.definitionHash = entry.hash;
        if (entry.definition.simulation) this.attachSimulationPointer(existing);
        else if (existing.simulation) this.releaseSimulation(existing);
        existing.previousLayerId = entry.previousLayerId;
        existing.previousFillId = entry.previousFillId;
        continue;
      }
      try {
        this.mounts.set(
          id,
          await this.mount(
            entry.instance,
            entry.definition,
            entry.hash,
            entry.target,
            entry.previousLayerId,
            entry.previousFillId,
          ),
        );
      } catch (error) {
        this.issue("mount-failed", String(error), id);
        const diagnostic = {
          code:
            error instanceof NativeSourceError ||
            error instanceof NativeDeviceLifecycleError ||
            error instanceof NativeUniformTimingError
              ? error.code
              : "mount-failed",
          message: error instanceof Error ? error.message : String(error),
          instanceId: id,
          nodeId: entry.instance.nodeId,
        };
        this.scanFailures.push(diagnostic);
        this.rejectedById.set(id, diagnostic);
        this.rejectedTargets.add(entry.target);
        entry.target.setAttribute("data-an-native-status", "error");
        entry.target.setAttribute("data-an-native-error", diagnostic.code);
        entry.target.setAttribute(
          "data-an-native-error-message",
          diagnostic.message.slice(0, 300),
        );
        this.postStatus(id, entry.instance.nodeId, "error", diagnostic);
        if (!this.device && !this.deviceLifecycle.exhausted())
          this.scheduleDeviceRetry();
      }
    }
    for (const mount of this.mounts.values()) mount.isTopLayer = true;
    for (const mount of this.mounts.values())
      for (const previousId of [mount.previousLayerId, mount.previousFillId]) {
        if (!previousId) continue;
        const previous = this.mounts.get(previousId);
        if (previous) previous.isTopLayer = false;
      }
    for (const mount of this.mounts.values()) this.syncPresentation(mount);
    if (this.mounts.size) {
      await this.renderInternal(this.currentTime(), false);
      if (this.playing && !this.raf) this.frame();
      else if (!this.playing) this.scheduleIdleSourcePoll();
    }
    for (const [target, diagnostic] of rejected) {
      const retained = [...this.mounts.values()].some(
        (mount) => mount.target === target && mount.suppressed,
      );
      target.setAttribute(
        "data-an-native-status",
        retained ? "last-good" : "error",
      );
      target.setAttribute("data-an-native-error", diagnostic.code);
      target.setAttribute(
        "data-an-native-error-message",
        diagnostic.message.slice(0, 300),
      );
      this.rejectedTargets.add(target);
    }
    for (const diagnostic of this.rejectedById.values()) {
      const mount = this.mounts.get(diagnostic.instanceId!);
      this.postStatus(
        diagnostic.instanceId!,
        diagnostic.nodeId,
        mount?.outputTexture ? "last-good" : "error",
        diagnostic,
      );
    }
  };

  private async mount(
    instance: EffectInstance,
    definition: EffectDefinition,
    definitionHash: string,
    target: HTMLElement,
    previousLayerId?: string,
    previousFillId?: string,
  ): Promise<Mount> {
    this.ensurePresentationStyles();
    const device = await this.ensureDevice();
    if (this.disposed)
      throw new Error(
        "The native shader runtime was disposed before mounting.",
      );
    const canvas = document.createElement("canvas");
    canvas.dataset.anNativeCanvas = instance.id;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:absolute;pointer-events:none;display:block;max-width:none;max-height:none;";
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new Error("WebGPU canvas context is unavailable.");
    context.configure({
      device,
      format: this.format,
      alphaMode: "premultiplied",
      colorSpace: this.colorPresented,
      ...(this.dynamicRangePresented === "hdr"
        ? { toneMapping: { mode: "extended" as const } }
        : {}),
    });
    const configured = context.getConfiguration();
    if (
      this.dynamicRangePresented === "hdr" &&
      (configured?.format !== "rgba16float" ||
        configured.toneMapping?.mode !== "extended")
    ) {
      context.unconfigure();
      throw new NativeSourceError(
        "hdr-canvas-unavailable",
        "hdr-canvas-unavailable",
      );
    }
    if (instance.placement === "fill") {
      if (!target.parentElement)
        throw new NativeSourceError(
          "fill-parent-unavailable",
          "A Fill target needs a parent element.",
        );
      const parent = target.parentElement;
      const owner = this.positionedParents.get(parent);
      if (owner) this.positionedParents.set(parent, owner + 1);
      else {
        this.positionedParents.set(parent, 1);
        if (getComputedStyle(parent).position === "static")
          parent.setAttribute("data-an-native-parent-positioned", "");
      }
      canvas.setAttribute("data-an-native-presentation", "");
      target.after(canvas);
    } else {
      if (!target.parentElement)
        throw new Error("A processor target needs a parent element.");
      const parent = target.parentElement;
      const owner = this.positionedParents.get(parent);
      if (owner) this.positionedParents.set(parent, owner + 1);
      else {
        this.positionedParents.set(parent, 1);
        if (getComputedStyle(parent).position === "static")
          parent.setAttribute("data-an-native-parent-positioned", "");
      }
      canvas.setAttribute("data-an-native-presentation", "");
      if (instance.placement === "backdrop") {
        canvas.setAttribute("data-an-native-backdrop-presentation", "");
        canvas.setAttribute(
          "data-an-native-backdrop-receiver-node-id",
          instance.nodeId,
        );
        canvas.setAttribute("data-an-native-authored-opacity", "1");
        canvas.style.opacity = "0";
        target.before(canvas);
      } else target.after(canvas);
    }
    const clockTime = this.currentTime();
    const mounted: Mount = {
      instance,
      definition,
      definitionHash,
      animationCapability: nativeEffectAnimationCapability(definition),
      target,
      canvas,
      context,
      presentationPair: null,
      provider: createNativeSceneProvider(
        target,
        instance.placement,
        this.requestSourceFrame,
        instance.placement === "backdrop" ? canvas : undefined,
      ),
      resourceTextures: new Map(),
      statelessBuffers: new Set(),
      statelessInputs: new Map(),
      isolationTextures: new Map(),
      drawBindings: new Map(),
      sourceTextures: new Map(),
      assetTextures: new Map(),
      assetPending: new Map(),
      assetFailures: new Map(),
      assetAbort: new AbortController(),
      outputTexture: null,
      groupLocalCommittedChildren: new Set(),
      groupLocalNoncontributingChildren: new Set(),
      width: 0,
      height: 0,
      pixelRatio: 1,
      outputExtent: null,
      captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      maskTexture: null,
      maskSignature: "",
      inputMaskSignature: "",
      inputMaskUsedFrame: -1,
      suppressed: false,
      frameCount: 0,
      imageRasters: 0,
      sourceDownsamples: 0,
      previousLayerId,
      previousFillId,
      layerSourceOpacityDeferred: false,
      layerOpacityModeTransitionPending: false,
      fillTextTexture: null,
      fillUnderlayTexture: null,
      fillPhaseTexture: null,
      fillBorderTexture: null,
      fillOuterCoverageTexture: null,
      fillInnerCoverageTexture: null,
      isTopLayer: true,
      clock: {
        global: clockTime,
        local:
          definition.simulation || definition.feedback
            ? instance.timing.time
            : instance.timing.time +
              (instance.timing.paused ? 0 : clockTime * instance.timing.speed),
        speed: instance.timing.speed,
        paused: instance.timing.paused,
      },
      renderWallSamples: [],
      frozenReason: null,
      reportedStatus: null,
      authoredStyleDirty: true,
      authoredFillPaint: null,
      simulation: null,
      pointerListener: null,
      pointerLeaveListener: null,
      simulationCaughtUp: true,
      feedback: null,
      feedbackFrame: null,
    };
    if (definition.simulation) this.attachSimulationPointer(mounted);
    return mounted;
  }

  private attachSimulationPointer(mount: Mount): void {
    if (mount.pointerListener) return;
    const pointer = (event: PointerEvent): void => {
      const rect = mount.target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || !mount.width || !mount.height)
        return;
      const extent = mount.outputExtent;
      const previewInstance =
        this.instancePreview?.instanceId === mount.instance.id
          ? this.instancePreview.instance
          : mount.instance;
      const plan = planNativeEffectTransform(previewInstance.transform, {
        width: mount.width,
        height: mount.height,
        pixelRatio: mount.pixelRatio,
        target: {
          x: extent?.left ?? 0,
          y: extent?.top ?? 0,
          width: extent?.sourceWidth ?? mount.width,
          height: extent?.sourceHeight ?? mount.height,
        },
      });
      if (!plan.ok) {
        this.issue(plan.code, plan.detail, mount.instance.id);
        if (mount.simulation) mount.simulation.pointer.active = false;
        return;
      }
      const targetX = (event.clientX - rect.left) / rect.width;
      const targetY = (event.clientY - rect.top) / rect.height;
      const outputX =
        ((extent?.left ?? 0) + targetX * (extent?.sourceWidth ?? mount.width)) /
        mount.width;
      const outputY =
        ((extent?.top ?? 0) +
          targetY * (extent?.sourceHeight ?? mount.height)) /
        mount.height;
      const x =
        plan.rows[0][0] * outputX + plan.rows[0][1] * outputY + plan.rows[0][2];
      const y =
        plan.rows[1][0] * outputX + plan.rows[1][1] * outputY + plan.rows[1][2];
      const active = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      const prior = mount.simulation?.pointer;
      if (mount.simulation)
        mount.simulation.pointer = {
          x,
          y,
          vx: prior ? x - prior.x : 0,
          vy: prior ? y - prior.y : 0,
          active,
        };
    };
    const leave = (): void => {
      if (mount.simulation) mount.simulation.pointer.active = false;
    };
    mount.target.addEventListener("pointermove", pointer, { passive: true });
    mount.target.addEventListener("pointerleave", leave);
    mount.pointerListener = pointer;
    mount.pointerLeaveListener = leave;
  }

  private fillGroup(target: HTMLElement): Mount[] {
    return [...this.mounts.values()].filter(
      (candidate) =>
        candidate.instance.placement === "fill" && candidate.target === target,
    );
  }

  private syncFillPresentation(target: HTMLElement): void {
    const finalLayerId = target.getAttribute("data-an-native-layer-instance");
    const finalLayer = finalLayerId ? this.mounts.get(finalLayerId) : undefined;
    const consumedByLayer =
      finalLayer?.target === target &&
      finalLayer.instance.placement === "layer" &&
      finalLayer.suppressed &&
      !!finalLayer.outputTexture &&
      finalLayer.canvas.style.visibility === "visible";
    const topFill = this.fillGroup(target).find(
      (candidate) =>
        candidate.isTopLayer &&
        candidate.suppressed &&
        !!candidate.outputTexture,
    );
    for (const fill of this.fillGroup(target))
      fill.canvas.style.visibility =
        fill === topFill && !consumedByLayer ? "visible" : "hidden";
  }

  private restoreFillGroup(target: HTMLElement, markUnavailable = true): void {
    target.removeAttribute("data-an-native-fill-suppressed");
    target.removeAttribute("data-an-native-text-suppressed");
    target.removeAttribute("data-an-native-fill-instance");
    target.removeAttribute("data-an-native-authored-background-color");
    target.removeAttribute("data-an-native-authored-background-image");
    clearNativeAuthoredOpacityIfUnsuppressed(target);
    target.removeAttribute("data-an-native-authored-color");
    target.removeAttribute("data-an-native-authored-text-fill-color");
    for (const member of this.fillGroup(target)) {
      member.suppressed = false;
      member.authoredStyleDirty = true;
      member.canvas.style.visibility = "hidden";
      if (markUnavailable)
        this.postStatus(member.instance.id, member.instance.nodeId, "error", {
          code: "fill-group-incomplete",
          message: "fill-group-incomplete",
          instanceId: member.instance.id,
        });
    }
    if (markUnavailable) target.setAttribute("data-an-native-status", "error");
  }

  private presentFillGroup(top: Mount): void {
    if (!top.isTopLayer) return;
    const members = this.fillGroup(top.target);
    if (members.some((member) => !member.outputTexture)) return;
    top.target.setAttribute("data-an-native-fill-suppressed", "");
    if (members.some((member) => member.instance.clip === "text"))
      top.target.setAttribute("data-an-native-text-suppressed", "");
    else top.target.removeAttribute("data-an-native-text-suppressed");
    for (const member of members) {
      member.suppressed = true;
      member.canvas.style.borderRadius = "0";
    }
    top.target.setAttribute("data-an-native-fill-instance", top.instance.id);
    this.syncFillPresentation(top.target);
    this.markPresentationReady(top);
  }

  private showOriginal(mount: Mount, preserveFillTarget = false): void {
    if (mount.instance.placement === "fill" && !preserveFillTarget) {
      this.restoreFillGroup(mount.target);
      return;
    }
    if (!mount.suppressed) {
      mount.canvas.style.visibility = "hidden";
      return;
    }
    if (mount.instance.placement !== "layer" || !mount.previousLayerId) {
      if (mount.instance.placement === "fill" && !preserveFillTarget) {
        mount.target.removeAttribute("data-an-native-fill-suppressed");
        mount.target.removeAttribute("data-an-native-text-suppressed");
        mount.target.removeAttribute(
          "data-an-native-authored-background-color",
        );
        mount.target.removeAttribute(
          "data-an-native-authored-background-image",
        );
        mount.target.removeAttribute("data-an-native-authored-color");
        mount.target.removeAttribute("data-an-native-authored-text-fill-color");
      }
      if (mount.instance.placement === "layer") {
        mount.target.removeAttribute("data-an-native-layer-suppressed");
        clearNativeAuthoredOpacityIfUnsuppressed(mount.target);
        mount.target.removeAttribute("data-an-native-layer-instance");
      }
    } else if (
      mount.target.getAttribute("data-an-native-layer-instance") ===
      mount.instance.id
    ) {
      const previous = this.mounts.get(mount.previousLayerId);
      if (previous?.suppressed) {
        mount.target.setAttribute(
          "data-an-native-layer-instance",
          previous.instance.id,
        );
        previous.canvas.style.visibility = "visible";
      } else mount.target.removeAttribute("data-an-native-layer-instance");
    }
    mount.suppressed = false;
    mount.authoredStyleDirty = true;
    mount.canvas.style.visibility = "hidden";
    mount.target.setAttribute("data-an-native-status", "error");
    if (mount.instance.placement === "layer")
      this.syncFillPresentation(mount.target);
  }

  private refreshAuthoredPaint(mount: Mount): void {
    const target = mount.target;
    const fill = mount.instance.placement === "fill";
    const firstLayer =
      mount.instance.placement === "layer" && !mount.previousLayerId;
    const missing = fill
      ? !mount.authoredFillPaint ||
        !target.hasAttribute("data-an-native-authored-background-color") ||
        !target.hasAttribute("data-an-native-fill-suppressed")
      : firstLayer
        ? !target.hasAttribute("data-an-native-authored-opacity") ||
          !target.hasAttribute("data-an-native-layer-suppressed")
        : false;
    if (!mount.authoredStyleDirty && !missing) return;
    const authored = readNativeAuthoredPaint(target);
    if (fill) {
      mount.authoredFillPaint = {
        color: authored.backgroundColor,
        image: authored.backgroundImage,
        borderTopColor: authored.borderTopColor,
        borderRightColor: authored.borderRightColor,
        borderBottomColor: authored.borderBottomColor,
        borderLeftColor: authored.borderLeftColor,
        borderImageSource: authored.borderImageSource,
      };
      target.setAttribute(
        "data-an-native-authored-background-color",
        authored.backgroundColor,
      );
      target.setAttribute(
        "data-an-native-authored-background-image",
        authored.backgroundImage,
      );
      target.setAttribute(
        "data-an-native-authored-opacity",
        String(authored.opacity),
      );
      if (mount.instance.clip === "text") {
        target.setAttribute("data-an-native-authored-color", authored.color);
        target.setAttribute(
          "data-an-native-authored-text-fill-color",
          authored.textFillColor,
        );
      }
    } else if (firstLayer) {
      target.setAttribute(
        "data-an-native-authored-opacity",
        String(authored.opacity),
      );
    }
    mount.authoredStyleDirty = false;
  }

  private syncPresentation(mount: Mount): void {
    if (!mount.suppressed) return;
    if (mount.instance.placement === "layer" && mount.isTopLayer)
      mount.target.setAttribute(
        "data-an-native-layer-instance",
        mount.instance.id,
      );
    mount.canvas.style.visibility = mount.isTopLayer ? "visible" : "hidden";
    if (mount.instance.placement === "layer")
      mount.canvas.style.opacity = mount.layerSourceOpacityDeferred
        ? (mount.target.getAttribute("data-an-native-authored-opacity") ?? "1")
        : "";
    if (mount.instance.placement === "layer" && mount.isTopLayer)
      this.syncFillPresentation(mount.target);
    else if (mount.instance.placement === "fill")
      this.syncFillPresentation(mount.target);
  }

  private suppressOriginal(mount: Mount): void {
    this.refreshAuthoredPaint(mount);
    if (mount.instance.placement === "fill") {
      this.presentFillGroup(mount);
      return;
    } else if (
      mount.instance.placement === "layer" &&
      !mount.previousLayerId &&
      !mount.target.hasAttribute("data-an-native-layer-suppressed")
    )
      mount.target.setAttribute("data-an-native-layer-suppressed", "");
    mount.suppressed = true;
    this.syncPresentation(mount);
    this.markPresentationReady(mount);
  }

  private markPresentationReady(mount: Mount): void {
    mount.target.setAttribute("data-an-native-status", "ready");
    mount.target.setAttribute("data-an-native-backend", "webgpu");
    mount.target.removeAttribute("data-an-native-error");
    mount.target.removeAttribute("data-an-native-error-message");
  }

  private unmount(mount: Mount): void {
    this.gpuProfiler?.forget(mount);
    if (
      mount.instance.placement === "backdrop" &&
      ![...this.mounts.values()].some(
        (other) => other !== mount && other.instance.placement === "backdrop",
      )
    )
      this.releaseScenePresentation();
    if (mount.pointerListener)
      mount.target.removeEventListener("pointermove", mount.pointerListener);
    if (mount.pointerLeaveListener)
      mount.target.removeEventListener(
        "pointerleave",
        mount.pointerLeaveListener,
      );
    const survivors = [...this.mounts.values()].filter(
      (other) => other !== mount && other.target === mount.target,
    );
    const remainingFill = survivors.some(
      (other) => other.instance.placement === "fill",
    );
    const remainingLayer = survivors.some(
      (other) => other.instance.placement === "layer",
    );
    if (mount.instance.placement === "fill") {
      if (!remainingFill)
        this.restoreFillGroup(mount.target, !survivors.length);
    } else if (!remainingLayer) {
      mount.target.removeAttribute("data-an-native-layer-group-local-source");
      if (!survivors.length) this.showOriginal(mount);
      else {
        mount.target.removeAttribute("data-an-native-layer-suppressed");
        mount.target.removeAttribute("data-an-native-layer-instance");
        clearNativeAuthoredOpacityIfUnsuppressed(mount.target);
      }
    }
    if (!remainingFill) {
      mount.target.removeAttribute("data-an-native-fill-host");
      mount.target.removeAttribute("data-an-native-fill-positioned");
    }
    if (mount.target.parentElement) {
      const parent = mount.target.parentElement;
      const owner = this.positionedParents.get(parent);
      if (owner === 1) {
        parent.removeAttribute("data-an-native-parent-positioned");
        this.positionedParents.delete(parent);
      } else if (owner) this.positionedParents.set(parent, owner - 1);
    }
    for (const name of [
      "data-an-native-status",
      "data-an-native-backend",
      "data-an-native-error",
      "data-an-native-error-message",
      "data-an-native-frames",
      "data-an-native-captures",
      "data-an-native-image-rasters",
      "data-an-native-source-downsamples",
      "data-an-native-sources",
      "data-an-native-passes",
      "data-an-native-render-wall-ms",
      "data-an-native-render-wall-average-ms",
      "data-an-native-source-wall-ms",
      "data-an-native-compose-wall-ms",
      "data-an-native-other-wall-ms",
      "data-an-native-culled",
      "data-an-native-texture-bytes",
      "data-an-native-simulation-step",
      "data-an-native-simulation-target-step",
      "data-an-native-particle-count",
    ])
      if (!survivors.length) mount.target.removeAttribute(name);
    mount.provider?.dispose();
    mount.assetAbort.abort();
    for (const asset of mount.assetTextures.values())
      this.destroyTexture(asset.texture);
    mount.assetTextures.clear();
    mount.assetPending.clear();
    mount.assetFailures.clear();
    this.releaseSimulation(mount);
    this.releaseFeedback(mount);
    mount.presentationPair?.dispose();
    mount.presentationPair = null;
    if (mount.instance.id === REVIEWED_LOCAL_RUNTIME_TARGET?.instanceId)
      this.publishedPresentationMirror.clear();
    mount.context.unconfigure();
    mount.canvas.remove();
    this.destroyTexture(mount.outputTexture);
    mount.outputTexture = null;
    this.destroyTexture(mount.maskTexture);
    for (const texture of mount.resourceTextures.values())
      this.destroyTexture(texture);
    for (const binding of mount.drawBindings.values())
      this.destroyUniform(binding.buffer);
    mount.drawBindings.clear();
    for (const source of mount.sourceTextures.values())
      this.destroyTexture(source.texture);
    for (const entry of mount.isolationTextures.values())
      this.destroyTexture(entry.texture);
    mount.isolationTextures.clear();
    this.postStatus(mount.instance.id, mount.instance.nodeId, "unavailable", {
      code: "instance-not-mounted",
      message: "instance-not-mounted",
    });
    this.sentStatus.delete(mount.instance.id);
  }

  private layout(mount: Mount): void {
    this.updatePreviewAttributes();
    const dpr =
      this.compositionPixelRatio ?? this.previewStatus().effectivePixelRatio;
    const previous = mount.previousLayerId
      ? this.mounts.get(mount.previousLayerId)
      : undefined;
    if (mount.previousLayerId && !previous?.outputExtent)
      throw new NativeSourceError(
        "effect-layer-dependency-unavailable",
        "The previous processor has no current output geometry.",
      );
    const captureInsets = nativeTargetOverflowInsets(mount.target);
    const planned = planNativeChainedEffectExtent({
      extent: mount.definition.extent,
      captureInsets: previous ? undefined : captureInsets,
      placement: mount.instance.placement,
      clip: mount.instance.clip,
      cssWidth: mount.target.offsetWidth,
      cssHeight: mount.target.offsetHeight,
      pixelRatio: dpr,
      maxDimension: MAX_DIMENSION,
      maxPixels: MAX_PIXELS,
      previous: previous?.outputExtent ?? undefined,
    });
    if (!planned.ok) throw new NativeSourceError(planned.code, planned.detail);
    const { width, height, left, top } = planned.plan;
    mount.pixelRatio = dpr;
    mount.outputExtent = planned.plan;
    mount.captureInsets = captureInsets;
    {
      const parent = mount.target.parentElement;
      if (!parent) throw new Error("Native output target has no parent.");
      const style = getComputedStyle(mount.target);
      if (
        mount.instance.placement === "fill" &&
        (style.filter !== "none" ||
          style.mixBlendMode !== "normal" ||
          style.maskImage !== "none")
      )
        throw new NativeSourceError(
          "fill-group-style-unsupported",
          "This Fill target's filter, blend, or mask needs atomic group composition.",
        );
      if (planned.plan.expanded) {
        for (
          let node: Element | null = mount.target;
          node;
          node = node.parentElement
        ) {
          const transform = getComputedStyle(node);
          if (!supportsNativeOutput2D(transform))
            throw new NativeSourceError(
              "effect-output-transform-unsupported",
              "Expanded output cannot project a 3D or perspective transform.",
            );
        }
      }
      const geometry = planNativeOutputGeometry({
        offsetLeft: mount.target.offsetLeft,
        offsetTop: mount.target.offsetTop,
        width: mount.target.offsetWidth,
        height: mount.target.offsetHeight,
        extent: planned.plan,
        transformOrigin: style.transformOrigin,
      });
      if (planned.plan.expanded && !geometry)
        throw new NativeSourceError(
          "effect-output-transform-unsupported",
          "Expanded output has an unsupported transform origin.",
        );
      mount.canvas.style.left = `${geometry?.left ?? mount.target.offsetLeft - left / dpr}px`;
      mount.canvas.style.top = `${geometry?.top ?? mount.target.offsetTop - top / dpr}px`;
      mount.canvas.style.width = `${geometry?.width ?? mount.target.offsetWidth + (left + planned.plan.right) / dpr}px`;
      mount.canvas.style.height = `${geometry?.height ?? mount.target.offsetHeight + (top + planned.plan.bottom) / dpr}px`;
      mount.canvas.style.transform = style.transform;
      mount.canvas.style.translate = style.translate;
      mount.canvas.style.rotate = style.rotate;
      mount.canvas.style.scale = style.scale;
      mount.canvas.style.transformOrigin =
        geometry?.transformOrigin ?? style.transformOrigin;
      mount.canvas.style.borderRadius =
        mount.instance.placement === "fill" || planned.plan.expanded
          ? "0"
          : style.borderRadius;
      if (mount.instance.placement === "fill")
        mount.canvas.style.opacity =
          mount.target.getAttribute("data-an-native-authored-opacity") ??
          style.opacity;
      else if (mount.instance.placement === "layer")
        mount.canvas.style.opacity = mount.layerSourceOpacityDeferred
          ? (mount.target.getAttribute("data-an-native-authored-opacity") ??
            style.opacity)
          : "";
      mount.canvas.style.zIndex =
        style.zIndex === "auto" ? "auto" : style.zIndex;
    }
    if (mount.width !== width || mount.height !== height) {
      this.releaseSimulation(mount);
      this.releaseFeedback(mount);
      mount.canvas.width = width;
      mount.canvas.height = height;
      mount.width = width;
      mount.height = height;
      this.destroyTexture(mount.maskTexture);
      mount.maskTexture = null;
      mount.maskSignature = "";
      mount.inputMaskSignature = "";
      for (const texture of mount.resourceTextures.values())
        this.destroyTexture(texture);
      mount.resourceTextures.clear();
      for (const entry of mount.isolationTextures.values())
        this.textureRetirement.push(entry.texture);
      mount.isolationTextures.clear();
      for (const binding of mount.drawBindings.values())
        this.destroyUniform(binding.buffer);
      mount.drawBindings.clear();
    }
  }

  private async pipeline(
    wgsl: string,
    format: GPUTextureFormat,
    blend = false,
    effect = false,
  ): Promise<GPURenderPipeline> {
    const device = await this.ensureDevice();
    const deviceEpoch = this.deviceEpoch;
    const key = `${deviceEpoch}:${format}:${blend}:${effect}:${wgsl}`;
    if (!this.pipelines.has(key)) this.ensureTextureBudget(524_288);
    return this.pipelines.getOrCreate(key, async () => {
      const module = device.createShaderModule({ code: wgsl });
      const compilation = await module.getCompilationInfo();
      if (this.device !== device || this.deviceEpoch !== deviceEpoch)
        throw new NativeSourceError(
          "device-generation-changed",
          "The WebGPU device changed during shader compilation.",
        );
      const errors = compilation.messages.filter(
        (message: { type: string }) => message.type === "error",
      );
      if (errors.length)
        throw new NativeShaderCompilationError(
          errors.map((error) => ({
            line: error.lineNum,
            column: error.linePos,
            message: error.message,
          })),
        );
      if (effect && !this.effectPipelineLayout) {
        this.effectLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform" },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: "filtering" },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float" },
            },
            {
              binding: 3,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float" },
            },
          ],
        });
        this.effectPipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [this.effectLayout],
        });
      }
      try {
        const pipeline = await device.createRenderPipelineAsync({
          layout: effect ? this.effectPipelineLayout! : "auto",
          vertex: { module, entryPoint: "vs" },
          fragment: {
            module,
            entryPoint: "fs",
            targets: [
              {
                format,
                ...(blend
                  ? {
                      blend: {
                        color: {
                          operation: "add",
                          srcFactor: "one",
                          dstFactor: "one-minus-src-alpha",
                        },
                        alpha: {
                          operation: "add",
                          srcFactor: "one",
                          dstFactor: "one-minus-src-alpha",
                        },
                      },
                    }
                  : {}),
              },
            ],
          },
          primitive: { topology: "triangle-list" },
        });
        if (this.device !== device || this.deviceEpoch !== deviceEpoch)
          throw new NativeSourceError(
            "device-generation-changed",
            "The WebGPU device changed during pipeline creation.",
          );
        return pipeline;
      } catch (error) {
        if (error instanceof NativeSourceError) throw error;
        throw new NativeSourceError(
          "shader-pipeline-failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    });
  }

  private bind(
    mount: CompositionSurface,
    key: string,
    pipeline: GPURenderPipeline,
    source: GPUTexture,
    mask: GPUTexture | null,
    bytes: Float32Array,
    sampler: GPUSampler = this.sampler!,
    secondSampler: GPUSampler | null = null,
    extraTextures: readonly GPUTexture[] = [],
  ): GPUBindGroup {
    const size = Math.ceil(bytes.byteLength / 16) * 16;
    let entry = mount.drawBindings.get(key);
    if (!entry || entry.size !== size) {
      if (
        this.allocatedUniformBytes + size > MAX_UNIFORM_BYTES ||
        this.estimatedResourceBytes() + size > MAX_REALM_TEXTURE_BYTES
      )
        throw new NativeSourceError(
          "gpu-budget-exceeded",
          "Native effect uniform bindings exceed the bounded resource budget.",
        );
      const buffer = this.device!.createBuffer({
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.uniformBytes.set(buffer, size);
      this.allocatedUniformBytes += size;
      if (entry) this.retirement.push(entry.buffer);
      entry = {
        buffer,
        size,
        bindGroup: null,
        pipeline: null,
        source: null,
        mask: null,
        sampler: null,
        secondSampler: null,
        extraTextures: null,
        lastFrame: 0,
      };
      mount.drawBindings.set(key, entry);
    }
    this.device!.queue.writeBuffer(entry.buffer, 0, bytes);
    if (
      !entry.bindGroup ||
      entry.pipeline !== pipeline ||
      entry.source !== source ||
      entry.mask !== mask ||
      entry.sampler !== sampler ||
      entry.secondSampler !== secondSampler ||
      entry.extraTextures?.length !== extraTextures.length ||
      extraTextures.some(
        (texture, index) => entry.extraTextures?.[index] !== texture,
      )
    ) {
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: entry.buffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: source.createView() },
      ];
      if (mask) entries.push({ binding: 3, resource: mask.createView() });
      if (secondSampler) entries.push({ binding: 4, resource: secondSampler });
      for (let index = 0; index < extraTextures.length; index += 1)
        entries.push({
          binding: (secondSampler ? 5 : 4) + index,
          resource: extraTextures[index].createView(),
        });
      entry.bindGroup = this.device!.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries,
      });
      entry.pipeline = pipeline;
      entry.source = source;
      entry.mask = mask;
      entry.sampler = sampler;
      entry.secondSampler = secondSampler;
      entry.extraTextures = [...extraTextures];
    }
    entry.lastFrame = this.renderEpoch;
    return entry.bindGroup;
  }

  private sourceSizingSampler(
    min: "nearest" | "linear",
    mag: "nearest" | "linear",
    mipmap: "nearest" | "linear" = "nearest",
  ): GPUSampler {
    if (min === "linear" && mag === "linear" && mipmap === "nearest")
      return this.sampler!;
    const key = `${min}:${mag}:${mipmap}`;
    let sampler = this.sourceSizingSamplers.get(key);
    if (!sampler) {
      sampler = this.device!.createSampler({
        minFilter: min,
        magFilter: mag,
        mipmapFilter: mipmap,
      });
      this.sourceSizingSamplers.set(key, sampler);
    }
    return sampler;
  }

  private retireBindings(): void {
    const surfaces: CompositionSurface[] = [...this.mounts.values()];
    if (this.scenePresentation) surfaces.push(this.scenePresentation.surface);
    for (const mount of surfaces) {
      for (const [key, entry] of mount.drawBindings) {
        if (this.renderEpoch - entry.lastFrame < 120) continue;
        mount.drawBindings.delete(key);
        this.retirement.push(entry.buffer);
      }
      for (const [key, source] of mount.sourceTextures)
        if (this.renderEpoch - source.lastFrame >= 120) {
          mount.sourceTextures.delete(key);
          this.destroyTexture(source.texture);
        }
    }
    if (
      this.retirementPending ||
      (!this.retirement.length && !this.textureRetirement.length) ||
      !this.device
    )
      return;
    this.retirementPending = true;
    const device = this.device;
    const buffers = this.retirement.splice(0);
    const textures = this.textureRetirement.splice(0);
    for (const texture of textures)
      this.retirementInFlightTextures.add(texture);
    void device.queue.onSubmittedWorkDone().then(
      () => {
        for (const buffer of buffers) this.destroyUniform(buffer);
        for (const texture of textures) {
          this.retirementInFlightTextures.delete(texture);
          this.destroyTexture(texture);
        }
        this.retirementPending = false;
        this.retireBindings();
      },
      (error) => {
        this.issue("gpu-retirement", String(error));
        for (const buffer of buffers) this.destroyUniform(buffer);
        for (const texture of textures) {
          this.retirementInFlightTextures.delete(texture);
          this.destroyTexture(texture);
        }
        this.retirementPending = false;
        this.retireBindings();
      },
    );
  }

  private upload(
    mount: CompositionSurface,
    record: NativeSourceRecord,
  ): GPUTexture {
    if (!record.source)
      throw new Error("A source record has no drawable pixels.");
    const scale = Math.min(
      1,
      MAX_DIMENSION / record.width,
      MAX_DIMENSION / record.height,
      Math.sqrt(MAX_PIXELS / (record.width * record.height)),
    );
    const uploadWidth = Math.max(1, Math.floor(record.width * scale));
    const uploadHeight = Math.max(1, Math.floor(record.height * scale));
    const sampling = planNativeImageUpload({
      imageRendering: record.imageRendering,
      sourceSize: { width: record.width, height: record.height },
      uploadedSize: { width: uploadWidth, height: uploadHeight },
    });
    if (!sampling.ok) {
      const code = `source-image-rendering-${sampling.reason}`;
      throw new NativeSourceError(code, code);
    }
    let entry = mount.sourceTextures.get(record.key);
    if (
      !entry ||
      entry.width !== uploadWidth ||
      entry.height !== uploadHeight
    ) {
      this.ensureCompositionBudget(mount, uploadWidth * uploadHeight * 4);
      const texture = this.texture(
        uploadWidth,
        uploadHeight,
        "rgba8unorm-srgb",
      );
      if (entry) this.textureRetirement.push(entry.texture);
      entry = {
        texture,
        revision: -1,
        width: uploadWidth,
        height: uploadHeight,
        lastFrame: this.renderEpoch,
      };
      mount.sourceTextures.set(record.key, entry);
    }
    if (entry.revision !== record.revision) {
      const destination: GPUCopyExternalImageDestInfo = {
        texture: entry.texture,
        premultipliedAlpha: false,
        colorSpace: "srgb",
      };
      try {
        if (scale < 1) throw new Error("Source needs bounded resampling.");
        this.device!.queue.copyExternalImageToTexture(
          { source: record.source, flipY: false },
          destination,
          [uploadWidth, uploadHeight],
        );
      } catch (directError) {
        if (scale >= 1 && !(record.source instanceof HTMLImageElement)) {
          throw new NativeSourceError(
            "source-gpu-upload",
            `A ${record.kind} source could not be uploaded to WebGPU: ${String(directError)}`,
          );
        }
        const raster = document.createElement("canvas");
        raster.width = uploadWidth;
        raster.height = uploadHeight;
        const context = raster.getContext("2d", { alpha: true });
        if (!context)
          throw new NativeSourceError(
            "source-image-raster",
            "A 2D canvas for the image upload is unavailable.",
          );
        try {
          context.drawImage(record.source, 0, 0, uploadWidth, uploadHeight);
          this.device!.queue.copyExternalImageToTexture(
            { source: raster, flipY: false },
            destination,
            [uploadWidth, uploadHeight],
          );
        } catch (rasterError) {
          throw new NativeSourceError(
            "source-image-upload",
            `The decoded image could not be rasterized and uploaded to WebGPU: ${String(rasterError)}`,
          );
        }
        mount.imageRasters += 1;
      }
      if (scale < 1) {
        mount.sourceDownsamples += 1;
        this.issue(
          "source-resolution-reduced",
          `Source ${record.width}×${record.height} was uploaded at ${uploadWidth}×${uploadHeight} to respect the texture limit.`,
          mount.instance?.id,
        );
      }
      entry.revision = record.revision;
    }
    entry.lastFrame = this.renderEpoch;
    return entry.texture;
  }

  private embeddedAssetRegistry(): Map<
    string,
    NativeEmbeddedAssetEntry
  > | null {
    if (this.embeddedAssets) return this.embeddedAssets;
    const scripts = document.querySelectorAll<HTMLScriptElement>(
      `script[type="${NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE}"][${NATIVE_EMBEDDED_ASSETS_ATTR}]`,
    );
    if (!scripts.length) {
      this.embeddedAssets = null;
      return null;
    }
    if (scripts.length !== 1)
      throw new NativeSourceError(
        "input-embedded-registry",
        "The embedded input registry must appear exactly once.",
      );
    const script = scripts[0];
    const attributes = [...script.attributes]
      .map((attribute) => attribute.name)
      .sort();
    if (attributes.join(",") !== `${NATIVE_EMBEDDED_ASSETS_ATTR},type`)
      throw new NativeSourceError(
        "input-embedded-registry",
        "The embedded input registry has unexpected attributes.",
      );
    try {
      const parsed = parseNativeEmbeddedAssetRegistryText(
        script.textContent ?? "",
      );
      this.embeddedAssets = new Map(
        parsed.assets.map((asset) => [asset.path, asset]),
      );
      return this.embeddedAssets;
    } catch (error) {
      throw new NativeSourceError(
        "input-embedded-registry",
        `The embedded input registry is unreadable: ${String(error)}`,
      );
    }
  }

  private embeddedAssetBlob(entry: NativeEmbeddedAssetEntry): Promise<Blob> {
    const existing = this.embeddedAssetBlobs.get(entry.path);
    if (existing) return existing;
    const verified = (async (): Promise<Blob> => {
      let decoded: string;
      try {
        decoded = atob(entry.base64);
      } catch (error) {
        throw new NativeSourceError(
          "input-embedded-invalid",
          `The embedded input cannot be decoded: ${String(error)}`,
        );
      }
      if (decoded.length !== entry.byteLength)
        throw new NativeSourceError(
          "input-embedded-invalid",
          "The embedded input byte length does not match its registry record.",
        );
      const bytes = new Uint8Array(entry.byteLength);
      for (let index = 0; index < decoded.length; index += 1)
        bytes[index] = decoded.charCodeAt(index);
      if (!crypto.subtle)
        throw new NativeSourceError(
          "input-embedded-digest-unavailable",
          "SHA-256 verification is unavailable for the embedded input.",
        );
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const hash = Array.from(digest, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== entry.sha256)
        throw new NativeSourceError(
          "input-embedded-digest",
          "The embedded input failed SHA-256 verification.",
        );
      return new Blob([bytes], { type: entry.mimeType });
    })();
    this.embeddedAssetBlobs.set(entry.path, verified);
    return verified;
  }

  private async fetchInputBlob(url: URL, signal: AbortSignal): Promise<Blob> {
    const response = await fetch(url.href, {
      credentials: "same-origin",
      mode: "same-origin",
      signal,
    });
    if (!response.ok || response.type === "opaque")
      throw new NativeSourceError(
        "input-asset-unreadable",
        `Input asset returned HTTP ${response.status}.`,
      );
    const mime =
      response.headers.get("content-type")?.split(";", 1)[0].trim() ?? "";
    if (!mime.startsWith("image/"))
      throw new NativeSourceError(
        "input-asset-type",
        "An input asset must be served with an image content type.",
      );
    const announced = Number(response.headers.get("content-length"));
    if (Number.isFinite(announced) && announced > MAX_INPUT_ASSET_BYTES)
      throw new NativeSourceError(
        "input-asset-too-large",
        "The encoded input asset exceeds 16 MiB.",
      );
    if (!response.body)
      throw new NativeSourceError(
        "input-asset-unreadable",
        "The input asset response has no readable body.",
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_INPUT_ASSET_BYTES) {
        await reader.cancel();
        throw new NativeSourceError(
          "input-asset-too-large",
          "The encoded input asset exceeds 16 MiB.",
        );
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Blob([bytes.buffer], { type: mime });
  }

  private async generateEncodedMips(
    mount: Mount,
    device: GPUDevice,
    texture: GPUTexture,
    sizes: readonly { width: number; height: number }[],
  ): Promise<void> {
    if (sizes.length < 2) return;
    const pipeline = await this.pipeline(encodedMipWgsl, "rgba8unorm");
    if (this.device !== device)
      throw new NativeSourceError(
        "input-device-changed",
        "The WebGPU device changed while preparing encoded image mips.",
      );
    const encoder = device.createCommandEncoder();
    const temporary: GPUTexture[] = [];
    let submitted = false;
    try {
      for (let level = 1; level < sizes.length; level += 1) {
        const size = sizes[level];
        const output = this.texture(
          size.width,
          size.height,
          "rgba8unorm",
          GPUTextureUsage.COPY_SRC,
        );
        temporary.push(output);
        const bind = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: texture.createView({
                baseMipLevel: level - 1,
                mipLevelCount: 1,
              }),
            },
          ],
        });
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
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        encoder.copyTextureToTexture(
          { texture: output },
          { texture, mipLevel: level },
          [size.width, size.height, 1],
        );
      }
      device.queue.submit([encoder.finish()]);
      submitted = true;
    } finally {
      for (const output of temporary) {
        if (submitted) this.textureRetirement.push(output);
        else this.destroyTexture(output);
      }
    }
  }

  private async uploadLinearPremultColorAsset(
    mount: Mount,
    device: GPUDevice,
    assetKey: string,
    source: ImageBitmap | HTMLImageElement,
    width: number,
    height: number,
    signal: AbortSignal,
  ): Promise<GPUTexture> {
    const pipeline = await this.pipeline(linearPremultInputWgsl, "rgba16float");
    if (this.device !== device || signal.aborted)
      throw new NativeSourceError(
        signal.aborted ? "input-asset-aborted" : "input-device-changed",
        "The color input changed before normalization.",
      );
    this.ensureCompositionBudget(mount, width * height * 12);
    let encoded: GPUTexture | null = null;
    let output: GPUTexture | null = null;
    let queued = false;
    let scopeOpen = false;
    try {
      device.pushErrorScope("validation");
      scopeOpen = true;
      encoded = this.texture(width, height, "rgba8unorm-srgb");
      output = this.texture(width, height, "rgba16float");
      device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture: encoded, premultipliedAlpha: false, colorSpace: "srgb" },
        [width, height],
      );
      queued = true;
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: encoded.createView() }],
      });
      const encoder = device.createCommandEncoder();
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
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      const validation = device.popErrorScope();
      scopeOpen = false;
      const gpuError = await validation;
      if (gpuError)
        throw new NativeSourceError(
          "input-asset-upload",
          `WebGPU rejected the color input normalization: ${gpuError.message}`,
        );
      if (this.device !== device || signal.aborted)
        throw new NativeSourceError(
          signal.aborted ? "input-asset-aborted" : "input-device-changed",
          "The color input changed before normalization completed.",
        );
      mount.assetTextures.set(assetKey, {
        texture: output,
        lastFrame: this.renderEpoch,
      });
      this.textureRetirement.push(encoded);
      encoded = null;
      const result = output;
      output = null;
      return result;
    } catch (error) {
      if (scopeOpen) {
        try {
          await device.popErrorScope();
        } catch (cleanupError) {
          throw new NativeSourceError(
            "input-asset-cleanup",
            `Color input normalization failed (${String(error)}) and GPU validation cleanup failed (${String(cleanupError)}).`,
          );
        }
      }
      if (error instanceof NativeSourceError) throw error;
      throw new NativeSourceError(
        "input-asset-upload",
        `The color input could not be normalized: ${String(error)}`,
      );
    } finally {
      for (const texture of [encoded, output]) {
        if (!texture) continue;
        if (queued) this.textureRetirement.push(texture);
        else this.destroyTexture(texture);
      }
    }
  }

  private async loadInputAsset(
    mount: Mount,
    path: string,
    sampleEncoding:
      | "srgb-color"
      | "srgb-color-premultiplied"
      | "linear-data"
      | "srgb-encoded-straight" = "srgb-color",
    preprocess?: "paper-liquid-mask" | "paper-gem-smoke-mask-32",
    mipmap?: "generated",
    revision?: number,
  ): Promise<GPUTexture> {
    if (preprocess !== undefined)
      throw new NativeSourceError(
        "input-preprocess-retired",
        "This stored input requires a retired mask preprocessing path.",
      );
    const encodedImage =
      sampleEncoding === "srgb-encoded-straight" &&
      (mipmap === undefined || mipmap === "generated");
    if (
      (mipmap !== undefined || sampleEncoding === "srgb-encoded-straight") &&
      !encodedImage
    )
      throw new NativeSourceError(
        "input-processing-invalid",
        "The requested data asset processing contract is invalid.",
      );
    const assetKey = JSON.stringify([
      path,
      sampleEncoding,
      preprocess,
      mipmap,
      revision,
    ]);
    const cached = mount.assetTextures.get(assetKey);
    if (cached) {
      cached.lastFrame = this.renderEpoch;
      return cached.texture;
    }
    const failed = mount.assetFailures.get(assetKey);
    if (failed) throw failed;
    const pending = mount.assetPending.get(assetKey);
    if (pending) return pending;
    const device = this.device;
    if (!device)
      throw new NativeSourceError(
        "input-device-unavailable",
        "The WebGPU device is unavailable for input assets.",
      );
    const operation = (async (): Promise<GPUTexture> => {
      const url = new URL(path, document.baseURI);
      if (url.origin !== nativeDocumentOrigin())
        throw new NativeSourceError(
          "input-asset-cross-origin",
          "An input asset must use the document's same origin.",
        );
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      mount.assetAbort.signal.addEventListener("abort", abort, { once: true });
      const timeout = window.setTimeout(abort, 10_000);
      let bitmap: ImageBitmap | null = null;
      let image: HTMLImageElement | null = null;
      let objectUrl: string | null = null;
      try {
        const embedded = this.embeddedAssetRegistry()?.get(path);
        const blob = embedded
          ? await this.embeddedAssetBlob(embedded)
          : await this.fetchInputBlob(url, controller.signal);
        try {
          bitmap = await awaitInputDecode(
            createImageBitmap(blob, {
              premultiplyAlpha: "none",
              colorSpaceConversion:
                sampleEncoding === "srgb-color" ||
                sampleEncoding === "srgb-color-premultiplied"
                  ? "default"
                  : "none",
            }),
            controller.signal,
            (late) => late.close(),
          );
        } catch (decodeError) {
          if (controller.signal.aborted) throw decodeError;
          if (
            sampleEncoding !== "srgb-color" &&
            sampleEncoding !== "srgb-color-premultiplied"
          )
            throw new NativeSourceError(
              "input-data-decode-unsupported",
              "The browser could not decode this input without color conversion.",
            );
          objectUrl = URL.createObjectURL(blob);
          image = new Image();
          image.src = objectUrl;
          await awaitInputDecode(image.decode(), controller.signal);
        }
        const width = bitmap?.width ?? image?.naturalWidth ?? 0;
        const height = bitmap?.height ?? image?.naturalHeight ?? 0;
        if (
          !width ||
          !height ||
          width > MAX_DIMENSION ||
          height > MAX_DIMENSION ||
          width * height > MAX_PIXELS
        )
          throw new NativeSourceError(
            "input-asset-size",
            "The decoded input asset exceeds bounded texture dimensions.",
          );
        if (controller.signal.aborted || mount.assetAbort.signal.aborted)
          throw new NativeSourceError(
            "input-asset-aborted",
            "The input asset load was cancelled.",
          );
        if (this.device !== device)
          throw new NativeSourceError(
            "input-device-changed",
            "The WebGPU device changed while loading an input asset.",
          );
        if (sampleEncoding === "srgb-color-premultiplied")
          return await this.uploadLinearPremultColorAsset(
            mount,
            device,
            assetKey,
            (bitmap ?? image)!,
            width,
            height,
            controller.signal,
          );
        if (encodedImage && mipmap === "generated") {
          const sizes: { width: number; height: number }[] = [];
          let levelWidth = width;
          let levelHeight = height;
          let totalBytes = 0;
          while (true) {
            sizes.push({ width: levelWidth, height: levelHeight });
            totalBytes += levelWidth * levelHeight * 4;
            if (levelWidth === 1 && levelHeight === 1) break;
            levelWidth = Math.max(1, Math.floor(levelWidth / 2));
            levelHeight = Math.max(1, Math.floor(levelHeight / 2));
          }
          const temporaryBytes = totalBytes - width * height * 4;
          this.ensureCompositionBudget(mount, totalBytes + temporaryBytes);
          const texture = this.texture(
            width,
            height,
            "rgba8unorm",
            0,
            sizes.length,
          );
          let submitted = false;
          let scopeOpen = false;
          try {
            device.pushErrorScope("validation");
            scopeOpen = true;
            device.queue.copyExternalImageToTexture(
              { source: (bitmap ?? image)!, flipY: false },
              { texture, premultipliedAlpha: false, colorSpace: "srgb" },
              [width, height],
            );
            await this.generateEncodedMips(mount, device, texture, sizes);
            submitted = sizes.length > 1;
            const validation = device.popErrorScope();
            scopeOpen = false;
            const gpuError = await validation;
            if (gpuError)
              throw new NativeSourceError(
                "input-asset-upload",
                `WebGPU rejected the encoded image mips: ${gpuError.message}`,
              );
            if (this.device !== device || controller.signal.aborted)
              throw new NativeSourceError(
                controller.signal.aborted
                  ? "input-asset-aborted"
                  : "input-device-changed",
                "The encoded image changed before its mips were ready.",
              );
            mount.assetTextures.set(assetKey, {
              texture,
              lastFrame: this.renderEpoch,
            });
            return texture;
          } catch (error) {
            let scopeCleanupError: unknown;
            let scopeCleanupFailed = false;
            if (scopeOpen)
              try {
                await device.popErrorScope();
              } catch (cleanupError) {
                scopeCleanupError = cleanupError;
                scopeCleanupFailed = true;
              }
            if (submitted) this.textureRetirement.push(texture);
            else this.destroyTexture(texture);
            if (scopeCleanupFailed)
              throw new NativeSourceError(
                "input-asset-cleanup",
                `Encoded image upload failed (${String(error)}) and GPU validation cleanup failed (${String(scopeCleanupError)}).`,
              );
            if (error instanceof NativeSourceError) throw error;
            throw new NativeSourceError(
              "input-asset-upload",
              `The encoded image mips could not be uploaded: ${String(error)}`,
            );
          }
        }
        this.ensureCompositionBudget(mount, width * height * 4);
        const texture = this.texture(
          width,
          height,
          sampleEncoding === "srgb-color" ? "rgba8unorm-srgb" : "rgba8unorm",
        );
        try {
          device.queue.copyExternalImageToTexture(
            { source: (bitmap ?? image)!, flipY: false },
            { texture, premultipliedAlpha: false, colorSpace: "srgb" },
            [width, height],
          );
          mount.assetTextures.set(assetKey, {
            texture,
            lastFrame: this.renderEpoch,
          });
          return texture;
        } catch (error) {
          this.destroyTexture(texture);
          throw new NativeSourceError(
            "input-asset-upload",
            `The input image could not be uploaded to WebGPU: ${String(error)}`,
          );
        }
      } catch (error) {
        if (error instanceof NativeSourceError) throw error;
        throw new NativeSourceError(
          controller.signal.aborted
            ? "input-asset-timeout"
            : "input-asset-unreadable",
          `The input image could not be decoded: ${String(error)}`,
        );
      } finally {
        window.clearTimeout(timeout);
        mount.assetAbort.signal.removeEventListener("abort", abort);
        bitmap?.close();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    })();
    mount.assetPending.set(assetKey, operation);
    try {
      return await operation;
    } catch (error) {
      if (
        error instanceof NativeSourceError &&
        error.code !== "input-asset-aborted" &&
        error.code !== "input-device-changed" &&
        error.code !== "input-asset-timeout"
      )
        mount.assetFailures.set(assetKey, error);
      throw error;
    } finally {
      mount.assetPending.delete(assetKey);
    }
  }

  private async composeScene(
    mount: CompositionSurface,
    scene: NativeSourceRecord[],
    encoder: GPUCommandEncoder,
    outputName = "source",
    blendMode: "linear" | "srgb-css" | "srgb-css-linear" = "linear",
    nested?: NestedBackdropTransaction,
  ): Promise<GPUTexture> {
    const physicalRoot = planNativePhysicalRootBox({
      width: mount.width,
      height: mount.height,
      left: mount.outputExtent?.left ?? 0,
      top: mount.outputExtent?.top ?? 0,
    });
    if (!physicalRoot.ok)
      throw new NativeSourceError(
        "source-capture-geometry-invalid",
        "source-capture-geometry-invalid",
      );
    const rootBox = physicalRoot.box;
    const globalLocal = scene.some(
      (record) => record.coordinateSpace === "target-local-global",
    );
    const nestedLayerOwner = nested ? mount.instance : undefined;
    if (nested && nestedLayerOwner?.placement !== "layer")
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    let source = mount.resourceTextures.get(outputName);
    if (!source) {
      this.ensureCompositionBudget(
        mount,
        mount.width *
          mount.height *
          (this.workingFormat === "rgba16float" ? 8 : 4),
      );
      source = this.texture(mount.width, mount.height);
      mount.resourceTextures.set(outputName, source);
    }
    let compositionTarget = source;
    let cssIntermediate:
      | {
          texture: GPUTexture;
          width: number;
          height: number;
          lastFrame: number;
        }
      | undefined;
    if (blendMode === "srgb-css-linear") {
      const key = `css-intermediate:${outputName}`;
      let entry = mount.isolationTextures.get(key);
      if (
        !entry ||
        entry.width !== mount.width ||
        entry.height !== mount.height
      ) {
        this.ensureCompositionBudget(
          mount,
          mount.width *
            mount.height *
            (this.workingFormat === "rgba16float" ? 8 : 4),
        );
        const texture = this.texture(mount.width, mount.height);
        if (entry) this.textureRetirement.push(entry.texture);
        entry = {
          texture,
          width: mount.width,
          height: mount.height,
          lastFrame: this.renderEpoch,
        };
        mount.isolationTextures.set(key, entry);
      }
      entry.lastFrame = this.renderEpoch;
      compositionTarget = entry.texture;
      cssIntermediate = entry;
    }
    type PlaneScope = {
      primary: GPUTexture;
      companion?: GPUTexture;
      key: string;
    };
    const rootPlanes: PlaneScope = {
      primary: compositionTarget,
      companion: cssIntermediate ? source : undefined,
      key: outputName,
    };
    const unavailablePlanes = (): never => {
      throw new NativeSourceError(
        "source-composition-plane-unavailable",
        "source-composition-plane-unavailable",
      );
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
        unavailablePlanes();
      if (!planes.companion) {
        const key = `backdrop-replacement:${planes.key}`;
        let entry = mount.isolationTextures.get(key);
        if (!entry || entry.width !== width || entry.height !== height) {
          this.ensureCompositionBudget(
            mount,
            width * height * (this.workingFormat === "rgba16float" ? 8 : 4),
          );
          const texture = this.texture(width, height);
          if (entry) this.textureRetirement.push(entry.texture);
          entry = { texture, width, height, lastFrame: this.renderEpoch };
          mount.isolationTextures.set(key, entry);
        }
        entry.lastFrame = this.renderEpoch;
        planes.companion = entry.texture;
      }
      const next =
        current === planes.primary ? planes.companion : planes.primary;
      if (next === current || next.width !== width || next.height !== height)
        unavailablePlanes();
      return next;
    };
    const pipeline =
      this.compositePipeline ??
      (await this.pipeline(compositeWgsl, this.workingFormat, true));
    this.compositePipeline = pipeline;
    const replacementPipeline = scene.some(
      (record) =>
        record.nativeInstanceId &&
        this.mounts.get(record.nativeInstanceId)?.instance.placement ===
          "backdrop",
    )
      ? await this.pipeline(backdropReplaceWgsl, this.workingFormat)
      : null;
    const targetRect = mount.target.getBoundingClientRect();
    const sourceScale = planNativeSourceCoordinateScale({
      spaces: scene.map((record) => record.coordinateSpace),
      sourceWidth: globalLocal
        ? mount.target.offsetWidth * (mount.pixelRatio ?? 0)
        : (mount.outputExtent?.sourceWidth ?? mount.width),
      sourceHeight: globalLocal
        ? mount.target.offsetHeight * (mount.pixelRatio ?? 0)
        : (mount.outputExtent?.sourceHeight ?? mount.height),
      localWidth:
        mount.outputExtent === undefined && mount.pixelRatio
          ? mount.width / mount.pixelRatio
          : mount.target.offsetWidth,
      localHeight:
        mount.outputExtent === undefined && mount.pixelRatio
          ? mount.height / mount.pixelRatio
          : mount.target.offsetHeight,
      viewportWidth: targetRect.width,
      viewportHeight: targetRect.height,
    });
    if (!sourceScale.ok)
      throw new NativeSourceError(sourceScale.code, sourceScale.code);
    const scaleX = sourceScale.x;
    const scaleY = sourceScale.y;
    const leaves = new Map(
      scene.map((record) => [`leaf:${record.key}`, record]),
    );
    const groupClips = new Map<string, NativeSourceClip>();
    for (const record of scene)
      for (const group of record.groupClips) {
        const previous = groupClips.get(group.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(group.clip))
          throw new NativeSourceError(
            "source-clip-inconsistent",
            `Source clip ${group.id} changed within one composition frame.`,
          );
        groupClips.set(group.id, group.clip);
      }
    const planned = planNativeSourceComposition(
      scene.map((record) => ({
        id: `leaf:${record.key}`,
        box: record.rect,
        opacity: record.opacity,
        ownOpacityBaked: !!record.nativeInstanceId,
        isolationPath: record.isolationPath,
      })),
    );
    if (!planned.ok)
      throw new NativeSourceError(`source-${planned.reason}`, planned.detail);

    const drawItems = async (
      items: NativeComposedPaint[],
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
          ...this.gpuTimestampWrites(encoder, "source-compose"),
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
          pass.setPipeline(pipeline);
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
            throw new NativeSourceError(
              "source-clip-missing",
              `Group ${item.node.id} has no clip geometry.`,
            );
          const parentBox = {
            x: originX / scaleX,
            y: originY / scaleY,
            width: width / scaleX,
            height: height / scaleY,
          };
          const containsParent = (box: NativeSourceRecord["rect"]): boolean =>
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
          const groupTexture = (suffix: string): GPUTexture => {
            const key = `${groupKey}:${suffix}`;
            let entry = mount.isolationTextures.get(key);
            if (
              !entry ||
              entry.width !== groupWidth ||
              entry.height !== groupHeight
            ) {
              this.ensureCompositionBudget(
                mount,
                groupWidth *
                  groupHeight *
                  (this.workingFormat === "rgba16float" ? 8 : 4),
              );
              const texture = this.texture(groupWidth, groupHeight);
              if (entry) this.textureRetirement.push(entry.texture);
              entry = {
                texture,
                width: groupWidth,
                height: groupHeight,
                lastFrame: this.renderEpoch,
              };
              mount.isolationTextures.set(key, entry);
            }
            entry.lastFrame = this.renderEpoch;
            return entry.texture;
          };
          const fullBox = {
            x: originX / scaleX,
            y: originY / scaleY,
            width: width / scaleX,
            height: height / scaleY,
          };
          const groupBox = {
            x: left / scaleX,
            y: top / scaleY,
            width: groupWidth / scaleX,
            height: groupHeight / scaleY,
          };
          const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
          const seed: NativeComposedItem = {
            id: `${groupKey}:incoming`,
            texture: current,
            rect: fullBox,
            localBox: fullBox,
            localToTarget: identity,
            clip: fullBox,
            clips: [],
            opacity: 1,
            premultiplied: true,
            encodedScene: blendMode !== "linear",
          };
          const groupResult = await drawItems(
            [seed, ...item.children],
            groupTexture("working"),
            left,
            top,
            groupWidth,
            groupHeight,
            groupKey,
          );
          const resolve: NativeComposedItem = {
            id: `${groupKey}:resolve`,
            texture: groupResult,
            rect: item.node.box,
            localBox: groupBox,
            localToTarget: identity,
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
        if (item.clips.length > MAX_SOURCE_CLIPS)
          throw new NativeSourceError(
            "source-clip-depth-unsupported",
            `A source requires more than ${MAX_SOURCE_CLIPS} nested clips.`,
          );
        const affine = planNativeSourceAffine({
          localBox: item.localBox,
          localToTarget: item.localToTarget,
          physicalScale: { x: scaleX, y: scaleY },
        });
        if (!affine.ok)
          throw new NativeSourceError(
            `source-affine-${affine.reason}`,
            `Source ${item.id} has unsupported affine geometry: ${affine.reason}.`,
          );
        const clip = item.clip;
        const x = Math.max(0, Math.floor(clip.x * scaleX) - originX);
        const y = Math.max(0, Math.floor(clip.y * scaleY) - originY);
        const w =
          Math.min(width, Math.ceil((clip.x + clip.width) * scaleX) - originX) -
          x;
        const h =
          Math.min(
            height,
            Math.ceil((clip.y + clip.height) * scaleY) - originY,
          ) - y;
        if (w <= 0 || h <= 0) continue;
        if (item.nestedBackdropId) {
          flush();
          const child = this.mounts.get(item.nestedBackdropId);
          if (!nested || !child)
            throw new NativeSourceError(
              "native-dependency-missing",
              "native-dependency-missing",
            );
          const window = planNativeGroupLocalBackdropWindow({
            incoming: { x: originX, y: originY, width, height },
            output: { width: child.width, height: child.height },
            extent: child.outputExtent,
            localBox: item.localBox,
            localToTarget: item.localToTarget,
            physicalScale: { x: scaleX, y: scaleY },
            receiverClip: item.clip,
          });
          if (!window.ok)
            throw new NativeSourceError(
              "source-group-local-geometry-unsupported",
              "source-group-local-geometry-unsupported",
            );
          item.texture = await this.stageGroupLocalBackdrop(
            mount as Mount,
            child,
            current,
            window.plan.sourceBox.x,
            window.plan.sourceBox.y,
            window.plan.sourceBox.width,
            window.plan.sourceBox.height,
            blendMode !== "linear",
            encoder,
            nested,
            window.plan,
          );
          if (
            item.imageSampling &&
            (item.imageSampling.sourceSize.width !== item.texture.width ||
              item.imageSampling.sourceSize.height !== item.texture.height)
          )
            throw new NativeSourceError(
              "source-image-rendering-geometry",
              "source-image-rendering-geometry",
            );
        }
        const sampling = planNativeImageSampling({
          imageRendering: item.imageSampling?.imageRendering,
          sourceSize: item.imageSampling?.sourceSize ?? {
            width: item.texture.width,
            height: item.texture.height,
          },
          uploadedSize: {
            width: item.texture.width,
            height: item.texture.height,
          },
          localBox: item.localBox,
          localToTarget: item.localToTarget,
          physicalScale: { x: scaleX, y: scaleY },
          uv: item.uv,
        });
        if (!sampling.ok) {
          const code = `source-image-rendering-${sampling.reason}`;
          throw new NativeSourceError(code, code);
        }
        const data = new Float32Array(36 + MAX_SOURCE_CLIPS * 20);
        data.set([
          item.rect.x * scaleX,
          item.rect.y * scaleY,
          item.rect.width * scaleX,
          item.rect.height * scaleY,
          width,
          height,
          sampling.pixelated?.x ?? 0,
          sampling.pixelated?.y ?? 0,
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
          originX,
          originY,
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
          const sourceClip = item.clips[index];
          const clipAffine = planNativeSourceAffine({
            localBox: sourceClip.localBox,
            localToTarget: sourceClip.localToTarget,
            physicalScale: { x: scaleX, y: scaleY },
          });
          if (!clipAffine.ok)
            throw new NativeSourceError(
              `source-affine-${clipAffine.reason}`,
              `Source clip ${index} has unsupported affine geometry: ${clipAffine.reason}.`,
            );
          data.set(
            [
              sourceClip.localBox.x,
              sourceClip.localBox.y,
              sourceClip.localBox.width,
              sourceClip.localBox.height,
              sourceClip.radii.topLeft.x,
              sourceClip.radii.topLeft.y,
              sourceClip.radii.topRight.x,
              sourceClip.radii.topRight.y,
              sourceClip.radii.bottomRight.x,
              sourceClip.radii.bottomRight.y,
              sourceClip.radii.bottomLeft.x,
              sourceClip.radii.bottomLeft.y,
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
        if (item.backdropReplacement) {
          if (!replacementPipeline)
            throw new NativeSourceError(
              "backdrop-replacement-unavailable",
              "Backdrop replacement has no GPU pipeline.",
            );
          flush();
          const next = replacementTarget(planes, current, width, height);
          if (next === item.texture) unavailablePlanes();
          const bind = this.bind(
            mount,
            `scene:${item.id}:replace`,
            replacementPipeline,
            current,
            item.texture,
            data,
            this.sourceSizingSampler(sampling.filter, sampling.filter),
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
          pass.setPipeline(replacementPipeline);
          pass.setBindGroup(0, bind);
          pass.draw(3);
          pass.end();
          current = next;
          drawn = true;
          continue;
        }
        commands.push({
          bind: this.bind(
            mount,
            `scene:${item.id}`,
            pipeline,
            item.texture,
            null,
            data,
            this.sourceSizingSampler(sampling.filter, sampling.filter),
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

    const hasBackdropReplacement = (node: NativeSourcePaintNode): boolean => {
      if (node.kind === "group")
        return node.children.some(hasBackdropReplacement);
      const record = leaves.get(node.id);
      return !!(
        record?.nativeInstanceId &&
        this.mounts.get(record.nativeInstanceId)?.instance.placement ===
          "backdrop"
      );
    };
    const renderNode = async (
      node: NativeSourcePaintNode,
    ): Promise<NativeComposedPaint | null> => {
      if (node.kind === "leaf") {
        const record = leaves.get(node.id);
        if (!record)
          throw new NativeSourceError(
            "source-record-missing",
            `Source ${node.id} was not found.`,
          );
        const nativeMount = record.nativeInstanceId
          ? this.mounts.get(record.nativeInstanceId)
          : undefined;
        const nestedBackdropId =
          nested &&
          nativeMount?.instance.placement === "backdrop" &&
          nestedLayerOwner?.placement === "layer" &&
          mount.target !== nativeMount.target &&
          mount.target.contains(nativeMount.target)
            ? nativeMount.instance.id
            : undefined;
        const texture = record.nativeInstanceId
          ? nestedBackdropId
            ? this.transparent
            : nativeMount?.outputTexture
          : this.upload(mount, record);
        if (!texture)
          throw new NativeSourceError(
            "native-dependency-missing",
            `Native source ${record.nativeInstanceId} has no rendered GPU texture.`,
          );
        if (
          record.nativeInstanceId &&
          !nestedBackdropId &&
          record.imageRendering &&
          (record.width !== texture.width || record.height !== texture.height)
        )
          throw new NativeSourceError(
            "source-image-rendering-geometry",
            "source-image-rendering-geometry",
          );
        return {
          id: node.id,
          texture,
          rect: record.rect,
          localBox: record.localBox,
          localToTarget: record.localToTarget,
          clip: record.clip,
          clips: record.clips,
          opacity:
            nativeMount?.instance.placement === "backdrop"
              ? nativeMount.instance.opacity
              : node.opacity,
          premultiplied: !!record.nativeInstanceId,
          encodedScene: false,
          backdropReplacement: nativeMount?.instance.placement === "backdrop",
          nestedBackdropId,
          uv: record.uv,
          imageSampling: record.imageRendering
            ? {
                imageRendering: record.imageRendering,
                sourceSize: { width: record.width, height: record.height },
              }
            : undefined,
        };
      }
      const children: NativeComposedPaint[] = [];
      for (const child of node.children) {
        const item = await renderNode(child);
        if (item) children.push(item);
      }
      if (hasBackdropReplacement(node))
        return { kind: "deferred-group", node, children };
      if (node.isolationKind === "root" || !node.isolate)
        throw new NativeSourceError(
          "source-isolation-invalid",
          `Group ${node.id} was not isolated.`,
        );
      const clipShape = node.clipId ? groupClips.get(node.clipId) : undefined;
      if (node.isolationKind === "clip" && !clipShape)
        throw new NativeSourceError(
          "source-clip-missing",
          `Group ${node.id} has no clip geometry.`,
        );
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
      let entry = mount.isolationTextures.get(groupKey);
      if (!entry || entry.width !== width || entry.height !== height) {
        this.ensureCompositionBudget(
          mount,
          width * height * (this.workingFormat === "rgba16float" ? 8 : 4),
        );
        const texture = this.texture(width, height);
        if (entry) this.textureRetirement.push(entry.texture);
        entry = { texture, width, height, lastFrame: this.renderEpoch };
        mount.isolationTextures.set(groupKey, entry);
      }
      entry.lastFrame = this.renderEpoch;
      const groupTexture = await drawItems(
        children,
        entry.texture,
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
        localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        clip: clipShape?.rect ?? rect,
        clips: clipShape ? [clipShape] : [],
        opacity: node.opacity,
        premultiplied: true,
        encodedScene: blendMode !== "linear",
      };
    };
    const rootItems: NativeComposedPaint[] = [];
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
    if (blendMode === "srgb-css-linear") {
      const decoded =
        compositionTarget === source ? rootPlanes.primary : source;
      if (
        !cssIntermediate ||
        (compositionTarget !== rootPlanes.primary &&
          compositionTarget !== rootPlanes.companion) ||
        decoded === compositionTarget
      )
        unavailablePlanes();
      const decodePipeline = await this.pipeline(
        cssSceneDecodeWgsl,
        this.workingFormat,
      );
      const binding = this.bind(
        mount,
        `scene:${outputName}:decode-srgb`,
        decodePipeline,
        compositionTarget,
        null,
        new Float32Array([mount.width, mount.height, 0, 0]),
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
      pass.setBindGroup(0, binding);
      pass.draw(6);
      pass.end();
      if (decoded !== source) {
        mount.resourceTextures.set(outputName, decoded);
        cssIntermediate!.texture = source;
        source = decoded;
      }
    }
    return blendMode === "srgb-css-linear" ? source : compositionTarget;
  }

  private simulationBindLayout(device: GPUDevice): GPUBindGroupLayout {
    if (this.simulationLayout) return this.simulationLayout;
    const all =
      GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.simulationLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: all, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.simulationPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.simulationLayout],
    });
    return this.simulationLayout;
  }

  private async simulationPipeline(
    pass: EffectDefinition["passes"][number],
    format?: GPUTextureFormat,
  ): Promise<GPUComputePipeline | GPURenderPipeline> {
    const device = await this.ensureDevice();
    const generation = this.deviceEpoch;
    const layout = this.simulationBindLayout(device);
    const key = `${generation}:${pass.kind}:${format ?? "buffer"}:${pass.wgsl}`;
    const compile = async (): Promise<GPUShaderModule> => {
      const module = device.createShaderModule({ code: pass.wgsl });
      const compilation = await module.getCompilationInfo();
      if (this.device !== device || this.deviceEpoch !== generation)
        throw new NativeSourceError(
          "device-generation-changed",
          "The WebGPU device changed during simulation compilation.",
        );
      const errors = compilation.messages.filter(
        (message) => message.type === "error",
      );
      if (errors.length)
        throw new NativeShaderCompilationError(
          errors.map((error) => ({
            passId: pass.id,
            line: error.lineNum,
            column: error.linePos,
            message: error.message,
          })),
        );
      return module;
    };
    if (pass.kind === "compute")
      return this.simulationComputePipelines.getOrCreate(key, async () => {
        const module = await compile();
        const pipeline = await device.createComputePipelineAsync({
          layout: this.simulationPipelineLayout!,
          compute: { module, entryPoint: "cs" },
        });
        if (this.device !== device || this.deviceEpoch !== generation)
          throw new NativeSourceError(
            "device-generation-changed",
            "The WebGPU device changed during simulation pipeline creation.",
          );
        return pipeline;
      });
    if (!format)
      throw new NativeSourceError(
        "resource-format-unsupported",
        "A simulation render pass needs an output format.",
      );
    return this.simulationRenderPipelines.getOrCreate(key, async () => {
      const module = await compile();
      const pipeline = await device.createRenderPipelineAsync({
        layout: this.simulationPipelineLayout!,
        vertex: { module, entryPoint: "vs" },
        fragment: {
          module,
          entryPoint: "fs",
          targets: [
            {
              format,
              blend: {
                color: {
                  operation: "add",
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                },
                alpha: {
                  operation: "add",
                  srcFactor: "one",
                  dstFactor: "one-minus-src-alpha",
                },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      });
      if (this.device !== device || this.deviceEpoch !== generation)
        throw new NativeSourceError(
          "device-generation-changed",
          "The WebGPU device changed during simulation pipeline creation.",
        );
      return pipeline;
    });
  }

  private simulationUniform(bytes: Float32Array): GPUBuffer {
    const byteLength = Math.ceil(bytes.byteLength / 16) * 16;
    if (
      this.allocatedUniformBytes + byteLength > MAX_UNIFORM_BYTES ||
      this.estimatedResourceBytes() + byteLength > MAX_REALM_TEXTURE_BYTES
    )
      throw new NativeSourceError(
        "gpu-budget-exceeded",
        "Simulation uniforms exceed the bounded GPU budget.",
      );
    const buffer = this.device!.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformBytes.set(buffer, byteLength);
    this.allocatedUniformBytes += byteLength;
    this.device!.queue.writeBuffer(buffer, 0, bytes);
    this.retirement.push(buffer);
    return buffer;
  }

  private async simulationPasses(
    mount: Mount,
    source: GPUTexture,
    time: number,
    encoder: GPUCommandEncoder,
    definition: EffectDefinition,
    instance: EffectInstance,
    deterministic: boolean,
  ): Promise<GPUTexture> {
    assertNativeUniformTiming(time, "time");
    assertNativeUniformTiming(instance.timing.time, "initial-time");
    assertNativeUniformTiming(instance.timing.speed, "speed");
    const spec = definition.simulation;
    if (!spec)
      throw new NativeSourceError(
        "simulation-invalid",
        "Simulation metadata is missing.",
      );
    assertNativeUniformTiming(spec.fixedDt, "delta-time");
    const qualityProperty = definition.properties[spec.count.property];
    const tier =
      instance.params[spec.count.property] ?? qualityProperty?.default;
    if (tier !== "low" && tier !== "medium" && tier !== "high")
      throw new NativeSourceError(
        "simulation-tier-invalid",
        "The particle tier is invalid.",
      );
    const count = spec.count.tiers[tier];
    const stateSpec = definition.resources?.find(
      (resource) => resource.name === spec.stateResource,
    );
    const byteLength = stateSpec?.byteLength;
    if (
      stateSpec?.kind !== "buffer" ||
      !byteLength ||
      byteLength < count * spec.bytesPerParticle ||
      byteLength * 2 > MAX_RESOURCE_BYTES ||
      Math.ceil(count / 256) >
        this.device!.limits.maxComputeWorkgroupsPerDimension ||
      byteLength > this.device!.limits.maxStorageBufferBindingSize
    )
      throw new NativeSourceError(
        "simulation-resource-unsupported",
        "The particle state exceeds bounded buffer or device limits.",
      );
    const plan = planEffectGraph(definition);
    if (plan.errors.length)
      throw new NativeSourceError(
        "simulation-graph-invalid",
        plan.errors.join("; "),
      );
    const update = plan.passes.find((pass) => pass.kind === "compute");
    const renderPasses = plan.passes.filter((pass) => pass.kind === "render");
    const paint = renderPasses[0];
    const trail = renderPasses[1];
    if (
      update?.dispatch?.elements !== "simulation-count" ||
      !paint?.draw ||
      !paint.reads.includes(spec.stateResource) ||
      !trail?.previousFrameReads?.includes(trail.output) ||
      !trail.reads.includes(paint.output)
    )
      throw new NativeSourceError(
        "simulation-graph-invalid",
        "Simulation needs bounded compute, instanced draw, and persistent trail passes.",
      );
    const definitionKey = `${definition.id}:${definition.version}:${update.wgsl}:${paint.wgsl}:${trail.wgsl}`;
    if (
      mount.simulation &&
      (mount.simulation.count !== count ||
        mount.simulation.byteLength !== byteLength ||
        mount.simulation.width !== mount.width ||
        mount.simulation.height !== mount.height ||
        mount.simulation.seed !== instance.seed ||
        mount.simulation.definitionKey !== definitionKey)
    )
      this.releaseSimulation(mount);
    if (!mount.simulation) {
      if (
        this.estimatedResourceBytes() + byteLength * 2 >
        MAX_REALM_TEXTURE_BYTES
      )
        this.ensureTextureBudget(byteLength * 2);
      const makeBuffer = (): GPUBuffer => {
        const buffer = this.device!.createBuffer({
          size: byteLength,
          usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST,
        });
        this.simulationBuffers.set(buffer, byteLength);
        this.allocatedSimulationBytes += byteLength;
        return buffer;
      };
      const first = makeBuffer();
      let second: GPUBuffer;
      try {
        second = makeBuffer();
      } catch (error) {
        this.destroySimulationBuffer(first);
        throw error;
      }
      mount.simulation = {
        buffers: [first, second],
        readIndex: 0,
        completedStep: -1,
        count,
        byteLength,
        width: mount.width,
        height: mount.height,
        definitionKey,
        seed: instance.seed,
        trailOutput: trail.output,
        pointer: { ...spec.idlePointer, vx: 0, vy: 0, active: false },
      };
    }
    let state = mount.simulation;
    const stepPlan = planNativeSimulationSteps({
      lastCompletedStep: state.completedStep,
      targetTime: time,
      fixedDt: spec.fixedDt,
      mode: deterministic ? "deterministic" : "interactive",
      maxInteractiveSteps: spec.maxInteractiveSteps,
      maxDeterministicSteps: spec.maxDeterministicSteps,
    });
    if (stepPlan.reset) {
      this.releaseSimulation(mount);
      return this.simulationPasses(
        mount,
        source,
        time,
        encoder,
        definition,
        instance,
        deterministic,
      );
    }
    if (stepPlan.steps.length === 0) {
      const priorTrail = mount.resourceTextures.get(trail.output);
      if (priorTrail) {
        mount.simulationCaughtUp = stepPlan.caughtUp;
        return priorTrail;
      }
    }
    const layout = this.simulationBindLayout(this.device!);
    const uniform = (stepTime: number): GPUBuffer => {
      const values = new Float32Array(136);
      values.set(
        [mount.width, mount.height, 1 / mount.width, 1 / mount.height],
        0,
      );
      values.set(
        packNativeUniformClock({
          time: stepTime,
          seed: instance.seed,
          pixelRatio: mount.pixelRatio,
        }),
        4,
      );
      values.set(packNativeProperties(definition, instance.params), 8);
      return this.simulationUniform(values);
    };
    const bind = (
      read: GPUBuffer,
      write: GPUBuffer,
      globals: GPUBuffer,
      interaction: GPUBuffer,
    ): GPUBindGroup =>
      this.device!.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: globals } },
          { binding: 1, resource: this.sampler! },
          { binding: 2, resource: source.createView() },
          { binding: 3, resource: this.white!.createView() },
          { binding: 4, resource: { buffer: read } },
          { binding: 5, resource: { buffer: write } },
          { binding: 6, resource: { buffer: interaction } },
        ],
      });
    const compute = (await this.simulationPipeline(
      update,
    )) as GPUComputePipeline;
    for (const stepIndex of stepPlan.steps) {
      const read = state.buffers[state.readIndex];
      const writeIndex = (1 - state.readIndex) as 0 | 1;
      const write = state.buffers[writeIndex];
      const pointer = deterministic
        ? { ...spec.idlePointer, vx: 0, vy: 0, active: false }
        : state.pointer;
      const interaction = this.simulationUniform(
        new Float32Array([
          pointer.x,
          pointer.y,
          pointer.vx,
          pointer.vy,
          pointer.active ? 1 : 0,
          spec.fixedDt,
          stepIndex,
          count,
        ]),
      );
      const pass = encoder.beginComputePass(
        this.gpuTimestampWrites(encoder, "simulation-update"),
      );
      pass.setPipeline(compute);
      pass.setBindGroup(
        0,
        bind(read, write, uniform(stepIndex * spec.fixedDt), interaction),
      );
      pass.dispatchWorkgroups(Math.ceil(count / update.dispatch.workgroupSize));
      pass.end();
      state.readIndex = writeIndex;
      state.completedStep = stepIndex;
    }
    mount.simulationCaughtUp = stepPlan.caughtUp;
    mount.target.setAttribute(
      "data-an-native-simulation-step",
      String(state.completedStep),
    );
    mount.target.setAttribute(
      "data-an-native-simulation-target-step",
      String(stepPlan.targetStep),
    );
    mount.target.setAttribute("data-an-native-particle-count", String(count));
    const outputSpec = definition.resources?.find(
      (resource) => resource.name === paint.output,
    );
    const trailSpec = definition.resources?.find(
      (resource) => resource.name === trail.output,
    );
    const format = outputSpec?.format ?? "rgba8unorm";
    if (
      outputSpec?.kind !== "texture-2d" ||
      (format !== "rgba8unorm" && format !== "rgba16float") ||
      outputSpec.size === "fixed"
    )
      throw new NativeSourceError(
        "simulation-output-unsupported",
        "Particle rendering needs a viewport-sized rgba8unorm or rgba16float texture.",
      );
    if (
      trailSpec?.kind !== "texture-2d" ||
      trailSpec.format !== "rgba16float" ||
      !trailSpec.persistent ||
      !trailSpec.usage?.includes("sampled") ||
      trailSpec.size === "fixed" ||
      mount.width * mount.height * 20 + byteLength * 2 > MAX_RESOURCE_BYTES
    )
      throw new NativeSourceError(
        "simulation-trail-unsupported",
        "Persistent particle trails require bounded viewport-sized rgba16float textures.",
      );
    let output = mount.resourceTextures.get(paint.output);
    if (
      !output ||
      output.width !== mount.width ||
      output.height !== mount.height ||
      output.format !== format
    ) {
      mount.resourceTextures.delete(paint.output);
      this.destroyTexture(output);
      output = this.texture(mount.width, mount.height, format);
      mount.resourceTextures.set(paint.output, output);
    }
    const pipeline = (await this.simulationPipeline(
      paint,
      format,
    )) as GPURenderPipeline;
    const interaction = this.simulationUniform(
      new Float32Array([
        spec.idlePointer.x,
        spec.idlePointer.y,
        0,
        0,
        0,
        spec.fixedDt,
        state.completedStep,
        count,
      ]),
    );
    const render = encoder.beginRenderPass({
      ...this.gpuTimestampWrites(encoder, "simulation-particles"),
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
    render.setBindGroup(
      0,
      bind(
        state.buffers[state.readIndex],
        state.buffers[(1 - state.readIndex) as 0 | 1],
        uniform(time),
        interaction,
      ),
    );
    render.draw(paint.draw.vertices, count);
    render.end();
    let previousTrail = mount.resourceTextures.get(trail.output);
    let nextTrail = mount.resourceTextures.get("__native_trail_back");
    if (
      !previousTrail ||
      previousTrail.width !== mount.width ||
      previousTrail.height !== mount.height
    ) {
      mount.resourceTextures.delete(trail.output);
      this.destroyTexture(previousTrail);
      previousTrail = this.texture(mount.width, mount.height, "rgba16float");
      mount.resourceTextures.set(trail.output, previousTrail);
    }
    if (
      !nextTrail ||
      nextTrail.width !== mount.width ||
      nextTrail.height !== mount.height
    ) {
      mount.resourceTextures.delete("__native_trail_back");
      this.destroyTexture(nextTrail);
      nextTrail = this.texture(mount.width, mount.height, "rgba16float");
      mount.resourceTextures.set("__native_trail_back", nextTrail);
    }
    const trailPipeline = await this.pipeline(
      trail.wgsl,
      "rgba16float",
      false,
      true,
    );
    const trailData = new Float32Array(136);
    trailData.set(
      [mount.width, mount.height, 1 / mount.width, 1 / mount.height],
      0,
    );
    trailData.set(
      packNativeUniformClock({
        time,
        seed: instance.seed,
        pixelRatio: mount.pixelRatio,
        deltaTime: stepPlan.steps.length * spec.fixedDt,
      }),
      4,
    );
    trailData.set(packNativeProperties(definition, instance.params), 8);
    const trailBind = this.bind(
      mount,
      `simulation-trail:${trail.id}`,
      trailPipeline,
      output,
      previousTrail,
      trailData,
    );
    const trailRender = encoder.beginRenderPass({
      ...this.gpuTimestampWrites(encoder, "simulation-trail"),
      colorAttachments: [
        {
          view: nextTrail.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    trailRender.setPipeline(trailPipeline);
    trailRender.setBindGroup(0, trailBind);
    trailRender.draw(3);
    trailRender.end();
    mount.resourceTextures.set(trail.output, nextTrail);
    mount.resourceTextures.set("__native_trail_back", previousTrail);
    return nextTrail;
  }

  private async feedbackPasses(
    mount: Mount,
    source: GPUTexture,
    time: number,
    encoder: GPUCommandEncoder,
    definition: EffectDefinition,
    instance: EffectInstance,
    sourceRevision: string,
    deterministic: boolean,
  ): Promise<GPUTexture> {
    if (definition !== mount.definition)
      throw new NativeSourceError(
        "feedback-draft-unsupported",
        "A feedback draft needs an isolated state session.",
      );
    const adapted =
      mount.feedback?.definitionHash === mount.definitionHash
        ? { ok: true as const, definition: mount.feedback.definition }
        : adaptNativeFeedbackDefinition(definition);
    if (!adapted.ok)
      throw new NativeSourceError(
        adapted.code,
        "The feedback graph is not executable.",
      );
    const read = (name: keyof typeof instance.params): number => {
      const value =
        instance.params[name] ?? definition.properties[name]?.default;
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new NativeSourceError(
          "feedback-params-invalid",
          `Feedback property ${name} is not a finite number.`,
        );
      return value;
    };
    const uniformProperties =
      adapted.definition.uniformProperties ??
      feedbackUniformProperties(definition.feedback!);
    const params = {
      intensity: read(uniformProperties.intensity),
      blockSize: read(uniformProperties.blockSize),
      drift: read(uniformProperties.drift),
      churn: read(uniformProperties.churn),
      blend: read(uniformProperties.blend),
      seed: read(uniformProperties.seed),
    };
    const revision = instance.timing.seekRevision ?? 0;
    const prior = mount.feedback;
    if (
      prior &&
      (prior.definitionHash !== mount.definitionHash ||
        prior.seed !== params.seed ||
        prior.seekRevision !== revision ||
        prior.sourceWidth !== source.width ||
        prior.sourceHeight !== source.height)
    )
      this.releaseFeedback(mount);
    if (!mount.feedback) {
      const grid = adapted.definition.grid;
      this.ensureCompositionBudget(
        mount,
        grid.width * grid.height * 24 + mount.width * mount.height * 24,
      );
      const textures = new Set<GPUTexture>();
      const executor = await NativeTextureFeedbackExecutor.create(
        this.device!,
        {
          allocate: (width, height, format, usage) => {
            const texture = this.texture(width, height, format, usage);
            textures.add(texture);
            return texture;
          },
          release: (texture) => {
            textures.delete(texture);
            this.destroyTexture(texture);
          },
        },
        adapted.definition,
      );
      mount.feedback = {
        executor,
        definition: adapted.definition,
        textures,
        definitionHash: mount.definitionHash,
        seed: params.seed,
        seekRevision: revision,
        sourceRevision: "",
        pendingSourceRevision: null,
        sourceWidth: source.width,
        sourceHeight: source.height,
        retirements: new Set(),
      };
    }
    const feedback = mount.feedback;
    const outputName = definition.output;
    const outputSpec = definition.resources?.find(
      (resource) => resource.name === outputName,
    );
    if (
      !outputName ||
      outputSpec?.format !== "rgba16float" ||
      outputSpec.size !== "viewport"
    )
      throw new NativeSourceError(
        "feedback-definition-invalid",
        "Feedback resolve needs a viewport-sized float output.",
      );
    let output = mount.resourceTextures.get(outputName);
    if (
      output &&
      (output.width !== source.width ||
        output.height !== source.height ||
        output.format !== "rgba16float")
    ) {
      mount.resourceTextures.delete(outputName);
      this.destroyTexture(output);
      output = undefined;
    }
    if (!output) {
      this.ensureCompositionBudget(mount, source.width * source.height * 8);
      output = this.texture(source.width, source.height, "rgba16float");
      mount.resourceTextures.set(outputName, output);
    }
    const frame = feedback.executor.encode({
      encoder,
      source,
      target: output,
      timeSeconds: time,
      initialLocalSeconds: instance.timing.time,
      mode: deterministic ? "deterministic" : "interactive",
      speed: deterministic ? undefined : instance.timing.speed,
      params,
      sourceChanged: feedback.sourceRevision !== sourceRevision,
      timestampWritesForPass: ({ kind, stepIndex }) =>
        this.gpuTimestampWrites(encoder, `feedback:${kind}:step-${stepIndex}`),
    });
    feedback.pendingSourceRevision = sourceRevision;
    mount.feedbackFrame = frame;
    return output;
  }

  private async statelessComputePasses(
    mount: Mount,
    source: GPUTexture,
    time: number,
    encoder: GPUCommandEncoder,
    definition: EffectDefinition,
    instance: EffectInstance,
  ): Promise<GPUTexture> {
    try {
      const spec = definition.statelessCompute;
      const graph = planEffectGraph(definition);
      const [compute, resolve] = graph.passes;
      const buffer = definition.resources?.find(
        (resource) => resource.name === spec?.bufferResource,
      );
      if (
        !spec ||
        graph.errors.length ||
        !compute ||
        !resolve ||
        !isStatelessComputeDispatch(compute.dispatch) ||
        buffer?.sourceBytesPerPixel === undefined
      )
        throw new NativeStatelessComputeError(
          "stateless-compute-definition-invalid",
        );
      const inputPlan = planNativeInputResources(definition, instance);
      const sourceBinding = inputPlan.ok
        ? inputPlan.inputs.get("source")
        : undefined;
      if (
        !inputPlan.ok ||
        inputPlan.inputs.size !== 1 ||
        sourceBinding?.kind !== "builtin" ||
        !["source", "backdrop"].includes(sourceBinding.source)
      )
        throw new NativeStatelessComputeError(
          "stateless-compute-definition-invalid",
        );
      const device = this.device!;
      const deviceEpoch = this.deviceEpoch;
      const limits = device.limits;
      const params = Object.fromEntries(
        Object.entries(definition.properties).map(([name, property]) => [
          name,
          Object.prototype.hasOwnProperty.call(instance.params, name)
            ? instance.params[name]
            : property.default,
        ]),
      );
      const plan = planStatelessCompute({
        dispatch: compute.dispatch,
        sourceWidth: source.width,
        sourceHeight: source.height,
        sourceBytesPerPixel: buffer.sourceBytesPerPixel,
        sharedBytes: spec.sharedBytes,
        subpixelBlocks: spec.subpixelBlocks,
        pixelRatio: mount.pixelRatio,
        params,
        limits: {
          maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
          maxBufferSize: limits.maxBufferSize,
          maxComputeWorkgroupsPerDimension:
            limits.maxComputeWorkgroupsPerDimension,
          maxComputeInvocationsPerWorkgroup:
            limits.maxComputeInvocationsPerWorkgroup,
          maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
          maxComputeWorkgroupSizeY: limits.maxComputeWorkgroupSizeY,
          maxComputeWorkgroupSizeZ: limits.maxComputeWorkgroupSizeZ,
          maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
        },
      });
      if (plan.mode === "identity") return source;
      if (
        !(mount.statelessBuffers instanceof Set) ||
        !(mount.statelessInputs instanceof Map)
      )
        throw new NativeStatelessComputeError(
          "stateless-compute-bytes-unavailable",
        );
      const hash = await hashEffectDefinition(definition);
      const key = `${hash}:rgba16float`;
      if (!this.statelessPipelines.has(key))
        this.ensureTextureBudget(1_048_576);
      const pipelines = await this.statelessPipelines.getOrCreate(key, () =>
        NativeStatelessComputePipelines.create(
          device,
          compute.wgsl,
          resolve.wgsl,
        ),
      );
      if (
        this.device !== device ||
        this.deviceEpoch !== deviceEpoch ||
        this.mounts.get(mount.instance.id) !== mount
      )
        throw new NativeStatelessComputeError(
          "stateless-compute-frame-invalid",
        );
      let output = mount.resourceTextures.get(resolve.output);
      const replace =
        !output ||
        output === source ||
        output === mount.outputTexture ||
        output.width !== mount.width ||
        output.height !== mount.height ||
        output.format !== "rgba16float";
      const inputTextures = new Set([
        source,
        this.white!,
        ...(mount.outputTexture ? [mount.outputTexture] : []),
      ]);
      const budgetSurface = {
        ...mount,
        resourceTextures: new Map([
          ...mount.resourceTextures,
          ...[...inputTextures].map(
            (texture, index) =>
              [`__native_stateless_input_${index}`, texture] as const,
          ),
        ]),
      };
      this.ensureCompositionBudget(
        budgetSurface,
        plan.byteLength + 544 + (replace ? mount.width * mount.height * 8 : 0),
      );
      this.ensureTextureBudget(
        plan.byteLength + 544 + (replace ? mount.width * mount.height * 8 : 0),
      );
      if (replace) {
        const prior = output;
        output = this.texture(mount.width, mount.height, "rgba16float");
        mount.resourceTextures.set(resolve.output, output);
        if (prior && prior !== source && prior !== mount.outputTexture)
          this.textureRetirement.push(prior);
      }
      const data = new Float32Array(136);
      data.set([mount.width, mount.height, 1 / mount.width, 1 / mount.height]);
      data.set(
        packNativeUniformClock({
          time,
          seed: instance.seed,
          pixelRatio: plan.encodedDensity,
        }),
        4,
      );
      data.set(packNativeProperties(definition, instance.params), 8);
      inputTextures.add(output!);
      const releaseTextures = this.retainStatelessTextures(
        device,
        inputTextures,
      );
      for (const texture of inputTextures)
        mount.statelessInputs.set(
          texture,
          (mount.statelessInputs.get(texture) ?? 0) + 1,
        );
      const detachInputs = () => {
        try {
          for (const texture of inputTextures) {
            const refs = mount.statelessInputs.get(texture);
            if (refs === undefined || refs < 1)
              throw new NativeStatelessComputeError(
                "stateless-compute-bytes-unavailable",
              );
            if (refs === 1) mount.statelessInputs.delete(texture);
            else mount.statelessInputs.set(texture, refs - 1);
          }
        } finally {
          releaseTextures();
        }
      };
      let frame: NativeStatelessComputeFrame;
      try {
        frame = pipelines.encode({
          plan,
          encoder,
          source,
          target: output!,
          white: this.white!,
          sampler: this.sampler!,
          data,
          allocator: {
            allocate: (byteLength, usage) => {
              this.ensureCompositionBudget(mount, byteLength);
              this.ensureTextureBudget(byteLength);
              const allocated = device.createBuffer({
                size: byteLength,
                usage,
              });
              this.statelessBufferBytes.set(allocated, byteLength);
              this.allocatedStatelessBytes += byteLength;
              mount.statelessBuffers.add(allocated);
              return allocated;
            },
            release: (allocated) => {
              const bytes = this.statelessBufferBytes.get(allocated);
              if (bytes === undefined)
                throw new NativeStatelessComputeError(
                  "stateless-compute-bytes-unavailable",
                );
              mount.statelessBuffers.delete(allocated);
              this.statelessBufferBytes.delete(allocated);
              this.allocatedStatelessBytes -= bytes;
              allocated.destroy();
            },
          },
          timestampWritesForPass: (kind) =>
            this.gpuTimestampWrites(
              encoder,
              `effect:${kind === "compute" ? compute.id : resolve.id}`,
            ),
        });
      } catch (error) {
        detachInputs();
        throw error;
      }
      const frames = this.statelessFrames.get(encoder) ?? [];
      frames.push({
        abandon: () => {
          try {
            frame.abandon();
          } finally {
            detachInputs();
          }
        },
        retire: async () => {
          try {
            await frame.retire();
          } finally {
            detachInputs();
          }
        },
      });
      this.statelessFrames.set(encoder, frames);
      return output!;
    } catch (error) {
      if (error instanceof NativeStatelessComputeError)
        throw new NativeSourceError(error.code, error.code);
      throw error;
    }
  }

  private settleStatelessFrames(
    encoder: GPUCommandEncoder,
    submitted: boolean,
  ): void {
    const frames = this.statelessFrames.get(encoder);
    this.statelessFrames.delete(encoder);
    for (const frame of frames ?? []) {
      if (!submitted) frame.abandon();
      else {
        const retirement = frame.retire();
        this.statelessRetirements.add(retirement);
        void retirement.then(
          () => this.statelessRetirements.delete(retirement),
          (error) => {
            this.statelessRetirements.delete(retirement);
            this.issue("stateless-compute-frame-invalid", String(error));
          },
        );
      }
    }
  }

  private async effectPasses(
    mount: Mount,
    source: GPUTexture,
    time: number,
    encoder: GPUCommandEncoder,
    definition: EffectDefinition = mount.definition,
    instance: EffectInstance = mount.instance,
    deterministic = false,
    sourceRevision = "",
  ): Promise<GPUTexture> {
    assertNativeUniformTiming(time, "time");
    assertNativeUniformTiming(instance.timing.time, "initial-time");
    assertNativeUniformTiming(instance.timing.speed, "speed");
    if (definition.passes[0]?.original)
      throw new NativeSourceError(
        "original-pass-retired",
        "This stored shader requires a retired original-source execution path.",
      );
    if (
      this.colorPresented === "display-p3" &&
      usesDisplayP3Color(definition, instance.params) &&
      !hasFloatColorPath(definition)
    )
      throw new NativeSourceError(
        "color-working-format-unsupported",
        `Effect ${instance.id} needs rgba16float pass outputs to preserve its Display-P3 colors.`,
      );
    if (definition.statelessCompute)
      return this.statelessComputePasses(
        mount,
        source,
        time,
        encoder,
        definition,
        instance,
      );
    if (definition.simulation)
      return this.simulationPasses(
        mount,
        source,
        time,
        encoder,
        definition,
        instance,
        deterministic,
      );
    if (definition.feedback)
      return this.feedbackPasses(
        mount,
        source,
        time,
        encoder,
        definition,
        instance,
        sourceRevision,
        deterministic,
      );
    if (usesRetiredNativeImageAbi(definition, instance))
      throw new NativeSourceError(
        "legacy-image-abi-retired",
        "This saved image-sampling contract remains readable but is not executable.",
      );
    const plan = planEffectGraph(definition);
    if (plan.errors.length) throw new Error(plan.errors.join("; "));
    const inputPlan = planNativeInputResources(definition, instance);
    if (!inputPlan.ok)
      throw new NativeSourceError(inputPlan.code, inputPlan.detail);
    const resources = new Map<string, GPUTexture>();
    for (const [name, binding] of inputPlan.inputs) {
      let input: GPUTexture;
      if (binding.kind === "asset")
        input = await this.loadInputAsset(
          mount,
          binding.url,
          binding.sampleEncoding,
          binding.preprocess,
          binding.mipmap,
        );
      else if (binding.kind === "fallback") input = this.transparent!;
      else if (binding.source === "mask") {
        input = await this.inputMask(mount, encoder);
        mount.inputMaskUsedFrame = this.renderEpoch;
      } else input = source;
      resources.set(name, input);
    }
    if (!resources.has("source")) resources.set("source", source);
    const dpr = mount.pixelRatio;
    let resourceBytes = 0;
    for (const pass of plan.passes) {
      if (
        pass.kind !== "render" ||
        pass.reads.length > 2 ||
        pass.previousFrameReads?.length
      )
        throw new Error(
          `Pass ${pass.id} requires unsupported compute, temporal, or multi-input behavior.`,
        );
      const readName = pass.reads[0];
      const input = readName ? resources.get(readName) : this.white;
      if (!input)
        throw new NativeSourceError(
          "pass-input-missing",
          `Pass ${pass.id} has no texture for ${readName ?? "its unused GPU binding"}.`,
        );
      const secondName = pass.reads[1];
      const second = secondName ? resources.get(secondName) : this.white!;
      if (!second)
        throw new NativeSourceError(
          "pass-input-missing",
          `Pass ${pass.id} has no texture for ${secondName}.`,
        );
      const mipmappedReads = pass.reads.filter((name) => {
        const binding = inputPlan.inputs.get(name);
        return binding?.kind === "asset" && binding.mipmap === "generated";
      });
      if (mipmappedReads.length && pass.reads.length !== 1)
        throw new NativeSourceError(
          "input-mipmap-sampler-unsupported",
          "A processed mipmapped input needs its own single-texture pass.",
        );
      const spec = definition.resources?.find(
        (resource) => resource.name === pass.output,
      );
      if (spec?.kind && spec.kind !== "texture-2d")
        throw new NativeSourceError(
          "resource-kind-unsupported",
          `Render output ${pass.output} must be a texture-2d resource.`,
        );
      const format = spec?.format ?? "rgba8unorm";
      if (format !== "rgba8unorm" && format !== "rgba16float")
        throw new NativeSourceError(
          "resource-format-unsupported",
          `Render output ${pass.output} requests unsupported format ${format}.`,
        );
      const width = spec?.size === "fixed" ? spec.width : mount.width;
      const height = spec?.size === "fixed" ? spec.height : mount.height;
      if (
        !width ||
        !height ||
        width > MAX_DIMENSION ||
        height > MAX_DIMENSION ||
        width * height > MAX_PIXELS
      )
        throw new NativeSourceError(
          "resource-size-unsupported",
          `Render output ${pass.output} exceeds the supported texture bounds.`,
        );
      resourceBytes += width * height * (format === "rgba16float" ? 8 : 4);
      if (resourceBytes > MAX_RESOURCE_BYTES)
        throw new NativeSourceError(
          "resource-budget-exceeded",
          "The effect graph exceeds the per-instance texture budget.",
        );
      let output = mount.resourceTextures.get(pass.output);
      if (
        !output ||
        output.width !== width ||
        output.height !== height ||
        output.format !== format
      ) {
        mount.resourceTextures.delete(pass.output);
        this.destroyTexture(output);
        this.ensureCompositionBudget(
          mount,
          width * height * (format === "rgba16float" ? 8 : 4),
        );
        output = this.texture(width, height, format);
        mount.resourceTextures.set(pass.output, output);
      }
      let pipeline: GPURenderPipeline;
      try {
        pipeline = await this.pipeline(pass.wgsl, format, false, true);
      } catch (error) {
        if (error instanceof NativeShaderCompilationError)
          throw error.withPass(pass.id);
        if (error instanceof NativeSourceError)
          throw new NativeSourceError(
            error.code,
            `${pass.id}: ${error.message}`,
          );
        throw error;
      }
      const data = new Float32Array(136);
      data.set([width, height, 1 / width, 1 / height], 0);
      data.set(
        packNativeUniformClock({ time, seed: instance.seed, pixelRatio: dpr }),
        4,
      );
      data.set(packNativeProperties(definition, instance.params), 8);
      const bind = this.bind(
        mount,
        `pass:${pass.id}`,
        pipeline,
        input,
        second,
        data,
        mipmappedReads.length
          ? this.sourceSizingSampler("linear", "linear", "linear")
          : this.sampler!,
      );
      const render = encoder.beginRenderPass({
        ...this.gpuTimestampWrites(encoder, `effect:${pass.id}`),
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
    const last = plan.passes[plan.passes.length - 1];
    const outputName = definition.output ?? last?.output;
    if (!outputName) return source;
    const result = resources.get(outputName);
    if (!result)
      throw new Error(`Effect output ${outputName} has no GPU texture.`);
    return result;
  }

  private async textMask(mount: Mount): Promise<GPUTexture> {
    if (mount.instance.clip !== "text") return this.white!;
    const clone = cloneNativeTextFlow(mount.target);
    const computed = getComputedStyle(mount.target);
    const signature = [
      mount.width,
      mount.height,
      clone.innerHTML,
      computed.font,
      computed.letterSpacing,
      computed.lineHeight,
      computed.textAlign,
      computed.whiteSpace,
      computed.textTransform,
      computed.padding,
      document.fonts?.status,
      nativeTextFlowUsesDocumentFont(mount.target),
    ].join("|");
    if (mount.maskTexture && mount.maskSignature === signature)
      return mount.maskTexture;
    const canvas = document.createElement("canvas");
    canvas.width = mount.width;
    canvas.height = mount.height;
    if (nativeTextFlowUsesDocumentFont(mount.target)) {
      await paintNativeTextFlow(mount.target, canvas, true);
    } else {
      const dpr = mount.width / Math.max(1, mount.target.offsetWidth);
      const serialized = new XMLSerializer().serializeToString(clone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mount.width}" height="${mount.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${mount.target.offsetWidth}px;height:${mount.target.offsetHeight}px;transform:scale(${dpr});transform-origin:0 0">${serialized}</div></foreignObject></svg>`;
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      try {
        await image.decode();
      } catch {
        throw new NativeSourceError(
          "text-mask-raster",
          "The browser could not rasterize the text mask.",
        );
      }
      const context = canvas.getContext("2d");
      if (!context)
        throw new NativeSourceError(
          "text-mask-canvas",
          "A 2D text mask canvas is unavailable.",
        );
      context.drawImage(image, 0, 0);
    }
    const texture = this.texture(mount.width, mount.height, "rgba8unorm");
    this.device!.queue.copyExternalImageToTexture(
      { source: canvas },
      { texture, premultipliedAlpha: true },
      [mount.width, mount.height],
    );
    this.destroyTexture(mount.maskTexture);
    mount.maskTexture = texture;
    mount.maskSignature = signature;
    return texture;
  }

  private async inputMask(
    mount: Mount,
    encoder: GPUCommandEncoder,
  ): Promise<GPUTexture> {
    const text = await this.textMask(mount);
    const extent = mount.outputExtent;
    const targetWidth = extent?.sourceWidth ?? mount.width;
    const targetHeight = extent?.sourceHeight ?? mount.height;
    const resolved = resolveNativeClipRadii({
      width: targetWidth,
      height: targetHeight,
      cssPixelScale: mount.pixelRatio,
      topLeft: getComputedStyle(mount.target).borderTopLeftRadius,
      topRight: getComputedStyle(mount.target).borderTopRightRadius,
      bottomRight: getComputedStyle(mount.target).borderBottomRightRadius,
      bottomLeft: getComputedStyle(mount.target).borderBottomLeftRadius,
    });
    if (!resolved.ok)
      throw new NativeSourceError(
        resolved.reason === "unreadable"
          ? "radius-unreadable"
          : "radius-unsupported",
        resolved.detail,
      );
    const radii = [
      resolved.radii.topLeft.x,
      resolved.radii.topLeft.y,
      resolved.radii.topRight.x,
      resolved.radii.topRight.y,
      resolved.radii.bottomRight.x,
      resolved.radii.bottomRight.y,
      resolved.radii.bottomLeft.x,
      resolved.radii.bottomLeft.y,
    ];
    if (!extent?.expanded && radii.every((radius) => radius === 0)) return text;
    const signature = `${mount.width}:${mount.height}:${targetWidth}:${targetHeight}:${extent?.left ?? 0}:${extent?.top ?? 0}:${mount.maskSignature}:${radii.join(",")}`;
    const cached = mount.resourceTextures.get("__native_input_mask");
    if (cached && mount.inputMaskSignature === signature) return cached;
    const pipeline = await this.pipeline(inputMaskWgsl, this.workingFormat);
    const bind = this.bind(
      mount,
      "input-mask",
      pipeline,
      text,
      null,
      new Float32Array([
        mount.width,
        mount.height,
        0,
        0,
        extent?.left ?? 0,
        extent?.top ?? 0,
        targetWidth,
        targetHeight,
        ...radii,
      ]),
    );
    if (!cached)
      this.ensureCompositionBudget(mount, mount.width * mount.height * 4);
    const output = cached ?? this.texture(mount.width, mount.height);
    try {
      const pass = encoder.beginRenderPass({
        ...this.gpuTimestampWrites(encoder, "input-mask"),
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
      pass.setBindGroup(0, bind);
      pass.draw(6);
      pass.end();
      mount.resourceTextures.set("__native_input_mask", output);
      mount.inputMaskSignature = signature;
      return output;
    } catch (error) {
      if (!cached) this.destroyTexture(output);
      throw error;
    }
  }

  private cornerRadii(
    mount: Mount,
  ): [number, number, number, number, number, number, number, number] {
    const style = getComputedStyle(mount.target);
    const result = resolveNativeClipRadii({
      width: mount.width,
      height: mount.height,
      cssPixelScale: mount.width / Math.max(1, mount.target.offsetWidth),
      topLeft: style.borderTopLeftRadius,
      topRight: style.borderTopRightRadius,
      bottomRight: style.borderBottomRightRadius,
      bottomLeft: style.borderBottomLeftRadius,
    });
    if (!result.ok)
      throw new NativeSourceError(
        result.reason === "unreadable"
          ? "radius-unreadable"
          : "radius-unsupported",
        result.detail,
      );
    return [
      result.radii.topLeft.x,
      result.radii.topLeft.y,
      result.radii.topRight.x,
      result.radii.topRight.y,
      result.radii.bottomRight.x,
      result.radii.bottomRight.y,
      result.radii.bottomLeft.x,
      result.radii.bottomLeft.y,
    ];
  }

  private async finish(
    mount: Mount,
    source: GPUTexture,
    encoder: GPUCommandEncoder,
    instance: EffectInstance = mount.instance,
    definition: EffectDefinition = mount.definition,
    outputName = "__native_final_back",
  ): Promise<GPUTexture> {
    let output = mount.resourceTextures.get(outputName);
    if (!output) {
      output = this.texture(
        mount.width,
        mount.height,
        this.workingFormat,
        GPUTextureUsage.COPY_SRC,
      );
      mount.resourceTextures.set(outputName, output);
    }
    const pipeline =
      this.finishPipeline ??
      (await this.pipeline(finishWgsl, this.workingFormat));
    this.finishPipeline = pipeline;
    if (instance.placement === "backdrop" && instance.clip === "text")
      throw new NativeSourceError(
        "backdrop-text-replacement-unsupported",
        "Text-clipped backdrop replacement needs a separate mask coverage pass.",
      );
    const backdropReplacement = instance.placement === "backdrop";
    const radii =
      backdropReplacement || instance.placement === "fill"
        ? ([0, 0, 0, 0, 0, 0, 0, 0] as const)
        : mount.outputExtent?.expanded
          ? ([0, 0, 0, 0, 0, 0, 0, 0] as const)
          : this.cornerRadii(mount);
    const clipRect = { x: 0, y: 0, width: mount.width, height: mount.height };
    const mask =
      backdropReplacement || mount.outputExtent?.expanded
        ? this.white!
        : await this.textMask(mount);
    const extent = mount.outputExtent;
    const transform = planNativeEffectTransform(instance.transform, {
      width: mount.width,
      height: mount.height,
      pixelRatio: mount.pixelRatio,
      target: {
        x: extent?.left ?? 0,
        y: extent?.top ?? 0,
        width: extent?.sourceWidth ?? mount.width,
        height: extent?.sourceHeight ?? mount.height,
      },
    });
    if (!transform.ok)
      throw new NativeSourceError(transform.code, transform.detail);
    const bind = this.bind(
      mount,
      "finish",
      pipeline,
      source,
      mask,
      new Float32Array([
        mount.width,
        mount.height,
        0,
        0,
        backdropReplacement ? 1 : instance.opacity,
        instance.clip === "text" &&
        (instance.placement === "fill" ||
          (instance.placement === "layer" && definition.kind === "processor"))
          ? 1
          : 0,
        0,
        0,
        clipRect.x,
        clipRect.y,
        clipRect.width,
        clipRect.height,
        ...radii,
        ...transform.rows[0],
        ...transform.rows[1],
      ]),
    );
    const pass = encoder.beginRenderPass({
      ...this.gpuTimestampWrites(encoder, "effect-finish"),
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
    pass.setBindGroup(0, bind);
    pass.draw(6);
    pass.end();
    return output;
  }

  private async mixFillGlyph(
    mount: Mount,
    effectAtUnitOpacity: GPUTexture,
    authoredOrPreviousGlyph: GPUTexture,
    opacity: number,
    encoder: GPUCommandEncoder,
  ): Promise<GPUTexture> {
    let output = mount.resourceTextures.get("__native_fill_text");
    if (!output) {
      output = this.texture(
        mount.width,
        mount.height,
        this.workingFormat,
        GPUTextureUsage.COPY_SRC,
      );
      mount.resourceTextures.set("__native_fill_text", output);
    }
    const pipeline =
      this.fillTextPipeline ??
      (await this.pipeline(fillTextMixWgsl, this.workingFormat));
    this.fillTextPipeline = pipeline;
    const bind = this.bind(
      mount,
      "fill-text-mix",
      pipeline,
      effectAtUnitOpacity,
      authoredOrPreviousGlyph,
      new Float32Array([
        mount.width,
        mount.height,
        opacity,
        this.colorPresented === "srgb" && this.dynamicRangePresented === "sdr"
          ? 1
          : 0,
      ]),
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
    pass.setBindGroup(0, bind);
    pass.draw(6);
    pass.end();
    return output;
  }

  private acquireFillOutput(
    mount: Mount,
    key: string,
    inputs: readonly GPUTexture[],
  ): GPUTexture {
    let output = mount.resourceTextures.get(key);
    if (output && output !== mount.outputTexture && !inputs.includes(output))
      return output;
    if (key !== "__native_final_back") {
      const back = mount.resourceTextures.get("__native_final_back");
      if (
        back &&
        back !== mount.outputTexture &&
        !inputs.includes(back) &&
        back.width === mount.width &&
        back.height === mount.height
      ) {
        mount.resourceTextures.delete("__native_final_back");
        mount.resourceTextures.set(key, back);
        return back;
      }
      if (back && back !== mount.outputTexture) {
        mount.resourceTextures.delete("__native_final_back");
        this.textureRetirement.push(back);
      }
    }
    if (output && output !== mount.outputTexture)
      this.textureRetirement.push(output);
    output = this.texture(
      mount.width,
      mount.height,
      this.workingFormat,
      GPUTextureUsage.COPY_SRC,
    );
    mount.resourceTextures.set(key, output);
    return output;
  }

  private async compositeFill(
    mount: Mount,
    foreground: GPUTexture,
    background: GPUTexture,
    encoder: GPUCommandEncoder,
    outputName = "__native_final_back",
  ): Promise<GPUTexture> {
    if (
      background !== this.transparent &&
      (background.width !== mount.width || background.height !== mount.height)
    )
      throw new NativeSourceError(
        "fill-background-size-mismatch",
        "The authored Fill background does not match its target.",
      );
    const output = this.acquireFillOutput(mount, outputName, [
      foreground,
      background,
    ]);
    const pipeline =
      this.fillCompositePipeline ??
      (await this.pipeline(fillCompositeWgsl, this.workingFormat));
    this.fillCompositePipeline = pipeline;
    const bind = this.bind(
      mount,
      "fill-composite",
      pipeline,
      foreground,
      background,
      new Float32Array([
        mount.width,
        mount.height,
        this.colorPresented === "srgb" && this.dynamicRangePresented === "sdr"
          ? 1
          : 0,
        0,
      ]),
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
    pass.setBindGroup(0, bind);
    pass.draw(6);
    pass.end();
    return output;
  }

  private async drawCoveredFillPhase(
    mount: Mount,
    encoder: GPUCommandEncoder,
    key: string,
    wgsl: string,
    first: GPUTexture,
    second: GPUTexture,
    extras: readonly GPUTexture[],
    initialBackground: boolean,
  ): Promise<GPUTexture> {
    for (const texture of [first, second, ...extras])
      if (
        texture !== this.transparent &&
        (texture.width !== mount.width || texture.height !== mount.height)
      )
        throw new NativeSourceError(
          "fill-phase-size-mismatch",
          "A captured Fill paint phase does not match its target extent.",
        );
    const output = this.acquireFillOutput(mount, key, [
      first,
      second,
      ...extras,
    ]);
    const pipeline = await this.pipeline(wgsl, this.workingFormat);
    const bind = this.bind(
      mount,
      key,
      pipeline,
      first,
      second,
      new Float32Array([
        mount.width,
        mount.height,
        initialBackground ? 1 : 0,
        0,
        this.colorPresented === "srgb" && this.dynamicRangePresented === "sdr"
          ? 1
          : 0,
        0,
        0,
        0,
      ]),
      this.sampler!,
      null,
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
    pass.setBindGroup(0, bind);
    pass.draw(6);
    pass.end();
    return output;
  }

  private preparePresentationPair(
    mount: Mount,
    device: GPUDevice,
  ): {
    pair: NativePresentationPair<GPUCanvasContext>;
    front: { canvas: HTMLCanvasElement; context: GPUCanvasContext };
    spare: { canvas: HTMLCanvasElement; context: GPUCanvasContext };
  } {
    const newPair = !mount.presentationPair;
    if (newPair) {
      this.ensureTextureBudget(mount.width * mount.height * 8);
      mount.presentationPair = new NativePresentationPair(
        { canvas: mount.canvas, context: mount.context },
        (front) => {
          const canvas = front.canvas.cloneNode(false) as HTMLCanvasElement;
          canvas.setAttribute("data-an-native-validation-surface", "");
          const context = canvas.getContext(
            "webgpu",
          ) as GPUCanvasContext | null;
          if (!context)
            throw new NativeSourceError(
              "presentation-spare-unavailable",
              "A second WebGPU canvas context is unavailable.",
            );
          return { canvas, context };
        },
        ({ context, canvas }) => {
          context.unconfigure();
          this.contextOwners.delete(context);
          canvas.remove();
        },
      );
    }
    const pair = mount.presentationPair!;
    try {
      const front = pair.visible();
      if (front.canvas !== mount.canvas || front.context !== mount.context)
        throw new NativeSourceError(
          "presentation-pair-stale",
          "The visible WebGPU canvas changed during the frame.",
        );
      const spare = pair.prepare();
      spare.canvas.style.opacity = front.canvas.style.opacity;
      if (front.canvas.hasAttribute("data-an-native-layer-opacity-owner"))
        spare.canvas.setAttribute(
          "data-an-native-layer-opacity-owner",
          "receiver",
        );
      else spare.canvas.removeAttribute("data-an-native-layer-opacity-owner");
      const configuredBefore = spare.context.getConfiguration();
      const capturePublished =
        this.presentationMirrorCapture &&
        mount.instance.id === REVIEWED_LOCAL_RUNTIME_TARGET?.instanceId;
      const requiredUsage =
        GPUTextureUsage.RENDER_ATTACHMENT |
        (capturePublished ? GPUTextureUsage.COPY_SRC : 0);
      if (
        this.contextOwners.get(spare.context) !== device ||
        (capturePublished &&
          ((configuredBefore?.usage ?? 0) & GPUTextureUsage.COPY_SRC) === 0) ||
        configuredBefore?.format !== this.format ||
        configuredBefore.alphaMode !== "premultiplied" ||
        configuredBefore.colorSpace !== this.colorPresented ||
        (this.dynamicRangePresented === "hdr" &&
          configuredBefore.toneMapping?.mode !== "extended")
      ) {
        spare.context.configure({
          device,
          format: this.format,
          usage: requiredUsage,
          alphaMode: "premultiplied",
          colorSpace: this.colorPresented,
          ...(this.dynamicRangePresented === "hdr"
            ? { toneMapping: { mode: "extended" as const } }
            : {}),
        });
        this.contextOwners.set(spare.context, device);
      }
      const configured = spare.context.getConfiguration();
      if (
        configured?.format !== this.format ||
        (capturePublished &&
          ((configured.usage ?? 0) & GPUTextureUsage.COPY_SRC) === 0) ||
        configured.alphaMode !== "premultiplied" ||
        configured.colorSpace !== this.colorPresented ||
        (this.dynamicRangePresented === "hdr" &&
          configured.toneMapping?.mode !== "extended")
      )
        throw new NativeSourceError(
          "presentation-spare-configuration-mismatch",
          "The hidden canvas cannot preserve the visible color and alpha contract.",
        );
      return { pair, front, spare };
    } catch (error) {
      if (newPair) {
        pair.dispose();
        mount.presentationPair = null;
      }
      throw error;
    }
  }

  private async present(
    mount: Mount,
    source: GPUTexture,
    encoder: GPUCommandEncoder,
    context: GPUCanvasContext = mount.context,
    publishedMirror?: GPUTexture,
  ): Promise<void> {
    const pipeline =
      this.presentPipeline ??
      (await this.pipeline(presentWgsl(this.colorPresented), this.format));
    this.presentPipeline = pipeline;
    const mask = this.white!;
    const bind = this.bind(
      mount,
      "present",
      pipeline,
      source,
      mask,
      new Float32Array([mount.width, mount.height, 0, 0, 1, 0, 0, 0]),
    );
    const presentedTexture = context.getCurrentTexture();
    const pass = encoder.beginRenderPass({
      ...this.gpuTimestampWrites(encoder, "effect-present"),
      colorAttachments: [
        {
          view: presentedTexture.createView(),
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
    if (publishedMirror)
      encoder.copyTextureToTexture(
        { texture: presentedTexture },
        { texture: publishedMirror },
        [mount.width, mount.height, 1],
      );
  }

  private alignedLayerSource(
    mount: Mount,
    previous: Mount,
    encoder: GPUCommandEncoder,
  ): GPUTexture {
    const prior = previous.outputTexture;
    const priorExtent = previous.outputExtent;
    const extent = mount.outputExtent;
    if (!prior || !priorExtent || !extent)
      throw new NativeSourceError(
        "effect-layer-dependency-unavailable",
        "The previous processor has no current GPU output.",
      );
    if (
      prior.width !== priorExtent.width ||
      prior.height !== priorExtent.height ||
      prior.format !== this.workingFormat
    )
      throw new NativeSourceError(
        "effect-layer-dependency-stale",
        "The previous processor output no longer matches its target geometry.",
      );
    const left = extent.left - priorExtent.left;
    const top = extent.top - priorExtent.top;
    if (
      left < 0 ||
      top < 0 ||
      left + prior.width > extent.width ||
      top + prior.height > extent.height
    )
      throw new NativeSourceError(
        "effect-layer-chain-geometry-invalid",
        "Chained processor output cannot be aligned within its next frame.",
      );
    if (
      left === 0 &&
      top === 0 &&
      prior.width === extent.width &&
      prior.height === extent.height
    )
      return prior;
    let aligned = mount.resourceTextures.get("source");
    if (
      aligned &&
      (aligned.width !== extent.width ||
        aligned.height !== extent.height ||
        aligned.format !== this.workingFormat)
    ) {
      mount.resourceTextures.delete("source");
      this.destroyTexture(aligned);
      aligned = undefined;
    }
    if (!aligned) {
      this.ensureCompositionBudget(mount, extent.width * extent.height * 8);
      aligned = this.texture(extent.width, extent.height);
      mount.resourceTextures.set("source", aligned);
    }
    const clear = encoder.beginRenderPass({
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
    encoder.copyTextureToTexture(
      { texture: prior },
      { texture: aligned, origin: [left, top, 0] },
      [prior.width, prior.height, 1],
    );
    return aligned;
  }

  private enclosingLayerMounts(target: Element): Mount[] {
    return [...this.mounts.values()].filter(
      (candidate) =>
        candidate.instance.placement === "layer" &&
        candidate.target !== target &&
        candidate.target.contains(target),
    );
  }

  private async stageGroupLocalBackdrop(
    parent: Mount,
    child: Mount,
    incoming: GPUTexture,
    originX: number,
    originY: number,
    sourceWidth: number,
    sourceHeight: number,
    encodedScene: boolean,
    encoder: GPUCommandEncoder,
    transaction: NestedBackdropTransaction,
    window?: NativeGroupLocalBackdropWindowPlan,
  ): Promise<GPUTexture> {
    if (child.frozenReason)
      throw new NativeSourceError(
        child.frozenReason.code,
        child.frozenReason.message,
      );
    if (
      this.mounts.get(child.instance.id) !== child ||
      this.enclosingLayerMounts(child.target).length !== 1 ||
      !this.enclosingLayerMounts(child.target).includes(parent)
    )
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    if (
      transaction.active.has(child.instance.id) ||
      transaction.staged.has(child.instance.id)
    )
      throw new NativeSourceError(
        "effect-dependency-cycle",
        "effect-dependency-cycle",
      );
    if (
      child.instance.placement !== "backdrop" ||
      child.definition.simulation ||
      child.definition.feedback ||
      child.previousLayerId ||
      child.previousFillId ||
      this.draft?.instanceId === child.instance.id ||
      this.instancePreview?.instanceId === child.instance.id
    )
      throw new NativeSourceError(
        "source-group-local-effect-unsupported",
        "source-group-local-effect-unsupported",
      );
    if (
      !parent.target.contains(child.target) ||
      !isCurrentNativeGroupLocalBackdropWindow(window, {
        incoming,
        output: { width: child.width, height: child.height },
        extent: child.outputExtent,
      }) ||
      originX !== window.sourceBox.x ||
      originY !== window.sourceBox.y ||
      sourceWidth !== window.sourceBox.width ||
      sourceHeight !== window.sourceBox.height
    )
      throw new NativeSourceError(
        "source-group-local-geometry-unsupported",
        "source-group-local-geometry-unsupported",
      );
    transaction.active.add(child.instance.id);
    try {
      let source = child.resourceTextures.get("__native_group_local_source");
      if (
        !source ||
        source.width !== child.width ||
        source.height !== child.height
      ) {
        this.ensureCompositionBudget(
          child,
          child.width *
            child.height *
            (this.workingFormat === "rgba16float" ? 8 : 4),
        );
        if (source) this.textureRetirement.push(source);
        source = this.texture(child.width, child.height);
        child.resourceTextures.set("__native_group_local_source", source);
      }
      const pipeline = await this.pipeline(
        groupLocalBackdropSourceWgsl,
        this.workingFormat,
        false,
        true,
      );
      const data = new Float32Array(window.packet);
      data[2] = encodedScene ? 1 : 0;
      const bind = this.bind(
        child,
        "group-local-backdrop-source",
        pipeline,
        incoming,
        this.white!,
        data,
      );
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: source.createView(),
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
      const childTime = transaction.deterministic
        ? child.instance.timing.time +
          (child.instance.timing.paused
            ? 0
            : transaction.time * child.instance.timing.speed)
        : child.clock.paused
          ? child.clock.local
          : child.clock.local +
            (transaction.time - child.clock.global) * child.clock.speed;
      const result = await this.effectPasses(
        child,
        source,
        childTime,
        encoder,
        child.definition,
        child.instance,
        transaction.deterministic,
        `group-local:${parent.instance.id}:${this.renderEpoch}`,
      );
      const finished = await this.finish(
        child,
        result,
        encoder,
        child.instance,
        child.definition,
        child.frameCount % 2 === 0
          ? "__native_group_local_final_a"
          : "__native_group_local_final_b",
      );
      await this.present(child, finished, encoder);
      transaction.staged.set(child.instance.id, {
        mount: child,
        texture: finished,
      });
      return finished;
    } finally {
      transaction.active.delete(child.instance.id);
    }
  }

  private async renderMount(
    mount: Mount,
    time: number,
    deterministic: boolean,
    complete: Set<string>,
    active: Set<string>,
  ): Promise<void> {
    if (complete.has(mount.instance.id)) return;
    if (mount.instance.placement === "backdrop") {
      const enclosingLayers = this.enclosingLayerMounts(mount.target);
      const enclosingLayer = enclosingLayers[0];
      if (enclosingLayer) {
        if (mount.frozenReason)
          throw new NativeSourceError(
            mount.frozenReason.code,
            mount.frozenReason.message,
          );
        if (enclosingLayers.length !== 1)
          throw new NativeSourceError(
            "source-group-local-chain-unsupported",
            "source-group-local-chain-unsupported",
          );
        if (active.has(enclosingLayer.instance.id))
          throw new NativeSourceError(
            "effect-dependency-cycle",
            "effect-dependency-cycle",
          );
        await this.renderMount(
          enclosingLayer,
          time,
          deterministic,
          complete,
          active,
        );
        if (
          !complete.has(mount.instance.id) &&
          this.groupLocalNoncontributing(mount)
        )
          return;
        if (!complete.has(mount.instance.id))
          throw new NativeSourceError(
            "native-dependency-missing",
            "native-dependency-missing",
          );
        return;
      }
    }
    if (mount.frozenReason) {
      if (deterministic || !mount.outputTexture)
        throw new NativeSourceError(
          mount.frozenReason.code,
          mount.frozenReason.message,
        );
      this.activeMounts.add(mount);
      complete.add(mount.instance.id);
      return;
    }
    mount.target.removeAttribute("data-an-native-culled");
    if (active.has(mount.instance.id))
      throw new Error(
        `Native effect dependency cycle at ${mount.instance.id}.`,
      );
    active.add(mount.instance.id);
    if (this.disposed)
      throw new Error(
        "The native shader runtime was disposed during rendering.",
      );
    const frameStarted = performance.now();
    const draft =
      this.draft?.instanceId === mount.instance.id && this.draft.showDraft
        ? this.draft
        : null;
    const activeInstance =
      draft?.instance ??
      (this.instancePreview?.instanceId === mount.instance.id
        ? this.instancePreview.instance
        : mount.instance);
    const activeDefinition = draft?.definition ?? mount.definition;
    if (usesRetiredNativeImageAbi(activeDefinition, activeInstance))
      throw new NativeSourceError(
        "legacy-image-abi-retired",
        "This saved image-sampling contract remains readable but is not executable.",
      );
    if (draft?.failedReason) {
      this.activeMounts.add(mount);
      if (deterministic)
        throw new NativeSourceError(
          draft.failedReason.code,
          draft.failedReason.message,
        );
      active.delete(mount.instance.id);
      complete.add(mount.instance.id);
      return;
    }
    let previousLayer: Mount | undefined;
    if (mount.previousLayerId) {
      previousLayer = this.mounts.get(mount.previousLayerId);
      if (!previousLayer) {
        active.delete(mount.instance.id);
        throw new NativeSourceError(
          "effect-layer-dependency-unavailable",
          `Layer dependency ${mount.previousLayerId} is not mounted.`,
        );
      }
      try {
        await this.renderMount(
          previousLayer,
          time,
          deterministic,
          complete,
          active,
        );
      } catch (error) {
        active.delete(mount.instance.id);
        throw error;
      }
      if (!previousLayer.outputTexture) {
        active.delete(mount.instance.id);
        throw new NativeSourceError(
          "effect-layer-dependency-unavailable",
          `Layer dependency ${mount.previousLayerId} has no GPU output.`,
        );
      }
    }
    let previousFill: Mount | undefined;
    if (mount.previousFillId) {
      previousFill = this.mounts.get(mount.previousFillId);
      if (!previousFill || previousFill.target !== mount.target)
        throw new NativeSourceError(
          "fill-dependency-unavailable",
          "An earlier Fill on this target is unavailable.",
        );
      await this.renderMount(
        previousFill,
        time,
        deterministic,
        complete,
        active,
      );
      if (!previousFill.outputTexture)
        throw new NativeSourceError(
          "fill-dependency-unavailable",
          "An earlier Fill has no GPU output.",
        );
    }
    const layerTargetOpacityDeferred =
      mount.instance.placement === "layer" &&
      [...this.mounts.values()].some(
        (candidate) =>
          candidate.target === mount.target &&
          candidate.instance.placement === "backdrop" &&
          !candidate.frozenReason,
      );
    mount.provider?.setLayerTargetOpacityDeferred(layerTargetOpacityDeferred);
    if (layerTargetOpacityDeferred) this.refreshAuthoredPaint(mount);
    const draftGeneration = draft?.generation;
    let sourceWallMs = 0;
    let composeWallMs = 0;
    const hostWallPhases = this.mountedBenchmarkRenderMetrics?.hostWallPhases;
    const layoutStarted = hostWallPhases ? performance.now() : 0;
    const visibleStyleBeforeLayout = mount.canvas.style.cssText;
    const visibleWidthBeforeLayout = mount.canvas.width;
    const visibleHeightBeforeLayout = mount.canvas.height;
    const mountWidthBeforeLayout = mount.width;
    const mountHeightBeforeLayout = mount.height;
    this.layout(mount);
    const assertCaptureOriginCurrent = (): void => {
      const current = nativeTargetOverflowInsets(mount.target);
      if (
        current.top !== mount.captureInsets.top ||
        current.right !== mount.captureInsets.right ||
        current.bottom !== mount.captureInsets.bottom ||
        current.left !== mount.captureInsets.left
      )
        throw new NativeSourceError(
          "source-capture-geometry-stale",
          "The target clip changed during native rendering.",
        );
    };
    const visibleLayoutUnchanged =
      mount.canvas.style.cssText === visibleStyleBeforeLayout &&
      mount.canvas.width === visibleWidthBeforeLayout &&
      mount.canvas.height === visibleHeightBeforeLayout &&
      mount.width === mountWidthBeforeLayout &&
      mount.height === mountHeightBeforeLayout;
    if (hostWallPhases)
      hostWallPhases.layoutCallWallMs += performance.now() - layoutStarted;
    this.activeMounts.add(mount);
    if (!mount.provider)
      throw new NativeSourceError(
        "source-provider-unavailable",
        "The native source provider is unavailable.",
      );
    mount.provider?.setDensity(mount.pixelRatio);
    const nestedChildren =
      mount.instance.placement === "layer"
        ? [...this.mounts.values()].filter(
            (candidate) =>
              candidate.instance.placement === "backdrop" &&
              candidate.target !== mount.target &&
              mount.target.contains(candidate.target),
          )
        : [];
    for (const child of nestedChildren) {
      if (child.frozenReason)
        throw new NativeSourceError(
          child.frozenReason.code,
          child.frozenReason.message,
        );
      const owners = this.enclosingLayerMounts(child.target);
      if (owners.length !== 1 || owners[0] !== mount)
        throw new NativeSourceError(
          "source-group-local-chain-unsupported",
          "source-group-local-chain-unsupported",
        );
    }
    if (
      nestedChildren.length &&
      (mount.previousLayerId ||
        mount.previousFillId ||
        mount.definition.simulation ||
        mount.definition.feedback)
    )
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    if (nestedChildren.length) {
      for (const child of nestedChildren) {
        this.layout(child);
        child.provider?.setDensity(child.pixelRatio);
      }
    }
    mount.provider.setGroupLocalBackdropSource(nestedChildren.length > 0);
    const device = this.device!;
    const deviceEpoch = this.deviceEpoch;
    const renderEpoch = this.renderEpoch;
    const instance = mount.instance;
    const definition = mount.definition;
    const presentationFormat = this.format;
    const presentationColor = this.colorPresented;
    const presentationRange = this.dynamicRangePresented;
    const assertCurrentPresentation = () => {
      if (
        this.disposed ||
        this.device !== device ||
        this.deviceEpoch !== deviceEpoch
      )
        throw new NativeSourceError(
          "device-lost",
          "The GPU device changed during this native frame.",
        );
      if (
        this.renderEpoch !== renderEpoch ||
        this.format !== presentationFormat ||
        this.colorPresented !== presentationColor ||
        this.dynamicRangePresented !== presentationRange ||
        this.mounts.get(instance.id) !== mount ||
        mount.instance !== instance ||
        mount.definition !== definition ||
        !mount.target.isConnected ||
        !mount.canvas.isConnected
      )
        throw new NativeSourceError(
          "presentation-frame-stale",
          "The native presentation target changed during this frame.",
        );
    };
    device.pushErrorScope("validation");
    let scopeOpen = true;
    let profiledEncoder: GPUCommandEncoder | null = null;
    let gpuSample: NativeGpuScopedSample | null = null;
    let profileSubmitted = false;
    let submitted = false;
    let frameResources: NativeFrameResourceScratch<GPUTexture> | null = null;
    let mirrorCandidate: GPUTexture | null = null;
    let unpublishedLayerState: {
      outputTexture: GPUTexture | null;
      fillTextTexture: GPUTexture | null;
      fillUnderlayTexture: GPUTexture | null;
      fillPhaseTexture: GPUTexture | null;
      fillBorderTexture: GPUTexture | null;
      fillOuterCoverageTexture: GPUTexture | null;
      fillInnerCoverageTexture: GPUTexture | null;
      frameCount: number;
      renderWallSamples: number[];
      attributes: Map<string, string>;
    } | null = null;
    const nestedTransaction: NestedBackdropTransaction | undefined =
      nestedChildren.length
        ? {
            time,
            deterministic,
            active,
            staged: new Map(),
            noncontributing: new Set(),
          }
        : undefined;
    const statelessFrame =
      !!(draft?.definition ?? mount.definition).statelessCompute ||
      nestedChildren.some((child) => !!child.definition.statelessCompute);
    const statelessAuthoredEpoch = statelessFrame
      ? mount.provider.authoredSourceEpoch?.()
      : undefined;
    const statelessApprovals = this.approvedHashes;
    const statelessApprovalStatus = this.approvalStatus;
    const nestedAuthoredEpoch = nestedTransaction
      ? mount.provider.authoredSourceEpoch?.()
      : undefined;
    const assertNestedChildren = () => {
      if (!nestedTransaction) return;
      const expected = new Set(
        nestedChildren.map((child) => child.instance.id),
      );
      for (const id of [
        ...nestedTransaction.staged.keys(),
        ...nestedTransaction.noncontributing,
      ])
        if (!expected.has(id))
          throw new NativeSourceError(
            "native-dependency-missing",
            "native-dependency-missing",
          );
      for (const child of nestedChildren) {
        const clipState = mount.provider!.groupLocalBackdropClipState(
          child.canvas,
        );
        const staged = nestedTransaction.staged.get(child.instance.id);
        const noncontributing = nestedTransaction.noncontributing.has(
          child.instance.id,
        );
        if (staged) {
          if (
            staged.mount !== child ||
            noncontributing ||
            clipState === "empty"
          )
            throw new NativeSourceError(
              "source-epoch-stale",
              "source-epoch-stale",
            );
        } else if (!noncontributing) {
          throw new NativeSourceError(
            "native-dependency-missing",
            "native-dependency-missing",
          );
        } else if (clipState !== "empty") {
          throw new NativeSourceError(
            "source-epoch-stale",
            "source-epoch-stale",
          );
        }
      }
    };
    try {
      const encoder = this.device!.createCommandEncoder();
      profiledEncoder = encoder;
      gpuSample = this.beginGpuSample(
        encoder,
        mount,
        deterministic,
        draft?.executionHash ?? mount.definitionHash,
        activeInstance,
      );
      let scene: NativeSourceRecord[] = [];
      let source: GPUTexture;
      let fillBackground: GPUTexture | null = null;
      let fillBorder: GPUTexture | null = null;
      let fillOuterCoverage: GPUTexture | null = null;
      let fillInnerCoverage: GPUTexture | null = null;
      let fillGlyphBase: GPUTexture | null = null;
      let fillGlyphResult: GPUTexture | null = null;
      let fillUnderlayResult: GPUTexture | null = null;
      let fillPhaseResult: GPUTexture | null = null;
      const textFill =
        mount.instance.placement === "fill" && activeInstance.clip === "text";
      let sourceRevision = "";
      if (previousLayer) {
        source = this.alignedLayerSource(mount, previousLayer, encoder);
        sourceRevision = `${previousLayer.instance.id}:${previousLayer.frameCount}`;
      } else if (mount.instance.placement === "fill") {
        source = this.transparent!;
        if (previousFill) {
          fillBackground = previousFill.fillUnderlayTexture;
          fillGlyphBase = previousFill.fillTextTexture;
          fillBorder = previousFill.fillBorderTexture;
          fillOuterCoverage = previousFill.fillOuterCoverageTexture;
          fillInnerCoverage = previousFill.fillInnerCoverageTexture;
          if (
            !fillBackground ||
            !fillBorder ||
            !fillOuterCoverage ||
            !fillInnerCoverage
          )
            throw new NativeSourceError(
              "fill-dependency-unavailable",
              "The previous Fill has no committed underlay texture.",
            );
          sourceRevision = `${previousFill.instance.id}:${previousFill.frameCount}`;
        } else {
          this.refreshAuthoredPaint(mount);
          if (!mount.authoredFillPaint)
            throw new NativeSourceError(
              "fill-background-unreadable",
              "The authored Fill box paint is unavailable.",
            );
          const sourceStarted = performance.now();
          const boxPhases = [
            "background",
            "border",
            "coverage",
            "inner-coverage",
          ] as const;
          const boxTextures: GPUTexture[] = [];
          for (const phase of boxPhases) {
            scene = await mount.provider!.readFillBoxPhase(
              mount.authoredFillPaint,
              phase,
            );
            if (scene.length !== 1 || !scene[0].source)
              throw new NativeSourceError(
                "fill-box-phase-unavailable",
                `The authored Fill ${phase} phase is unavailable.`,
              );
            sourceRevision += `${phase}:${scene[0].key}:${scene[0].revision}|`;
            boxTextures.push(this.upload(mount, scene[0]));
          }
          sourceWallMs += performance.now() - sourceStarted;
          [fillBackground, fillBorder, fillOuterCoverage, fillInnerCoverage] =
            boxTextures;
          if (mount.provider!.hasFillGlyph()) {
            const glyphStarted = performance.now();
            const glyphScene = await mount.provider!.readFillGlyph();
            sourceWallMs += performance.now() - glyphStarted;
            sourceRevision += `|glyph:${glyphScene.map((record) => `${record.key}:${record.revision}`).join("|")}`;
            fillGlyphBase = glyphScene.length
              ? await this.composeScene(
                  mount,
                  glyphScene,
                  encoder,
                  "__native_fill_glyph",
                  this.colorPresented === "srgb" &&
                    this.dynamicRangePresented === "sdr" &&
                    glyphScene.length > 1
                    ? "srgb-css-linear"
                    : "linear",
                )
              : this.transparent!;
          }
        }
      } else if (mount.provider) {
        const sourceStarted = performance.now();
        scene = await mount.provider.readScene();
        sourceWallMs += performance.now() - sourceStarted;
        let renderedDependency = false;
        for (const record of scene) {
          if (!record.nativeInstanceId) continue;
          const dependency = this.mounts.get(record.nativeInstanceId);
          if (!dependency)
            throw new Error(
              `Native source ${record.nativeInstanceId} is not mounted.`,
            );
          if (
            nestedTransaction &&
            dependency.instance.placement === "backdrop" &&
            dependency.target !== mount.target &&
            mount.target.contains(dependency.target)
          )
            continue;
          await this.renderMount(
            dependency,
            time,
            deterministic,
            complete,
            active,
          );
          renderedDependency = true;
        }
        if (renderedDependency) {
          const sourceStarted = performance.now();
          scene = await mount.provider.readScene();
          sourceWallMs += performance.now() - sourceStarted;
        }
        if (nestedTransaction) {
          const nativeIds = new Set(
            scene.flatMap((record) =>
              record.nativeInstanceId ? [record.nativeInstanceId] : [],
            ),
          );
          for (const child of nestedChildren) {
            if (nativeIds.has(child.instance.id)) continue;
            if (
              mount.provider.groupLocalBackdropClipState(child.canvas) !==
              "empty"
            )
              throw new NativeSourceError(
                "native-dependency-missing",
                "native-dependency-missing",
              );
            nestedTransaction.noncontributing.add(child.instance.id);
          }
        }
        sourceRevision = scene
          .map((record) => `${record.key}:${record.revision}`)
          .join("|");
        if (scene.length) {
          const composeStarted = performance.now();
          source = await this.composeScene(
            mount,
            scene,
            encoder,
            "source",
            this.colorPresented === "srgb" &&
              this.dynamicRangePresented === "sdr" &&
              scene.length > 1
              ? "srgb-css-linear"
              : "linear",
            nestedTransaction,
          );
          composeWallMs += performance.now() - composeStarted;
        } else source = this.transparent!;
      } else source = this.transparent!;
      if (this.disposed)
        throw new Error(
          "The native shader runtime was disposed during source acquisition.",
        );
      const localTime = draft
        ? draft.playing
          ? (performance.now() - draft.clockOrigin) / 1000
          : draft.time
        : deterministic
          ? mount.instance.timing.time +
            (mount.instance.timing.paused
              ? 0
              : time * mount.instance.timing.speed)
          : mount.clock.paused
            ? mount.clock.local
            : mount.clock.local +
              (time - mount.clock.global) * mount.clock.speed;
      const sourceEpoch = mount.provider?.sourceEpoch?.();

      const assertStatelessCurrent = () => {
        if (!statelessFrame) return;
        assertCurrentPresentation();
        if (
          statelessAuthoredEpoch === undefined ||
          mount.provider?.authoredSourceEpoch?.() !== statelessAuthoredEpoch ||
          sourceEpoch === undefined ||
          mount.provider?.sourceEpoch?.() !== sourceEpoch ||
          this.approvedHashes !== statelessApprovals ||
          this.approvalStatus !== statelessApprovalStatus
        )
          throw new NativeSourceError(
            "stateless-compute-frame-invalid",
            "stateless-compute-frame-invalid",
          );
      };
      const detachedCandidate =
        sourceEpoch !== undefined &&
        !mount.provider!.needsContinuousFrames() &&
        mount.isTopLayer &&
        visibleLayoutUnchanged &&
        mount.instance.placement === "layer" &&
        mount.suppressed &&
        mount.canvas.isConnected &&
        mount.canvas.style.visibility === "visible" &&
        !this.compositionAbort &&
        !this.compositionPixelBusy &&
        !mount.previousLayerId &&
        !mount.previousFillId &&
        !mount.definition.simulation &&
        !mount.definition.feedback &&
        !draft &&
        !!mount.outputTexture &&
        mount.outputTexture.width === mount.width &&
        mount.outputTexture.height === mount.height &&
        canDetachPresentationFromSources(scene);
      if (detachedCandidate) {
        unpublishedLayerState = {
          outputTexture: mount.outputTexture,
          fillTextTexture: mount.fillTextTexture,
          fillUnderlayTexture: mount.fillUnderlayTexture,
          fillPhaseTexture: mount.fillPhaseTexture,
          fillBorderTexture: mount.fillBorderTexture,
          fillOuterCoverageTexture: mount.fillOuterCoverageTexture,
          fillInnerCoverageTexture: mount.fillInnerCoverageTexture,
          frameCount: mount.frameCount,
          renderWallSamples: [...mount.renderWallSamples],
          attributes: new Map(
            mount.target
              .getAttributeNames()
              .filter((name) => name.startsWith("data-an-native-"))
              .map((name) => [name, mount.target.getAttribute(name)!]),
          ),
        };
        frameResources = new NativeFrameResourceScratch(
          mount.resourceTextures,
          source === mount.resourceTextures.get("source") ? ["source"] : [],
        );
        mount.resourceTextures = frameResources.scratch;
      }
      const effectPassesStarted = hostWallPhases ? performance.now() : 0;
      const output = await this.effectPasses(
        mount,
        source,
        localTime,
        encoder,
        draft?.definition,
        activeInstance,
        deterministic,
        sourceRevision,
      );
      if (hostWallPhases)
        hostWallPhases.effectPassesWallMs +=
          performance.now() - effectPassesStarted;
      if (draft && this.draftGeneration !== draftGeneration)
        throw new NativeSourceError(
          "draft-superseded",
          "A newer draft request replaced this GPU frame.",
        );
      if (this.disposed)
        throw new Error(
          "The native shader runtime was disposed during effect rendering.",
        );
      const finishStarted = hostWallPhases ? performance.now() : 0;
      const foreground = await this.finish(
        mount,
        output,
        encoder,
        textFill ? { ...activeInstance, opacity: 1 } : activeInstance,
        draft?.definition ?? mount.definition,
        fillBackground ? "__native_fill_foreground" : "__native_final_back",
      );
      if (hostWallPhases)
        hostWallPhases.finishWallMs += performance.now() - finishStarted;
      let finished = foreground;
      if (mount.instance.placement === "fill") {
        if (
          !fillBackground ||
          !fillBorder ||
          !fillOuterCoverage ||
          !fillInnerCoverage
        )
          throw new NativeSourceError(
            "fill-background-unavailable",
            "The authored Fill box phases are required.",
          );
        fillUnderlayResult = await this.drawCoveredFillPhase(
          mount,
          encoder,
          "__native_fill_underlay",
          fillCoveredUnderlayWgsl,
          textFill ? this.transparent! : foreground,
          fillBackground,
          [fillOuterCoverage, fillInnerCoverage],
          !previousFill,
        );
        if (textFill) {
          fillGlyphResult = await this.mixFillGlyph(
            mount,
            foreground,
            fillGlyphBase ?? this.transparent!,
            activeInstance.opacity,
            encoder,
          );
        } else {
          fillGlyphResult = fillGlyphBase;
        }
        let childScene: NativeSourceRecord[] = [];
        if (mount.isTopLayer) {
          const childStarted = performance.now();
          childScene = await mount.provider!.readFillForeground();
          sourceWallMs += performance.now() - childStarted;
          let hasNativeDependency = false;
          for (const record of childScene) {
            if (!record.nativeInstanceId) continue;
            const dependency = this.mounts.get(record.nativeInstanceId);
            if (!dependency)
              throw new NativeSourceError(
                "fill-child-unavailable",
                "A Fill foreground has an unavailable native child.",
              );
            await this.renderMount(
              dependency,
              time,
              deterministic,
              complete,
              active,
            );
            hasNativeDependency = true;
          }
          if (hasNativeDependency)
            childScene = await mount.provider!.readFillForeground();
        }
        if (mount.isTopLayer) {
          const box = await this.drawCoveredFillPhase(
            mount,
            encoder,
            "__native_fill_box",
            fillCoveredBoxWgsl,
            fillUnderlayResult,
            fillBorder,
            [fillOuterCoverage],
            false,
          );
          fillPhaseResult = await this.compositeFill(
            mount,
            fillGlyphResult ?? this.transparent!,
            box,
            encoder,
            childScene.length ? "__native_fill_phase" : "__native_final_back",
          );
          if (childScene.length) {
            const childStarted = performance.now();
            const childTexture = await this.composeScene(
              mount,
              childScene,
              encoder,
              "__native_fill_child",
              this.colorPresented === "srgb" &&
                this.dynamicRangePresented === "sdr" &&
                childScene.length > 1
                ? "srgb-css-linear"
                : "linear",
            );
            composeWallMs += performance.now() - childStarted;
            finished = await this.compositeFill(
              mount,
              childTexture,
              fillPhaseResult,
              encoder,
            );
          } else finished = fillPhaseResult;
        } else finished = fillUnderlayResult;
      }
      if (draft && this.draftGeneration !== draftGeneration)
        throw new NativeSourceError(
          "draft-superseded",
          "A newer draft request replaced this GPU frame.",
        );
      if (frameResources && !detachedCandidate)
        throw new NativeSourceError(
          "presentation-frame-stale",
          "The detached presentation source changed during the frame.",
        );
      const twoSurface = detachedCandidate
        ? this.preparePresentationPair(mount, device)
        : null;
      const presentStarted = hostWallPhases ? performance.now() : 0;
      if (this.presentationMirrorCapture) {
        if (
          !twoSurface ||
          mount.instance.id !== REVIEWED_LOCAL_RUNTIME_TARGET?.instanceId
        )
          throw new NativeSourceError(
            "presentation-fault-mirror-ineligible",
            "The reviewed GPU presentation mirror requires a detached Layer.",
          );
        planNativePresentationReadback({
          width: mount.width,
          height: mount.height,
          format: this.format,
          colorSpace: this.colorPresented,
          dynamicRange: this.dynamicRangePresented,
        });
        mirrorCandidate = this.texture(
          mount.width,
          mount.height,
          this.format,
          GPUTextureUsage.COPY_SRC,
        );
        this.publishedPresentationMirror.stage(mirrorCandidate);
      }
      if (mount.isTopLayer)
        await this.present(
          mount,
          finished,
          encoder,
          twoSurface?.spare.context ?? mount.context,
          mirrorCandidate ?? undefined,
        );
      if (hostWallPhases)
        hostWallPhases.presentWallMs += performance.now() - presentStarted;
      if (twoSurface) assertCurrentPresentation();
      if (gpuSample) this.gpuProfiler?.finishSample(gpuSample, encoder);
      if (nestedTransaction) {
        if (mount.provider.authoredSourceEpoch?.() !== nestedAuthoredEpoch)
          throw new NativeSourceError(
            "source-epoch-stale",
            "source-epoch-stale",
          );
        for (const child of nestedChildren) {
          if (child.frozenReason)
            throw new NativeSourceError(
              child.frozenReason.code,
              child.frozenReason.message,
            );
          const owners = this.enclosingLayerMounts(child.target);
          if (
            this.mounts.get(child.instance.id) !== child ||
            owners.length !== 1 ||
            owners[0] !== mount
          )
            throw new NativeSourceError(
              "source-group-local-chain-unsupported",
              "source-group-local-chain-unsupported",
            );
        }
      }
      assertNestedChildren();
      const submitStarted = hostWallPhases ? performance.now() : 0;
      assertCaptureOriginCurrent();
      assertStatelessCurrent();
      device.queue.submit([encoder.finish()]);
      if (hostWallPhases)
        hostWallPhases.submitCallWallMs += performance.now() - submitStarted;
      submitted = true;
      if (gpuSample) {
        this.gpuProfiler?.afterSubmit(gpuSample);
        profileSubmitted = true;
      }
      const errorScopeStarted = hostWallPhases ? performance.now() : 0;
      const gpuError = await device.popErrorScope();
      if (hostWallPhases)
        hostWallPhases.errorScopeWallMs +=
          performance.now() - errorScopeStarted;
      scopeOpen = false;
      if (gpuError) {
        if (mount.outputTexture && mount.isTopLayer && !twoSurface) {
          const recovery = device.createCommandEncoder();
          await this.present(mount, mount.outputTexture, recovery);
          device.queue.submit([recovery.finish()]);
        }
        throw new NativeSourceError(
          "gpu-validation",
          `WebGPU rejected effect ${mount.instance.id}: ${gpuError.message}`,
        );
      }
      if (
        nestedTransaction &&
        (mount.provider.authoredSourceEpoch?.() !== nestedAuthoredEpoch ||
          this.renderEpoch !== renderEpoch ||
          this.device !== device)
      )
        throw new NativeSourceError("source-epoch-stale", "source-epoch-stale");
      for (const child of nestedChildren) {
        if (child.frozenReason)
          throw new NativeSourceError(
            child.frozenReason.code,
            child.frozenReason.message,
          );
        const owners = this.enclosingLayerMounts(child.target);
        if (
          this.mounts.get(child.instance.id) !== child ||
          owners.length !== 1 ||
          owners[0] !== mount
        )
          throw new NativeSourceError(
            "source-group-local-chain-unsupported",
            "source-group-local-chain-unsupported",
          );
      }
      assertNestedChildren();
      assertCaptureOriginCurrent();
      if (twoSurface) {
        assertCurrentPresentation();
        if (mount.provider?.sourceEpoch?.() !== sourceEpoch)
          throw new NativeSourceError(
            "source-epoch-stale",
            "The authored source changed during GPU validation.",
          );
        twoSurface.pair.assertPublishable(twoSurface.front, twoSurface.spare);
        if (this.presentationFaultLatch.pending()) {
          const fault = this.presentationFaultLatch.consume({
            instanceId: mount.instance.id,
            nodeId: mount.instance.nodeId,
            definitionId: mount.definition.id,
            definitionVersion: mount.definition.version,
            executionHash: await hashEffectDefinition(mount.definition),
            runtimeSha256: this.presentationFaultRuntimeHash ?? "",
            now: Date.now(),
            scopeDrained: !scopeOpen,
            submitted,
            visibleOutputExists: !!unpublishedLayerState?.outputTexture,
            eligibleTwoSurface: !!frameResources && !!unpublishedLayerState,
          });
          if (fault) {
            this.presentationFaultTriggered = true;
            throw new NativeSourceError(
              "gpu-validation",
              `Local QA ${fault} after a settled GPU validation scope.`,
            );
          }
        }
      }
      assertStatelessCurrent();
      const postSubmitStarted = hostWallPhases ? performance.now() : 0;
      if (mount.feedbackFrame) {
        const frame = mount.feedbackFrame;
        const feedback = mount.feedback!;
        mount.feedbackFrame = null;
        const retirement = frame.commit();
        mount.simulationCaughtUp = true;
        this.reflectCommittedFeedbackTelemetry(mount);
        feedback.sourceRevision = feedback.pendingSourceRevision ?? "";
        feedback.pendingSourceRevision = null;
        feedback.retirements.add(retirement);
        void retirement.then(
          () => feedback.retirements.delete(retirement),
          (error) => {
            feedback.retirements.delete(retirement);
            this.issue(
              "feedback-device-lost",
              String(error),
              mount.instance.id,
            );
          },
        );
      }
      const prior = mount.outputTexture;
      mount.outputTexture = finished;
      if (mount.instance.placement === "layer") {
        mount.layerSourceOpacityDeferred = layerTargetOpacityDeferred;
        if (layerTargetOpacityDeferred)
          mount.canvas.setAttribute(
            "data-an-native-layer-opacity-owner",
            "receiver",
          );
        else mount.canvas.removeAttribute("data-an-native-layer-opacity-owner");
      }
      mount.fillTextTexture = fillGlyphResult;
      mount.fillUnderlayTexture = fillUnderlayResult;
      mount.fillPhaseTexture = fillPhaseResult;
      mount.fillBorderTexture = fillBorder;
      mount.fillOuterCoverageTexture = fillOuterCoverage;
      mount.fillInnerCoverageTexture = fillInnerCoverage;
      if (prior === finished) {
        mount.resourceTextures.delete("__native_final_back");
      } else if (draft && !draft.publishedTexture && prior) {
        draft.publishedTexture = prior;
        mount.resourceTextures.delete("__native_final_back");
      } else if (
        prior &&
        prior.width === mount.width &&
        prior.height === mount.height
      )
        mount.resourceTextures.set("__native_final_back", prior);
      else {
        if (prior) this.textureRetirement.push(prior);
        mount.resourceTextures.delete("__native_final_back");
      }
      const liveResources = new Set([
        ...(source === mount.resourceTextures.get("source") ||
        fillBackground === mount.resourceTextures.get("source")
          ? ["source"]
          : []),
        "__native_final_back",
        ...(fillBackground ? ["__native_fill_foreground"] : []),
        ...(fillUnderlayResult ? ["__native_fill_underlay"] : []),
        ...(mount.isTopLayer && mount.resourceTextures.has("__native_fill_box")
          ? ["__native_fill_box"]
          : []),
        ...(fillPhaseResult ? ["__native_fill_phase"] : []),
        ...(mount.isTopLayer &&
        mount.resourceTextures.has("__native_fill_child")
          ? ["__native_fill_child"]
          : []),
        ...(fillGlyphResult ? ["__native_fill_text"] : []),
        ...(fillGlyphBase === mount.resourceTextures.get("__native_fill_glyph")
          ? ["__native_fill_glyph"]
          : []),
        ...(mount.inputMaskUsedFrame === this.renderEpoch
          ? ["__native_input_mask"]
          : []),
        ...(mount.definition.simulation ? ["__native_trail_back"] : []),
        ...(draft?.definition ?? mount.definition).passes.map(
          (pass) => pass.output,
        ),
      ]);
      for (const [name, texture] of mount.resourceTextures)
        if (!liveResources.has(name)) {
          mount.resourceTextures.delete(name);
          this.textureRetirement.push(texture);
        }
      for (const [name, entry] of mount.isolationTextures)
        if (entry.lastFrame !== this.renderEpoch) {
          mount.isolationTextures.delete(name);
          this.textureRetirement.push(entry.texture);
        }
      for (const [url, entry] of mount.assetTextures)
        if (entry.lastFrame !== this.renderEpoch) {
          mount.assetTextures.delete(url);
          this.textureRetirement.push(entry.texture);
        }
      if (
        !twoSurface &&
        !(
          mount.instance.placement === "layer" &&
          !mount.isTopLayer &&
          mount.layerOpacityModeTransitionPending
        )
      )
        this.suppressOriginal(mount);
      if (mount.instance.placement === "layer" && mount.isTopLayer)
        for (const candidate of this.mounts.values())
          if (
            candidate.target === mount.target &&
            candidate.instance.placement === "layer"
          ) {
            if (
              candidate !== mount &&
              candidate.layerOpacityModeTransitionPending &&
              candidate.outputTexture
            )
              candidate.suppressed = true;
            candidate.layerOpacityModeTransitionPending = false;
          }
      mount.target.setAttribute(
        "data-an-native-status",
        mount.simulationCaughtUp ? "ready" : "last-good",
      );
      if (mount.simulationCaughtUp) {
        mount.target.removeAttribute("data-an-native-error");
        mount.target.removeAttribute("data-an-native-error-message");
      } else {
        mount.target.setAttribute(
          "data-an-native-error",
          "simulation-catching-up",
        );
        mount.target.setAttribute(
          "data-an-native-error-message",
          "Particle simulation is still catching up to the presentation clock.",
        );
      }
      mount.frameCount += 1;
      mount.target.setAttribute(
        "data-an-native-frames",
        String(mount.frameCount),
      );
      mount.target.setAttribute(
        "data-an-native-captures",
        String(mount.provider?.captureCount() ?? 0),
      );
      mount.target.setAttribute("data-an-native-sources", String(scene.length));
      mount.target.setAttribute(
        "data-an-native-image-rasters",
        String(mount.imageRasters),
      );
      mount.target.setAttribute(
        "data-an-native-source-downsamples",
        String(mount.sourceDownsamples),
      );
      mount.target.setAttribute(
        "data-an-native-passes",
        String((draft?.definition ?? mount.definition).passes.length),
      );
      if (hostWallPhases)
        hostWallPhases.postSubmitWallMs +=
          performance.now() - postSubmitStarted;
      const renderWallMs = performance.now() - frameStarted;
      mount.renderWallSamples.push(renderWallMs);
      if (mount.renderWallSamples.length > 60) mount.renderWallSamples.shift();
      mount.target.setAttribute(
        "data-an-native-render-wall-ms",
        renderWallMs.toFixed(2),
      );
      mount.target.setAttribute(
        "data-an-native-render-wall-average-ms",
        (
          mount.renderWallSamples.reduce((sum, value) => sum + value, 0) /
          mount.renderWallSamples.length
        ).toFixed(2),
      );
      if (this.mountedBenchmarkRenderMetrics) {
        this.mountedBenchmarkRenderMetrics.sourceWallMs += sourceWallMs;
        this.mountedBenchmarkRenderMetrics.composeWallMs += composeWallMs;
      }
      mount.target.setAttribute(
        "data-an-native-source-wall-ms",
        sourceWallMs.toFixed(2),
      );
      mount.target.setAttribute(
        "data-an-native-compose-wall-ms",
        composeWallMs.toFixed(2),
      );
      mount.target.setAttribute(
        "data-an-native-other-wall-ms",
        Math.max(0, renderWallMs - sourceWallMs - composeWallMs).toFixed(2),
      );
      mount.target.setAttribute(
        "data-an-native-texture-bytes",
        String(this.allocatedTextureBytes),
      );
      if (twoSurface) {
        assertCurrentPresentation();
        if (mount.provider?.sourceEpoch?.() !== sourceEpoch)
          throw new NativeSourceError(
            "source-epoch-stale",
            "The authored source changed before presentation.",
          );
        const staleResources = frameResources!.retiredOnCommit();
        const front = twoSurface.pair.publish(
          twoSurface.front,
          twoSurface.spare,
        );
        mount.canvas = front.canvas;
        mount.context = front.context;
        frameResources!.commit();
        if (mirrorCandidate) {
          this.publishedPresentationMirror.commit();
          mirrorCandidate = null;
        }
        frameResources = null;
        unpublishedLayerState = null;
        for (const texture of staleResources)
          if (!this.textureRetirement.includes(texture))
            this.textureRetirement.push(texture);
      }
      if (mount.instance.placement === "layer") {
        if (nestedTransaction)
          mount.target.setAttribute(
            "data-an-native-layer-group-local-source",
            "",
          );
        else
          mount.target.removeAttribute(
            "data-an-native-layer-group-local-source",
          );
        mount.groupLocalCommittedChildren = new Set(
          nestedTransaction?.staged.keys() ?? [],
        );
        mount.groupLocalNoncontributingChildren = new Set(
          nestedTransaction?.noncontributing ?? [],
        );
      }
      for (const {
        mount: child,
        texture,
      } of nestedTransaction?.staged.values() ?? []) {
        const previous = child.outputTexture;
        child.outputTexture = texture;
        if (previous && previous !== texture) {
          for (const [name, resource] of child.resourceTextures)
            if (resource === previous) child.resourceTextures.delete(name);
          this.textureRetirement.push(previous);
        }
        child.frameCount += 1;
        this.activeMounts.add(child);
        this.suppressOriginal(child);
        child.target.setAttribute(
          "data-an-native-frames",
          String(child.frameCount),
        );
        complete.add(child.instance.id);
      }
      active.delete(mount.instance.id);
      complete.add(mount.instance.id);
      try {
        for (const { mount: child } of nestedTransaction?.staged.values() ?? [])
          this.postStatus(child.instance.id, child.instance.nodeId, "ready");
        this.postStatus(
          mount.instance.id,
          mount.instance.nodeId,
          mount.simulationCaughtUp ? "ready" : "last-good",
          mount.simulationCaughtUp
            ? undefined
            : {
                code: "simulation-catching-up",
                message: "simulation-catching-up",
              },
        );
      } catch (error) {
        if (!twoSurface) throw error;
        this.issue("status-post-failed", String(error), mount.instance.id);
      }
    } catch (error) {
      if (mirrorCandidate) this.publishedPresentationMirror.discard();
      if (frameResources) {
        mount.resourceTextures = frameResources.committed;
        for (const texture of frameResources.rollback())
          if (!this.textureRetirement.includes(texture))
            this.textureRetirement.push(texture);
        if (unpublishedLayerState) {
          mount.outputTexture = unpublishedLayerState.outputTexture;
          mount.fillTextTexture = unpublishedLayerState.fillTextTexture;
          mount.fillUnderlayTexture = unpublishedLayerState.fillUnderlayTexture;
          mount.fillPhaseTexture = unpublishedLayerState.fillPhaseTexture;
          mount.fillBorderTexture = unpublishedLayerState.fillBorderTexture;
          mount.fillOuterCoverageTexture =
            unpublishedLayerState.fillOuterCoverageTexture;
          mount.fillInnerCoverageTexture =
            unpublishedLayerState.fillInnerCoverageTexture;
          mount.frameCount = unpublishedLayerState.frameCount;
          mount.renderWallSamples = unpublishedLayerState.renderWallSamples;
          for (const name of mount.target.getAttributeNames())
            if (name.startsWith("data-an-native-"))
              mount.target.removeAttribute(name);
          for (const [name, value] of unpublishedLayerState.attributes)
            mount.target.setAttribute(name, value);
        }
      }
      if (mount.definition.simulation) this.releaseSimulation(mount);
      const feedbackFrame = mount.feedbackFrame;
      mount.feedbackFrame = null;
      if (mount.feedback) mount.feedback.pendingSourceRevision = null;
      let feedbackFailure: unknown;
      if (feedbackFrame)
        try {
          if (submitted) {
            await feedbackFrame.rejectSubmitted(error);
            this.releaseFeedback(mount);
          } else feedbackFrame.abandon();
        } catch (cleanupError) {
          feedbackFailure = cleanupError;
          this.releaseFeedback(mount);
        }
      if (scopeOpen) {
        const scopeError = await device.popErrorScope();
        if (scopeError)
          throw new NativeSourceError(
            "gpu-validation",
            `WebGPU rejected effect ${mount.instance.id}: ${scopeError.message}`,
          );
      }
      if (feedbackFailure)
        throw new NativeSourceError(
          "feedback-cleanup-failed",
          `Feedback frame failed and its GPU resources could not retire: ${String(error)}; ${String(feedbackFailure)}`,
        );
      throw error;
    } finally {
      if (profiledEncoder) {
        this.settleStatelessFrames(profiledEncoder, submitted);
        this.gpuSamples.delete(profiledEncoder);
      }
      if (gpuSample && !profileSubmitted)
        this.gpuProfiler?.abandonSample(gpuSample);
    }
  }

  private currentTime(): number {
    return this.timeOverride ?? (performance.now() - this.clockOrigin) / 1000;
  }

  playbackState = (
    instanceId: string,
  ): {
    timeSeconds: number;
    playing: boolean;
    instanceLocalTimeSeconds: number;
    instancePaused: boolean;
  } => {
    const mount = this.mounts.get(instanceId);
    if (!mount)
      throw new NativeSourceError(
        "instance-not-mounted",
        `Native effect ${instanceId} is not mounted.`,
      );
    const timeSeconds = this.currentTime();
    return {
      timeSeconds,
      playing: this.playing,
      instanceLocalTimeSeconds: mount.clock.paused
        ? mount.clock.local
        : mount.clock.local +
          (timeSeconds - mount.clock.global) * mount.clock.speed,
      instancePaused: mount.clock.paused,
    };
  };

  private renderInternal = async (
    time: number,
    deterministic: boolean,
  ): Promise<NativeRenderResult> => {
    if (!Number.isFinite(time) || time < 0)
      throw new Error("Native shader time must be a finite nonnegative value.");
    assertNativeUniformTiming(time, "time");
    if (this.disposed)
      throw new NativeRenderFailure({
        time,
        rendered: 0,
        failures: [
          {
            code: "runtime-disposed",
            message: "runtime-disposed",
          },
        ],
        renderWallMs: 0,
      });
    if (this.mounts.size === 0)
      return {
        time,
        rendered: 0,
        failures: [...this.scanFailures],
        renderWallMs: 0,
      };
    if (this.running) await this.running;
    if (this.disposed)
      throw new NativeSourceError("runtime-disposed", "runtime-disposed");
    const benchmarkMetrics = this.mountedBenchmark
      ? {
          sourceWallMs: 0,
          composeWallMs: 0,
          hostWallPhases: emptyNativeBenchmarkPhaseValues(),
          fullFrameWallPhases: emptyNativeBenchmarkFullFrameValues(),
        }
      : null;
    this.mountedBenchmarkRenderMetrics = benchmarkMetrics;
    this.running = (async () => {
      const started = performance.now();
      const failures: Diagnostic[] = deterministic
        ? [...this.scanFailures]
        : [];
      const complete = new Set<string>();
      try {
        this.renderEpoch += 1;
        const deviceStarted = benchmarkMetrics ? performance.now() : 0;
        await this.ensureDevice();
        if (benchmarkMetrics) {
          const deviceWallMs = performance.now() - deviceStarted;
          benchmarkMetrics.hostWallPhases.deviceWallMs += deviceWallMs;
          benchmarkMetrics.fullFrameWallPhases.frame.deviceWallMs +=
            deviceWallMs;
        }
        const mountsStarted = benchmarkMetrics ? performance.now() : 0;
        for (const mount of this.mounts.values()) {
          if (!deterministic && this.offscreen(mount)) {
            mount.target.setAttribute("data-an-native-culled", "true");
            continue;
          }
          try {
            await this.renderMount(
              mount,
              time,
              deterministic,
              complete,
              new Set(),
            );
          } catch (error) {
            if (this.disposed) {
              failures.push({
                code: "runtime-disposed",
                message: "runtime-disposed",
                instanceId: mount.instance.id,
              });
              break;
            }
            if (mount.instance.placement === "fill")
              this.restoreFillGroup(mount.target);
            else if (!mount.outputTexture) this.showOriginal(mount);
            const diagnostic = {
              code:
                error instanceof NativeSourceError
                  ? error.code
                  : error instanceof NativeFeedbackFailure ||
                      error instanceof NativeUniformTimingError
                    ? error.code
                    : "render-failed",
              message: error instanceof Error ? error.message : String(error),
              instanceId: mount.instance.id,
            };
            failures.push({
              ...diagnostic,
              ...(error instanceof NativeShaderCompilationError
                ? {
                    passId: error.issues[0]?.passId,
                    line: error.issues[0]?.line,
                    column: error.issues[0]?.column,
                    issues: error.issues.slice(0, 16),
                  }
                : {}),
            });
            const requiresScene = [...this.mounts.values()].some(
              (candidate) => candidate.instance.placement === "backdrop",
            );
            const failedStatus =
              mount.instance.placement === "fill" ||
              !mount.suppressed ||
              (requiresScene &&
                !this.scenePresentation?.committedInstances.has(
                  mount.instance.id,
                ))
                ? "error"
                : "last-good";
            mount.target.setAttribute("data-an-native-status", failedStatus);
            mount.target.setAttribute("data-an-native-error", diagnostic.code);
            mount.target.setAttribute(
              "data-an-native-error-message",
              diagnostic.message.slice(0, 300),
            );
            this.issue(diagnostic.code, diagnostic.message, mount.instance.id);
            this.postStatus(
              mount.instance.id,
              mount.instance.nodeId,
              failedStatus,
              diagnostic,
            );
          }
        }
        if (benchmarkMetrics)
          benchmarkMetrics.fullFrameWallPhases.frame.mountAwaitWallMs +=
            performance.now() - mountsStarted;
        const hasBackdrop = [...this.mounts.values()].some(
          (mount) => mount.instance.placement === "backdrop",
        );
        if (!hasBackdrop) this.releaseScenePresentation();
        else if (failures.length > 0) {
          const committed = this.scenePresentation?.committedInstances;
          for (const mounted of this.mounts.values()) {
            if (mounted.reportedStatus?.status !== "ready") continue;
            if (
              !this.scenePresentation &&
              mounted.isTopLayer &&
              mounted.suppressed &&
              mounted.outputTexture &&
              nativePresentationVisible(mounted.canvas, {
                width: innerWidth,
                height: innerHeight,
              })
            )
              continue;
            const status = committed?.has(mounted.instance.id)
              ? "last-good"
              : "error";
            mounted.target.setAttribute("data-an-native-status", status);
            mounted.target.setAttribute(
              "data-an-native-error",
              "scene-frame-incomplete",
            );
            this.postStatus(
              mounted.instance.id,
              mounted.instance.nodeId,
              status,
              {
                code: "scene-frame-incomplete",
                message: "scene-frame-incomplete",
                instanceId: mounted.instance.id,
              },
            );
          }
          if (!this.scenePresentation) this.releaseScenePresentation();
        } else {
          const sceneStarted = benchmarkMetrics ? performance.now() : 0;
          try {
            await this.presentScene();
          } finally {
            if (benchmarkMetrics)
              benchmarkMetrics.fullFrameWallPhases.frame.scenePresentationWallMs +=
                performance.now() - sceneStarted;
          }
        }

        if (
          this.disposed &&
          !failures.some((failure) => failure.code === "runtime-disposed")
        )
          failures.push({
            code: "runtime-disposed",
            message: "runtime-disposed",
          });
        const retirementStarted = benchmarkMetrics ? performance.now() : 0;
        this.retireBindings();
        if (benchmarkMetrics)
          benchmarkMetrics.fullFrameWallPhases.frame.retirementWallMs +=
            performance.now() - retirementStarted;
      } catch (error) {
        this.releaseScenePresentation();
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof NativeSourceError ||
          error instanceof NativeDeviceLifecycleError ||
          error instanceof NativeUniformTimingError
            ? error.code
            : "webgpu-unavailable";
        if (this.mounts.size === 0 || this.disposed)
          failures.push({ code, message });
        for (const mount of this.mounts.values()) {
          this.showOriginal(mount);
          mount.target.setAttribute("data-an-native-status", "error");
          mount.target.setAttribute("data-an-native-error", code);
          mount.target.setAttribute(
            "data-an-native-error-message",
            message.slice(0, 300),
          );
          failures.push({
            code,
            message,
            instanceId: mount.instance.id,
          });
          this.postStatus(mount.instance.id, mount.instance.nodeId, "error", {
            code,
            message,
            instanceId: mount.instance.id,
          });
        }
        this.issue(code, message);
        if (!this.device && !this.deviceLifecycle.exhausted())
          this.scheduleDeviceRetry();
      }
      if (deterministic)
        for (const target of this.rejectedTargets) {
          const code = target.getAttribute("data-an-native-error");
          if (!code) continue;
          if (
            failures.some(
              (failure) =>
                failure.code === code &&
                failure.instanceId ===
                  [...this.mounts.values()].find(
                    (mount) => mount.target === target,
                  )?.instance.id,
            )
          )
            continue;
          failures.push({
            code,
            message:
              target.getAttribute("data-an-native-error-message") ?? code,
            instanceId: [...this.mounts.values()].find(
              (mount) => mount.target === target,
            )?.instance.id,
          });
        }
      const renderWallMs = performance.now() - started;
      if (benchmarkMetrics)
        benchmarkMetrics.fullFrameWallPhases.frame.renderInternalWallMs =
          renderWallMs;
      return {
        time,
        rendered: complete.size,
        failures,
        renderWallMs,
      };
    })();
    let result: NativeRenderResult;
    try {
      result = await this.running;
    } catch (error) {
      this.mountedBenchmark?.fail(
        new NativeMountedBenchmarkError("benchmark-render-failed"),
      );
      throw error;
    } finally {
      this.mountedBenchmarkRenderMetrics = null;
      // Dependency textures remain pinned until every parent encoder has submitted.
      this.activeMounts.clear();
      this.running = null;
    }
    if (!deterministic) {
      this.recordProfile(this.renderWallSamples, result.renderWallMs);
      if (this.mountedBenchmark && benchmarkMetrics)
        this.mountedBenchmark.onRender({
          renderWallMs: result.renderWallMs,
          sourceWallMs: benchmarkMetrics.sourceWallMs,
          composeWallMs: benchmarkMetrics.composeWallMs,
          hostWallPhases: benchmarkMetrics.hostWallPhases,
          fullFrameWallPhases: benchmarkMetrics.fullFrameWallPhases,
          failureCount: result.failures.length,
        });
      if (
        !this.compositionAbort &&
        !this.compositionPixelBusy &&
        this.compositionPixelRatio === null &&
        this.previewPolicy.observeRenderWall(result.renderWallMs)
      ) {
        this.previewDirty = true;
        this.updatePreviewAttributes();
        if (this.playing && !this.raf && this.mounts.size)
          this.raf = requestAnimationFrame(this.frame);
      }
      this.profileFrames += 1;
      if (this.profileFrames % 30 === 0) {
        const { sources: _sources, ...summary } = this.profile();
        document.documentElement.setAttribute(
          "data-an-native-profile",
          JSON.stringify(summary),
        );
      }
    }
    return result;
  };

  private async readPublishedPresentationMirror(mount: Mount): Promise<{
    sha256: string;
    width: number;
    height: number;
    format: "bgra8unorm" | "rgba8unorm";
    nonTransparentPixels: number;
  }> {
    const texture = this.publishedPresentationMirror.current();
    const device = this.device;
    const epoch = this.deviceEpoch;
    if (
      !texture ||
      !device ||
      texture.width !== mount.canvas.width ||
      texture.height !== mount.canvas.height
    )
      throw new NativeSourceError(
        "presentation-fault-mirror-unavailable",
        "The reviewed GPU presentation mirror is unavailable.",
      );
    let plan;
    try {
      plan = planNativePresentationReadback({
        width: texture.width,
        height: texture.height,
        format: texture.format,
        colorSpace: this.colorPresented,
        dynamicRange: this.dynamicRangePresented,
      });
    } catch (error) {
      throw new NativeSourceError(
        error instanceof Error
          ? error.message
          : "presentation-fault-pixels-unreadable",
        "The reviewed GPU presentation format or extent is unsupported.",
      );
    }
    if (
      this.estimatedResourceBytes() + plan.bufferBytes >
      MAX_REALM_TEXTURE_BYTES
    )
      throw new NativeSourceError(
        "gpu-budget-exceeded",
        "The bounded presentation readback exceeds the GPU resource budget.",
      );
    let buffer: GPUBuffer;
    try {
      buffer = device.createBuffer({
        size: plan.bufferBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    } catch (error) {
      throw new NativeSourceError(
        "presentation-fault-gpu-readback-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    let scopeOpen = false;
    let mapped = false;
    try {
      device.pushErrorScope("validation");
      scopeOpen = true;
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture },
        { buffer, bytesPerRow: plan.bytesPerRow, rowsPerImage: plan.height },
        [plan.width, plan.height, 1],
      );
      if (this.device !== device || this.deviceEpoch !== epoch)
        throw new NativeSourceError(
          "presentation-fault-device-changed",
          "The GPU device changed before presentation readback.",
        );
      device.queue.submit([encoder.finish()]);
      const scopeResult = device.popErrorScope();
      scopeOpen = false;
      const gpuError = await scopeResult;
      if (gpuError)
        throw new NativeSourceError(
          "presentation-fault-gpu-readback-failed",
          gpuError.message,
        );
      await buffer.mapAsync(GPUMapMode.READ);
      mapped = true;
      if (
        this.device !== device ||
        this.deviceEpoch !== epoch ||
        this.publishedPresentationMirror.current() !== texture
      )
        throw new NativeSourceError(
          "presentation-fault-device-changed",
          "The published GPU presentation changed during readback.",
        );
      const padded = new Uint8Array(buffer.getMappedRange()).slice();
      const { rgba, nonTransparentPixels } = compactNativePresentationReadback(
        padded,
        plan,
      );
      const digestBytes = new Uint8Array(rgba.byteLength);
      digestBytes.set(rgba);
      const digest = await crypto.subtle.digest("SHA-256", digestBytes);
      return {
        sha256: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        width: plan.width,
        height: plan.height,
        format: plan.format,
        nonTransparentPixels,
      };
    } catch (error) {
      if (scopeOpen) {
        const scopeError = await device.popErrorScope();
        if (scopeError)
          throw new NativeSourceError(
            "presentation-fault-gpu-readback-failed",
            scopeError.message,
          );
      }
      if (error instanceof NativeSourceError) throw error;
      throw new NativeSourceError(
        "presentation-fault-gpu-readback-failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (mapped) buffer.unmap();
      buffer.destroy();
    }
  }

  runReviewedPresentationFault = async (
    grant: NativePresentationFaultGrant,
  ): Promise<{
    kind: NativePresentationFaultGrant["kind"];
    simulated: true;
    submitted: true;
    scopeDrained: true;
    grantId: string;
    status: "last-good";
    code: "gpu-validation";
    beforePreparedFrameCount: number;
    preparedFrameCount: 1;
    priorFrameCount: number;
    afterFrameCount: number;
    pixelSource: "last-published-gpu-presentation";
    pixelFormat: "bgra8unorm" | "rgba8unorm";
    beforePixelSha256: string;
    afterPixelSha256: string;
    pixelWidth: number;
    pixelHeight: number;
    nonTransparentPixels: number;
  }> => {
    this.assertCompositionIdle();
    if (
      !REVIEWED_LOCAL_RUNTIME_TARGET ||
      this.disposed ||
      this.mounts.size !== 1 ||
      this.presentationFaultHold
    )
      throw new NativeSourceError(
        "presentation-fault-ineligible",
        "The reviewed local fixture is not mounted alone.",
      );
    if (this.scanning) await this.scanning;
    if (this.running) await this.running;
    const script = this.runtimeScript?.textContent?.trim();
    if (!script)
      throw new NativeSourceError(
        "presentation-fault-runtime-unreadable",
        "The runtime script is unreadable.",
      );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(script),
    );
    const runtimeHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (runtimeHash !== grant.runtimeSha256)
      throw new NativeSourceError(
        "presentation-fault-runtime-stale",
        "The served runtime changed.",
      );
    const mount = this.mounts.get(grant.instanceId);
    if (
      !mount ||
      mount.instance.nodeId !== grant.nodeId ||
      mount.instance.placement !== "layer" ||
      mount.definition.id !== grant.definitionId ||
      mount.definition.version !== grant.definitionVersion ||
      (await hashEffectDefinition(mount.definition)) !== grant.executionHash ||
      !mount.outputTexture ||
      !mount.presentationPair ||
      mount.target.getAttribute("data-an-native-status") !== "ready"
    )
      throw new NativeSourceError(
        "presentation-fault-target-stale",
        "The reviewed last-good Layer is unavailable.",
      );
    const wasPlaying = this.playing;
    this.pause();
    this.clearIdleSourcePoll();
    this.presentationFaultHold = true;
    this.presentationFaultRuntimeHash = runtimeHash;
    this.presentationFaultTriggered = false;
    let armed = false;
    const beforePreparedFrameCount = mount.frameCount;
    let priorFrameCount = 0;
    let priorOutput: GPUTexture | null = null;
    let priorCanvas: HTMLCanvasElement | null = null;
    try {
      this.presentationMirrorCapture = true;
      const baseline = await this.renderInternal(this.currentTime(), true);
      this.presentationMirrorCapture = false;
      if (
        baseline.failures.length ||
        !this.publishedPresentationMirror.current()
      )
        throw new NativeSourceError(
          "presentation-fault-mirror-unavailable",
          "The reviewed GPU presentation could not be captured and published.",
        );
      priorFrameCount = mount.frameCount;
      if (priorFrameCount !== beforePreparedFrameCount + 1)
        throw new NativeSourceError(
          "presentation-fault-baseline-frame-mismatch",
          "The reviewed baseline did not publish exactly one frame.",
        );
      priorOutput = mount.outputTexture;
      priorCanvas = mount.canvas;
      const beforePixels = await this.readPublishedPresentationMirror(mount);
      if (beforePixels.nonTransparentPixels === 0)
        throw new NativeSourceError(
          "presentation-fault-empty-prior",
          "The reviewed prior surface has no visible coverage.",
        );
      this.presentationFaultLatch.arm(
        grant,
        REVIEWED_LOCAL_RUNTIME_TARGET,
        Date.now(),
      );
      armed = true;
      const result = await this.renderInternal(this.currentTime(), true);
      const expectedCode = "gpu-validation";
      if (
        !this.presentationFaultTriggered ||
        this.presentationFaultLatch.pending() ||
        !result.failures.some(
          (failure) =>
            failure.instanceId === grant.instanceId &&
            failure.code === expectedCode,
        ) ||
        mount.outputTexture !== priorOutput ||
        mount.canvas !== priorCanvas ||
        mount.frameCount !== priorFrameCount ||
        mount.target.getAttribute("data-an-native-status") !== "last-good" ||
        mount.target.getAttribute("data-an-native-error") !== expectedCode
      )
        throw new NativeSourceError(
          "presentation-fault-proof-incomplete",
          "The reviewed fault did not preserve the last-good Layer.",
        );
      const afterPixels = await this.readPublishedPresentationMirror(mount);
      if (
        beforePixels.sha256 !== afterPixels.sha256 ||
        beforePixels.width !== afterPixels.width ||
        beforePixels.height !== afterPixels.height ||
        beforePixels.format !== afterPixels.format ||
        beforePixels.nonTransparentPixels !== afterPixels.nonTransparentPixels
      )
        throw new NativeSourceError(
          "presentation-fault-published-pixels-changed",
          "The last-published GPU presentation pixels changed after the simulated fault.",
        );
      return {
        kind: grant.kind,
        simulated: true,
        submitted: true,
        scopeDrained: true,
        grantId: grant.grantId,
        status: "last-good",
        code: expectedCode,
        beforePreparedFrameCount,
        preparedFrameCount: 1 as const,
        priorFrameCount,
        afterFrameCount: mount.frameCount,
        pixelSource: "last-published-gpu-presentation" as const,
        pixelFormat: beforePixels.format,
        beforePixelSha256: beforePixels.sha256,
        afterPixelSha256: afterPixels.sha256,
        pixelWidth: beforePixels.width,
        pixelHeight: beforePixels.height,
        nonTransparentPixels: beforePixels.nonTransparentPixels,
      };
    } finally {
      this.presentationMirrorCapture = false;
      this.publishedPresentationMirror.clear();
      this.presentationFaultLatch.clear();
      this.presentationFaultRuntimeHash = null;
      if (!armed) {
        this.presentationFaultHold = false;
        if (wasPlaying && !this.disposed) this.play();
      }
    }
  };

  renderAt = async (time: number): Promise<NativeRenderResult> => {
    this.assertCompositionIdle();
    if (this.scanning) await this.scanning;
    const result = await this.renderInternal(time, true);
    if (result.failures.length) throw new NativeRenderFailure(result);
    return result;
  };

  setParameters = async (
    instanceId: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    this.assertCompositionIdle();
    if (this.scanning) await this.scanning;
    if (this.running) await this.running;
    const mount = this.mounts.get(instanceId);
    if (!mount) throw new Error(`Native effect ${instanceId} is not mounted.`);
    const nextParams = {
      ...mount.instance.params,
      ...params,
    } as EffectInstance["params"];
    packNativeProperties(mount.definition, nextParams);
    const previous = mount.instance;
    mount.instance = { ...mount.instance, params: nextParams };
    this.markMountRenderPending(mount);
    try {
      const result = await this.renderInternal(this.currentTime(), false);
      if (result.failures.length) throw new NativeRenderFailure(result);
    } catch (error) {
      mount.instance = previous;
      throw error;
    }
  };

  private clearDraftState(): void {
    const draft = this.draft;
    if (!draft) return;
    const mount = this.mounts.get(draft.instanceId);
    if (mount && draft.showDraft && draft.publishedTexture) {
      if (mount.outputTexture) this.textureRetirement.push(mount.outputTexture);
      mount.outputTexture = draft.publishedTexture;
    } else if (draft.publishedTexture) {
      this.textureRetirement.push(draft.publishedTexture);
    }
    if (draft.lastGoodTexture)
      this.textureRetirement.push(draft.lastGoodTexture);
    this.draft = null;
  }

  private postInstancePreviewResult(
    request: NativeInstancePreviewRequest,
    status: NativeInstancePreviewResult["status"],
    displayed: NativeInstancePreviewResult["displayed"],
    code?: string,
  ): void {
    const result: NativeInstancePreviewResult = {
      type: "native-effect-instance-result",
      schemaVersion: 1,
      requestId: request.requestId,
      sequence: request.sequence,
      runtimeEpoch: this.epoch,
      instanceId: request.instanceId,
      nodeId: request.nodeId,
      status,
      displayed,
      ...(code ? { code } : {}),
    };
    try {
      window.parent.postMessage(result, nativeDocumentOrigin());
    } catch (error) {
      this.issue(
        "instance-preview-post-failed",
        String(error),
        request.instanceId,
      );
    }
  }

  private instancePreviewDisplay(instanceId: string): "preview" | "published" {
    return this.instancePreview?.instanceId === instanceId
      ? "preview"
      : "published";
  }

  private async applyInstancePreview(
    request: NativeInstancePreviewRequest,
    generation: number,
  ): Promise<void> {
    this.instancePreviewPending = true;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      if (this.scanning) await this.scanning;
      if (this.running) await this.running;
      if (generation !== this.instancePreviewGeneration || this.disposed) {
        this.postInstancePreviewResult(
          request,
          "error",
          this.instancePreviewDisplay(request.instanceId),
          "instance-preview-superseded",
        );
        return;
      }
      const mount = this.mounts.get(request.instanceId);
      if (!mount || mount.instance.nodeId !== request.nodeId) {
        this.postInstancePreviewResult(
          request,
          "error",
          "published",
          "instance-preview-target-stale",
        );
        return;
      }
      const executionHash = await hashEffectDefinition(mount.definition);
      if (generation !== this.instancePreviewGeneration) return;
      if (executionHash !== request.baseExecutionHash) {
        this.postInstancePreviewResult(
          request,
          "error",
          this.instancePreviewDisplay(request.instanceId),
          "instance-preview-definition-stale",
        );
        return;
      }
      const previousPreview = this.instancePreview;
      if (request.type === "native-effect-clear-instance") {
        const active = this.instancePreview;
        if (
          active &&
          (active.instanceId !== request.instanceId ||
            active.nodeId !== request.nodeId ||
            active.baseInstanceSignature !== request.baseInstanceSignature)
        ) {
          this.postInstancePreviewResult(
            request,
            "error",
            this.instancePreviewDisplay(request.instanceId),
            "instance-preview-base-stale",
          );
          return;
        }
        this.instancePreview = null;
      } else {
        const signature = await hashEffectInstance(mount.instance);
        if (generation !== this.instancePreviewGeneration) return;
        if (signature !== request.baseInstanceSignature) {
          this.postInstancePreviewResult(
            request,
            "error",
            this.instancePreviewDisplay(request.instanceId),
            "instance-preview-base-stale",
          );
          return;
        }
        const candidate: EffectInstance = {
          ...mount.instance,
          opacity: request.opacity,
          ...(request.transform === null
            ? { transform: undefined }
            : { transform: request.transform }),
        };
        const validation = validateEffectDocument({
          schemaVersion: 2,
          definitions: [mount.definition],
          instances: [candidate],
        });
        if (!validation.valid) {
          this.postInstancePreviewResult(
            request,
            "error",
            this.instancePreviewDisplay(request.instanceId),
            "instance-preview-invalid",
          );
          return;
        }
        this.instancePreview = {
          instanceId: request.instanceId,
          nodeId: request.nodeId,
          baseInstanceSignature: signature,
          instance: candidate,
        };
      }
      let rendered: NativeRenderResult;
      try {
        rendered = await this.renderInternal(this.currentTime(), true);
      } catch (error) {
        if (generation === this.instancePreviewGeneration)
          this.instancePreview = previousPreview;
        throw error;
      }
      if (generation !== this.instancePreviewGeneration) return;
      const failure = rendered.failures.find(
        (item) => !item.instanceId || item.instanceId === request.instanceId,
      );
      if (failure) this.instancePreview = previousPreview;
      this.postInstancePreviewResult(
        request,
        failure ? "error" : "ready",
        this.instancePreviewDisplay(request.instanceId),
        failure?.code,
      );
    } finally {
      if (generation === this.instancePreviewGeneration) {
        this.instancePreviewPending = false;
        if (!this.disposed && this.mounts.size) this.frame();
      }
    }
  }

  private draftDisplay(
    instanceId: string,
  ): NativeDraftPreviewResult["displayed"] {
    const mount = this.mounts.get(instanceId);
    if (!mount?.outputTexture) return "none";
    const draft = this.draft;
    if (!draft || draft.instanceId !== instanceId || !draft.showDraft)
      return "published";
    return draft.publishedTexture ? "draft-current" : "published";
  }

  private postDraftResult(
    requestId: string,
    instanceId: string,
    status: NativeDraftPreviewResult["status"],
    diagnostics: NativeDraftPreviewDiagnostic[] = [],
    timings?: NativeDraftPreviewResult["timings"],
  ): void {
    if (window.parent === window) return;
    const draft = this.draft;
    const displayed = this.draftDisplay(instanceId);
    const reportedStatus =
      status === "error" && displayed === "draft-current"
        ? "last-good"
        : status;
    const result: NativeDraftPreviewResult = {
      type: "native-shader-draft-result",
      schemaVersion: 1,
      requestId,
      runtimeEpoch: this.epoch,
      instanceId,
      status: reportedStatus,
      displayed:
        reportedStatus === "last-good" && displayed === "draft-current"
          ? "draft-last-good"
          : displayed,
      ...(draft?.instanceId === instanceId
        ? { executionHash: draft.executionHash }
        : {}),
      diagnostics: diagnostics.slice(0, 16).map((issue) => ({
        ...issue,
        code: issue.code.slice(0, 80),
        message: issue.message.slice(0, 300),
      })),
      ...(timings ? { timings } : {}),
    };
    try {
      window.parent.postMessage(result, nativeDocumentOrigin());
    } catch (error) {
      this.issue("draft-status-post-failed", String(error), instanceId);
    }
  }

  private draftFailure(
    code: string,
    message: string,
    passId?: string,
    line?: number,
    column?: number,
  ): NativeDraftPreviewDiagnostic {
    return {
      code,
      message,
      severity: "error",
      ...(passId ? { passId } : {}),
      ...(line !== undefined && column !== undefined ? { line, column } : {}),
    };
  }

  private draftDiagnostics(
    failure: Diagnostic,
  ): NativeDraftPreviewDiagnostic[] {
    return failure.issues?.length
      ? failure.issues.map((issue) =>
          this.draftFailure(
            failure.code,
            issue.message,
            issue.passId,
            issue.line,
            issue.column,
          ),
        )
      : [
          this.draftFailure(
            failure.code,
            failure.message,
            failure.passId,
            failure.line,
            failure.column,
          ),
        ];
  }

  private async previewDraft(
    request: NativeDraftPreviewRequest,
    generation: number,
  ): Promise<void> {
    this.draftRequestPending = true;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      await this.previewDraftImpl(request, generation);
    } finally {
      if (generation === this.draftGeneration) {
        this.draftRequestPending = false;
        if (!this.disposed && this.mounts.size) this.frame();
      }
    }
  }

  private async previewDraftImpl(
    request: NativeDraftPreviewRequest,
    generation: number,
  ): Promise<void> {
    const { requestId, instanceId } = request;
    const fail = (code: string, message: string): void =>
      this.postDraftResult(
        requestId,
        instanceId,
        this.draftDisplay(instanceId) === "draft-current"
          ? "last-good"
          : "error",
        [this.draftFailure(code, message)],
      );
    if (request.runtimeEpoch !== this.epoch) {
      fail("draft-runtime-stale", "The native runtime changed before preview.");
      return;
    }
    if (this.compositionDone || this.compositionPixelBusy) {
      fail("composition-busy", "A synchronized composition frame is active.");
      return;
    }
    if (this.scanning) await this.scanning;
    if (this.running) await this.running;
    if (generation !== this.draftGeneration) {
      fail("draft-superseded", "A newer draft request superseded this one.");
      return;
    }
    const mount = this.mounts.get(instanceId);
    if (!mount || mount.instance.nodeId !== request.nodeId) {
      fail(
        "draft-target-stale",
        "The selected native instance is not mounted.",
      );
      return;
    }
    if (!mount.outputTexture || !mount.suppressed) {
      fail(
        "draft-target-pending",
        "The selected native instance has no completed GPU frame.",
      );
      return;
    }
    const baseHash = await hashEffectDefinition(mount.definition);
    if (
      generation !== this.draftGeneration ||
      request.baseExecutionHash !== baseHash
    ) {
      fail(
        "draft-base-stale",
        "The mounted definition changed before preview.",
      );
      return;
    }
    const definition = request.draftDefinition;
    if (
      definition.id !== mount.definition.id ||
      definition.kind !== mount.definition.kind ||
      JSON.stringify(definition.placements) !==
        JSON.stringify(mount.definition.placements) ||
      JSON.stringify(definition.extent ?? null) !==
        JSON.stringify(mount.definition.extent ?? null)
    ) {
      fail(
        "draft-layout-unsupported",
        "Draft preview cannot change the selected effect's kind, placements, or extent.",
      );
      return;
    }
    const instance: EffectInstance = {
      ...mount.instance,
      definitionId: definition.id,
      definitionVersion: definition.version,
      params: request.params as EffectInstance["params"],
      seed: request.seed,
    };
    const validation = validateEffectDocument({
      schemaVersion: 2,
      definitions: [definition],
      instances: [instance],
    });
    if (!validation.valid) {
      this.postDraftResult(
        requestId,
        instanceId,
        this.draftDisplay(instanceId) === "draft-current"
          ? "last-good"
          : "error",
        validation.errors
          .slice(0, 16)
          .map((message) => this.draftFailure("draft-invalid", message)),
      );
      return;
    }
    const executionHash = await hashEffectDefinition(definition);
    if (
      generation !== this.draftGeneration ||
      executionHash !== request.expectedExecutionHash
    ) {
      fail(
        generation !== this.draftGeneration
          ? "draft-superseded"
          : "draft-hash-mismatch",
        "The draft source no longer matches its requested execution hash.",
      );
      return;
    }
    const previous = this.draft;
    if (previous && previous.instanceId !== instanceId) this.clearDraftState();
    else if (
      previous &&
      !previous.showDraft &&
      previous.lastGoodTexture &&
      mount.outputTexture
    ) {
      previous.publishedTexture = mount.outputTexture;
      mount.outputTexture = previous.lastGoodTexture;
      previous.lastGoodTexture = null;
    }
    this.draft = {
      instanceId,
      nodeId: request.nodeId,
      baseExecutionHash: baseHash,
      executionHash,
      definition,
      instance,
      generation,
      showDraft: true,
      playing: false,
      time: request.time,
      clockOrigin: performance.now() - request.time * 1000,
      publishedTexture:
        previous?.instanceId === instanceId ? previous.publishedTexture : null,
      lastGoodTexture: null,
      failedReason: null,
    };
    const started = performance.now();
    const result = await this.renderInternal(this.currentTime(), true);
    if (generation !== this.draftGeneration) {
      fail("draft-superseded", "A newer draft request superseded this one.");
      return;
    }
    const failure = result.failures.find(
      (item) => !item.instanceId || item.instanceId === instanceId,
    );
    if (failure && this.draft?.generation === generation)
      this.draft.failedReason = this.draftDiagnostics(failure)[0] ?? null;
    const displayed = this.draftDisplay(instanceId);
    this.postDraftResult(
      requestId,
      instanceId,
      failure
        ? displayed === "draft-current"
          ? "last-good"
          : "error"
        : "ready",
      failure ? this.draftDiagnostics(failure) : [],
      { renderWallMs: performance.now() - started },
    );
  }

  private async controlDraft(
    request: NativeDraftPreviewControl,
    generation: number,
  ): Promise<void> {
    this.draftRequestPending = true;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      await this.controlDraftImpl(request, generation);
    } finally {
      if (generation === this.draftGeneration) {
        this.draftRequestPending = false;
        if (!this.disposed && this.mounts.size) this.frame();
      }
    }
  }

  private async controlDraftImpl(
    request: NativeDraftPreviewControl,
    generation: number,
  ): Promise<void> {
    const { requestId, instanceId } = request;
    if (this.scanning) await this.scanning;
    const draft = this.draft;
    const mount = this.mounts.get(instanceId);
    if (
      request.command === "clear" &&
      !draft &&
      mount &&
      request.runtimeEpoch === this.epoch &&
      (await hashEffectDefinition(mount.definition)) ===
        request.baseExecutionHash
    ) {
      this.postDraftResult(requestId, instanceId, "ready");
      return;
    }
    if (
      request.runtimeEpoch !== this.epoch ||
      !draft ||
      !mount ||
      draft.instanceId !== instanceId ||
      draft.baseExecutionHash !== request.baseExecutionHash
    ) {
      this.postDraftResult(requestId, instanceId, "error", [
        this.draftFailure(
          "draft-session-stale",
          "The draft session is unavailable.",
        ),
      ]);
      return;
    }
    if (this.running) await this.running;
    if (generation !== this.draftGeneration) {
      this.postDraftResult(requestId, instanceId, "error", [
        this.draftFailure(
          "draft-superseded",
          "A newer draft control superseded this one.",
        ),
      ]);
      return;
    }
    if (request.command === "clear") {
      this.clearDraftState();
    } else if (request.command === "show-published" && draft.showDraft) {
      if (draft.publishedTexture && mount.outputTexture) {
        draft.lastGoodTexture = mount.outputTexture;
        mount.outputTexture = draft.publishedTexture;
        draft.publishedTexture = null;
      }
      draft.showDraft = false;
    } else if (request.command === "show-draft" && !draft.showDraft) {
      if (!draft.lastGoodTexture || !mount.outputTexture) {
        this.postDraftResult(requestId, instanceId, "error", [
          this.draftFailure(
            "draft-pixels-unavailable",
            "No successful draft frame is available.",
          ),
        ]);
        return;
      }
      draft.publishedTexture = mount.outputTexture;
      mount.outputTexture = draft.lastGoodTexture;
      draft.lastGoodTexture = null;
      draft.showDraft = true;
    } else if (request.command === "set-time") {
      if (!Number.isFinite(request.time) || (request.time ?? -1) < 0) {
        this.postDraftResult(requestId, instanceId, "error", [
          this.draftFailure(
            "draft-time-invalid",
            "Draft time must be finite and nonnegative.",
          ),
        ]);
        return;
      }
      draft.time = request.time!;
      draft.playing = false;
    } else if (request.command === "play") {
      draft.clockOrigin = performance.now() - draft.time * 1000;
      draft.playing = true;
    } else if (request.command === "pause") {
      if (draft.playing)
        draft.time = (performance.now() - draft.clockOrigin) / 1000;
      draft.playing = false;
    }
    const started = performance.now();
    const result = await this.renderInternal(this.currentTime(), true);
    const failure = result.failures.find(
      (item) => !item.instanceId || item.instanceId === instanceId,
    );
    const diagnostics = failure
      ? this.draftDiagnostics(failure)
      : this.draft?.failedReason
        ? [this.draft.failedReason]
        : [];
    const diagnostic = diagnostics[0];
    this.postDraftResult(
      requestId,
      instanceId,
      diagnostic
        ? this.draftDisplay(instanceId) === "draft-current"
          ? "last-good"
          : "error"
        : "ready",
      diagnostics,
      { renderWallMs: performance.now() - started },
    );
  }
  setTime = async (time: number): Promise<void> => {
    this.assertCompositionIdle();
    if (!Number.isFinite(time) || time < 0)
      throw new Error("Native shader time must be a finite nonnegative value.");
    assertNativeUniformTiming(time, "time");
    const clocks = [...this.mounts.values()].map((mount) => {
      assertNativeUniformTiming(mount.instance.timing.time, "initial-time");
      assertNativeUniformTiming(mount.instance.timing.speed, "speed");
      const local =
        mount.instance.timing.time +
        (mount.instance.timing.paused ? 0 : time * mount.instance.timing.speed);
      assertNativeUniformTiming(local, "time");
      return {
        mount,
        clock: {
          global: time,
          local,
          speed: mount.instance.timing.speed,
          paused: mount.instance.timing.paused,
        },
      };
    });
    this.playing = false;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.timeOverride = time;
    for (const { mount, clock } of clocks) {
      mount.clock = clock;
      this.markMountRenderPending(mount);
    }
    await this.renderAt(time);
  };
  play = (): void => {
    this.assertCompositionIdle();
    const time = this.currentTime();
    this.clockOrigin = performance.now() - time * 1000;
    for (const mount of this.mounts.values()) {
      const local = mount.clock.paused
        ? mount.clock.local
        : mount.clock.local + (time - mount.clock.global) * mount.clock.speed;
      mount.clock = {
        global: time,
        local,
        speed: mount.instance.timing.speed,
        paused: mount.instance.timing.paused,
      };
    }
    this.timeOverride = null;
    this.presentationFaultHold = false;
    this.playing = true;
    this.rafIntervalTelemetry.reset();
    this.frame();
  };
  pause = (): void => {
    if (!this.disposed) this.assertCompositionIdle();
    const time = this.currentTime();
    for (const mount of this.mounts.values()) {
      if (!mount.clock.paused)
        mount.clock.local += (time - mount.clock.global) * mount.clock.speed;
      mount.clock.global = time;
    }
    this.timeOverride = time;
    this.playing = false;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.scheduleIdleSourcePoll();
    clearTimeout(this.deviceRetryTimer);
    this.deviceRetryTimer = 0;
  };
  reset = async (): Promise<void> => {
    await this.setTime(0);
  };

  private assertCompositionIdle(pixelOwner = false): void {
    if (this.colorChanging)
      throw new NativeSourceError(
        "color-mode-busy",
        "The WebGPU color mode is changing.",
      );
    if (this.compositionUnsafe)
      throw new NativeSourceError(
        "composition-restore-failed",
        "The authored source clock could not be restored; reload this document before playback.",
      );
    if (this.compositionAbort || (this.compositionPixelBusy && !pixelOwner))
      throw new NativeSourceError(
        "composition-busy",
        "A synchronized composition frame already owns native playback.",
      );
    if (
      (this.simulationExportSession || this.simulationExportStarting) &&
      !pixelOwner
    )
      throw new NativeSourceError(
        "simulation-session-busy",
        "A particle export session owns native playback.",
      );
  }

  private suspendForComposition(): NativeClockSnapshot {
    const time = this.currentTime();
    const snapshot: NativeClockSnapshot = {
      playing: this.playing,
      time,
      timeOverride: this.timeOverride,
      clockOrigin: this.clockOrigin,
      clocks: new Map(
        [...this.mounts.values()].map((mount) => [mount, { ...mount.clock }]),
      ),
    };
    this.playing = false;
    this.timeOverride = time;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.deviceRetryTimer);
    this.deviceRetryTimer = 0;
    return snapshot;
  }

  private restoreFromComposition(snapshot: NativeClockSnapshot): void {
    if (this.disposed) return;
    for (const [mount, clock] of snapshot.clocks) mount.clock = clock;
    this.clockOrigin = snapshot.playing
      ? performance.now() - snapshot.time * 1000
      : snapshot.clockOrigin;
    this.timeOverride = snapshot.timeOverride;
    this.playing = snapshot.playing;
    this.rafIntervalTelemetry.reset();
    if (this.playing && this.mounts.size) this.frame();
  }

  private async drainPreviewFrame(signal: AbortSignal): Promise<void> {
    const aborted = () =>
      signal.reason ??
      new NativeSourceError(
        "composition-aborted",
        "Source synchronization was canceled before the preview frame settled.",
      );
    let onAbort!: () => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(aborted());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      if (signal.aborted) throw aborted();
      while (this.scanning || this.running) {
        const inFlight: Promise<unknown>[] = [];
        if (this.scanning) inFlight.push(this.scanning);
        if (this.running) inFlight.push(this.running);
        const results = await Promise.race([
          Promise.allSettled(inFlight),
          cancellation,
        ]);
        for (const result of results)
          if (result.status === "rejected") throw result.reason;
        if (signal.aborted) throw aborted();
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private withSynchronizedCompositionFrame = async <Consumed>(
    options: RuntimeCompositionOptions,
    consume: (
      rendered: NativeRenderResult,
      frame: NativeCompositionFrame,
    ) => Promise<Consumed>,
    pixelOwner = false,
  ): Promise<{
    frameIndex: number;
    fps: number;
    startTimeSeconds: number;
    timeSeconds: number;
    value: Consumed;
  }> => {
    this.assertCompositionIdle(pixelOwner);
    if (this.disposed)
      throw new NativeSourceError("runtime-disposed", "runtime-disposed");
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new NativeSourceError(
        "composition-invalid-frame",
        "Composition timeout must be finite and bounded.",
      );
    const started = performance.now();
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    this.compositionAbort = controller;
    this.compositionDone = new Promise<void>((resolve) => {
      this.resolveCompositionDone = resolve;
    });
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const timer = setTimeout(
      () =>
        controller.abort(
          new NativeSourceError(
            "composition-timeout",
            "Source synchronization timed out before the frame completed.",
          ),
        ),
      timeoutMs,
    );
    let drained = false;
    try {
      await this.drainPreviewFrame(controller.signal);
      drained = true;
      const remainingMs = Math.floor(timeoutMs - (performance.now() - started));
      if (remainingMs < 1 || controller.signal.aborted)
        throw (
          controller.signal.reason ??
          new NativeSourceError(
            "composition-timeout",
            "Source synchronization timed out before the frame began.",
          )
        );
      const runtimeOwnedNodes = new Set<Node>();
      if (this.runtimeScript) runtimeOwnedNodes.add(this.runtimeScript);
      for (const mount of this.mounts.values())
        runtimeOwnedNodes.add(mount.canvas);
      const sceneCanvas = this.scenePresentation?.canvas;
      if (sceneCanvas?.isConnected && sceneCanvas.ownerDocument === document)
        runtimeOwnedNodes.add(sceneCanvas);
      return await runNativeCompositionSession(
        {
          document,
          authoredRoot: document.documentElement,
          runtimeOwnedNodes,
          sourceContract: options.sourceContract,
          frameIndex: options.frameIndex,
          fps: options.fps,
          startTimeSeconds: options.startTimeSeconds,
          signal: controller.signal,
          timeoutMs: remainingMs,
        },
        {
          suspend: () => this.suspendForComposition(),
          invalidateSources: () => {
            for (const mount of this.mounts.values())
              mount.provider?.invalidate();
          },
          render: async (time, signal) => {
            if (signal.aborted) throw signal.reason;
            const result = await this.renderInternal(time, true);
            if (signal.aborted) throw signal.reason;
            if (result.failures.length) throw new NativeRenderFailure(result);
            return result;
          },
          consume,
          restore: (snapshot) => this.restoreFromComposition(snapshot),
          hold: (error) => {
            this.compositionUnsafe = true;
            this.playing = false;
            this.issue("composition-restore-failed", String(error));
          },
        },
      );
    } finally {
      clearTimeout(timer);
      if (!drained && (this.running || this.scanning)) {
        this.compositionUnsafe = true;
        this.playing = false;
        this.issue(
          "composition-restore-failed",
          "The preview frame did not settle before source synchronization ended.",
        );
      }
      options.signal?.removeEventListener("abort", abort);
      this.compositionAbort = null;
      this.resolveCompositionDone?.();
      this.resolveCompositionDone = null;
      this.compositionDone = null;
      if (
        !this.compositionUnsafe &&
        !this.compositionPixelBusy &&
        this.playing &&
        this.mounts.size &&
        !this.raf &&
        !this.disposed
      )
        this.frame();
    }
  };

  // A returned clock-only result is not an export frame: authored CSS and media
  // have already been restored. A future trusted consumer must run inside the
  // synchronized callback above, before source teardown.
  renderCompositionFrame = (
    options: RuntimeCompositionOptions,
  ): Promise<{
    frameIndex: number;
    fps: number;
    startTimeSeconds: number;
    timeSeconds: number;
    value: NativeRenderResult;
  }> =>
    this.withSynchronizedCompositionFrame(
      options,
      async (rendered) => rendered,
    );

  beginSimulationExportSession = async (options: {
    fps: number;
    totalFrames: number;
    startTimeSeconds: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ sessionId: string }> => {
    this.assertCompositionIdle();
    if (this.simulationExportStarting || this.simulationExportSession)
      throw new NativeSourceError(
        "simulation-session-busy",
        "A particle export session is already active.",
      );
    if (
      !Number.isSafeInteger(options.fps) ||
      options.fps < 1 ||
      options.fps > 120 ||
      !Number.isSafeInteger(options.totalFrames) ||
      options.totalFrames < 1 ||
      options.totalFrames > 3600 ||
      !Number.isFinite(options.startTimeSeconds) ||
      options.startTimeSeconds < 0 ||
      options.startTimeSeconds + options.totalFrames / options.fps > 30 ||
      Math.ceil(
        (options.startTimeSeconds + options.totalFrames / options.fps) * 120,
      ) > 3600
    )
      throw new NativeSourceError(
        "simulation-session-limit",
        "Particle export needs a bounded start and end within 30 seconds and 3600 fixed steps.",
      );
    for (const mount of this.mounts.values()) {
      const spec = mount.definition.simulation;
      const feedback = mount.definition.feedback;
      if (!spec && !feedback) continue;
      const timing = mount.instance.timing;
      const firstLocal =
        timing.time +
        (timing.paused ? 0 : options.startTimeSeconds * timing.speed);
      const lastLocal =
        timing.time +
        (timing.paused
          ? 0
          : (options.startTimeSeconds +
              (options.totalFrames - 1) / options.fps) *
            timing.speed);
      if (spec) {
        const firstStep = Math.floor(firstLocal / spec.fixedDt + 1e-9);
        const lastStep = Math.floor(lastLocal / spec.fixedDt + 1e-9);
        if (
          !Number.isSafeInteger(firstStep) ||
          firstStep + 1 > spec.maxDeterministicSteps ||
          !Number.isSafeInteger(lastStep) ||
          lastStep > 3600
        )
          throw new NativeSourceError(
            "simulation-seek-budget-exceeded",
            `Particle effect ${mount.instance.id} cannot replay its timing offset and requested start within the fixed-step budget.`,
          );
      }
      if (feedback) {
        const firstStep = Math.floor(
          firstLocal / feedback.timing.fixedDt + 1e-7,
        );
        const lastStep = Math.floor(lastLocal / feedback.timing.fixedDt + 1e-7);
        const frameSteps = Math.ceil(
          timing.speed / options.fps / feedback.timing.fixedDt,
        );
        if (
          !Number.isSafeInteger(firstStep) ||
          firstStep > feedback.timing.maxStepsPerCall ||
          !Number.isSafeInteger(lastStep) ||
          lastStep > feedback.timing.maxStepIndex ||
          frameSteps > feedback.timing.maxStepsPerCall
        )
          throw new NativeSourceError(
            "feedback-step-limit",
            `Feedback effect ${mount.instance.id} exceeds its deterministic export step budget.`,
          );
      }
    }
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new NativeSourceError(
        "simulation-session-limit",
        "The particle session timeout is invalid.",
      );
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(
          new NativeSourceError(
            "simulation-session-timeout",
            "The preview did not settle before particle export.",
          ),
        ),
      timeoutMs,
    );
    this.simulationExportStarting = true;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    let snapshot: NativeClockSnapshot | null = null;
    try {
      await this.drainPreviewFrame(controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      for (const mount of this.mounts.values()) {
        if (!mount.feedback?.retirements.size) continue;
        let rejectAbort!: (reason: unknown) => void;
        const aborted = new Promise<never>((_resolve, reject) => {
          rejectAbort = reject;
        });
        const onAbort = () => rejectAbort(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        try {
          await Promise.race([
            Promise.all([...mount.feedback.retirements]),
            aborted,
          ]);
        } finally {
          controller.signal.removeEventListener("abort", onAbort);
        }
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      snapshot = this.suspendForComposition();
      const saved = [...this.mounts.values()]
        .filter(
          (mount) =>
            !!mount.definition.simulation || !!mount.definition.feedback,
        )
        .map((mount) => {
          const entry = {
            mount,
            simulation: mount.simulation,
            feedback: mount.feedback,
            resources: mount.resourceTextures,
            output: mount.outputTexture,
          };
          mount.simulation = null;
          mount.feedback = null;
          this.clearFeedbackTelemetry(mount);
          mount.resourceTextures = new Map();
          mount.outputTexture = null;
          return entry;
        });
      const id = `${this.epoch}:${++this.simulationSessionSerial}`;
      this.simulationExportSession = {
        id,
        fps: options.fps,
        totalFrames: options.totalFrames,
        startTimeSeconds: options.startTimeSeconds,
        nextFrame: 0,
        clock: snapshot,
        saved,
        failed: false,
        deviceEpoch: this.deviceEpoch,
      };
      return { sessionId: id };
    } catch (error) {
      if (snapshot) this.restoreFromComposition(snapshot);
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      this.simulationExportStarting = false;
      if (
        !this.simulationExportSession &&
        this.playing &&
        !this.raf &&
        !this.disposed
      )
        this.frame();
    }
  };

  endSimulationExportSession = async (
    sessionId: string,
    options?: { timeoutMs?: number },
  ): Promise<void> => {
    const session = this.simulationExportSession;
    if (!session || session.id !== sessionId)
      throw new NativeSourceError(
        "simulation-session-invalid",
        "Particle export session identity does not match.",
      );
    const timeoutMs = options?.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new NativeSourceError(
        "simulation-session-limit",
        "The particle session timeout is invalid.",
      );
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new NativeSourceError(
            "simulation-session-timeout",
            "Particle export did not settle before restoration.",
          ),
        ),
      timeoutMs,
    );
    const incomplete =
      session.nextFrame !== session.totalFrames || session.failed;
    try {
      if (this.compositionDone)
        await Promise.race([
          this.compositionDone,
          new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(controller.signal.reason),
              { once: true },
            );
          }),
        ]);
      await this.drainPreviewFrame(controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (session.deviceEpoch !== this.deviceEpoch)
        throw new NativeSourceError(
          "simulation-session-device-lost",
          "The WebGPU device changed during particle export.",
        );
      for (const saved of session.saved) {
        const mount = saved.mount;
        this.releaseSimulation(mount);
        const exportFeedback = mount.feedback;
        mount.feedback = null;
        if (exportFeedback) await this.disposeFeedback(exportFeedback);
        for (const texture of mount.resourceTextures.values())
          this.destroyTexture(texture);
        mount.resourceTextures = saved.resources;
        if (mount.outputTexture && mount.outputTexture !== saved.output)
          this.destroyTexture(mount.outputTexture);
        mount.outputTexture = saved.output;
        mount.simulation = saved.simulation;
        mount.feedback = saved.feedback;
        this.reflectCommittedFeedbackTelemetry(mount);
        mount.simulationCaughtUp = true;
      }
      this.simulationExportSession = null;
      this.restoreFromComposition(session.clock);
      if (this.playing && !this.raf && this.mounts.size && !this.disposed)
        this.frame();
    } catch (error) {
      this.compositionUnsafe = true;
      this.playing = false;
      this.issue("simulation-session-restore-failed", String(error));
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (incomplete)
      throw new NativeSourceError(
        "simulation-session-incomplete",
        "Particle export ended before every requested frame completed.",
      );
  };

  renderCompositionFramePixels = (
    options: NativePixelFrameOptions,
  ): Promise<NativeCompositionPixels> =>
    this.renderCompositionPixelsWithConsumer(
      options,
      async ({ pixels }) => pixels,
    );

  compositionSceneDiagnostic = (): NativeCompositionSceneDiagnostic => ({
    ...this.lastCompositionSceneDiagnostic,
    viewport: { ...this.lastCompositionSceneDiagnostic.viewport },
    expectedVisibleMountIds: [
      ...this.lastCompositionSceneDiagnostic.expectedVisibleMountIds,
    ],
    nativeRecordIds: [...this.lastCompositionSceneDiagnostic.nativeRecordIds],
    missingVisibleMountIds: [
      ...this.lastCompositionSceneDiagnostic.missingVisibleMountIds,
    ],
    mounts: this.lastCompositionSceneDiagnostic.mounts.map((mount) => ({
      ...mount,
    })),
  });

  renderCompositionVectorFrame = <Consumed>(
    options: NativePixelFrameOptions,
    consume: (frame: NativeHeldPixelFrame) => Promise<Consumed>,
  ): Promise<Consumed> =>
    this.renderCompositionPixelsWithConsumer(options, consume);

  renderCompositionFrameGolden = (
    options: NativePixelFrameOptions,
    target: {
      instanceId: string;
      nodeId: string;
      expectedLinearSamples: NativeExpectedLinearSamples;
    },
  ): Promise<{
    pixels: NativeCompositionPixels;
    linearGolden: NativeLinearGoldenSummary;
  }> =>
    this.renderCompositionPixelsWithConsumer(options, async (frame) => ({
      pixels: frame.pixels,
      linearGolden: await this.readLinearGoldenMount(target, frame.signal),
    }));

  renderCompositionFrameValidated = (
    options: NativePixelFrameOptions,
    target: {
      instanceId: string;
      nodeId: string;
      definitionId: string;
      definitionVersion: number;
      executionHash: string;
      expectedLinearSamples?: NativeExpectedLinearSamples;
    },
  ) =>
    this.renderCompositionPixelsWithConsumer(options, async (frame) => ({
      pixels: frame.pixels,
      ...(await this.readMountedOutput(target, frame.signal)),
    }));

  private async readMountedOutput(
    target: {
      instanceId: string;
      nodeId: string;
      definitionId: string;
      definitionVersion: number;
      executionHash: string;
      expectedLinearSamples?: NativeExpectedLinearSamples;
    },
    signal: AbortSignal,
  ): Promise<{
    mountOutput: NativeMountedOutputSummary;
    linearGolden?: NativeLinearGoldenSummary;
  }> {
    if (signal.aborted) throw signal.reason;
    const mount = this.mounts.get(target.instanceId);
    if (
      !mount ||
      mount.instance.nodeId !== target.nodeId ||
      mount.definition.id !== target.definitionId ||
      mount.definition.version !== target.definitionVersion ||
      mount.definitionHash !== target.executionHash ||
      (this.draft?.instanceId === target.instanceId && this.draft.showDraft) ||
      !mount.outputTexture ||
      mount.frozenReason ||
      mount.reportedStatus?.status !== "ready" ||
      mount.target.getAttribute("data-an-native-status") !== "ready"
    )
      throw new NativeSourceError(
        "mounted-output-target-unready",
        "The exact mounted output is unavailable for validation.",
      );
    const texture = mount.outputTexture;
    if (texture.format !== "rgba16float")
      throw new NativeSourceError(
        "mounted-output-format-unavailable",
        "The mounted output is not a linear half-float texture.",
      );
    const plan = planNativeMountedOutputReadback(mount.width, mount.height);
    if (
      this.estimatedResourceBytes() + plan.byteLength >
      MAX_REALM_TEXTURE_BYTES
    )
      throw new NativeSourceError(
        "mounted-output-budget-exceeded",
        "The exact mounted readback exceeds the bounded GPU resource budget.",
      );
    if (texture.width !== plan.width || texture.height !== plan.height)
      throw new NativeSourceError(
        "mounted-output-extent-mismatch",
        "The mounted output extent changed before validation.",
      );
    const device = this.device;
    const generation = this.deviceEpoch;
    const runtimeEpoch = this.epoch;
    const instanceAtStart = mount.instance;
    const definitionAtStart = mount.definition;
    const frameCountAtStart = mount.frameCount;
    const outputAtStart = mount.outputTexture;
    if (!device)
      throw new NativeSourceError(
        "mounted-output-device-unavailable",
        "The mounted output device is unavailable.",
      );
    const assertCurrent = (): void => {
      if (
        signal.aborted ||
        this.device !== device ||
        this.deviceEpoch !== generation ||
        this.epoch !== runtimeEpoch ||
        this.mounts.get(target.instanceId) !== mount ||
        mount.instance !== instanceAtStart ||
        mount.definition !== definitionAtStart ||
        mount.frameCount !== frameCountAtStart ||
        mount.outputTexture !== outputAtStart ||
        mount.definitionHash !== target.executionHash ||
        mount.instance.nodeId !== target.nodeId ||
        mount.frozenReason ||
        mount.reportedStatus?.status !== "ready" ||
        mount.target.getAttribute("data-an-native-status") !== "ready" ||
        (this.draft?.instanceId === target.instanceId && this.draft.showDraft)
      )
        throw new NativeSourceError(
          "mounted-output-stale",
          "The exact mounted output changed during validation.",
        );
    };
    const pinnedHere = !this.activeMounts.has(mount);
    if (pinnedHere) this.activeMounts.add(mount);
    try {
      return await withNativeMountedTextureReadback({
        device,
        texture: outputAtStart,
        plan,
        signal,
        assertCurrent,
        consume: async (mapped) => {
          const evaluated = evaluateNativeMountedOutputBytes(
            mapped,
            plan,
            target.expectedLinearSamples,
          );
          const digest = await crypto.subtle.digest(
            "SHA-256",
            evaluated.packedRgba16f,
          );
          assertCurrent();
          return {
            mountOutput: {
              scope: "exact-mount-output-linear-premultiplied" as const,
              instanceId: target.instanceId,
              nodeId: target.nodeId,
              definitionId: target.definitionId,
              definitionVersion: target.definitionVersion,
              executionHash: target.executionHash,
              width: plan.width,
              height: plan.height,
              pixelSha256: [...new Uint8Array(digest)]
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join(""),
              nonTransparentPixels: evaluated.nonTransparentPixels,
              partialAlphaPixels: evaluated.partialAlphaPixels,
              nonZeroRgbaPixels: evaluated.nonZeroRgbaPixels,
            },
            ...(evaluated.linearGolden
              ? { linearGolden: evaluated.linearGolden }
              : {}),
          };
        },
      });
    } finally {
      if (pinnedHere) this.activeMounts.delete(mount);
    }
  }

  private async readLinearGoldenMount(
    target: {
      instanceId: string;
      nodeId: string;
      expectedLinearSamples: NativeExpectedLinearSamples;
    },
    signal: AbortSignal,
  ): Promise<NativeLinearGoldenSummary> {
    if (signal.aborted) throw signal.reason;
    const mount = this.mounts.get(target.instanceId);
    if (
      !mount ||
      mount.instance.nodeId !== target.nodeId ||
      !mount.outputTexture ||
      mount.frozenReason ||
      mount.target.getAttribute("data-an-native-status") !== "ready"
    )
      throw new NativeSourceError(
        "linear-golden-target-unready",
        "linear-golden-target-unready",
      );
    const texture = mount.outputTexture;
    if (texture.format !== "rgba16float")
      throw new NativeSourceError(
        "linear-golden-format-unavailable",
        "linear-golden-format-unavailable",
      );
    const plan = planNativeLinearGoldenReadback(
      target.expectedLinearSamples,
      mount.width,
      mount.height,
    );
    const device = this.device;
    const generation = this.deviceEpoch;
    if (!device)
      throw new NativeSourceError(
        "linear-golden-device-unavailable",
        "linear-golden-device-unavailable",
      );
    let buffer: GPUBuffer | null = null;
    let mapped = false;
    let scopeOpen = false;
    let failed = false;
    let failure: unknown;
    let summary: NativeLinearGoldenSummary | undefined;
    const pinnedHere = !this.activeMounts.has(mount);
    if (pinnedHere) this.activeMounts.add(mount);
    try {
      buffer = device.createBuffer({
        size: plan.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      device.pushErrorScope("validation");
      scopeOpen = true;
      const encoder = device.createCommandEncoder();
      for (const origin of plan.origins)
        encoder.copyTextureToBuffer(
          { texture, origin: [origin.x, origin.y, 0] },
          {
            buffer,
            offset: origin.offset,
            bytesPerRow: NATIVE_LINEAR_SAMPLE_BYTES_PER_ROW,
            rowsPerImage: 1,
          },
          [1, 1, 1],
        );
      if (signal.aborted) throw signal.reason;
      if (this.device !== device || this.deviceEpoch !== generation)
        throw new NativeSourceError(
          "linear-golden-device-changed",
          "linear-golden-device-changed",
        );
      device.queue.submit([encoder.finish()]);
      const gpuError = await device.popErrorScope();
      scopeOpen = false;
      if (gpuError)
        throw new NativeSourceError(
          "linear-golden-gpu-validation",
          gpuError.message,
        );
      const onAbort = () => buffer?.destroy();
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (signal.aborted) onAbort();
        await buffer.mapAsync(GPUMapMode.READ);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      mapped = true;
      if (signal.aborted) throw signal.reason;
      if (this.device !== device || this.deviceEpoch !== generation)
        throw new NativeSourceError(
          "linear-golden-device-changed",
          "linear-golden-device-changed",
        );
      summary = evaluateNativeLinearGoldenBytes(
        buffer.getMappedRange(),
        target.expectedLinearSamples,
      );
    } catch (error) {
      failed = true;
      failure = error;
    }
    const cleanup: unknown[] = [];
    if (scopeOpen)
      try {
        const gpuError = await device.popErrorScope();
        if (gpuError)
          cleanup.push(
            new NativeSourceError(
              "linear-golden-gpu-validation",
              gpuError.message,
            ),
          );
      } catch (error) {
        cleanup.push(error);
      }
    if (mapped)
      try {
        buffer?.unmap();
      } catch (error) {
        cleanup.push(error);
      }
    try {
      buffer?.destroy();
    } catch (error) {
      cleanup.push(error);
    }
    if (pinnedHere) this.activeMounts.delete(mount);
    if (cleanup.length)
      throw new NativePixelCleanupError(
        failed ? [failure, ...cleanup] : cleanup,
      );
    if (failed) throw failure;
    if (!summary)
      throw new NativeSourceError(
        "linear-golden-incomplete",
        "The requested linear color samples did not complete.",
      );
    return summary;
  }

  private readyNativeCanvases(): readonly HTMLCanvasElement[] {
    const manifests = this.parse();
    if (!manifests)
      throw new NativeSourceError(
        this.parseFailure?.code ?? "manifest-invalid",
        this.parseFailure?.message ??
          "The native effect manifest is unreadable.",
      );
    const enabled = manifests.flatMap((manifest) =>
      manifest.instances.filter((instance) => instance.enabled),
    );
    const ids = new Set(enabled.map((instance) => instance.id));
    if ([...this.mounts.keys()].some((id) => !ids.has(id)))
      throw new NativeSourceError(
        "composition-instance-stale",
        "A removed native effect still has a live presentation canvas.",
      );
    return enabled.map((instance) => {
      const mount = this.mounts.get(instance.id);
      if (
        !mount ||
        mount.instance.nodeId !== instance.nodeId ||
        !mount.outputTexture ||
        !mount.suppressed ||
        mount.frozenReason ||
        !mount.canvas.isConnected ||
        !mount.target.isConnected ||
        mount.target.getAttribute("data-an-native-status") !== "ready"
      )
        throw new NativeSourceError(
          "composition-instance-unready",
          `Native effect ${instance.id} has no completed live presentation canvas.`,
        );
      return mount.canvas;
    });
  }

  private renderCompositionPixelsWithConsumer = async <Consumed>(
    options: NativePixelFrameOptions,
    consume: (frame: NativeHeldPixelFrame) => Promise<Consumed>,
  ): Promise<Consumed> => {
    const simulationSession = this.simulationExportSession;
    if (simulationSession) {
      if (
        options.simulationSessionId !== simulationSession.id ||
        options.frameIndex !== simulationSession.nextFrame ||
        options.fps !== simulationSession.fps ||
        (options.startTimeSeconds ?? 0) !==
          simulationSession.startTimeSeconds ||
        simulationSession.failed
      )
        throw new NativeSourceError(
          "simulation-session-sequence",
          "Particle export frames must use the active session and a monotonic frame index.",
        );
    } else if (options.simulationSessionId) {
      throw new NativeSourceError(
        "simulation-session-invalid",
        "Particle export session is unavailable.",
      );
    } else if (
      [...this.mounts.values()].some(
        (mount) => mount.definition.simulation || mount.definition.feedback,
      )
    ) {
      throw new NativeSourceError(
        "simulation-session-required",
        "Persistent particle effects need a bounded export session.",
      );
    }
    this.assertCompositionIdle(!!simulationSession);
    const { pixelRatio } = this.pixelFrameDimensions(options);
    this.compositionPixelBusy = true;
    const previousRatio = this.compositionPixelRatio;
    this.compositionPixelRatio = pixelRatio;
    let frameFailed = false;
    let frameFailure: unknown;
    try {
      const held = await this.withSynchronizedCompositionFrame(
        options,
        async (_rendered, frame) => {
          let failed = false;
          let failure: unknown;
          let consumed!: Consumed;
          try {
            const pixels = await this.readCompositionPixels(options, frame);
            if (frame.signal.aborted) throw frame.signal.reason;
            consumed = await consume({
              document,
              pixels,
              runtimeCanvases: this.readyNativeCanvases(),
              viewport: { ...options.viewport },
              pixelRatio,
              signal: frame.signal,
            });
            if (frame.signal.aborted) throw frame.signal.reason;
          } catch (error) {
            failed = true;
            failure = error;
            frameFailed = true;
            frameFailure = error;
          }
          this.compositionPixelRatio = previousRatio;
          const previewRatio =
            previousRatio ?? this.previewStatus().effectivePixelRatio;
          if (
            pixelRatio !== previewRatio &&
            this.mounts.size > 0 &&
            !this.disposed &&
            !this.compositionUnsafe
          ) {
            try {
              const restored = await this.restorePreviewDensity(
                frame.timeSeconds,
              );
              if (restored.failures.length)
                throw new NativeRenderFailure(restored, "preview-density");
            } catch (restoreError) {
              if (failed)
                throw new NativePixelCleanupError([failure, restoreError]);
              throw restoreError;
            }
          }
          if (failed) throw failure;
          return consumed;
        },
        true,
      );
      if (simulationSession) simulationSession.nextFrame += 1;
      return held.value;
    } catch (error) {
      if (simulationSession) simulationSession.failed = true;
      if (
        frameFailed &&
        error !== frameFailure &&
        !(
          error instanceof NativePixelCleanupError &&
          error.causes[0] === frameFailure
        )
      )
        throw new NativePixelCleanupError([frameFailure, error]);
      throw error;
    } finally {
      this.compositionPixelRatio = previousRatio;
      this.compositionPixelBusy = false;
      if (
        !this.compositionAbort &&
        !this.compositionUnsafe &&
        this.playing &&
        this.mounts.size &&
        !this.raf &&
        !this.disposed
      )
        this.frame();
    }
  };

  private async restorePreviewDensity(
    time: number,
  ): Promise<NativeRenderResult> {
    const restore = this.renderInternal(time, true).finally(() => {
      this.previewRestoreWork = null;
    });
    this.previewRestoreWork = restore;
    return await restore;
  }

  private pixelFrameDimensions(options: NativePixelFrameOptions): {
    pixelRatio: number;
    width: number;
    height: number;
  } {
    const pixelRatio = options?.pixelRatio ?? devicePixelRatio;
    const cssWidth = options?.viewport?.width;
    const cssHeight = options?.viewport?.height;
    if (
      typeof cssWidth !== "number" ||
      typeof cssHeight !== "number" ||
      !Number.isSafeInteger(cssWidth) ||
      !Number.isSafeInteger(cssHeight)
    )
      throw new NativeSourceError(
        "composition-viewport-invalid",
        "The selected Design viewport has invalid dimensions.",
      );
    const width = Math.ceil(cssWidth * pixelRatio);
    const height = Math.ceil(cssHeight * pixelRatio);
    if (
      cssWidth < 1 ||
      cssHeight < 1 ||
      Math.abs(innerWidth - cssWidth) > 1 ||
      Math.abs(innerHeight - cssHeight) > 1
    )
      throw new NativeSourceError(
        "composition-viewport-mismatch",
        "The prepared source viewport does not match the selected Design screen.",
      );
    if (
      !Number.isFinite(pixelRatio) ||
      pixelRatio <= 0 ||
      pixelRatio > 4 ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION ||
      width * height > MAX_PIXELS
    )
      throw new NativeSourceError(
        "composition-size-unsupported",
        "The selected viewport exceeds bounded SDR export dimensions.",
      );
    return { pixelRatio, width, height };
  }

  private async readCompositionPixels(
    options: NativePixelFrameOptions,
    frame: NativeCompositionFrame,
  ): Promise<NativeCompositionPixels> {
    if (frame.signal.aborted) throw frame.signal.reason;
    const root = document.documentElement;
    const { pixelRatio, width, height } = this.pixelFrameDimensions(options);
    this.lastCompositionSceneDiagnostic = {
      stage: "not-captured",
      viewport: { ...options.viewport },
      expectedVisibleMountIds: [],
      nativeRecordIds: [],
      missingVisibleMountIds: [],
      mounts: [],
      omittedMounts: 0,
      omittedRecords: 0,
    };
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const bufferBytes = bytesPerRow * height;
    if (bufferBytes > MAX_RESOURCE_BYTES)
      throw new NativeSourceError(
        "composition-budget-exceeded",
        "The aligned GPU pixel buffer exceeds the export resource budget.",
      );
    const provider = createNativeSceneProvider(root, "layer");
    if (!provider)
      throw new NativeSourceError(
        "composition-source-unavailable",
        "The authored scene cannot be read for export.",
      );
    provider.setDensity(pixelRatio);
    const surface: CompositionSurface = {
      target: root,
      width,
      height,
      pixelRatio,
      resourceTextures: new Map(),
      isolationTextures: new Map(),
      drawBindings: new Map(),
      sourceTextures: new Map(),
      imageRasters: 0,
      sourceDownsamples: 0,
    };
    const pinned = [...this.mounts.values()].filter(
      (mount) => !this.activeMounts.has(mount),
    );
    for (const mount of pinned) this.activeMounts.add(mount);
    let buffer: GPUBuffer | null = null;
    let mapped = false;
    let scopeOpen = false;
    let scopedDevice: GPUDevice | null = null;
    let failed = false;
    let failure: unknown;
    let pixels: NativeCompositionPixels | undefined;
    try {
      const device = await this.ensureDevice();
      const deviceEpoch = this.deviceEpoch;
      const scene = await provider.readScene();
      const nativeRecords = scene.filter(
        (record) =>
          record.nativeInstanceId &&
          record.rect.width > 0 &&
          record.rect.height > 0 &&
          record.clip.width > 0 &&
          record.clip.height > 0 &&
          record.rect.x < options.viewport.width &&
          record.rect.y < options.viewport.height &&
          record.rect.x + record.rect.width > 0 &&
          record.rect.y + record.rect.height > 0,
      );
      const nativeRecordCounts = new Map<string, number>();
      for (const record of nativeRecords)
        nativeRecordCounts.set(
          record.nativeInstanceId!,
          (nativeRecordCounts.get(record.nativeInstanceId!) ?? 0) + 1,
        );
      const representedNativeIds = this.representedNativeInstances(
        new Set(nativeRecordCounts.keys()),
      );
      const visibleMounts = [...this.mounts.values()].filter(
        (mount) =>
          mount.isTopLayer &&
          mount.suppressed &&
          !!mount.outputTexture &&
          !this.groupLocalNoncontributing(mount) &&
          nativePresentationVisible(mount.canvas, options.viewport),
      );
      const missingVisibleMountIds = visibleMounts
        .filter((mount) => !representedNativeIds.has(mount.instance.id))
        .map((mount) => mount.instance.id);
      const mounted = [...this.mounts.values()];
      this.lastCompositionSceneDiagnostic = {
        stage: "scene-read",
        viewport: { ...options.viewport },
        expectedVisibleMountIds: visibleMounts
          .slice(0, 64)
          .map((mount) => mount.instance.id),
        nativeRecordIds: nativeRecords
          .slice(0, 64)
          .map((record) => record.nativeInstanceId!),
        missingVisibleMountIds: missingVisibleMountIds.slice(0, 64),
        mounts: mounted.slice(0, 64).map((mount) => {
          const style = getComputedStyle(mount.canvas);
          return {
            instanceId: mount.instance.id,
            nodeId: mount.instance.nodeId,
            status: mount.target.getAttribute("data-an-native-status"),
            canvasVisibility: style.visibility,
            canvasDisplay: style.display,
            outputWidth: mount.outputTexture?.width ?? 0,
            outputHeight: mount.outputTexture?.height ?? 0,
            sceneRecords: nativeRecordCounts.get(mount.instance.id) ?? 0,
          };
        }),
        omittedMounts: Math.max(0, mounted.length - 64),
        omittedRecords: Math.max(0, nativeRecords.length - 64),
      };
      if (missingVisibleMountIds.length)
        throw new NativeSourceError(
          "composition-native-record-missing",
          `Full-scene capture omitted ${missingVisibleMountIds.length} visible native effect surface${missingVisibleMountIds.length === 1 ? "" : "s"}.`,
        );
      if (frame.signal.aborted) throw frame.signal.reason;
      if (this.device !== device || this.deviceEpoch !== deviceEpoch)
        throw new NativeSourceError(
          "device-generation-changed",
          "The GPU device changed during full-scene acquisition.",
        );
      const cssEncoded =
        this.colorPresented === "srgb" && this.dynamicRangePresented === "sdr";
      const pipeline = await this.pipeline(
        cssEncoded ? exportCssPixelsWgsl : exportPixelsWgsl,
        "rgba8unorm",
      );
      if (this.device !== device || this.deviceEpoch !== deviceEpoch)
        throw new NativeSourceError(
          "device-generation-changed",
          "The GPU device changed during export pipeline creation.",
        );
      device.pushErrorScope("validation");
      scopeOpen = true;
      scopedDevice = device;
      const encoder = device.createCommandEncoder();
      const source = await this.composeScene(
        surface,
        scene,
        encoder,
        "source",
        cssEncoded ? "srgb-css" : "linear",
      );
      if (frame.signal.aborted) throw frame.signal.reason;
      if (this.device !== device || this.deviceEpoch !== deviceEpoch)
        throw new NativeSourceError(
          "device-generation-changed",
          "The GPU device changed during full-scene composition.",
        );
      this.ensureCompositionBudget(surface, width * height * 4);
      surface.resourceTextures.set(
        "__export_encoded",
        this.texture(width, height, "rgba8unorm", GPUTextureUsage.COPY_SRC),
      );
      const encoded = surface.resourceTextures.get("__export_encoded")!;
      const binding = this.bind(
        surface,
        "__export_transfer",
        pipeline,
        source,
        null,
        new Float32Array([width, height, 0, 0, 1, 0, 0, 0]),
      );
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: encoded.createView(),
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
      if (this.estimatedResourceBytes() + bufferBytes > MAX_REALM_TEXTURE_BYTES)
        throw new NativeSourceError(
          "gpu-budget-exceeded",
          "The full-scene readback exceeds the bounded GPU resource budget.",
        );
      buffer = device.createBuffer({
        size: bufferBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      encoder.copyTextureToBuffer(
        { texture: encoded },
        { buffer, bytesPerRow, rowsPerImage: height },
        [width, height, 1],
      );
      if (frame.signal.aborted) throw frame.signal.reason;
      if (this.device !== device || this.deviceEpoch !== deviceEpoch)
        throw new NativeSourceError(
          "device-generation-changed",
          "The GPU device changed before export submission.",
        );
      device.queue.submit([encoder.finish()]);
      const gpuValidation = device.popErrorScope();
      scopeOpen = false;
      const gpuError = await gpuValidation;
      if (gpuError)
        throw new NativeSourceError("gpu-validation", gpuError.message);
      const onAbort = () => buffer?.destroy();
      frame.signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (frame.signal.aborted) onAbort();
        await buffer.mapAsync(GPUMapMode.READ);
      } catch (error) {
        if (frame.signal.aborted) throw frame.signal.reason;
        throw new NativeSourceError(
          "gpu-readback-failed",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        frame.signal.removeEventListener("abort", onAbort);
      }
      mapped = true;
      if (frame.signal.aborted) throw frame.signal.reason;
      if (this.device !== device || this.deviceEpoch !== deviceEpoch)
        throw new NativeSourceError(
          "device-generation-changed",
          "The GPU device changed during export readback.",
        );
      const padded = new Uint8Array(buffer.getMappedRange());
      const rgba = rgbaFromAlignedRows(padded, width, height, bytesPerRow);
      pixels = { width, height, colorSpace: "srgb", alpha: "straight", rgba };
    } catch (error) {
      failed = true;
      failure = error;
    }
    const cleanupErrors: unknown[] = [];
    const clean = async (
      release: () => void | Promise<void>,
    ): Promise<void> => {
      try {
        await release();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (scopeOpen && scopedDevice)
      await clean(async () => {
        const error = await scopedDevice.popErrorScope();
        if (error) throw new NativeSourceError("gpu-validation", error.message);
      });
    if (mapped) await clean(() => buffer?.unmap());
    await clean(() => buffer?.destroy());
    await clean(() => provider.dispose());
    for (const mount of pinned)
      await clean(() => {
        this.activeMounts.delete(mount);
      });
    for (const entry of surface.sourceTextures.values())
      await clean(() => this.destroyTexture(entry.texture));
    for (const texture of surface.resourceTextures.values())
      await clean(() => this.destroyTexture(texture));
    for (const entry of surface.isolationTextures.values())
      await clean(() => this.destroyTexture(entry.texture));
    for (const entry of surface.drawBindings.values())
      await clean(() => this.destroyUniform(entry.buffer));
    if (cleanupErrors.length)
      throw new NativePixelCleanupError([
        ...(failed ? [failure] : []),
        ...cleanupErrors,
      ]);
    if (failed) throw failure;
    if (!pixels)
      throw new NativeSourceError(
        "gpu-readback-incomplete",
        "The full-scene readback produced no pixels.",
      );
    return pixels;
  }

  private onMessage = (event: MessageEvent): void => {
    if (!event.data || typeof event.data !== "object") return;
    if (event.source !== window) {
      if (event.source !== window.parent) return;
      let inheritedOrigin: string;
      try {
        inheritedOrigin = nativeDocumentOrigin();
      } catch (error) {
        this.issue("source-origin-unavailable", String(error));
        return;
      }
      if (event.origin !== inheritedOrigin) return;
    }
    const data = event.data as Record<string, unknown>;
    if (
      data.type === "native-effect-set-instance" ||
      data.type === "native-effect-clear-instance"
    ) {
      if (window.parent === window || event.source !== window.parent) return;
      if (
        data.schemaVersion !== 1 ||
        typeof data.requestId !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(data.requestId) ||
        typeof data.instanceId !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(data.instanceId) ||
        typeof data.nodeId !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(data.nodeId) ||
        typeof data.sequence !== "number" ||
        !Number.isSafeInteger(data.sequence) ||
        data.sequence < 0 ||
        typeof data.baseExecutionHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.baseExecutionHash) ||
        typeof data.baseInstanceSignature !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.baseInstanceSignature) ||
        typeof data.runtimeEpoch !== "string" ||
        data.runtimeEpoch.length > 80
      )
        return;
      const request = data as NativeInstancePreviewRequest;
      const fail = (code: string): void =>
        this.postInstancePreviewResult(
          request,
          "error",
          this.instancePreviewDisplay(request.instanceId),
          code,
        );
      if (request.runtimeEpoch !== this.epoch) {
        fail("instance-preview-runtime-stale");
        return;
      }
      if (
        this.compositionDone ||
        this.compositionPixelBusy ||
        this.draft ||
        this.draftRequestPending
      ) {
        fail("instance-preview-busy");
        return;
      }
      if (!this.mounts.has(request.instanceId)) {
        fail("instance-preview-target-stale");
        return;
      }
      if (
        request.type === "native-effect-set-instance" &&
        (typeof request.opacity !== "number" ||
          !Number.isFinite(request.opacity) ||
          request.opacity < 0 ||
          request.opacity > 1 ||
          (request.transform !== null &&
            (!request.transform ||
              typeof request.transform !== "object" ||
              Array.isArray(request.transform))))
      ) {
        fail("instance-preview-invalid");
        return;
      }
      const previousSequence = this.instancePreviewSequence.get(
        request.instanceId,
      );
      if (
        previousSequence !== undefined &&
        request.sequence <= previousSequence
      ) {
        fail("instance-preview-superseded");
        return;
      }
      if (
        previousSequence === undefined &&
        this.instancePreviewSequence.size >= 512
      ) {
        fail("instance-preview-capacity");
        return;
      }
      this.instancePreviewSequence.set(request.instanceId, request.sequence);
      const generation = ++this.instancePreviewGeneration;
      this.postInstancePreviewResult(
        request,
        "pending",
        this.instancePreviewDisplay(request.instanceId),
      );
      void this.applyInstancePreview(request, generation).catch((error) =>
        this.postInstancePreviewResult(
          request,
          "error",
          this.instancePreviewDisplay(request.instanceId),
          error instanceof NativeSourceError
            ? error.code
            : "instance-preview-render-failed",
        ),
      );
      return;
    }
    if (
      data.type === "native-shader-draft-preview" ||
      data.type === "native-shader-draft-control"
    ) {
      if (window.parent === window || event.source !== window.parent) return;
      if (
        data.schemaVersion !== 1 ||
        typeof data.requestId !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(data.requestId) ||
        typeof data.instanceId !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(data.instanceId)
      )
        return;
      const requestId = data.requestId;
      const instanceId = data.instanceId;
      const validHash = (value: unknown): value is string =>
        typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
      const commonValid =
        typeof data.runtimeEpoch === "string" &&
        data.runtimeEpoch.length <= 80 &&
        validHash(data.baseExecutionHash);
      if (!commonValid) {
        this.postDraftResult(requestId, instanceId, "error", [
          this.draftFailure(
            "draft-request-invalid",
            "The draft request is malformed.",
          ),
        ]);
        return;
      }
      const generation = ++this.draftGeneration;
      if (data.type === "native-shader-draft-preview") {
        if (
          typeof data.nodeId !== "string" ||
          !/^[A-Za-z0-9_.:-]{1,128}$/.test(data.nodeId) ||
          !validHash(data.expectedExecutionHash) ||
          !data.draftDefinition ||
          typeof data.draftDefinition !== "object" ||
          !data.params ||
          typeof data.params !== "object" ||
          Array.isArray(data.params) ||
          typeof data.seed !== "number" ||
          !Number.isFinite(data.seed) ||
          typeof data.time !== "number" ||
          !Number.isFinite(data.time) ||
          data.time < 0
        ) {
          this.postDraftResult(requestId, instanceId, "error", [
            this.draftFailure(
              "draft-request-invalid",
              "The draft request is malformed.",
            ),
          ]);
          return;
        }
        this.postDraftResult(requestId, instanceId, "pending");
        void this.previewDraft(
          data as NativeDraftPreviewRequest,
          generation,
        ).catch((error) =>
          this.postDraftResult(requestId, instanceId, "error", [
            this.draftFailure(
              error instanceof NativeSourceError
                ? error.code
                : "draft-preview-failed",
              error instanceof Error ? error.message : String(error),
            ),
          ]),
        );
      } else {
        if (
          ![
            "clear",
            "show-published",
            "show-draft",
            "set-time",
            "play",
            "pause",
          ].includes(String(data.command))
        ) {
          this.postDraftResult(requestId, instanceId, "error", [
            this.draftFailure(
              "draft-control-invalid",
              "The draft control is malformed.",
            ),
          ]);
          return;
        }
        void this.controlDraft(
          data as NativeDraftPreviewControl,
          generation,
        ).catch((error) =>
          this.postDraftResult(requestId, instanceId, "error", [
            this.draftFailure(
              error instanceof NativeSourceError
                ? error.code
                : "draft-control-failed",
              error instanceof Error ? error.message : String(error),
            ),
          ]),
        );
      }
      return;
    }
    if (data.type === "native-shader-device-reset") {
      if (window.parent === window || event.source !== window.parent) return;
      void this.resetDevice().catch((error) =>
        this.issue("device-reset-failed", String(error)),
      );
      return;
    }
    if (data.type === "native-shader-approvals") {
      if (window.parent === window || event.source !== window.parent) return;
      try {
        if (data.status === "ready") {
          const parsed = parseNativeEffectApprovalState({
            schemaVersion: 1,
            hashes: data.hashes,
          });
          this.approvedHashes = new Set(parsed.hashes);
          this.approvalStatus = "ready";
        } else if (
          (data.status === "pending" || data.status === "unreadable") &&
          !Object.prototype.hasOwnProperty.call(data, "hashes")
        ) {
          this.approvedHashes.clear();
          this.approvalStatus = data.status;
        } else {
          throw new NativeSourceError(
            "approvals-unreadable",
            "The parent approval status is malformed.",
          );
        }
        this.requestScan();
      } catch (error) {
        this.approvedHashes.clear();
        this.approvalStatus = "unreadable";
        this.issue("approvals-unreadable", String(error));
        this.requestScan();
      }
      return;
    }
    if (data.type === "native-shader-status-request") {
      if (window.parent === window || event.source !== window.parent) return;
      if (
        typeof data.requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(data.requestId) ||
        typeof data.instanceId !== "string" ||
        data.instanceId.length > 128 ||
        typeof data.nodeId !== "string" ||
        data.nodeId.length > 128
      )
        return;
      this.emitCurrentStatus(data.instanceId, data.nodeId, data.requestId);
      return;
    }
    if (data.type === "native-shader-rescan") {
      this.requestScan();
      return;
    }
    if (
      data.type === "native-shader-clock" &&
      typeof data.time === "number" &&
      Number.isFinite(data.time) &&
      data.time >= 0
    ) {
      void this.setTime(data.time).catch((error) =>
        this.issue("clock-render-failed", String(error)),
      );
      return;
    }
    if (typeof data.instanceId !== "string") return;
    if (
      data.type === "native-shader-set-parameters" &&
      data.params &&
      typeof data.params === "object" &&
      !Array.isArray(data.params)
    ) {
      void this.setParameters(
        data.instanceId,
        data.params as Record<string, unknown>,
      ).catch((error) =>
        this.issue("params-invalid", String(error), data.instanceId as string),
      );
    }
    if (
      data.type === "native-effect-set-param" &&
      typeof data.name === "string"
    ) {
      void this.setParameters(data.instanceId, {
        [data.name]: data.value,
      }).catch((error) =>
        this.issue("params-invalid", String(error), data.instanceId as string),
      );
    }
  };

  private publishIdleSourceDiagnostic(continuousMountIds: string[]): void {
    const mounts = [...this.mounts.values()].slice(0, 8).map((mount) => {
      const source = mount.provider?.diagnosticSnapshot();
      return {
        instanceId: mount.instance.id,
        placement: mount.instance.placement,
        animationCapability: mount.animationCapability,
        continuous: continuousMountIds.includes(mount.instance.id),
        readSceneCalls: source?.readSceneCalls ?? null,
        captures: source?.captures ?? null,
        invalidations: source?.invalidations ?? null,
        leaves:
          source?.leaves.slice(0, 6).map((leaf) => ({
            nodeId: leaf.nodeId,
            kind: leaf.kind,
            captures: leaf.captures,
            invalidations: leaf.invalidations,
            captureCauses: leaf.captureCauses,
            recreations: leaf.recreations,
            observedAttributes: leaf.observedAttributes,
          })) ?? null,
      };
    });
    document.documentElement.setAttribute(
      "data-an-native-source-idle-diagnostic",
      JSON.stringify({
        mounts,
        omittedMounts: Math.max(0, this.mounts.size - 8),
      }),
    );
  }

  private scheduleIdleSourcePoll(): void {
    if (this.idleSourceTimer || this.raf || this.disposed || !this.mounts.size)
      return;
    this.idleSourceTimer = window.setTimeout(() => {
      this.idleSourceTimer = 0;
      if (this.disposed || !this.mounts.size) return;
      if (this.raf) return;
      if (
        this.compositionAbort ||
        this.compositionPixelBusy ||
        this.simulationExportSession ||
        this.simulationExportStarting ||
        this.draftRequestPending ||
        this.instancePreviewPending ||
        this.running ||
        this.scanning
      ) {
        this.scheduleIdleSourcePoll();
        return;
      }
      if (
        document.documentElement.hasAttribute(
          "data-an-native-source-idle-observer",
        )
      ) {
        const continuousMountIds = [...this.mounts.values()]
          .filter((mount) => mount.provider?.needsContinuousFrames())
          .map((mount) => mount.instance.id);
        this.publishIdleSourceDiagnostic(continuousMountIds);
        if (continuousMountIds.length) this.requestSourceFrame();
        else this.scheduleIdleSourcePoll();
        return;
      }
      if (
        [...this.mounts.values()].some((mount) =>
          mount.provider?.needsContinuousFrames(),
        )
      )
        this.requestSourceFrame();
      else this.scheduleIdleSourcePoll();
    }, 250);
  }

  private clearIdleSourcePoll(): void {
    clearTimeout(this.idleSourceTimer);
    this.idleSourceTimer = 0;
  }

  private frame = (rafTimestamp?: number): void => {
    this.raf = 0;
    if (
      this.draftRequestPending ||
      this.instancePreviewPending ||
      this.disposed ||
      this.compositionAbort ||
      this.compositionPixelBusy ||
      this.simulationExportSession ||
      this.simulationExportStarting ||
      this.mounts.size === 0
    ) {
      this.rafIntervalTelemetry.reset();
      this.scheduleIdleSourcePoll();
      return;
    }
    const framePlan = planNativeSceneFrame(
      this.mounts.values(),
      this.playing,
      this.draft ? this.draft.playing : null,
      this.mountedBenchmark !== null,
      this.previewDirty,
      Boolean(this.running || this.scanning),
    );
    if (!framePlan.enter) {
      this.rafIntervalTelemetry.reset();
      this.scheduleIdleSourcePoll();
      return;
    }
    if (!this.device && this.deviceLifecycle.exhausted()) {
      this.rafIntervalTelemetry.reset();
      return;
    }
    if (!this.device && this.deviceLifecycle.retryAfterMs() > 0) {
      this.rafIntervalTelemetry.reset();
      this.scheduleDeviceRetry();
      return;
    }
    const now = performance.now();
    this.mountedBenchmark?.onFrame(rafTimestamp, () =>
      this.mountedBenchmarkVisibility(),
    );
    const rafInterval = this.rafIntervalTelemetry.onFrame(
      rafTimestamp,
      framePlan.scheduleNext,
    );
    if (rafInterval !== null)
      this.recordProfile(this.rafIntervalSamples, rafInterval);
    if (framePlan.scheduleNext) {
      this.clearIdleSourcePoll();
      this.raf = requestAnimationFrame(this.frame);
    } else this.scheduleIdleSourcePoll();
    if (
      framePlan.maySubmit &&
      this.previewPolicy.shouldSubmit(now, this.previewDirty)
    ) {
      this.previewDirty = false;
      void this.renderInternal(this.currentTime(), false);
    }
  };

  private requestSourceFrame = (): void => {
    this.previewDirty = true;
    if (this.presentationFaultHold) return;
    if (
      this.disposed ||
      this.compositionAbort ||
      this.compositionPixelBusy ||
      this.simulationExportSession ||
      this.simulationExportStarting
    )
      return;
    this.clearIdleSourcePoll();
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    try {
      this.loadStandaloneApprovals();
    } catch (error) {
      this.approvedHashes.clear();
      this.approvalStatus = "unreadable";
      this.issue("approvals-unreadable", String(error));
    }
    for (const canvas of document.querySelectorAll(
      "canvas[data-an-native-canvas],canvas[data-an-native-presentation]",
    ))
      canvas.remove();
    for (const target of document.querySelectorAll<HTMLElement>(
      "[data-agent-native-node-id]",
    ))
      for (const attribute of [...target.attributes])
        if (
          attribute.name.startsWith("data-an-native-") &&
          attribute.name !== "data-an-native-source-idle-observer"
        )
          target.removeAttribute(attribute.name);
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-an-native-fill-host],[data-an-native-fill-positioned],[data-an-native-fill-instance],[data-an-native-parent-positioned],[data-an-native-fill-suppressed],[data-an-native-text-suppressed],[data-an-native-layer-suppressed],[data-an-native-scene-suppressed],[data-an-native-authored-opacity],[data-an-native-authored-background-color],[data-an-native-authored-background-image],[data-an-native-authored-color],[data-an-native-authored-text-fill-color],[data-an-native-layer-instance]",
    ))
      for (const name of [
        "data-an-native-fill-host",
        "data-an-native-fill-positioned",
        "data-an-native-fill-instance",
        "data-an-native-parent-positioned",
        "data-an-native-fill-suppressed",
        "data-an-native-text-suppressed",
        "data-an-native-layer-suppressed",
        "data-an-native-scene-suppressed",
        "data-an-native-authored-opacity",
        "data-an-native-authored-background-color",
        "data-an-native-authored-background-image",
        "data-an-native-authored-color",
        "data-an-native-authored-text-fill-color",
        "data-an-native-layer-instance",
      ])
        element.removeAttribute(name);
    window.addEventListener("message", this.onMessage);
    this.authoredStyleObserver = new MutationObserver((records) => {
      const isPresentationSwap = (record: MutationRecord): boolean =>
        [...this.mounts.values()].some(
          (mount) =>
            mount.presentationPair &&
            isNativePresentationPairSwap(record, mount.presentationPair),
        );
      const isOwnedSceneCanvas = (node: Node): node is HTMLCanvasElement =>
        node instanceof HTMLCanvasElement &&
        this.sceneCanvasIdentities.has(node) &&
        (node === this.scenePresentation?.canvas || !node.isConnected);
      const isScenePresentationMutation = (record: MutationRecord): boolean => {
        if (record.type !== "childList")
          return isOwnedSceneCanvas(record.target);
        if (record.target !== document.body) return false;
        const changed = [...record.addedNodes, ...record.removedNodes];
        return changed.length > 0 && changed.every(isOwnedSceneCanvas);
      };
      const authoredRecords = records.filter(
        (record) =>
          record.target !== this.runtimeScript &&
          !isPresentationSwap(record) &&
          !isScenePresentationMutation(record) &&
          ![...this.mounts.values()].some(
            (mount) =>
              record.target === mount.canvas ||
              mount.canvas.contains(record.target),
          ),
      );
      if (this.compositionAbort && authoredRecords.length)
        this.compositionAbort.abort();
      if (
        authoredRecords.some((record) => document.head.contains(record.target))
      ) {
        for (const mount of this.mounts.values())
          mount.authoredStyleDirty = true;
        return;
      }
      for (const record of authoredRecords) {
        if (record.type !== "attributes" || !(record.target instanceof Element))
          continue;
        for (const mount of this.mounts.values())
          if (
            record.target === mount.target ||
            record.target.contains(mount.target)
          )
            mount.authoredStyleDirty = true;
      }
    });
    this.authoredStyleObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
      childList: true,
      characterData: true,
      subtree: true,
    });
    const affectsEffects = (node: Node): boolean => {
      if (!(node instanceof Element)) return false;
      return (
        node.matches(
          `script[type="${SCRIPT_TYPE}"],[data-agent-native-node-id]`,
        ) ||
        !!node.querySelector(
          `script[type="${SCRIPT_TYPE}"],[data-agent-native-node-id]`,
        )
      );
    };
    this.rescanObserver = new MutationObserver((records) => {
      if (
        !records.some((record) => {
          if (record.type === "characterData")
            return record.target.parentElement?.closest(
              `script[type="${SCRIPT_TYPE}"]`,
            );
          if (record.type === "attributes")
            return (
              record.target instanceof Element &&
              (record.target instanceof HTMLScriptElement ||
                record.attributeName === "data-agent-native-node-id")
            );
          if (
            record.target instanceof HTMLScriptElement &&
            record.target.type === SCRIPT_TYPE
          )
            return true;
          return [...record.addedNodes, ...record.removedNodes].some(
            affectsEffects,
          );
        })
      )
        return;
      clearTimeout(this.rescanTimer);
      this.rescanTimer = window.setTimeout(() => this.requestScan(), 0);
    });
    this.rescanObserver.observe(document.documentElement, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["type", "data-agent-native-node-id"],
      subtree: true,
    });
    this.requestScan();
  }

  dispose(): void {
    if (this.disposed) return;
    this.presentationFaultLatch.clear();
    this.presentationFaultHold = false;
    this.presentationMirrorCapture = false;
    this.compositionAbort?.abort();
    this.mountedBenchmark?.fail(
      new NativeMountedBenchmarkError("benchmark-aborted"),
    );
    this.disposed = true;
    this.clearIdleSourcePoll();
    document.documentElement.removeAttribute(
      "data-an-native-source-idle-diagnostic",
    );
    this.pause();
    this.rescanObserver?.disconnect();
    this.authoredStyleObserver?.disconnect();
    window.removeEventListener("message", this.onMessage);
    clearTimeout(this.rescanTimer);
    clearTimeout(this.deviceRetryTimer);
    if (this.scenePresentation)
      this.unpublishScenePresentation(this.scenePresentation);
    const pending: Promise<unknown>[] = [];
    if (this.compositionDone) pending.push(this.compositionDone);
    if (this.scanning) pending.push(this.scanning);
    if (this.previewRestoreWork) pending.push(this.previewRestoreWork);
    if (this.running) pending.push(this.running);
    if (pending.length) {
      void Promise.allSettled(pending).then(() =>
        this.releaseDisposedResources(),
      );
      return;
    }
    this.releaseDisposedResources();
  }

  private releaseDisposedResources(): void {
    this.releaseScenePresentation();
    this.gpuProfiler?.dispose();
    this.gpuProfiler = null;
    this.publishedPresentationMirror.clear();
    this.embeddedAssetBlobs.clear();
    this.embeddedAssets = undefined;
    this.clearDraftState();
    this.instancePreview = null;
    this.instancePreviewGeneration += 1;
    this.instancePreviewPending = false;
    this.instancePreviewSequence.clear();
    if (this.simulationExportSession) {
      this.releaseSimulationExportSaved(this.simulationExportSession);
      this.simulationExportSession = null;
    }
    for (const [id, mount] of this.mounts) {
      this.unmount(mount);
      this.mounts.delete(id);
    }
    document.documentElement.removeAttribute("data-an-native-profile");
    document.documentElement.removeAttribute("data-an-native-preview-quality");
    document.documentElement.removeAttribute(
      "data-an-native-preview-target-fps",
    );
    document.documentElement.removeAttribute(
      "data-an-native-preview-pixel-ratio",
    );
    for (const buffer of this.retirement.splice(0)) this.destroyUniform(buffer);
    for (const texture of this.textureRetirement.splice(0))
      this.destroyTexture(texture);
    this.destroyTexture(this.transparent);
    this.destroyTexture(this.white);
    this.pipelines.reset();
    this.simulationComputePipelines.reset();
    this.statelessPipelines.reset();
    this.simulationRenderPipelines.reset();
    this.simulationLayout = null;
    this.simulationPipelineLayout = null;
    if (this.presentationSheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== this.presentationSheet,
      );
      this.presentationSheet = null;
    }
    this.deviceLifecycle.dispose();
    this.device = null;
  }
}

declare global {
  interface Window {
    __anNativeShaders?: NativeShaderRuntime;
  }
}

const prior = window.__anNativeShaders;
prior?.dispose();
const runtime = new NativeShaderRuntime(document.currentScript);
window.__anNativeShaders = runtime;
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => runtime.start(), {
    once: true,
  });
else runtime.start();
