import {
  nativeBuiltinDefinitionIds,
  nativeBuiltinExecutionMetadata,
  nativeBuiltinHistoricalDensityHashes,
} from "../../../../.generated/bridge/native-builtin-metadata.generated";
import { nativeWorkerSource } from "../../../../.generated/bridge/native-worker-source.generated";
import {
  feedbackUniformProperties,
  planEffectGraph,
  type EffectPass,
  type EffectResourceSpec,
} from "../../../../shared/effect-graph";
import { resolveNativeClipRadii } from "../../../../shared/native-clip-geometry";
import type {
  NativeDraftPreviewControl,
  NativeDraftPreviewDiagnostic,
  NativeDraftPreviewRequest,
  NativeDraftPreviewResult,
} from "../../../../shared/native-draft-preview-contract";
import { isEffectPreviewPolicy } from "../../../../shared/native-editor-preferences";
import type { NativeEffectAnimationCapability } from "../../../../shared/native-effect-animation-capability";
import {
  nativeMountNeedsContinuousSourceFrames,
  planNativeSceneFrame,
} from "../../../../shared/native-effect-frame-policy";
import { planNativeEffectTransform } from "../../../../shared/native-effect-transform";
import {
  hashEffectDefinition,
  nativeDefinitionAuthorizationError,
  parseNativeEffectApprovalState,
} from "../../../../shared/native-effect-trust";
import {
  packNativeProperties,
  validateEffectDocument,
  usesRetiredNativeImageAbi,
  type EffectDefinition,
  type EffectDocument,
  type EffectInstance,
  type EffectPreviewPolicy,
} from "../../../../shared/native-effects";
import {
  NATIVE_EMBEDDED_ASSETS_ATTR,
  NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE,
  parseNativeEmbeddedAssetRegistryText,
  type NativeEmbeddedAssetEntry,
} from "../../../../shared/native-embedded-assets";
import {
  planNativeExportRegion,
  type NativeExportRegion,
} from "../../../../shared/native-export-region";
import {
  adaptNativeFeedbackDefinition,
  nativeFeedbackResetValuesChanged,
  type NativeFeedbackDefinition,
} from "../../../../shared/native-feedback-plan";
import { planNativeInputResources } from "../../../../shared/native-input-resources";
import {
  hashEffectInstance,
  type NativeInstancePreviewRequest,
  type NativeInstancePreviewResult,
} from "../../../../shared/native-instance-preview-contract";
import { isLinearResourceDispatch } from "../../../../shared/native-linear-resource-graph";
import { resolveNativeParameterAnimation } from "../../../../shared/native-parameter-animation";
import { NativePipelineCache } from "../../../../shared/native-pipeline-cache";
import { NativePipelineCacheCapacityError } from "../../../../shared/native-pipeline-cache";
import {
  NativePointerHistory,
  NativePointerHistoryError,
  sampleNativePointerHistory,
  validateNativePointerHistorySnapshot,
  type NativePointerHistoryEvent,
  type NativePointerReplayEntry,
} from "../../../../shared/native-pointer-history";
import {
  mapNativePointerInput,
  packNativePointerProperties,
  resolveNativeFeedbackPointerInput,
  type NativePointerState,
} from "../../../../shared/native-pointer-input";
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
  nativeStatefulResetValuesChanged,
  snapshotNativeStatefulResetValues,
  NativeStatefulResetValueError,
  type NativeStatefulResetValues,
} from "../../../../shared/native-stateful-reset-values";
import { isStatefulResourceGraph } from "../../../../shared/native-stateful-resource-graph";
import {
  isStatelessComputeDispatch,
  NativeStatelessComputeError,
  planStatelessCompute,
} from "../../../../shared/native-stateless-compute";
import {
  NativeStaticGeneratorPassCache,
  nativeStaticGeneratorPassKey,
} from "../../../../shared/native-static-generator-pass-cache";
import {
  assertNativeUniformTiming,
  NativeUniformTimingError,
  packNativeUniformClock,
} from "../../../../shared/native-uniform-timing";
import {
  clearNativeAuthoredOpacityIfUnsuppressed,
  readNativeAuthoredPaint,
} from "./native-authored-paint";
import {
  NativeBoundedFrameScheduler,
  type NativeFrameSlot,
  type NativePreparedScheduledFrame,
} from "./native-bounded-frame-scheduler";
import { recordNativeCameraClip } from "./native-camera-recorder";
import { planNativePhysicalRootBox } from "./native-capture-roi";
import {
  detectNativeDisplayDynamicRange,
  hasFloatColorPath,
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
  planNativeFillPresentationExtent,
  type NativeEffectExtentPlan,
} from "./native-effect-extent";
import {
  planNativeOutputGeometry,
  supportsNativeOutput2D,
} from "./native-effect-output-geometry";
import {
  filterNativeExportSelection,
  resolveNativeExportSelection,
} from "./native-export-selection";
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
  NativeCameraError,
  NativeLiveCameraSource,
} from "./native-live-camera-source";
import {
  emptyNativeBenchmarkPhaseValues,
  emptyNativeBenchmarkFullFrameValues,
  emptyNativeSourceReadSceneMetrics,
  NativeMountedBenchmarkError,
  NativeMountedBenchmarkRun,
  type NativeBenchmarkPhaseValues,
  type NativeBenchmarkFullFrameValues,
  type NativeMountedBenchmarkRenderFailure,
  type NativeMountedBenchmarkRequest,
  type NativeMountedBenchmarkWindow,
} from "./native-mounted-benchmark";
import {
  evaluateNativeMountedOutputBytes,
  planNativeMountedOutputReadback,
  withNativeMountedTextureReadback,
} from "./native-mounted-output-summary";
import {
  NativePackedUniformArena,
  type NativePackedUniformFrame,
} from "./native-packed-uniform-arena";
import { NativeParameterPreviewQueue } from "./native-parameter-preview-queue";
import {
  NativePixelCleanupError,
  rgbaFromAlignedRows,
} from "./native-pixel-readback";
import { updateNativePlaybackClock } from "./native-playback-clock";
import {
  canRetainNativePresentationAfterFailure,
  canDetachPresentationFromSources,
  NativePresentationPair,
} from "./native-presentation-pair";
import {
  compactNativePresentationReadback,
  NativePublishedPresentationMirror,
  planNativePresentationReadback,
} from "./native-presentation-readback";
import {
  NativePresentationSlots,
  type NativePresentationLease,
} from "./native-presentation-slots";
import { planNativePreviewBudget } from "./native-preview-budget";
import {
  fitNativeRasterDensity,
  nativePreviewPhysicalViewport,
  nativePreviewBoxesOverlap,
  nativePreviewTargetDensity,
  NATIVE_PREVIEW_INSET_ATTRIBUTES,
  readNativePreviewInsetClip,
  planNativePreviewViewport,
  type NativePreviewBox,
} from "./native-preview-geometry";
import {
  NativePreviewPolicyController,
  resolveNativePreviewPolicy,
  type NativePreviewStatus,
} from "./native-preview-policy";
import { NativeRafIntervalTelemetry } from "./native-raf-interval";
import {
  buildNativeReceiverFields,
  packNativeReceiverFloat16,
} from "./native-receiver-distance";
import { beginNativeRegionExport } from "./native-region-export";
import { nativeRenderPlacementConstants } from "./native-render-placement";
import { createNativeRuntimeEpoch } from "./native-runtime-epoch";
import {
  NativeSimulationTimelineError,
  planNativeSimulationSteps,
} from "./native-simulation-timeline";
import {
  createNativeSimulationTransaction,
  NativeSimulationTransactionError,
  type NativeSimulationBank,
  type NativeSimulationTransaction,
} from "./native-simulation-transaction";
import {
  composeNativeSourceAffine,
  planNativeSourceAffine,
  type NativeAffine2D,
  type NativeAffineBox,
} from "./native-source-affine-geometry";
import { planNativeSourceCoordinateScale } from "./native-source-coordinate-scale";
import { nativeSourceFrameCommitEpoch } from "./native-source-frame-witness";
import {
  createNativeSceneProvider,
  cloneNativeTextFlow,
  isNativeSourceOmittedMutation,
  nativeClientToTargetAffine,
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
  type NativeSourceCaptureInsets,
  type NativeSourceRecord,
  type NativeSourceReadSceneMetrics,
} from "./native-source-provider";
import {
  planNativeImageSampling,
  planNativeImageUpload,
} from "./native-source-sampling";
import {
  NativeStatefulResourceSession,
  acquireNativeStatefulOutput,
  planNativeStatefulSourceCaptureTimes,
  resolveNativeStatefulTargetStep,
  type NativeStatefulEncodedFrame,
} from "./native-stateful-resource";
import {
  NativeStatelessComputePipelines,
  type NativeStatelessComputeFrame,
} from "./native-stateless-compute";
import {
  NativeStatelessFrameTransaction,
  NativeStatelessFrameTransactionError,
  NativeStatelessFrameRetirementError,
} from "./native-stateless-frame-transaction";
import { NativeSubmissionPipeline } from "./native-submission-pipeline";
import {
  nativeSvgViewportSize,
  nativeSvgViewportToClient,
} from "./native-svg-geometry";
import {
  NativeFeedbackFailure,
  NativeTextureFeedbackExecutor,
  trackNativeFeedbackRetirement,
  type NativeFeedbackEncodedFrame,
} from "./native-texture-feedback";
import {
  compositeWgsl,
  backdropReplaceWgsl,
  cssSceneDecodeWgsl,
  groupLocalBackdropSourceWgsl,
  fillCompositeWgsl,
  fillPresentationWgsl,
  fillCoveredUnderlayWgsl,
  fillCoveredBoxWgsl,
  fillTextMixWgsl,
  presentWgsl,
  exportCssPixelsWgsl,
  exportPixelsWgsl,
  finishWgsl,
  linearPremultInputWgsl,
  encodedMipWgsl,
  inputMaskWgsl,
} from "./native-worker-gpu-wgsl";
import { NativeWorkerHostError } from "./native-worker-host";
import {
  NativeWorkerSceneHost,
  type NativeWorkerSceneEntry,
} from "./native-worker-scene-host";

const BUILTIN_NATIVE_CAPABILITIES = new Map<
  string,
  NativeEffectAnimationCapability
>(nativeBuiltinExecutionMetadata);
const BUILTIN_NATIVE_HASHES = new Set(BUILTIN_NATIVE_CAPABILITIES.keys());
const BUILTIN_NATIVE_IDS = new Set<string>(nativeBuiltinDefinitionIds);
const HISTORICAL_DENSITY_HASHES = new Set<string>(
  nativeBuiltinHistoricalDensityHashes,
);

function sameEditorPreviewPolicy(
  current: EffectPreviewPolicy | null,
  next: EffectPreviewPolicy | null,
): boolean {
  return (
    current === next ||
    (current !== null &&
      next !== null &&
      current.quality === next.quality &&
      current.frameRateTarget === next.frameRateTarget &&
      current.colorMode === next.colorMode &&
      current.dynamicRange === next.dynamicRange)
  );
}

function builtinAnimationCapability(
  executionHash: string,
): NativeEffectAnimationCapability {
  return BUILTIN_NATIVE_CAPABILITIES.get(executionHash) ?? "unknown";
}

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

function nativeMountedBenchmarkFailure(
  error: unknown,
): NativeMountedBenchmarkRenderFailure | undefined {
  if (error instanceof NativeRenderFailure) return error.result.failures[0];
  if (!(error instanceof Error)) return undefined;
  const coded = error as Error & { code?: unknown; instanceId?: unknown };
  return {
    code:
      typeof coded.code === "string" &&
      /^[a-z][a-z0-9-]{0,79}$/.test(coded.code)
        ? coded.code
        : "render-failed",
    message: error.message,
    ...(typeof coded.instanceId === "string"
      ? { instanceId: coded.instanceId }
      : {}),
  };
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
  offset?: number;
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
  receiverCoverage?: GPUTexture;
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
  complete: Set<string>;
  staged: Map<
    string,
    {
      mount: Mount;
      texture: GPUTexture;
      resources?: NativeFrameResourceScratch<GPUTexture>;
      simulationFrame?: NativeSimulationFrame;
      statefulFrame?: NativeStatefulEncodedFrame;
      feedbackFrame?: NativeFeedbackEncodedFrame;
      sourceEpoch: number | null;
      instancePayload: string;
      definitionHash: string;
      localTime: number;
      inputEpochs: NonNullable<Mount["pendingGraphInputEpochs"]>;
    }
  >;
  authoredEpochs: Map<string, number>;
  noncontributing: Set<string>;
};
type AuthoredInputCapture = {
  target: NativeScenePresentationElement;
  nodeId: string;
  capture: "content" | "appearance";
  provider: NativeSceneProvider;
  surface: CompositionSurface;
  capturedSourceEpoch: number | null;
  capturedAuthoredEpoch: number | null;
  replaySafety: "immutable" | "dynamic" | "unknown";
  borrowed?: AuthoredInputReuse;
  borrowedImages?: readonly { source: HTMLImageElement; url: string }[];
};
type AuthoredInputReuse = {
  key: string;
  owner: Mount;
  resource: string;
  capture: AuthoredInputCapture;
  texture: GPUTexture;
  sourceEpoch: number;
  authoredEpoch: number;
  images: readonly { source: HTMLImageElement; url: string }[];
  deviceEpoch: number;
  renderEpoch: number;
};
type NativeSimulationState = {
  buffers: [GPUBuffer, GPUBuffer, GPUBuffer];
  readIndex: NativeSimulationBank;
  completedStep: number;
  count: number;
  byteLength: number;
  width: number;
  height: number;
  definitionKey: string;
  seed: number;
  trailOutput: string;
  pointer: { x: number; y: number; vx: number; vy: number; active: boolean };
};

type NativeSimulationFrame = {
  transaction: NativeSimulationTransaction;
  state: NativeSimulationState;
  previousState: NativeSimulationState | null;
  caughtUp: boolean;
  targetStep: number;
  count: number;
  pointer: NativeSimulationState["pointer"];
  pointerSource: NativePointerState | null;
};

interface NativePresentationTarget extends Pick<
  Mount,
  "canvas" | "context" | "presentationPair"
> {
  instance?: EffectInstance;
  width?: number;
  height?: number;
}

type NativeFrameCandidate = {
  texture: GPUTexture;
  extent: NativeEffectExtentPlan | null;
  coverage?: GPUTexture;
  width: number;
  height: number;
  pixelRatio: number;
  definitionHash: string;
  instancePayload: string;
  authoredEpoch: number;
  deviceEpoch: number;
};

type NativeStatelessFrameContext = {
  transaction: NativeStatelessFrameTransaction<NativeFrameCandidate>;
  candidates: Map<string, NativeFrameCandidate>;
  jobs: Map<
    string,
    { submitted: Promise<void>; outcome: Promise<PromiseSettledResult<void>> }
  >;
  publishing: boolean;
  statuses: Array<() => void>;
  commands: GPUCommandBuffer[];
  markQueued: Array<() => void>;
  afterSubmit: Array<() => void>;
  submission: Promise<void>;
  submissionOutcome: Promise<PromiseSettledResult<void>>;
  resolveSubmission(): void;
  rejectSubmission(error: unknown): void;
  validationScope: { device: GPUDevice; epoch: number; open: boolean };
};

type NativeGeneratedFillEntry = {
  canonical: Mount;
  presentation: NativePresentationSlots<GPUCanvasContext>;
  boxes: readonly [GPUTexture, GPUTexture, GPUTexture, GPUTexture];
  payload: string;
  definitionHash: string;
  sourceEpoch: number;
  authoredEpoch: number;
  bounds: string;
};
type NativeGeneratedFillSlot = {
  buffer: GPUBuffer;
  arena: NativePackedUniformArena<GPUBuffer>;
  states: Map<string, Mount>;
};
type NativeGeneratedFillFamily = {
  device: GPUDevice;
  deviceEpoch: number;
  hostGeneration: number;
  viewport: string;
  density: number;
  presentationFormat: string;
  entries: NativeGeneratedFillEntry[];
  slots: readonly [
    NativeGeneratedFillSlot,
    NativeGeneratedFillSlot,
    NativeGeneratedFillSlot,
  ];
  scheduler: NativeBoundedFrameScheduler;
  releasePins(): void;
  cancelled: boolean;
  cadenceStart: number;
  cadenceFrames: number;
};

type Mount = {
  instance: EffectInstance;
  definition: EffectDefinition;
  definitionHash: string;
  animationCapability: NativeEffectAnimationCapability;
  target: NativeScenePresentationElement;
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  presentationPair: NativePresentationPair<GPUCanvasContext> | null;
  presentationParent: HTMLElement;
  provider: NativeSceneProvider | null;
  resourceTextures: Map<string, GPUTexture>;
  staticGeneratorPassCache: NativeStaticGeneratorPassCache<GPUTexture>;
  graphPipelinePins: Map<string, () => void>;
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
  authoredInputs: Map<string, AuthoredInputCapture>;
  pendingGraphInputEpochs: Map<
    string,
    { capture: AuthoredInputCapture; sourceEpoch: number }
  > | null;
  outputTexture: GPUTexture | null;
  groupLocalCommittedChildren: Set<string>;
  groupLocalNoncontributingChildren: Set<string>;
  fillCommittedNativeChildren: Set<string>;
  layerCommittedNativeSources: Set<string>;
  width: number;
  height: number;
  pixelRatio: number;
  outputExtent: NativeEffectExtentPlan | null;
  fillPresentationExtent: NativeEffectExtentPlan | null;
  captureInsets: { top: number; right: number; bottom: number; left: number };
  maskTexture: GPUTexture | null;
  maskSignature: string;
  inputMaskSignature: string;
  inputMaskUsedFrame: number;
  suppressed: boolean;
  retainedPresentationWitness: boolean;
  frameCount: number;
  committedSourceEpoch: number | null;
  committedInstancePayload: string | null;
  committedDefinitionHash: string | null;
  committedLocalTime: number | null;
  committedInputEpochs: Map<
    string,
    { capture: AuthoredInputCapture; sourceEpoch: number }
  >;
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
  simulation: NativeSimulationState | null;
  simulationFrame: NativeSimulationFrame | null;
  pointerListener: EventListener | null;
  pointerLeaveListener: (() => void) | null;
  pointerState: NativePointerState | null;
  pointerHistory: NativePointerHistory | null;
  simulationCaughtUp: boolean;
  feedback: {
    executor: NativeTextureFeedbackExecutor;
    definition: NativeFeedbackDefinition;
    textures: Set<GPUTexture>;
    definitionHash: string;
    seed: number;
    resetPropertyValues: readonly (readonly [string, number])[];
    seekRevision: number;
    sourceIdentity: string;
    sourceRevision: string;
    pendingSourceRevision: string | null;
    pointerPosition: NativePointerState | null;
    pendingPointerPosition: NativePointerState | null;
    sourceWidth: number;
    sourceHeight: number;
    retirements: Set<Promise<void>>;
  } | null;
  feedbackCandidate: Mount["feedback"];
  feedbackFrame: NativeFeedbackEncodedFrame | null;
  stateful: {
    executor: NativeStatefulResourceSession;
    definitionHash: string;
    seed: number;
    resetPropertyValues: NativeStatefulResetValues;
    seekRevision: number;
    sourceIdentity: string;
    sourceRevision: string;
    pendingSourceRevision: string | null;
    sourceWidth: number;
    sourceHeight: number;
    droppedSteps: number;
    pendingDroppedSteps: number;
    textures: Set<GPUTexture>;
    buffers: Set<GPUBuffer>;
  } | null;
  statefulCandidate: Mount["stateful"];
  statefulFrame: NativeStatefulEncodedFrame | null;
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
  caughtUp: boolean;
  simulation: Mount["simulation"];
  simulationFrame: NativeSimulationFrame | null;
  pointerHistory: NativePointerHistory | null;
  stateful: Mount["stateful"];
  statefulCandidate: Mount["stateful"];
  statefulFrame: NativeStatefulEncodedFrame | null;
  statefulResources: Map<string, GPUTexture>;
  feedback: Mount["feedback"];
  feedbackCandidate: Mount["feedback"];
  feedbackFrame: NativeFeedbackEncodedFrame | null;
  resources: Map<string, GPUTexture>;
  publishedResources: Map<string, GPUTexture>;
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
  budgetOwner?: Mount;
  instance?: EffectInstance;
  pixelRatio?: number;
  viewport?: NativePreviewBox;
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
  viewport?: { width: number; height: number };
  cropRect?: NativeExportRegion;
  selectedNodeIds?: string[];
  pixelRatio?: number;
  timeSeconds?: number;
  committedInstances?: readonly {
    instanceId: string;
    payloadSha256: string;
    localTime: number;
  }[];
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
  cropRect?: NativeExportRegion;
  selectedNodeIds?: string[];
  simulationSessionId?: string;
  repeatCurrentSimulationFrame?: true;
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
    instance: Mount["instance"];
    simulation: Mount["simulation"];
    feedback: Mount["feedback"];
    stateful: Mount["stateful"];
    resources: Map<string, GPUTexture>;
    output: GPUTexture | null;
  }[];
  failed: boolean;
  sourceStale: boolean;
  deviceEpoch: number;
  pointerReplay: Map<string, NativePointerReplayEntry> | null;
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
const unavailableFeedbackStateFollowups = {
  sourceTransition: {
    availability: "unavailable",
    code: "second-source-fixture-required",
  },
  lifecycleReplay: {
    availability: "unavailable",
    code: "multi-action-editor-sequence-required",
  },
} as const;
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

type NativeScenePresentationElement = HTMLElement | SVGSVGElement;

function isNativeScenePresentationElement(
  element: Element,
): element is NativeScenePresentationElement {
  return element instanceof HTMLElement || element instanceof SVGSVGElement;
}

export function nativePresentationTargetLayout(
  target: HTMLElement | SVGSVGElement,
) {
  const style = getComputedStyle(target);
  if (target instanceof HTMLElement)
    return {
      width: target.offsetWidth,
      height: target.offsetHeight,
      offsetLeft: target.offsetLeft,
      offsetTop: target.offsetTop,
      transform: style.transform,
      transformOrigin: style.transformOrigin,
      translate: style.translate,
      rotate: style.rotate,
      scale: style.scale,
    };
  const parent = target.parentElement;
  if (!(parent instanceof HTMLElement))
    throw new NativeSourceError(
      "source-inline-svg",
      "A native SVG target needs an HTML parent.",
    );
  const combined = composeNativeSourceAffine(
    nativeClientToTargetAffine(parent),
    nativeSvgViewportToClient(target),
  );
  if (!combined.ok)
    throw new NativeSourceError(
      "source-transform",
      "The SVG presentation transform is unreadable.",
    );
  const { a, b, c, d, e, f } = combined.matrix;
  return {
    ...nativeSvgViewportSize(target),
    offsetLeft: e + parent.scrollLeft - parent.clientLeft,
    offsetTop: f + parent.scrollTop - parent.clientTop,
    transform: `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)`,
    transformOrigin: "0px 0px",
    translate: "none",
    rotate: "none",
    scale: "none",
  };
}

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
  private receiverInteriorBox: GPUTexture | null = null;
  private compositePipeline: GPURenderPipeline | null = null;
  private fillCompositePipeline: GPURenderPipeline | null = null;
  private fillTextPipeline: GPURenderPipeline | null = null;
  private presentPipeline: GPURenderPipeline | null = null;
  private finishPipeline: GPURenderPipeline | null = null;
  private effectPipelineLayouts = new Map<number, GPUPipelineLayout>();
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
  private workerScene: NativeWorkerSceneHost | null = null;
  private retiringWorkerScene: NativeWorkerSceneHost | null = null;
  private workerEntries: NativeWorkerSceneEntry[] = [];
  private workerPreviewBase: EffectInstance | null = null;
  private legacyDraftSession = false;
  private workerCapabilityBlocked = false;
  private workerRecoveryAttempts = 0;
  private workerRecoveryQueued = false;
  private cameraReportedState = "idle";
  private cameraFrameTexture: {
    texture: GPUTexture;
    device: GPUDevice;
    epoch: number;
  } | null = null;
  private cameraSnapshot: ImageBitmap | null = null;
  private cameraClip: {
    nextFrame: (
      frameIndex: number,
      signal: AbortSignal,
    ) => Promise<ImageBitmap>;
    dispose: () => void;
  } | null = null;
  private readonly cameraSource = new NativeLiveCameraSource(() => {
    const state = this.cameraSource.state();
    if (state === "stopped") this.releaseCameraTexture();
    if (state !== this.cameraReportedState) {
      this.cameraReportedState = state;
      if (window.parent !== window) {
        try {
          window.parent.dispatchEvent(new Event("an-native-camera-state"));
        } catch (error) {
          console.warn(
            "Unable to dispatch camera state to the parent window.",
            error,
          );
        }
      }
    }
    if (this.hasCameraConsumer()) this.requestSourceFrame();
  });
  private positionedParents = new Map<HTMLElement, number>();
  private presentationSheet: CSSStyleSheet | null = null;
  private sceneBudgetFault: {
    signature: string;
    resourceBytes: number;
  } | null = null;
  private scenePresentation: {
    canvas: HTMLCanvasElement;
    context: GPUCanvasContext;
    presentationPair: NativePresentationPair<GPUCanvasContext> | null;
    provider: NativeSceneProvider;
    surface: CompositionSurface;
    suppressedElements: Set<NativeScenePresentationElement>;
    committedInstances: Set<string>;
    committedInstancePayloads: Map<
      string,
      { payload: string; definitionHash: string; localTime: number }
    >;
    committedSourceEpoch: number | null;
    onViewportChange: () => void;
    epoch: number;
  } | null = null;
  private issues: Diagnostic[] = [];
  private playing = true;
  private submissionPipeline: NativeSubmissionPipeline | null = null;
  private frameTransaction: NativeStatelessFrameContext | null = null;
  private packedUniformFrame: {
    arena: NativePackedUniformArena<GPUBuffer>;
    token: NativePackedUniformFrame;
    owners: WeakMap<CompositionSurface, string>;
    occurrences: Map<string, number>;
  } | null = null;
  private packedArenaBuffers = new Set<GPUBuffer>();
  private generatedFillFamily: NativeGeneratedFillFamily | null = null;
  private generatedFillStarting = false;
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
  private compositionOutputRegion: NativeExportRegion | null = null;
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
  private simulationExportStartInvalidated = false;
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
  private generatedFillWork = new Set<Promise<NativeRenderResult>>();
  private scopedDraftTimeInstanceId: string | null = null;
  private disposed = false;
  private disposalDone: Promise<void> | null = null;
  disposalState: "idle" | "pending" | "complete" | "failed" = "idle";
  private started = false;
  private rescanObserver: MutationObserver | null = null;
  private authoredStyleObserver: MutationObserver | null = null;
  private rescanTimer = 0;
  private renderEpoch = 0;
  private retirement: GPUBuffer[] = [];
  private textureRetirement: GPUTexture[] = [];
  private retirementInFlightTextures = new Set<GPUTexture>();
  private retirementPending = false;
  private retirementWork: Promise<void> = Promise.resolve();
  private textureBytes = new Map<GPUTexture, number>();
  private graphStorageTextures = new WeakSet<GPUTexture>();
  private destroyedTextures = new WeakSet<GPUTexture>();
  private allocatedTextureBytes = 0;
  private uniformBytes = new Map<GPUBuffer, number>();
  private graphUniformLeases = new Map<GPUBuffer, number>();
  private graphUniformDestruction = new Set<GPUBuffer>();
  private allocatedUniformBytes = 0;
  private statelessBufferBytes = new Map<GPUBuffer, number>();
  private allocatedStatelessBytes = 0;
  private statelessTextureLeases = new Map<GPUTexture, number>();
  private statelessDeviceLeases = new Map<GPUDevice, number>();
  private destroyedDevices = new WeakSet<GPUDevice>();
  private statelessTextureDestruction = new Set<GPUTexture>();
  private statelessDeviceDestruction = new Set<GPUDevice>();
  private statefulBufferLeases = new Map<GPUBuffer, number>();
  private statefulBufferDestruction = new Set<GPUBuffer>();
  private statelessPipelines =
    new NativePipelineCache<NativeStatelessComputePipelines>(16);
  private graphPipelines = new NativePipelineCache<
    GPURenderPipeline | GPUComputePipeline
  >(32);
  private statelessFrames = new Map<
    GPUCommandEncoder,
    NativeStatelessComputeFrame[]
  >();
  private statelessRetirements = new Set<Promise<void>>();
  private authoredInputReuse = new WeakMap<
    NativeScenePresentationElement,
    Map<string, AuthoredInputReuse>
  >();
  private authoredInputReuseEpoch = -1;
  private receiverGeometryCache = new Map<
    Mount,
    {
      source: HTMLCanvasElement;
      revision: number;
      epoch: number;
      width: number;
      height: number;
      cssWidth: number;
      cssHeight: number;
      geometryKind: "svg-silhouette" | "svg-group-silhouette" | "box";
      alpha: Uint8Array;
      geometry: GPUTexture;
      interior?: GPUTexture;
      coverage: GPUTexture;
    }
  >();
  private activeMounts = new Set<Mount>();
  private parameterPreviews = new NativeParameterPreviewQueue(
    (instanceId, params) => {
      const mount = this.mounts.get(instanceId);
      const definition =
        mount?.definition ??
        this.workerEntries.find((entry) => entry.instance.id === instanceId)
          ?.definition;
      if (!definition)
        throw new Error(`Native effect ${instanceId} is not mounted.`);
      for (const name of Object.keys(params))
        if (!Object.prototype.hasOwnProperty.call(definition.properties, name))
          throw new Error(`Native effect property "${name}" is not declared.`);
    },
    async (instanceId, params, isCurrent) => {
      while (this.scanning || this.running) {
        if (this.scanning) await this.scanning;
        if (this.running) await this.running;
      }
      if (!isCurrent()) return;
      await this.setParameters(instanceId, params);
    },
    (instanceId, error) =>
      this.issue("params-invalid", String(error), instanceId),
  );
  private renderWallSamples: number[] = [];
  private rafIntervalSamples: number[] = [];
  private mountedBenchmark: NativeMountedBenchmarkRun | null = null;
  private mountedBenchmarkRenderMetrics: {
    sourceWallMs: number;
    composeWallMs: number;
    hostWallPhases: NativeBenchmarkPhaseValues;
    fullFrameWallPhases: NativeBenchmarkFullFrameValues;
    sourceReadDetail: NativeSourceReadSceneMetrics;
  } | null = null;
  private previewPolicy = new NativePreviewPolicyController();
  private previewViewport: NativePreviewBox | null = null;
  private previewDisplayScale = 1;
  private previewHostObserver: MutationObserver | null = null;
  private previewHostResizeObserver: ResizeObserver | null = null;
  private previewHostParent: Window | null = null;
  private previewHostFrame = 0;
  private previewHostFramePending = false;
  private previewHostGeneration = 0;
  private previewFrameHostGeneration = 0;
  private previewTargetDensities = new Map<
    NativeScenePresentationElement,
    number
  >();
  private previewScenePixelRatio: number | null = null;
  private previewSceneBudgetSignature = "";
  private previewBudgetSignature = "";
  private previewBudgetDensities = new Map<string, number>();
  private editorPreviewPolicy: EffectPreviewPolicy | null = null;
  private previewDirty = true;
  private rafIntervalTelemetry = new NativeRafIntervalTelemetry();
  private profileFrames = 0;
  private rejectedTargets = new Set<NativeScenePresentationElement>();
  private scanFailures: Diagnostic[] = [];
  private parseFailure: Diagnostic | null = null;
  private approvedHashes = new Set<string>();
  private approvalStatus: ApprovalStatus =
    window.parent === window ? "ready" : "pending";
  private rejectedById = new Map<string, Diagnostic & { nodeId: string }>();
  private sentStatus = new Map<string, { signature: string; at: number }>();
  private scanning: Promise<void> | null = null;
  private rescanPending = false;
  private draft: DraftPreview | null = null;
  private draftGeneration = 0;
  private draftReservedGeneration = 0;
  private draftWorkSettled: Promise<PromiseSettledResult<void>> =
    Promise.resolve({ status: "fulfilled", value: undefined });
  private draftPendingCount = 0;
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
      :root:not([data-an-native-scene-managed]) [data-an-native-fill-suppressed] { opacity: 0 !important; }
      :root:not([data-an-native-scene-managed]) [data-an-native-text-suppressed], :root:not([data-an-native-scene-managed]) [data-an-native-text-suppressed] * { color: transparent !important; -webkit-text-fill-color: transparent !important; }
      :root:not([data-an-native-scene-managed]) [data-an-native-layer-suppressed] { opacity: 0 !important; }
      :root[data-an-native-scene-managed] canvas[data-an-native-presentation]:not([data-an-native-scene-presentation]) { opacity: 0 !important; }
      [data-an-native-scene-suppressed] { opacity: 0 !important; }
      [data-an-native-receiver-suppressed] { opacity: 0 !important; }
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

  private hasCurrentScenePresentation(
    scene: NonNullable<NativeShaderRuntime["scenePresentation"]>,
  ): boolean {
    return (
      this.scenePresentation === scene &&
      scene.canvas.isConnected &&
      scene.canvas.style.visibility === "visible" &&
      [...scene.suppressedElements].every(
        (element) =>
          element.isConnected &&
          element.hasAttribute("data-an-native-scene-suppressed"),
      )
    );
  }

  private releaseScenePresentation(): void {
    const scene = this.scenePresentation;
    if (scene) {
      this.scenePresentation = null;
      this.unpublishScenePresentation(scene);
      scene.provider.dispose();
      scene.presentationPair?.dispose();
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
    this.syncScenePresentationMode(false);
  }

  private retainScenePresentationOnFailure(): void {
    const scene = this.scenePresentation;
    if (
      scene &&
      scene.committedSourceEpoch !== null &&
      this.hasCurrentScenePresentation(scene)
    )
      return;
    this.releaseScenePresentation();
  }

  private assertCurrentSceneCommit(
    scene: NonNullable<NativeShaderRuntime["scenePresentation"]>,
  ): void {
    if (
      !this.hasCurrentScenePresentation(scene) ||
      scene.committedSourceEpoch === null ||
      scene.provider.sourceEpoch?.() !== scene.committedSourceEpoch ||
      [...this.mounts.values()].some(
        (mount) =>
          scene.committedInstancePayloads.get(mount.instance.id)?.payload !==
          JSON.stringify(mount.instance),
      )
    )
      throw new NativeSourceError(
        "composition-preview-stale",
        "The visible native scene has no current complete committed frame.",
      );
  }

  private syncSceneSourceOpacity(mount: Mount): void {
    for (const { canvas } of mount.presentationPair?.surfaces() ?? [
      { canvas: mount.canvas },
    ]) {
      if (document.documentElement.hasAttribute("data-an-native-scene-managed"))
        canvas.setAttribute(
          "data-an-native-authored-opacity",
          mount.instance.placement === "backdrop"
            ? "1"
            : mount.canvas.style.opacity || "1",
        );
      else if (mount.instance.placement !== "backdrop")
        canvas.removeAttribute("data-an-native-authored-opacity");
    }
  }

  private syncScenePresentationMode(managed: boolean): void {
    document.documentElement.toggleAttribute(
      "data-an-native-scene-managed",
      managed,
    );
    for (const mount of this.mounts.values())
      this.syncSceneSourceOpacity(mount);
  }

  private restoreIndividualPresentationsAfterSceneFailure(): void {
    this.syncScenePresentationMode(false);
    for (const mount of this.mounts.values()) {
      if (mount.instance.placement === "backdrop") {
        this.showOriginal(mount);
      } else if (mount.outputTexture && mount.suppressed) {
        this.syncPresentation(mount);
      } else {
        this.showOriginal(mount);
      }
    }
  }

  private groupLocalNoncontributing(mount: Mount): boolean {
    if (mount.instance.placement !== "backdrop") return false;
    const owner = this.nestedBackdropOwner(mount.target);
    if (!owner) return false;
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
    const pending = [...directIds];
    const addCommitted = (childId: string): void => {
      if (represented.has(childId)) return;
      represented.add(childId);
      pending.push(childId);
    };
    for (let index = 0; index < pending.length; index += 1) {
      const id = pending[index];
      const parent = this.mounts.get(id);
      if (!parent?.outputTexture) continue;
      for (const previousId of [
        parent.previousLayerId,
        parent.previousFillId,
      ]) {
        if (!previousId) continue;
        const previous = this.mounts.get(previousId);
        if (previous?.outputTexture && previous.target === parent.target)
          addCommitted(previousId);
      }
      if (parent.instance.placement === "layer")
        for (const sourceId of parent.layerCommittedNativeSources) {
          const source = this.mounts.get(sourceId);
          if (source?.outputTexture && parent.target.contains(source.target))
            addCommitted(sourceId);
        }
      if (parent.instance.placement === "fill")
        for (const childId of parent.fillCommittedNativeChildren) {
          const child = this.mounts.get(childId);
          if (child?.outputTexture && parent.target.contains(child.target))
            addCommitted(childId);
        }
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
          addCommitted(childId);
      }
    }
    return represented;
  }

  private sceneBudgetSignature(): string {
    return JSON.stringify({
      width: innerWidth,
      height: innerHeight,
      pixelRatio: this.previewStatus().effectivePixelRatio,
      viewport: this.previewViewport,
      deviceEpoch: this.deviceEpoch,
      media: [...document.querySelectorAll("img,video,source")].map(
        (element) => [
          element.getAttribute("src"),
          element.getAttribute("srcset"),
          element.getAttribute("poster"),
        ],
      ),
      nativeNodeCount: document.querySelectorAll("[data-agent-native-node-id]")
        .length,
      mounts: [...this.mounts.values()].map((mount) => [
        mount.instance.id,
        mount.definitionHash,
        mount.width,
        mount.height,
        JSON.stringify(mount.instance),
      ]),
    });
  }

  private sceneBudgetStillFaulted(): boolean {
    const fault = this.sceneBudgetFault;
    if (!fault) return false;
    if (
      fault.signature !== this.sceneBudgetSignature() ||
      this.estimatedResourceBytes() < fault.resourceBytes
    ) {
      this.sceneBudgetFault = null;
      return false;
    }
    return true;
  }

  private desiredScenePreviewPixelRatio(): number {
    const ratio = this.previewStatus().effectivePixelRatio;
    return this.exportInitialPixelRatio === null && this.previewViewport
      ? ratio * Math.min(1, this.previewDisplayScale)
      : ratio;
  }

  private scenePreviewPixelRatio(): number {
    return this.compositionPixelRatio === null &&
      this.exportInitialPixelRatio === null &&
      this.previewViewport
      ? (this.previewScenePixelRatio ?? this.desiredScenePreviewPixelRatio())
      : this.desiredScenePreviewPixelRatio();
  }

  private async presentScene(
    onSubmitted?: () => void,
    frameJobId?: string,
  ): Promise<void> {
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
    if (
      [...body.children].some(
        (child) => !isNativeScenePresentationElement(child),
      )
    )
      throw new NativeSourceError(
        "scene-direct-element-unsupported",
        "A direct non-HTML body child needs an atomic presentation source.",
      );
    // Static document overflow is clipped by the viewport-sized scene surface.
    // Only a scroll offset changes the source-to-presentation coordinate space.
    if (window.scrollX !== 0 || window.scrollY !== 0)
      throw new NativeSourceError(
        "scene-scroll-unsupported",
        "A scrolling document needs a scroll-aware native scene presentation.",
      );
    const bodyStyle = getComputedStyle(body);
    const rootStyle = getComputedStyle(document.documentElement);
    for (const style of [rootStyle, bodyStyle])
      if (
        style.backgroundImage === "none" &&
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
    const viewport =
      this.compositionPixelRatio === null &&
      this.exportInitialPixelRatio === null
        ? this.previewViewport
        : null;
    const requestedRatio =
      this.compositionPixelRatio ?? this.scenePreviewPixelRatio();
    const dpr =
      this.compositionPixelRatio !== null || !viewport
        ? requestedRatio
        : fitNativeRasterDensity({
            width: viewport.width,
            height: viewport.height,
            density: requestedRatio,
            maxDimension: MAX_DIMENSION,
            maxPixels: Math.min(
              MAX_PIXELS,
              Math.floor(MAX_RESOURCE_BYTES / 40),
            ),
            pixelPadding: 1,
          });
    const physical = viewport
      ? nativePreviewPhysicalViewport(viewport, dpr)
      : {
          x: 0,
          y: 0,
          width: Math.ceil(innerWidth * dpr),
          height: Math.ceil(innerHeight * dpr),
        };
    const { width, height } = physical;
    const sceneViewport = viewport
      ? {
          x: physical.x / dpr,
          y: physical.y / dpr,
          width: width / dpr,
          height: height / dpr,
        }
      : undefined;
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
    if (scene && scene.epoch !== this.deviceEpoch) {
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
      canvas.setAttribute("data-an-native-scene-presentation", "");
      canvas.setAttribute("data-an-native-presentation", "");
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText =
        "position:fixed;left:0;top:0;pointer-events:none;visibility:hidden;z-index:0;max-width:none;max-height:none;";
      canvas.style.left = `${sceneViewport?.x ?? 0}px`;
      canvas.style.top = `${sceneViewport?.y ?? 0}px`;
      canvas.style.width = `${sceneViewport?.width ?? innerWidth}px`;
      canvas.style.height = `${sceneViewport?.height ?? innerHeight}px`;
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
        presentationPair: null,
        provider,
        surface: {
          target: document.documentElement,
          width,
          height,
          pixelRatio: dpr,
          viewport: sceneViewport,
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
        committedInstancePayloads: new Map(),
        committedSourceEpoch: null,
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
    const viewportMatches = (): boolean =>
      window.scrollX === 0 &&
      window.scrollY === 0 &&
      (this.compositionPixelRatio !== null ||
        this.previewFrameHostGeneration === this.previewHostGeneration) &&
      (sceneViewport !== undefined ||
        (Math.ceil(innerWidth * dpr) === width &&
          Math.ceil(innerHeight * dpr) === height));
    scene.provider.setDensity(dpr);
    for (const child of scene.suppressedElements) {
      if (child.parentElement !== body) {
        child.removeAttribute("data-an-native-scene-suppressed");
        clearNativeAuthoredOpacityIfUnsuppressed(child);
        scene.suppressedElements.delete(child);
        continue;
      }
      const opacity = String(readNativeAuthoredPaint(child).opacity);
      if (child.getAttribute("data-an-native-authored-opacity") !== opacity)
        child.setAttribute("data-an-native-authored-opacity", opacity);
    }
    const authoredEpochBeforeRead = scene.provider.authoredSourceEpoch?.();
    let source: NativeSourceRecord[];
    const sceneSourceStarted = sceneWallPhases ? performance.now() : 0;
    try {
      source = await scene.provider.readScene(
        this.mountedBenchmarkRenderMetrics?.sourceReadDetail,
        "scene-presentation",
      );
    } catch (error) {
      this.retainScenePresentationOnFailure();
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
      this.retainScenePresentationOnFailure();
      throw new NativeSourceError(
        "scene-source-unavailable",
        "The authored scene revision is unavailable.",
      );
    }
    const expectedVisibleIds = [...this.mounts.values()]
      .filter(
        (mount) =>
          this.hasPresentationGeometry(mount.target, false) &&
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
    if (expectedVisibleIds.some((id) => !nativeRecordIds.has(id))) {
      this.retainScenePresentationOnFailure();
      throw new NativeSourceError(
        "composition-native-record-missing",
        "The authored scene omitted an expected visible native surface.",
      );
    }
    const device = this.device;
    const epoch = this.deviceEpoch;
    const previousGeometry = {
      width: scene.surface.width,
      height: scene.surface.height,
      pixelRatio: scene.surface.pixelRatio,
      viewport: scene.surface.viewport,
    };
    Object.assign(scene.surface, {
      width,
      height,
      pixelRatio: dpr,
      viewport: sceneViewport,
    });
    const frameResources = new NativeFrameResourceScratch(
      scene.surface.resourceTextures,
      [],
    );
    scene.surface.resourceTextures = frameResources.scratch;
    let resourcesCommitted = false;
    let scopeOpen = !this.frameTransaction;
    if (scopeOpen) device.pushErrorScope("validation");
    try {
      const presentation = this.preparePresentationPair(
        scene,
        device,
        scene.surface,
      );
      if (presentation.spare.canvas.width !== width)
        presentation.spare.canvas.width = width;
      if (presentation.spare.canvas.height !== height)
        presentation.spare.canvas.height = height;
      presentation.spare.canvas.style.left = `${sceneViewport?.x ?? 0}px`;
      presentation.spare.canvas.style.top = `${sceneViewport?.y ?? 0}px`;
      presentation.spare.canvas.style.width = `${sceneViewport?.width ?? innerWidth}px`;
      presentation.spare.canvas.style.height = `${sceneViewport?.height ?? innerHeight}px`;
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
            view: presentation.spare.context.getCurrentTexture().createView(),
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
      const frame = this.frameTransaction;
      const command = encoder.finish();
      if (frame) frame.commands.push(command);
      else device.queue.submit([command]);
      if (sceneWallPhases)
        sceneWallPhases.submitWallMs += performance.now() - sceneSubmitStarted;
      const sceneErrorScopeStarted = sceneWallPhases ? performance.now() : 0;
      const validation = scopeOpen
        ? device.popErrorScope()
        : Promise.resolve(null);
      scopeOpen = false;
      if (frame && frameJobId) frame.transaction.stage(frameJobId, new Map());
      onSubmitted?.();
      const [gpuError] = frame
        ? await Promise.all([validation, frame.submission])
        : [await validation];
      if (sceneWallPhases)
        sceneWallPhases.errorScopeWallMs +=
          performance.now() - sceneErrorScopeStarted;
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
      const paintRoot = (node: Element): Element | null => {
        let child = node;
        while (child.parentElement && child.parentElement !== body)
          child = child.parentElement;
        return child.parentElement === body ? child : null;
      };
      const authoredOpacities = new Map<Element, string>();
      const plannedPaintedChildren = new Set<Element>();
      const addPainted = (node: Element, expected: Element = node): void => {
        const root = paintRoot(node);
        if (!root) return;
        const projected = root === node ? expected : root;
        plannedPaintedChildren.add(projected);
        const authoredOpacity =
          root.getAttribute("data-an-native-authored-opacity") ??
          getComputedStyle(root).opacity;
        const opacity = Number(authoredOpacity);
        if (
          !authoredOpacity.trim() ||
          !Number.isFinite(opacity) ||
          opacity < 0 ||
          opacity > 1
        )
          throw new NativeSourceError(
            "scene-opacity-unreadable",
            "An authored scene opacity is unreadable.",
          );
        authoredOpacities.set(projected, String(opacity));
      };
      for (const record of source) {
        const nativeMount = record.nativeInstanceId
          ? this.mounts.get(record.nativeInstanceId)
          : undefined;
        if (!nativeMount) {
          addPainted(record.node);
          continue;
        }
        addPainted(nativeMount.target);
        const spare = frame?.candidates.has(nativeMount.instance.id)
          ? nativeMount.presentationPair
              ?.surfaces()
              .find((surface) => surface.canvas !== nativeMount.canvas)?.canvas
          : nativeMount.canvas;
        if (!spare)
          throw new NativeSourceError(
            "scene-presentation-unavailable",
            "The prepared native presentation surface is unavailable.",
          );
        addPainted(nativeMount.canvas, spare);
      }
      const staleResources = frameResources.retiredOnCommit();
      const staleIsolation = [...scene.surface.isolationTextures].filter(
        ([, entry]) => entry.lastFrame !== this.renderEpoch,
      );
      const staleSources = sceneViewport
        ? [...scene.surface.sourceTextures].filter(
            ([, entry]) => entry.lastFrame !== this.renderEpoch,
          )
        : [];
      const retire = (): void => {
        for (const [key, entry] of staleIsolation) {
          scene.surface.isolationTextures.delete(key);
          this.textureRetirement.push(entry.texture);
        }
        for (const [key, entry] of staleSources) {
          scene.surface.sourceTextures.delete(key);
          this.textureRetirement.push(entry.texture);
        }
        for (const texture of staleResources)
          this.textureRetirement.push(texture);
        frameResources.commit();
        resourcesCommitted = true;
      };
      const previousPublication = frame
        ? {
            canvas: scene.canvas,
            context: scene.context,
            committedInstances: scene.committedInstances,
            committedInstancePayloads: scene.committedInstancePayloads,
            committedSourceEpoch: scene.committedSourceEpoch,
            suppressedElements: new Set(scene.suppressedElements),
          }
        : null;
      const sourceBeforePublication = frame
        ? new Map(
            [
              ...new Set([
                ...body.children,
                ...plannedPaintedChildren,
                ...scene.suppressedElements,
                ...[...this.mounts.values()].flatMap((mount) =>
                  (
                    mount.presentationPair?.surfaces() ?? [
                      { canvas: mount.canvas },
                    ]
                  ).map((surface) => surface.canvas),
                ),
                ...(
                  scene.presentationPair?.surfaces() ?? [
                    { canvas: scene.canvas },
                  ]
                ).map((surface) => surface.canvas),
              ]),
            ]
              .filter(isNativeScenePresentationElement)
              .map((child) => [
                child,
                new Map(
                  child
                    .getAttributeNames()
                    .filter((name) => name.startsWith("data-an-native-"))
                    .map((name) => [name, child.getAttribute(name)!]),
                ),
              ]),
          )
        : null;
      const managedBeforePublication = document.documentElement.hasAttribute(
        "data-an-native-scene-managed",
      );
      const sceneStyleBeforePublication = scene.canvas.style.cssText;
      const stylesBeforePublication = new Map(
        [...(sourceBeforePublication?.keys() ?? [])].map((element) => [
          element,
          element.style.cssText,
        ]),
      );
      let publicationStarted = false;
      const assertPublication = (): void => {
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
            "The prepared native scene changed before publication.",
          );
        presentation.pair.assertPublishable(
          presentation.front,
          presentation.spare,
        );
      };
      const publish = (): void => {
        publicationStarted = true;
        presentation.pair.assertPublishable(
          presentation.front,
          presentation.spare,
        );
        const scenePublicationStarted = sceneWallPhases ? performance.now() : 0;
        const backdropCanvases = new Set<NativeScenePresentationElement>(
          [...this.mounts.values()]
            .filter((mount) => mount.instance.placement === "backdrop")
            .map((mount) => mount.canvas),
        );
        const paintedChildren = new Set<Element>();
        for (const record of source) {
          const nativeMount = record.nativeInstanceId
            ? this.mounts.get(record.nativeInstanceId)
            : undefined;
          for (const node of nativeMount
            ? [nativeMount.target, nativeMount.canvas]
            : [record.node]) {
            const child = paintRoot(node);
            if (!child) continue;
            if (!plannedPaintedChildren.has(child))
              throw new NativeSourceError(
                "scene-generation-changed",
                "A prepared native paint target changed before publication.",
              );
            paintedChildren.add(child);
          }
        }
        const front = presentation.pair.publish(
          presentation.front,
          presentation.spare,
        );
        scene.canvas = front.canvas;
        scene.context = front.context;
        for (const child of scene.suppressedElements) {
          if (paintedChildren.has(child)) continue;
          child.removeAttribute("data-an-native-scene-suppressed");
          clearNativeAuthoredOpacityIfUnsuppressed(child);
          scene.suppressedElements.delete(child);
        }
        for (const child of body.children) {
          if (
            !isNativeScenePresentationElement(child) ||
            child === scene.canvas
          )
            continue;
          if (!paintedChildren.has(child)) continue;
          if (backdropCanvases.has(child)) continue;
          if (
            child.matches(
              "[data-agent-native-edit-overlay],[data-agent-native-editor-chrome],[data-agent-native-editor-chrome-host]",
            )
          )
            continue;
          if (!child.hasAttribute("data-an-native-authored-opacity")) {
            child.setAttribute(
              "data-an-native-authored-opacity",
              authoredOpacities.get(child)!,
            );
          }
          if (!child.hasAttribute("data-an-native-scene-suppressed"))
            child.setAttribute("data-an-native-scene-suppressed", "");
          scene.suppressedElements.add(child);
        }
        scene.committedInstances = new Set(nativeRecordIds);
        scene.committedInstancePayloads = new Map(
          [...this.mounts.values()].flatMap((mounted) =>
            mounted.committedInstancePayload !== null &&
            mounted.committedDefinitionHash !== null &&
            mounted.committedLocalTime !== null
              ? [
                  [
                    mounted.instance.id,
                    {
                      payload: mounted.committedInstancePayload,
                      definitionHash: mounted.committedDefinitionHash,
                      localTime: mounted.committedLocalTime,
                    },
                  ] as const,
                ]
              : [],
          ),
        );
        scene.committedSourceEpoch = sourceEpoch;
        scene.canvas.style.visibility = "visible";
        if (this.retiringWorkerScene) {
          this.retiringWorkerScene.dispose({ preservePresentationState: true });
          this.retiringWorkerScene = null;
        }
        this.syncScenePresentationMode(
          [...this.mounts.values()].some(
            (mount) =>
              mount.instance.placement === "backdrop" &&
              this.hasPresentationGeometry(mount.target, false),
          ),
        );
        if (sceneWallPhases)
          sceneWallPhases.publicationWallMs +=
            performance.now() - scenePublicationStarted;
      };
      if (frame && frameJobId) {
        await frame.transaction.prepare(frameJobId, {
          assert: assertPublication,
          commit: publish,
          rollback: () => {
            if (!publicationStarted) return;
            if (presentation.pair.visible() !== presentation.front)
              presentation.pair.publish(
                presentation.pair.visible(),
                presentation.front,
              );
            Object.assign(scene, previousPublication);
            scene.canvas.style.cssText = sceneStyleBeforePublication;
            document.documentElement.toggleAttribute(
              "data-an-native-scene-managed",
              managedBeforePublication,
            );
            for (const [element, style] of stylesBeforePublication)
              element.style.cssText = style;
            for (const [child, attributes] of sourceBeforePublication!) {
              for (const name of child.getAttributeNames())
                if (name.startsWith("data-an-native-") && !attributes.has(name))
                  child.removeAttribute(name);
              for (const [name, value] of attributes)
                child.setAttribute(name, value);
            }
          },
          retire,
        });
      } else {
        publish();
        retire();
      }
    } catch (error) {
      if (error instanceof NativeStatelessFrameRetirementError) throw error;
      if (!resourcesCommitted) {
        Object.assign(scene.surface, previousGeometry);
        scene.surface.resourceTextures = frameResources.committed;
        for (const texture of frameResources.rollback())
          this.textureRetirement.push(texture);
      }
      if (scopeOpen) {
        try {
          await device.popErrorScope();
        } catch {}
      }
      this.retainScenePresentationOnFailure();
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
        [
          ...mount.sourceTextures.values(),
          ...[...mount.authoredInputs.values()].flatMap((input) => [
            ...input.surface.sourceTextures.values(),
          ]),
        ].map((entry) => entry.texture),
      ),
      assetBytes: bytes(
        [...mount.assetTextures.values()].map((entry) => entry.texture),
      ),
      graphBytes: bytes([
        ...mount.resourceTextures.values(),
        ...(this.draft?.instanceId === mount.instance.id
          ? [
              ...this.draft.resources.values(),
              ...this.draft.publishedResources.values(),
            ]
          : []),
        ...(this.draft?.instanceId === mount.instance.id
          ? this.draft.statefulResources.values()
          : []),
        ...[...mount.authoredInputs.values()].flatMap((input) => [
          ...input.surface.resourceTextures.values(),
        ]),
        ...(mount.feedback?.textures ?? []),
        ...(this.draft?.instanceId === mount.instance.id
          ? (this.draft.feedback?.textures ?? [])
          : []),
        ...(mount.stateful?.textures ?? []),
        ...(this.draft?.instanceId === mount.instance.id
          ? (this.draft.stateful?.textures ?? [])
          : []),
      ]),
      isolationBytes: bytes(
        [
          ...mount.isolationTextures.values(),
          ...[...mount.authoredInputs.values()].flatMap((input) => [
            ...input.surface.isolationTextures.values(),
          ]),
        ].map((entry) => entry.texture),
      ),
      finalBytes: bytes([
        mount.outputTexture,
        ...(this.draft?.instanceId === mount.instance.id
          ? [this.draft.publishedTexture, this.draft.lastGoodTexture]
          : []),
      ]),
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
    const sharedBytes = bytes([
      this.transparent,
      this.white,
      this.receiverInteriorBox,
    ]);
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

  private refreshPreviewViewport(): boolean {
    if (
      this.exportInitialPixelRatio !== null ||
      this.compositionPixelRatio !== null
    )
      return true;
    try {
      const frame = window.frameElement;
      if (!frame) {
        if (window.parent !== window)
          throw new NativeSourceError(
            "preview-viewport-unreadable",
            "The editor preview frame is inaccessible.",
          );
        this.previewViewport = null;
        this.previewDisplayScale = 1;
        return true;
      }
      const parent = window.parent;
      const display = frame.getBoundingClientRect();
      const clips: NativePreviewBox[] = [
        { x: 0, y: 0, width: parent.innerWidth, height: parent.innerHeight },
      ];
      for (let node: Element | null = frame; node; node = node.parentElement) {
        const insetClip = readNativePreviewInsetClip(node);
        if (insetClip) clips.push(insetClip);
        const style = parent.getComputedStyle(node);
        const transform = new DOMMatrixReadOnly(
          style.transform === "none" ? undefined : style.transform,
        );
        if (
          Math.abs(transform.b) > 0.000001 ||
          Math.abs(transform.c) > 0.000001 ||
          0 >= transform.a ||
          0 >= transform.d ||
          !transform.is2D ||
          (style.rotate && style.rotate !== "none" && style.rotate !== "0deg")
        )
          throw new NativeSourceError(
            "preview-transform-unsupported",
            "The editor preview requires an axis-aligned frame transform.",
          );
        if (
          node === frame ||
          (style.overflowX === "visible" && style.overflowY === "visible")
        )
          continue;
        const rect = node.getBoundingClientRect();
        clips.push({
          x: style.overflowX === "visible" ? 0 : rect.left,
          y: style.overflowY === "visible" ? 0 : rect.top,
          width: style.overflowX === "visible" ? parent.innerWidth : rect.width,
          height:
            style.overflowY === "visible" ? parent.innerHeight : rect.height,
        });
      }
      const planned = planNativePreviewViewport({
        width: innerWidth,
        height: innerHeight,
        display: {
          x: display.left,
          y: display.top,
          width: display.width,
          height: display.height,
        },
        clips,
      });
      const scale = Math.max(
        display.width / innerWidth,
        display.height / innerHeight,
      );
      if (
        Math.abs(scale - this.previewDisplayScale) >
        0.0001 * Math.max(1, scale)
      ) {
        this.previewPolicy.resetDensityBudget();
        this.sceneBudgetFault = null;
        this.previewDisplayScale = scale;
      }
      this.previewViewport = planned?.viewport ?? null;
      return planned !== null;
    } catch (error) {
      if (error instanceof NativeSourceError) throw error;
      throw new NativeSourceError(
        "preview-viewport-unreadable",
        `The editor preview viewport cannot be read: ${String(error)}.`,
      );
    }
  }

  private observePreviewHost(): void {
    if (this.exportInitialPixelRatio !== null) return;
    document.addEventListener("visibilitychange", this.onPreviewHostChange);
    const frame = window.frameElement;
    if (!frame) return;
    this.previewHostObserver?.disconnect();
    this.previewHostResizeObserver?.disconnect();
    this.previewHostParent?.removeEventListener(
      "scroll",
      this.onPreviewHostChange,
      true,
    );
    this.previewHostParent?.removeEventListener(
      "resize",
      this.onPreviewHostChange,
    );
    const wake = this.onPreviewHostChange;
    this.previewHostObserver = new MutationObserver(wake);
    this.previewHostResizeObserver = new ResizeObserver(wake);
    for (let node: Element | null = frame; node; node = node.parentElement) {
      this.previewHostObserver.observe(node, {
        attributes: true,
        attributeFilter: ["style", "class", ...NATIVE_PREVIEW_INSET_ATTRIBUTES],
      });
      this.previewHostResizeObserver.observe(node);
    }
    this.previewHostParent = window.parent;
    this.previewHostParent.addEventListener("scroll", wake, true);
    this.previewHostParent.addEventListener("resize", wake);
  }

  private onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) void this.dispose();
  };

  private onPreviewHostChange = (): void => {
    if (this.disposed) return;
    if (!this.workerScene) {
      this.previewHostGeneration += 1;
      this.requestSourceFrame();
      return;
    }
    if (document.visibilityState === "hidden") {
      this.workerScene.setVisible(false);
      return;
    }
    if (this.previewHostFramePending) return;
    this.previewHostFramePending = true;
    this.previewHostFrame = window.parent.requestAnimationFrame(() => {
      this.previewHostFramePending = false;
      this.previewHostFrame = 0;
      const scene = this.workerScene;
      if (!scene || this.disposed) return;
      try {
        const visible =
          document.visibilityState !== "hidden" &&
          this.refreshPreviewViewport();
        scene.setVisible(visible);
        if (!visible) return;
        if (
          this.previewViewport &&
          scene.retainsPreviewViewport(
            this.previewViewport,
            this.desiredScenePreviewPixelRatio(),
          )
        )
          return;
      } catch (error) {
        const failure =
          error instanceof NativeSourceError
            ? error
            : new NativeSourceError(
                "preview-viewport-unreadable",
                `The editor preview viewport cannot be read: ${String(error)}.`,
              );
        this.issue(failure.code, failure.message);
      }
      this.previewHostGeneration += 1;
      this.requestSourceFrame();
    });
  };

  previewStatus = (): NativePreviewStatus => {
    const status = this.previewPolicy.status(
      devicePixelRatio || 1,
      this.renderWallSamples[this.renderWallSamples.length - 1],
      this.rafIntervalSamples[this.rafIntervalSamples.length - 1],
    );
    return this.exportInitialPixelRatio === null
      ? {
          ...status,
          effectivePixelRatio:
            status.effectivePixelRatio * Math.max(1, this.previewDisplayScale),
        }
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
    if (this.frameTransaction?.publishing) {
      this.frameTransaction.statuses.push(() =>
        this.postStatus(
          instanceId,
          nodeId,
          status,
          diagnostic,
          requestId,
          force,
        ),
      );
      return;
    }
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
        status !== "unavailable" && (this.device || this.workerScene)
          ? "webgpu"
          : "unavailable",
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
    this.previewTargetDensities.clear();
    this.previewBudgetDensities.clear();
    this.previewBudgetSignature = "";
    this.clearDraftState();
    this.cameraSource.stop();
    this.clearCameraClip();
    this.releaseCameraTexture();
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
      mount.pointerHistory?.invalidate();
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
    this.destroyTexture(this.receiverInteriorBox);
    this.transparent = null;
    this.white = null;
    this.receiverInteriorBox = null;
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
    this.graphPipelines.reset();
    this.simulationRenderPipelines.reset();
    this.simulationLayout = null;
    this.simulationPipelineLayout = null;
    this.compositePipeline = null;
    this.fillCompositePipeline = null;
    this.fillTextPipeline = null;
    this.presentPipeline = null;
    this.finishPipeline = null;
    this.effectPipelineLayouts.clear();
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
    if (this.destroyedDevices.has(device)) return;
    if (this.statelessDeviceLeases.has(device)) {
      this.statelessDeviceDestruction.add(device);
      return;
    }
    device.destroy();
    this.destroyedDevices.add(device);
  }

  private retainStatelessTextures(
    device: GPUDevice,
    textures: Set<GPUTexture>,
  ): () => void {
    if (this.disposed)
      throw new NativeStatelessComputeError("stateless-compute-frame-invalid");
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
    const owner =
      mount.budgetOwner ??
      ("authoredInputs" in mount ? (mount as Mount) : null);
    const surfaces: CompositionSurface[] = owner
      ? [
          owner,
          ...[...owner.authoredInputs.values()].map((input) => input.surface),
        ]
      : [mount];
    const budgetRecord = owner ?? mount;
    const budget = summarizeNativeCompositionBudget(
      {
        resource: [
          ...(owner && this.receiverGeometryCache.has(owner)
            ? [
                this.receiverGeometryCache.get(owner)!.geometry,
                this.receiverGeometryCache.get(owner)!.interior,
                this.receiverGeometryCache.get(owner)!.coverage,
              ].filter((texture): texture is GPUTexture => !!texture)
            : []),
          ...surfaces.flatMap((surface) => [
            ...surface.resourceTextures.values(),
          ]),
          ...(owner && this.draft?.instanceId === owner.instance.id
            ? [
                ...this.draft.statefulResources.values(),
                ...this.draft.resources.values(),
                ...this.draft.publishedResources.values(),
              ]
            : []),
          ...(owner?.outputTexture && this.textureBytes.has(owner.outputTexture)
            ? [owner.outputTexture]
            : []),
          ...(owner && this.draft?.instanceId === owner.instance.id
            ? [this.draft.publishedTexture, this.draft.lastGoodTexture].filter(
                (texture): texture is GPUTexture =>
                  !!texture && this.textureBytes.has(texture),
              )
            : []),
        ],
        feedback: [
          ...(budgetRecord.feedback?.textures ?? []),
          ...(owner && this.draft?.instanceId === owner.instance.id
            ? (this.draft.feedback?.textures ?? [])
            : []),
          ...(("stateful" in budgetRecord
            ? budgetRecord.stateful?.textures
            : undefined) ?? []),
          ...(owner && this.draft?.instanceId === owner.instance.id
            ? (this.draft.stateful?.textures ?? [])
            : []),
        ],
        source: surfaces.flatMap((surface) =>
          [...surface.sourceTextures.values()].map((entry) => entry.texture),
        ),
        asset: [...(budgetRecord.assetTextures?.values() ?? [])].map(
          (entry) => entry.texture,
        ),
        isolation: surfaces.flatMap((surface) =>
          [...surface.isolationTextures.values()].map((entry) => entry.texture),
        ),
        compute: [
          ...(budgetRecord.statelessBuffers ?? []),
          ...(budgetRecord.statelessInputs?.keys() ?? []),
          ...(("simulation" in budgetRecord
            ? budgetRecord.simulation?.buffers
            : undefined) ?? []),
          ...(("simulationFrame" in budgetRecord
            ? budgetRecord.simulationFrame?.state.buffers
            : undefined) ?? []),
          ...(owner && this.draft?.instanceId === owner.instance.id
            ? (this.draft.simulation?.buffers ?? [])
            : []),
          ...(owner && this.draft?.instanceId === owner.instance.id
            ? (this.draft.simulationFrame?.state.buffers ?? [])
            : []),
          ...(("stateful" in budgetRecord
            ? budgetRecord.stateful?.buffers
            : undefined) ?? []),
          ...(owner && this.draft?.instanceId === owner.instance.id
            ? (this.draft.stateful?.buffers ?? [])
            : []),
        ],
      },
      new Map<GPUTexture | GPUBuffer, number>([
        ...this.textureBytes,
        ...this.statelessBufferBytes,
        ...this.simulationBuffers,
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

  private hasPresentationGeometry(
    target: NativeScenePresentationElement,
    requireBounds = true,
  ): boolean {
    const rect = target.getBoundingClientRect();
    if (requireBounds && (rect.width === 0 || rect.height === 0)) return false;
    const visibility = getComputedStyle(target).visibility;
    if (visibility === "hidden" || visibility === "collapse") return false;
    for (
      let element: Element | null = target;
      element;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      if (style.display === "none") return false;
    }
    return true;
  }

  private offscreen(mount: Mount): boolean {
    const rect = mount.target.getBoundingClientRect();
    const dpr = mount.pixelRatio || Math.min(devicePixelRatio || 1, 2);
    const halo = mount.outputExtent;
    const margins = {
      left: Math.max(
        (halo?.left ?? 0) / dpr,
        mount.definition?.extent?.output?.left ?? 0,
      ),
      top: Math.max(
        (halo?.top ?? 0) / dpr,
        mount.definition?.extent?.output?.top ?? 0,
      ),
      right: Math.max(
        (halo?.right ?? 0) / dpr,
        mount.definition?.extent?.output?.right ?? 0,
      ),
      bottom: Math.max(
        (halo?.bottom ?? 0) / dpr,
        mount.definition?.extent?.output?.bottom ?? 0,
      ),
    };
    let localScale = 1;
    if (Object.values(margins).some((value) => value > 0)) {
      const layout = nativePresentationTargetLayout(mount.target);
      if (layout.width <= 0 || layout.height <= 0) return false;
      localScale = Math.max(
        rect.width / layout.width,
        rect.height / layout.height,
      );
      if (!Number.isFinite(localScale) || localScale <= 0) return false;
    }
    const viewport = this.previewViewport ?? {
      x: 0,
      y: 0,
      width: innerWidth,
      height: innerHeight,
    };
    const outside =
      rect.right + margins.right * localScale <= viewport.x ||
      rect.bottom + margins.bottom * localScale <= viewport.y ||
      rect.left - margins.left * localScale >= viewport.x + viewport.width ||
      rect.top - margins.top * localScale >= viewport.y + viewport.height;
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

  private releaseAuthoredInput(mount: Mount, resource: string): void {
    const input = mount.authoredInputs.get(resource);
    if (!input) return;
    mount.authoredInputs.delete(resource);
    input.borrowed = undefined;
    input.borrowedImages = undefined;
    input.provider.dispose();
    const surface = input.surface;
    const textures = new Set<GPUTexture>([
      ...surface.resourceTextures.values(),
      ...[...surface.sourceTextures.values()].map((entry) => entry.texture),
      ...[...surface.isolationTextures.values()].map((entry) => entry.texture),
    ]);
    for (const texture of textures) this.destroyTexture(texture);
    for (const binding of surface.drawBindings.values())
      this.destroyUniform(binding.buffer);
    surface.resourceTextures.clear();
    surface.sourceTextures.clear();
    surface.isolationTextures.clear();
    surface.drawBindings.clear();
  }

  private releaseAuthoredInputs(mount: Mount): void {
    for (const resource of [...mount.authoredInputs.keys()])
      this.releaseAuthoredInput(mount, resource);
  }

  private releaseGraphPipelinePins(mount: Mount): void {
    for (const release of mount.graphPipelinePins.values()) release();
    mount.graphPipelinePins.clear();
  }

  private releaseMountTextures(mount: Mount): void {
    this.releaseReceiverGeometry(mount);
    mount.staticGeneratorPassCache.invalidate();
    if (this.draft?.instanceId === mount.instance.id) this.clearDraftState();
    this.releaseGraphPipelinePins(mount);
    this.releaseAuthoredInputs(mount);
    this.releaseSimulation(mount);
    this.releaseFeedback(mount);
    this.releaseStateful(mount);
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
        mount.width *
        mount.height *
        8 *
        (this.generatedFillFamily?.entries
          .find((entry) => entry.canonical === mount)
          ?.presentation.surfaces().length ?? (mount.presentationPair ? 2 : 1));
    if (this.scenePresentation)
      for (const surface of this.scenePresentation.presentationPair?.surfaces() ?? [
        { canvas: this.scenePresentation.canvas },
      ])
        canvasBytes += surface.canvas.width * surface.canvas.height * 8;
    return (
      this.allocatedTextureBytes +
      this.allocatedUniformBytes +
      this.allocatedSimulationBytes +
      this.allocatedStatelessBytes +
      this.graphPipelines.size * 524_288 +
      (this.pipelines.size +
        this.simulationComputePipelines.size +
        this.simulationRenderPipelines.size +
        this.statelessPipelines.size * 2) *
        524_288 +
      canvasBytes
    );
  }

  private destroyUniform(buffer: GPUBuffer): void {
    if (this.packedArenaBuffers.has(buffer)) return;
    if (this.graphUniformLeases.has(buffer)) {
      this.graphUniformDestruction.add(buffer);
      return;
    }
    const bytes = this.uniformBytes.get(buffer);
    if (bytes !== undefined) {
      this.allocatedUniformBytes -= bytes;
      this.uniformBytes.delete(buffer);
    }
    buffer.destroy();
  }

  private retainGraphUniforms(buffers: Set<GPUBuffer>): () => void {
    for (const buffer of buffers) {
      if (
        !this.uniformBytes.has(buffer) ||
        this.graphUniformDestruction.has(buffer)
      )
        throw new NativeSourceError(
          "linear-resource-frame-invalid",
          "A graph uniform buffer was retired before submission.",
        );
    }
    for (const buffer of buffers)
      this.graphUniformLeases.set(
        buffer,
        (this.graphUniformLeases.get(buffer) ?? 0) + 1,
      );
    return () => {
      for (const buffer of buffers) {
        const count = this.graphUniformLeases.get(buffer);
        if (!count)
          throw new NativeSourceError(
            "linear-resource-frame-invalid",
            "A graph uniform lease was already released.",
          );
        if (count > 1) this.graphUniformLeases.set(buffer, count - 1);
        else {
          this.graphUniformLeases.delete(buffer);
          if (this.graphUniformDestruction.delete(buffer))
            this.destroyUniform(buffer);
        }
      }
    };
  }

  private destroySimulationBuffer(buffer: GPUBuffer): void {
    const bytes = this.simulationBuffers.get(buffer);
    if (bytes !== undefined) {
      this.simulationBuffers.delete(buffer);
      this.allocatedSimulationBytes -= bytes;
    }
    buffer.destroy();
  }

  private retireSimulationState(state: NativeSimulationState): void {
    for (const buffer of state.buffers) this.destroyStatefulBuffer(buffer);
  }

  private promoteSimulationFrame(
    mount: Mount,
    frame: NativeSimulationFrame,
    draft: DraftPreview | null = null,
  ): void {
    frame.transaction.promote();
    if (draft) {
      draft.simulation = frame.state;
      draft.simulationFrame = null;
      if (mount.pointerState === frame.pointerSource)
        frame.state.pointer = frame.pointer;
      draft.caughtUp = frame.caughtUp;
    } else {
      mount.simulation = frame.state;
      mount.simulationFrame = null;
      mount.simulationCaughtUp = frame.caughtUp;
      mount.target.setAttribute(
        "data-an-native-simulation-step",
        String(frame.state.completedStep),
      );
      mount.target.setAttribute(
        "data-an-native-simulation-target-step",
        String(frame.targetStep),
      );
      mount.target.setAttribute(
        "data-an-native-particle-count",
        String(frame.count),
      );
    }
    if (frame.previousState && frame.previousState !== frame.state)
      this.retireSimulationState(frame.previousState);
  }

  private releaseSimulation(mount: Mount): void {
    if (!mount.simulation && !mount.simulationFrame) return;
    mount.pointerHistory?.invalidate();
    const frame = mount.simulationFrame;
    mount.simulationFrame = null;
    if (frame)
      void frame.transaction
        .abandon()
        .catch((error) =>
          this.issue(
            "simulation-device-lost",
            String(error),
            mount.instance.id,
          ),
        );
    const simulation = mount.simulation;
    if (frame && frame.state !== simulation)
      this.retireSimulationState(frame.state);
    if (simulation) this.retireSimulationState(simulation);
    mount.simulation = null;
    for (const name of [
      simulation?.trailOutput ?? frame!.state.trailOutput,
      "__native_trail_back",
    ])
      if (name) {
        this.destroyTexture(mount.resourceTextures.get(name));
        mount.resourceTextures.delete(name);
      }
    mount.simulationCaughtUp = true;
    mount.target.removeAttribute("data-an-native-simulation-step");
    mount.target.removeAttribute("data-an-native-simulation-target-step");
    mount.target.removeAttribute("data-an-native-particle-count");
  }

  private releaseDraftSimulation(draft: DraftPreview): void {
    const frame = draft.simulationFrame;
    draft.simulationFrame = null;
    if (frame)
      void frame.transaction
        .abandon()
        .catch((error) =>
          this.issue("simulation-device-lost", String(error), draft.instanceId),
        );
    if (frame && frame.state !== draft.simulation)
      this.retireSimulationState(frame.state);
    if (draft.simulation) this.retireSimulationState(draft.simulation);
    draft.simulation = null;
  }

  private destroyStatefulBuffer(buffer: GPUBuffer): void {
    if (this.statefulBufferLeases.has(buffer)) {
      this.statefulBufferDestruction.add(buffer);
      return;
    }
    this.destroySimulationBuffer(buffer);
  }

  private retainStatefulResources(
    device: GPUDevice,
    textures: ReadonlySet<GPUTexture>,
    buffers: ReadonlySet<GPUBuffer>,
  ): () => void {
    const leasedBuffers = new Set(buffers);
    const releaseTextures = this.retainStatelessTextures(
      device,
      new Set(textures),
    );
    for (const buffer of leasedBuffers)
      this.statefulBufferLeases.set(
        buffer,
        (this.statefulBufferLeases.get(buffer) ?? 0) + 1,
      );
    let released = false;
    return () => {
      if (released)
        throw new NativeSourceError(
          "stateful-frame-invalid",
          "A stateful GPU lease was released twice.",
        );
      released = true;
      try {
        for (const buffer of leasedBuffers) {
          const count = this.statefulBufferLeases.get(buffer);
          if (!count)
            throw new NativeSourceError(
              "stateful-frame-invalid",
              "A stateful buffer lease was already released.",
            );
          if (count > 1) this.statefulBufferLeases.set(buffer, count - 1);
          else {
            this.statefulBufferLeases.delete(buffer);
            if (this.statefulBufferDestruction.delete(buffer))
              this.destroySimulationBuffer(buffer);
          }
        }
      } finally {
        releaseTextures();
      }
    };
  }

  private releaseStateful(mount: Mount): void {
    if (mount.stateful || mount.statefulCandidate)
      mount.pointerHistory?.invalidate();
    mount.statefulFrame?.abandon();
    mount.statefulFrame = null;
    mount.statefulCandidate?.executor.dispose();
    mount.statefulCandidate = null;
    mount.stateful?.executor.dispose();
    mount.stateful = null;
    mount.target.removeAttribute("data-an-native-stateful-dropped-steps");
    mount.target.removeAttribute("data-an-native-stateful-dropped-seconds");
  }

  private promoteStatefulFrame(
    mount: Mount,
    frame: NativeStatefulEncodedFrame,
    draft: DraftPreview | null = null,
  ): void {
    const candidate = draft ? draft.statefulCandidate : mount.statefulCandidate;
    const published = draft ? draft.stateful : mount.stateful;
    const stateful = candidate ?? published;
    if (!stateful)
      throw new NativeSourceError(
        "stateful-frame-invalid",
        "The encoded stateful session is unavailable.",
      );
    frame.promote();
    stateful.sourceRevision = stateful.pendingSourceRevision ?? "";
    stateful.pendingSourceRevision = null;
    stateful.droppedSteps += stateful.pendingDroppedSteps;
    stateful.pendingDroppedSteps = 0;
    if (candidate) {
      if (draft) {
        draft.stateful = candidate;
        draft.statefulCandidate = null;
        draft.statefulFrame = null;
      } else {
        mount.stateful = candidate;
        mount.statefulCandidate = null;
        mount.statefulFrame = null;
      }
      if (published && published !== candidate) {
        published.executor.dispose();
        mount.pointerHistory?.invalidate();
      }
    } else if (draft) draft.statefulFrame = null;
    else mount.statefulFrame = null;
    mount.target.setAttribute(
      "data-an-native-stateful-dropped-steps",
      String(stateful.droppedSteps),
    );
    const graph = (draft?.definition ?? mount.definition).resourceGraph;
    const fixedDt = isStatefulResourceGraph(graph) ? graph.timing.fixedDt : 0;
    mount.target.setAttribute(
      "data-an-native-stateful-dropped-seconds",
      (stateful.droppedSteps * fixedDt).toFixed(3),
    );
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

  private promoteFeedbackFrame(
    mount: Mount,
    frame: NativeFeedbackEncodedFrame,
    draft?: DraftPreview | null,
  ): void {
    frame.promote();
    const current = draft ? draft.feedback : mount.feedback;
    const candidate = draft ? draft.feedbackCandidate : mount.feedbackCandidate;
    if (candidate) {
      if (draft) {
        draft.feedback = candidate;
        draft.feedbackCandidate = null;
      } else {
        mount.feedback = candidate;
        mount.feedbackCandidate = null;
      }
      if (current && current !== candidate)
        void this.disposeFeedback(current).catch((error) =>
          this.issue(
            "feedback-cleanup-failed",
            String(error),
            mount.instance.id,
          ),
        );
    }
    const feedback = (draft ? draft.feedback : mount.feedback)!;
    feedback.sourceRevision = feedback.pendingSourceRevision ?? "";
    feedback.pendingSourceRevision = null;
    feedback.pointerPosition = feedback.pendingPointerPosition;
    feedback.pendingPointerPosition = null;
    if (draft) {
      draft.feedbackFrame = null;
      draft.caughtUp = true;
    } else {
      mount.feedbackFrame = null;
      mount.simulationCaughtUp = true;
      this.reflectCommittedFeedbackTelemetry(mount);
    }
  }

  private releaseFeedback(mount: Mount): void {
    if (mount.feedback || mount.feedbackCandidate)
      mount.pointerHistory?.invalidate();
    const frameRetirement = mount.feedbackFrame?.abandon();
    mount.feedbackFrame = null;
    this.clearFeedbackTelemetry(mount);
    const feedback = mount.feedback;
    const candidate = mount.feedbackCandidate;
    const owner = candidate ?? feedback;
    if (frameRetirement && owner) {
      owner.retirements.add(frameRetirement);
      void frameRetirement.then(
        () => owner.retirements.delete(frameRetirement),
        (error) => {
          owner.retirements.delete(frameRetirement);
          this.issue("feedback-device-lost", String(error), mount.instance.id);
        },
      );
    }
    mount.feedback = null;
    mount.feedbackCandidate = null;
    if (candidate)
      void this.disposeFeedback(candidate).catch((error) =>
        this.issue("feedback-cleanup-failed", String(error), mount.instance.id),
      );
    if (feedback)
      void this.disposeFeedback(feedback).catch((error) =>
        this.issue("feedback-cleanup-failed", String(error), mount.instance.id),
      );
  }

  private releaseDraftFeedback(draft: DraftPreview): void {
    const frameRetirement = draft.feedbackFrame?.abandon();
    draft.feedbackFrame = null;
    const feedback = draft.feedback;
    const candidate = draft.feedbackCandidate;
    const owner = candidate ?? feedback;
    if (frameRetirement && owner) {
      owner.retirements.add(frameRetirement);
      void frameRetirement.then(
        () => owner.retirements.delete(frameRetirement),
        (error) => {
          owner.retirements.delete(frameRetirement);
          this.issue("feedback-device-lost", String(error), draft.instanceId);
        },
      );
    }
    draft.feedback = null;
    draft.feedbackCandidate = null;
    if (candidate)
      void this.disposeFeedback(candidate).catch((error) =>
        this.issue("feedback-cleanup-failed", String(error), draft.instanceId),
      );
    if (feedback)
      void this.disposeFeedback(feedback).catch((error) =>
        this.issue("feedback-cleanup-failed", String(error), draft.instanceId),
      );
  }

  private releaseSimulationExportSaved(
    session: NativeSimulationExportSession,
  ): void {
    for (const saved of session.saved.splice(0)) {
      if (saved.simulation) this.retireSimulationState(saved.simulation);
      if (saved.feedback)
        void this.disposeFeedback(saved.feedback).catch((error) =>
          this.issue(
            "feedback-cleanup-failed",
            String(error),
            saved.mount.instance.id,
          ),
        );
      saved.stateful?.executor.dispose();
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
    if (this.generatedFillStarting) while (this.running) await this.running;
    if (this.generatedFillFamily) {
      this.generatedFillFamily.cancelled = true;
      this.generatedFillFamily.scheduler.cancel(
        new NativeSourceError(
          "source-epoch-stale",
          "The generated fill document is being rescanned.",
        ),
      );
      while (this.running) await this.running;
      this.releaseGeneratedFillFamily();
    }
    this.parameterPreviews.reset();
    if (this.simulationExportStarting || this.simulationExportSession) {
      this.rescanPending = true;
      if (this.simulationExportSession) {
        this.simulationExportSession.failed = true;
        this.simulationExportSession.sourceStale = true;
      } else this.simulationExportStartInvalidated = true;
      return;
    }
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
    const builtinHashes = BUILTIN_NATIVE_HASHES;
    const documents = this.parse();
    if (!documents) {
      const diagnostic = this.parseFailure ?? {
        code: "manifest-invalid",
        message: "manifest-invalid",
      };
      this.scanFailures.push(diagnostic);
      for (const mount of this.mounts.values()) {
        this.releaseGraphPipelinePins(mount);
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
    const effectivePreviewPolicy = resolveNativePreviewPolicy(
      this.editorPreviewPolicy,
      documents[0]?.preview,
    );
    const documentColorRequested = effectivePreviewPolicy.colorMode ?? "srgb";
    const documentDynamicRangeRequested =
      effectivePreviewPolicy.dynamicRange ?? "sdr";
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
    if (this.previewPolicy.setPolicy(effectivePreviewPolicy)) {
      this.sceneBudgetFault = null;
      this.previewDirty = true;
    }
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
        target: NativeScenePresentationElement;
        previousLayerId?: string;
        previousFillId?: string;
      }
    >();
    const lastLayerByNode = new Map<string, string>();
    const lastFillByNode = new Map<string, string>();
    const rejected = new Map<NativeScenePresentationElement, Diagnostic>();
    const rejectedIds = new Set<string>();
    const definitionHashes = new Map<EffectDefinition, string>();
    const targets = new Map<string, NativeScenePresentationElement>();
    const duplicateTargets = new Set<string>();
    for (const element of document.querySelectorAll<NativeScenePresentationElement>(
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
      target: NativeScenePresentationElement | undefined,
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
        this.releaseGraphPipelinePins(existing);
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
        const authorizationError = nativeDefinitionAuthorizationError({
          definitionId: definition.id,
          executionHash: hash,
          builtinIds: BUILTIN_NATIVE_IDS,
          builtinHashes,
          approvedHashes: this.approvedHashes,
          approvalStatus: this.approvalStatus,
        });
        if (authorizationError) {
          const messages = {
            "catalog-conflict":
              "Built-in native effect identities require exact catalog source.",
            unapproved:
              "Approve this exact custom native definition before enabling it.",
            "approvals-pending":
              "Custom native effect approvals have not loaded yet.",
            "approvals-unreadable":
              "Custom native effect approval state is unreadable.",
          };
          reject(
            instance,
            target,
            authorizationError,
            messages[authorizationError],
          );
          continue;
        }
        if (
          !definition.simulation &&
          !definition.feedback &&
          !definition.statelessCompute &&
          !definition.resourceGraph &&
          definition.passes.some(
            (pass) =>
              pass.kind !== "render" ||
              pass.reads.length > 16 ||
              (pass.previousFrameReads?.length ?? 0) > 0,
          )
        ) {
          reject(
            instance,
            target,
            "pass-unsupported",
            "This native runtime supports up to sixteen current-frame render textures; compute and temporal inputs need a different path.",
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
    const workerEntries: NativeWorkerSceneEntry[] = [...wanted.values()]
      .filter((entry) => !rejectedIds.has(entry.instance.id))
      .map((entry) => ({
        instance: entry.instance,
        definition: entry.definition,
        definitionHash: entry.hash,
        target: entry.target,
      }));
    const workerCapable =
      workerEntries.length > 0 &&
      rejectedIds.size === 0 &&
      this.colorRequested === "srgb" &&
      this.dynamicRangeRequested === "sdr" &&
      !this.legacyDraftSession &&
      !this.workerCapabilityBlocked &&
      !window.frameElement?.hasAttribute(
        "data-native-catalog-preview-renderer",
      ) &&
      typeof Worker !== "undefined" &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen ===
        "function" &&
      workerEntries.every(
        ({ definition }) =>
          !definition.simulation &&
          !definition.feedback &&
          !definition.statelessCompute &&
          !definition.resourceGraph &&
          !definition.interaction &&
          definition.passes.every(
            (pass) =>
              pass.kind === "render" && !pass.previousFrameReads?.length,
          ),
      );
    if (workerCapable) {
      this.workerEntries = workerEntries;
      this.workerPreviewBase = null;
      this.instancePreview = null;
      this.ensurePresentationStyles();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      for (const mount of this.mounts.values()) {
        mount.canvas.removeAttribute("data-an-native-canvas");
        mount.canvas.removeAttribute("data-an-native-backdrop-presentation");
      }
      try {
        this.workerScene ??= new NativeWorkerSceneHost(
          nativeWorkerSource,
          `${this.epoch}:${createNativeRuntimeEpoch()}`,
          () => ({
            playing: this.playing,
            timeSeconds: this.currentTime(),
            speed: 1,
          }),
          (_publication, message) => {
            this.workerRecoveryAttempts = 0;
            if (this.retiringWorkerScene) {
              this.retiringWorkerScene.dispose({
                preservePresentationState: true,
              });
              this.retiringWorkerScene = null;
            }
            if (this.mounts.size || this.scenePresentation) {
              for (const [id, mount] of this.mounts) {
                this.unmount(mount);
                this.mounts.delete(id);
              }
              if (this.scenePresentation) this.releaseScenePresentation();
              this.workerScene?.setEntries(this.workerEntries);
            }
            for (const committed of message.committedInstances) {
              const entry = this.workerEntries.find(
                (candidate) => candidate.instance.id === committed.instanceId,
              );
              if (entry)
                this.postStatus(
                  entry.instance.id,
                  entry.instance.nodeId,
                  "ready",
                );
            }
          },
          (error) => {
            const code =
              error instanceof NativeSourceError ||
              error instanceof NativeWorkerHostError
                ? error.code
                : "worker-scene-failed";
            if (
              [
                "worker-continuous-source-unsupported",
                "worker-unavailable",
                "gpu-unavailable",
                "canvas-unavailable",
              ].includes(code)
            ) {
              this.workerCapabilityBlocked = true;
              queueMicrotask(() => this.requestScan());
            }
            if (
              [
                "gpu-device-lost",
                "gpu-uncaptured-error",
                "worker-failed",
                "worker-init-timeout",
              ].includes(code) &&
              this.workerRecoveryAttempts < 2 &&
              !this.workerRecoveryQueued
            ) {
              this.workerRecoveryAttempts += 1;
              this.workerRecoveryQueued = true;
              queueMicrotask(() => {
                const failed = this.workerScene;
                if (failed?.committedScene()) {
                  this.retiringWorkerScene?.dispose();
                  this.retiringWorkerScene = failed;
                  failed.holdLastFrame();
                } else failed?.dispose();
                if (this.workerScene === failed) this.workerScene = null;
                this.workerRecoveryQueued = false;
                window.setTimeout(
                  () => this.requestScan(),
                  100 * this.workerRecoveryAttempts,
                );
              });
            }
            this.issue(code, error.message);
            for (const entry of this.workerEntries) {
              const status = this.workerScene?.committedScene()
                ? "last-good"
                : "error";
              entry.target.setAttribute("data-an-native-status", status);
              entry.target.setAttribute("data-an-native-error", code);
              this.postStatus(
                entry.instance.id,
                entry.instance.nodeId,
                status,
                {
                  code,
                  message: error.message,
                  instanceId: entry.instance.id,
                },
              );
            }
          },
          nativePresentationTargetLayout,
          () => {
            this.refreshPreviewViewport();
            return {
              viewport: this.previewViewport ?? {
                x: 0,
                y: 0,
                width: innerWidth,
                height: innerHeight,
              },
              pixelRatio: this.desiredScenePreviewPixelRatio(),
            };
          },
        );
        this.workerScene.setVisible(
          document.visibilityState !== "hidden" &&
            this.refreshPreviewViewport(),
        );
        this.workerScene.setEntries(workerEntries);
        return;
      } catch (error) {
        if (
          !(error instanceof NativeWorkerHostError) ||
          ![
            "worker-unavailable",
            "worker-start-failed",
            "worker-transfer-failed",
          ].includes(error.code)
        )
          throw error;
        this.workerCapabilityBlocked = true;
        this.issue(error.code, error.message);
        for (const mount of this.mounts.values()) {
          mount.canvas.dataset.anNativeCanvas = mount.instance.id;
          if (mount.instance.placement === "backdrop")
            mount.canvas.setAttribute(
              "data-an-native-backdrop-presentation",
              "",
            );
        }
        this.workerEntries = [];
      }
    }
    if (this.workerScene) {
      for (const mount of this.mounts.values()) {
        mount.canvas.dataset.anNativeCanvas = mount.instance.id;
        if (mount.instance.placement === "backdrop")
          mount.canvas.setAttribute("data-an-native-backdrop-presentation", "");
      }
      if (this.workerScene.committedScene()) {
        this.retiringWorkerScene?.dispose();
        this.retiringWorkerScene = this.workerScene;
        this.retiringWorkerScene.holdLastFrame();
      } else this.workerScene.dispose();
      this.workerScene = null;
      this.workerEntries = [];
      this.workerPreviewBase = null;
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
    const scene = this.scenePresentation;
    const hasCommittedScene =
      scene !== null &&
      scene.committedSourceEpoch !== null &&
      this.hasCurrentScenePresentation(scene);
    this.syncScenePresentationMode(
      pairedBackdropTargets.size > 0 && hasCommittedScene,
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
        if (existing.definitionHash !== entry.hash)
          this.releaseGraphPipelinePins(existing);
        if (
          JSON.stringify(existing.instance.bindings) !==
          JSON.stringify(entry.instance.bindings)
        )
          this.releaseAuthoredInputs(existing);
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
        if (
          existing.stateful &&
          (!isStatefulResourceGraph(entry.definition.resourceGraph) ||
            existing.stateful.definitionHash !== entry.hash)
        )
          this.releaseStateful(existing);
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
          existing.pointerHistory?.reset(existing.clock.local);
        }
        if (existing.definitionHash !== entry.hash) {
          existing.pointerState = null;
          existing.pointerHistory = null;
        }
        existing.animationCapability = entry.instance.animation
          ? "animated"
          : builtinAnimationCapability(entry.hash);
        existing.instance = entry.instance;
        existing.definition = entry.definition;
        existing.definitionHash = entry.hash;
        if (entry.definition.simulation || entry.definition.interaction) {
          existing.pointerHistory ??= new NativePointerHistory(
            existing.clock.local,
          );
          this.attachPointer(existing);
        } else {
          existing.pointerHistory = null;
          this.detachPointer(existing);
        }
        if (!entry.definition.simulation && existing.simulation)
          this.releaseSimulation(existing);
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
    if (
      !this.hasCameraConsumer() &&
      (this.cameraSource.state() === "active" ||
        this.cameraSource.state() === "starting")
    ) {
      this.cameraSource.stop();
      this.releaseCameraTexture();
    }
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

  private releasePresentationParent(parent: HTMLElement): void {
    const owner = this.positionedParents.get(parent);
    if (owner === 1) {
      parent.removeAttribute("data-an-native-parent-positioned");
      this.positionedParents.delete(parent);
    } else if (owner) this.positionedParents.set(parent, owner - 1);
  }

  private presentationFollowsTarget(
    target: Element,
    canvas: HTMLCanvasElement,
  ): boolean {
    for (
      let sibling = target.nextElementSibling;
      sibling instanceof HTMLCanvasElement;
      sibling = sibling.nextElementSibling
    ) {
      if (sibling === canvas) return true;
      const owner = this.mounts.get(sibling.dataset.anNativeCanvas ?? "");
      if (owner?.target !== target) break;
    }
    return false;
  }

  private attachPresentation(
    instance: EffectInstance,
    target: NativeScenePresentationElement,
    canvas: HTMLCanvasElement,
    previousParent?: HTMLElement,
  ): HTMLElement {
    const parent = target.parentElement;
    if (!parent)
      throw new NativeSourceError(
        "presentation-parent-unavailable",
        "A native output target needs a parent element.",
      );
    if (
      previousParent === parent &&
      this.presentationFollowsTarget(target, canvas)
    )
      return parent;
    if (previousParent !== parent) {
      if (previousParent) this.releasePresentationParent(previousParent);
      const owner = this.positionedParents.get(parent);
      this.positionedParents.set(parent, (owner ?? 0) + 1);
      if (!owner && getComputedStyle(parent).position === "static")
        parent.setAttribute("data-an-native-parent-positioned", "");
    }
    if (this.presentationFollowsTarget(target, canvas)) return parent;
    let insertionPoint: Element = target;
    if (instance.placement === "backdrop")
      while (
        insertionPoint.nextElementSibling instanceof HTMLCanvasElement &&
        insertionPoint.nextElementSibling !== canvas &&
        insertionPoint.nextElementSibling.hasAttribute(
          "data-an-native-backdrop-presentation",
        ) &&
        insertionPoint.nextElementSibling.getAttribute(
          "data-an-native-backdrop-receiver-node-id",
        ) === instance.nodeId
      )
        insertionPoint = insertionPoint.nextElementSibling;
    insertionPoint.after(canvas);
    return parent;
  }

  private reconcilePresentation(mount: Mount): void {
    if (
      mount.presentationParent === mount.target.parentElement &&
      this.presentationFollowsTarget(mount.target, mount.canvas) &&
      mount.canvas.isConnected
    )
      return;
    mount.presentationParent = this.attachPresentation(
      mount.instance,
      mount.target,
      mount.canvas,
      mount.presentationParent,
    );
    mount.authoredStyleDirty = true;
    this.markMountRenderPending(mount);
  }

  private async mount(
    instance: EffectInstance,
    definition: EffectDefinition,
    definitionHash: string,
    target: NativeScenePresentationElement,
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
    canvas.setAttribute("data-an-native-presentation", "");
    if (instance.placement === "backdrop") {
      canvas.setAttribute("data-an-native-backdrop-presentation", "");
      canvas.setAttribute(
        "data-an-native-backdrop-receiver-node-id",
        instance.nodeId,
      );
      canvas.setAttribute("data-an-native-authored-opacity", "1");
      canvas.style.opacity = "0";
    }
    const presentationParent = this.attachPresentation(
      instance,
      target,
      canvas,
    );
    const clockTime = this.currentTime();
    const mounted: Mount = {
      instance,
      definition,
      definitionHash,
      animationCapability: instance.animation
        ? "animated"
        : builtinAnimationCapability(definitionHash),
      target,
      canvas,
      context,
      presentationPair: null,
      presentationParent,
      provider: createNativeSceneProvider(
        target,
        instance.placement,
        () => {
          const current = this.mounts.get(instance.id);
          if (current && !current.frozenReason) this.requestSourceFrame();
        },
        instance.placement === "backdrop" ? canvas : undefined,
      ),
      resourceTextures: new Map(),
      staticGeneratorPassCache:
        new NativeStaticGeneratorPassCache<GPUTexture>(),
      graphPipelinePins: new Map(),
      statelessBuffers: new Set(),
      statelessInputs: new Map(),
      isolationTextures: new Map(),
      drawBindings: new Map(),
      sourceTextures: new Map(),
      assetTextures: new Map(),
      assetPending: new Map(),
      assetFailures: new Map(),
      assetAbort: new AbortController(),
      authoredInputs: new Map(),
      pendingGraphInputEpochs: null,
      outputTexture: null,
      groupLocalCommittedChildren: new Set(),
      groupLocalNoncontributingChildren: new Set(),
      fillCommittedNativeChildren: new Set(),
      layerCommittedNativeSources: new Set(),
      width: 0,
      height: 0,
      pixelRatio: 1,
      outputExtent: null,
      fillPresentationExtent: null,
      captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      maskTexture: null,
      maskSignature: "",
      inputMaskSignature: "",
      inputMaskUsedFrame: -1,
      suppressed: false,
      retainedPresentationWitness: false,
      frameCount: 0,
      committedSourceEpoch: null,
      committedInstancePayload: null,
      committedDefinitionHash: null,
      committedLocalTime: null,
      committedInputEpochs: new Map(),
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
          definition.simulation ||
          definition.feedback ||
          isStatefulResourceGraph(definition.resourceGraph)
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
      simulationFrame: null,
      pointerListener: null,
      pointerLeaveListener: null,
      pointerState: null,
      pointerHistory:
        definition.simulation || definition.interaction
          ? new NativePointerHistory(instance.timing.time)
          : null,
      simulationCaughtUp: true,
      feedback: null,
      feedbackCandidate: null,
      feedbackFrame: null,
      stateful: null,
      statefulCandidate: null,
      statefulFrame: null,
    };
    if (definition.simulation || definition.interaction)
      this.attachPointer(mounted);
    return mounted;
  }

  private pointerLocalTime(mount: Mount): number {
    const now = this.currentTime();
    return mount.clock.paused
      ? mount.clock.local
      : mount.clock.local + (now - mount.clock.global) * mount.clock.speed;
  }

  private activePointerHistory(mount: Mount): NativePointerHistory | null {
    const draft = this.draft;
    return draft?.showDraft && draft.instanceId === mount.instance.id
      ? draft.pointerHistory
      : mount.pointerHistory;
  }

  private recordLivePointer(mount: Mount, pointer: NativePointerState): void {
    const draft = this.draft;
    const draftActive =
      draft?.showDraft && draft.instanceId === mount.instance.id;
    const time = draftActive
      ? draft.playing
        ? (performance.now() - draft.clockOrigin) / 1000
        : draft.time
      : this.pointerLocalTime(mount);
    this.activePointerHistory(mount)?.record(time, {
      x: Math.max(0, Math.min(1, pointer.x)),
      y: Math.max(0, Math.min(1, pointer.y)),
      active: pointer.active,
    });
  }

  private attachPointer(mount: Mount): void {
    if (mount.pointerListener) return;
    const pointer: EventListener = (event): void => {
      if (!(event instanceof PointerEvent)) return;
      if (!mount.width || !mount.height) return;
      let clientToTarget: NativeAffine2D;
      try {
        clientToTarget = nativeClientToTargetAffine(mount.target);
      } catch (error) {
        this.issue(
          error instanceof NativeSourceError ? error.code : "source-transform",
          error instanceof Error ? error.message : String(error),
          mount.instance.id,
        );
        const simulation =
          this.draft?.showDraft && this.draft.instanceId === mount.instance.id
            ? this.draft.simulation
            : mount.simulation;
        if (simulation) simulation.pointer.active = false;
        this.activePointerHistory(mount)?.invalidate(true);
        this.clearInteractionPointer(mount);
        return;
      }
      const previewInstance =
        this.instancePreview?.instanceId === mount.instance.id
          ? this.instancePreview.instance
          : mount.instance;
      const mapped = mapNativePointerInput({
        clientX: event.clientX,
        clientY: event.clientY,
        clientToTarget,
        targetSize: {
          width: nativePresentationTargetLayout(mount.target).width,
          height: nativePresentationTargetLayout(mount.target).height,
        },
        width: mount.width,
        height: mount.height,
        pixelRatio: mount.pixelRatio,
        extent: mount.outputExtent,
        transform: previewInstance.transform,
      });
      if (!mapped.ok) {
        this.issue(mapped.code, mapped.detail, mount.instance.id);
        const simulation =
          this.draft?.showDraft && this.draft.instanceId === mount.instance.id
            ? this.draft.simulation
            : mount.simulation;
        if (simulation) simulation.pointer.active = false;
        this.activePointerHistory(mount)?.invalidate(true);
        this.clearInteractionPointer(mount);
        return;
      }
      const { x, y, active } = mapped.pointer;
      this.recordLivePointer(mount, mapped.pointer);
      const simulation =
        this.draft?.showDraft && this.draft.instanceId === mount.instance.id
          ? this.draft.simulation
          : mount.simulation;
      const prior = simulation?.pointer;
      if (simulation)
        simulation.pointer = {
          x,
          y,
          vx: prior ? x - prior.x : 0,
          vy: prior ? y - prior.y : 0,
          active,
        };
      if (mount.definition.interaction) {
        const previous = mount.pointerState;
        mount.pointerState = mapped.pointer;
        if (
          !previous ||
          previous.x !== x ||
          previous.y !== y ||
          previous.active !== active
        )
          this.requestSourceFrame();
      }
    };
    const leave = (): void => {
      const prior = mount.pointerState ?? mount.simulation?.pointer;
      if (prior?.active)
        this.recordLivePointer(mount, { ...prior, active: false });
      const simulation =
        this.draft?.showDraft && this.draft.instanceId === mount.instance.id
          ? this.draft.simulation
          : mount.simulation;
      if (simulation) simulation.pointer.active = false;
      this.clearInteractionPointer(mount);
    };
    mount.target.addEventListener("pointermove", pointer, { passive: true });
    mount.target.addEventListener("pointerleave", leave);
    mount.pointerListener = pointer;
    mount.pointerLeaveListener = leave;
  }

  private clearInteractionPointer(mount: Mount): void {
    const interaction = mount.definition.interaction;
    if (!interaction || (mount.pointerState && !mount.pointerState.active))
      return;
    const authoredPosition = (mount.instance.params[
      interaction.positionProperty
    ] ?? mount.definition.properties[interaction.positionProperty].default) as [
      number,
      number,
    ];
    mount.pointerState = mount.pointerState
      ? { ...mount.pointerState, active: false }
      : { x: authoredPosition[0], y: authoredPosition[1], active: false };
    this.requestSourceFrame();
  }

  private detachPointer(mount: Mount): void {
    if (mount.pointerListener)
      mount.target.removeEventListener("pointermove", mount.pointerListener);
    if (mount.pointerLeaveListener)
      mount.target.removeEventListener(
        "pointerleave",
        mount.pointerLeaveListener,
      );
    mount.pointerListener = null;
    mount.pointerLeaveListener = null;
    mount.pointerState = null;
  }

  private fillGroup(target: NativeScenePresentationElement): Mount[] {
    return [...this.mounts.values()].filter(
      (candidate) =>
        candidate.instance.placement === "fill" && candidate.target === target,
    );
  }

  private syncFillPresentation(target: NativeScenePresentationElement): void {
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

  private retainedFillPresentation(mount: Mount): boolean {
    if (mount.instance.placement !== "fill") return false;
    if (!mount.retainedPresentationWitness) return false;
    const members = this.fillGroup(mount.target);
    const top = members.find((member) => member.isTopLayer);
    if (
      !top ||
      mount.target.getAttribute("data-an-native-fill-instance") !==
        top.instance.id ||
      !mount.target.hasAttribute("data-an-native-fill-suppressed") ||
      members.some(
        (member) =>
          !member.suppressed ||
          !member.outputTexture ||
          !this.textureBytes.has(member.outputTexture) ||
          member.outputTexture.width !==
            (member === top
              ? (member.fillPresentationExtent?.width ?? member.width)
              : member.width) ||
          member.outputTexture.height !==
            (member === top
              ? (member.fillPresentationExtent?.height ?? member.height)
              : member.height) ||
          member.frameCount === 0 ||
          member.committedSourceEpoch === null ||
          member.committedInstancePayload === null ||
          member.committedDefinitionHash === null,
      ) ||
      top.canvas.style.visibility !== "visible" ||
      top.canvas.width !== (top.fillPresentationExtent?.width ?? top.width) ||
      top.canvas.height !== (top.fillPresentationExtent?.height ?? top.height)
    )
      return false;
    return nativePresentationVisible(top.canvas, {
      width: innerWidth,
      height: innerHeight,
    });
  }

  private restoreFillGroup(
    target: NativeScenePresentationElement,
    markUnavailable = true,
  ): void {
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
    if (mount.instance.placement === "backdrop") {
      mount.target.removeAttribute("data-an-native-receiver-suppressed");
      clearNativeAuthoredOpacityIfUnsuppressed(mount.target);
    }
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
    this.reconcilePresentation(mount);
    if (!mount.suppressed) return;
    if (mount.instance.placement === "layer" && mount.isTopLayer)
      mount.target.setAttribute(
        "data-an-native-layer-instance",
        mount.instance.id,
      );
    mount.canvas.style.visibility =
      mount.isTopLayer && this.hasPresentationGeometry(mount.target, false)
        ? "visible"
        : "hidden";
    if (mount.instance.placement === "layer")
      mount.canvas.style.opacity = mount.layerSourceOpacityDeferred
        ? (mount.target.getAttribute("data-an-native-authored-opacity") ?? "1")
        : "";
    this.syncSceneSourceOpacity(mount);
    if (mount.instance.placement === "layer" && mount.isTopLayer)
      this.syncFillPresentation(mount.target);
    else if (mount.instance.placement === "fill")
      this.syncFillPresentation(mount.target);
  }

  private suppressOriginal(mount: Mount, paintReady = false): void {
    if (!paintReady) this.refreshAuthoredPaint(mount);
    const receiverGeometry = this.receiverGeometryCache.get(mount);
    if (
      mount.instance.placement === "backdrop" &&
      receiverGeometry &&
      receiverGeometry.geometryKind !== "box"
    ) {
      mount.target.setAttribute(
        "data-an-native-authored-opacity",
        String(readNativeAuthoredPaint(mount.target).opacity),
      );
      mount.target.setAttribute("data-an-native-receiver-suppressed", "");
    }
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
    this.previewTargetDensities.delete(mount.target);
    this.previewBudgetDensities.clear();
    this.previewBudgetSignature = "";
    this.gpuProfiler?.forget(mount);
    if (
      mount.instance.placement === "backdrop" &&
      ![...this.mounts.values()].some(
        (other) => other !== mount && other.instance.placement === "backdrop",
      )
    )
      this.releaseScenePresentation();
    this.detachPointer(mount);
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
    this.releasePresentationParent(mount.presentationParent);
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
    this.releaseAuthoredInputs(mount);
    mount.assetAbort.abort();
    for (const asset of mount.assetTextures.values())
      this.destroyTexture(asset.texture);
    mount.assetTextures.clear();
    mount.assetPending.clear();
    mount.assetFailures.clear();
    this.releaseSimulation(mount);
    this.releaseFeedback(mount);
    this.releaseStateful(mount);
    this.releaseGraphPipelinePins(mount);
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

  private targetPreviewDisplayScale(
    members: readonly Mount[],
    localScale: number,
  ): number {
    return Math.max(
      ...members.map((member) =>
        HISTORICAL_DENSITY_HASHES.has(member.definitionHash)
          ? Math.max(1, this.previewDisplayScale)
          : this.previewDisplayScale * localScale,
      ),
    );
  }

  private planPreviewTargetDensities(): boolean {
    if (
      this.compositionPixelRatio !== null ||
      this.exportInitialPixelRatio !== null
    ) {
      this.previewTargetDensities.clear();
      this.previewBudgetDensities.clear();
      this.previewScenePixelRatio = null;
      this.previewSceneBudgetSignature = "";
      this.previewBudgetSignature = "";
      return false;
    }
    const baseDensity = this.previewPolicy.status(
      devicePixelRatio || 1,
    ).effectivePixelRatio;
    const desiredDensity = this.desiredScenePreviewPixelRatio();
    const groups = new Map<NativeScenePresentationElement, Mount[]>();
    for (const mount of this.mounts.values()) {
      if (!this.hasPresentationGeometry(mount.target)) continue;
      const group = groups.get(mount.target) ?? [];
      group.push(mount);
      groups.set(mount.target, group);
    }
    let fixedBytes = 0;
    const requests = [...groups].map(([target, members]) => {
      const layout = nativePresentationTargetLayout(target);
      const rect = target.getBoundingClientRect();
      const insets = { top: 0, right: 0, bottom: 0, left: 0 };
      const output = { top: 0, right: 0, bottom: 0, left: 0 };
      let graphBytesPerPixel = 0;
      for (const member of members) {
        const capture = nativeTargetOverflowInsets(
          target,
          member.instance.placement === "layer",
        );
        for (const side of ["top", "right", "bottom", "left"] as const) {
          insets[side] = Math.max(
            insets[side],
            capture[side],
            member.captureInsets[side],
          );
          output[side] += member.definition.extent?.output?.[side] ?? 0;
        }
        for (const resource of member.definition.resources ?? []) {
          if (resource.kind === "buffer")
            fixedBytes += resource.byteLength ?? 0;
          else if (resource.size === "fixed")
            fixedBytes +=
              (resource.width ?? 0) *
              (resource.height ?? 0) *
              (resource.format === "rgba16float" ? 8 : 4);
          else graphBytesPerPixel += resource.format === "rgba16float" ? 8 : 4;
        }
      }
      const localScale = Math.max(
        rect.width / layout.width,
        rect.height / layout.height,
      );
      const halo =
        Math.max(...Object.values(insets), ...Object.values(output)) *
        localScale;
      const density = nativePreviewTargetDensity({
        baseDensity,
        displayScale: this.targetPreviewDisplayScale(members, localScale),
        viewport: this.previewViewport,
        target: {
          x: rect.left - halo,
          y: rect.top - halo,
          width: rect.width + halo * 2,
          height: rect.height + halo * 2,
        },
      });
      const bytesPerPixel = members.length * 96 + graphBytesPerPixel;
      return {
        id: members[0]!.instance.nodeId,
        width:
          layout.width +
          insets.left +
          insets.right +
          output.left +
          output.right,
        height:
          layout.height +
          insets.top +
          insets.bottom +
          output.top +
          output.bottom,
        baseDensity: Math.min(baseDensity, density),
        desiredDensity: density,
        bytesPerPixel,
        maxDimension: MAX_DIMENSION,
        maxPixels: Math.min(
          MAX_PIXELS,
          Math.floor(MAX_RESOURCE_BYTES / bytesPerPixel),
        ),
      };
    });
    const viewport = this.previewViewport ?? {
      x: 0,
      y: 0,
      width: innerWidth,
      height: innerHeight,
    };
    const sceneDensity = this.previewViewport
      ? fitNativeRasterDensity({
          width: viewport.width,
          height: viewport.height,
          density: desiredDensity,
          maxDimension: MAX_DIMENSION,
          maxPixels: Math.min(MAX_PIXELS, Math.floor(MAX_RESOURCE_BYTES / 40)),
          pixelPadding: 1,
        })
      : desiredDensity;
    const visible = nativePreviewPhysicalViewport(viewport, sceneDensity);
    const scene = this.scenePresentation;
    const hasCommittedScene =
      scene !== null &&
      scene.committedSourceEpoch !== null &&
      this.hasCurrentScenePresentation(scene);
    const needsScene =
      hasCommittedScene ||
      [...this.mounts.values()].some(
        (mount) =>
          mount.instance.placement === "backdrop" &&
          this.hasPresentationGeometry(mount.target),
      );
    const sceneBudgetSignature = JSON.stringify({
      requests,
      viewport,
      sceneDensity,
      needsScene,
      fixedBytes,
      quality: this.previewStatus().requestedQuality,
    });
    const retainedSceneDensity =
      sceneBudgetSignature === this.previewSceneBudgetSignature
        ? this.previewScenePixelRatio
        : null;
    const desiredSceneDensity =
      retainedSceneDensity === null
        ? sceneDensity
        : Math.min(sceneDensity, retainedSceneDensity);
    let sceneRequestId = "__native_scene_presentation__";
    while (requests.some((request) => request.id === sceneRequestId))
      sceneRequestId += "_";
    const sceneRequest = needsScene
      ? {
          id: sceneRequestId,
          width: viewport.width,
          height: viewport.height,
          baseDensity: Math.min(desiredSceneDensity, 0.5),
          desiredDensity: desiredSceneDensity,
          bytesPerPixel: 40,
          maxDimension: MAX_DIMENSION,
          maxPixels: Math.min(MAX_PIXELS, Math.floor(MAX_RESOURCE_BYTES / 40)),
        }
      : null;
    const budgetRequests = sceneRequest
      ? [...requests, sceneRequest]
      : requests;
    // The committed scene stays allocated while the planner fits its replacement
    // alongside every effect, including the first Backdrop frame.
    const retainedSceneTextures = new Set<GPUTexture>();
    if (hasCommittedScene) {
      for (const texture of scene!.surface.resourceTextures.values())
        retainedSceneTextures.add(texture);
      for (const entry of scene!.surface.sourceTextures.values())
        retainedSceneTextures.add(entry.texture);
      const replacement = nativePreviewPhysicalViewport(
        viewport,
        desiredSceneDensity,
      );
      for (const [key, entry] of scene!.surface.isolationTextures)
        if (
          key !== "css-intermediate:source" ||
          entry.width !== replacement.width ||
          entry.height !== replacement.height
        )
          retainedSceneTextures.add(entry.texture);
    }
    const retainedSceneBytes = hasCommittedScene
      ? [...retainedSceneTextures].reduce((bytes, texture) => {
          const size = this.textureBytes.get(texture);
          if (size === undefined)
            throw new NativeSourceError(
              "gpu-budget-unreadable",
              "A retained scene texture has no allocation accounting.",
            );
          return bytes + size;
        }, 0) +
        (
          scene!.presentationPair?.surfaces() ?? [{ canvas: scene!.canvas }]
        ).reduce(
          (bytes, surface) =>
            bytes + surface.canvas.width * surface.canvas.height * 8,
          0,
        )
      : 0;
    const reservedBytes =
      retainedSceneBytes +
      Math.min(MAX_PIXELS, visible.width * visible.height) * 8 +
      33_554_432 +
      fixedBytes;
    const availableBytes = MAX_REALM_TEXTURE_BYTES - reservedBytes;
    const signature = JSON.stringify({
      requests: budgetRequests,
      availableBytes,
    });
    if (signature !== this.previewBudgetSignature) {
      try {
        this.previewBudgetDensities = planNativePreviewBudget(
          budgetRequests,
          availableBytes,
        );
      } catch (error) {
        throw new NativeSourceError(
          "gpu-budget-exceeded",
          `The shared native preview working set cannot fit: ${String(error)}.`,
        );
      }
      this.previewBudgetSignature = signature;
    }
    this.previewScenePixelRatio = sceneRequest
      ? this.previewBudgetDensities.get(sceneRequestId)!
      : null;
    this.previewSceneBudgetSignature = sceneBudgetSignature;
    this.previewTargetDensities = new Map(
      [...groups.keys()].map((target, index) => [
        target,
        this.previewBudgetDensities.get(requests[index]!.id)!,
      ]),
    );
    return [...this.mounts.values()].some((mount) => {
      const density = this.previewTargetDensities.get(mount.target);
      if (density === undefined) return false;
      return (
        density < mount.pixelRatio ||
        (!this.offscreen(mount) && density !== mount.pixelRatio)
      );
    });
  }

  private async drainTextureRetirement(): Promise<void> {
    this.retireBindings();
    while (this.retirementPending) {
      await this.retirementWork;
      this.retireBindings();
    }
  }

  private layout(
    mount: Mount,
    visibleCaptureInsets?: NativeSourceCaptureInsets,
  ): void {
    this.reconcilePresentation(mount);
    this.updatePreviewAttributes();
    const targetLayout = nativePresentationTargetLayout(mount.target);
    let requestedRatio =
      this.compositionPixelRatio ?? this.previewStatus().effectivePixelRatio;
    const previous = mount.previousLayerId
      ? this.mounts.get(mount.previousLayerId)
      : undefined;
    if (mount.previousLayerId && !previous?.outputExtent)
      throw new NativeSourceError(
        "effect-layer-dependency-unavailable",
        "The previous processor has no current output geometry.",
      );
    const captureInsets =
      visibleCaptureInsets ??
      nativeTargetOverflowInsets(
        mount.target,
        mount.instance.placement === "layer",
      );
    const targetMembers = [
      mount,
      ...[...this.mounts.values()].filter(
        (member) => member !== mount && member.target === mount.target,
      ),
    ];
    const graphBytesPerPixel = Math.max(
      0,
      ...targetMembers.map((member) =>
        (member.definition.resources ?? []).reduce(
          (sum, resource) =>
            sum +
            (resource.kind === "texture-2d" && resource.size !== "fixed"
              ? resource.format === "rgba16float"
                ? 8
                : 4
              : 0),
          0,
        ),
      ),
    );
    // Fill phases, source/mask uploads and presentation need working surfaces in addition to the graph.
    const maxPreviewPixels = Math.min(
      MAX_PIXELS,
      Math.floor(MAX_RESOURCE_BYTES / (64 + graphBytesPerPixel)),
    );
    const outputInsets = targetMembers.reduce(
      (sum, member) => ({
        left: sum.left + (member.definition.extent?.output?.left ?? 0),
        top: sum.top + (member.definition.extent?.output?.top ?? 0),
        right: sum.right + (member.definition.extent?.output?.right ?? 0),
        bottom: sum.bottom + (member.definition.extent?.output?.bottom ?? 0),
      }),
      { left: 0, top: 0, right: 0, bottom: 0 },
    );
    if (
      this.compositionPixelRatio === null &&
      this.exportInitialPixelRatio === null &&
      this.previewViewport
    ) {
      const rect = mount.target.getBoundingClientRect();
      const localScale = Math.max(
        rect.width / targetLayout.width,
        rect.height / targetLayout.height,
      );
      const halo =
        Math.max(
          ...Object.values(captureInsets),
          ...Object.values(outputInsets),
        ) * localScale;
      requestedRatio = nativePreviewTargetDensity({
        baseDensity: this.previewPolicy.status(devicePixelRatio || 1)
          .effectivePixelRatio,
        displayScale: this.targetPreviewDisplayScale(targetMembers, localScale),
        viewport: this.previewViewport,
        target: {
          x: rect.left - halo,
          y: rect.top - halo,
          width: rect.width + halo * 2,
          height: rect.height + halo * 2,
        },
      });
    }
    const dpr =
      previous?.outputExtent?.pixelRatio ??
      (this.compositionPixelRatio === null &&
      this.exportInitialPixelRatio === null
        ? this.previewTargetDensities.get(mount.target)
        : undefined) ??
      (this.compositionPixelRatio !== null ||
      this.exportInitialPixelRatio !== null
        ? requestedRatio
        : fitNativeRasterDensity({
            width:
              targetLayout.width +
              captureInsets.left +
              captureInsets.right +
              outputInsets.left +
              outputInsets.right,
            height:
              targetLayout.height +
              captureInsets.top +
              captureInsets.bottom +
              outputInsets.top +
              outputInsets.bottom,
            density: requestedRatio,
            maxDimension: MAX_DIMENSION,
            maxPixels: maxPreviewPixels,
            pixelPadding: 6,
          }));
    const planned = planNativeChainedEffectExtent({
      extent: mount.definition.extent,
      captureInsets: previous ? undefined : captureInsets,
      placement: mount.instance.placement,
      clip: mount.instance.clip,
      cssWidth: targetLayout.width,
      cssHeight: targetLayout.height,
      pixelRatio: dpr,
      maxDimension: MAX_DIMENSION,
      maxPixels: MAX_PIXELS,
      previous: previous?.outputExtent ?? undefined,
    });
    if (!planned.ok) throw new NativeSourceError(planned.code, planned.detail);
    const { width, height } = planned.plan;
    if (
      mount.fillPresentationExtent &&
      (mount.fillPresentationExtent.sourceWidth !== planned.plan.sourceWidth ||
        mount.fillPresentationExtent.sourceHeight !==
          planned.plan.sourceHeight ||
        mount.fillPresentationExtent.pixelRatio !== planned.plan.pixelRatio)
    )
      mount.fillPresentationExtent = null;
    const presentationExtent =
      mount.instance.placement === "fill" && mount.isTopLayer
        ? (mount.fillPresentationExtent ?? planned.plan)
        : planned.plan;
    const { left, top } = presentationExtent;
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
      if (presentationExtent.expanded) {
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
        offsetLeft: targetLayout.offsetLeft,
        offsetTop: targetLayout.offsetTop,
        width: targetLayout.width,
        height: targetLayout.height,
        extent: presentationExtent,
        transformOrigin: targetLayout.transformOrigin,
      });
      if (presentationExtent.expanded && !geometry)
        throw new NativeSourceError(
          "effect-output-transform-unsupported",
          "Expanded output has an unsupported transform origin.",
        );
      mount.canvas.style.left = `${geometry?.left ?? targetLayout.offsetLeft - left / dpr}px`;
      mount.canvas.style.top = `${geometry?.top ?? targetLayout.offsetTop - top / dpr}px`;
      mount.canvas.style.width = `${geometry?.width ?? targetLayout.width + (left + presentationExtent.right) / dpr}px`;
      mount.canvas.style.height = `${geometry?.height ?? targetLayout.height + (top + presentationExtent.bottom) / dpr}px`;
      mount.canvas.style.transform = targetLayout.transform;
      mount.canvas.style.translate = targetLayout.translate;
      mount.canvas.style.rotate = targetLayout.rotate;
      mount.canvas.style.scale = targetLayout.scale;
      mount.canvas.style.transformOrigin =
        geometry?.transformOrigin ?? targetLayout.transformOrigin;
      mount.canvas.style.borderRadius =
        mount.instance.placement === "fill" || presentationExtent.expanded
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
    this.syncSceneSourceOpacity(mount);
    if (mount.width !== width || mount.height !== height) {
      if (mount.instance.placement === "fill" && mount.suppressed)
        this.restoreFillGroup(mount.target, false);
      mount.staticGeneratorPassCache.invalidate();
      this.releaseSimulation(mount);
      this.releaseFeedback(mount);
      this.releaseStateful(mount);
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
    if (
      mount.canvas.width !== presentationExtent.width ||
      mount.canvas.height !== presentationExtent.height
    ) {
      mount.canvas.width = presentationExtent.width;
      mount.canvas.height = presentationExtent.height;
    }
  }

  private positionFillPresentation(
    mount: Mount,
    canvas: HTMLCanvasElement,
    extent: NativeEffectExtentPlan,
  ): void {
    const targetLayout = nativePresentationTargetLayout(mount.target);
    const geometry = planNativeOutputGeometry({
      offsetLeft: targetLayout.offsetLeft,
      offsetTop: targetLayout.offsetTop,
      width: targetLayout.width,
      height: targetLayout.height,
      extent,
      transformOrigin: targetLayout.transformOrigin,
    });
    if (extent.expanded && !geometry)
      throw new NativeSourceError(
        "effect-output-transform-unsupported",
        "Expanded output has an unsupported transform origin.",
      );
    canvas.style.left = `${geometry?.left ?? targetLayout.offsetLeft - extent.left / mount.pixelRatio}px`;
    canvas.style.top = `${geometry?.top ?? targetLayout.offsetTop - extent.top / mount.pixelRatio}px`;
    canvas.style.width = `${geometry?.width ?? targetLayout.width + (extent.left + extent.right) / mount.pixelRatio}px`;
    canvas.style.height = `${geometry?.height ?? targetLayout.height + (extent.top + extent.bottom) / mount.pixelRatio}px`;
    canvas.style.transformOrigin =
      geometry?.transformOrigin ?? targetLayout.transformOrigin;
    canvas.width = extent.width;
    canvas.height = extent.height;
  }

  private async pipeline(
    wgsl: string,
    format: GPUTextureFormat,
    blend = false,
    effect = false,
    effectTextureCount = 2,
    placement?: EffectInstance["placement"],
  ): Promise<GPURenderPipeline> {
    const device = await this.ensureDevice();
    const deviceEpoch = this.deviceEpoch;
    const textureCount = effect ? Math.max(2, effectTextureCount) : 0;
    if (effect) {
      const limit = device.limits.maxSampledTexturesPerShaderStage;
      if (!Number.isSafeInteger(limit) || limit < 2)
        throw new NativeSourceError(
          "effect-input-limit-unavailable",
          "The WebGPU device did not report a usable sampled-texture limit.",
        );
      if (textureCount > limit)
        throw new NativeSourceError(
          "effect-input-limit",
          `This pass needs ${textureCount} sampled textures; the WebGPU device supports ${limit} per shader stage.`,
        );
    }
    const constants = nativeRenderPlacementConstants(wgsl, placement);
    const key = `${deviceEpoch}:${format}:${blend}:${effect}:${textureCount}:${JSON.stringify(constants)}:${wgsl}`;
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
      let effectPipelineLayout = effect
        ? this.effectPipelineLayouts.get(textureCount)
        : undefined;
      if (effect && !effectPipelineLayout) {
        const effectLayout = device.createBindGroupLayout({
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
            ...Array.from({ length: textureCount - 2 }, (_, index) => ({
              binding: index + 4,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float" as const },
            })),
          ],
        });
        effectPipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [effectLayout],
        });
        this.effectPipelineLayouts.set(textureCount, effectPipelineLayout);
      }
      try {
        const pipeline = await device.createRenderPipelineAsync({
          layout: effect ? effectPipelineLayout! : "auto",
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
    const packed = this.packedUniformFrame;
    let packedBinding: {
      buffer: GPUBuffer;
      offset: number;
      size: number;
    } | null = null;
    if (packed) {
      const owner = packed.owners.get(mount);
      if (!owner)
        throw new NativeSourceError(
          "uniform-owner-unavailable",
          "The packed draw has no frame-owned render state.",
        );
      const drawKey = `${owner}:${key}`;
      const occurrence = packed.occurrences.get(drawKey) ?? 0;
      packed.occurrences.set(drawKey, occurrence + 1);
      key = `${key}:${occurrence}`;
      packedBinding = packed.arena.write(
        packed.token,
        `${drawKey}:${occurrence}`,
        bytes,
      );
    }
    let entry = mount.drawBindings.get(key);
    if (
      !entry ||
      entry.size !== size ||
      (packedBinding &&
        (entry.buffer !== packedBinding.buffer ||
          entry.offset !== packedBinding.offset))
    ) {
      if (
        !packedBinding &&
        (this.allocatedUniformBytes + size > MAX_UNIFORM_BYTES ||
          this.estimatedResourceBytes() + size > MAX_REALM_TEXTURE_BYTES)
      )
        throw new NativeSourceError(
          "gpu-budget-exceeded",
          "Native effect uniform bindings exceed the bounded resource budget.",
        );
      const buffer =
        packedBinding?.buffer ??
        this.device!.createBuffer({
          size,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      if (!packedBinding) {
        this.uniformBytes.set(buffer, size);
        this.allocatedUniformBytes += size;
      }
      if (entry && !this.packedArenaBuffers.has(entry.buffer))
        this.retirement.push(entry.buffer);
      entry = {
        buffer,
        offset: packedBinding?.offset ?? 0,
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
    if (!packedBinding) this.device!.queue.writeBuffer(entry.buffer, 0, bytes);
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
        {
          binding: 0,
          resource: { buffer: entry.buffer, offset: entry.offset ?? 0, size },
        },
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
    const device = this.device;
    const submittedWork = device.queue.onSubmittedWorkDone();
    this.retirementPending = true;
    const buffers = this.retirement.splice(0);
    const textures = this.textureRetirement.splice(0);
    for (const texture of textures)
      this.retirementInFlightTextures.add(texture);
    this.retirementWork = submittedWork.then(
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
    nativeTextureOverrides?: ReadonlyMap<string, GPUTexture>,
  ): Promise<GPUTexture> {
    const physicalRoot = planNativePhysicalRootBox({
      width: mount.width,
      height: mount.height,
      left: mount.outputExtent?.left ?? 0,
      top: mount.outputExtent?.top ?? 0,
      origin:
        mount.viewport && mount.pixelRatio
          ? {
              x: Math.round(mount.viewport.x * mount.pixelRatio),
              y: Math.round(mount.viewport.y * mount.pixelRatio),
            }
          : undefined,
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
      ? await this.pipeline(backdropReplaceWgsl(), this.workingFormat)
      : null;
    const targetRect = mount.target.getBoundingClientRect();
    const sourceScale =
      mount.viewport && mount.pixelRatio
        ? { ok: true as const, x: mount.pixelRatio, y: mount.pixelRatio }
        : planNativeSourceCoordinateScale({
            spaces: scene.map((record) => record.coordinateSpace),
            sourceWidth: globalLocal
              ? nativePresentationTargetLayout(mount.target).width *
                (mount.pixelRatio ?? 0)
              : (mount.outputExtent?.sourceWidth ?? mount.width),
            sourceHeight: globalLocal
              ? nativePresentationTargetLayout(mount.target).height *
                (mount.pixelRatio ?? 0)
              : (mount.outputExtent?.sourceHeight ?? mount.height),
            localWidth:
              mount.outputExtent === undefined && mount.pixelRatio
                ? mount.width / mount.pixelRatio
                : nativePresentationTargetLayout(mount.target).width,
            localHeight:
              mount.outputExtent === undefined && mount.pixelRatio
                ? mount.height / mount.pixelRatio
                : nativePresentationTargetLayout(mount.target).height,
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
          const receiverPipeline = item.receiverCoverage
            ? await this.pipeline(backdropReplaceWgsl(true), this.workingFormat)
            : replacementPipeline;
          const next = replacementTarget(planes, current, width, height);
          if (next === item.texture) unavailablePlanes();
          const bind = this.bind(
            mount,
            `scene:${item.id}:replace`,
            receiverPipeline,
            current,
            item.texture,
            data,
            this.sourceSizingSampler(sampling.filter, sampling.filter),
            null,
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
          pass.setPipeline(receiverPipeline);
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
        if (
          mount.viewport &&
          (!nativePreviewBoxesOverlap(mount.viewport, record.rect) ||
            !nativePreviewBoxesOverlap(mount.viewport, record.clip))
        )
          return null;
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
        const candidate = record.nativeInstanceId
          ? this.frameTransaction?.candidates.get(record.nativeInstanceId)
          : undefined;
        const override = record.nativeInstanceId
          ? (nativeTextureOverrides?.get(record.nativeInstanceId) ??
            candidate?.texture)
          : undefined;
        if (record.sourceRole === "ancestor-fill-prefix" && !override)
          throw new NativeSourceError(
            "native-dependency-missing",
            "The staged ancestor Fill prefix is unavailable.",
          );
        const texture = record.nativeInstanceId
          ? nestedBackdropId
            ? this.transparent
            : (override ?? nativeMount?.outputTexture)
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
          receiverCoverage:
            nativeMount?.instance.placement === "backdrop"
              ? (candidate?.coverage ??
                this.receiverGeometryCache.get(nativeMount)?.coverage)
              : undefined,
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
    this.simulationBindLayout(device);
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
    const draft =
      this.draft?.showDraft &&
      this.draft.instanceId === mount.instance.id &&
      this.draft.definition === definition
        ? this.draft
        : null;
    if (definition !== mount.definition && !draft)
      throw new NativeSourceError(
        "simulation-definition-invalid",
        "simulation-definition-invalid",
      );
    const spec = definition.simulation;
    if (!spec)
      throw new NativeSourceError(
        "simulation-invalid",
        "Simulation metadata is missing.",
      );
    assertNativeUniformTiming(spec.fixedDt, "delta-time");
    const countProperty = definition.properties[spec.count.property];
    const countValue =
      instance.params[spec.count.property] ?? countProperty?.default;
    let count: number;
    if ("tiers" in spec.count) {
      if (
        countValue !== "low" &&
        countValue !== "medium" &&
        countValue !== "high"
      )
        throw new NativeSourceError(
          "simulation-tier-invalid",
          "The particle tier is invalid.",
        );
      count = spec.count.tiers[countValue];
    } else {
      if (
        !Number.isSafeInteger(countValue) ||
        (countValue as number) < spec.count.min ||
        (countValue as number) > spec.count.max
      )
        throw new NativeSourceError(
          "simulation-count-invalid",
          "The agent count is outside the bounded integer range.",
        );
      count = countValue as number;
    }
    const stateSpec = definition.resources?.find(
      (resource) => resource.name === spec.stateResource,
    );
    const declaredByteLength = stateSpec?.byteLength;
    const byteLength =
      "tiers" in spec.count
        ? declaredByteLength
        : count * spec.bytesPerParticle;
    if (
      stateSpec?.kind !== "buffer" ||
      !byteLength ||
      !declaredByteLength ||
      declaredByteLength < count * spec.bytesPerParticle ||
      byteLength * 3 > MAX_RESOURCE_BYTES ||
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
    const simulationDevice = this.device!;
    const simulationDeviceEpoch = this.deviceEpoch;
    const assertSimulationDevice = () => {
      if (
        this.device !== simulationDevice ||
        this.deviceEpoch !== simulationDeviceEpoch
      )
        throw new NativeSourceError(
          "device-generation-changed",
          "The WebGPU device changed during simulation encoding.",
        );
    };
    const layout = this.simulationBindLayout(simulationDevice);
    const compute = (await this.simulationPipeline(
      update,
    )) as GPUComputePipeline;
    assertSimulationDevice();
    const definitionKey = `${definition.id}:${definition.version}:${update.wgsl}:${paint.wgsl}:${trail.wgsl}`;
    const previousState = draft ? draft.simulation : mount.simulation;
    let state =
      previousState &&
      previousState.count === count &&
      previousState.byteLength === byteLength &&
      previousState.width === mount.width &&
      previousState.height === mount.height &&
      previousState.seed === instance.seed &&
      previousState.definitionKey === definitionKey
        ? previousState
        : null;
    let stepPlan = planNativeSimulationSteps({
      lastCompletedStep: state?.completedStep ?? -1,
      targetTime: time,
      fixedDt: spec.fixedDt,
      mode: deterministic ? "deterministic" : "interactive",
      maxInteractiveSteps: spec.maxInteractiveSteps,
      maxDeterministicSteps: spec.maxDeterministicSteps,
    });
    if (stepPlan.reset) {
      state = null;
      stepPlan = planNativeSimulationSteps({
        lastCompletedStep: -1,
        targetTime: time,
        fixedDt: spec.fixedDt,
        mode: deterministic ? "deterministic" : "interactive",
        maxInteractiveSteps: spec.maxInteractiveSteps,
        maxDeterministicSteps: spec.maxDeterministicSteps,
      });
    }
    if (state && stepPlan.steps.length === 0) {
      const priorTrail = mount.resourceTextures.get(trail.output);
      if (priorTrail) return priorTrail;
    }
    const newState = !state;
    if (!state) {
      assertSimulationDevice();
      this.ensureCompositionBudget(mount, byteLength * 3);
      if (
        this.estimatedResourceBytes() + byteLength * 3 >
        MAX_REALM_TEXTURE_BYTES
      )
        this.ensureTextureBudget(byteLength * 3);
      const makeBuffer = (): GPUBuffer => {
        const buffer = simulationDevice.createBuffer({
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
      let second: GPUBuffer | undefined;
      let third: GPUBuffer;
      try {
        second = makeBuffer();
        third = makeBuffer();
      } catch (error) {
        this.destroyStatefulBuffer(first);
        if (second) this.destroyStatefulBuffer(second);
        throw error;
      }
      state = {
        buffers: [first, second, third],
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
      values.set(
        packNativeProperties(
          definition,
          resolveNativeParameterAnimation(
            definition,
            instance.params,
            instance.animation,
            stepTime,
          ),
        ),
        8,
      );
      return this.simulationUniform(values);
    };
    const bind = (
      read: GPUBuffer,
      write: GPUBuffer,
      globals: GPUBuffer,
      interaction: GPUBuffer,
    ): GPUBindGroup =>
      simulationDevice.createBindGroup({
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
    let leaseRelease: (() => void) | null = null;
    const transaction = createNativeSimulationTransaction({
      committedBank: state.readIndex,
      completedStep: state.completedStep,
      steps: stepPlan.steps,
      onSubmittedWorkDone: () => simulationDevice.queue.onSubmittedWorkDone(),
      release: () => leaseRelease?.(),
      promote: (bank, step) => {
        state.readIndex = bank;
        state.completedStep = step;
      },
    });
    try {
      const pointerSource = draft ? mount.pointerState : null;
      let livePointerPrior = state.pointer;
      let committedPointer = state.pointer;
      for (const {
        step: stepIndex,
        readBank,
        writeBank,
      } of transaction.bankSteps) {
        const read = state.buffers[readBank];
        const write = state.buffers[writeBank];
        const replay = deterministic
          ? this.replayPointer(mount, stepIndex * spec.fixedDt, {
              ...spec.idlePointer,
              active: false,
            })
          : null;
        const priorReplay =
          replay && stepIndex > 0
            ? this.replayPointer(mount, (stepIndex - 1) * spec.fixedDt, {
                ...spec.idlePointer,
                active: false,
              })
            : null;
        const pointer = replay
          ? {
              ...replay,
              vx:
                replay.active && priorReplay?.active
                  ? replay.x - priorReplay.x
                  : 0,
              vy:
                replay.active && priorReplay?.active
                  ? replay.y - priorReplay.y
                  : 0,
            }
          : deterministic
            ? { ...spec.idlePointer, vx: 0, vy: 0, active: false }
            : draft && pointerSource
              ? {
                  ...pointerSource,
                  vx: pointerSource.x - livePointerPrior.x,
                  vy: pointerSource.y - livePointerPrior.y,
                }
              : state.pointer;
        committedPointer = pointer;
        livePointerPrior = pointer;
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
        pass.dispatchWorkgroups(
          Math.ceil(count / update.dispatch.workgroupSize),
        );
        pass.end();
      }
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
        mount.width * mount.height * 20 + byteLength * 3 > MAX_RESOURCE_BYTES
      )
        throw new NativeSourceError(
          "simulation-trail-unsupported",
          "Persistent particle trails require bounded viewport-sized rgba16float textures.",
        );
      const output = this.texture(mount.width, mount.height, format);
      mount.resourceTextures.set(paint.output, output);
      const pipeline = (await this.simulationPipeline(
        paint,
        format,
      )) as GPURenderPipeline;
      assertSimulationDevice();
      const interaction = this.simulationUniform(
        new Float32Array([
          spec.idlePointer.x,
          spec.idlePointer.y,
          0,
          0,
          0,
          spec.fixedDt,
          transaction.finalStep,
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
          state.buffers[transaction.finalBank],
          state.buffers[state.readIndex],
          uniform(time),
          interaction,
        ),
      );
      render.draw(paint.draw.vertices, count);
      render.end();
      let previousTrail = newState
        ? undefined
        : mount.resourceTextures.get(trail.output);
      let nextTrail = newState
        ? undefined
        : mount.resourceTextures.get("__native_trail_back");
      if (
        !previousTrail ||
        previousTrail.width !== mount.width ||
        previousTrail.height !== mount.height
      ) {
        previousTrail = this.texture(mount.width, mount.height, "rgba16float");
        mount.resourceTextures.set(trail.output, previousTrail);
        const initialize = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: previousTrail.createView(),
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            },
          ],
        });
        initialize.end();
      }
      if (
        !nextTrail ||
        nextTrail.width !== mount.width ||
        nextTrail.height !== mount.height
      ) {
        nextTrail = this.texture(mount.width, mount.height, "rgba16float");
        mount.resourceTextures.set("__native_trail_back", nextTrail);
      }
      const trailPipeline = await this.pipeline(
        trail.wgsl,
        "rgba16float",
        false,
        true,
      );
      assertSimulationDevice();
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
      leaseRelease = this.retainStatefulResources(
        simulationDevice,
        new Set([source, output, previousTrail, nextTrail]),
        new Set(state.buffers),
      );
      const frame: NativeSimulationFrame = {
        transaction,
        state,
        previousState: newState ? previousState : null,
        caughtUp: stepPlan.caughtUp,
        targetStep: stepPlan.targetStep,
        count,
        pointer: committedPointer,
        pointerSource,
      };
      if (draft) draft.simulationFrame = frame;
      else mount.simulationFrame = frame;
      return nextTrail;
    } catch (error) {
      try {
        await transaction.abandon();
      } finally {
        if (newState) this.retireSimulationState(state);
      }
      throw error;
    }
  }

  private async statefulResourcePasses(
    mount: Mount,
    source: GPUTexture | null,
    time: number,
    encoder: GPUCommandEncoder,
    definition: EffectDefinition,
    instance: EffectInstance,
    sourceRevision: string,
    deterministic: boolean,
    sourceIdentity: string,
    sourceReplaySafety: "immutable" | "dynamic" | "unknown",
    externalTextures?: ReadonlyMap<string, GPUTexture>,
    inputEpochs?: ReadonlyMap<string, number | null>,
  ): Promise<GPUTexture> {
    const graph = definition.resourceGraph;
    if (!isStatefulResourceGraph(graph))
      throw new NativeSourceError(
        "stateful-definition-invalid",
        "The stateful graph definition is invalid.",
      );
    const draft =
      this.draft?.showDraft &&
      this.draft.instanceId === instance.id &&
      this.draft.definition === definition
        ? this.draft
        : null;
    if (definition !== mount.definition && !draft)
      throw new NativeSourceError(
        "stateful-definition-invalid",
        "The draft graph session is unavailable.",
      );
    const definitionHash = draft?.executionHash ?? mount.definitionHash;
    const plan = planEffectGraph(definition);
    if (plan.errors.length)
      throw new NativeSourceError(
        "stateful-definition-invalid",
        plan.errors.join("; "),
      );
    const declared = new Map(
      (definition.resources ?? []).map((resource) => [resource.name, resource]),
    );
    let resetPropertyValues: NativeStatefulResetValues;
    try {
      resetPropertyValues = snapshotNativeStatefulResetValues(
        definition,
        instance.params,
        graph.resetProperties ?? [],
      );
    } catch (error) {
      if (error instanceof NativeStatefulResetValueError)
        throw new NativeSourceError(error.code, error.message);
      throw error;
    }
    const target = resolveNativeStatefulTargetStep(
      time,
      graph.timing.fixedDt,
      graph.timing.maxStepIndex,
      deterministic,
    );
    if (target === null)
      throw new NativeSourceError(
        "stateful-step-limit",
        "The requested fixed step is outside the graph limit.",
      );
    const published = draft ? draft.stateful : mount.stateful;
    const needsCandidate =
      !published ||
      published.definitionHash !== definitionHash ||
      published.seed !== instance.seed ||
      published.sourceIdentity !== sourceIdentity ||
      published.sourceWidth !== (source?.width ?? mount.width) ||
      published.sourceHeight !== (source?.height ?? mount.height) ||
      published.seekRevision !== (instance.timing.seekRevision ?? 0) ||
      nativeStatefulResetValuesChanged(
        published.resetPropertyValues,
        resetPropertyValues,
      ) ||
      target < published.executor.lastCompletedStep;
    const pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    const device = this.device!;
    const epoch = this.deviceEpoch;
    for (const pass of plan.passes) {
      const output = declared.get(pass.output);
      const reads = [...pass.reads, ...(pass.previousFrameReads ?? [])].map(
        (name) => declared.get(name),
      );
      if (!output || reads.some((value) => !value))
        throw new NativeSourceError(
          "stateful-definition-invalid",
          `Pass ${pass.id} has an undeclared resource.`,
        );
      pipelines.set(
        pass.id,
        await this.linearResourcePipeline(
          pass,
          reads as EffectResourceSpec[],
          output,
          mount,
        ),
      );
    }
    if (
      this.device !== device ||
      this.deviceEpoch !== epoch ||
      this.mounts.get(instance.id) !== mount
    )
      throw new NativeSourceError(
        "stateful-frame-invalid",
        "The GPU device or mounted effect changed while compiling the state graph.",
      );
    if (!mount.pendingGraphInputEpochs)
      mount.pendingGraphInputEpochs = new Map();
    if (needsCandidate) {
      const stateNames = new Set(graph.stateResources);
      const plannedBytes = plan.passes.reduce((sum, pass) => {
        const spec = declared.get(pass.output)!;
        const width = spec.size === "fixed" ? spec.width! : mount.width;
        const height = spec.size === "fixed" ? spec.height! : mount.height;
        const bytes =
          spec.kind === "buffer"
            ? spec.byteLength!
            : width * height * (spec.format === "rgba16float" ? 8 : 4);
        return (
          sum +
          bytes *
            (spec.name === definition.output
              ? 0
              : stateNames.has(spec.name)
                ? 3
                : 1)
        );
      }, 0);
      this.ensureCompositionBudget(mount, plannedBytes);
      const textures = new Set<GPUTexture>();
      const buffers = new Set<GPUBuffer>();
      const executor = NativeStatefulResourceSession.create(
        device,
        {
          texture: (width, height, format, usage) => {
            const texture = this.texture(width, height, format, usage);
            textures.add(texture);
            return texture;
          },
          buffer: (byteLength) => {
            this.ensureTextureBudget(byteLength);
            const buffer = device.createBuffer({
              size: byteLength,
              usage:
                GPUBufferUsage.STORAGE |
                GPUBufferUsage.COPY_SRC |
                GPUBufferUsage.COPY_DST,
            });
            this.simulationBuffers.set(buffer, byteLength);
            this.allocatedSimulationBytes += byteLength;
            buffers.add(buffer);
            return buffer;
          },
          releaseTexture: (texture) => {
            textures.delete(texture);
            this.destroyTexture(texture);
          },
          releaseBuffer: (buffer) => {
            buffers.delete(buffer);
            this.destroyStatefulBuffer(buffer);
          },
          lease: (leasedTextures, leasedBuffers) =>
            this.retainStatefulResources(device, leasedTextures, leasedBuffers),
        },
        definition,
        mount.width,
        mount.height,
      );
      const stateful: NonNullable<Mount["stateful"]> = {
        executor,
        definitionHash,
        seed: instance.seed,
        resetPropertyValues,
        seekRevision: instance.timing.seekRevision ?? 0,
        sourceIdentity,
        sourceRevision: "",
        pendingSourceRevision: null,
        sourceWidth: source?.width ?? mount.width,
        sourceHeight: source?.height ?? mount.height,
        droppedSteps: 0,
        pendingDroppedSteps: 0,
        textures,
        buffers,
      };
      if (draft) draft.statefulCandidate = stateful;
      else mount.statefulCandidate = stateful;
    }
    const stateful = needsCandidate
      ? (draft ? draft.statefulCandidate : mount.statefulCandidate)!
      : published!;
    const completed = stateful.executor.lastCompletedStep;
    if (
      completed < 0 &&
      deterministic &&
      graph.sourceHistory === "sequential-captures" &&
      target > 0 &&
      sourceReplaySafety !== "immutable"
    )
      throw new NativeSourceError(
        "stateful-source-history-unavailable",
        "Sequential source history must begin at the first fixed step.",
      );
    const maxSteps = Math.min(
      graph.timing.maxStepsPerCall,
      Math.floor(128 / plan.passes.length),
    );
    const first =
      !deterministic &&
      graph.sourceHistory === "sequential-captures" &&
      target > completed
        ? target
        : completed + 1;
    const pending = Math.max(0, target - first + 1);
    if (graph.sourceHistory === "sequential-captures" && pending > 1) {
      const sourceIsStatic =
        sourceReplaySafety === "immutable" &&
        (completed < 0 || stateful.sourceRevision === sourceRevision);
      if (!sourceIsStatic)
        throw new NativeSourceError(
          "stateful-source-history-unavailable",
          "Each dynamic source step needs a captured source frame.",
        );
    }
    if (deterministic && pending > maxSteps)
      throw new NativeSourceError(
        "stateful-step-limit",
        "Deterministic graph catch-up exceeds the bounded pass budget.",
      );
    const count = deterministic ? pending : Math.min(pending, maxSteps);
    const steps = count
      ? Array.from({ length: count }, (_, index) => first + index)
      : [completed];
    const outputSpec = declared.get(definition.output!);
    if (
      outputSpec?.kind !== "texture-2d" ||
      outputSpec.size !== "viewport" ||
      (outputSpec.format !== "rgba8unorm" &&
        outputSpec.format !== "rgba16float")
    )
      throw new NativeSourceError(
        "stateful-definition-invalid",
        "The stateful graph needs a viewport-sized render output.",
      );
    const outputFormat = outputSpec.format;
    const output = acquireNativeStatefulOutput(
      draft?.statefulResources ?? mount.resourceTextures,
      definition.output!,
      mount.outputTexture,
      source,
      mount.width,
      mount.height,
      outputFormat,
      () => {
        const outputBytes =
          mount.width * mount.height * (outputFormat === "rgba16float" ? 8 : 4);
        this.ensureCompositionBudget(mount, outputBytes);
        return this.texture(mount.width, mount.height, outputFormat);
      },
      (texture) => this.textureRetirement.push(texture),
    );
    const frame = stateful.executor.encode({
      encoder,
      source,
      target: output,
      pipelines,
      passes: plan.passes,
      steps,
      fixedDt: graph.timing.fixedDt,
      seed: instance.seed,
      sourceIdentity,
      sourceRevision,
      ...(externalTextures ? { externalTextures } : {}),
      ...(inputEpochs ? { inputEpochs } : {}),
      sourceEpoch:
        source === null || graph.abi === "stateful-resource-v3"
          ? null
          : sourceIdentity.startsWith("authored:")
            ? (mount.authoredInputs.get("source")?.capturedSourceEpoch ?? null)
            : sourceIdentity === "camera"
              ? this.renderEpoch
              : (mount.provider?.sourceEpoch?.() ?? null),
      drawCount: (property, maximum, stepTime) => {
        const animated = resolveNativeParameterAnimation(
          definition,
          instance.params,
          instance.animation,
          stepTime,
        );
        const count = Object.prototype.hasOwnProperty.call(animated, property)
          ? animated[property]
          : definition.properties[property]?.default;
        if (
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > maximum
        )
          throw new NativeSourceError(
            "stateful-params-invalid",
            `Draw count ${property} is out of range.`,
          );
        return count;
      },
      uniforms: (_pass, _width, _height, stepTime, dt) => {
        const data = new Float32Array(136);
        data.set(
          [mount.width, mount.height, 1 / mount.width, 1 / mount.height],
          0,
        );
        data.set(
          packNativeUniformClock({
            time: stepTime,
            seed: instance.seed,
            pixelRatio: mount.pixelRatio,
            deltaTime: dt,
          }),
          4,
        );
        const values = resolveNativeParameterAnimation(
          definition,
          instance.params,
          instance.animation,
          stepTime,
        );
        data.set(
          this.packPointerForTime(
            mount,
            definition,
            values,
            stepTime,
            deterministic,
          ),
          8,
        );
        return data;
      },
    });
    stateful.pendingSourceRevision = sourceRevision;
    stateful.pendingDroppedSteps =
      !deterministic && graph.sourceHistory === "sequential-captures"
        ? Math.max(0, target - Math.max(0, completed + 1))
        : 0;
    if (draft) draft.statefulFrame = frame;
    else mount.statefulFrame = frame;
    mount.simulationCaughtUp = frame.completedStep >= target;
    return frame.output;
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
    sourceIdentity: string,
  ): Promise<GPUTexture> {
    const draft =
      this.draft?.showDraft && this.draft.instanceId === mount.instance.id
        ? this.draft
        : null;
    const previousFeedback = draft
      ? (draft.feedbackCandidate ?? draft.feedback)
      : (mount.feedbackCandidate ?? mount.feedback);
    const adapted =
      previousFeedback?.definitionHash ===
      (draft ? draft.executionHash : mount.definitionHash)
        ? {
            ok: true as const,
            definition: previousFeedback!.definition,
          }
        : adaptNativeFeedbackDefinition(definition);
    if (!adapted.ok)
      throw new NativeSourceError(
        adapted.code,
        "The feedback graph is not executable.",
      );
    const read = (name: string): number => {
      const value =
        (instance.params as Record<string, unknown>)[name] ??
        definition.properties[name]?.default;
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
    const resetPropertyValues = (adapted.definition.resetProperties ?? []).map(
      (name) => [name, read(name)] as const,
    );
    const revision = instance.timing.seekRevision ?? 0;
    const prior = previousFeedback;
    if (
      prior &&
      (prior.definitionHash !==
        (draft ? draft.executionHash : mount.definitionHash) ||
        prior.sourceIdentity !== sourceIdentity ||
        prior.seed !== params.seed ||
        nativeFeedbackResetValuesChanged(
          prior.resetPropertyValues,
          resetPropertyValues,
        ) ||
        prior.seekRevision !== revision ||
        prior.sourceWidth !== source.width ||
        prior.sourceHeight !== source.height)
    ) {
      const candidate = draft
        ? draft.feedbackCandidate
        : mount.feedbackCandidate;
      if (candidate) {
        if (draft) draft.feedbackCandidate = null;
        else mount.feedbackCandidate = null;
        void this.disposeFeedback(candidate).catch((error) =>
          this.issue(
            "feedback-cleanup-failed",
            String(error),
            mount.instance.id,
          ),
        );
      }
    }
    const matches = (feedback: NonNullable<Mount["feedback"]> | null) =>
      !!feedback &&
      feedback.definitionHash ===
        (draft ? draft.executionHash : mount.definitionHash) &&
      feedback.sourceIdentity === sourceIdentity &&
      feedback.seed === params.seed &&
      !nativeFeedbackResetValuesChanged(
        feedback.resetPropertyValues,
        resetPropertyValues,
      ) &&
      feedback.seekRevision === revision &&
      feedback.sourceWidth === source.width &&
      feedback.sourceHeight === source.height;
    if (
      !matches(
        draft
          ? (draft.feedbackCandidate ?? draft.feedback)
          : (mount.feedbackCandidate ?? mount.feedback),
      )
    ) {
      const grid = adapted.definition.grid;
      this.ensureCompositionBudget(
        mount,
        grid.width * grid.height * 40 + mount.width * mount.height * 24,
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
      const feedback: NonNullable<Mount["feedback"]> = {
        executor,
        definition: adapted.definition,
        textures,
        definitionHash: draft ? draft.executionHash : mount.definitionHash,
        seed: params.seed,
        resetPropertyValues,
        seekRevision: revision,
        sourceIdentity,
        sourceRevision: "",
        pendingSourceRevision: null,
        pointerPosition: null,
        pendingPointerPosition: null,
        sourceWidth: source.width,
        sourceHeight: source.height,
        retirements: new Set(),
      };
      if (draft) draft.feedbackCandidate = feedback;
      else mount.feedbackCandidate = feedback;
    }
    const feedback = (
      draft
        ? (draft.feedbackCandidate ?? draft.feedback)
        : (mount.feedbackCandidate ?? mount.feedback)
    )!;
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
    const resources = draft ? draft.resources : mount.resourceTextures;
    let output = resources.get(outputName);
    if (
      output &&
      (output.width !== source.width ||
        output.height !== source.height ||
        output.format !== "rgba16float")
    ) {
      resources.delete(outputName);
      this.destroyTexture(output);
      output = undefined;
    }
    if (!output) {
      this.ensureCompositionBudget(mount, source.width * source.height * 8);
      output = this.texture(source.width, source.height, "rgba16float");
      resources.set(outputName, output);
    }
    const pointerPosition = definition.interaction
      ? ((instance.params[definition.interaction.positionProperty] ??
          definition.properties[definition.interaction.positionProperty]
            .default) as [number, number])
      : null;
    const replay =
      deterministic && pointerPosition
        ? this.replayPointer(mount, time, {
            x: pointerPosition[0],
            y: pointerPosition[1],
            active: false,
          })
        : null;
    const pointer = adapted.definition.pointer
      ? resolveNativeFeedbackPointerInput(
          definition,
          instance.params,
          replay ?? mount.pointerState,
          deterministic && !replay,
          feedback.pointerPosition,
        )
      : undefined;
    const frame = feedback.executor.encode({
      encoder,
      source,
      target: output,
      timeSeconds: time,
      initialLocalSeconds: instance.timing.time,
      mode: deterministic ? "deterministic" : "interactive",
      speed: deterministic ? undefined : instance.timing.speed,
      params,
      pointer,
      sourcePixelRatio: (source.width * mount.pixelRatio) / mount.width,
      sourceChanged: feedback.sourceRevision !== sourceRevision,
      timestampWritesForPass: ({ kind, stepIndex }) =>
        this.gpuTimestampWrites(encoder, `feedback:${kind}:step-${stepIndex}`),
    });
    feedback.pendingSourceRevision = sourceRevision;
    feedback.pendingPointerPosition = pointer
      ? { x: pointer.x, y: pointer.y, active: pointer.active }
      : null;
    if (draft) draft.feedbackFrame = frame;
    else mount.feedbackFrame = frame;
    return output;
  }

  private async statelessComputePasses(
    mount: Mount,
    source: GPUTexture,
    time: number,
    encoder: GPUCommandEncoder,
    definition: EffectDefinition,
    instance: EffectInstance,
    deterministic: boolean,
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
      if (!inputPlan.ok || inputPlan.inputs.size !== 1 || !sourceBinding)
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
      data.set(
        this.packPointerForTime(
          mount,
          definition,
          instance.params,
          time,
          deterministic,
        ),
        8,
      );
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

  private authoredInputTarget(nodeId: string): NativeScenePresentationElement {
    let target: NativeScenePresentationElement | null = null;
    for (const candidate of document.querySelectorAll<NativeScenePresentationElement>(
      "[data-agent-native-node-id]",
    )) {
      if (candidate.getAttribute("data-agent-native-node-id") !== nodeId)
        continue;
      if (target)
        throw new NativeSourceError(
          "input-authored-node-ambiguous",
          `Authored input ${nodeId} has more than one live node.`,
        );
      target = candidate;
    }
    if (!target)
      throw new NativeSourceError(
        "input-authored-node-missing",
        `Authored input ${nodeId} has no live node.`,
      );
    return target;
  }

  private async authoredInputTexture(
    mount: Mount,
    resource: string,
    binding: { nodeId: string; capture: "content" | "appearance" },
    time: number,
    deterministic: boolean,
    encoder: GPUCommandEncoder,
    complete: Set<string>,
    active: Set<string>,
  ): Promise<GPUTexture> {
    let target: NativeScenePresentationElement;
    try {
      target = this.authoredInputTarget(binding.nodeId);
    } catch (error) {
      this.releaseAuthoredInput(mount, resource);
      throw error;
    }
    const epoch = this.deviceEpoch;
    const renderEpoch = this.renderEpoch;
    const backdropOwners =
      binding.capture === "appearance"
        ? [...this.mounts.values()].filter(
            (candidate) =>
              candidate.target === target &&
              candidate.instance.placement === "backdrop",
          )
        : [];
    const nativeOwner =
      binding.capture === "appearance"
        ? ([...this.mounts.values()].find(
            (candidate) =>
              candidate.target === target &&
              candidate.isTopLayer &&
              candidate.instance.placement === "layer",
          ) ??
          [...this.mounts.values()].find(
            (candidate) =>
              candidate.target === target &&
              candidate.isTopLayer &&
              candidate.instance.placement === "fill",
          ))
        : undefined;
    for (const backdrop of backdropOwners) {
      if (backdrop.frozenReason)
        throw new NativeSourceError(
          backdrop.frozenReason.code,
          backdrop.frozenReason.message,
        );
      if (active.has(backdrop.instance.id))
        throw new NativeSourceError(
          "effect-dependency-cycle",
          `Authored appearance ${binding.nodeId} depends on its own active backdrop.`,
        );
      await this.renderMount(backdrop, time, deterministic, complete, active);
      if (!backdrop.outputTexture || !backdrop.outputExtent)
        throw new NativeSourceError(
          "input-authored-appearance-unavailable",
          `Authored appearance ${binding.nodeId} has no current backdrop output.`,
        );
    }
    if (nativeOwner) {
      if (nativeOwner.frozenReason)
        throw new NativeSourceError(
          nativeOwner.frozenReason.code,
          nativeOwner.frozenReason.message,
        );
      if (active.has(nativeOwner.instance.id))
        throw new NativeSourceError(
          "effect-dependency-cycle",
          `Authored appearance ${binding.nodeId} depends on its own active effect.`,
        );
      await this.renderMount(
        nativeOwner,
        time,
        deterministic,
        complete,
        active,
      );
      if (!nativeOwner.outputTexture || !nativeOwner.outputExtent)
        throw new NativeSourceError(
          "input-authored-appearance-unavailable",
          `Authored appearance ${binding.nodeId} has no current native output.`,
        );
    }
    const extent =
      nativeOwner?.fillPresentationExtent ?? nativeOwner?.outputExtent;
    const ratio = extent?.pixelRatio ?? mount.pixelRatio;
    const width =
      extent?.width ??
      Math.ceil(nativePresentationTargetLayout(target).width * ratio);
    const height =
      extent?.height ??
      Math.ceil(nativePresentationTargetLayout(target).height * ratio);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION ||
      width * height > MAX_PIXELS
    )
      throw new NativeSourceError(
        "input-authored-node-size",
        `Authored input ${binding.nodeId} has unavailable or oversized capture dimensions.`,
      );
    let capture = mount.authoredInputs.get(resource);
    if (
      capture &&
      (capture.target !== target ||
        capture.nodeId !== binding.nodeId ||
        capture.capture !== binding.capture ||
        capture.surface.width !== width ||
        capture.surface.height !== height ||
        capture.surface.pixelRatio !== ratio ||
        (capture.surface.outputExtent?.left ?? 0) !== (extent?.left ?? 0) ||
        (capture.surface.outputExtent?.top ?? 0) !== (extent?.top ?? 0))
    ) {
      this.releaseAuthoredInput(mount, resource);
      capture = undefined;
    }
    if (!capture) {
      const provider = createNativeSceneProvider(
        target,
        "layer",
        () => {
          if (!mount.frozenReason) this.requestSourceFrame();
        },
        undefined,
        binding.capture,
      );
      if (!provider)
        throw new NativeSourceError(
          "input-authored-node-unavailable",
          `Authored input ${binding.nodeId} cannot be captured.`,
        );
      capture = {
        target,
        nodeId: binding.nodeId,
        capture: binding.capture,
        provider,
        surface: {
          target,
          width,
          height,
          pixelRatio: ratio,
          outputExtent: extent ?? null,
          budgetOwner: mount,
          resourceTextures: new Map(),
          isolationTextures: new Map(),
          drawBindings: new Map(),
          sourceTextures: new Map(),
          imageRasters: 0,
          sourceDownsamples: 0,
        },
        capturedSourceEpoch: null,
        capturedAuthoredEpoch: null,
        replaySafety: "unknown",
      };
      mount.authoredInputs.set(resource, capture);
    }
    capture.provider.setDensity(ratio);
    if (this.authoredInputReuseEpoch !== renderEpoch) {
      this.authoredInputReuse = new WeakMap();
      this.authoredInputReuseEpoch = renderEpoch;
    }
    const reuseKey = this.authoredInputReuseKey(capture, epoch, renderEpoch);
    const reuse = this.authoredInputReuse.get(target)?.get(reuseKey);
    if (
      reuse &&
      reuse.owner !== mount &&
      this.authoredInputReuseCurrent(reuse) &&
      !capture.provider.needsContinuousFrames() &&
      capture.provider.sourceEpoch?.() !== undefined &&
      capture.provider.authoredSourceEpoch?.() !== undefined
    ) {
      const release = this.retainStatelessTextures(
        this.device!,
        new Set([reuse.texture]),
      );
      const device = this.device!;
      const frames = this.statelessFrames.get(encoder) ?? [];
      frames.push({
        abandon: release,
        retire: async () => {
          try {
            await device.queue.onSubmittedWorkDone();
          } finally {
            release();
          }
        },
      });
      this.statelessFrames.set(encoder, frames);
      capture.borrowed = reuse;
      capture.borrowedImages = reuse.images;
      capture.replaySafety = "immutable";
      capture.capturedSourceEpoch = capture.provider.sourceEpoch!();
      capture.capturedAuthoredEpoch = capture.provider.authoredSourceEpoch!();
      return reuse.texture;
    }
    const readStableScene = async (): Promise<{
      scene: NativeSourceRecord[];
      sourceEpoch: number;
      authoredEpoch: number;
    }> => {
      const before = capture.provider.sourceEpoch?.();
      const authoredBefore = capture.provider.authoredSourceEpoch?.();
      if (before === undefined || authoredBefore === undefined)
        throw new NativeSourceError(
          "input-authored-source-stale",
          `Authored input ${binding.nodeId} has no source revision.`,
        );
      const scene = await capture.provider.readScene(
        undefined,
        "dependency-refresh",
      );
      if (
        capture.provider.sourceEpoch?.() !== before ||
        capture.provider.authoredSourceEpoch?.() !== authoredBefore
      )
        throw new NativeSourceError(
          "input-authored-source-stale",
          `Authored input ${binding.nodeId} changed during source read.`,
        );
      return { scene, sourceEpoch: before, authoredEpoch: authoredBefore };
    };
    let read = await readStableScene();
    let scene = read.scene;
    let refreshed = false;
    for (const record of scene) {
      if (!record.nativeInstanceId) continue;
      const dependency = this.mounts.get(record.nativeInstanceId);
      if (!dependency)
        throw new NativeSourceError(
          "native-dependency-missing",
          `Authored input ${binding.nodeId} contains an unmounted native output.`,
        );
      if (dependency.frozenReason)
        throw new NativeSourceError(
          dependency.frozenReason.code,
          dependency.frozenReason.message,
        );
      if (active.has(dependency.instance.id))
        throw new NativeSourceError(
          "effect-dependency-cycle",
          `Authored input ${binding.nodeId} depends on an active effect.`,
        );
      const wasComplete = complete.has(dependency.instance.id);
      await this.renderMount(dependency, time, deterministic, complete, active);
      if (!wasComplete) refreshed = true;
    }
    if (refreshed) {
      read = await readStableScene();
      scene = read.scene;
    }
    if (
      nativeOwner &&
      !scene.some(
        (record) => record.nativeInstanceId === nativeOwner.instance.id,
      )
    )
      throw new NativeSourceError(
        "input-authored-appearance-unavailable",
        `Authored appearance ${binding.nodeId} did not expose its current native output.`,
      );
    for (const backdrop of backdropOwners)
      if (
        !scene.some(
          (record) => record.nativeInstanceId === backdrop.instance.id,
        )
      )
        throw new NativeSourceError(
          "input-authored-appearance-unavailable",
          `Authored appearance ${binding.nodeId} did not expose its current backdrop output.`,
        );
    const texture = await this.composeScene(
      capture.surface,
      scene,
      encoder,
      "source",
      this.colorPresented === "srgb" &&
        this.dynamicRangePresented === "sdr" &&
        scene.length > 1
        ? "srgb-css-linear"
        : "linear",
    );
    if (
      this.deviceEpoch !== epoch ||
      this.renderEpoch !== renderEpoch ||
      this.mounts.get(mount.instance.id) !== mount ||
      mount.authoredInputs.get(resource) !== capture ||
      this.authoredInputTarget(binding.nodeId) !== target ||
      capture.provider.sourceEpoch?.() !== read.sourceEpoch ||
      capture.provider.authoredSourceEpoch?.() !== read.authoredEpoch
    )
      throw new NativeSourceError(
        "input-authored-source-stale",
        `Authored input ${binding.nodeId} changed during capture.`,
      );
    capture.replaySafety = await capture.provider.replaySafety(scene);
    if (
      capture.provider.sourceEpoch?.() !== read.sourceEpoch ||
      capture.provider.authoredSourceEpoch?.() !== read.authoredEpoch
    )
      throw new NativeSourceError(
        "input-authored-source-stale",
        `Authored input ${binding.nodeId} changed during replay classification.`,
      );
    capture.capturedSourceEpoch = read.sourceEpoch;
    capture.capturedAuthoredEpoch = read.authoredEpoch;
    capture.borrowed = undefined;
    capture.borrowedImages = undefined;
    if (
      capture.replaySafety === "immutable" &&
      binding.capture === "content" &&
      scene.length === 1 &&
      scene.every(
        (record) =>
          record.kind === "image" &&
          record.source instanceof HTMLImageElement &&
          !!record.imageSourceUrl &&
          (record.source.currentSrc || record.source.src) ===
            record.imageSourceUrl,
      )
    ) {
      const images = scene.map((record) => ({
        source: record.source as HTMLImageElement,
        url: record.imageSourceUrl!,
      }));
      const entry: AuthoredInputReuse = {
        key: reuseKey,
        owner: mount,
        resource,
        capture,
        texture,
        sourceEpoch: read.sourceEpoch,
        authoredEpoch: read.authoredEpoch,
        images,
        deviceEpoch: epoch,
        renderEpoch,
      };
      if (this.authoredInputReuseCurrent(entry)) {
        let entries = this.authoredInputReuse.get(target);
        if (!entries) {
          entries = new Map();
          this.authoredInputReuse.set(target, entries);
        }
        entries.set(reuseKey, entry);
      }
    }
    return texture;
  }

  private authoredInputReuseKey(
    capture: AuthoredInputCapture,
    deviceEpoch: number,
    renderEpoch: number,
  ): string {
    const target = capture.target;
    const rect = target.getBoundingClientRect();
    const { width, height, pixelRatio, outputExtent } = capture.surface;
    return [
      capture.capture,
      width,
      height,
      pixelRatio,
      outputExtent?.left ?? 0,
      outputExtent?.top ?? 0,
      outputExtent?.right ?? 0,
      outputExtent?.bottom ?? 0,
      outputExtent?.sourceWidth ?? width,
      outputExtent?.sourceHeight ?? height,
      "linear",
      nativePresentationTargetLayout(target).width,
      nativePresentationTargetLayout(target).height,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      this.colorPresented,
      this.dynamicRangePresented,
      this.workingFormat,
      deviceEpoch,
      renderEpoch,
    ].join(":");
  }

  private authoredInputReuseCurrent(reuse: AuthoredInputReuse): boolean {
    return (
      this.deviceEpoch === reuse.deviceEpoch &&
      this.renderEpoch === reuse.renderEpoch &&
      this.mounts.get(reuse.owner.instance.id) === reuse.owner &&
      reuse.owner.authoredInputs.get(reuse.resource) === reuse.capture &&
      reuse.capture.replaySafety === "immutable" &&
      reuse.capture.surface.resourceTextures.get("source") === reuse.texture &&
      reuse.capture.provider.sourceEpoch?.() === reuse.sourceEpoch &&
      reuse.capture.provider.authoredSourceEpoch?.() === reuse.authoredEpoch &&
      this.authoredInputReuseKey(
        reuse.capture,
        reuse.deviceEpoch,
        reuse.renderEpoch,
      ) === reuse.key &&
      reuse.images.every(
        ({ source, url }) =>
          source.isConnected && (source.currentSrc || source.src) === url,
      ) &&
      this.textureBytes.has(reuse.texture) &&
      !this.statelessTextureDestruction.has(reuse.texture)
    );
  }

  private authoredInputCaptureCurrent(
    mount: Mount,
    resource: string,
    capture: AuthoredInputCapture,
    sourceEpoch: number,
    phase: "submission" | "committed" = "submission",
  ): boolean {
    return (
      mount.authoredInputs.get(resource) === capture &&
      capture.capturedSourceEpoch === sourceEpoch &&
      capture.provider.sourceEpoch?.() === sourceEpoch &&
      capture.capturedAuthoredEpoch !== null &&
      capture.provider.authoredSourceEpoch?.() ===
        capture.capturedAuthoredEpoch &&
      (!capture.borrowedImages ||
        capture.borrowedImages.every(
          ({ source, url }) =>
            source.isConnected && (source.currentSrc || source.src) === url,
        )) &&
      (phase === "committed" ||
        !capture.borrowed ||
        this.authoredInputReuseCurrent(capture.borrowed))
    );
  }

  private async linearResourcePipeline(
    pass: EffectPass,
    reads: readonly EffectResourceSpec[],
    output: EffectResourceSpec,
    mount: Mount,
  ): Promise<GPURenderPipeline | GPUComputePipeline> {
    const device = this.device!;
    const epoch = this.deviceEpoch;
    const compute = pass.kind === "compute";
    const visibility = compute
      ? GPUShaderStage.COMPUTE
      : GPUShaderStage.FRAGMENT;
    const sampled = reads.filter(
      (resource) => resource.kind === "texture-2d",
    ).length;
    const storageReads = reads.length - sampled;
    const limits = device.limits;
    if (
      !Number.isSafeInteger(limits.maxSampledTexturesPerShaderStage) ||
      !Number.isSafeInteger(limits.maxStorageBuffersPerShaderStage) ||
      !Number.isSafeInteger(limits.maxStorageTexturesPerShaderStage) ||
      sampled > limits.maxSampledTexturesPerShaderStage ||
      storageReads + (compute && output.kind === "buffer" ? 1 : 0) >
        limits.maxStorageBuffersPerShaderStage ||
      (compute &&
        output.kind === "texture-2d" &&
        limits.maxStorageTexturesPerShaderStage < 1)
    )
      throw new NativeSourceError(
        "linear-resource-device-limit",
        `Pass ${pass.id} exceeds this WebGPU device's texture or storage binding limit.`,
      );
    const key = `${epoch}:${pass.kind}:${output.format ?? "buffer"}:${reads.map((resource) => resource.kind).join(",")}:${pass.draw ? "instanced" : "single"}:${pass.wgsl}`;
    if (!this.graphPipelines.has(key)) this.ensureTextureBudget(524_288);
    let newlyPinned = false;
    if (!mount.graphPipelinePins.has(key)) {
      try {
        mount.graphPipelinePins.set(key, this.graphPipelines.pin(key));
      } catch (error) {
        if (error instanceof NativePipelineCacheCapacityError)
          throw new NativeSourceError(
            "pipeline-cache-budget-exceeded",
            "The mounted shader working set exceeds the bounded pipeline cache.",
          );
        throw error;
      }
      newlyPinned = true;
    }
    try {
      return await this.graphPipelines.getOrCreate(key, async () => {
        const module = device.createShaderModule({ code: pass.wgsl });
        const compilation = await module.getCompilationInfo();
        if (this.device !== device || this.deviceEpoch !== epoch)
          throw new NativeSourceError(
            "device-generation-changed",
            "The WebGPU device changed during shader compilation.",
          );
        const issues = compilation.messages.filter(
          (message) => message.type === "error",
        );
        if (issues.length)
          throw new NativeShaderCompilationError(
            issues.map((issue) => ({
              line: issue.lineNum,
              column: issue.linePos,
              message: issue.message,
            })),
          );
        const entries: GPUBindGroupLayoutEntry[] = [
          {
            binding: 0,
            visibility: compute
              ? GPUShaderStage.COMPUTE
              : GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
          { binding: 1, visibility, sampler: { type: "filtering" } },
          ...reads.map(
            (resource, index): GPUBindGroupLayoutEntry => ({
              binding: index + 2,
              visibility:
                !compute && resource.kind === "buffer"
                  ? GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
                  : visibility,
              ...(resource.kind === "buffer"
                ? { buffer: { type: "read-only-storage" as const } }
                : { texture: { sampleType: "float" as const } }),
            }),
          ),
        ];
        if (compute)
          entries.push({
            binding: 18,
            visibility: GPUShaderStage.COMPUTE,
            ...(output.kind === "buffer"
              ? { buffer: { type: "storage" } }
              : {
                  storageTexture: {
                    access: "write-only",
                    format: output.format as GPUTextureFormat,
                  },
                }),
          });
        try {
          const layout = device.createPipelineLayout({
            bindGroupLayouts: [device.createBindGroupLayout({ entries })],
          });
          const pipeline = compute
            ? await device.createComputePipelineAsync({
                layout,
                compute: { module, entryPoint: "cs" },
              })
            : await device.createRenderPipelineAsync({
                layout,
                vertex: { module, entryPoint: "vs" },
                fragment: {
                  module,
                  entryPoint: "fs",
                  targets: [
                    {
                      format: output.format as GPUTextureFormat,
                      ...(pass.draw
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
          if (this.device !== device || this.deviceEpoch !== epoch)
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
    } catch (error) {
      if (newlyPinned) {
        mount.graphPipelinePins.get(key)?.();
        mount.graphPipelinePins.delete(key);
      }
      if (error instanceof NativePipelineCacheCapacityError)
        throw new NativeSourceError(
          "pipeline-cache-budget-exceeded",
          "The mounted shader working set exceeds the bounded pipeline cache.",
        );
      throw error;
    }
  }

  private async linearResourcePasses(
    mount: Mount,
    source: GPUTexture,
    time: number,
    encoder: GPUCommandEncoder,
    definition: EffectDefinition,
    instance: EffectInstance,
    deterministic: boolean,
    dependencies?: { complete: Set<string>; active: Set<string> },
  ): Promise<GPUTexture> {
    const plan = planEffectGraph(definition);
    if (plan.errors.length)
      throw new NativeSourceError(
        "linear-resource-definition-invalid",
        plan.errors.join("; "),
      );
    const declared = new Map(
      (definition.resources ?? []).map((resource) => [resource.name, resource]),
    );
    const { resources: inputs, inputPlan } = await this.effectInputTextures(
      mount,
      source,
      time,
      encoder,
      definition,
      instance,
      deterministic,
      dependencies,
    );
    const inputEpochs = new Map<
      string,
      { capture: AuthoredInputCapture; sourceEpoch: number }
    >();
    for (const [name, binding] of inputPlan.inputs) {
      if (binding.kind !== "authored-node") continue;
      const capture = mount.authoredInputs.get(name);
      if (!capture || capture.capturedSourceEpoch === null)
        throw new NativeSourceError(
          "input-authored-source-stale",
          `Authored input ${binding.nodeId} has no captured source revision.`,
        );
      inputEpochs.set(name, {
        capture,
        sourceEpoch: capture.capturedSourceEpoch,
      });
    }
    for (const pass of plan.passes) {
      const mipmapped = pass.reads.filter((name) => {
        const binding = inputPlan.inputs.get(name);
        return binding?.kind === "asset" && binding.mipmap === "generated";
      });
      if (mipmapped.length && pass.reads.length !== 1)
        throw new NativeSourceError(
          "input-mipmap-sampler-unsupported",
          "A processed mipmapped input needs its own single-texture pass.",
        );
    }
    const device = this.device!;
    const epoch = this.deviceEpoch;
    const renderEpoch = this.renderEpoch;
    const pipelines = new Map<string, GPURenderPipeline | GPUComputePipeline>();
    for (const pass of plan.passes) {
      const output = declared.get(pass.output);
      const reads = pass.reads.map((name) => declared.get(name));
      if (!output || reads.some((read) => !read))
        throw new NativeSourceError(
          "linear-resource-definition-invalid",
          `Pass ${pass.id} has an undeclared resource.`,
        );
      try {
        pipelines.set(
          pass.id,
          await this.linearResourcePipeline(
            pass,
            reads as EffectResourceSpec[],
            output,
            mount,
          ),
        );
      } catch (error) {
        if (error instanceof NativeShaderCompilationError)
          throw error.withPass(pass.id);
        throw error;
      }
    }
    if (
      this.device !== device ||
      this.deviceEpoch !== epoch ||
      this.renderEpoch !== renderEpoch ||
      this.mounts.get(instance.id) !== mount
    )
      throw new NativeSourceError(
        "linear-resource-frame-invalid",
        "The effect source changed while preparing its GPU graph.",
      );
    for (const [name, { capture, sourceEpoch }] of inputEpochs)
      if (!this.authoredInputCaptureCurrent(mount, name, capture, sourceEpoch))
        throw new NativeSourceError(
          "input-authored-source-stale",
          `Authored input ${capture.nodeId} changed while preparing its GPU graph.`,
        );
    mount.pendingGraphInputEpochs = inputEpochs;
    const values = new Map<string, GPUTexture | GPUBuffer>(inputs);
    const buffers: GPUBuffer[] = [];
    const usedUniforms = new Set<GPUBuffer>();
    const usedTextures = new Set<GPUTexture>(inputs.values());
    let graphBytes = 0;
    const releaseBuffers = () => {
      for (const buffer of buffers) {
        mount.statelessBuffers.delete(buffer);
        const bytes = this.statelessBufferBytes.get(buffer);
        if (bytes !== undefined) {
          this.statelessBufferBytes.delete(buffer);
          this.allocatedStatelessBytes -= bytes;
        }
        buffer.destroy();
      }
    };
    try {
      for (const pass of plan.passes) {
        const spec = declared.get(pass.output)!;
        const dispatch = pass.dispatch;
        const width =
          spec.kind === "buffer"
            ? spec.byteLength! / 16
            : spec.size === "fixed"
              ? spec.width!
              : mount.width;
        const height =
          spec.kind === "buffer"
            ? 1
            : spec.size === "fixed"
              ? spec.height!
              : mount.height;
        const byteLength =
          spec.kind === "buffer"
            ? spec.byteLength!
            : width * height * (spec.format === "rgba16float" ? 8 : 4);
        if (
          !Number.isSafeInteger(byteLength) ||
          byteLength < 1 ||
          (spec.kind === "texture-2d" &&
            (width < 1 ||
              height < 1 ||
              width > MAX_DIMENSION ||
              height > MAX_DIMENSION ||
              width > device.limits.maxTextureDimension2D ||
              height > device.limits.maxTextureDimension2D ||
              width * height > MAX_PIXELS)) ||
          (spec.kind === "buffer" &&
            (byteLength > device.limits.maxStorageBufferBindingSize ||
              byteLength > device.limits.maxBufferSize))
        )
          throw new NativeSourceError(
            "linear-resource-device-limit",
            `Pass ${pass.id} exceeds this WebGPU device's resource size limit.`,
          );
        graphBytes += byteLength;
        if (graphBytes > MAX_RESOURCE_BYTES)
          throw new NativeSourceError(
            "resource-budget-exceeded",
            "The effect graph exceeds the per-instance resource budget.",
          );
        let output: GPUTexture | GPUBuffer;
        if (spec.kind === "buffer") {
          this.ensureCompositionBudget(mount, byteLength);
          this.ensureTextureBudget(byteLength);
          const buffer = device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          buffers.push(buffer);
          mount.statelessBuffers.add(buffer);
          this.statelessBufferBytes.set(buffer, byteLength);
          this.allocatedStatelessBytes += byteLength;
          output = buffer;
        } else {
          let texture = mount.resourceTextures.get(pass.output);
          if (
            !texture ||
            texture.width !== width ||
            texture.height !== height ||
            texture.format !== spec.format ||
            (pass.kind === "compute" && !this.graphStorageTextures.has(texture))
          ) {
            mount.resourceTextures.delete(pass.output);
            this.destroyTexture(texture);
            this.ensureCompositionBudget(mount, byteLength);
            texture = this.texture(
              width,
              height,
              spec.format as GPUTextureFormat,
              pass.kind === "compute" ? GPUTextureUsage.STORAGE_BINDING : 0,
            );
            if (pass.kind === "compute") this.graphStorageTextures.add(texture);
            mount.resourceTextures.set(pass.output, texture);
          }
          output = texture;
          usedTextures.add(texture);
        }
        const pipeline = pipelines.get(pass.id)!;
        const data = new Float32Array(136);
        data.set([width, height, 1 / width, 1 / height], 0);
        data.set(
          packNativeUniformClock({
            time,
            seed: instance.seed,
            pixelRatio: mount.pixelRatio,
          }),
          4,
        );
        data.set(
          this.packPointerForTime(
            mount,
            definition,
            instance.params,
            time,
            deterministic,
          ),
          8,
        );
        const bindingKey = `linear:${pass.id}`;
        let uniform = mount.drawBindings.get(bindingKey);
        if (!uniform) {
          const size = data.byteLength;
          if (
            this.allocatedUniformBytes + size > MAX_UNIFORM_BYTES ||
            this.estimatedResourceBytes() + size > MAX_REALM_TEXTURE_BYTES
          )
            throw new NativeSourceError(
              "gpu-budget-exceeded",
              "Native effect uniforms exceed the bounded resource budget.",
            );
          this.ensureCompositionBudget(mount, size);
          const buffer = device.createBuffer({
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          this.uniformBytes.set(buffer, size);
          this.allocatedUniformBytes += size;
          uniform = {
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
          mount.drawBindings.set(bindingKey, uniform);
        }
        device.queue.writeBuffer(uniform.buffer, 0, data);
        usedUniforms.add(uniform.buffer);
        uniform.lastFrame = this.renderEpoch;
        const entries: GPUBindGroupEntry[] = [
          { binding: 0, resource: { buffer: uniform.buffer } },
          { binding: 1, resource: this.sampler! },
        ];
        for (const [index, name] of pass.reads.entries()) {
          const resource = values.get(name);
          if (!resource)
            throw new NativeSourceError(
              "pass-input-missing",
              `Pass ${pass.id} has no GPU resource for ${name}.`,
            );
          entries.push({
            binding: index + 2,
            resource:
              declared.get(name)?.kind === "buffer"
                ? { buffer: resource as GPUBuffer }
                : (resource as GPUTexture).createView(),
          });
          if (declared.get(name)?.kind === "texture-2d")
            usedTextures.add(resource as GPUTexture);
        }
        if (pass.kind === "compute")
          entries.push({
            binding: 18,
            resource:
              spec.kind === "buffer"
                ? { buffer: output as GPUBuffer }
                : (output as GPUTexture).createView(),
          });
        const bind = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries,
        });
        if (pass.kind === "compute") {
          if (!isLinearResourceDispatch(dispatch))
            throw new NativeSourceError(
              "linear-resource-definition-invalid",
              `Pass ${pass.id} has invalid dispatch metadata.`,
            );
          const [x, y, z] = dispatch.workgroupSize;
          if (
            x > device.limits.maxComputeWorkgroupSizeX ||
            y > device.limits.maxComputeWorkgroupSizeY ||
            z > device.limits.maxComputeWorkgroupSizeZ ||
            x * y * z > device.limits.maxComputeInvocationsPerWorkgroup
          )
            throw new NativeSourceError(
              "linear-resource-device-limit",
              `Pass ${pass.id} exceeds this WebGPU device's workgroup limit.`,
            );
          const groupsX = Math.ceil(
            (spec.kind === "buffer" ? byteLength / 16 : width) / x,
          );
          const groupsY = spec.kind === "buffer" ? 1 : Math.ceil(height / y);
          if (
            groupsX > device.limits.maxComputeWorkgroupsPerDimension ||
            groupsY > device.limits.maxComputeWorkgroupsPerDimension
          )
            throw new NativeSourceError(
              "linear-resource-device-limit",
              `Pass ${pass.id} exceeds this WebGPU device's dispatch limit.`,
            );
          const compute = encoder.beginComputePass({
            ...this.gpuTimestampWrites(encoder, `effect:${pass.id}`),
          });
          compute.setPipeline(pipeline as GPUComputePipeline);
          compute.setBindGroup(0, bind);
          compute.dispatchWorkgroups(groupsX, groupsY, 1);
          compute.end();
        } else {
          const render = encoder.beginRenderPass({
            ...this.gpuTimestampWrites(encoder, `effect:${pass.id}`),
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
          render.draw(3);
          render.end();
        }
        values.set(pass.output, output);
      }
      const final = values.get(definition.output!);
      if (!final || declared.get(definition.output!)?.kind !== "texture-2d")
        throw new NativeSourceError(
          "linear-resource-output-missing",
          "The effect graph did not produce its final texture.",
        );
      const releaseTextures = this.retainStatelessTextures(
        device,
        usedTextures,
      );
      let releaseUniforms: () => void;
      try {
        releaseUniforms = this.retainGraphUniforms(usedUniforms);
      } catch (error) {
        releaseTextures();
        throw error;
      }
      const frames = this.statelessFrames.get(encoder) ?? [];
      frames.push({
        abandon: () => {
          try {
            releaseBuffers();
          } finally {
            try {
              releaseUniforms();
            } finally {
              releaseTextures();
            }
          }
        },
        retire: async () => {
          try {
            await device.queue.onSubmittedWorkDone();
          } finally {
            try {
              releaseBuffers();
            } finally {
              try {
                releaseUniforms();
              } finally {
                releaseTextures();
              }
            }
          }
        },
      });
      this.statelessFrames.set(encoder, frames);
      return final as GPUTexture;
    } catch (error) {
      releaseBuffers();
      throw error;
    }
  }

  cameraState() {
    return this.cameraSource.state();
  }

  async startCamera(instanceId: string, port: string): Promise<void> {
    let parentActivated = false;
    try {
      parentActivated =
        window.parent.navigator.userActivation?.isActive === true;
    } catch {
      parentActivated = false;
    }
    if (
      this.disposed ||
      (navigator.userActivation?.isActive === false && !parentActivated)
    )
      throw new NativeCameraError("unavailable");
    const mount = this.mounts.get(instanceId);
    if (!mount || mount.instance.enabled === false)
      throw new NativeCameraError("unavailable");
    const plan = planNativeInputResources(mount.definition, mount.instance);
    const resource = mount.definition.inputs?.[port]?.resource;
    if (!plan.ok || !resource || plan.inputs.get(resource)?.kind !== "camera")
      throw new NativeCameraError("unavailable");
    await this.cameraSource.start();
    if (this.disposed || !this.hasCameraConsumer()) {
      this.cameraSource.stop();
      throw new NativeCameraError("stopped");
    }
    this.requestSourceFrame();
  }

  stopCamera(): void {
    this.cameraSource.stop();
    this.releaseCameraTexture();
  }

  async snapshotCamera(
    expectedInstanceIds: readonly string[],
  ): Promise<ImageBitmap> {
    this.assertCameraConsumers(expectedInstanceIds);
    const bitmap = await createImageBitmap(this.cameraSource.frame());
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > 1920 ||
      bitmap.height > 1080 ||
      this.disposed ||
      this.cameraSource.state() !== "active"
    ) {
      bitmap.close();
      throw new NativeCameraError("unavailable");
    }
    return bitmap;
  }

  async recordCameraClip(
    expectedInstanceIds: readonly string[],
    durationSeconds: number,
    signal: AbortSignal,
    onProgress?: (elapsedSeconds: number, durationSeconds: number) => void,
  ): Promise<Blob> {
    this.assertCameraConsumers(expectedInstanceIds);
    const blob = await recordNativeCameraClip({
      sourceTrack: this.cameraSource.track(),
      durationSeconds,
      signal,
      onProgress: (elapsedSeconds, totalSeconds) => {
        this.assertCameraConsumers(expectedInstanceIds);
        onProgress?.(elapsedSeconds, totalSeconds);
      },
    });
    this.assertCameraConsumers(expectedInstanceIds);
    return blob;
  }

  async installCameraClip(
    clip: {
      nextFrame: (
        frameIndex: number,
        signal: AbortSignal,
      ) => Promise<ImageBitmap>;
      dispose: () => void;
    },
    signal: AbortSignal,
  ): Promise<void> {
    if (this.disposed) throw new NativeCameraError("unavailable");
    this.clearCameraClip();
    this.cameraClip = clip;
    try {
      await this.nextCameraClipFrame(0, signal);
    } catch (error) {
      this.clearCameraClip();
      throw error;
    }
  }

  async nextCameraClipFrame(
    frameIndex: number,
    signal: AbortSignal,
  ): Promise<void> {
    const clip = this.cameraClip;
    if (!clip || this.disposed) throw new NativeCameraError("unavailable");
    if (frameIndex === 0 && this.cameraSnapshot) return;
    const bitmap = await clip.nextFrame(frameIndex, signal);
    if (this.disposed || clip !== this.cameraClip || signal.aborted) {
      bitmap.close();
      throw new NativeCameraError("unavailable");
    }
    this.replaceCameraSnapshot(bitmap, frameIndex === 0);
  }

  clearCameraClip(): void {
    this.cameraClip?.dispose();
    this.cameraClip = null;
    this.clearCameraSnapshot();
  }

  private assertCameraConsumers(expectedInstanceIds: readonly string[]): void {
    if (
      this.disposed ||
      this.cameraSource.state() !== "active" ||
      expectedInstanceIds.length === 0 ||
      !expectedInstanceIds.every((id) => {
        const mount = this.mounts.get(id);
        const plan = mount
          ? planNativeInputResources(mount.definition, mount.instance)
          : null;
        return (
          mount?.instance.enabled !== false &&
          plan?.ok === true &&
          [...plan.inputs.values()].some((input) => input.kind === "camera")
        );
      })
    )
      throw new NativeCameraError("unavailable");
  }

  installCameraSnapshot(bitmap: ImageBitmap): void {
    this.replaceCameraSnapshot(bitmap, true);
  }

  private replaceCameraSnapshot(
    bitmap: ImageBitmap,
    requestRescan: boolean,
  ): void {
    if (
      this.disposed ||
      bitmap.width < 1 ||
      bitmap.height < 1 ||
      bitmap.width > 1920 ||
      bitmap.height > 1080
    )
      throw new NativeCameraError("unavailable");
    this.cameraSnapshot?.close();
    this.cameraSnapshot = bitmap;
    this.releaseCameraTexture();
    if (requestRescan) this.requestScan();
  }

  clearCameraSnapshot(): void {
    this.cameraSnapshot?.close();
    this.cameraSnapshot = null;
    this.releaseCameraTexture();
  }

  private releaseCameraTexture(): void {
    if (!this.cameraFrameTexture) return;
    this.textureRetirement.push(this.cameraFrameTexture.texture);
    this.cameraFrameTexture = null;
  }

  private hasCameraConsumer(): boolean {
    return [...this.mounts.values()].some((mount) => {
      if (mount.instance.enabled === false || mount.frozenReason) return false;
      const plan = planNativeInputResources(mount.definition, mount.instance);
      return (
        plan.ok &&
        [...plan.inputs.values()].some((input) => input.kind === "camera")
      );
    });
  }

  private cameraTexture(): GPUTexture {
    if (this.cameraFrameTexture?.epoch === this.renderEpoch)
      return this.cameraFrameTexture.texture;
    let source: HTMLVideoElement | ImageBitmap;
    try {
      source = this.cameraSnapshot ?? this.cameraSource.frame();
    } catch (error) {
      const state =
        error instanceof NativeCameraError ? error.code : "unavailable";
      throw new NativeSourceError(
        state === "permission-denied"
          ? "input-camera-permission-denied"
          : state === "stopped"
            ? "input-camera-stopped"
            : "input-camera-unavailable",
        `The camera input is ${state}.`,
      );
    }
    const width =
      source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const height =
      source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > Math.min(MAX_DIMENSION, 1920) ||
      height > Math.min(MAX_DIMENSION, 1080) ||
      width * height > MAX_PIXELS
    )
      throw new NativeSourceError(
        "input-camera-size",
        "The camera frame has unavailable or oversized dimensions.",
      );
    const device = this.device;
    if (!device)
      throw new NativeSourceError(
        "input-device-unavailable",
        "The WebGPU device is unavailable.",
      );
    if (
      this.cameraFrameTexture &&
      (this.cameraFrameTexture.device !== device ||
        this.cameraFrameTexture.texture.width !== width ||
        this.cameraFrameTexture.texture.height !== height)
    )
      this.releaseCameraTexture();
    if (!this.cameraFrameTexture) {
      this.ensureTextureBudget(width * height * 4);
      this.cameraFrameTexture = {
        texture: this.texture(width, height, "rgba8unorm-srgb"),
        device,
        epoch: -1,
      };
    }
    const frame = this.cameraFrameTexture;
    try {
      device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        {
          texture: frame.texture,
          premultipliedAlpha: false,
          colorSpace: "srgb",
        },
        [width, height],
      );
    } catch (error) {
      this.releaseCameraTexture();
      throw new NativeSourceError(
        "input-camera-upload",
        `The camera frame could not be uploaded: ${String(error)}`,
      );
    }
    frame.epoch = this.renderEpoch;
    return frame.texture;
  }

  private releaseReceiverGeometry(mount: Mount): void {
    const receiver = this.receiverGeometryCache.get(mount);
    if (!receiver) return;
    this.destroyTexture(receiver.geometry);
    this.destroyTexture(receiver.interior);
    this.destroyTexture(receiver.coverage);
    this.receiverGeometryCache.delete(mount);
  }

  private receiverInteriorBoxTexture(): GPUTexture {
    if (this.receiverInteriorBox) return this.receiverInteriorBox;
    const texture = this.texture(1, 1, "rgba16float");
    this.device!.queue.writeTexture(
      { texture },
      new Uint16Array(4),
      { bytesPerRow: 8 },
      [1, 1],
    );
    this.receiverInteriorBox = texture;
    return texture;
  }

  private async receiverGeometryTextures(mount: Mount, needsInterior = false) {
    if (!mount.provider)
      throw new NativeSourceError(
        "receiver-geometry-unavailable",
        "The receiver has no source provider.",
      );
    const captured = await mount.provider.readReceiverCoverage();
    let cached = this.receiverGeometryCache.get(mount);
    if (
      cached &&
      cached.epoch === this.deviceEpoch &&
      cached.source === captured.source &&
      cached.revision === captured.revision &&
      cached.cssWidth === captured.width &&
      cached.cssHeight === captured.height &&
      cached.geometryKind === captured.geometryKind &&
      (!needsInterior || cached.interior)
    )
      return cached;
    const coverageCanvas = document.createElement("canvas");
    coverageCanvas.width = captured.source.width;
    coverageCanvas.height = captured.source.height;
    const context = coverageCanvas.getContext("2d");
    if (!context)
      throw new NativeSourceError(
        "receiver-coverage-unavailable",
        "The receiver has no coverage raster context.",
      );
    context.drawImage(
      captured.source,
      0,
      0,
      (captured.source.width * captured.width) / captured.cssBox.width,
      (captured.source.height * captured.height) / captured.cssBox.height,
      0,
      0,
      coverageCanvas.width,
      coverageCanvas.height,
    );
    const ratio = Math.min(
      1,
      512 / Math.max(coverageCanvas.width, coverageCanvas.height),
    );
    const width = Math.max(1, Math.round(coverageCanvas.width * ratio));
    const height = Math.max(1, Math.round(coverageCanvas.height * ratio));
    const reduced = document.createElement("canvas");
    reduced.width = width;
    reduced.height = height;
    const reducedContext = reduced.getContext("2d", {
      willReadFrequently: true,
    });
    if (!reducedContext)
      throw new NativeSourceError(
        "receiver-coverage-unavailable",
        "The receiver has no distance raster context.",
      );
    reducedContext.drawImage(coverageCanvas, 0, 0, width, height);
    const rgba = reducedContext.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let index = 0; index < alpha.length; index += 1)
      alpha[index] = rgba[index * 4 + 3];
    const distanceChanged =
      !cached ||
      cached.epoch !== this.deviceEpoch ||
      cached.width !== width ||
      cached.height !== height ||
      cached.cssWidth !== captured.width ||
      cached.cssHeight !== captured.height ||
      cached.geometryKind !== captured.geometryKind ||
      alpha.some((value, index) => value !== cached!.alpha[index]);
    const coverageChanged =
      !cached ||
      cached.epoch !== this.deviceEpoch ||
      cached.coverage.width !== coverageCanvas.width ||
      cached.coverage.height !== coverageCanvas.height;
    const interiorChanged =
      needsInterior && (!cached?.interior || distanceChanged);
    if (coverageChanged || distanceChanged || interiorChanged)
      this.ensureCompositionBudget(
        mount,
        (coverageChanged
          ? coverageCanvas.width * coverageCanvas.height * 4
          : 0) +
          (distanceChanged ? width * height * 8 : 0) +
          (interiorChanged ? width * height * 8 : 0),
      );
    const coverage = coverageChanged
      ? this.texture(coverageCanvas.width, coverageCanvas.height, "rgba8unorm")
      : cached!.coverage;
    const geometry = distanceChanged
      ? this.texture(width, height, "rgba16float")
      : cached!.geometry;
    const interior = interiorChanged
      ? this.texture(width, height, "rgba16float")
      : distanceChanged
        ? undefined
        : cached?.interior;
    this.device!.queue.copyExternalImageToTexture(
      { source: coverageCanvas },
      { texture: coverage, premultipliedAlpha: false },
      [coverageCanvas.width, coverageCanvas.height],
    );
    if (distanceChanged || interiorChanged) {
      const fields = buildNativeReceiverFields(
        alpha,
        width,
        height,
        captured.width,
        captured.height,
        needsInterior,
      );
      if (distanceChanged)
        this.device!.queue.writeTexture(
          { texture: geometry },
          packNativeReceiverFloat16(fields.geometry),
          { bytesPerRow: width * 8 },
          [width, height],
        );
      if (interiorChanged)
        this.device!.queue.writeTexture(
          { texture: interior! },
          packNativeReceiverFloat16(fields.interior!),
          { bytesPerRow: width * 8 },
          [width, height],
        );
    }
    if (cached) {
      if (geometry !== cached.geometry)
        this.textureRetirement.push(cached.geometry);
      if (coverage !== cached.coverage)
        this.textureRetirement.push(cached.coverage);
      if (interior !== cached.interior && cached.interior)
        this.textureRetirement.push(cached.interior);
    }
    cached = {
      source: captured.source,
      revision: captured.revision,
      epoch: this.deviceEpoch,
      width,
      height,
      cssWidth: captured.width,
      cssHeight: captured.height,
      geometryKind: captured.geometryKind,
      alpha,
      geometry,
      interior,
      coverage,
    };
    this.receiverGeometryCache.set(mount, cached);
    return cached;
  }

  private async effectInputTextures(
    mount: Mount,
    source: GPUTexture,
    time: number,
    encoder: GPUCommandEncoder,
    definition: EffectDefinition,
    instance: EffectInstance,
    deterministic: boolean,
    dependencies?: { complete: Set<string>; active: Set<string> },
  ) {
    const inputPlan = planNativeInputResources(definition, instance);
    if (!inputPlan.ok)
      throw new NativeSourceError(inputPlan.code, inputPlan.detail);
    for (const resource of [...mount.authoredInputs.keys()])
      if (inputPlan.inputs.get(resource)?.kind !== "authored-node")
        this.releaseAuthoredInput(mount, resource);
    const resources = new Map<string, GPUTexture>();
    const receiverGeometryRequested = [...inputPlan.inputs.values()].some(
      (binding) =>
        binding.kind === "builtin" && binding.source === "receiver-geometry",
    );
    const receiverInteriorRequested = [...inputPlan.inputs.values()].some(
      (binding) =>
        binding.kind === "builtin" && binding.source === "receiver-interior",
    );
    const svgInterior =
      receiverInteriorRequested && mount.target instanceof SVGSVGElement;
    const receiverGeometry =
      receiverGeometryRequested || svgInterior
        ? await this.receiverGeometryTextures(mount, svgInterior)
        : null;
    if (!receiverGeometry) this.releaseReceiverGeometry(mount);
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
      else if (binding.kind === "camera") input = this.cameraTexture();
      else if (binding.kind === "fallback") input = this.transparent!;
      else if (binding.kind === "authored-node") {
        if (!dependencies)
          throw new NativeSourceError(
            "input-authored-context-unavailable",
            "The authored input has no render dependency context.",
          );
        input = await this.authoredInputTexture(
          mount,
          name,
          binding,
          time,
          deterministic,
          encoder,
          dependencies.complete,
          dependencies.active,
        );
      } else if (binding.source === "receiver-geometry") {
        if (!receiverGeometry)
          throw new NativeSourceError(
            "receiver-geometry-unavailable",
            "The requested receiver geometry was not captured.",
          );
        input = receiverGeometry.geometry;
      } else if (binding.source === "receiver-interior") {
        input = svgInterior
          ? (receiverGeometry?.interior ??
            (() => {
              throw new NativeSourceError(
                "receiver-interior-unavailable",
                "The requested receiver interior was not captured.",
              );
            })())
          : this.receiverInteriorBoxTexture();
      } else if (binding.source === "mask") {
        input =
          receiverGeometry?.coverage ?? (await this.inputMask(mount, encoder));
        mount.inputMaskUsedFrame = this.renderEpoch;
      } else input = source;
      resources.set(name, input);
    }
    if (!resources.has("source")) resources.set("source", source);
    return { resources, inputPlan };
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
    dependencies?: { complete: Set<string>; active: Set<string> },
    sourceRecords?: readonly NativeSourceRecord[],
  ): Promise<GPUTexture> {
    assertNativeUniformTiming(time, "time");
    assertNativeUniformTiming(instance.timing.time, "initial-time");
    assertNativeUniformTiming(instance.timing.speed, "speed");
    if (instance.animation)
      instance = {
        ...instance,
        params: resolveNativeParameterAnimation(
          definition,
          instance.params,
          instance.animation,
          time,
        ),
      };
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
    let backendSource = source;
    let backendSourceRevision = sourceRevision;
    let backendSourceIdentity = "builtin:source";
    let backendSourceReplaySafety: "immutable" | "dynamic" | "unknown" =
      "unknown";
    let statefulSource: GPUTexture | null = source;
    let statefulExternalTextures: ReadonlyMap<string, GPUTexture> | undefined;
    let statefulInputEpochs: ReadonlyMap<string, number | null> | undefined;
    if (
      definition.resourceGraph?.abi === "stateful-resource-v2" ||
      definition.resourceGraph?.abi === "stateful-resource-v3"
    ) {
      const names = (definition.resources ?? [])
        .filter((resource) => resource.external)
        .map((resource) => resource.name)
        .sort();
      const resolved = names.length
        ? await this.effectInputTextures(
            mount,
            source,
            time,
            encoder,
            definition,
            instance,
            deterministic,
            dependencies,
          )
        : null;
      const textures = new Map<string, GPUTexture>();
      const epochs = new Map<string, number | null>();
      const pendingEpochs = new Map<
        string,
        { capture: AuthoredInputCapture; sourceEpoch: number }
      >();
      const identities: unknown[][] = [];
      const revisions: unknown[][] = [];
      let replaySafety: "immutable" | "dynamic" | "unknown" = "immutable";
      for (const name of names) {
        const binding = resolved?.inputPlan.inputs.get(name);
        const texture = resolved?.resources.get(name);
        if (!binding || !texture)
          throw new NativeSourceError(
            "pass-input-missing",
            `Stateful input ${name} has no resolved texture.`,
          );
        textures.set(name, texture);
        let identity: string;
        let revision: string;
        let epoch: number | null = null;
        let safety: "immutable" | "dynamic" | "unknown" = "unknown";
        if (binding.kind === "asset") {
          identity = `asset:${binding.url}`;
          revision = JSON.stringify(binding);
          safety = "immutable";
        } else if (binding.kind === "authored-node") {
          const capture = mount.authoredInputs.get(name);
          if (!capture || capture.capturedSourceEpoch === null)
            throw new NativeSourceError(
              "input-authored-source-stale",
              `Authored input ${binding.nodeId} has no captured revision.`,
            );
          identity = `authored:${binding.nodeId}:${binding.capture}`;
          epoch = capture.capturedSourceEpoch;
          revision = `${identity}:${epoch}`;
          safety = capture.replaySafety;
          pendingEpochs.set(name, { capture, sourceEpoch: epoch });
        } else if (binding.kind === "camera") {
          if (deterministic)
            throw new NativeSourceError(
              "stateful-source-history-unavailable",
              "A live camera cannot replay deterministic source history.",
            );
          if (this.cameraFrameTexture?.epoch !== this.renderEpoch)
            throw new NativeSourceError(
              "input-camera-frame-unavailable",
              "The selected camera frame is unavailable.",
            );
          identity = "camera";
          revision = `camera:${this.renderEpoch}`;
          safety = "dynamic";
        } else if (binding.kind === "fallback") {
          identity = "fallback:transparent-data";
          revision = identity;
          safety = "immutable";
        } else {
          identity = `builtin:${binding.source}`;
          revision = `${identity}:${sourceRevision}`;
          if (binding.source !== "mask" && mount.provider && sourceRecords)
            safety = await mount.provider.replaySafety(sourceRecords);
        }
        epochs.set(name, epoch);
        identities.push([name, identity, texture.width, texture.height]);
        revisions.push([name, revision]);
        if (safety === "dynamic") replaySafety = "dynamic";
        else if (safety === "unknown" && replaySafety === "immutable")
          replaySafety = "unknown";
      }
      mount.pendingGraphInputEpochs = pendingEpochs;
      statefulExternalTextures = textures;
      statefulInputEpochs = epochs;
      statefulSource = textures.get("source") ?? null;
      backendSourceIdentity = names.length
        ? JSON.stringify(identities)
        : JSON.stringify([
            "source-free",
            definition.id,
            definition.version,
            this.draft?.showDraft &&
            this.draft.instanceId === instance.id &&
            this.draft.definition === definition
              ? this.draft.executionHash
              : mount.definitionHash,
            instance.id,
            instance.seed,
            mount.width,
            mount.height,
            (definition.resourceGraph.resetProperties ?? []).map((name) => [
              name,
              instance.params[name] ?? definition.properties[name]?.default,
            ]),
          ]);
      backendSourceRevision = names.length
        ? JSON.stringify(revisions)
        : backendSourceIdentity;
      backendSourceReplaySafety = replaySafety;
    }
    if (
      definition.statelessCompute ||
      definition.simulation ||
      definition.feedback ||
      definition.resourceGraph?.abi === "stateful-resource-v1"
    ) {
      const planned = planNativeInputResources(definition, instance);
      if (!planned.ok)
        throw new NativeSourceError(planned.code, planned.detail);
      const binding = planned.inputs.get("source");
      if (
        planned.inputs.size > 1 ||
        (planned.inputs.size === 1 && !binding) ||
        (planned.inputs.size === 0 && !definition.simulation)
      )
        throw new NativeSourceError(
          "input-backend-multiple-unsupported",
          "This compute backend needs one resolved source texture.",
        );
      if (binding) {
        const inputs = await this.effectInputTextures(
          mount,
          source,
          time,
          encoder,
          definition,
          instance,
          deterministic,
          dependencies,
        );
        const selected = inputs.resources.get("source");
        if (!selected)
          throw new NativeSourceError(
            "pass-input-missing",
            "The selected source texture is unavailable.",
          );
        backendSource = selected;
        if (binding.kind === "asset") {
          backendSourceIdentity = `asset:${binding.url}`;
          backendSourceRevision = `asset:${binding.url}`;
          backendSourceReplaySafety = "immutable";
        } else if (binding.kind === "camera") {
          backendSourceIdentity = "camera";
          backendSourceReplaySafety = "dynamic";
          const epoch = this.cameraFrameTexture?.epoch;
          if (epoch !== this.renderEpoch)
            throw new NativeSourceError(
              "input-camera-frame-unavailable",
              "The selected camera frame is unavailable.",
            );
          backendSourceRevision = `camera:${epoch}`;
        } else if (binding.kind === "authored-node") {
          backendSourceIdentity = `authored:${binding.nodeId}:${binding.capture}`;
          const capture = mount.authoredInputs.get("source");
          if (!capture || capture.capturedSourceEpoch === null)
            throw new NativeSourceError(
              "input-authored-source-stale",
              `Authored input ${binding.nodeId} has no captured source revision.`,
            );
          mount.pendingGraphInputEpochs = new Map([
            ["source", { capture, sourceEpoch: capture.capturedSourceEpoch }],
          ]);
          backendSourceRevision = `authored:${binding.nodeId}:${binding.capture}:${capture.capturedSourceEpoch}`;
          backendSourceReplaySafety = capture.replaySafety;
        } else if (binding.kind === "fallback") {
          backendSourceIdentity = "fallback:transparent-data";
          backendSourceRevision = "fallback:transparent-data";
          backendSourceReplaySafety = "immutable";
        } else backendSourceIdentity = `builtin:${binding.source}`;
      }
    }
    if (
      backendSourceIdentity.startsWith("builtin:") &&
      definition.resourceGraph?.abi === "stateful-resource-v1" &&
      definition.resourceGraph.sourceHistory === "sequential-captures" &&
      mount.provider &&
      sourceRecords
    )
      backendSourceReplaySafety =
        await mount.provider.replaySafety(sourceRecords);
    if (definition.statelessCompute)
      return this.statelessComputePasses(
        mount,
        backendSource,
        time,
        encoder,
        definition,
        instance,
        deterministic,
      );
    if (isStatefulResourceGraph(definition.resourceGraph))
      return this.statefulResourcePasses(
        mount,
        definition.resourceGraph.abi === "stateful-resource-v1"
          ? backendSource
          : statefulSource,
        time,
        encoder,
        definition,
        instance,
        backendSourceRevision,
        deterministic,
        backendSourceIdentity,
        backendSourceReplaySafety,
        statefulExternalTextures,
        statefulInputEpochs,
      );
    if (definition.resourceGraph)
      return this.linearResourcePasses(
        mount,
        source,
        time,
        encoder,
        definition,
        instance,
        deterministic,
        dependencies,
      );
    if (definition.simulation)
      return this.simulationPasses(
        mount,
        backendSource,
        time,
        encoder,
        definition,
        instance,
        deterministic,
      );
    if (definition.feedback)
      return this.feedbackPasses(
        mount,
        backendSource,
        time,
        encoder,
        definition,
        instance,
        backendSourceRevision,
        deterministic,
        backendSourceIdentity,
      );
    if (usesRetiredNativeImageAbi(definition, instance))
      throw new NativeSourceError(
        "legacy-image-abi-retired",
        "This saved image-sampling contract remains readable but is not executable.",
      );
    const plan = planEffectGraph(definition);
    if (plan.errors.length) throw new Error(plan.errors.join("; "));
    const { resources, inputPlan } = await this.effectInputTextures(
      mount,
      source,
      time,
      encoder,
      definition,
      instance,
      deterministic,
      dependencies,
    );
    const dpr = mount.pixelRatio;
    let resourceBytes = 0;
    for (const pass of plan.passes) {
      if (
        pass.kind !== "render" ||
        pass.reads.length > 16 ||
        pass.previousFrameReads?.length
      )
        throw new Error(
          `Pass ${pass.id} requires unsupported compute, temporal, or more than sixteen texture inputs.`,
        );
      const readName = pass.reads[0];
      const input = readName ? resources.get(readName) : this.white;
      if (!input)
        throw new NativeSourceError(
          "pass-input-missing",
          `Pass ${pass.id} has no texture for ${readName ?? "its unused GPU binding"}.`,
        );
      const otherInputs = pass.reads.slice(1).map((name) => {
        const texture = resources.get(name);
        if (!texture)
          throw new NativeSourceError(
            "pass-input-missing",
            `Pass ${pass.id} has no texture for ${name}.`,
          );
        return texture;
      });
      const second = otherInputs[0] ?? this.white!;
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
        pipeline = await this.pipeline(
          pass.wgsl,
          format,
          false,
          true,
          pass.reads.length,
          instance.placement,
        );
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
      data.set(
        this.packPointerForTime(
          mount,
          definition,
          instance.params,
          time,
          deterministic,
        ),
        8,
      );
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
        null,
        otherInputs.slice(1),
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
    if (!(mount.target instanceof HTMLElement))
      throw new NativeSourceError(
        "source-inline-svg",
        "An SVG Fill uses vector paint coverage rather than a text mask.",
      );
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
      const dpr =
        mount.width /
        Math.max(1, nativePresentationTargetLayout(mount.target).width);
      const serialized = new XMLSerializer().serializeToString(clone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mount.width}" height="${mount.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${nativePresentationTargetLayout(mount.target).width}px;height:${nativePresentationTargetLayout(mount.target).height}px;transform:scale(${dpr});transform-origin:0 0">${serialized}</div></foreignObject></svg>`;
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
      cssPixelScale:
        mount.width /
        Math.max(1, nativePresentationTargetLayout(mount.target).width),
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
    const opacity = backdropReplacement ? 1 : instance.opacity;
    const identity = [1, 0, 0, 0, 0, 1, 0, 0];
    if (
      opacity === 1 &&
      instance.clip !== "text" &&
      mask === this.white &&
      radii.every((radius) => radius === 0) &&
      transform.rows
        .flat()
        .every((value, index) => value === identity[index]) &&
      source.width === mount.width &&
      source.height === mount.height &&
      source.format === this.workingFormat
    )
      return source;
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
        opacity,
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
    if (
      output &&
      output !== mount.outputTexture &&
      !inputs.includes(output) &&
      output.width === mount.width &&
      output.height === mount.height
    )
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

  private async compositeFillPresentation(
    mount: Mount,
    children: GPUTexture,
    fill: GPUTexture,
    extent: NativeEffectExtentPlan,
    encoder: GPUCommandEncoder,
    fillOnTop = false,
    outputName = "__native_final_back",
  ): Promise<GPUTexture> {
    if (
      children.width !== extent.width ||
      children.height !== extent.height ||
      fill.width !== mount.width ||
      fill.height !== mount.height ||
      !mount.outputExtent
    )
      throw new NativeSourceError(
        "fill-presentation-size-mismatch",
        "The Fill foreground and generated box do not match their planned extents.",
      );
    this.ensureCompositionBudget(
      mount,
      extent.width *
        extent.height *
        (this.workingFormat === "rgba16float" ? 8 : 4),
    );
    const output = this.acquireFillOutput(
      { ...mount, width: extent.width, height: extent.height },
      outputName,
      [children, fill],
    );
    const pipeline = await this.pipeline(
      fillPresentationWgsl,
      this.workingFormat,
    );
    const bind = this.bind(
      mount,
      "fill-presentation",
      pipeline,
      children,
      fill,
      new Float32Array([
        extent.width,
        extent.height,
        this.colorPresented === "srgb" && this.dynamicRangePresented === "sdr"
          ? 1
          : 0,
        0,
        extent.left - mount.outputExtent.left,
        extent.top - mount.outputExtent.top,
        fillOnTop ? 1 : 0,
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
    mount: NativePresentationTarget,
    device: GPUDevice,
    dimensions: { width: number; height: number } = mount as Mount,
  ): {
    pair: NativePresentationPair<GPUCanvasContext>;
    front: { canvas: HTMLCanvasElement; context: GPUCanvasContext };
    spare: { canvas: HTMLCanvasElement; context: GPUCanvasContext };
  } {
    const newPair = !mount.presentationPair;
    if (newPair) {
      this.ensureTextureBudget(dimensions.width * dimensions.height * 8);
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
        mount.instance?.id === REVIEWED_LOCAL_RUNTIME_TARGET?.instanceId;
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
      new Float32Array([source.width, source.height, 0, 0, 1, 0, 0, 0]),
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
        [source.width, source.height, 1],
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

  private nestedBackdropOwner(target: Element): Mount | null {
    const owners = [...this.mounts.values()].filter(
      (candidate) =>
        (candidate.instance.placement === "layer" ||
          (candidate.instance.placement === "fill" && candidate.isTopLayer)) &&
        candidate.target !== target &&
        candidate.target.contains(target),
    );
    if (
      owners.filter((candidate) => candidate.instance.placement === "layer")
        .length > 1
    )
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    const nearest = owners.find((candidate) =>
      owners.every(
        (other) =>
          other === candidate || other.target.contains(candidate.target),
      ),
    );
    if (owners.length && !nearest)
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    return nearest ?? null;
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
    const resources = new NativeFrameResourceScratch(
      child.resourceTextures,
      child.definition.simulation ? [...child.resourceTextures.keys()] : [],
    );
    child.resourceTextures = resources.scratch;
    let staged = false;
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
      const childDeterministic = this.mountDeterministicTime(
        child,
        transaction.deterministic,
      );
      const childTime = childDeterministic
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
        childDeterministic,
        `group-local:${parent.instance.id}:${this.renderEpoch}`,
        { complete: transaction.complete, active: transaction.active },
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
      const authoredEpoch = child.provider?.authoredSourceEpoch?.();
      if (authoredEpoch !== undefined)
        transaction.authoredEpochs.set(child.instance.id, authoredEpoch);
      if (child.definition.resourceGraph && !child.pendingGraphInputEpochs)
        throw new NativeSourceError(
          "linear-resource-frame-invalid",
          "The nested graph input revision is unavailable.",
        );
      transaction.staged.set(child.instance.id, {
        mount: child,
        texture: finished,
        resources,
        simulationFrame: child.simulationFrame ?? undefined,
        statefulFrame: child.statefulFrame ?? undefined,
        feedbackFrame: child.feedbackFrame ?? undefined,
        sourceEpoch: child.provider?.sourceEpoch?.() ?? null,
        instancePayload: JSON.stringify(child.instance),
        definitionHash: child.definitionHash,
        localTime: childTime,
        inputEpochs: new Map(child.pendingGraphInputEpochs ?? []),
      });
      child.simulationFrame = null;
      child.statefulFrame = null;
      child.feedbackFrame = null;
      staged = true;
      return finished;
    } finally {
      child.resourceTextures = resources.committed;
      if (!staged) {
        const simulationFrame = child.simulationFrame;
        child.simulationFrame = null;
        if (simulationFrame) {
          try {
            await simulationFrame.transaction.abandon();
          } finally {
            if (simulationFrame.state !== child.simulation)
              this.retireSimulationState(simulationFrame.state);
          }
        }
        child.statefulFrame?.abandon();
        child.statefulFrame = null;
        child.feedbackFrame?.abandon();
        child.feedbackFrame = null;
        const feedbackCandidate = child.feedbackCandidate;
        child.feedbackCandidate = null;
        if (feedbackCandidate) await this.disposeFeedback(feedbackCandidate);
        child.statefulCandidate?.executor.dispose();
        child.statefulCandidate = null;
        for (const texture of resources.rollback())
          if (!this.textureRetirement.includes(texture))
            this.textureRetirement.push(texture);
      }
      if (!staged) child.pendingGraphInputEpochs = null;
      transaction.active.delete(child.instance.id);
    }
  }

  private async stageFillLocalBackdrop(
    parent: Mount,
    child: Mount,
    prefix: GPUTexture,
    prefixExtent: NativeEffectExtentPlan,
    encoder: GPUCommandEncoder,
    transaction: NestedBackdropTransaction,
    authoredSourceEpoch: number,
  ): Promise<GPUTexture> {
    const ancestor = parent.target;
    if (!(ancestor instanceof HTMLElement))
      throw new NativeSourceError(
        "source-inline-svg",
        "An SVG Fill cannot contain a nested HTML Backdrop.",
      );
    if (
      this.mounts.get(child.instance.id) !== child ||
      this.mounts.get(parent.instance.id) !== parent ||
      !parent.isTopLayer ||
      !transaction.active.has(parent.instance.id) ||
      this.nestedBackdropOwner(child.target) !== parent ||
      child.instance.placement !== "backdrop" ||
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
      transaction.active.has(child.instance.id) ||
      transaction.staged.has(child.instance.id)
    )
      throw new NativeSourceError(
        "effect-dependency-cycle",
        "effect-dependency-cycle",
      );
    const resources = new NativeFrameResourceScratch(
      child.resourceTextures,
      child.definition.simulation ? [...child.resourceTextures.keys()] : [],
    );
    child.resourceTextures = resources.scratch;
    let staged = false;
    transaction.active.add(child.instance.id);
    try {
      if (!child.provider)
        throw new NativeSourceError(
          "source-provider-unavailable",
          "source-provider-unavailable",
        );
      const records = await child.provider.readScene(
        undefined,
        "mount-source",
        {
          ancestor,
          instanceId: parent.instance.id,
          width: prefix.width,
          height: prefix.height,
          localBox: {
            x: -prefixExtent.left / prefixExtent.pixelRatio,
            y: -prefixExtent.top / prefixExtent.pixelRatio,
            width: prefixExtent.width / prefixExtent.pixelRatio,
            height: prefixExtent.height / prefixExtent.pixelRatio,
          },
          revision: this.renderEpoch,
          authoredSourceEpoch,
          unpublished:
            parent.target.getAttribute("data-an-native-fill-instance") === null,
        },
      );
      if (
        child.provider.authoredSourceEpoch?.() !== authoredSourceEpoch ||
        records.filter(
          (record) =>
            record.sourceRole === "ancestor-fill-prefix" &&
            record.nativeInstanceId === parent.instance.id,
        ).length !== 1 ||
        records.some(
          (record) =>
            record.sourceRole === "ancestor-fill-prefix" &&
            record.nativeInstanceId !== parent.instance.id,
        )
      )
        throw new NativeSourceError("source-epoch-stale", "source-epoch-stale");
      const overrides = new Map([[parent.instance.id, prefix]]);
      for (const [id, staged] of transaction.staged)
        overrides.set(id, staged.texture);
      for (const record of records) {
        if (
          !record.nativeInstanceId ||
          record.sourceRole === "ancestor-fill-prefix"
        )
          continue;
        const dependency = this.mounts.get(record.nativeInstanceId);
        if (!dependency || dependency === parent || dependency === child)
          throw new NativeSourceError(
            "source-group-local-chain-unsupported",
            "source-group-local-chain-unsupported",
          );
        if (this.nestedBackdropOwner(dependency.target) === parent) {
          if (!overrides.has(dependency.instance.id))
            throw new NativeSourceError(
              "source-group-local-chain-unsupported",
              "source-group-local-chain-unsupported",
            );
          continue;
        }
        await this.renderMount(
          dependency,
          transaction.time,
          transaction.deterministic,
          transaction.complete,
          transaction.active,
        );
      }
      const source = records.length
        ? await this.composeScene(
            child,
            records,
            encoder,
            "__native_fill_local_source",
            this.colorPresented === "srgb" &&
              this.dynamicRangePresented === "sdr" &&
              records.length > 1
              ? "srgb-css-linear"
              : "linear",
            undefined,
            overrides,
          )
        : this.transparent!;
      const childDeterministic = this.mountDeterministicTime(
        child,
        transaction.deterministic,
      );
      const childTime = childDeterministic
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
        childDeterministic,
        `fill-local:${parent.instance.id}:${this.renderEpoch}`,
        { complete: transaction.complete, active: transaction.active },
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
      transaction.authoredEpochs.set(child.instance.id, authoredSourceEpoch);
      if (child.definition.resourceGraph && !child.pendingGraphInputEpochs)
        throw new NativeSourceError(
          "linear-resource-frame-invalid",
          "The nested graph input revision is unavailable.",
        );
      transaction.staged.set(child.instance.id, {
        mount: child,
        texture: finished,
        resources,
        simulationFrame: child.simulationFrame ?? undefined,
        statefulFrame: child.statefulFrame ?? undefined,
        feedbackFrame: child.feedbackFrame ?? undefined,
        sourceEpoch: child.provider.sourceEpoch?.() ?? null,
        instancePayload: JSON.stringify(child.instance),
        definitionHash: child.definitionHash,
        localTime: childTime,
        inputEpochs: new Map(child.pendingGraphInputEpochs ?? []),
      });
      child.simulationFrame = null;
      child.statefulFrame = null;
      child.feedbackFrame = null;
      staged = true;
      return finished;
    } finally {
      child.resourceTextures = resources.committed;
      if (!staged) {
        const simulationFrame = child.simulationFrame;
        child.simulationFrame = null;
        if (simulationFrame) {
          try {
            await simulationFrame.transaction.abandon();
          } finally {
            if (simulationFrame.state !== child.simulation)
              this.retireSimulationState(simulationFrame.state);
          }
        }
        child.statefulFrame?.abandon();
        child.statefulFrame = null;
        child.feedbackFrame?.abandon();
        child.feedbackFrame = null;
        const feedbackCandidate = child.feedbackCandidate;
        child.feedbackCandidate = null;
        if (feedbackCandidate) await this.disposeFeedback(feedbackCandidate);
        child.statefulCandidate?.executor.dispose();
        child.statefulCandidate = null;
        for (const texture of resources.rollback())
          if (!this.textureRetirement.includes(texture))
            this.textureRetirement.push(texture);
      }
      if (!staged) child.pendingGraphInputEpochs = null;
      transaction.active.delete(child.instance.id);
    }
  }

  private mountDeterministicTime(
    mount: Mount,
    deterministic: boolean,
  ): boolean {
    return this.scopedDraftTimeInstanceId
      ? this.scopedDraftTimeInstanceId === mount.instance.id
      : deterministic;
  }

  private async renderStatelessFrameMount(
    mount: Mount,
    time: number,
    deterministic: boolean,
    complete: Set<string>,
    active: Set<string>,
  ): Promise<void> {
    const frame = this.frameTransaction!;
    if (active.has(mount.instance.id))
      throw new NativeSourceError(
        "effect-dependency-cycle",
        "effect-dependency-cycle",
      );
    if (frame.candidates.has(mount.instance.id)) return;
    const existing = frame.jobs.get(mount.instance.id);
    if (existing) {
      await existing.submitted;
      if (!frame.candidates.has(mount.instance.id)) {
        const outcome = await existing.outcome;
        if (outcome.status === "rejected") throw outcome.reason;
        throw new NativeSourceError(
          "native-dependency-missing",
          "A prepared native dependency has no candidate output.",
        );
      }
      return;
    }
    frame.transaction.register(mount.instance.id);
    let release!: () => void;
    const submitted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = Promise.resolve()
      .then(() =>
        this.renderMount(mount, time, deterministic, complete, active, release),
      )
      .finally(release);
    const outcome = task.then<
      PromiseSettledResult<void>,
      PromiseSettledResult<void>
    >(
      () => ({ status: "fulfilled", value: undefined }),
      (error) => {
        frame.transaction.fail(mount.instance.id, error);
        return { status: "rejected", reason: error };
      },
    );
    frame.jobs.set(mount.instance.id, { submitted, outcome });
    await submitted;
    if (!frame.candidates.has(mount.instance.id)) {
      const result = await outcome;
      if (result.status === "rejected") throw result.reason;
      throw new NativeSourceError(
        "native-dependency-missing",
        "The prepared native frame has no candidate output.",
      );
    }
  }

  private async renderMount(
    mount: Mount,
    time: number,
    deterministic: boolean,
    complete: Set<string>,
    active: Set<string>,
    onSubmitted?: () => void,
  ): Promise<void> {
    if (this.frameTransaction && !onSubmitted)
      return this.renderStatelessFrameMount(
        mount,
        time,
        deterministic,
        complete,
        active,
      );
    if (active.has(mount.instance.id))
      throw new NativeSourceError(
        "effect-dependency-cycle",
        "effect-dependency-cycle",
      );
    const pending = this.submissionPipeline?.pending(mount.instance.id);
    if (pending && !onSubmitted) {
      await pending;
      if (!complete.has(mount.instance.id))
        throw new NativeSourceError(
          "native-dependency-missing",
          "A submitted native dependency did not commit.",
        );
      return;
    }
    mount.retainedPresentationWitness = false;
    deterministic = this.mountDeterministicTime(mount, deterministic);
    if (complete.has(mount.instance.id)) return;
    if (mount.instance.placement === "backdrop") {
      const enclosingOwner = this.nestedBackdropOwner(mount.target);
      if (enclosingOwner) {
        if (mount.frozenReason)
          throw new NativeSourceError(
            mount.frozenReason.code,
            mount.frozenReason.message,
          );
        if (active.has(enclosingOwner.instance.id))
          throw new NativeSourceError(
            "effect-dependency-cycle",
            "effect-dependency-cycle",
          );
        await this.renderMount(
          enclosingOwner,
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
    const priorPresentation = {
      output: mount.outputTexture,
      width: mount.width,
      height: mount.height,
      canvas: mount.canvas,
      target: mount.target,
      suppressed: mount.suppressed,
      fillInstance: mount.target.getAttribute("data-an-native-fill-instance"),
      visibility: mount.canvas.style.visibility,
    };
    const publishedSimulationOutput = activeDefinition.simulation
      ? mount.outputTexture
      : null;
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
    if (!mount.provider)
      throw new NativeSourceError(
        "source-provider-unavailable",
        "The native source provider is unavailable.",
      );
    this.layout(mount);
    this.activeMounts.add(mount);
    mount.provider?.setDensity(mount.pixelRatio);
    const sourceAuthoredEpoch = mount.provider.authoredSourceEpoch?.();
    const nestedChildren =
      mount.instance.placement === "layer" ||
      (mount.instance.placement === "fill" && mount.isTopLayer)
        ? [...this.mounts.values()].filter(
            (candidate) =>
              candidate.instance.placement === "backdrop" &&
              this.hasPresentationGeometry(candidate.target) &&
              candidate.target !== mount.target &&
              mount.target.contains(candidate.target) &&
              this.nestedBackdropOwner(candidate.target) === mount,
          )
        : [];
    for (const child of nestedChildren) {
      if (child.frozenReason)
        throw new NativeSourceError(
          child.frozenReason.code,
          child.frozenReason.message,
        );
      if (this.nestedBackdropOwner(child.target) !== mount)
        throw new NativeSourceError(
          "source-group-local-chain-unsupported",
          "source-group-local-chain-unsupported",
        );
    }
    if (
      nestedChildren.length &&
      mount.instance.placement === "layer" &&
      (mount.previousLayerId ||
        mount.previousFillId ||
        mount.definition.simulation ||
        mount.definition.feedback)
    )
      throw new NativeSourceError(
        "source-group-local-chain-unsupported",
        "source-group-local-chain-unsupported",
      );
    const nestedRetainedChild = nestedChildren.some(
      (child) =>
        !!child.definition.simulation ||
        isStatefulResourceGraph(child.definition.resourceGraph) ||
        !!child.definition.feedback,
    );
    if (
      nestedRetainedChild &&
      mount.instance.placement === "layer" &&
      (!mount.isTopLayer || draft)
    )
      throw new NativeSourceError(
        "source-group-local-effect-unsupported",
        "source-group-local-effect-unsupported",
      );
    if (nestedChildren.length) {
      for (const child of nestedChildren) {
        this.layout(child);
        child.provider?.setDensity(child.pixelRatio);
      }
    }
    mount.provider.setGroupLocalBackdropSource(nestedChildren.length > 0);
    let layerScene: NativeSourceRecord[] | null = null;
    if (mount.instance.placement === "layer" && !mount.previousLayerId) {
      const sourceStarted = performance.now();
      const visible = await mount.provider.readLayerVisibleScene();
      sourceWallMs += performance.now() - sourceStarted;
      layerScene = visible.records;
      this.layout(mount, visible.captureInsets);
      mount.provider.setDensity(mount.pixelRatio);
      mount.provider.layerVisiblePaintInsets(layerScene);
    }
    const assertCaptureOriginCurrent = (): void => {
      const current = layerScene
        ? mount.provider!.layerVisiblePaintInsets(layerScene)
        : nativeTargetOverflowInsets(
            mount.target,
            mount.instance.placement === "layer",
          );
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
    const device = this.device!;
    const deviceEpoch = this.deviceEpoch;
    const renderEpoch = this.renderEpoch;
    const instance = mount.instance;
    const definition = mount.definition;
    const presentationWidth = mount.width;
    const presentationHeight = mount.height;
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
    const restorePublishedOutput = async (
      output: GPUTexture,
    ): Promise<void> => {
      assertCurrentPresentation();
      if (
        !visibleLayoutUnchanged ||
        mount.canvas.style.cssText !== visibleStyleBeforeLayout ||
        output.width !== presentationWidth ||
        output.height !== presentationHeight ||
        mount.canvas !== priorPresentation.canvas ||
        mount.target !== priorPresentation.target ||
        mount.suppressed !== priorPresentation.suppressed ||
        mount.width !== presentationWidth ||
        mount.height !== presentationHeight ||
        mount.canvas.width !== presentationWidth ||
        mount.canvas.height !== presentationHeight
      )
        throw new NativeSourceError(
          "presentation-frame-stale",
          "The native presentation extent changed before restoration.",
        );
      device.pushErrorScope("validation");
      let restoreError: unknown;
      let restoreFailed = false;
      try {
        const recovery = device.createCommandEncoder();
        await this.present(mount, output, recovery);
        assertCurrentPresentation();
        device.queue.submit([recovery.finish()]);
      } catch (error) {
        restoreFailed = true;
        restoreError = error;
      }
      const validationError = await device.popErrorScope();
      if (restoreFailed) throw restoreError;
      if (validationError)
        throw new NativeSourceError(
          "gpu-validation",
          `WebGPU rejected restored effect ${mount.instance.id}: ${validationError.message}`,
        );
      await device.queue.onSubmittedWorkDone();
      assertCurrentPresentation();
      if (
        !visibleLayoutUnchanged ||
        mount.canvas.style.cssText !== visibleStyleBeforeLayout ||
        mount.width !== presentationWidth ||
        mount.height !== presentationHeight ||
        mount.canvas !== priorPresentation.canvas ||
        mount.target !== priorPresentation.target ||
        mount.suppressed !== priorPresentation.suppressed ||
        mount.canvas.width !== presentationWidth ||
        mount.canvas.height !== presentationHeight
      )
        throw new NativeSourceError(
          "presentation-frame-stale",
          "The native presentation extent changed during restoration.",
        );
      mount.retainedPresentationWitness = true;
    };
    let scopeOpen = !this.frameTransaction;
    if (scopeOpen) device.pushErrorScope("validation");
    let profiledEncoder: GPUCommandEncoder | null = null;
    let gpuSample: NativeGpuScopedSample | null = null;
    let profileSubmitted = false;
    let submitted = false;
    let gpuValidated = false;
    let releaseSubmissionCommit: (() => void) | undefined;
    let restorationAttempted = false;
    let detachedFillPresentation = false;
    let activePresentationPair: NativePresentationPair<GPUCanvasContext> | null =
      null;
    let priorOutputRetirement: GPUTexture | null = null;
    let fillNativeChildren = new Set<string>();
    let frameResources: NativeFrameResourceScratch<GPUTexture> | null = null;
    let simulationFrameResources = false;
    let publishedDraftResources: Map<string, GPUTexture> | null = null;
    let mirrorCandidate: GPUTexture | null = null;
    let unpublishedLayerState: {
      outputTexture: GPUTexture | null;
      fillTextTexture: GPUTexture | null;
      fillUnderlayTexture: GPUTexture | null;
      fillPhaseTexture: GPUTexture | null;
      fillBorderTexture: GPUTexture | null;
      fillOuterCoverageTexture: GPUTexture | null;
      fillInnerCoverageTexture: GPUTexture | null;
      fillPresentationExtent: NativeEffectExtentPlan | null;
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
            complete,
            staged: new Map(),
            authoredEpochs: new Map(),
            noncontributing: new Set(),
          }
        : undefined;
    const statelessFrame =
      !!(draft?.definition ?? mount.definition).statelessCompute ||
      !!(draft?.definition ?? mount.definition).resourceGraph ||
      nestedChildren.some(
        (child) =>
          !!child.definition.statelessCompute ||
          !!child.definition.resourceGraph,
      );
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
            clipState === "empty" ||
            (staged.sourceEpoch !== null &&
              child.provider?.sourceEpoch?.() !== staged.sourceEpoch) ||
            (nestedTransaction.authoredEpochs.has(child.instance.id) &&
              child.provider?.authoredSourceEpoch?.() !==
                nestedTransaction.authoredEpochs.get(child.instance.id))
          )
            throw new NativeSourceError(
              "source-epoch-stale",
              "source-epoch-stale",
            );
          for (const [name, { capture, sourceEpoch }] of staged.inputEpochs)
            if (
              !this.authoredInputCaptureCurrent(
                child,
                name,
                capture,
                sourceEpoch,
              )
            )
              throw new NativeSourceError(
                "input-authored-source-stale",
                `Authored input ${capture.nodeId} changed before GPU submission.`,
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
      let plannedFillPresentationExtent: NativeEffectExtentPlan | null = null;
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
        scene =
          layerScene ??
          (await mount.provider.readScene(
            this.mountedBenchmarkRenderMetrics?.sourceReadDetail,
            "mount-source",
          ));
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
          const wasComplete = complete.has(dependency.instance.id);
          await this.renderMount(
            dependency,
            time,
            deterministic,
            complete,
            active,
          );
          if (!wasComplete) renderedDependency = true;
        }
        if (renderedDependency) {
          const sourceStarted = performance.now();
          scene = await mount.provider.readScene(
            this.mountedBenchmarkRenderMetrics?.sourceReadDetail,
            "dependency-refresh",
          );
          if (layerScene) {
            layerScene = scene;
            assertCaptureOriginCurrent();
          }
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
      let sourceEpoch = mount.provider?.sourceEpoch?.();
      let sourceAcquisitionComplete = false;

      const assertStatelessCurrent = () => {
        if (
          !Number.isSafeInteger(sourceAuthoredEpoch) ||
          mount.provider?.authoredSourceEpoch?.() !== sourceAuthoredEpoch
        )
          throw new NativeSourceError(
            "source-epoch-stale",
            "The authored source changed during native frame acquisition.",
          );
        if (
          sourceAcquisitionComplete &&
          mount.provider?.sourceEpoch?.() !== sourceEpoch
        )
          throw new NativeSourceError(
            "source-epoch-stale",
            "The acquired native source changed before presentation.",
          );
        const statefulFrame =
          !!(draft?.definition ?? mount.definition).simulation ||
          !!(draft?.definition ?? mount.definition).feedback ||
          isStatefulResourceGraph(
            (draft?.definition ?? mount.definition).resourceGraph,
          );
        if (!statelessFrame && !statefulFrame) return;
        assertCurrentPresentation();
        if (
          statefulFrame &&
          sourceEpoch !== undefined &&
          mount.provider?.sourceEpoch?.() !== sourceEpoch
        )
          throw new NativeSourceError(
            "source-epoch-stale",
            "The authored source changed before GPU submission.",
          );
        if (
          (draft?.definition ?? mount.definition).resourceGraph &&
          !mount.pendingGraphInputEpochs
        )
          throw new NativeSourceError(
            "linear-resource-frame-invalid",
            "The graph input revision is unavailable.",
          );
        if (mount.pendingGraphInputEpochs) {
          for (const [
            name,
            { capture, sourceEpoch },
          ] of mount.pendingGraphInputEpochs)
            if (
              !this.authoredInputCaptureCurrent(
                mount,
                name,
                capture,
                sourceEpoch,
              )
            )
              throw new NativeSourceError(
                "input-authored-source-stale",
                `Authored input ${capture.nodeId} changed before GPU submission.`,
              );
        }
        if (!statelessFrame) return;
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
        !nativeMountNeedsContinuousSourceFrames(mount) &&
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
        !mount.definition.resourceGraph &&
        !draft &&
        !!mount.outputTexture &&
        mount.outputTexture.width === mount.width &&
        mount.outputTexture.height === mount.height &&
        canDetachPresentationFromSources(scene);
      const retainedLayerPublication =
        mount.instance.placement === "layer" &&
        mount.isTopLayer &&
        (nestedRetainedChild ||
          !!activeDefinition.simulation ||
          !!activeDefinition.feedback ||
          isStatefulResourceGraph(activeDefinition.resourceGraph));
      if (detachedCandidate || retainedLayerPublication) {
        unpublishedLayerState = {
          outputTexture: mount.outputTexture,
          fillTextTexture: mount.fillTextTexture,
          fillUnderlayTexture: mount.fillUnderlayTexture,
          fillPhaseTexture: mount.fillPhaseTexture,
          fillBorderTexture: mount.fillBorderTexture,
          fillOuterCoverageTexture: mount.fillOuterCoverageTexture,
          fillInnerCoverageTexture: mount.fillInnerCoverageTexture,
          fillPresentationExtent: mount.fillPresentationExtent,
          frameCount: mount.frameCount,
          renderWallSamples: [...mount.renderWallSamples],
          attributes: new Map(
            mount.target
              .getAttributeNames()
              .filter((name) => name.startsWith("data-an-native-"))
              .map((name) => [name, mount.target.getAttribute(name)!]),
          ),
        };
        if (detachedCandidate) {
          frameResources = new NativeFrameResourceScratch(
            mount.resourceTextures,
            source === mount.resourceTextures.get("source") ? ["source"] : [],
          );
          mount.resourceTextures = frameResources.scratch;
        }
      }
      if (draft) {
        publishedDraftResources = mount.resourceTextures;
        draft.publishedResources = publishedDraftResources;
        mount.resourceTextures = draft.resources;
      }
      if (activeDefinition.simulation) {
        frameResources = new NativeFrameResourceScratch(
          mount.resourceTextures,
          [...mount.resourceTextures.keys()],
        );
        simulationFrameResources = true;
        mount.resourceTextures = frameResources.scratch;
      }
      if (retainedLayerPublication && !frameResources) {
        frameResources = new NativeFrameResourceScratch(
          mount.resourceTextures,
          source === mount.resourceTextures.get("source") ? ["source"] : [],
        );
        mount.resourceTextures = frameResources.scratch;
      }
      const staticPassKey = nativeStaticGeneratorPassKey({
        definition: activeDefinition,
        instance: activeInstance,
        executionHash: mount.definitionHash,
        reviewedCapability: builtinAnimationCapability(mount.definitionHash),
        width: mount.width,
        height: mount.height,
        pixelRatio: mount.pixelRatio,
        workingFormat: this.workingFormat,
        colorSpace: this.colorPresented,
        dynamicRange: this.dynamicRangePresented,
        deviceEpoch: this.deviceEpoch,
        draftActive: !!draft,
        instancePreviewActive:
          this.instancePreview?.instanceId === mount.instance.id,
      });
      const outputName =
        activeDefinition.output ?? activeDefinition.passes[0]?.output;
      const retainedOutput = outputName
        ? (mount.resourceTextures.get(outputName) ?? null)
        : null;
      const cachedOutput = mount.staticGeneratorPassCache.read(
        staticPassKey,
        retainedOutput,
      );
      if (
        this.frameTransaction ||
        (mount.instance.placement === "fill" && mount.isTopLayer)
      ) {
        if (!unpublishedLayerState)
          unpublishedLayerState = {
            outputTexture: mount.outputTexture,
            fillTextTexture: mount.fillTextTexture,
            fillUnderlayTexture: mount.fillUnderlayTexture,
            fillPhaseTexture: mount.fillPhaseTexture,
            fillBorderTexture: mount.fillBorderTexture,
            fillOuterCoverageTexture: mount.fillOuterCoverageTexture,
            fillInnerCoverageTexture: mount.fillInnerCoverageTexture,
            fillPresentationExtent: mount.fillPresentationExtent,
            frameCount: mount.frameCount,
            renderWallSamples: [...mount.renderWallSamples],
            attributes: new Map(
              mount.target
                .getAttributeNames()
                .filter((name) => name.startsWith("data-an-native-"))
                .map((name) => [name, mount.target.getAttribute(name)!]),
            ),
          };
        if (!frameResources) {
          frameResources = new NativeFrameResourceScratch(
            mount.resourceTextures,
            [
              ...(source === mount.resourceTextures.get("source")
                ? ["source"]
                : []),
              ...(cachedOutput && outputName ? [outputName] : []),
            ],
          );
          mount.resourceTextures = frameResources.scratch;
        }
      }
      if (cachedOutput) mount.pendingGraphInputEpochs = new Map();
      const effectPassesStarted = hostWallPhases ? performance.now() : 0;
      const output =
        cachedOutput ??
        (await this.effectPasses(
          mount,
          source,
          localTime,
          encoder,
          draft?.definition,
          activeInstance,
          deterministic,
          sourceRevision,
          { complete, active },
          scene,
        ));
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
        let outerScene: NativeSourceRecord[] = [];
        let outlineScene: NativeSourceRecord[] = [];
        if (mount.isTopLayer) {
          const ownPaintStarted = performance.now();
          const insetScene =
            await mount.provider!.readFillOwnPaintPhase("inset-shadow");
          outerScene =
            await mount.provider!.readFillOwnPaintPhase("outer-shadow");
          outlineScene = await mount.provider!.readFillOwnPaintPhase("outline");
          sourceWallMs += performance.now() - ownPaintStarted;
          if (insetScene.length) {
            const insetTexture = await this.composeScene(
              mount,
              insetScene,
              encoder,
              "__native_fill_inset_shadow",
            );
            fillUnderlayResult = await this.compositeFill(
              mount,
              insetTexture,
              fillUnderlayResult,
              encoder,
              "__native_fill_underlay_inset",
            );
          }
        }
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
            if (
              nestedTransaction &&
              dependency.instance.placement === "backdrop" &&
              this.nestedBackdropOwner(dependency.target) === mount
            )
              continue;
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
          fillNativeChildren = new Set(
            childScene.flatMap((record) =>
              record.nativeInstanceId &&
              record.rect.width > 0 &&
              record.rect.height > 0 &&
              record.clip.width > 0 &&
              record.clip.height > 0 &&
              Math.min(
                record.rect.x + record.rect.width,
                record.clip.x + record.clip.width,
              ) > Math.max(record.rect.x, record.clip.x) &&
              Math.min(
                record.rect.y + record.rect.height,
                record.clip.y + record.clip.height,
              ) > Math.max(record.rect.y, record.clip.y)
                ? [record.nativeInstanceId]
                : [],
            ),
          );
          if (!mount.outputExtent)
            throw new NativeSourceError(
              "fill-presentation-geometry-unavailable",
              "The generated Fill has no output geometry.",
            );
          const planned = planNativeFillPresentationExtent({
            fill: mount.outputExtent,
            foreground: [...childScene, ...outerScene, ...outlineScene],
            maxDimension: MAX_DIMENSION,
            maxPixels: MAX_PIXELS,
          });
          if (!planned.ok)
            throw new NativeSourceError(planned.code, planned.detail);
          plannedFillPresentationExtent = planned.plan;
          if (planned.plan.expanded)
            for (
              let node: Element | null = mount.target;
              node;
              node = node.parentElement
            )
              if (!supportsNativeOutput2D(getComputedStyle(node)))
                throw new NativeSourceError(
                  "effect-output-transform-unsupported",
                  "Expanded output cannot project a 3D or perspective transform.",
                );
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
            childScene.length || outerScene.length || outlineScene.length
              ? "__native_fill_phase"
              : "__native_final_back",
          );
          if (childScene.length || outerScene.length || outlineScene.length) {
            const childStarted = performance.now();
            const presentationExtent = plannedFillPresentationExtent!;
            const expandedPresentation =
              presentationExtent.width !== mount.width ||
              presentationExtent.height !== mount.height ||
              presentationExtent.left !== mount.outputExtent!.left ||
              presentationExtent.top !== mount.outputExtent!.top;
            const presentationMount = expandedPresentation
              ? {
                  ...mount,
                  width: presentationExtent.width,
                  height: presentationExtent.height,
                  outputExtent: presentationExtent,
                }
              : mount;
            let expandedBase = fillPhaseResult;
            if (outerScene.length) {
              const outerTexture = await this.composeScene(
                presentationMount,
                outerScene,
                encoder,
                "__native_fill_outer_shadow",
              );
              expandedBase = expandedPresentation
                ? await this.compositeFillPresentation(
                    mount,
                    outerTexture,
                    fillPhaseResult,
                    presentationExtent,
                    encoder,
                    true,
                    childScene.length || outlineScene.length
                      ? "__native_fill_expanded_base"
                      : "__native_final_back",
                  )
                : await this.compositeFill(
                    mount,
                    fillPhaseResult,
                    outerTexture,
                    encoder,
                    childScene.length || outlineScene.length
                      ? "__native_fill_expanded_base"
                      : "__native_final_back",
                  );
            }
            if (nestedTransaction) {
              for (const record of childScene) {
                if (!record.nativeInstanceId) continue;
                const child = this.mounts.get(record.nativeInstanceId);
                if (
                  !child ||
                  child.instance.placement !== "backdrop" ||
                  this.nestedBackdropOwner(child.target) !== mount ||
                  nestedTransaction.staged.has(child.instance.id) ||
                  !fillNativeChildren.has(child.instance.id)
                )
                  continue;
                const childEpoch = child.provider?.authoredSourceEpoch?.();
                if (childEpoch === undefined)
                  throw new NativeSourceError(
                    "source-epoch-stale",
                    "source-epoch-stale",
                  );
                await this.stageFillLocalBackdrop(
                  mount,
                  child,
                  outerScene.length ? expandedBase : fillPhaseResult,
                  outerScene.length ? presentationExtent : mount.outputExtent!,
                  encoder,
                  nestedTransaction,
                  childEpoch,
                );
              }
              for (const child of nestedChildren) {
                if (nestedTransaction.staged.has(child.instance.id)) continue;
                if (
                  mount.provider!.groupLocalBackdropClipState(child.canvas) !==
                  "empty"
                )
                  throw new NativeSourceError(
                    "native-dependency-missing",
                    "native-dependency-missing",
                  );
                nestedTransaction.noncontributing.add(child.instance.id);
              }
            }
            const overlayScene = [...childScene, ...outlineScene];
            if (overlayScene.length) {
              const stagedNativeTextures = nestedTransaction
                ? new Map(
                    [...nestedTransaction.staged].map(([id, staged]) => [
                      id,
                      staged.texture,
                    ]),
                  )
                : undefined;
              const childTexture = await this.composeScene(
                presentationMount,
                overlayScene,
                encoder,
                "__native_fill_child",
                this.colorPresented === "srgb" &&
                  this.dynamicRangePresented === "sdr" &&
                  overlayScene.length > 1
                  ? "srgb-css-linear"
                  : "linear",
                undefined,
                stagedNativeTextures,
              );
              finished = outerScene.length
                ? await this.compositeFill(
                    presentationMount,
                    childTexture,
                    expandedBase,
                    encoder,
                  )
                : expandedPresentation
                  ? await this.compositeFillPresentation(
                      mount,
                      childTexture,
                      fillPhaseResult,
                      presentationExtent,
                      encoder,
                    )
                  : await this.compositeFill(
                      mount,
                      childTexture,
                      fillPhaseResult,
                      encoder,
                    );
            } else finished = expandedBase;
            composeWallMs += performance.now() - childStarted;
          } else finished = fillPhaseResult;
        } else finished = fillUnderlayResult;
      }
      if (draft && this.draftGeneration !== draftGeneration)
        throw new NativeSourceError(
          "draft-superseded",
          "A newer draft request replaced this GPU frame.",
        );
      const stagedPresentation = Boolean(
        this.frameTransaction ||
        detachedCandidate ||
        retainedLayerPublication ||
        (mount.instance.placement === "fill" && mount.isTopLayer),
      );
      if (frameResources && !stagedPresentation && !simulationFrameResources)
        throw new NativeSourceError(
          "presentation-frame-stale",
          "The detached presentation source changed during the frame.",
        );
      sourceEpoch = nativeSourceFrameCommitEpoch(mount.provider, {
        authoredSourceEpoch: sourceAuthoredEpoch,
      });
      sourceAcquisitionComplete = true;
      const twoSurface = stagedPresentation
        ? this.preparePresentationPair(mount, device)
        : null;
      activePresentationPair = twoSurface?.pair ?? null;
      const assertTwoSurfacePublishable = (): void => {
        if (!twoSurface) return;
        assertCurrentPresentation();
        if (mount.provider?.sourceEpoch?.() !== sourceEpoch)
          throw new NativeSourceError(
            "source-epoch-stale",
            "The authored source changed before presentation.",
          );
        twoSurface.pair.assertPublishable(twoSurface.front, twoSurface.spare);
      };
      if (twoSurface && mount.instance.placement === "fill") {
        const extent = plannedFillPresentationExtent;
        if (!extent)
          throw new NativeSourceError(
            "fill-presentation-geometry-unavailable",
            "The Fill presentation has no current output geometry.",
          );
        this.ensureTextureBudget(
          extent.width *
            extent.height *
            (this.format === "rgba16float" ? 8 : 4),
        );
        this.positionFillPresentation(mount, twoSurface.spare.canvas, extent);
        detachedFillPresentation = true;
      }
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
          if (
            this.mounts.get(child.instance.id) !== child ||
            this.nestedBackdropOwner(child.target) !== mount
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
      const frame = this.frameTransaction;
      const command = encoder.finish();
      if (frame) frame.commands.push(command);
      else device.queue.submit([command]);
      if (hostWallPhases)
        hostWallPhases.submitCallWallMs += performance.now() - submitStarted;
      const markQueued = () => {
        submitted = true;
        mount.retainedPresentationWitness = false;
      };
      if (frame) frame.markQueued.push(markQueued);
      else markQueued();
      (
        draft?.simulationFrame ?? mount.simulationFrame
      )?.transaction.markSubmitted();
      (draft?.statefulFrame ?? mount.statefulFrame)?.markSubmitted();
      (draft?.feedbackFrame ?? mount.feedbackFrame)?.markSubmitted();
      for (const staged of nestedTransaction?.staged.values() ?? [])
        staged.simulationFrame?.transaction.markSubmitted();
      for (const staged of nestedTransaction?.staged.values() ?? [])
        staged.statefulFrame?.markSubmitted();
      for (const staged of nestedTransaction?.staged.values() ?? [])
        staged.feedbackFrame?.markSubmitted();
      const afterSubmit = () => {
        if (gpuSample) {
          this.gpuProfiler?.afterSubmit(gpuSample);
          profileSubmitted = true;
        }
      };
      if (frame) frame.afterSubmit.push(afterSubmit);
      else afterSubmit();
      const errorScopeStarted = hostWallPhases ? performance.now() : 0;
      const validation = scopeOpen
        ? device.popErrorScope()
        : Promise.resolve(null);
      scopeOpen = false;
      if (frame) {
        const candidate: NativeFrameCandidate = {
          texture: finished,
          extent: mount.outputExtent,
          coverage: this.receiverGeometryCache.get(mount)?.coverage,
          width: mount.width,
          height: mount.height,
          pixelRatio: mount.pixelRatio,
          definitionHash: mount.definitionHash,
          instancePayload: JSON.stringify(mount.instance),
          authoredEpoch: sourceAuthoredEpoch!,
          deviceEpoch: this.deviceEpoch,
        };
        frame.candidates.set(mount.instance.id, candidate);
        frame.transaction.stage(
          mount.instance.id,
          new Map([[mount.instance.id, candidate]]),
        );
        active.delete(mount.instance.id);
      }
      onSubmitted?.();
      let gpuError: GPUError | null;
      try {
        [gpuError] = frame
          ? await Promise.all([validation, frame.submission])
          : [await validation];
      } finally {
        if (onSubmitted && !frame)
          releaseSubmissionCommit =
            await this.submissionPipeline?.acquireCommit();
      }
      if (hostWallPhases)
        hostWallPhases.errorScopeWallMs +=
          performance.now() - errorScopeStarted;
      if (gpuError) {
        if (mount.outputTexture && mount.isTopLayer && !twoSurface) {
          restorationAttempted = true;
          await restorePublishedOutput(mount.outputTexture);
        }
        throw new NativeSourceError(
          "gpu-validation",
          `WebGPU rejected effect ${mount.instance.id}: ${gpuError.message}`,
        );
      }
      gpuValidated = true;
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
        if (
          this.mounts.get(child.instance.id) !== child ||
          this.nestedBackdropOwner(child.target) !== mount
        )
          throw new NativeSourceError(
            "source-group-local-chain-unsupported",
            "source-group-local-chain-unsupported",
          );
      }
      assertNestedChildren();
      assertCaptureOriginCurrent();
      if (twoSurface) {
        assertTwoSurfacePublishable();
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
      const simulationFrame = draft?.simulationFrame ?? mount.simulationFrame;
      if (simulationFrame) {
        await simulationFrame.transaction.settle(() => {
          assertCaptureOriginCurrent();
          assertStatelessCurrent();
          assertTwoSurfacePublishable();
          if (
            this.device !== device ||
            this.mounts.get(mount.instance.id) !== mount
          )
            throw new NativeSourceError(
              "simulation-frame-invalid",
              "simulation-frame-invalid",
            );
        });
      }
      for (const staged of nestedTransaction?.staged.values() ?? [])
        if (staged.simulationFrame)
          await staged.simulationFrame.transaction.settle(() => {
            assertNestedChildren();
            assertCaptureOriginCurrent();
            assertStatelessCurrent();
            assertTwoSurfacePublishable();
            if (this.device !== device)
              throw new NativeSourceError(
                "simulation-frame-invalid",
                "simulation-frame-invalid",
              );
          });
      const statefulFrame = draft?.statefulFrame ?? mount.statefulFrame;
      if (statefulFrame)
        await statefulFrame.settle(() => {
          assertCaptureOriginCurrent();
          assertStatelessCurrent();
          assertTwoSurfacePublishable();
        });
      for (const staged of nestedTransaction?.staged.values() ?? [])
        if (staged.statefulFrame)
          await staged.statefulFrame.settle(() => {
            assertNestedChildren();
            assertCaptureOriginCurrent();
            assertStatelessCurrent();
            assertTwoSurfacePublishable();
            if (this.device !== device)
              throw new NativeSourceError(
                "stateful-frame-invalid",
                "stateful-frame-invalid",
              );
          });
      const feedbackFrame = draft?.feedbackFrame ?? mount.feedbackFrame;
      if (feedbackFrame)
        await feedbackFrame.settle(() => {
          assertCaptureOriginCurrent();
          assertStatelessCurrent();
          assertTwoSurfacePublishable();
        });
      for (const staged of nestedTransaction?.staged.values() ?? [])
        if (staged.feedbackFrame)
          await staged.feedbackFrame.settle(() => {
            assertNestedChildren();
            assertCaptureOriginCurrent();
            assertStatelessCurrent();
            assertTwoSurfacePublishable();
          });
      const publicationState = frame
        ? {
            ...mount,
            resourceTextures: frameResources!.committed,
            renderWallSamples: [...mount.renderWallSamples],
          }
        : null;
      const publicationAttributes = frame
        ? new Map(
            mount.target
              .getAttributeNames()
              .map((name) => [name, mount.target.getAttribute(name)!]),
          )
        : null;
      let publicationStarted = false;
      const publicationFinalizers: Array<() => void> = [];
      const finalizePublication = (finalize: () => void): void => {
        if (frame) publicationFinalizers.push(finalize);
        else finalize();
      };
      const assertPublication = (): void => {
        assertCaptureOriginCurrent();
        assertStatelessCurrent();
        assertTwoSurfacePublishable();
        const candidate = frame?.candidates.get(mount.instance.id);
        if (
          frame &&
          (!candidate ||
            candidate.instancePayload !== JSON.stringify(mount.instance) ||
            candidate.definitionHash !== mount.definitionHash ||
            candidate.width !== mount.width ||
            candidate.height !== mount.height ||
            candidate.pixelRatio !== mount.pixelRatio ||
            candidate.authoredEpoch !== mount.provider?.authoredSourceEpoch?.())
        )
          throw new NativeSourceError(
            "presentation-frame-stale",
            "The prepared native output no longer matches its authored source.",
          );
        if (
          this.device !== device ||
          this.deviceEpoch !==
            frame?.candidates.get(mount.instance.id)?.deviceEpoch ||
          this.mounts.get(mount.instance.id) !== mount
        )
          if (frame)
            throw new NativeSourceError(
              "presentation-frame-stale",
              "The prepared native frame changed before publication.",
            );
      };
      const publish = (): void => {
        publicationStarted = true;
        if (frame) frame.publishing = true;
        try {
          for (const staged of nestedTransaction?.staged.values() ?? [])
            this.refreshAuthoredPaint(staged.mount);
          assertCaptureOriginCurrent();
          assertStatelessCurrent();
          assertTwoSurfacePublishable();
          if (twoSurface) this.refreshAuthoredPaint(mount);
          if (twoSurface) {
            assertTwoSurfacePublishable();
            const front = twoSurface.pair.publish(
              twoSurface.front,
              twoSurface.spare,
            );
            mount.canvas = front.canvas;
            mount.context = front.context;
          }
          const postSubmitStarted = hostWallPhases ? performance.now() : 0;
          if (simulationFrame) {
            this.promoteSimulationFrame(mount, simulationFrame, draft);
          }
          if (simulationFrameResources && frameResources && !twoSurface) {
            const staleResources = frameResources.retiredOnCommit();
            frameResources.commit();
            if (draft) draft.resources = frameResources.scratch;
            else mount.resourceTextures = frameResources.scratch;
            frameResources = null;
            for (const texture of staleResources)
              if (!this.textureRetirement.includes(texture))
                this.textureRetirement.push(texture);
          }
          if (feedbackFrame) {
            this.promoteFeedbackFrame(mount, feedbackFrame, draft);
          }
          if (statefulFrame) {
            this.promoteStatefulFrame(mount, statefulFrame, draft);
          }
          const prior = mount.outputTexture;
          mount.outputTexture = finished;
          if (mount.instance.placement === "fill" && mount.isTopLayer)
            mount.fillPresentationExtent = plannedFillPresentationExtent;
          if (mount.instance.placement === "layer") {
            mount.layerSourceOpacityDeferred = layerTargetOpacityDeferred;
            if (layerTargetOpacityDeferred)
              mount.canvas.setAttribute(
                "data-an-native-layer-opacity-owner",
                "receiver",
              );
            else
              mount.canvas.removeAttribute(
                "data-an-native-layer-opacity-owner",
              );
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
            prior.width === finished.width &&
            prior.height === finished.height
          )
            mount.resourceTextures.set("__native_final_back", prior);
          else {
            if (prior) {
              if (twoSurface) priorOutputRetirement = prior;
              else this.textureRetirement.push(prior);
            }
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
            ...(fillUnderlayResult ===
            mount.resourceTextures.get("__native_fill_underlay_inset")
              ? ["__native_fill_underlay_inset", "__native_fill_inset_shadow"]
              : []),
            ...(mount.isTopLayer &&
            mount.resourceTextures.has("__native_fill_box")
              ? ["__native_fill_box"]
              : []),
            ...(fillPhaseResult ? ["__native_fill_phase"] : []),
            ...(mount.isTopLayer &&
            mount.resourceTextures.has("__native_fill_child")
              ? ["__native_fill_child"]
              : []),
            ...(mount.isTopLayer &&
            mount.resourceTextures.has("__native_fill_outer_shadow")
              ? ["__native_fill_outer_shadow"]
              : []),
            ...(mount.isTopLayer &&
            mount.resourceTextures.has("__native_fill_expanded_base")
              ? ["__native_fill_expanded_base"]
              : []),
            ...(fillGlyphResult ? ["__native_fill_text"] : []),
            ...(fillGlyphBase ===
            mount.resourceTextures.get("__native_fill_glyph")
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
          finalizePublication(() => {
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
          });
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
            (draft?.caughtUp ?? mount.simulationCaughtUp)
              ? "ready"
              : "last-good",
          );
          if (draft?.caughtUp ?? mount.simulationCaughtUp) {
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
          const commitPresentationProvenance = (): void => {
            mount.committedSourceEpoch = sourceEpoch ?? null;
            if (mount.instance.placement === "layer")
              mount.layerCommittedNativeSources = new Set(
                scene.flatMap((record) =>
                  record.nativeInstanceId ? [record.nativeInstanceId] : [],
                ),
              );
            mount.committedInstancePayload = JSON.stringify(activeInstance);
            mount.committedDefinitionHash =
              draft?.executionHash ?? mount.definitionHash;
            mount.committedLocalTime = localTime;
            mount.committedInputEpochs = new Map(
              mount.pendingGraphInputEpochs ?? [],
            );
          };
          if (!twoSurface) commitPresentationProvenance();
          mount.frameCount += 1;
          mount.target.setAttribute(
            "data-an-native-frames",
            String(mount.frameCount),
          );
          mount.target.setAttribute(
            "data-an-native-captures",
            String(mount.provider?.captureCount() ?? 0),
          );
          mount.target.setAttribute(
            "data-an-native-sources",
            String(scene.length),
          );
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
          if (mount.renderWallSamples.length > 60)
            mount.renderWallSamples.shift();
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
            const resources = frameResources!;
            const staleResources = resources.retiredOnCommit();
            if (
              mount.instance.placement === "fill" ||
              (retainedLayerPublication && !mount.suppressed)
            )
              this.suppressOriginal(mount, true);
            commitPresentationProvenance();
            finalizePublication(() => {
              if (
                priorOutputRetirement &&
                ![...resources.scratch.values()].includes(priorOutputRetirement)
              )
                this.textureRetirement.push(priorOutputRetirement);
              resources.commit();
              if (draft) draft.resources = resources.scratch;
              if (mirrorCandidate) {
                this.publishedPresentationMirror.commit();
                mirrorCandidate = null;
              }
              frameResources = null;
              unpublishedLayerState = null;
              for (const texture of staleResources)
                if (!this.textureRetirement.includes(texture))
                  this.textureRetirement.push(texture);
            });
          }
          if (mount.instance.placement === "fill" && mount.isTopLayer)
            mount.fillCommittedNativeChildren = fillNativeChildren;
          if (mount.instance.placement === "fill" && mount.isTopLayer)
            mount.groupLocalNoncontributingChildren = new Set(
              nestedTransaction?.noncontributing ?? [],
            );
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
          for (const staged of nestedTransaction?.staged.values() ?? []) {
            const {
              mount: child,
              texture,
              resources,
              simulationFrame: childSimulationFrame,
              statefulFrame: childStatefulFrame,
              feedbackFrame: childFeedbackFrame,
            } = staged;
            const previous = child.outputTexture;
            const previousOwnedByStateful =
              !!previous && !!child.stateful?.textures.has(previous);
            const previousOwnedByResources =
              !!previous &&
              !!resources &&
              [...resources.committed.values()].includes(previous);
            if (childSimulationFrame)
              this.promoteSimulationFrame(child, childSimulationFrame);
            if (childStatefulFrame)
              this.promoteStatefulFrame(child, childStatefulFrame);
            if (childFeedbackFrame)
              this.promoteFeedbackFrame(child, childFeedbackFrame);
            staged.simulationFrame = undefined;
            staged.statefulFrame = undefined;
            staged.feedbackFrame = undefined;
            if (resources) {
              const staleResources = resources.retiredOnCommit();
              resources.commit();
              staged.resources = undefined;
              child.resourceTextures = resources.scratch;
              for (const stale of staleResources)
                if (!this.textureRetirement.includes(stale))
                  this.textureRetirement.push(stale);
            }
            child.outputTexture = texture;
            child.committedSourceEpoch = staged.sourceEpoch;
            child.committedInstancePayload = staged.instancePayload;
            child.committedDefinitionHash = staged.definitionHash;
            child.committedLocalTime = staged.localTime;
            child.committedInputEpochs = staged.inputEpochs;
            child.pendingGraphInputEpochs = null;
            if (
              previous &&
              previous !== texture &&
              !previousOwnedByStateful &&
              !previousOwnedByResources &&
              !this.textureRetirement.includes(previous)
            ) {
              for (const [name, resource] of child.resourceTextures)
                if (resource === previous) child.resourceTextures.delete(name);
              this.textureRetirement.push(previous);
            }
            child.frameCount += 1;
            this.activeMounts.add(child);
            this.suppressOriginal(child, true);
            child.target.setAttribute(
              "data-an-native-frames",
              String(child.frameCount),
            );
            complete.add(child.instance.id);
          }
          const nestedCaughtUp = [
            ...(nestedTransaction?.staged.values() ?? []),
          ].every(({ mount: child }) => child.simulationCaughtUp);
          const sceneCaughtUp =
            (draft?.caughtUp ?? mount.simulationCaughtUp) && nestedCaughtUp;
          if (nestedTransaction?.staged.size) {
            mount.target.setAttribute(
              "data-an-native-status",
              sceneCaughtUp ? "ready" : "last-good",
            );
            if (sceneCaughtUp) {
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
          }
          active.delete(mount.instance.id);
          complete.add(mount.instance.id);
          try {
            for (const { mount: child } of nestedTransaction?.staged.values() ??
              []) {
              const caughtUp = child.simulationCaughtUp;
              child.target.setAttribute(
                "data-an-native-status",
                caughtUp ? "ready" : "last-good",
              );
              if (caughtUp) {
                child.target.removeAttribute("data-an-native-error");
                child.target.removeAttribute("data-an-native-error-message");
              } else {
                child.target.setAttribute(
                  "data-an-native-error",
                  "simulation-catching-up",
                );
                child.target.setAttribute(
                  "data-an-native-error-message",
                  "Particle simulation is still catching up to the presentation clock.",
                );
              }
              this.postStatus(
                child.instance.id,
                child.instance.nodeId,
                caughtUp ? "ready" : "last-good",
                caughtUp
                  ? undefined
                  : {
                      code: "simulation-catching-up",
                      message: "simulation-catching-up",
                    },
              );
            }
            this.postStatus(
              mount.instance.id,
              mount.instance.nodeId,
              sceneCaughtUp ? "ready" : "last-good",
              sceneCaughtUp
                ? undefined
                : {
                    code: "simulation-catching-up",
                    message: "simulation-catching-up",
                  },
            );
          } catch (error) {
            if (!twoSurface && !activeDefinition.simulation) throw error;
            this.issue("status-post-failed", String(error), mount.instance.id);
          }
          if (staticPassKey)
            finalizePublication(() =>
              mount.staticGeneratorPassCache.commit(staticPassKey, output),
            );
        } finally {
          if (frame) frame.publishing = false;
        }
      };
      if (frame) {
        await frame.transaction.prepare(mount.instance.id, {
          assert: assertPublication,
          commit: publish,
          rollback: () => {
            if (!publicationStarted) return;
            if (twoSurface && twoSurface.pair.visible() !== twoSurface.front)
              twoSurface.pair.publish(
                twoSurface.pair.visible(),
                twoSurface.front,
              );
            Object.assign(mount, publicationState);
            complete.delete(mount.instance.id);
            for (const name of mount.target.getAttributeNames())
              if (!publicationAttributes!.has(name))
                mount.target.removeAttribute(name);
            for (const [name, value] of publicationAttributes!)
              mount.target.setAttribute(name, value);
          },
          retire: () => {
            for (const finalize of publicationFinalizers) finalize();
          },
        });
      } else publish();
    } catch (error) {
      if (error instanceof NativeStatelessFrameRetirementError) throw error;
      mount.staticGeneratorPassCache.invalidate();
      if (mirrorCandidate) this.publishedPresentationMirror.discard();
      for (const staged of nestedTransaction?.staged.values() ?? []) {
        if (staged.simulationFrame) {
          try {
            if (submitted)
              await staged.simulationFrame.transaction.rejectSubmitted();
            else await staged.simulationFrame.transaction.abandon();
          } finally {
            if (staged.simulationFrame.state !== staged.mount.simulation)
              this.retireSimulationState(staged.simulationFrame.state);
            staged.simulationFrame = undefined;
          }
        }
        if (staged.statefulFrame) {
          if (submitted && !gpuValidated)
            await staged.statefulFrame.rejectSubmitted(error);
          else staged.statefulFrame.abandon();
          staged.statefulFrame = undefined;
        }
        staged.mount.statefulCandidate?.executor.dispose();
        staged.mount.statefulCandidate = null;
        if (staged.feedbackFrame) {
          if (submitted) await staged.feedbackFrame.rejectSubmitted(error);
          else staged.feedbackFrame.abandon();
          staged.feedbackFrame = undefined;
        }
        const feedbackCandidate = staged.mount.feedbackCandidate;
        staged.mount.feedbackCandidate = null;
        if (feedbackCandidate) await this.disposeFeedback(feedbackCandidate);
        staged.mount.pendingGraphInputEpochs = null;
        if (staged.resources) {
          for (const texture of staged.resources.rollback())
            if (!this.textureRetirement.includes(texture))
              this.textureRetirement.push(texture);
          staged.resources = undefined;
        }
      }
      const simulationFrame = draft?.simulationFrame ?? mount.simulationFrame;
      let simulationCleanupFailure: unknown;
      if (simulationFrame) {
        if (draft) draft.simulationFrame = null;
        else mount.simulationFrame = null;
        try {
          if (submitted) await simulationFrame.transaction.rejectSubmitted();
          else await simulationFrame.transaction.abandon();
        } catch (cleanupError) {
          simulationCleanupFailure = cleanupError;
        }
        if (
          simulationFrame.state !==
          (draft ? draft.simulation : mount.simulation)
        )
          this.retireSimulationState(simulationFrame.state);
      }
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
          mount.fillPresentationExtent =
            unpublishedLayerState.fillPresentationExtent;
          mount.frameCount = unpublishedLayerState.frameCount;
          mount.renderWallSamples = unpublishedLayerState.renderWallSamples;
          for (const name of mount.target.getAttributeNames())
            if (name.startsWith("data-an-native-"))
              mount.target.removeAttribute(name);
          for (const [name, value] of unpublishedLayerState.attributes)
            mount.target.setAttribute(name, value);
        }
      }
      let simulationRestoreFailure: unknown;
      if (
        submitted &&
        activeDefinition.simulation &&
        !detachedFillPresentation &&
        publishedSimulationOutput &&
        mount.isTopLayer &&
        this.device === device &&
        mount.canvas.isConnected &&
        !restorationAttempted
      )
        try {
          restorationAttempted = true;
          await restorePublishedOutput(publishedSimulationOutput);
          mount.outputTexture = publishedSimulationOutput;
        } catch (restoreError) {
          simulationRestoreFailure = restoreError;
        }
      if (
        priorPresentation.output &&
        canRetainNativePresentationAfterFailure(
          activePresentationPair,
          priorPresentation.canvas,
          submitted,
          detachedFillPresentation,
        )
      )
        try {
          assertCurrentPresentation();
          mount.retainedPresentationWitness =
            visibleLayoutUnchanged &&
            mount.canvas.style.cssText === visibleStyleBeforeLayout &&
            mount.outputTexture === priorPresentation.output &&
            mount.width === priorPresentation.width &&
            mount.height === priorPresentation.height &&
            mount.canvas === priorPresentation.canvas &&
            mount.target === priorPresentation.target &&
            mount.suppressed === priorPresentation.suppressed &&
            mount.target.getAttribute("data-an-native-fill-instance") ===
              priorPresentation.fillInstance &&
            mount.canvas.style.visibility === priorPresentation.visibility;
        } catch {
          mount.retainedPresentationWitness = false;
        }
      const statefulFrame = draft?.statefulFrame ?? mount.statefulFrame;
      if (draft) draft.statefulFrame = null;
      else mount.statefulFrame = null;
      const stateful =
        (draft ? draft.statefulCandidate : mount.statefulCandidate) ??
        (draft ? draft.stateful : mount.stateful);
      if (stateful) {
        stateful.pendingSourceRevision = null;
        stateful.pendingDroppedSteps = 0;
      }
      if (statefulFrame) {
        if (submitted && !gpuValidated)
          await statefulFrame.rejectSubmitted(error);
        else statefulFrame.abandon();
      }
      if (draft?.statefulCandidate) {
        draft.statefulCandidate.executor.dispose();
        draft.statefulCandidate = null;
      } else if (mount.statefulCandidate) {
        mount.statefulCandidate.executor.dispose();
        mount.statefulCandidate = null;
      }
      const feedbackFrame = draft?.feedbackFrame ?? mount.feedbackFrame;
      if (draft) draft.feedbackFrame = null;
      else mount.feedbackFrame = null;
      const feedback = draft
        ? (draft.feedbackCandidate ?? draft.feedback)
        : (mount.feedbackCandidate ?? mount.feedback);
      if (feedback) {
        feedback.pendingSourceRevision = null;
        feedback.pendingPointerPosition = null;
      }
      let feedbackFailure: unknown;
      if (feedbackFrame)
        try {
          if (submitted) {
            await feedbackFrame.rejectSubmitted(error);
          } else feedbackFrame.abandon();
        } catch (cleanupError) {
          feedbackFailure = cleanupError;
        }
      const feedbackCandidate = draft
        ? draft.feedbackCandidate
        : mount.feedbackCandidate;
      if (draft) draft.feedbackCandidate = null;
      else mount.feedbackCandidate = null;
      if (feedbackCandidate)
        try {
          await this.disposeFeedback(feedbackCandidate);
        } catch (cleanupError) {
          feedbackFailure ??= cleanupError;
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
      if (simulationCleanupFailure)
        throw new NativeSourceError(
          "simulation-device-lost",
          `simulation-device-lost: ${String(simulationCleanupFailure)}`,
        );
      if (simulationRestoreFailure)
        throw new NativeSourceError(
          "simulation-restore-failed",
          `simulation-restore-failed: ${String(simulationRestoreFailure)}`,
        );
      throw error;
    } finally {
      try {
        if (publishedDraftResources)
          mount.resourceTextures = publishedDraftResources;
        else if (this.draft?.instanceId === mount.instance.id)
          this.draft.publishedResources = mount.resourceTextures;
        if (profiledEncoder) {
          this.settleStatelessFrames(profiledEncoder, submitted);
          this.gpuSamples.delete(profiledEncoder);
        }
        mount.pendingGraphInputEpochs = null;
        if (gpuSample && !profileSubmitted)
          this.gpuProfiler?.abandonSample(gpuSample);
      } finally {
        releaseSubmissionCommit?.();
        onSubmitted?.();
      }
    }
  }

  private currentTime(): number {
    return this.timeOverride ?? (performance.now() - this.clockOrigin) / 1000;
  }

  private closeStatelessFrameScope(
    frame: NativeStatelessFrameContext,
  ): Promise<GPUError | null> {
    const scope = frame.validationScope;
    if (!scope.open)
      throw new NativeStatelessFrameTransactionError(
        "stateless-frame-validation-closed",
        "The native frame validation scope is already closed.",
      );
    scope.open = false;
    return scope.device.popErrorScope();
  }

  private async submitStatelessFrame(
    frame: NativeStatelessFrameContext,
  ): Promise<void> {
    let id = "__native_frame_submit__";
    while (frame.jobs.has(id)) id += "_";
    frame.transaction.register(id);
    const { device, epoch } = frame.validationScope;
    try {
      device.queue.submit(frame.commands);
      // Mark every queued owner before profiling can throw and enter cleanup.
      for (const markQueued of frame.markQueued) markQueued();
      const validation = this.closeStatelessFrameScope(frame);
      const task = (async () => {
        const error = await validation;
        if (error) throw new NativeSourceError("gpu-validation", error.message);
        frame.resolveSubmission();
        await frame.transaction.prepare(id, {
          assert: () => {
            if (
              this.device !== device ||
              this.deviceEpoch !== epoch ||
              this.disposed
            )
              throw new NativeSourceError(
                "scene-generation-changed",
                "The native device changed before frame publication.",
              );
          },
          commit: () => {},
          rollback: () => {},
          retire: () => {},
        });
      })();
      const outcome = task.then<
        PromiseSettledResult<void>,
        PromiseSettledResult<void>
      >(
        () => ({ status: "fulfilled", value: undefined }),
        (error) => {
          frame.rejectSubmission(error);
          frame.transaction.fail(id, error);
          return { status: "rejected", reason: error };
        },
      );
      frame.jobs.set(id, { submitted: Promise.resolve(), outcome });
      for (const afterSubmit of frame.afterSubmit) afterSubmit();
    } catch (error) {
      if (!frame.validationScope.open) frame.rejectSubmission(error);
      frame.transaction.fail(id, error);
      throw error;
    }
  }

  private canPipelineGeneratedFills(): boolean {
    if (
      this.previewDirty ||
      this.draft ||
      this.instancePreview ||
      this.compositionPixelRatio !== null ||
      this.exportInitialPixelRatio !== null ||
      this.scenePresentation ||
      !this.canPrepareStatelessFrame() ||
      this.presentationMirrorCapture ||
      this.presentationFaultHold ||
      this.presentationFaultLatch.pending()
    )
      return false;
    return [...this.mounts.values()].every((mount) => {
      if (
        mount.instance.placement !== "fill" ||
        mount.instance.clip === "text" ||
        !(mount.target instanceof HTMLElement) ||
        !mount.provider ||
        !this.hasPresentationGeometry(mount.target) ||
        this.offscreen(mount) ||
        mount.definition.passes.length !== 1 ||
        mount.outputExtent?.expanded
      )
        return false;
      const style = getComputedStyle(mount.target);
      return (
        style.boxShadow === "none" &&
        (style.outlineStyle === "none" || style.outlineWidth === "0px") &&
        [...mount.target.childNodes].every((node) =>
          node instanceof Element
            ? node.hasAttribute("data-an-native-canvas")
            : node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim(),
        )
      );
    });
  }

  private generatedFillBounds(mount: Mount): string {
    const rect = mount.target.getBoundingClientRect();
    return JSON.stringify([rect.x, rect.y, rect.width, rect.height]);
  }

  private assertGeneratedFillFamily(family: NativeGeneratedFillFamily): void {
    if (
      family.cancelled ||
      this.disposed ||
      this.device !== family.device ||
      this.deviceEpoch !== family.deviceEpoch ||
      this.previewHostGeneration !== family.hostGeneration ||
      JSON.stringify(this.previewViewport) !== family.viewport ||
      JSON.stringify([
        this.format,
        this.workingFormat,
        this.colorPresented,
        this.dynamicRangePresented,
      ]) !== family.presentationFormat ||
      this.previewPolicy.status(devicePixelRatio || 1).effectivePixelRatio !==
        family.density ||
      this.compositionPixelRatio !== null ||
      this.exportInitialPixelRatio !== null ||
      this.compositionAbort ||
      this.compositionPixelBusy ||
      this.draft ||
      this.instancePreview ||
      this.scanning
    )
      throw new NativeSourceError(
        "source-epoch-stale",
        "The generated fill frame belongs to an obsolete preview generation.",
      );
    for (const entry of family.entries) {
      const mount = entry.canonical;
      if (
        this.mounts.get(mount.instance.id) !== mount ||
        JSON.stringify(mount.instance) !== entry.payload ||
        mount.definitionHash !== entry.definitionHash ||
        mount.provider?.sourceEpoch?.() !== entry.sourceEpoch ||
        mount.provider?.authoredSourceEpoch?.() !== entry.authoredEpoch ||
        this.generatedFillBounds(mount) !== entry.bounds ||
        !this.hasPresentationGeometry(mount.target)
      )
        throw new NativeSourceError(
          "source-epoch-stale",
          "The generated fill source changed before validated publication.",
        );
    }
  }

  private async createGeneratedFillFamily(): Promise<NativeGeneratedFillFamily> {
    const device = this.device!;
    const epoch = this.deviceEpoch;
    const entries: NativeGeneratedFillEntry[] = [];
    const slots: NativeGeneratedFillSlot[] = [];
    let releasePins: (() => void) | null = null;
    device.pushErrorScope("validation");
    let scopeOpen = true;
    try {
      for (const mount of this.mounts.values()) {
        this.activeMounts.add(mount);
        const authoredEpoch = mount.provider!.authoredSourceEpoch!();
        this.refreshAuthoredPaint(mount);
        if (!mount.authoredFillPaint)
          throw new NativeSourceError(
            "fill-background-unreadable",
            "The generated fill has no current authored box paint.",
          );
        const boxes: GPUTexture[] = [];
        for (const phase of [
          "background",
          "border",
          "coverage",
          "inner-coverage",
        ] as const) {
          const records = await mount.provider!.readFillBoxPhase(
            mount.authoredFillPaint,
            phase,
          );
          if (records.length !== 1 || !records[0]!.source)
            throw new NativeSourceError(
              "fill-box-phase-unavailable",
              "The generated fill box phase is unavailable.",
            );
          boxes.push(this.upload(mount, records[0]!));
        }
        if (mount.provider!.authoredSourceEpoch!() !== authoredEpoch)
          throw new NativeSourceError(
            "source-epoch-stale",
            "The generated fill changed while its static paint was captured.",
          );
        mount.presentationPair?.dispose();
        mount.presentationPair = null;
        const presentation = new NativePresentationSlots(
          { canvas: mount.canvas, context: mount.context },
          (front) => {
            this.ensureTextureBudget(mount.width * mount.height * 8);
            const canvas = front.canvas.cloneNode(false) as HTMLCanvasElement;
            const context = canvas.getContext(
              "webgpu",
            ) as GPUCanvasContext | null;
            if (!context)
              throw new NativeSourceError(
                "presentation-spare-unavailable",
                "A generated fill presentation slot is unavailable.",
              );
            context.configure({
              device,
              format: this.format,
              alphaMode: "premultiplied",
              colorSpace: this.colorPresented,
              ...(this.dynamicRangePresented === "hdr"
                ? { toneMapping: { mode: "extended" as const } }
                : {}),
            });
            this.contextOwners.set(context, device);
            return { canvas, context };
          },
          ({ canvas, context }) => {
            context.unconfigure();
            this.contextOwners.delete(context);
            canvas.remove();
          },
        );
        entries.push({
          canonical: mount,
          presentation,
          boxes: boxes as [GPUTexture, GPUTexture, GPUTexture, GPUTexture],
          payload: JSON.stringify(mount.instance),
          definitionHash: mount.definitionHash,
          sourceEpoch: mount.provider!.sourceEpoch!(),
          authoredEpoch,
          bounds: this.generatedFillBounds(mount),
        });
      }
      releasePins = this.retainStatelessTextures(
        device,
        new Set(entries.flatMap((entry) => [...entry.boxes])),
      );
      const alignment = device.limits.minUniformBufferOffsetAlignment;
      const capacity = Math.floor(262144 / alignment) * alignment;
      if (
        this.allocatedUniformBytes + capacity * 3 > MAX_UNIFORM_BYTES ||
        this.estimatedResourceBytes() + capacity * 3 > MAX_REALM_TEXTURE_BYTES
      )
        throw new NativeSourceError(
          "gpu-budget-exceeded",
          "Persistent generated fill uniforms exceed the shared GPU budget.",
        );
      for (let index = 0; index < 3; index++) {
        const buffer = device.createBuffer({
          size: capacity,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.uniformBytes.set(buffer, capacity);
        this.allocatedUniformBytes += capacity;
        this.packedArenaBuffers.add(buffer);
        const arena = new NativePackedUniformArena({
          buffer,
          capacityBytes: capacity,
          alignment,
          upload: (target, bytes) =>
            device.queue.writeBuffer(
              target,
              0,
              bytes as Uint8Array<ArrayBuffer>,
            ),
        });
        const states = new Map<string, Mount>();
        for (const entry of entries) {
          const mount = entry.canonical;
          states.set(mount.instance.id, {
            ...mount,
            resourceTextures: index === 0 ? mount.resourceTextures : new Map(),
            drawBindings: index === 0 ? mount.drawBindings : new Map(),
            sourceTextures: new Map(),
            isolationTextures: new Map(),
            assetTextures: new Map(),
            authoredInputs: new Map(),
            staticGeneratorPassCache: new NativeStaticGeneratorPassCache(),
            outputTexture: index === 0 ? mount.outputTexture : null,
            clock: { ...mount.clock },
          });
        }
        slots.push({ buffer, arena, states });
      }
      scopeOpen = false;
      const validation = device.popErrorScope();
      const error = await validation;
      if (error) throw new NativeSourceError("gpu-validation", error.message);
      const family: NativeGeneratedFillFamily = {
        device,
        deviceEpoch: epoch,
        hostGeneration: this.previewHostGeneration,
        viewport: JSON.stringify(this.previewViewport),
        density: this.previewPolicy.status(devicePixelRatio || 1)
          .effectivePixelRatio,
        presentationFormat: JSON.stringify([
          this.format,
          this.workingFormat,
          this.colorPresented,
          this.dynamicRangePresented,
        ]),
        entries,
        slots: slots as [
          NativeGeneratedFillSlot,
          NativeGeneratedFillSlot,
          NativeGeneratedFillSlot,
        ],
        scheduler: new NativeBoundedFrameScheduler(),
        releasePins,
        cancelled: false,
        cadenceStart: performance.now(),
        cadenceFrames: 0,
      };
      this.assertGeneratedFillFamily(family);
      return family;
    } catch (error) {
      const failures: unknown[] = [error];
      if (scopeOpen)
        try {
          scopeOpen = false;
          const validation = device.popErrorScope();
          const cleanup = await validation;
          if (cleanup) failures.push(cleanup);
        } catch (cleanup) {
          failures.push(cleanup);
        }
      for (const entry of entries)
        try {
          entry.presentation.dispose();
        } catch (cleanup) {
          failures.push(cleanup);
        }
      for (const slot of slots)
        try {
          this.packedArenaBuffers.delete(slot.buffer);
          this.destroyUniform(slot.buffer);
        } catch (cleanup) {
          failures.push(cleanup);
        }
      try {
        releasePins?.();
      } catch (cleanup) {
        failures.push(cleanup);
      }
      if (failures.length > 1)
        throw new NativeStatelessFrameTransactionError(
          "stateless-frame-validation-cleanup-failed",
          "Generated fill initialization and cleanup failed.",
          failures,
        );
      throw error;
    } finally {
      this.activeMounts.clear();
    }
  }

  private releaseGeneratedFillFamily(): void {
    const family = this.generatedFillFamily;
    if (!family) return;
    if (family.scheduler.pendingCount)
      throw new NativeSourceError(
        "frame-pipeline-busy",
        "The generated fill frames must drain before their resources can retire.",
      );
    this.generatedFillFamily = null;
    family.cancelled = true;
    family.scheduler.cancel(
      new NativeSourceError(
        "source-epoch-stale",
        "The generated fill generation ended.",
      ),
    );
    const kept = new Set(
      family.entries.flatMap(({ canonical }) => [
        ...canonical.resourceTextures.values(),
      ]),
    );
    const textures = new Set<GPUTexture>();
    const buffers = new Set<GPUBuffer>();
    for (const slot of family.slots)
      for (const state of slot.states.values()) {
        for (const texture of state.resourceTextures.values())
          if (!kept.has(texture)) textures.add(texture);
        for (const binding of state.drawBindings.values())
          if (!this.packedArenaBuffers.has(binding.buffer))
            buffers.add(binding.buffer);
      }
    const failures: unknown[] = [];
    for (const entry of family.entries) {
      entry.canonical.drawBindings = new Map();
      try {
        entry.presentation.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const texture of textures) this.textureRetirement.push(texture);
    for (const buffer of buffers) this.retirement.push(buffer);
    for (const slot of family.slots) {
      this.packedArenaBuffers.delete(slot.buffer);
      this.retirement.push(slot.buffer);
    }
    try {
      family.releasePins();
    } catch (error) {
      failures.push(error);
    }
    this.previewPolicy.resetCommittedCadence();
    if (failures.length)
      throw new NativeStatelessFrameTransactionError(
        "stateless-frame-retirement-failed",
        "Generated fill resources could not all retire.",
        failures,
      );
  }

  private async prepareGeneratedFillFrame(
    family: NativeGeneratedFillFamily,
    slotIndex: NativeFrameSlot,
    time: number,
  ): Promise<NativePreparedScheduledFrame> {
    this.assertGeneratedFillFamily(family);
    const started = performance.now();
    const slot = family.slots[slotIndex];
    const token = slot.arena.beginFrame();
    const transaction = new NativeStatelessFrameTransaction<GPUTexture>();
    const publications: Promise<PromiseSettledResult<void>>[] = [];
    const leases: Array<{
      entry: NativeGeneratedFillEntry;
      lease: NativePresentationLease<GPUCanvasContext>;
      prepared: boolean;
    }> = [];
    const owners = new WeakMap<CompositionSurface, string>();
    const samples: NativeGpuScopedSample[] = [];
    let uploaded = false;
    let submitted = false;
    let scopeOpen = true;
    let submittedValidation: Promise<PromiseSettledResult<void>> | null = null;
    let sourcePreflightComplete = false;
    family.device.pushErrorScope("validation");
    this.packedUniformFrame = {
      arena: slot.arena,
      token,
      owners,
      occurrences: new Map(),
    };
    const commands: GPUCommandBuffer[] = [];
    const discard = () => {
      const retained = new Set(
        family.entries.flatMap(({ canonical }) => [
          ...canonical.resourceTextures.values(),
        ]),
      );
      for (const state of slot.states.values()) {
        for (const texture of new Set(state.resourceTextures.values()))
          if (
            !retained.has(texture) &&
            texture !== this.white &&
            texture !== this.transparent
          )
            this.textureRetirement.push(texture);
        state.resourceTextures.clear();
        state.outputTexture = null;
        state.staticGeneratorPassCache.invalidate();
      }
    };
    const reject = async (error: unknown) => {
      family.cancelled = true;
      family.scheduler.cancel(error);
      for (const item of leases)
        if (item.prepared)
          transaction.fail(item.entry.canonical.instance.id, error);
      let cleanup: unknown;
      try {
        await transaction.finish();
      } catch (failure) {
        if (failure !== error) cleanup = failure;
      }
      await Promise.all(publications);
      const failures: unknown[] = [];
      for (const item of leases) {
        try {
          if (!item.prepared) item.entry.presentation.rollback(item.lease);
        } catch (failure) {
          failures.push(failure);
        }
        try {
          item.entry.presentation.finalize(item.lease);
        } catch (failure) {
          failures.push(failure);
        }
      }
      discard();
      if (cleanup) failures.unshift(cleanup);
      if (failures.length)
        throw new NativeStatelessFrameTransactionError(
          "stateless-frame-rollback-failed",
          "Generated fill rollback could not complete every cleanup.",
          failures,
        );
    };
    try {
      for (const entry of family.entries) {
        const canonical = entry.canonical;
        this.activeMounts.add(canonical);
        const state = slot.states.get(canonical.instance.id)!;
        state.instance = canonical.instance;
        state.definition = canonical.definition;
        state.definitionHash = canonical.definitionHash;
        state.width = canonical.width;
        state.height = canonical.height;
        state.pixelRatio = canonical.pixelRatio;
        state.outputExtent = canonical.outputExtent;
        state.captureInsets = { ...canonical.captureInsets };
        state.clock = { ...canonical.clock };
        const lease = entry.presentation.reserve();
        const item = { entry, lease, prepared: false };
        leases.push(item);
        state.canvas = lease.surface.canvas;
        state.context = lease.surface.context;
        owners.set(state, canonical.instance.id);
        const encoder = family.device.createCommandEncoder();
        const sample = this.beginGpuSample(
          encoder,
          state,
          false,
          state.definitionHash,
          state.instance,
        );
        if (sample) samples.push(sample);
        const localTime = state.clock.paused
          ? state.clock.local
          : state.clock.local + (time - state.clock.global) * state.clock.speed;
        const key = nativeStaticGeneratorPassKey({
          definition: state.definition,
          instance: state.instance,
          executionHash: state.definitionHash,
          reviewedCapability: builtinAnimationCapability(state.definitionHash),
          width: state.width,
          height: state.height,
          pixelRatio: state.pixelRatio,
          workingFormat: this.workingFormat,
          colorSpace: this.colorPresented,
          dynamicRange: this.dynamicRangePresented,
          deviceEpoch: family.deviceEpoch,
          draftActive: false,
          instancePreviewActive: false,
        });
        const outputName =
          state.definition.output ?? state.definition.passes[0]!.output;
        const cached = state.staticGeneratorPassCache.read(
          key,
          state.resourceTextures.get(outputName) ?? null,
        );
        const effect =
          cached ??
          (await this.effectPasses(
            state,
            this.transparent!,
            localTime,
            encoder,
            state.definition,
            state.instance,
            false,
            `${entry.sourceEpoch}`,
            { complete: new Set(), active: new Set() },
            [],
          ));
        const foreground = await this.finish(
          state,
          effect,
          encoder,
          state.instance,
          state.definition,
          "__native_fill_foreground",
        );
        const [background, border, outer, inner] = entry.boxes;
        const underlay = await this.drawCoveredFillPhase(
          state,
          encoder,
          "__native_fill_underlay",
          fillCoveredUnderlayWgsl,
          foreground,
          background,
          [outer, inner],
          true,
        );
        const box = await this.drawCoveredFillPhase(
          state,
          encoder,
          "__native_fill_box",
          fillCoveredBoxWgsl,
          underlay,
          border,
          [outer],
          false,
        );
        const finished = await this.compositeFill(
          state,
          this.transparent!,
          box,
          encoder,
          "__native_final_back",
        );
        await this.present(state, finished, encoder, lease.surface.context);
        if (sample) this.gpuProfiler?.finishSample(sample, encoder);
        commands.push(encoder.finish());
        this.gpuSamples.delete(encoder);
        transaction.register(canonical.instance.id);
        transaction.stage(
          canonical.instance.id,
          new Map([[canonical.instance.id, finished]]),
        );
        let previous: Pick<
          Mount,
          | "canvas"
          | "context"
          | "resourceTextures"
          | "drawBindings"
          | "outputTexture"
          | "fillUnderlayTexture"
          | "fillPhaseTexture"
          | "fillBorderTexture"
          | "fillOuterCoverageTexture"
          | "fillInnerCoverageTexture"
          | "fillPresentationExtent"
          | "committedSourceEpoch"
          | "committedInstancePayload"
          | "committedDefinitionHash"
          | "committedLocalTime"
          | "frameCount"
          | "renderWallSamples"
        > | null = null;
        let attributes: Map<string, string> | null = null;
        const publication = transaction.prepare(canonical.instance.id, {
          assert: () => {
            // All participant assertions and commits run without yielding.
            if (!sourcePreflightComplete) {
              this.assertGeneratedFillFamily(family);
              sourcePreflightComplete = true;
            }
            entry.presentation.assertPublishable(lease);
            previous = {
              canvas: canonical.canvas,
              context: canonical.context,
              resourceTextures: canonical.resourceTextures,
              drawBindings: canonical.drawBindings,
              outputTexture: canonical.outputTexture,
              fillUnderlayTexture: canonical.fillUnderlayTexture,
              fillPhaseTexture: canonical.fillPhaseTexture,
              fillBorderTexture: canonical.fillBorderTexture,
              fillOuterCoverageTexture: canonical.fillOuterCoverageTexture,
              fillInnerCoverageTexture: canonical.fillInnerCoverageTexture,
              fillPresentationExtent: canonical.fillPresentationExtent,
              committedSourceEpoch: canonical.committedSourceEpoch,
              committedInstancePayload: canonical.committedInstancePayload,
              committedDefinitionHash: canonical.committedDefinitionHash,
              committedLocalTime: canonical.committedLocalTime,
              frameCount: canonical.frameCount,
              renderWallSamples: canonical.renderWallSamples,
            };
            attributes = new Map(
              canonical.target
                .getAttributeNames()
                .filter((name) => name.startsWith("data-an-native-"))
                .map((name) => [name, canonical.target.getAttribute(name)!]),
            );
          },
          commit: () => {
            entry.presentation.publish(lease);
            canonical.canvas = lease.surface.canvas;
            canonical.context = lease.surface.context;
            canonical.resourceTextures = state.resourceTextures;
            canonical.drawBindings = state.drawBindings;
            canonical.outputTexture = finished;
            canonical.fillUnderlayTexture = underlay;
            canonical.fillPhaseTexture = finished;
            canonical.fillBorderTexture = border;
            canonical.fillOuterCoverageTexture = outer;
            canonical.fillInnerCoverageTexture = inner;
            canonical.fillPresentationExtent = state.outputExtent;
            canonical.committedSourceEpoch = entry.sourceEpoch;
            canonical.committedInstancePayload = entry.payload;
            canonical.committedDefinitionHash = entry.definitionHash;
            canonical.committedLocalTime = localTime;
            canonical.frameCount += 1;
            canonical.renderWallSamples = [...canonical.renderWallSamples];
            this.recordProfile(
              canonical.renderWallSamples,
              performance.now() - started,
            );
            canonical.target.setAttribute(
              "data-an-native-frames",
              String(canonical.frameCount),
            );
            canonical.target.setAttribute("data-an-native-status", "ready");
            canonical.target.removeAttribute("data-an-native-error");
            canonical.target.removeAttribute("data-an-native-error-message");
            canonical.target.removeAttribute("data-an-native-culled");
          },
          rollback: () => {
            entry.presentation.rollback(lease);
            if (previous) Object.assign(canonical, previous);
            if (attributes) {
              for (const name of canonical.target.getAttributeNames())
                if (name.startsWith("data-an-native-"))
                  canonical.target.removeAttribute(name);
              for (const [name, value] of attributes)
                canonical.target.setAttribute(name, value);
            }
          },
          retire: () => {
            entry.presentation.finalize(lease);
            if (key) state.staticGeneratorPassCache.commit(key, effect);
          },
        });
        item.prepared = true;
        publications.push(
          publication.then<
            PromiseSettledResult<void>,
            PromiseSettledResult<void>
          >(
            () => ({ status: "fulfilled", value: undefined }),
            (reason) => ({ status: "rejected", reason }),
          ),
        );
      }
      this.assertGeneratedFillFamily(family);
      slot.arena.upload(token);
      uploaded = true;
      family.device.queue.submit(commands);
      submitted = true;
      scopeOpen = false;
      const validation = family.device.popErrorScope();
      submittedValidation = validation.then<
        PromiseSettledResult<void>,
        PromiseSettledResult<void>
      >(
        (error) =>
          error
            ? {
                status: "rejected",
                reason: new NativeSourceError("gpu-validation", error.message),
              }
            : { status: "fulfilled", value: undefined },
        (reason) => ({ status: "rejected", reason }),
      );
      slot.arena.finishFrame(token);
      for (const sample of samples) this.gpuProfiler?.afterSubmit(sample);
      const validate = submittedValidation.then((result) => {
        if (result.status === "rejected") throw result.reason;
      });
      return {
        validate,
        publish: async () => {
          try {
            await transaction.finish();
          } catch (error) {
            if (!(error instanceof NativeStatelessFrameRetirementError))
              throw error;
            this.issue(error.code, error.message);
            family.cancelled = true;
            family.scheduler.cancel(error);
          }
          await Promise.all(publications);
          try {
            const wall = performance.now() - started;
            this.recordProfile(this.renderWallSamples, wall);
            for (const { canonical } of family.entries)
              this.postStatus(
                canonical.instance.id,
                canonical.instance.nodeId,
                "ready",
              );
            this.mountedBenchmark?.onRender({
              renderWallMs: wall,
              sourceWallMs: 0,
              composeWallMs: 0,
              failureCount: 0,
            });
            family.cadenceFrames++;
            const elapsed = performance.now() - family.cadenceStart;
            if (elapsed >= 1000) {
              if (
                this.previewPolicy.observeCommittedCadence(
                  elapsed / family.cadenceFrames,
                  family.cadenceFrames,
                )
              ) {
                this.previewDirty = true;
                this.updatePreviewAttributes();
              }
              family.cadenceStart = performance.now();
              family.cadenceFrames = 0;
            }
          } catch (error) {
            family.cancelled = true;
            family.scheduler.cancel(error);
            this.issue(
              "stateless-frame-post-publication-failed",
              error instanceof Error ? error.message : String(error),
            );
          }
        },
        reject,
      };
    } catch (error) {
      if (submittedValidation) {
        const validation = await submittedValidation;
        if (validation.status === "rejected")
          error = new NativeStatelessFrameTransactionError(
            "stateless-frame-validation-cleanup-failed",
            "Generated fill submission and its subsequent preparation failed.",
            [error, validation.reason],
          );
      }
      if (scopeOpen) {
        scopeOpen = false;
        try {
          const cleanup = await family.device.popErrorScope();
          if (cleanup)
            error = new NativeStatelessFrameTransactionError(
              "stateless-frame-validation-cleanup-failed",
              "Generated fill encoding and its GPU validation failed.",
              [error, cleanup],
            );
        } catch (cleanup) {
          error = new NativeStatelessFrameTransactionError(
            "stateless-frame-validation-cleanup-failed",
            "Generated fill encoding and its GPU validation cleanup failed.",
            [error, cleanup],
          );
        }
      }
      if (!submitted) slot.arena.abortFrame(token);
      else if (!uploaded)
        throw new NativeSourceError(
          "uniform-arena-frame-invalid",
          "Submitted generated fills have no immutable uniform upload.",
        );
      for (const sample of samples)
        if (!submitted) this.gpuProfiler?.abandonSample(sample);
      await reject(error);
      throw error;
    } finally {
      this.packedUniformFrame = null;
      this.activeMounts.clear();
    }
  }

  private trackGeneratedFillWork(work: Promise<NativeRenderResult>): void {
    this.generatedFillWork.add(work);
    const snapshot = [...this.generatedFillWork];
    const running = Promise.all(snapshot).then(
      (results) => results[results.length - 1]!,
    );
    this.running = running;
    const forget = () => {
      this.generatedFillWork.delete(work);
    };
    void work.then(forget, forget);
    const clear = () => {
      if (this.running === running) this.running = null;
    };
    void running.then(clear, clear);
  }

  private submitGeneratedFillFrame(
    time: number,
  ): "admitted" | "backpressured" | "serial-required" | "starting" {
    if (!this.generatedFillFamily) {
      if (this.generatedFillStarting) return "starting";
      if (this.running || this.scanning || !this.canPipelineGeneratedFills())
        return "serial-required";
      this.generatedFillStarting = true;
      const start = performance.now();
      const work = this.createGeneratedFillFamily()
        .then(
          (family): NativeRenderResult => {
            this.generatedFillFamily = family;
            return {
              time,
              rendered: 0,
              failures: [],
              renderWallMs: performance.now() - start,
            };
          },
          (error): NativeRenderResult => {
            const failure = {
              code:
                error instanceof NativeSourceError
                  ? error.code
                  : "frame-pipeline-initialization-failed",
              message: error instanceof Error ? error.message : String(error),
            };
            this.issue(failure.code, failure.message);
            return {
              time,
              rendered: 0,
              failures: [failure],
              renderWallMs: performance.now() - start,
            };
          },
        )
        .finally(() => {
          this.generatedFillStarting = false;
        });
      this.trackGeneratedFillWork(work);
      return "starting";
    }
    const family = this.generatedFillFamily;
    try {
      this.assertGeneratedFillFamily(family);
    } catch (error) {
      family.cancelled = true;
      family.scheduler.cancel(error);
      if (!family.scheduler.pendingCount) this.releaseGeneratedFillFamily();
      return "serial-required";
    }
    family.scheduler.takeOutcomes();
    if (!family.scheduler.canSubmit) return "backpressured";
    const started = performance.now();
    this.renderEpoch++;
    const work = family.scheduler
      .submit((slot) => this.prepareGeneratedFillFrame(family, slot, time))
      .then((outcome): NativeRenderResult => {
        if (outcome.status === "fulfilled")
          return {
            time,
            rendered: family.entries.length,
            failures: [],
            renderWallMs: performance.now() - started,
          };
        family.cancelled = true;
        family.scheduler.cancel(outcome.reason);
        const failure = {
          code:
            outcome.reason instanceof NativeSourceError
              ? outcome.reason.code
              : "frame-pipeline-failed",
          message:
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason),
        };
        this.issue(failure.code, failure.message);
        for (const { canonical } of family.entries)
          this.postStatus(
            canonical.instance.id,
            canonical.instance.nodeId,
            "error",
            failure,
          );
        return {
          time,
          rendered: 0,
          failures: [failure],
          renderWallMs: performance.now() - started,
        };
      });
    this.trackGeneratedFillWork(work);
    return "admitted";
  }

  private canPrepareStatelessFrame(): boolean {
    const mounts = [...this.mounts.values()];
    const hasBackdrop = mounts.some(
      (mount) => mount.instance.placement === "backdrop",
    );
    const scene = this.scenePresentation;
    if (!hasBackdrop && scene) return false;
    if (
      hasBackdrop &&
      (!scene ||
        !this.hasCurrentScenePresentation(scene) ||
        scene.provider.sourceEpoch?.() !== scene.committedSourceEpoch)
    )
      return false;
    return mounts.every(
      (mount) =>
        (mount.instance.placement === "fill" ||
          mount.instance.placement === "backdrop") &&
        mount.isTopLayer &&
        !mount.frozenReason &&
        mount.suppressed &&
        !!mount.outputTexture &&
        mount.canvas.isConnected &&
        mount.target.getAttribute("data-an-native-status") === "ready" &&
        mount.committedInstancePayload === JSON.stringify(mount.instance) &&
        mount.committedDefinitionHash === mount.definitionHash &&
        mount.committedSourceEpoch === mount.provider?.sourceEpoch?.() &&
        !mount.previousFillId &&
        !mount.previousLayerId &&
        !mount.definition.resourceGraph &&
        !mount.definition.statelessCompute &&
        !mount.definition.simulation &&
        !mount.definition.feedback &&
        !mount.definition.interaction &&
        !mount.authoredInputs.size &&
        !Object.keys(mount.instance.bindings ?? {}).length &&
        (mount.instance.placement === "backdrop" ||
          (mount.definition.kind === "generator" &&
            !Object.keys(mount.definition.inputs ?? {}).length)) &&
        !mounts.some(
          (other) =>
            other !== mount &&
            (other.target.contains(mount.target) ||
              mount.target.contains(other.target)),
        ),
    );
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
    draftTarget?: { instanceId: string; strictTime: boolean },
  ): Promise<NativeRenderResult> => {
    if (this.generatedFillFamily) {
      this.generatedFillFamily.cancelled = true;
      this.generatedFillFamily.scheduler.cancel(
        new NativeSourceError(
          "source-epoch-stale",
          "A serial native render superseded the generated fill pipeline.",
        ),
      );
      while (this.running) await this.running;
      this.releaseGeneratedFillFamily();
    }
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
    if (this.mounts.size === 0) {
      this.authoredInputReuse = new WeakMap();
      this.authoredInputReuseEpoch = -1;
      return {
        time,
        rendered: 0,
        failures: [...this.scanFailures],
        renderWallMs: 0,
      };
    }
    while (this.running) await this.running;
    this.releaseGeneratedFillFamily();
    if (this.disposed)
      throw new NativeSourceError("runtime-disposed", "runtime-disposed");
    const benchmarkMetrics = this.mountedBenchmark
      ? {
          sourceWallMs: 0,
          composeWallMs: 0,
          hostWallPhases: emptyNativeBenchmarkPhaseValues(),
          fullFrameWallPhases: emptyNativeBenchmarkFullFrameValues(),
          sourceReadDetail: emptyNativeSourceReadSceneMetrics(),
        }
      : null;
    this.mountedBenchmarkRenderMetrics = benchmarkMetrics;
    this.scopedDraftTimeInstanceId = draftTarget?.strictTime
      ? draftTarget.instanceId
      : null;
    let sceneBudgetExceeded = false;
    let previewInactive = false;
    this.running = (async () => {
      const started = performance.now();
      const failures: Diagnostic[] = deterministic
        ? [...this.scanFailures]
        : [];
      const complete = new Set<string>();
      let preparedFrame: NativeStatelessFrameContext | null = null;
      const reportedSubmissionErrors = new Set<unknown>();
      const flushSubmissions = async (): Promise<void> => {
        const outcomes = await this.submissionPipeline?.flush();
        for (const outcome of outcomes ?? []) {
          if (
            outcome.status !== "rejected" ||
            reportedSubmissionErrors.has(outcome.reason)
          )
            continue;
          const error = outcome.reason;
          const code =
            error instanceof NativeSourceError ? error.code : "render-failed";
          const message =
            error instanceof Error ? error.message : String(error);
          failures.push({ code, message });
          this.issue(code, message);
        }
      };
      try {
        const viewportVisible = this.refreshPreviewViewport();
        const ordinaryPreview =
          !deterministic &&
          !draftTarget &&
          !this.draft &&
          !this.instancePreview &&
          this.compositionPixelRatio === null &&
          this.exportInitialPixelRatio === null &&
          !this.compositionOutputRegion &&
          !this.compositionAbort &&
          !this.compositionPixelBusy &&
          ![...this.mounts.values()].some(
            (mount) =>
              mount.definition.simulation ||
              mount.definition.feedback ||
              isStatefulResourceGraph(mount.definition.resourceGraph),
          );
        if (
          ordinaryPreview &&
          (!viewportVisible ||
            ![...this.mounts.values()].some(
              (mount) =>
                this.hasPresentationGeometry(mount.target) &&
                !this.groupLocalNoncontributing(mount) &&
                !this.offscreen(mount),
            ))
        ) {
          previewInactive = true;
          for (const mount of this.mounts.values())
            mount.target.setAttribute("data-an-native-culled", "true");
          this.releaseScenePresentation();
          this.restoreIndividualPresentationsAfterSceneFailure();
          return { time, rendered: 0, failures, renderWallMs: 0 };
        }
        if (!viewportVisible)
          return { time, rendered: 0, failures: [], renderWallMs: 0 };
        this.previewFrameHostGeneration = this.previewHostGeneration;
        this.renderEpoch += 1;
        const deviceStarted = benchmarkMetrics ? performance.now() : 0;
        await this.ensureDevice();
        const densityTransition = this.planPreviewTargetDensities();
        if (densityTransition) await this.drainTextureRetirement();
        if (
          !deterministic &&
          !densityTransition &&
          !draftTarget &&
          !this.draft &&
          !this.instancePreview &&
          this.compositionPixelRatio === null &&
          this.exportInitialPixelRatio === null &&
          !this.compositionOutputRegion &&
          !this.compositionAbort &&
          !this.compositionPixelBusy &&
          !this.presentationFaultHold &&
          !this.presentationFaultLatch.pending() &&
          this.canPrepareStatelessFrame()
        ) {
          let resolveSubmission!: () => void;
          let rejectSubmission!: (error: unknown) => void;
          const submission = new Promise<void>((resolve, reject) => {
            resolveSubmission = resolve;
            rejectSubmission = reject;
          });
          const submissionOutcome = submission.then<
            PromiseSettledResult<void>,
            PromiseSettledResult<void>
          >(
            () => ({ status: "fulfilled", value: undefined }),
            (reason) => ({ status: "rejected", reason }),
          );
          preparedFrame = {
            transaction:
              new NativeStatelessFrameTransaction<NativeFrameCandidate>(),
            candidates: new Map(),
            jobs: new Map(),
            publishing: false,
            statuses: [],
            commands: [],
            markQueued: [],
            afterSubmit: [],
            submission,
            submissionOutcome,
            resolveSubmission,
            rejectSubmission,
            validationScope: {
              device: this.device!,
              epoch: this.deviceEpoch,
              open: false,
            },
          };
          this.frameTransaction = preparedFrame;
          preparedFrame.validationScope.device.pushErrorScope("validation");
          preparedFrame.validationScope.open = true;
          for (const mount of this.mounts.values())
            this.activeMounts.add(mount);
        }
        if (benchmarkMetrics) {
          const deviceWallMs = performance.now() - deviceStarted;
          benchmarkMetrics.hostWallPhases.deviceWallMs += deviceWallMs;
          benchmarkMetrics.fullFrameWallPhases.frame.deviceWallMs +=
            deviceWallMs;
        }
        const mountsStarted = benchmarkMetrics ? performance.now() : 0;
        const orderedMounts = [...this.mounts.values()];
        if (densityTransition)
          orderedMounts.sort((first, second) => {
            const direction = (mount: Mount): number =>
              Math.sign(
                (this.previewTargetDensities.get(mount.target) ??
                  mount.pixelRatio) - mount.pixelRatio,
              );
            return direction(first) - direction(second);
          });
        const renderOne = async (
          mount: Mount,
          onSubmitted?: () => void,
        ): Promise<void> => {
          try {
            if (preparedFrame)
              await this.renderStatelessFrameMount(
                mount,
                time,
                deterministic,
                complete,
                new Set(),
              );
            else
              await this.renderMount(
                mount,
                time,
                deterministic,
                complete,
                new Set(),
                onSubmitted,
              );
            if (densityTransition) await this.drainTextureRetirement();
          } catch (error) {
            if (onSubmitted) reportedSubmissionErrors.add(error);
            if (this.disposed) {
              failures.push({
                code: "runtime-disposed",
                message: "runtime-disposed",
                instanceId: mount.instance.id,
              });
              return;
            }
            const retainedFill = this.retainedFillPresentation(mount);
            if (mount.instance.placement === "fill" && !retainedFill)
              this.restoreFillGroup(mount.target);
            else if (!mount.outputTexture) this.showOriginal(mount);
            const diagnostic = {
              code:
                error instanceof NativeSourceError
                  ? error.code
                  : error instanceof NativeFeedbackFailure ||
                      error instanceof NativeUniformTimingError
                    ? error.code
                    : error instanceof NativeSimulationTransactionError ||
                        error instanceof NativeSimulationTimelineError
                      ? error.code
                      : "render-failed",
              message: error instanceof Error ? error.message : String(error),
              instanceId: mount.instance.id,
            };
            if (
              diagnostic.code === "gpu-budget-exceeded" ||
              diagnostic.code === "resource-budget-exceeded" ||
              diagnostic.code === "source-composition-budget-exceeded"
            )
              sceneBudgetExceeded = true;
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
              (mount.instance.placement === "fill" && !retainedFill) ||
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
            if (onSubmitted) throw error;
          }
        };
        const pipeline =
          !preparedFrame &&
          !deterministic &&
          !this.compositionOutputRegion &&
          this.compositionPixelRatio === null &&
          this.exportInitialPixelRatio === null &&
          !draftTarget &&
          !this.draft &&
          !densityTransition &&
          !this.presentationFaultHold &&
          !this.presentationFaultLatch.pending()
            ? new NativeSubmissionPipeline()
            : null;
        this.submissionPipeline = pipeline;
        const statelessFill = (mount: Mount): boolean =>
          Boolean(
            pipeline &&
            mount.isTopLayer &&
            mount.instance.placement === "fill" &&
            mount.definition.kind === "generator" &&
            !mount.previousLayerId &&
            !mount.previousFillId &&
            !mount.definition.resourceGraph &&
            !mount.definition.statelessCompute &&
            !mount.definition.simulation &&
            !mount.definition.feedback &&
            !mount.definition.interaction &&
            !Object.keys(mount.definition.inputs ?? {}).length &&
            !Object.keys(mount.instance.bindings ?? {}).length,
          );
        const eligible = (mount: Mount): boolean =>
          statelessFill(mount) &&
          !orderedMounts.some(
            (other) =>
              other !== mount &&
              (other.target.contains(mount.target) ||
                mount.target.contains(other.target)),
          );
        // The owner goes first: its external dependencies must commit before other submissions can hold the encoding lane.
        const atomicOwner = orderedMounts.find((mount) => {
          if (!statelessFill(mount) || this.offscreen(mount)) return false;
          const related = orderedMounts.filter(
            (other) =>
              other !== mount &&
              (other.target.contains(mount.target) ||
                mount.target.contains(other.target)),
          );
          return (
            related.length > 0 &&
            related.every(
              (child) =>
                child.target !== mount.target &&
                mount.target.contains(child.target) &&
                child.instance.placement === "backdrop" &&
                this.nestedBackdropOwner(child.target) === mount &&
                !child.previousLayerId &&
                !child.previousFillId &&
                !child.definition.resourceGraph &&
                !child.definition.statelessCompute &&
                !child.definition.simulation &&
                !child.definition.feedback &&
                !child.definition.interaction &&
                !Object.keys(child.instance.bindings ?? {}).length,
            )
          );
        });
        if (pipeline)
          orderedMounts.sort((first, second) => {
            const rank = (mount: Mount) =>
              mount === atomicOwner ? 2 : Number(eligible(mount));
            return rank(second) - rank(first);
          });
        for (const mount of orderedMounts) {
          if (!this.hasPresentationGeometry(mount.target)) {
            mount.canvas.style.visibility = "hidden";
            mount.target.setAttribute("data-an-native-culled", "true");
            continue;
          }
          if (
            !deterministic &&
            !this.compositionOutputRegion &&
            mount.instance.id !== draftTarget?.instanceId &&
            this.offscreen(mount) &&
            !(
              densityTransition &&
              (this.previewTargetDensities.get(mount.target) ??
                mount.pixelRatio) < mount.pixelRatio
            )
          ) {
            mount.target.setAttribute("data-an-native-culled", "true");
            continue;
          }
          if (mount === atomicOwner || eligible(mount))
            await pipeline!.submit(mount.instance.id, (submitted) =>
              renderOne(mount, submitted),
            );
          else {
            await flushSubmissions();
            await renderOne(mount);
          }
        }
        await flushSubmissions();
        this.submissionPipeline = null;

        if (preparedFrame) {
          if (
            !failures.length &&
            orderedMounts.some(
              (mount) => mount.instance.placement === "backdrop",
            )
          ) {
            let sceneJobId = "__native_scene_frame__";
            while (preparedFrame.jobs.has(sceneJobId)) sceneJobId += "_";
            preparedFrame.transaction.register(sceneJobId);
            let release!: () => void;
            const submitted = new Promise<void>((resolve) => {
              release = resolve;
            });
            const frame = preparedFrame;
            const sceneTask = this.presentScene(release, sceneJobId).finally(
              release,
            );
            const outcome = sceneTask.then<
              PromiseSettledResult<void>,
              PromiseSettledResult<void>
            >(
              () => ({ status: "fulfilled", value: undefined }),
              (error) => {
                frame.transaction.fail(sceneJobId, error);
                return { status: "rejected", reason: error };
              },
            );
            frame.jobs.set(sceneJobId, { submitted, outcome });
            await submitted;
          }
          if (failures.length)
            throw new NativeSourceError(
              failures[0]!.code,
              failures[0]!.message,
            );
          await this.submitStatelessFrame(preparedFrame);
          await preparedFrame.transaction.finish();
          const submissionOutcome = await preparedFrame.submissionOutcome;
          if (submissionOutcome.status === "rejected")
            throw submissionOutcome.reason;
          const outcomes = await Promise.all(
            [...preparedFrame.jobs.values()].map((job) => job.outcome),
          );
          const rejected = outcomes.find(
            (outcome) => outcome.status === "rejected",
          );
          if (rejected?.status === "rejected") throw rejected.reason;
          this.frameTransaction = null;
          for (const status of preparedFrame.statuses) status();
        }

        if (benchmarkMetrics)
          benchmarkMetrics.fullFrameWallPhases.frame.mountAwaitWallMs +=
            performance.now() - mountsStarted;
        if (!this.compositionOutputRegion && !preparedFrame) {
          const hasBackdrop = [...this.mounts.values()].some(
            (mount) =>
              mount.instance.placement === "backdrop" &&
              this.hasPresentationGeometry(mount.target),
          );
          if (!hasBackdrop) this.releaseScenePresentation();
          else if (failures.length > 0) {
            const scene = this.scenePresentation;
            if (
              scene === null ||
              scene.committedSourceEpoch === null ||
              !this.hasCurrentScenePresentation(scene)
            ) {
              if (scene) this.releaseScenePresentation();
              this.restoreIndividualPresentationsAfterSceneFailure();
            } else {
              for (const mounted of this.mounts.values()) {
                if (mounted.reportedStatus?.status !== "ready") continue;
                const status = scene.committedInstances.has(mounted.instance.id)
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
            }
          } else {
            const sceneStarted = benchmarkMetrics ? performance.now() : 0;
            try {
              if (!deterministic && this.sceneBudgetStillFaulted())
                throw new NativeSourceError(
                  "source-composition-budget-exceeded",
                  "The full-scene native presentation exceeds the texture budget.",
                );
              await this.presentScene();
            } catch (error) {
              sceneBudgetExceeded =
                error instanceof NativeSourceError &&
                error.code === "source-composition-budget-exceeded";
              throw error;
            } finally {
              if (benchmarkMetrics)
                benchmarkMetrics.fullFrameWallPhases.frame.scenePresentationWallMs +=
                  performance.now() - sceneStarted;
            }
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
      } catch (error) {
        if (preparedFrame) {
          if (preparedFrame.validationScope.open)
            try {
              const cleanupError =
                await this.closeStatelessFrameScope(preparedFrame);
              if (cleanupError)
                error = new NativeStatelessFrameTransactionError(
                  "stateless-frame-validation-cleanup-failed",
                  "The rejected native frame also failed GPU validation cleanup.",
                  [error, cleanupError],
                );
            } catch (cleanupError) {
              error = new NativeStatelessFrameTransactionError(
                "stateless-frame-validation-cleanup-failed",
                "The rejected native frame validation scope could not close.",
                [error, cleanupError],
              );
            }
          preparedFrame.rejectSubmission(error);
          for (const id of preparedFrame.jobs.keys())
            preparedFrame.transaction.fail(id, error);
          try {
            await preparedFrame.transaction.finish();
          } catch (frameError) {
            error = frameError;
          }
          await Promise.all(
            [...preparedFrame.jobs.values()].map((job) => job.outcome),
          );
          await preparedFrame.submissionOutcome;
          this.frameTransaction = null;
          preparedFrame.statuses.length = 0;
          if (!(error instanceof NativeStatelessFrameRetirementError))
            complete.clear();
        }
        this.retainScenePresentationOnFailure();
        const scene = this.scenePresentation;
        const hasCommittedScene =
          scene !== null &&
          scene.committedSourceEpoch !== null &&
          this.hasCurrentScenePresentation(scene);
        if (!hasCommittedScene)
          this.restoreIndividualPresentationsAfterSceneFailure();
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof NativeSourceError ||
          error instanceof NativeDeviceLifecycleError ||
          error instanceof NativeStatelessFrameTransactionError ||
          error instanceof NativeStatelessFrameRetirementError ||
          error instanceof NativeUniformTimingError
            ? error.code
            : "webgpu-unavailable";
        if (
          code === "gpu-budget-exceeded" ||
          code === "resource-budget-exceeded" ||
          code === "source-composition-budget-exceeded"
        )
          sceneBudgetExceeded = true;
        if (
          !failures.some(
            (failure) => failure.code === code && failure.message === message,
          )
        )
          failures.push({ code, message });
        for (const mount of this.mounts.values()) {
          if (
            !hasCommittedScene &&
            mount.instance.placement !== "backdrop" &&
            mount.outputTexture &&
            mount.suppressed
          )
            continue;
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
      } finally {
        await flushSubmissions();
        this.submissionPipeline = null;
        const retirementStarted = benchmarkMetrics ? performance.now() : 0;
        try {
          if (!previewInactive) this.retireBindings();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failures.push({ code: "gpu-retirement", message });
          this.issue("gpu-retirement", message);
        }
        if (benchmarkMetrics)
          benchmarkMetrics.fullFrameWallPhases.frame.retirementWallMs +=
            performance.now() - retirementStarted;
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
        new NativeMountedBenchmarkError(
          "benchmark-render-failed",
          nativeMountedBenchmarkFailure(error),
        ),
      );
      throw error;
    } finally {
      this.mountedBenchmarkRenderMetrics = null;
      this.scopedDraftTimeInstanceId = null;
      this.authoredInputReuse = new WeakMap();
      this.authoredInputReuseEpoch = -1;
      for (const mount of this.mounts.values())
        for (const capture of mount.authoredInputs.values())
          capture.borrowed = undefined;
      // Dependency textures remain pinned until every parent encoder has submitted.
      this.activeMounts.clear();
      this.running = null;
    }
    if (previewInactive) return result;
    if (!deterministic) {
      if (
        sceneBudgetExceeded &&
        !this.sceneBudgetFault &&
        this.compositionPixelRatio === null &&
        !this.compositionAbort &&
        !this.compositionPixelBusy
      ) {
        if (this.previewPolicy.observeResourceBudgetExceeded()) {
          this.previewDirty = true;
          this.updatePreviewAttributes();
          if (!this.raf && this.mounts.size)
            this.raf = requestAnimationFrame(this.frame);
        } else {
          this.sceneBudgetFault = {
            signature: this.sceneBudgetSignature(),
            resourceBytes: this.estimatedResourceBytes(),
          };
        }
      }
      this.recordProfile(this.renderWallSamples, result.renderWallMs);
      if (this.mountedBenchmark && benchmarkMetrics)
        this.mountedBenchmark.onRender({
          renderWallMs: result.renderWallMs,
          sourceWallMs: benchmarkMetrics.sourceWallMs,
          composeWallMs: benchmarkMetrics.composeWallMs,
          hostWallPhases: benchmarkMetrics.hostWallPhases,
          fullFrameWallPhases: benchmarkMetrics.fullFrameWallPhases,
          sourceReadDetail: benchmarkMetrics.sourceReadDetail,
          failureCount: result.failures.length,
          failure: result.failures[0],
        });
      if (
        !this.compositionAbort &&
        !this.compositionPixelBusy &&
        this.compositionPixelRatio === null &&
        !sceneBudgetExceeded &&
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

  renderAtWithPixelRatio = async (
    time: number,
    pixelRatio: number,
  ): Promise<NativeRenderResult> => {
    this.assertCompositionIdle();
    if (!Number.isFinite(time) || time < 0)
      throw new NativeSourceError(
        "composition-invalid-frame",
        "The explicit native validation time must be finite and nonnegative.",
      );
    if (
      !Number.isFinite(pixelRatio) ||
      pixelRatio <= 0 ||
      pixelRatio > 4 ||
      this.compositionPixelRatio !== null
    )
      throw new NativeSourceError(
        "composition-size-unsupported",
        "The explicit native validation pixel ratio is unsupported.",
      );
    this.compositionPixelRatio = pixelRatio;
    this.compositionPixelBusy = true;
    let previewDensityRestoreAttempted = false;
    const restorePreviewDensityForValidation = async (time: number) => {
      this.compositionPixelRatio = null;
      previewDensityRestoreAttempted = true;
      if (
        (pixelRatio === this.previewStatus().effectivePixelRatio &&
          this.previewViewport === null) ||
        this.mounts.size === 0 ||
        this.disposed ||
        this.compositionUnsafe
      )
        return;
      const restored = await this.restorePreviewDensity(time);
      if (restored.failures.length)
        throw new NativeRenderFailure(restored, "preview-density");
    };
    try {
      const held = await this.withSynchronizedCompositionFrame(
        {
          frameIndex: 0,
          fps: 60,
          startTimeSeconds: time,
          sourceContract: "declarative-only",
        },
        async (rendered, frame) => {
          await restorePreviewDensityForValidation(frame.timeSeconds);
          return rendered;
        },
        true,
      );
      return held.value;
    } catch (error) {
      if (!previewDensityRestoreAttempted) {
        try {
          await restorePreviewDensityForValidation(this.currentTime());
        } catch (restoreError) {
          throw new NativePixelCleanupError([error, restoreError]);
        }
      }
      throw error;
    } finally {
      this.compositionPixelRatio = null;
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

  setParameters = async (
    instanceId: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    this.assertCompositionIdle();
    if (this.scanning) await this.scanning;
    if (this.running) await this.running;
    if (this.workerScene) {
      const index = this.workerEntries.findIndex(
        (entry) => entry.instance.id === instanceId,
      );
      const entry = this.workerEntries[index];
      if (!entry)
        throw new Error(`Native effect ${instanceId} is not mounted.`);
      const nextParams = {
        ...entry.instance.params,
        ...params,
      } as EffectInstance["params"];
      packNativeProperties(entry.definition, nextParams);
      const previousEntries = this.workerEntries;
      const nextEntries = [...previousEntries];
      nextEntries[index] = {
        ...entry,
        instance: { ...entry.instance, params: nextParams },
      };
      this.workerEntries = nextEntries;
      try {
        await this.workerScene.setEntriesAndWait(nextEntries, instanceId);
      } catch (error) {
        if (this.workerEntries === nextEntries) {
          this.workerEntries = previousEntries;
          this.workerScene?.setEntries(previousEntries);
        }
        throw error;
      }
      return;
    }
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

  setSimulationExportParameters = (options: {
    sessionId: string;
    instanceId: string;
    nodeId: string;
    executionHash: string;
    params: Record<string, number>;
    signal?: AbortSignal;
  }): { instanceId: string; updatedProperties: string[] } => {
    this.assertCompositionIdle(true);
    if (options.signal?.aborted) throw options.signal.reason;
    const session = this.simulationExportSession;
    if (session?.sourceStale)
      throw new NativeSourceError(
        "simulation-session-source-stale",
        "The preview source changed during the held render session.",
      );
    if (
      !session ||
      session.id !== options.sessionId ||
      session.failed ||
      session.nextFrame < 1
    )
      throw new NativeSourceError(
        "simulation-session-invalid",
        "A parameter update requires the current held simulation session after its first frame.",
      );
    const mount = this.mounts.get(options.instanceId);
    if (
      !mount ||
      !session.saved.some((saved) => saved.mount === mount) ||
      mount.instance.nodeId !== options.nodeId ||
      mount.definitionHash !== options.executionHash ||
      this.draft?.instanceId === options.instanceId
    )
      throw new NativeSourceError(
        "simulation-session-target-stale",
        "The held parameter target no longer matches the approved native effect.",
      );
    const entries = Object.entries(options.params);
    if (
      entries.length < 1 ||
      entries.length > 16 ||
      entries.some(([name, value]) => {
        const property = mount.definition.properties[name];
        return (
          !property ||
          (property.type !== "float" && property.type !== "int") ||
          !Number.isFinite(value)
        );
      })
    )
      throw new NativeSourceError(
        "simulation-session-params-invalid",
        "Held parameter updates accept only bounded numeric native properties.",
      );
    const previous = mount.instance;
    const nextParams = {
      ...previous.params,
      ...options.params,
    } as EffectInstance["params"];
    try {
      packNativeProperties(mount.definition, nextParams);
      mount.instance = { ...previous, params: nextParams };
      this.markMountRenderPending(mount);
      return {
        instanceId: mount.instance.id,
        updatedProperties: entries.map(([name]) => name),
      };
    } catch (error) {
      mount.instance = previous;
      throw new NativeSourceError(
        "simulation-session-params-invalid",
        String(error),
      );
    }
  };

  private releaseDraftResources(draft: DraftPreview): void {
    this.releaseDraftSimulation(draft);
    draft.statefulFrame?.abandon();
    draft.statefulFrame = null;
    draft.statefulCandidate?.executor.dispose();
    draft.statefulCandidate = null;
    draft.stateful?.executor.dispose();
    draft.stateful = null;
    for (const texture of draft.statefulResources.values())
      if (!this.textureRetirement.includes(texture))
        this.textureRetirement.push(texture);
    draft.statefulResources.clear();
    this.releaseDraftFeedback(draft);
    for (const texture of draft.resources.values())
      if (!this.textureRetirement.includes(texture))
        this.textureRetirement.push(texture);
    draft.resources.clear();
  }

  private clearDraftState(): void {
    const draft = this.draft;
    if (!draft) return;
    this.releaseDraftResources(draft);
    const mount = this.mounts.get(draft.instanceId);
    if (mount && draft.showDraft && draft.publishedTexture) {
      if (
        mount.outputTexture &&
        !this.textureRetirement.includes(mount.outputTexture)
      )
        this.textureRetirement.push(mount.outputTexture);
      mount.outputTexture = draft.publishedTexture;
    } else if (draft.publishedTexture) {
      if (!this.textureRetirement.includes(draft.publishedTexture))
        this.textureRetirement.push(draft.publishedTexture);
    }
    if (
      draft.lastGoodTexture &&
      !this.textureRetirement.includes(draft.lastGoodTexture)
    )
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

  private async applyWorkerInstancePreview(
    request: NativeInstancePreviewRequest,
    generation: number,
  ): Promise<void> {
    const worker = this.workerScene;
    const index = this.workerEntries.findIndex(
      (entry) => entry.instance.id === request.instanceId,
    );
    const entry = this.workerEntries[index];
    if (!worker || !entry || entry.instance.nodeId !== request.nodeId) {
      this.postInstancePreviewResult(
        request,
        "error",
        "published",
        "instance-preview-target-stale",
      );
      return;
    }
    if (entry.definitionHash !== request.baseExecutionHash) {
      this.postInstancePreviewResult(
        request,
        "error",
        this.instancePreviewDisplay(request.instanceId),
        "instance-preview-definition-stale",
      );
      return;
    }
    const active = this.instancePreview;
    const base =
      active?.instanceId === request.instanceId && this.workerPreviewBase
        ? this.workerPreviewBase
        : entry.instance;
    const signature = await hashEffectInstance(base);
    if (generation !== this.instancePreviewGeneration) return;
    if (
      signature !== request.baseInstanceSignature ||
      (request.type === "native-effect-clear-instance" &&
        active &&
        (active.instanceId !== request.instanceId ||
          active.nodeId !== request.nodeId ||
          active.baseInstanceSignature !== signature))
    ) {
      this.postInstancePreviewResult(
        request,
        "error",
        this.instancePreviewDisplay(request.instanceId),
        "instance-preview-base-stale",
      );
      return;
    }
    const candidate: EffectInstance =
      request.type === "native-effect-clear-instance"
        ? base
        : {
            ...base,
            opacity: request.opacity,
            ...(request.transform === null
              ? { transform: undefined }
              : { transform: request.transform }),
          };
    if (
      !validateEffectDocument({
        schemaVersion: 2,
        definitions: [entry.definition],
        instances: [candidate],
      }).valid
    ) {
      this.postInstancePreviewResult(
        request,
        "error",
        this.instancePreviewDisplay(request.instanceId),
        "instance-preview-invalid",
      );
      return;
    }
    const previousEntries = this.workerEntries;
    const previousBase = this.workerPreviewBase;
    const previousPreview = this.instancePreview;
    const nextEntries = [...this.workerEntries];
    if (active && active.instanceId !== request.instanceId && previousBase) {
      const oldIndex = nextEntries.findIndex(
        (candidate) => candidate.instance.id === active.instanceId,
      );
      if (oldIndex >= 0)
        nextEntries[oldIndex] = {
          ...nextEntries[oldIndex]!,
          instance: previousBase,
        };
    }
    nextEntries[index] = { ...entry, instance: candidate };
    this.workerEntries = nextEntries;
    this.workerPreviewBase =
      request.type === "native-effect-clear-instance" ? null : base;
    this.instancePreview =
      request.type === "native-effect-clear-instance"
        ? null
        : {
            instanceId: request.instanceId,
            nodeId: request.nodeId,
            baseInstanceSignature: signature,
            instance: candidate,
          };
    try {
      await worker.setEntriesAndWait(nextEntries, request.instanceId);
      if (generation === this.instancePreviewGeneration)
        this.postInstancePreviewResult(
          request,
          "ready",
          this.instancePreviewDisplay(request.instanceId),
        );
    } catch (error) {
      if (generation === this.instancePreviewGeneration) {
        this.workerEntries = previousEntries;
        this.workerPreviewBase = previousBase;
        this.instancePreview = previousPreview;
        worker.setEntries(previousEntries);
        this.postInstancePreviewResult(
          request,
          "error",
          this.instancePreviewDisplay(request.instanceId),
          error instanceof NativeWorkerHostError
            ? error.code
            : "instance-preview-render-failed",
        );
      }
    }
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
      if (this.workerScene) {
        await this.applyWorkerInstancePreview(request, generation);
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
    this.draftPendingCount += 1;
    this.draftRequestPending = true;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      await this.enqueueDraftWork(generation, () =>
        this.previewDraftImpl(request, generation),
      );
    } finally {
      this.draftPendingCount -= 1;
      if (this.draftPendingCount === 0) {
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
    else if (previous) this.releaseDraftResources(previous);
    if (
      previous &&
      previous.instanceId === instanceId &&
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
      caughtUp: mount.simulationCaughtUp,
      simulation: null,
      simulationFrame: null,
      pointerHistory:
        definition.simulation || definition.interaction
          ? new NativePointerHistory(request.time)
          : null,
      stateful: null,
      statefulCandidate: null,
      statefulFrame: null,
      statefulResources: new Map(),
      feedback: null,
      feedbackCandidate: null,
      feedbackFrame: null,
      resources: new Map(),
      publishedResources: mount.resourceTextures,
    };
    const started = performance.now();
    const strictTime =
      !!definition.simulation ||
      !!definition.feedback ||
      isStatefulResourceGraph(definition.resourceGraph);
    const result = await this.renderInternal(this.currentTime(), false, {
      instanceId,
      strictTime,
    });
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
    this.draftPendingCount += 1;
    this.draftRequestPending = true;
    this.rafIntervalTelemetry.reset();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      await this.enqueueDraftWork(generation, () =>
        this.controlDraftImpl(request, generation),
      );
    } finally {
      this.draftPendingCount -= 1;
      if (this.draftPendingCount === 0) {
        this.draftRequestPending = false;
        if (!this.disposed && this.mounts.size) this.frame();
      }
    }
  }

  private enqueueDraftWork(
    generation: number,
    run: () => Promise<void>,
  ): Promise<void> {
    const work = this.draftWorkSettled.then(() => {
      if (this.disposed)
        throw new NativeSourceError(
          "draft-runtime-disposed",
          "The native shader runtime was disposed before draft control.",
        );
      this.draftGeneration = generation;
      return run();
    });
    this.draftWorkSettled = Promise.allSettled([work]).then(
      ([result]) => result,
    );
    return work;
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
      draft.baseExecutionHash !== request.baseExecutionHash ||
      (request.expectedExecutionHash !== undefined &&
        request.expectedExecutionHash !== draft.executionHash)
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
    const previousClock = {
      time: draft.time,
      playing: draft.playing,
      clockOrigin: draft.clockOrigin,
    };
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
    if (request.command !== "clear") draft.generation = generation;
    const started = performance.now();
    const activeDraft = request.command !== "clear" && draft.showDraft;
    const definition = activeDraft ? draft.definition : mount.definition;
    const strictTime =
      activeDraft &&
      (!!definition.simulation ||
        !!definition.feedback ||
        isStatefulResourceGraph(definition.resourceGraph));
    let result: Awaited<ReturnType<typeof this.renderInternal>>;
    try {
      result = await this.renderInternal(this.currentTime(), false, {
        instanceId,
        strictTime,
      });
    } catch (error) {
      if (["set-time", "play", "pause"].includes(request.command)) {
        draft.time = previousClock.time;
        draft.playing = previousClock.playing;
        draft.clockOrigin = previousClock.clockOrigin;
      }
      throw error;
    }
    const failure = result.failures.find(
      (item) => !item.instanceId || item.instanceId === instanceId,
    );
    const diagnostics = failure
      ? this.draftDiagnostics(failure)
      : this.draft?.showDraft && this.draft.failedReason
        ? [this.draft.failedReason]
        : [];
    const diagnostic = diagnostics[0];
    if (diagnostic && ["set-time", "play", "pause"].includes(request.command)) {
      draft.time = previousClock.time;
      draft.playing = previousClock.playing;
      draft.clockOrigin = previousClock.clockOrigin;
    }
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
      mount.pointerHistory?.reset(clock.local);
      this.markMountRenderPending(mount);
    }
    if (this.workerScene) {
      const instanceId = this.workerEntries[0]?.instance.id;
      if (!instanceId)
        throw new NativeSourceError(
          "worker-instance-missing",
          "The native worker has no effect to seek.",
        );
      await this.workerScene.setEntriesAndWait(this.workerEntries, instanceId);
      return;
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
    if (this.workerScene) {
      this.workerScene.requestUpdate();
      return;
    }
    this.frame();
  };
  pause = (): void => {
    if (this.generatedFillFamily) {
      this.generatedFillFamily.cadenceStart = performance.now();
      this.generatedFillFamily.cadenceFrames = 0;
      this.previewPolicy.resetCommittedCadence();
    }
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
    this.workerScene?.requestUpdate();
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
    if (this.generatedFillFamily) {
      this.generatedFillFamily.cancelled = true;
      this.generatedFillFamily.scheduler.cancel(
        new NativeSourceError(
          "source-epoch-stale",
          "A synchronized composition owns native rendering.",
        ),
      );
    }
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
      this.releaseGeneratedFillFamily();
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

  capturePointerHistories = (options: {
    expectedInstances: readonly {
      instanceId: string;
      nodeId: string;
      definitionId: string;
      definitionVersion: number;
      executionHash: string;
      instanceJson: string;
    }[];
    fps: number;
    totalFrames: number;
    startTimeSeconds: number;
  }): NativePointerReplayEntry[] => {
    if (
      !Number.isSafeInteger(options.fps) ||
      options.fps < 1 ||
      options.fps > 120 ||
      !Number.isSafeInteger(options.totalFrames) ||
      options.totalFrames < 1 ||
      options.totalFrames > 3600 ||
      !Number.isFinite(options.startTimeSeconds) ||
      options.startTimeSeconds < 0 ||
      options.expectedInstances.length > 128 ||
      new Set(options.expectedInstances.map((item) => item.instanceId)).size !==
        options.expectedInstances.length
    )
      throw new NativePointerHistoryError();
    const now = this.currentTime();
    return options.expectedInstances.map((item) => {
      const mount = this.mounts.get(item.instanceId);
      if (
        !mount ||
        !mount.pointerHistory ||
        mount.instance.nodeId !== item.nodeId ||
        mount.definition.id !== item.definitionId ||
        mount.definition.version !== item.definitionVersion ||
        mount.definitionHash !== item.executionHash ||
        JSON.stringify(mount.instance) !== item.instanceJson ||
        !(mount.definition.interaction || mount.definition.simulation)
      )
        throw new NativePointerHistoryError();
      const timing = mount.instance.timing;
      const startTime =
        timing.time +
        (timing.paused ? 0 : options.startTimeSeconds * timing.speed);
      const endTime =
        timing.time +
        (timing.paused
          ? 0
          : (options.startTimeSeconds +
              (options.totalFrames - 1) / options.fps) *
            timing.speed);
      const observedUntil = mount.clock.paused
        ? mount.clock.local
        : mount.clock.local + (now - mount.clock.global) * mount.clock.speed;
      return {
        ...item,
        timing: { ...timing },
        history: mount.pointerHistory.snapshot(
          startTime,
          endTime,
          observedUntil,
        ),
      };
    });
  };

  private replayPointer(
    mount: Mount,
    time: number,
    initial: NativePointerState,
  ): NativePointerState | null {
    const entry = this.simulationExportSession?.pointerReplay?.get(
      mount.instance.id,
    );
    if (!entry || entry.history.mode === "authored-static") return null;
    return sampleNativePointerHistory(entry.history, time, initial);
  }

  private packPointerForTime(
    mount: Mount,
    definition: EffectDefinition,
    params: EffectInstance["params"],
    time: number,
    deterministic: boolean,
  ): Float32Array {
    const interaction = definition.interaction;
    const position = interaction
      ? ((params[interaction.positionProperty] ??
          definition.properties[interaction.positionProperty].default) as [
          number,
          number,
        ])
      : null;
    const replay =
      deterministic && position
        ? this.replayPointer(mount, time, {
            x: position[0],
            y: position[1],
            active: false,
          })
        : null;
    return packNativePointerProperties(
      definition,
      params,
      replay ?? mount.pointerState,
      deterministic && !replay,
    );
  }

  beginSimulationExportSession = async (options: {
    fps: number;
    totalFrames: number;
    startTimeSeconds: number;
    targetInstanceIds?: string[];
    pointerReplay?: readonly NativePointerReplayEntry[];
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
    const targetInstanceIds = options.targetInstanceIds ?? [];
    if (
      targetInstanceIds.length > 1 ||
      new Set(targetInstanceIds).size !== targetInstanceIds.length ||
      targetInstanceIds.some((id) => !this.mounts.has(id))
    )
      throw new NativeSourceError(
        "simulation-session-target-invalid",
        "The held render session target is missing or exceeds its bound.",
      );
    const targetInstances = new Set(targetInstanceIds);
    if (
      options.pointerReplay !== undefined &&
      (!Array.isArray(options.pointerReplay) ||
        options.pointerReplay.length > 128 ||
        options.pointerReplay.some(
          (entry) =>
            !entry ||
            typeof entry !== "object" ||
            typeof entry.instanceId !== "string" ||
            !entry.history ||
            (entry.history.mode !== "authored-static" &&
              (entry.history.mode !== "recorded" ||
                !Array.isArray(entry.history.events))),
        ))
    )
      throw new NativePointerHistoryError();
    const pointerReplay =
      options.pointerReplay === undefined
        ? null
        : new Map(
            options.pointerReplay.map((entry) => [
              entry.instanceId,
              {
                ...entry,
                timing: { ...entry.timing },
                history:
                  entry.history.mode === "recorded"
                    ? {
                        ...entry.history,
                        events: entry.history.events.map(
                          (event: NativePointerHistoryEvent) => ({
                            ...event,
                          }),
                        ),
                      }
                    : { mode: "authored-static" as const },
              },
            ]),
          );
    if (
      pointerReplay &&
      (pointerReplay.size !== options.pointerReplay!.length ||
        pointerReplay.size > 128 ||
        [...pointerReplay.keys()].some((id) => !this.mounts.has(id)))
    )
      throw new NativePointerHistoryError();
    for (const mount of this.mounts.values()) {
      if (
        pointerReplay &&
        (mount.definition.interaction || mount.definition.simulation)
      ) {
        const entry = pointerReplay.get(mount.instance.id);
        if (
          !entry ||
          entry.nodeId !== mount.instance.nodeId ||
          entry.definitionId !== mount.definition.id ||
          entry.definitionVersion !== mount.definition.version ||
          entry.executionHash !== mount.definitionHash ||
          entry.instanceJson !== JSON.stringify(mount.instance) ||
          JSON.stringify(entry.timing) !== JSON.stringify(mount.instance.timing)
        )
          throw new NativePointerHistoryError();
        const firstTime =
          mount.instance.timing.time +
          (mount.instance.timing.paused
            ? 0
            : options.startTimeSeconds * mount.instance.timing.speed);
        const lastTime =
          mount.instance.timing.time +
          (mount.instance.timing.paused
            ? 0
            : (options.startTimeSeconds +
                (options.totalFrames - 1) / options.fps) *
              mount.instance.timing.speed);
        validateNativePointerHistorySnapshot(
          entry.history,
          firstTime,
          lastTime,
        );
      }
    }
    for (const mount of this.mounts.values()) {
      const spec = mount.definition.simulation;
      const feedback = mount.definition.feedback;
      const stateful = isStatefulResourceGraph(mount.definition.resourceGraph)
        ? mount.definition.resourceGraph
        : null;
      if (!spec && !feedback && !stateful) continue;
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
        if (feedback.sourceHistory === "sequential-captures" && firstStep > 0)
          throw new NativeSourceError(
            "feedback-source-history-unavailable",
            `Feedback effect ${mount.instance.id} needs source captures beginning at its first step.`,
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
      if (stateful) {
        const inputPlan = planNativeInputResources(
          mount.definition,
          mount.instance,
        );
        if (!inputPlan.ok)
          throw new NativeSourceError(inputPlan.code, inputPlan.detail);
        if (
          [...inputPlan.inputs.values()].some(
            (input) => input.kind === "camera",
          )
        )
          throw new NativeSourceError(
            "stateful-source-history-unavailable",
            `Stateful effect ${mount.instance.id} uses a camera source without timestamped replay.`,
          );
        const firstStep = Math.floor(
          firstLocal / stateful.timing.fixedDt + 1e-7,
        );
        const lastStep = Math.floor(lastLocal / stateful.timing.fixedDt + 1e-7);
        const frameSteps = Math.ceil(
          timing.speed / options.fps / stateful.timing.fixedDt,
        );
        const passBudget = Math.floor(128 / mount.definition.passes.length);
        const stepBudget =
          stateful.sourceHistory === "sequential-captures"
            ? 32
            : Math.min(stateful.timing.maxStepsPerCall, passBudget);
        if (
          !Number.isSafeInteger(firstStep) ||
          firstStep + 1 > stepBudget ||
          !Number.isSafeInteger(lastStep) ||
          lastStep > stateful.timing.maxStepIndex ||
          frameSteps > stepBudget
        )
          throw new NativeSourceError(
            "stateful-step-limit",
            `Stateful effect ${mount.instance.id} exceeds its deterministic export step budget.`,
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
    this.simulationExportStartInvalidated = false;
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
      if (this.simulationExportStartInvalidated)
        throw new NativeSourceError(
          "simulation-session-source-stale",
          "The preview source changed while the held render session was starting.",
        );
      snapshot = this.suspendForComposition();
      const saved = [...this.mounts.values()]
        .filter(
          (mount) =>
            !!mount.definition.simulation ||
            !!mount.definition.feedback ||
            isStatefulResourceGraph(mount.definition.resourceGraph) ||
            pointerReplay?.has(mount.instance.id) ||
            targetInstances.has(mount.instance.id),
        )
        .map((mount) => {
          const entry = {
            mount,
            instance: mount.instance,
            simulation: mount.simulation,
            feedback: mount.feedback,
            stateful: mount.stateful,
            resources: mount.resourceTextures,
            output: mount.outputTexture,
          };
          mount.simulation = null;
          mount.feedback = null;
          mount.stateful = null;
          mount.statefulFrame = null;
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
        sourceStale: false,
        deviceEpoch: this.deviceEpoch,
        pointerReplay,
      };
      return { sessionId: id };
    } catch (error) {
      if (snapshot) this.restoreFromComposition(snapshot);
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      this.simulationExportStarting = false;
      this.simulationExportStartInvalidated = false;
      if (!this.simulationExportSession && this.rescanPending)
        queueMicrotask(() => this.requestScan());
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
        this.releaseStateful(mount);
        const exportFeedback = mount.feedback;
        mount.feedback = null;
        if (exportFeedback) await this.disposeFeedback(exportFeedback);
        for (const texture of mount.resourceTextures.values())
          this.destroyTexture(texture);
        if (mount.outputTexture && mount.outputTexture !== saved.output)
          this.destroyTexture(mount.outputTexture);
        if (this.mounts.get(saved.instance.id) !== mount) {
          if (saved.simulation) this.retireSimulationState(saved.simulation);
          if (saved.feedback) await this.disposeFeedback(saved.feedback);
          saved.stateful?.executor.dispose();
          for (const texture of new Set(saved.resources.values()))
            this.destroyTexture(texture);
          if (saved.output) this.destroyTexture(saved.output);
          continue;
        }
        mount.instance = saved.instance;
        mount.resourceTextures = saved.resources;
        mount.outputTexture = saved.output;
        mount.simulation = saved.simulation;
        mount.feedback = saved.feedback;
        mount.stateful = saved.stateful;
        this.reflectCommittedFeedbackTelemetry(mount);
        mount.simulationCaughtUp = true;
      }
      this.simulationExportSession = null;
      this.restoreFromComposition(session.clock);
      if (this.rescanPending) await this.scan();
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
    if (incomplete && session.sourceStale)
      throw new NativeSourceError(
        "simulation-session-source-stale",
        "The preview source changed during the held render session.",
      );
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

  captureCommittedCompositionPixels = async (options: {
    viewport: { width: number; height: number };
    pixelRatio: number;
    cropRect?: NativeExportRegion;
    selectedNodeIds?: string[];
    expectedDefinitions: readonly {
      id: string;
      version: number;
      executionHash: string;
    }[];
    expectedInstances: readonly {
      id: string;
      nodeId: string;
      definitionId: string;
      definitionVersion: number;
      placement: "fill" | "layer" | "backdrop";
    }[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<NativeCompositionPixels> => {
    this.assertCompositionIdle();
    if (this.disposed)
      throw new NativeSourceError("runtime-disposed", "runtime-disposed");
    if (
      options.viewport.width !== innerWidth ||
      options.viewport.height !== innerHeight
    )
      throw new NativeSourceError(
        "composition-viewport-stale",
        "The visible native preview viewport differs from the requested still.",
      );
    if (options.selectedNodeIds && !options.cropRect)
      throw new NativeSourceError(
        "composition-selection-invalid",
        "A selected native export requires a bounded output region.",
      );
    const selectedRoots = resolveNativeExportSelection(
      document,
      options.selectedNodeIds,
    );
    const region = planNativeExportRegion(options);
    if (!region.ok)
      throw new NativeSourceError(
        `composition-${region.code}`,
        "The requested native PNG region is invalid or exceeds its output budget.",
      );
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new NativeSourceError(
        "composition-invalid-frame",
        "The still capture timeout is invalid.",
      );
    if (this.workerScene) {
      const workerScene = this.workerScene;
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(
        () =>
          controller.abort(
            new NativeSourceError(
              "composition-timeout",
              "The native worker still capture timed out.",
            ),
          ),
        timeoutMs,
      );
      this.compositionPixelBusy = true;
      this.compositionAbort = controller;
      this.compositionDone = new Promise<void>((resolve) => {
        this.resolveCompositionDone = resolve;
      });
      try {
        const expectedDefinitions = new Map(
          options.expectedDefinitions.map((definition) => [
            `${definition.id}:${definition.version}`,
            definition.executionHash,
          ]),
        );
        const expectedInstances = new Map(
          options.expectedInstances.map((instance) => [instance.id, instance]),
        );
        if (
          expectedInstances.size !== this.workerEntries.length ||
          this.workerEntries.some((entry) => {
            const expected = expectedInstances.get(entry.instance.id);
            return (
              !expected ||
              expected.nodeId !== entry.instance.nodeId ||
              expected.definitionId !== entry.instance.definitionId ||
              expected.definitionVersion !== entry.instance.definitionVersion ||
              expected.placement !== entry.instance.placement ||
              expectedDefinitions.get(
                `${entry.definition.id}:${entry.definition.version}`,
              ) !== entry.definitionHash
            );
          })
        )
          throw new NativeSourceError(
            "composition-instance-stale",
            "The requested native scene differs from the worker preview.",
          );
        const timeSeconds = this.currentTime();
        const exported = await workerScene.captureExportScene({
          cropRect: region.region,
          pixelRatio: options.pixelRatio,
          timeSeconds,
          selectedRoots,
          selectedNodeIds: options.selectedNodeIds,
          regionExport: !!options.cropRect,
          timeoutMs,
          signal: controller.signal,
        });
        const currentRoots = options.selectedNodeIds
          ? resolveNativeExportSelection(document, options.selectedNodeIds)
          : undefined;
        if (
          (exported.previewGeneration !== null &&
            workerScene.committedScene()?.scene.generation !==
              exported.previewGeneration) ||
          (selectedRoots &&
            (currentRoots?.length !== selectedRoots.length ||
              currentRoots.some(
                (root, index) => root !== selectedRoots[index],
              ))) ||
          exported.width !== region.width ||
          exported.height !== region.height ||
          exported.rgba.byteLength !== region.width * region.height * 4
        )
          throw new NativeSourceError(
            "composition-preview-stale",
            "The worker scene changed during native still capture.",
          );
        const committedInstances = await Promise.all(
          exported.committedInstances.map(async (instance) => {
            const current = this.workerEntries.find(
              (entry) => entry.instance.id === instance.instanceId,
            );
            const requested = expectedInstances.get(instance.instanceId);
            if (
              !current ||
              !requested ||
              instance.definitionHash !== current.definitionHash ||
              instance.definitionHash !==
                expectedDefinitions.get(
                  `${requested.definitionId}:${requested.definitionVersion}`,
                ) ||
              instance.payload !== JSON.stringify(current.instance)
            )
              throw new NativeSourceError(
                "composition-instance-stale",
                "The worker still used a different native effect payload.",
              );
            const digest = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(instance.payload),
            );
            return {
              instanceId: instance.instanceId,
              payloadSha256: Array.from(new Uint8Array(digest), (byte) =>
                byte.toString(16).padStart(2, "0"),
              ).join(""),
              localTime: instance.localTime,
            };
          }),
        );
        if (committedInstances.length !== this.workerEntries.length)
          throw new NativeSourceError(
            "composition-instance-stale",
            "The worker still omitted a native effect.",
          );
        return {
          width: exported.width,
          height: exported.height,
          colorSpace: "srgb",
          alpha: "straight",
          rgba: new Uint8Array(exported.rgba),
          viewport: options.viewport,
          ...(options.cropRect ? { cropRect: options.cropRect } : {}),
          ...(options.selectedNodeIds
            ? { selectedNodeIds: options.selectedNodeIds }
            : {}),
          pixelRatio: options.pixelRatio,
          timeSeconds: exported.timeSeconds,
          committedInstances,
        };
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        this.compositionAbort = null;
        this.compositionPixelBusy = false;
        this.resolveCompositionDone?.();
        this.resolveCompositionDone = null;
        this.compositionDone = null;
      }
    }
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(
          new NativeSourceError(
            "composition-timeout",
            "The visible native frame did not settle before still capture.",
          ),
        ),
      timeoutMs,
    );
    this.compositionPixelBusy = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const previousRatio = this.compositionPixelRatio;
    const previousRegion = this.compositionOutputRegion;
    let snapshot: NativeClockSnapshot | null = null;
    let restoreRegionScope: (() => void) | undefined;
    try {
      await this.drainPreviewFrame(controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      this.compositionAbort = controller;
      this.compositionDone = new Promise<void>((resolve) => {
        this.resolveCompositionDone = resolve;
      });
      if (options.cropRect)
        restoreRegionScope = beginNativeRegionExport(document.documentElement);
      snapshot = this.suspendForComposition();
      const manifests = this.parse();
      if (!manifests)
        throw new NativeSourceError(
          this.parseFailure?.code ?? "manifest-invalid",
          this.parseFailure?.message ??
            "The visible effect manifest is unreadable.",
        );
      const expected = new Map(
        options.expectedDefinitions.map((definition) => [
          `${definition.id}:${definition.version}`,
          definition.executionHash,
        ]),
      );
      const enabled = manifests.flatMap((manifest) =>
        manifest.instances.filter((instance) => instance.enabled),
      );
      const expectedInstances = new Map(
        options.expectedInstances.map((instance) => [instance.id, instance]),
      );
      const sameInstanceIdentity = (
        current: EffectInstance | undefined,
        expected: (typeof options.expectedInstances)[number] | undefined,
      ): boolean =>
        !!current &&
        !!expected &&
        current.id === expected.id &&
        current.nodeId === expected.nodeId &&
        current.definitionId === expected.definitionId &&
        current.definitionVersion === expected.definitionVersion &&
        current.placement === expected.placement;
      if (
        enabled.length !== this.mounts.size ||
        enabled.length !== expectedInstances.size ||
        enabled.some(
          (instance) =>
            !sameInstanceIdentity(instance, expectedInstances.get(instance.id)),
        )
      )
        throw new NativeSourceError(
          "composition-instance-stale",
          "The visible native effect set differs from the saved scene.",
        );
      const device = this.device;
      const deviceEpoch = this.deviceEpoch;
      if (!device)
        throw new NativeSourceError(
          "device-unavailable",
          "The visible native GPU device is unavailable.",
        );
      if (options.cropRect) {
        const capturedMounts = new Map(this.mounts);
        const beforeFrames = new Map(
          [...capturedMounts].map(([id, mount]) => [id, mount.frameCount]),
        );
        const authoredEpochs = new Map(
          [...capturedMounts].map(([id, mount]) => [
            id,
            mount.provider?.authoredSourceEpoch?.(),
          ]),
        );
        const savedManifests = JSON.stringify(manifests);
        const assertRegionSource = async (rendered: boolean): Promise<void> => {
          if (
            selectedRoots &&
            resolveNativeExportSelection(
              document,
              options.selectedNodeIds,
            )?.some((root, index) => root !== selectedRoots[index])
          )
            throw new NativeSourceError(
              "composition-selection-stale",
              "The selected native export roots changed during capture.",
            );
          if (controller.signal.aborted) throw controller.signal.reason;
          if (
            this.device !== device ||
            this.deviceEpoch !== deviceEpoch ||
            this.mounts.size !== capturedMounts.size ||
            JSON.stringify(this.parse()) !== savedManifests
          )
            throw new NativeSourceError(
              "composition-preview-stale",
              "The saved native scene changed during region capture.",
            );
          for (const [id, mount] of capturedMounts) {
            const saved = enabled.find((instance) => instance.id === id);
            const executionHash = expected.get(
              `${mount.definition.id}:${mount.definition.version}`,
            );
            const authoredEpoch = authoredEpochs.get(id);
            if (
              this.mounts.get(id) !== mount ||
              !saved ||
              JSON.stringify(mount.instance) !== JSON.stringify(saved) ||
              mount.frozenReason ||
              !executionHash ||
              (await hashEffectDefinition(mount.definition)) !== executionHash
            )
              throw new NativeSourceError(
                "composition-instance-stale",
                "A saved native definition or instance changed during region capture.",
              );
            if (
              !Number.isSafeInteger(authoredEpoch) ||
              mount.provider?.authoredSourceEpoch?.() !== authoredEpoch
            )
              throw new NativeSourceError(
                "composition-source-unavailable",
                "A native source revision changed or is unreadable during region capture.",
              );
            if (
              rendered &&
              (mount.frameCount !== beforeFrames.get(id) ||
                nativePreviewBoxesOverlap(
                  region.region,
                  mount.target.getBoundingClientRect(),
                ))
            ) {
              const failure = !mount.outputTexture
                ? "output-missing"
                : mount.pixelRatio !== options.pixelRatio
                  ? `density-mismatch:${mount.pixelRatio}:${options.pixelRatio}`
                  : mount.committedInstancePayload !== JSON.stringify(saved)
                    ? "payload-mismatch"
                    : mount.committedDefinitionHash !== executionHash
                      ? "definition-hash-mismatch"
                      : mount.committedSourceEpoch === null
                        ? "source-epoch-missing"
                        : mount.provider?.sourceEpoch?.() !==
                            mount.committedSourceEpoch
                          ? `source-epoch-mismatch:${mount.committedSourceEpoch}:${mount.provider?.sourceEpoch?.()}`
                          : null;
              if (failure)
                throw new NativeSourceError(
                  "composition-preview-stale",
                  `Native effect ${id} has no source-current region output (${failure}).`,
                );
              for (const [
                name,
                { capture, sourceEpoch },
              ] of mount.committedInputEpochs)
                if (
                  !this.authoredInputCaptureCurrent(
                    mount,
                    name,
                    capture,
                    sourceEpoch,
                    "committed",
                  )
                )
                  throw new NativeSourceError(
                    "composition-preview-stale",
                    "A captured native input changed during region export.",
                  );
            }
          }
          for (const manifest of manifests)
            for (const definition of manifest.definitions)
              if (
                (await hashEffectDefinition(definition)) !==
                expected.get(`${definition.id}:${definition.version}`)
              )
                throw new NativeSourceError(
                  "composition-instance-stale",
                  "The saved native definition execution differs from the requested scene.",
                );
          if (controller.signal.aborted) throw controller.signal.reason;
        };
        await assertRegionSource(false);
        if (
          [...capturedMounts.values()].some(
            (mount) =>
              mount.definition.simulation ||
              mount.definition.feedback ||
              isStatefulResourceGraph(mount.definition.resourceGraph),
          )
        )
          throw new NativeSourceError(
            "simulation-session-required",
            "Persistent native effects need a bounded export session.",
          );
        this.compositionPixelRatio = options.pixelRatio;
        this.compositionOutputRegion = region.region;
        const rendered = await this.renderInternal(snapshot.time, false);
        if (rendered.failures.length) throw new NativeRenderFailure(rendered);
        await assertRegionSource(true);
        const frame: NativeCompositionFrame = {
          frameIndex: 0,
          fps: 60,
          startTimeSeconds: snapshot.time,
          timeSeconds: snapshot.time,
          signal: controller.signal,
        };
        const pixels = await this.readCompositionPixels(
          {
            frameIndex: 0,
            fps: 60,
            sourceContract: "declarative-only",
            viewport: options.viewport,
            cropRect: options.cropRect,
            selectedNodeIds: options.selectedNodeIds,
            pixelRatio: options.pixelRatio,
            signal: controller.signal,
            timeoutMs,
          },
          frame,
        );
        await assertRegionSource(true);
        return {
          ...pixels,
          viewport: { ...options.viewport },
          cropRect: { ...options.cropRect },
          ...(options.selectedNodeIds
            ? { selectedNodeIds: [...options.selectedNodeIds] }
            : {}),
          pixelRatio: options.pixelRatio,
          timeSeconds: snapshot.time,
        };
      }
      const scene = this.scenePresentation;
      if (scene) this.assertCurrentSceneCommit(scene);
      const frozenSource = scene?.surface.resourceTextures.get("source");
      const scenePayloads = scene?.committedInstancePayloads;
      if (scene && !frozenSource)
        throw new NativeSourceError(
          "composition-preview-stale",
          "The visible full-scene native frame has no committed texture.",
        );
      if (
        frozenSource &&
        (this.colorPresented !== "srgb" || this.dynamicRangePresented !== "sdr")
      )
        throw new NativeSourceError(
          "composition-color-unsupported",
          "The visible native frame uses a color mode that this still encoder cannot preserve.",
        );
      const committed = [...this.mounts.values()].map((mount) => ({
        mount,
        output: mount.outputTexture,
        frameCount: mount.frameCount,
        instancePayload: scene
          ? (scenePayloads?.get(mount.instance.id) ?? null)
          : mount.committedInstancePayload !== null &&
              mount.committedDefinitionHash !== null &&
              mount.committedLocalTime !== null
            ? {
                payload: mount.committedInstancePayload,
                definitionHash: mount.committedDefinitionHash,
                localTime: mount.committedLocalTime,
              }
            : null,
        sourceEpoch: mount.committedSourceEpoch,
        inputEpochs: new Map(mount.committedInputEpochs),
      }));
      for (const entry of committed) {
        const { mount } = entry;
        let failure: string | undefined;
        if (!entry.output) failure = "output-missing";
        else if (!entry.instancePayload) failure = "payload-missing";
        else if (
          entry.instancePayload.payload !==
          JSON.stringify(
            enabled.find((instance) => instance.id === mount.instance.id),
          )
        )
          failure = "saved-payload-changed";
        else if (
          !sameInstanceIdentity(
            JSON.parse(entry.instancePayload.payload) as EffectInstance,
            expectedInstances.get(mount.instance.id),
          )
        )
          failure = "instance-identity-changed";
        else if (
          entry.instancePayload.definitionHash !==
          expected.get(`${mount.definition.id}:${mount.definition.version}`)
        )
          failure = "definition-hash-changed";
        else if (!mount.suppressed) failure = "presentation-not-suppressed";
        else if (mount.frozenReason) failure = "effect-frozen";
        else if (mount.target.getAttribute("data-an-native-status") !== "ready")
          failure = "presentation-not-ready";
        else if (
          !frozenSource &&
          (entry.sourceEpoch === null ||
            mount.provider?.sourceEpoch?.() !== entry.sourceEpoch)
        )
          failure = "source-epoch-changed";
        else if (
          !expected.has(`${mount.definition.id}:${mount.definition.version}`)
        )
          failure = "definition-not-expected";
        else if (
          (await hashEffectDefinition(mount.definition)) !==
          expected.get(`${mount.definition.id}:${mount.definition.version}`)
        )
          failure = "definition-execution-changed";
        if (failure)
          throw new NativeSourceError(
            "composition-preview-stale",
            `Native effect ${mount.instance.id} has no current committed preview frame (${failure}).`,
          );
        for (const [name, { capture, sourceEpoch }] of entry.inputEpochs)
          if (
            !frozenSource &&
            !this.authoredInputCaptureCurrent(
              mount,
              name,
              capture,
              sourceEpoch,
              "committed",
            )
          )
            throw new NativeSourceError(
              "composition-preview-stale",
              `Authored input ${name} changed after the visible frame committed.`,
            );
      }
      const frame: NativeCompositionFrame = {
        frameIndex: 0,
        fps: 60,
        startTimeSeconds: snapshot.time,
        timeSeconds: snapshot.time,
        signal: controller.signal,
      };
      const pixels = await this.readCompositionPixels(
        {
          frameIndex: 0,
          fps: 60,
          sourceContract: "declarative-only",
          viewport: options.viewport,
          pixelRatio: options.pixelRatio,
          signal: controller.signal,
          timeoutMs,
        },
        frame,
        scene?.surface.viewport ? undefined : frozenSource,
      );
      const committedInstances = await Promise.all(
        committed.map(async ({ mount, instancePayload }) => {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(instancePayload!.payload),
          );
          return {
            instanceId: mount.instance.id,
            payloadSha256: Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join(""),
            localTime: instancePayload!.localTime,
          };
        }),
      );
      if (
        controller.signal.aborted ||
        this.device !== device ||
        this.deviceEpoch !== deviceEpoch ||
        this.scenePresentation !== scene ||
        committed.some(
          ({
            mount,
            output,
            frameCount,
            instancePayload,
            sourceEpoch,
            inputEpochs,
          }) =>
            this.mounts.get(mount.instance.id) !== mount ||
            mount.outputTexture !== output ||
            mount.frameCount !== frameCount ||
            (!scene &&
              (mount.committedInstancePayload !== instancePayload?.payload ||
                mount.committedDefinitionHash !==
                  instancePayload?.definitionHash ||
                mount.committedLocalTime !== instancePayload?.localTime)) ||
            mount.target.getAttribute("data-an-native-status") !== "ready" ||
            (!frozenSource &&
              mount.provider?.sourceEpoch?.() !== sourceEpoch) ||
            (!frozenSource &&
              [...inputEpochs].some(
                ([name, { capture, sourceEpoch: epoch }]) =>
                  !this.authoredInputCaptureCurrent(
                    mount,
                    name,
                    capture,
                    epoch,
                    "committed",
                  ),
              )),
        ) ||
        (scene &&
          (scene.surface.resourceTextures.get("source") !== frozenSource ||
            scene.committedInstancePayloads !== scenePayloads))
      )
        throw new NativeSourceError(
          "composition-preview-stale",
          "The visible native scene changed during still capture.",
        );
      if (scene) this.assertCurrentSceneCommit(scene);
      return { ...pixels, committedInstances };
    } finally {
      restoreRegionScope?.();
      this.compositionPixelRatio = previousRatio;
      this.compositionOutputRegion = previousRegion;
      if (snapshot) this.restoreFromComposition(snapshot);
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      this.compositionAbort = null;
      this.resolveCompositionDone?.();
      this.resolveCompositionDone = null;
      this.compositionDone = null;
      this.compositionPixelBusy = false;
      if (this.rescanPending) queueMicrotask(() => this.requestScan());
      if (this.playing && this.mounts.size && !this.raf && !this.disposed)
        this.frame();
    }
  };

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
      captureFeedbackState?: true;
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
      captureFeedbackState?: true;
    },
    signal: AbortSignal,
  ): Promise<{
    mountOutput: NativeMountedOutputSummary;
    linearGolden?: NativeLinearGoldenSummary;
  }> {
    if (signal.aborted) throw signal.reason;
    const mount = this.mounts.get(target.instanceId);
    const session = this.simulationExportSession;
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
    if (
      session &&
      (session.sourceStale ||
        !session.saved.some((saved) => saved.mount === mount))
    )
      throw new NativeSourceError(
        session.sourceStale
          ? "simulation-session-source-stale"
          : "simulation-session-target-stale",
        "The held render target changed during validation.",
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
        (session &&
          (session.sourceStale ||
            !session.saved.some((saved) => saved.mount === mount))) ||
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
          const feedbackState = target.captureFeedbackState
            ? await this.readFeedbackStateSnapshot(
                mount,
                signal,
                plan.byteLength,
              )
            : undefined;
          assertCurrent();
          const mountOutput: NativeMountedOutputSummary = {
            scope: "exact-mount-output-linear-premultiplied",
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
            ...(feedbackState ? { feedbackState } : {}),
          };
          return {
            mountOutput,
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

  private async readFeedbackStateSnapshot(
    mount: Mount,
    signal: AbortSignal,
    readbackReservedBytes: number,
  ): Promise<
    | {
        availability: "available";
        scope: "exact-feedback-state-linear-rgba16f";
        width: number;
        height: number;
        completedStep: number;
        byteLength: number;
        sha256: string;
        followups: typeof unavailableFeedbackStateFollowups;
      }
    | {
        availability: "unavailable";
        code:
          | "state-uninitialized"
          | "state-snapshot-limit"
          | "state-snapshot-budget";
        followups: typeof unavailableFeedbackStateFollowups;
      }
  > {
    const feedback = mount.feedback;
    if (!feedback)
      return {
        availability: "unavailable",
        code: "state-uninitialized",
        followups: unavailableFeedbackStateFollowups,
      };
    try {
      const snapshot = await trackNativeFeedbackRetirement(
        feedback.retirements,
        feedback.executor.snapshotState(
          MAX_REALM_TEXTURE_BYTES -
            this.estimatedResourceBytes() -
            readbackReservedBytes,
          signal,
        ),
      );
      return {
        availability: "available",
        ...snapshot,
        followups: unavailableFeedbackStateFollowups,
      };
    } catch (error) {
      if (
        error instanceof NativeFeedbackFailure &&
        error.code === "feedback-state-uninitialized"
      )
        return {
          availability: "unavailable",
          code: "state-uninitialized",
          followups: unavailableFeedbackStateFollowups,
        };
      if (
        error instanceof NativeFeedbackFailure &&
        error.code === "feedback-state-snapshot-limit"
      )
        return {
          availability: "unavailable",
          code: "state-snapshot-limit",
          followups: unavailableFeedbackStateFollowups,
        };
      if (
        error instanceof NativeFeedbackFailure &&
        error.code === "feedback-state-snapshot-budget"
      )
        return {
          availability: "unavailable",
          code: "state-snapshot-budget",
          followups: unavailableFeedbackStateFollowups,
        };
      throw error;
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
    const repeatCurrentSimulationFrame =
      options.repeatCurrentSimulationFrame === true;
    if (simulationSession) {
      if (simulationSession.sourceStale)
        throw new NativeSourceError(
          "simulation-session-source-stale",
          "The preview source changed during the held render session.",
        );
      if (
        options.simulationSessionId !== simulationSession.id ||
        (repeatCurrentSimulationFrame
          ? simulationSession.nextFrame < 1 ||
            options.frameIndex !== simulationSession.nextFrame - 1
          : options.frameIndex !== simulationSession.nextFrame) ||
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
    } else if (repeatCurrentSimulationFrame) {
      throw new NativeSourceError(
        "simulation-session-invalid",
        "A repeated frame requires the current held simulation session.",
      );
    } else if (
      [...this.mounts.values()].some(
        (mount) =>
          mount.definition.simulation ||
          mount.definition.feedback ||
          isStatefulResourceGraph(mount.definition.resourceGraph),
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
    const started = performance.now();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const remainingTimeout = () => {
      const remaining = Math.floor(timeoutMs - (performance.now() - started));
      if (remaining < 1)
        throw new NativeSourceError(
          "composition-timeout",
          "Source synchronization timed out before the frame completed.",
        );
      return remaining;
    };
    let frameFailed = false;
    let frameFailure: unknown;
    try {
      if (simulationSession && !repeatCurrentSimulationFrame) {
        const finalTime =
          (options.startTimeSeconds ?? 0) + options.frameIndex / options.fps;
        const clocks = [...this.mounts.values()].flatMap((mount) => {
          const graph = mount.definition.resourceGraph;
          const timing = mount.instance.timing;
          if (
            isStatefulResourceGraph(graph) &&
            graph.sourceHistory === "sequential-captures"
          )
            return [
              {
                completedStep: mount.stateful?.executor.lastCompletedStep ?? -1,
                fixedDt: graph.timing.fixedDt,
                timeOffset: timing.time,
                speed: timing.speed,
                paused: timing.paused,
              },
            ];
          const feedback = mount.definition.feedback;
          if (
            feedback?.pointer === "interaction-v1" &&
            simulationSession?.pointerReplay?.get(mount.instance.id)?.history
              .mode === "recorded"
          )
            return [
              {
                completedStep: mount.feedback?.executor.lastCompletedStep ?? 0,
                fixedDt: feedback.timing.fixedDt,
                timeOffset: timing.time,
                speed: timing.speed,
                paused: timing.paused,
              },
            ];
          return [];
        });
        const captureTimes = planNativeStatefulSourceCaptureTimes(
          clocks,
          finalTime,
        );
        for (const time of captureTimes) {
          await this.withSynchronizedCompositionFrame(
            {
              frameIndex: 0,
              fps: options.fps,
              startTimeSeconds: time,
              sourceContract: options.sourceContract,
              signal: options.signal,
              timeoutMs: remainingTimeout(),
            },
            async (rendered) => rendered,
            true,
          );
          if (
            this.simulationExportSession !== simulationSession ||
            simulationSession.sourceStale ||
            simulationSession.failed ||
            simulationSession.deviceEpoch !== this.deviceEpoch
          )
            throw new NativeSourceError(
              "simulation-session-source-stale",
              "The held source changed during fixed-step capture.",
            );
        }
      }
      const held = await this.withSynchronizedCompositionFrame(
        { ...options, timeoutMs: remainingTimeout() },
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
            (pixelRatio !== previewRatio || this.previewViewport !== null) &&
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
      if (simulationSession && !repeatCurrentSimulationFrame)
        simulationSession.nextFrame += 1;
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
    region: NativeExportRegion;
  } {
    const pixelRatio = options?.pixelRatio ?? devicePixelRatio;
    const planned = planNativeExportRegion({
      viewport: options.viewport,
      cropRect: options.cropRect,
      pixelRatio,
    });
    if (!planned.ok)
      throw new NativeSourceError(
        `composition-${planned.code}`,
        "The selected PNG region exceeds bounded SDR export geometry.",
      );
    if (
      Math.abs(innerWidth - options.viewport.width) > 1 ||
      Math.abs(innerHeight - options.viewport.height) > 1
    )
      throw new NativeSourceError(
        "composition-viewport-mismatch",
        "The prepared source viewport does not match the selected Design screen.",
      );
    return {
      pixelRatio,
      width: planned.width,
      height: planned.height,
      region: planned.region,
    };
  }

  private async readCompositionPixels(
    options: NativePixelFrameOptions,
    frame: NativeCompositionFrame,
    frozenSource?: GPUTexture,
  ): Promise<NativeCompositionPixels> {
    if (frame.signal.aborted) throw frame.signal.reason;
    const root = document.documentElement;
    const selectedRoots = resolveNativeExportSelection(
      document,
      options.selectedNodeIds,
    );
    const { pixelRatio, width, height, region } =
      this.pixelFrameDimensions(options);
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
    const provider = frozenSource
      ? null
      : createNativeSceneProvider(root, "layer");
    if (!frozenSource && !provider)
      throw new NativeSourceError(
        "composition-source-unavailable",
        "The authored scene cannot be read for export.",
      );
    provider?.setDensity(pixelRatio);
    const surface: CompositionSurface = {
      target: root,
      width,
      height,
      pixelRatio,
      ...(options.cropRect ? { viewport: region } : {}),
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
      const allRecords = frozenSource ? [] : await provider!.readScene();
      const scene = selectedRoots
        ? filterNativeExportSelection(allRecords, selectedRoots, (id) => {
            const target = this.mounts.get(id)?.target;
            if (!target)
              throw new NativeSourceError(
                "native-dependency-missing",
                "A selected native source target is unavailable.",
              );
            return target;
          })
        : allRecords;
      const authoredEpoch = frozenSource ? null : provider!.sourceEpoch?.();
      if (
        !frozenSource &&
        (await provider!.replaySafety(allRecords, "committed-native")) !==
          "immutable"
      )
        throw new NativeSourceError(
          "composition-source-history-unavailable",
          "The visible authored source cannot be frozen from its committed native frame.",
        );
      const nativeRecords = scene.filter(
        (record) =>
          record.nativeInstanceId &&
          record.rect.width > 0 &&
          record.rect.height > 0 &&
          record.clip.width > 0 &&
          record.clip.height > 0 &&
          nativePreviewBoxesOverlap(region, record.rect) &&
          nativePreviewBoxesOverlap(region, record.clip),
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
          (!selectedRoots ||
            selectedRoots.some(
              (root) => root === mount.target || root.contains(mount.target),
            )) &&
          mount.isTopLayer &&
          mount.suppressed &&
          !!mount.outputTexture &&
          !this.groupLocalNoncontributing(mount) &&
          nativePresentationVisible(mount.canvas, options.viewport) &&
          (!options.cropRect ||
            nativePreviewBoxesOverlap(
              region,
              mount.canvas.getBoundingClientRect(),
            )),
      );
      const missingVisibleMountIds = visibleMounts
        .filter(
          (mount) =>
            !frozenSource && !representedNativeIds.has(mount.instance.id),
        )
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
        !frozenSource &&
        this.colorPresented === "srgb" &&
        this.dynamicRangePresented === "sdr";
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
      const source =
        frozenSource ??
        (await this.composeScene(
          surface,
          scene,
          encoder,
          "source",
          cssEncoded ? "srgb-css" : "linear",
        ));
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
      if (!frozenSource && provider!.sourceEpoch?.() !== authoredEpoch)
        throw new NativeSourceError(
          "composition-preview-stale",
          "The authored scene changed during committed still readback.",
        );
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
    if (provider) await clean(() => provider.dispose());
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
    if (data.type === "native-shader-editor-preview-policy") {
      if (window.parent === window || event.source !== window.parent) return;
      if (
        data.schemaVersion !== 1 ||
        !(data.policy === null || isEffectPreviewPolicy(data.policy))
      )
        return;
      const nextPolicy = data.policy as EffectPreviewPolicy | null;
      if (sameEditorPreviewPolicy(this.editorPreviewPolicy, nextPolicy)) return;
      this.editorPreviewPolicy = nextPolicy === null ? null : { ...nextPolicy };
      this.previewDirty = true;
      this.requestScan();
      return;
    }
    if (data.type === "native-shader-overview-preview-mode") {
      if (window.parent === window || event.source !== window.parent) return;
      if (data.schemaVersion !== 1 || typeof data.compact !== "boolean") return;
      if (!this.previewPolicy.setOverviewCompact(data.compact)) return;
      this.sceneBudgetFault = null;
      this.previewDirty = true;
      this.updatePreviewAttributes();
      this.requestSourceFrame();
      return;
    }
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
      if (
        !this.mounts.has(request.instanceId) &&
        !this.workerEntries.some(
          (entry) => entry.instance.id === request.instanceId,
        )
      ) {
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
      const generation = ++this.draftReservedGeneration;
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
        void (async () => {
          if (this.workerScene) {
            this.legacyDraftSession = true;
            await this.scan();
            if (this.running) await this.running;
            await this.renderInternal(this.currentTime(), true);
          }
          await this.previewDraft(
            data as NativeDraftPreviewRequest,
            generation,
          );
        })().catch((error) =>
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
          ].includes(String(data.command)) ||
          (data.expectedExecutionHash !== undefined &&
            !validHash(data.expectedExecutionHash))
        ) {
          this.postDraftResult(requestId, instanceId, "error", [
            this.draftFailure(
              "draft-control-invalid",
              "The draft control is malformed.",
            ),
          ]);
          return;
        }
        void (async () => {
          await this.controlDraft(
            data as NativeDraftPreviewControl,
            generation,
          );
          if (data.command === "clear" && this.legacyDraftSession) {
            this.legacyDraftSession = false;
            await this.scan();
          }
        })().catch((error) =>
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
      this.parameterPreviews.enqueue(
        data.instanceId,
        data.params as Record<string, unknown>,
      );
    }
    if (
      data.type === "native-effect-set-param" &&
      typeof data.name === "string"
    ) {
      this.parameterPreviews.enqueue(data.instanceId, {
        [data.name]: data.value,
      });
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
          .filter(nativeMountNeedsContinuousSourceFrames)
          .map((mount) => mount.instance.id);
        this.publishIdleSourceDiagnostic(continuousMountIds);
        if (continuousMountIds.length) this.requestSourceFrame();
        else this.scheduleIdleSourcePoll();
        return;
      }
      if (
        [...this.mounts.values()].some(nativeMountNeedsContinuousSourceFrames)
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
      this.workerScene ||
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
      Boolean(this.scanning || (this.running && !this.generatedFillFamily)),
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
      this.previewPolicy.isSubmissionDue(now, this.previewDirty)
    ) {
      if (!this.previewDirty) {
        const admission = this.submitGeneratedFillFrame(this.currentTime());
        if (admission === "admitted") {
          this.previewPolicy.commitSubmission(now, false);
          return;
        }
        if (admission === "backpressured" || admission === "starting") return;
      }
      this.previewPolicy.commitSubmission(now, this.previewDirty);
      this.previewDirty = false;
      void this.renderInternal(this.currentTime(), false);
    }
  };

  private requestSourceFrame = (): void => {
    if (this.workerScene) {
      this.workerScene.requestUpdate();
      return;
    }
    if (
      this.mounts.size > 0 &&
      ![...this.mounts.values()].some((mount) => !mount.frozenReason)
    )
      return;
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

  private onAuthoredStyleMutations = (records: MutationRecord[]): void => {
    const authoredRecords = records.filter(
      (record) =>
        record.target !== this.runtimeScript &&
        !isNativeSourceOmittedMutation(record),
    );
    if (this.compositionAbort && authoredRecords.length)
      this.compositionAbort.abort(
        new NativeSourceError(
          "composition-source-changed",
          "The authored scene changed during native capture.",
        ),
      );
    if (
      authoredRecords.some((record) => document.head.contains(record.target))
    ) {
      for (const mount of this.mounts.values()) mount.authoredStyleDirty = true;
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
  };

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    window.addEventListener("pagehide", this.onPageHide);
    try {
      this.observePreviewHost();
    } catch (error) {
      this.issue("preview-viewport-unreadable", String(error));
      document.documentElement.setAttribute(
        "data-an-native-runtime-error",
        "preview-viewport-unreadable",
      );
    }
    document.documentElement.removeAttribute("data-an-native-scene-managed");
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
    for (const target of document.querySelectorAll<NativeScenePresentationElement>(
      "[data-agent-native-node-id]",
    ))
      for (const attribute of [...target.attributes])
        if (
          attribute.name.startsWith("data-an-native-") &&
          attribute.name !== "data-an-native-source-idle-observer"
        )
          target.removeAttribute(attribute.name);
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-an-native-fill-host],[data-an-native-fill-positioned],[data-an-native-fill-instance],[data-an-native-parent-positioned],[data-an-native-fill-suppressed],[data-an-native-text-suppressed],[data-an-native-layer-suppressed],[data-an-native-scene-suppressed],[data-an-native-receiver-suppressed],[data-an-native-authored-opacity],[data-an-native-authored-background-color],[data-an-native-authored-background-image],[data-an-native-authored-color],[data-an-native-authored-text-fill-color],[data-an-native-layer-instance]",
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
        "data-an-native-receiver-suppressed",
        "data-an-native-authored-opacity",
        "data-an-native-authored-background-color",
        "data-an-native-authored-background-image",
        "data-an-native-authored-color",
        "data-an-native-authored-text-fill-color",
        "data-an-native-layer-instance",
      ])
        element.removeAttribute(name);
    window.addEventListener("message", this.onMessage);
    if (window.parent !== window)
      try {
        window.parent.dispatchEvent(new Event("an-native-camera-state"));
      } catch (error) {
        console.warn(
          "Unable to dispatch camera state to the parent window.",
          error,
        );
      }
    this.authoredStyleObserver = new MutationObserver(
      this.onAuthoredStyleMutations,
    );
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

  dispose(): Promise<void> {
    if (this.disposalDone) return this.disposalDone;
    let complete!: () => void;
    let fail!: (error: unknown) => void;
    const done = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    this.disposalDone = done;
    this.disposalState = "pending";
    this.parameterPreviews.dispose();
    void done.catch((error) => {
      console.error("Native shader runtime disposal failed.", error);
    });
    const release = () => {
      try {
        this.releaseDisposedResources();
        this.disposalState = "complete";
        complete();
      } catch (error) {
        this.disposalState = "failed";
        this.issue("runtime-disposal-failed", String(error));
        fail(error);
      }
    };
    try {
      this.cameraSource.stop();
      this.clearCameraClip();
      this.releaseCameraTexture();
      this.cameraSnapshot?.close();
      this.cameraSnapshot = null;
      this.presentationFaultLatch.clear();
      this.presentationFaultHold = false;
      this.presentationMirrorCapture = false;
      this.compositionAbort?.abort();
      this.mountedBenchmark?.fail(
        new NativeMountedBenchmarkError("benchmark-aborted"),
      );
      this.disposed = true;
      this.authoredInputReuse = new WeakMap();
      this.authoredInputReuseEpoch = -1;
      this.clearIdleSourcePoll();
      document.documentElement.removeAttribute(
        "data-an-native-source-idle-diagnostic",
      );
      this.pause();
      this.rescanObserver?.disconnect();
      this.authoredStyleObserver?.disconnect();
      this.previewHostObserver?.disconnect();
      this.previewHostResizeObserver?.disconnect();
      document.removeEventListener(
        "visibilitychange",
        this.onPreviewHostChange,
      );
      window.removeEventListener("pagehide", this.onPageHide);
      if (this.previewHostFramePending)
        this.previewHostParent?.cancelAnimationFrame(this.previewHostFrame);
      this.previewHostFrame = 0;
      this.previewHostFramePending = false;
      this.previewHostParent?.removeEventListener(
        "scroll",
        this.onPreviewHostChange,
        true,
      );
      this.previewHostParent?.removeEventListener(
        "resize",
        this.onPreviewHostChange,
      );
      this.previewHostParent = null;
      window.removeEventListener("message", this.onMessage);
      clearTimeout(this.rescanTimer);
      clearTimeout(this.deviceRetryTimer);
      if (
        this.scenePresentation &&
        !this.hasCurrentScenePresentation(this.scenePresentation)
      )
        this.unpublishScenePresentation(this.scenePresentation);
      const pending: Promise<unknown>[] = [];
      if (this.compositionDone) pending.push(this.compositionDone);
      if (this.scanning) pending.push(this.scanning);
      if (this.previewRestoreWork) pending.push(this.previewRestoreWork);
      if (this.running) pending.push(this.running);
      if (this.draftPendingCount) pending.push(this.draftWorkSettled);
      if (pending.length) void Promise.allSettled(pending).then(release);
      else release();
    } catch (error) {
      this.disposalState = "failed";
      this.issue("runtime-disposal-failed", String(error));
      fail(error);
    }
    return done;
  }

  private releaseDisposedResources(): void {
    this.workerScene?.dispose();
    this.retiringWorkerScene?.dispose();
    this.workerScene = null;
    this.retiringWorkerScene = null;
    this.workerEntries = [];
    this.releaseGeneratedFillFamily();
    this.previewTargetDensities.clear();
    this.previewBudgetDensities.clear();
    this.previewBudgetSignature = "";
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
    document.documentElement.removeAttribute("data-an-native-scene-managed");
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
    this.destroyTexture(this.receiverInteriorBox);
    this.receiverInteriorBox = null;
    this.pipelines.reset();
    this.simulationComputePipelines.reset();
    this.statelessPipelines.reset();
    this.graphPipelines.reset();
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

  reportReplacementFailure(error: unknown): void {
    const code = "runtime-replacement-failed";
    const diagnostic = {
      code,
      message: code,
    };
    this.issue(diagnostic.code, String(error));
    document.documentElement.setAttribute(
      "data-an-native-runtime-error",
      diagnostic.code,
    );
    for (const manifest of this.parse() ?? [])
      for (const instance of manifest.instances)
        this.postStatus(
          instance.id,
          instance.nodeId,
          "error",
          diagnostic,
          undefined,
          true,
        );
  }
}

type NativeShaderHandoff = {
  state: "pending" | "ready" | "failed";
  promise: Promise<void>;
};

declare global {
  interface Window {
    __anNativeShaders?: NativeShaderRuntime;
    __anNativeShaderHandoff?: NativeShaderHandoff;
  }
}

const prior = window.__anNativeShaders;
const inheritedHandoff = window.__anNativeShaderHandoff;
let priorDisposal: Promise<void> | undefined;
let priorDisposeFailed = false;
try {
  priorDisposal = prior?.dispose();
} catch (error) {
  priorDisposeFailed = true;
  priorDisposal = Promise.reject(error);
}
const runtime = new NativeShaderRuntime(document.currentScript);
window.__anNativeShaders = runtime;
const startIfCurrent = () => {
  if (window.__anNativeShaders !== runtime) return;
  if (document.readyState === "loading")
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (window.__anNativeShaders === runtime) runtime.start();
      },
      { once: true },
    );
  else runtime.start();
};
if (
  priorDisposeFailed ||
  prior?.disposalState === "pending" ||
  prior?.disposalState === "failed" ||
  inheritedHandoff?.state === "pending" ||
  inheritedHandoff?.state === "failed"
) {
  const handoff: NativeShaderHandoff = {
    state: "pending",
    promise: Promise.all([inheritedHandoff?.promise, priorDisposal]).then(
      () => {
        handoff.state = "ready";
      },
      (error: unknown) => {
        handoff.state = "failed";
        throw error;
      },
    ),
  };
  window.__anNativeShaderHandoff = handoff;
  void handoff.promise.then(startIfCurrent, (error: unknown) => {
    if (window.__anNativeShaders === runtime)
      runtime.reportReplacementFailure(error);
  });
} else startIfCurrent();
