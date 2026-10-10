import { callAction } from "@agent-native/core/client/hooks";

import {
  postNativeApprovalState,
  readNativeApprovalHashes,
} from "@/components/design/design-canvas/native-approval-bridge";
import {
  readNativeShaderRuntimeStatus,
  type NativeShaderRuntimeStatus,
} from "@/components/design/design-canvas/native-status-bridge";
import {
  NativeRasterEncodingError,
  flattenStraightRgbaOnWhite,
  rasterMimeType,
  validateEncodedRasterBlob,
  type NativeRasterFormat,
} from "@/pages/design-editor/native-raster-encoding";

import { parseEffectsFromHtml } from "../../../shared/native-effects";
import { nativeVideoCodedDimensions } from "../../../shared/native-local-export";
import {
  buildNativeCodePackage,
  buildNativeStandaloneHtml,
} from "./native-code-package";
import { renderNativeHybridPdf } from "./native-hybrid-pdf";
import { buildNativeHybridSvgFromFrame } from "./native-hybrid-vector";
import {
  encodeStraightRgbaPng,
  NativePngEncodingError,
} from "./native-png-encoding";
import {
  extractNativeSelectedSource,
  NativeSelectedSourceError,
} from "./native-selected-source";

const MAX_SIDE = 4096;
const MAX_PIXELS = 8_388_608;
const MAX_HTML_BYTES = 5_000_000;
const LOAD_TIMEOUT_MS = 10_000;
const STATUS_TIMEOUT_MS = 15_000;
const RASTER_EXPORT_TIMEOUT_MS = 45_000;
const RASTER_ENCODE_TIMEOUT_MS = 10_000;
const VIDEO_FPS = 60;
const MAX_VIDEO_FRAMES = 600;
const MAX_VIDEO_DURATION_SECONDS = 30;
const MAX_VIDEO_TIME_SECONDS = 3600;

export type NativeVideoSettings = {
  durationSeconds: number;
  startTimeSeconds: number;
  fps: 24 | 30 | 60;
  pixelRatio: number;
  quality: "low" | "medium" | "high";
  matte: { r: number; g: number; b: number };
};

export const DEFAULT_NATIVE_VIDEO_SETTINGS: NativeVideoSettings = {
  durationSeconds: 3,
  startTimeSeconds: 0,
  fps: 60,
  pixelRatio: 1,
  quality: "high",
  matte: { r: 255, g: 255, b: 255 },
};

export function nativeVideoFrameCount(settings: NativeVideoSettings): number {
  const frameCountFloat = settings.durationSeconds * settings.fps;
  const frameCount = Math.round(frameCountFloat);
  if (
    !Number.isFinite(settings.durationSeconds) ||
    settings.durationSeconds <= 0 ||
    settings.durationSeconds > MAX_VIDEO_DURATION_SECONDS ||
    ![24, 30, 60].includes(settings.fps) ||
    Math.abs(frameCountFloat - frameCount) > 0.000001 || // i18n-ignore numeric frame precision validation
    frameCount < 1 ||
    frameCount > MAX_VIDEO_FRAMES ||
    !Number.isFinite(settings.startTimeSeconds) ||
    settings.startTimeSeconds < 0 ||
    settings.startTimeSeconds + (frameCount - 1) / settings.fps >
      MAX_VIDEO_TIME_SECONDS ||
    !Number.isFinite(settings.pixelRatio) ||
    settings.pixelRatio <= 0 ||
    settings.pixelRatio > 4 ||
    !["low", "medium", "high"].includes(settings.quality) ||
    !settings.matte ||
    typeof settings.matte !== "object" ||
    Object.keys(settings.matte).sort().join(",") !== "b,g,r" ||
    [settings.matte.r, settings.matte.g, settings.matte.b].some(
      (channel) => !Number.isInteger(channel) || channel < 0 || channel > 255,
    )
  )
    throw new NativeSceneExportError(
      "video-unavailable",
      "Native video export timing, quality, or matte is outside its supported limits.",
    );
  return frameCount;
}

type PreparedNativeScene = {
  designId: string;
  fileId: string;
  viewport: { width: number; height: number };
  initialPixelRatio: number;
  html: string;
  approvedDefinitionHashes: string[];
  instanceTargets: Array<{ instanceId: string; nodeId: string }>;
  sourceVersions: Array<{
    fileId: string;
    filename: string;
    versionHash: string;
  }>;
  localQaSinkEnabled: boolean;
};

const localQaSinkEnabledByBlob = new WeakMap<Blob, boolean>();

export function nativeExportLocalQaSinkEnabled(blob: Blob): boolean {
  return localQaSinkEnabledByBlob.get(blob) === true;
}

type NativePixelResult = {
  width: number;
  height: number;
  colorSpace: "srgb";
  alpha: "straight";
  rgba: Uint8Array;
};

export type NativePixelRuntime = {
  scan?: () => Promise<void>;
  compositionSceneDiagnostic?: () => {
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
  beginSimulationExportSession?: (options: {
    fps: number;
    totalFrames: number;
    startTimeSeconds: 0;
    signal?: AbortSignal;
    timeoutMs?: number;
  }) => Promise<{ sessionId: string }>;
  endSimulationExportSession?: (sessionId: string) => Promise<void>;
  renderCompositionFramePixels(options: {
    frameIndex: number;
    fps: number;
    startTimeSeconds?: number;
    sourceContract: "declarative-only";
    viewport: { width: number; height: number };
    pixelRatio: number;
    signal: AbortSignal;
    timeoutMs: number;
    simulationSessionId?: string;
  }): Promise<NativePixelResult>;
  renderCompositionVectorFrame?: <Result>(
    options: {
      frameIndex: number;
      fps: number;
      startTimeSeconds?: number;
      sourceContract: "declarative-only";
      viewport: { width: number; height: number };
      pixelRatio: number;
      signal: AbortSignal;
      timeoutMs: number;
      simulationSessionId?: string;
    },
    consume: (frame: {
      document: Document;
      pixels: NativePixelResult;
      runtimeCanvases: readonly HTMLCanvasElement[];
      viewport: { width: number; height: number };
      pixelRatio: number;
      signal: AbortSignal;
    }) => Promise<Result>,
  ) => Promise<Result>;
};

function reportNativeCompositionScene(
  runtime: NativePixelRuntime | undefined,
  failed: boolean,
): void {
  if (!runtime?.compositionSceneDiagnostic) return;
  try {
    const diagnostic = JSON.stringify(runtime.compositionSceneDiagnostic());
    if (failed)
      console.error("Native export composition scene failed:", diagnostic);
    else console.info("Native export composition scene:", diagnostic);
  } catch (error) {
    console.warn("Native export composition diagnostic is unreadable:", error);
  }
}

export class NativeSceneExportError extends Error {
  constructor(
    readonly code:
      | "scene-unreadable"
      | "frame-unavailable"
      | "native-unavailable"
      | "native-not-ready"
      | "pixels-unreadable"
      | "frame-too-large"
      | "source-stale"
      | "export-timeout"
      | "export-canceled"
      | "format-unavailable"
      | "video-unavailable",
    message: string,
  ) {
    super(message);
    this.name = "NativeSceneExportError";
  }
}

export class NativeSceneExportCleanupError extends Error {
  constructor(readonly causes: readonly [unknown, unknown]) {
    super("Native export and cleanup both failed.");
    this.name = "NativeSceneExportCleanupError";
  }
}

function validViewport(
  value: unknown,
): value is PreparedNativeScene["viewport"] {
  if (!value || typeof value !== "object") return false;
  const viewport = value as Record<string, unknown>;
  return (
    Number.isInteger(viewport.width) &&
    Number.isInteger(viewport.height) &&
    (viewport.width as number) > 0 &&
    (viewport.height as number) > 0 &&
    (viewport.width as number) <= MAX_SIDE &&
    (viewport.height as number) <= MAX_SIDE &&
    (viewport.width as number) * (viewport.height as number) <= MAX_PIXELS
  );
}

export function readPreparedScene(
  value: unknown,
  expected: {
    designId: string;
    fileId: string;
    width: number;
    height: number;
    pixelRatio: number;
    expectedVersionHash?: string;
  },
): PreparedNativeScene {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The prepared native scene response is unreadable.",
    );
  const scene = value as Record<string, unknown>;
  const approval = readNativeApprovalHashes(
    scene,
    expected.designId,
    expected.fileId,
  );
  const targets = scene.instanceTargets;
  const versions = scene.sourceVersions;
  if (
    approval.status !== "ready" ||
    !validViewport(scene.viewport) ||
    scene.viewport.width !== expected.width ||
    scene.viewport.height !== expected.height ||
    scene.initialPixelRatio !== expected.pixelRatio ||
    typeof scene.localQaSinkEnabled !== "boolean" ||
    typeof scene.html !== "string" ||
    new TextEncoder().encode(scene.html).byteLength > MAX_HTML_BYTES ||
    !preparedRuntimeHasInitialDensity(scene.html, expected.pixelRatio) ||
    !Array.isArray(targets) ||
    targets.length > 128 ||
    !targets.every(
      (target) =>
        target &&
        typeof target === "object" &&
        typeof target.instanceId === "string" &&
        target.instanceId.length > 0 && // i18n-ignore positive identifier length validation
        target.instanceId.length <= 128 &&
        typeof target.nodeId === "string" &&
        target.nodeId.length > 0 && // i18n-ignore positive identifier length validation
        target.nodeId.length <= 128,
    ) ||
    new Set(targets.map((target) => target.instanceId)).size !==
      targets.length ||
    !Array.isArray(versions) ||
    versions.length < 1 ||
    versions.length > 32 ||
    !versions.every(
      (version) =>
        version &&
        typeof version === "object" &&
        typeof version.fileId === "string" &&
        version.fileId.length > 0 && // i18n-ignore positive identifier length validation
        version.fileId.length <= 128 &&
        typeof version.filename === "string" &&
        version.filename.length > 0 &&
        version.filename.length <= 256 &&
        typeof version.versionHash === "string" &&
        version.versionHash.length > 0 && // i18n-ignore positive hash length validation
        version.versionHash.length <= 256,
    ) ||
    new Set(versions.map((version) => version.fileId)).size !==
      versions.length ||
    versions.filter((version) => version.fileId === expected.fileId).length !==
      1
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The prepared native scene does not match the selected Design file.",
    );
  if (
    expected.expectedVersionHash !== undefined &&
    versions.find((version) => version.fileId === expected.fileId)
      ?.versionHash !== expected.expectedVersionHash
  )
    throw new NativeSceneExportError(
      "source-stale",
      "Design source changed before the local export could start.",
    );
  return scene as PreparedNativeScene;
}

function preparedRuntimeHasInitialDensity(
  html: unknown,
  pixelRatio: number,
): boolean {
  if (typeof html !== "string") return false;
  const document = new DOMParser().parseFromString(html, "text/html");
  const runtimes = document.querySelectorAll(
    "script[data-agent-native-native-shader-runtime]",
  );
  return (
    runtimes.length === 1 &&
    runtimes[0]?.getAttribute(
      "data-agent-native-export-initial-pixel-ratio",
    ) === String(pixelRatio)
  );
}

function awaitFrameLoad(
  frame: HTMLIFrameElement,
  signal: AbortSignal,
): Promise<Window> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      frame.removeEventListener("load", onLoad);
      signal.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
        return;
      }
      try {
        if (frame.contentWindow && frame.contentDocument?.documentElement) {
          resolve(frame.contentWindow);
          return;
        }
      } catch (cause) {
        reject(
          new NativeSceneExportError(
            "frame-unavailable",
            `The native export frame is not same-origin: ${String(cause)}`,
          ),
        );
        return;
      }
      reject(
        new NativeSceneExportError(
          "frame-unavailable",
          "The native export frame has no same-origin document.",
        ),
      );
    };
    const onLoad = () => finish();
    const onAbort = () =>
      finish(
        new NativeSceneExportError(
          "frame-unavailable",
          "The native export frame load was canceled.",
        ),
      );
    const timeout = setTimeout(
      () =>
        finish(
          new NativeSceneExportError(
            "frame-unavailable",
            "The native export frame did not load in time.",
          ),
        ),
      LOAD_TIMEOUT_MS,
    );
    frame.addEventListener("load", onLoad, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function requestNativeStatus(
  target: Window,
  instance: PreparedNativeScene["instanceTargets"][number],
  signal: AbortSignal,
): Promise<NativeShaderRuntimeStatus | null> {
  const requestId = `export_${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      status: NativeShaderRuntimeStatus | null,
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(status);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target || event.origin !== window.location.origin)
        return;
      const status = readNativeShaderRuntimeStatus(event.data);
      if (
        status?.requestId === requestId &&
        status.instanceId === instance.instanceId &&
        status.nodeId === instance.nodeId
      )
        finish(status);
    };
    const onAbort = () =>
      finish(
        null,
        new NativeSceneExportError(
          "native-not-ready",
          "Native export status was canceled.",
        ),
      );
    const timeout = setTimeout(() => finish(null), 900);
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    target.postMessage(
      {
        type: "native-shader-status-request",
        requestId,
        instanceId: instance.instanceId,
        nodeId: instance.nodeId,
      },
      window.location.origin,
    );
  });
}

export async function awaitNativeExportApprovalRescan(
  target: Window,
  runtime: NativePixelRuntime,
  instances: PreparedNativeScene["instanceTargets"],
  signal: AbortSignal,
): Promise<void> {
  if (!instances.length) return;
  if (!runtime.scan)
    throw new NativeSceneExportError(
      "native-unavailable",
      "The trusted native renderer is unavailable in the export frame.",
    );
  // The status reply is ordered after the approval message in the child queue.
  const reply = await requestNativeStatus(target, instances[0], signal);
  if (!reply)
    throw new NativeSceneExportError(
      "native-not-ready",
      `Native effect ${instances[0].instanceId} returned no readable status before the export deadline.`,
    );
  await awaitNativeRasterWork(runtime.scan(), signal);
}

export async function awaitNativeReady(
  target: Window,
  instances: PreparedNativeScene["instanceTargets"],
  signal: AbortSignal,
): Promise<void> {
  const deadline = performance.now() + STATUS_TIMEOUT_MS;
  for (const instance of instances) {
    let ready = false;
    let lastStatus: NativeShaderRuntimeStatus | null = null;
    let responseCount = 0;
    while (performance.now() < deadline) {
      const status = await requestNativeStatus(target, instance, signal);
      if (!status) continue;
      lastStatus = status;
      responseCount += 1;
      if (status.status === "ready" && status.backend === "webgpu") {
        ready = true;
        break;
      }
      if (status.status === "error" || status.status === "last-good")
        throw new NativeSceneExportError(
          "native-not-ready",
          `Native effect ${instance.instanceId} reported ${status.status}/${status.code ?? "unknown"}: ${status.message ?? "No diagnostic was provided."}`,
        );
    }
    if (ready) continue;
    if (lastStatus)
      throw new NativeSceneExportError(
        "native-not-ready",
        `Native effect ${instance.instanceId} stayed ${lastStatus.status}/${lastStatus.code ?? "unknown"} after ${responseCount} status replies.`,
      );
    throw new NativeSceneExportError(
      "native-not-ready",
      `Native effect ${instance.instanceId} returned no readable status before the export deadline.`,
    );
  }
}

function expectedNativeScenePixels(
  viewport: { width: number; height: number },
  pixelRatio: number,
): { width: number; height: number } {
  const expectedWidth = Math.ceil(viewport.width * pixelRatio);
  const expectedHeight = Math.ceil(viewport.height * pixelRatio);
  if (
    !validViewport(viewport) ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0 ||
    pixelRatio > 4 ||
    expectedWidth > MAX_SIDE ||
    expectedHeight > MAX_SIDE ||
    expectedWidth * expectedHeight > MAX_PIXELS
  )
    throw new NativeSceneExportError(
      "frame-too-large",
      "The requested native export dimensions exceed the GPU frame limit.",
    );
  return { width: expectedWidth, height: expectedHeight };
}

export function readNativeScenePixels(
  value: unknown,
  viewport: { width: number; height: number },
  pixelRatio: number,
): { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const { width: expectedWidth, height: expectedHeight } =
    expectedNativeScenePixels(viewport, pixelRatio);
  if (!value || typeof value !== "object")
    throw new NativeSceneExportError(
      "pixels-unreadable",
      "The native export did not return a pixel frame.",
    );
  const frame = value as Record<string, unknown>;
  if (
    frame.width !== expectedWidth ||
    frame.height !== expectedHeight ||
    frame.colorSpace !== "srgb" ||
    frame.alpha !== "straight" ||
    !ArrayBuffer.isView(frame.rgba) ||
    Object.prototype.toString.call(frame.rgba) !== "[object Uint8Array]" ||
    frame.rgba.byteLength !== expectedWidth * expectedHeight * 4
  )
    throw new NativeSceneExportError(
      "pixels-unreadable",
      "The native export returned mismatched or incomplete sRGB pixels.",
    );
  const rgba = new Uint8ClampedArray(
    new ArrayBuffer(expectedWidth * expectedHeight * 4),
  );
  rgba.set(frame.rgba as Uint8Array);
  return {
    width: expectedWidth,
    height: expectedHeight,
    rgba,
  };
}

export type NativeSceneFrame = {
  frameIndex: number;
  width: number;
  height: number;
  colorSpace: "srgb";
  alpha: "straight";
  rgba: Uint8Array;
};

export function padNativeVideoFrame(
  frame: NativeSceneFrame,
  coded: { width: number; height: number },
): NativeSceneFrame {
  if (
    !Number.isInteger(coded.width) ||
    !Number.isInteger(coded.height) ||
    coded.width < frame.width ||
    coded.height < frame.height ||
    coded.width - frame.width > 1 ||
    coded.height - frame.height > 1 ||
    coded.width % 2 !== 0 ||
    coded.height % 2 !== 0 ||
    frame.rgba.byteLength !== frame.width * frame.height * 4
  )
    throw new NativeSceneExportError(
      "video-unavailable",
      "The selected video frame cannot fit its even codec dimensions.",
    );
  if (coded.width === frame.width && coded.height === frame.height)
    return frame;
  const rgba = new Uint8Array(coded.width * coded.height * 4);
  for (let row = 0; row < frame.height; row++) {
    const sourceOffset = row * frame.width * 4;
    rgba.set(
      frame.rgba.subarray(sourceOffset, sourceOffset + frame.width * 4),
      row * coded.width * 4,
    );
  }
  return { ...frame, width: coded.width, height: coded.height, rgba };
}

export async function captureNativeSceneFrames(args: {
  runtime: NativePixelRuntime;
  viewport: { width: number; height: number };
  pixelRatio: number;
  fps: number;
  frameCount: number;
  startTimeSeconds: number;
  signal: AbortSignal;
  simulationSessionId?: string;
  crop?: NonNullable<SelectedNativeSceneArgs["crop"]>;
  appendFrame: (frame: NativeSceneFrame) => Promise<void>;
}): Promise<void> {
  if (
    ![24, 30, VIDEO_FPS].includes(args.fps) ||
    !Number.isInteger(args.frameCount) ||
    args.frameCount < 1 ||
    args.frameCount > MAX_VIDEO_FRAMES ||
    !Number.isFinite(args.startTimeSeconds) ||
    args.startTimeSeconds < 0 ||
    args.startTimeSeconds + (args.frameCount - 1) / args.fps >
      MAX_VIDEO_TIME_SECONDS
  )
    throw new NativeSceneExportError(
      "video-unavailable",
      "The requested native video timeline exceeds its frame limit.",
    );
  expectedNativeScenePixels(args.viewport, args.pixelRatio);
  for (let frameIndex = 0; frameIndex < args.frameCount; frameIndex++) {
    if (args.signal.aborted)
      throw new NativeSceneExportError(
        "video-unavailable",
        "Native video export was canceled.",
      );
    const options = {
      frameIndex,
      fps: args.fps,
      startTimeSeconds: args.startTimeSeconds,
      sourceContract: "declarative-only" as const,
      viewport: args.viewport,
      pixelRatio: args.pixelRatio,
      signal: args.signal,
      timeoutMs: 30_000,
      ...(args.simulationSessionId && {
        simulationSessionId: args.simulationSessionId,
      }),
    };
    const crop = args.crop;
    let raw: NativePixelResult;
    if (crop) {
      const renderHeldFrame = args.runtime.renderCompositionVectorFrame;
      if (!renderHeldFrame)
        throw new NativeSceneExportError(
          "native-unavailable",
          "The trusted renderer cannot fence selected geometry during video export.",
        );
      raw = await renderHeldFrame(options, async (held) => {
        assertPreparedNativeFullSceneCrop(held.document, crop, args.pixelRatio);
        return held.pixels;
      });
    } else {
      raw = await args.runtime.renderCompositionFramePixels(options);
    }
    const readPixels = readNativeScenePixels(
      raw,
      args.viewport,
      args.pixelRatio,
    );
    const fullPixels = {
      ...readPixels,
      colorSpace: "srgb" as const,
      alpha: "straight" as const,
      rgba: new Uint8Array(
        readPixels.rgba.buffer,
        readPixels.rgba.byteOffset,
        readPixels.rgba.byteLength,
      ),
    };
    const pixels = args.crop
      ? cropNativeScenePixels(
          fullPixels,
          args.crop,
          args.viewport,
          args.pixelRatio,
        )
      : fullPixels;
    if (args.signal.aborted)
      throw new NativeSceneExportError(
        "video-unavailable",
        "Native video export was canceled.",
      );
    await args.appendFrame({
      frameIndex,
      width: pixels.width,
      height: pixels.height,
      colorSpace: "srgb",
      alpha: "straight",
      rgba: Uint8Array.from(pixels.rgba),
    });
  }
}

export function sceneRequiresNativeStateSession(sceneHtml: string): boolean {
  const parsed = parseEffectsFromHtml(sceneHtml);
  if (parsed.errors.length)
    throw new NativeSceneExportError(
      "scene-unreadable",
      `The native source manifest is unreadable: ${parsed.errors.join("; ")}`,
    );
  if (!parsed.document) return false;
  const definitions = new Map(
    parsed.document.definitions.map((definition) => [
      `${definition.id}:${definition.version}`,
      definition,
    ]),
  );
  return parsed.document.instances.some((instance) => {
    if (!instance.enabled) return false;
    const definition = definitions.get(
      `${instance.definitionId}:${instance.definitionVersion}`,
    );
    return definition?.kind === "simulation" || Boolean(definition?.feedback);
  });
}

export async function withNativeSimulationSession<T>(args: {
  runtime: NativePixelRuntime;
  fps: number;
  frameCount: number;
  startTimeSeconds: number;
  signal: AbortSignal;
  run: (sessionId: string) => Promise<T>;
}): Promise<T> {
  if (
    !args.runtime.beginSimulationExportSession ||
    !args.runtime.endSimulationExportSession
  )
    throw new NativeSceneExportError(
      "native-unavailable",
      "The native runtime cannot export persistent simulations yet.",
    );
  if (args.startTimeSeconds !== 0)
    throw new NativeSceneExportError(
      "video-unavailable",
      "Particle export currently needs a start time of zero for deterministic state.",
    );
  const { sessionId } = await args.runtime.beginSimulationExportSession({
    fps: args.fps,
    totalFrames: args.frameCount,
    startTimeSeconds: 0,
    signal: args.signal,
  });
  let failed = false;
  let primaryError: unknown;
  let result: T | undefined;
  try {
    result = await args.run(sessionId);
  } catch (error) {
    failed = true;
    primaryError = error;
  }
  try {
    await args.runtime.endSimulationExportSession(sessionId);
  } catch (cleanupError) {
    if (failed)
      throw new NativeSceneExportCleanupError([primaryError, cleanupError]);
    throw cleanupError;
  }
  if (failed) throw primaryError;
  return result as T;
}

type SelectedNativeSceneArgs = {
  designId: string;
  fileId: string;
  viewport: { width: number; height: number };
  pixelRatio: number;
  expectedVersionHash?: string;
  assertStillViewed?: () => void;
  signal?: AbortSignal;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    nodeId: string;
  };
  sourceViewport?: { width: number; height: number };
};

export function offsetNativeSceneForCrop(
  html: string,
  crop: NonNullable<SelectedNativeSceneArgs["crop"]>,
): string {
  if (
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !Number.isInteger(crop.width) ||
    !Number.isInteger(crop.height) ||
    crop.width < 1 ||
    crop.height < 1 ||
    !crop.nodeId
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native crop is invalid.",
    );
  const headEnd = /<\/head\s*>/i;
  if (!headEnd.test(html))
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The prepared native scene has no head for its export crop.",
    );
  // The authored board may place its selected frame well beyond the export viewport.
  const style = `<style data-agent-native-export-crop>body{translate:${-crop.x}px ${-crop.y}px !important}</style>`;
  return html.replace(headEnd, `${style}</head>`);
}

export function assertPreparedNativeCrop(
  doc: Document,
  crop: NonNullable<SelectedNativeSceneArgs["crop"]>,
): void {
  const target = Array.from(
    doc.querySelectorAll("[data-agent-native-node-id]"),
  ).find(
    (element) =>
      element.getAttribute("data-agent-native-node-id") === crop.nodeId,
  );
  const rect = target?.getBoundingClientRect();
  if (
    !rect ||
    Math.abs(rect.left) > 1 ||
    Math.abs(rect.top) > 1 ||
    Math.abs(rect.width - crop.width) > 1 ||
    Math.abs(rect.height - crop.height) > 1
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native frame changed geometry during export preparation.",
    );
}

export function assertPreparedNativeFullSceneCrop(
  doc: Document,
  crop: NonNullable<SelectedNativeSceneArgs["crop"]>,
  pixelRatio: number,
): void {
  const targets = Array.from(
    doc.querySelectorAll("[data-agent-native-node-id]"),
  ).filter(
    (element) =>
      element.getAttribute("data-agent-native-node-id") === crop.nodeId,
  );
  const rect = targets[0]?.getBoundingClientRect();
  if (
    targets.length !== 1 ||
    !rect ||
    Math.abs((rect.left - crop.x) * pixelRatio) > 0.000001 ||
    Math.abs((rect.top - crop.y) * pixelRatio) > 0.000001 ||
    Math.abs((rect.width - crop.width) * pixelRatio) > 0.000001 ||
    Math.abs((rect.height - crop.height) * pixelRatio) > 0.000001
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native frame changed geometry during full-scene export preparation.",
    );
}

export function cropNativeScenePixels(
  pixels: NativePixelResult,
  crop: NonNullable<SelectedNativeSceneArgs["crop"]>,
  viewport: { width: number; height: number },
  pixelRatio: number,
): NativePixelResult {
  const output = expectedNativeScenePixels(
    { width: crop.width, height: crop.height },
    pixelRatio,
  );
  const startX = crop.x * pixelRatio;
  const startY = crop.y * pixelRatio;
  const endX = (crop.x + crop.width) * pixelRatio;
  const endY = (crop.y + crop.height) * pixelRatio;
  const pixelX = Math.round(startX);
  const pixelY = Math.round(startY);
  const expected = expectedNativeScenePixels(viewport, pixelRatio);
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    !Number.isInteger(startX) ||
    !Number.isInteger(startY) ||
    !Number.isInteger(endX) ||
    !Number.isInteger(endY) ||
    endX - pixelX !== output.width ||
    endY - pixelY !== output.height ||
    pixelX < 0 ||
    pixelY < 0 ||
    pixelX + output.width > expected.width ||
    pixelY + output.height > expected.height ||
    pixels.width !== expected.width ||
    pixels.height !== expected.height ||
    pixels.rgba.byteLength !== expected.width * expected.height * 4 ||
    pixels.colorSpace !== "srgb" ||
    pixels.alpha !== "straight"
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native crop is not pixel-aligned within the full scene.",
    );
  for (let row = 0; row < output.height; row++) {
    const start = ((pixelY + row) * expected.width + pixelX) * 4;
    pixels.rgba.copyWithin(
      row * output.width * 4,
      start,
      start + output.width * 4,
    );
  }
  return {
    ...pixels,
    width: output.width,
    height: output.height,
    rgba: pixels.rgba.subarray(0, output.width * output.height * 4),
  };
}

export function awaitNativeRasterWork<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function encodeNativeRasterCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number | undefined,
  signal: AbortSignal,
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (blob: Blob | null, error?: NativeSceneExportError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(blob);
    };
    const onAbort = () =>
      finish(
        null,
        signal.reason instanceof NativeSceneExportError
          ? signal.reason
          : new NativeSceneExportError(
              "export-canceled",
              "Image export was canceled before encoding completed.",
            ),
      );
    const timer = setTimeout(
      () =>
        finish(
          null,
          new NativeSceneExportError(
            "export-timeout",
            "Image encoding did not finish in time.",
          ),
        ),
      RASTER_ENCODE_TIMEOUT_MS,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      canvas.toBlob((blob) => finish(blob), mimeType, quality);
    } catch (error) {
      finish(
        null,
        new NativeSceneExportError(
          "pixels-unreadable",
          `Image encoding failed: ${String(error)}`,
        ),
      );
    }
  });
}

async function withSelectedNativeScene<Result>(
  args: SelectedNativeSceneArgs & { deadlineMs?: number },
  consume: (
    runtime: NativePixelRuntime,
    scene: PreparedNativeScene,
    signal: AbortSignal,
  ) => Promise<Result>,
): Promise<Result> {
  expectedNativeScenePixels(args.viewport, args.pixelRatio);
  const renderViewport = args.sourceViewport ?? args.viewport;
  expectedNativeScenePixels(renderViewport, args.pixelRatio);
  if (
    args.sourceViewport &&
    (!args.crop ||
      args.crop.x < 0 ||
      args.crop.y < 0 ||
      args.crop.x + args.crop.width > renderViewport.width ||
      args.crop.y + args.crop.height > renderViewport.height)
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native crop lies outside its mounted source viewport.",
    );
  if (
    args.crop &&
    (args.crop.width !== args.viewport.width ||
      args.crop.height !== args.viewport.height)
  )
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected crop and native output viewport differ.",
    );
  const controller = new AbortController();
  const onAbort = () =>
    controller.abort(
      args.signal?.reason ??
        new NativeSceneExportError(
          "export-canceled",
          "The local export was canceled.",
        ),
    );
  args.signal?.addEventListener("abort", onAbort, { once: true });
  if (args.signal?.aborted) onAbort();
  const deadline =
    args.deadlineMs === undefined
      ? null
      : setTimeout(
          () =>
            controller.abort(
              new NativeSceneExportError(
                "export-timeout",
                "Image export did not finish in time.",
              ),
            ),
          args.deadlineMs,
        );
  const frame = document.createElement("iframe");
  let runtimeForDiagnostic: NativePixelRuntime | undefined;
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
  frame.tabIndex = -1;
  frame.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    `width:${renderViewport.width}px`,
    `height:${renderViewport.height}px`,
    "border:0",
    "pointer-events:none",
  ].join(";");
  try {
    const response = await awaitNativeRasterWork(
      callAction<unknown>(
        "prepare-native-scene-export",
        {
          designId: args.designId,
          fileId: args.fileId,
          viewportWidth: renderViewport.width,
          viewportHeight: renderViewport.height,
          pixelRatio: args.pixelRatio,
        },
        { method: "GET", signal: controller.signal },
      ),
      controller.signal,
    );
    const scene = readPreparedScene(response, {
      designId: args.designId,
      fileId: args.fileId,
      width: renderViewport.width,
      height: renderViewport.height,
      pixelRatio: args.pixelRatio,
      expectedVersionHash: args.expectedVersionHash,
    });
    args.assertStillViewed?.();
    const loaded = awaitFrameLoad(frame, controller.signal);
    frame.srcdoc =
      args.crop && !args.sourceViewport
        ? offsetNativeSceneForCrop(scene.html, args.crop)
        : scene.html;
    document.body.appendChild(frame);
    const target = await loaded;
    if (args.crop) {
      const exportDoc = frame.contentDocument;
      if (!exportDoc)
        throw new NativeSceneExportError(
          "scene-unreadable",
          "The selected native export frame is unreadable.",
        );
      if (args.sourceViewport)
        assertPreparedNativeFullSceneCrop(
          exportDoc,
          args.crop,
          args.pixelRatio,
        );
      else assertPreparedNativeCrop(exportDoc, args.crop);
    }
    const runtime = (
      target as Window & { __anNativeShaders?: NativePixelRuntime }
    ).__anNativeShaders;
    runtimeForDiagnostic = runtime;
    if (!runtime?.renderCompositionFramePixels)
      throw new NativeSceneExportError(
        "native-unavailable",
        "The trusted native renderer is unavailable in the export frame.",
      );
    postNativeApprovalState(target, window.location.origin, {
      status: "ready",
      hashes: scene.approvedDefinitionHashes,
    });
    await awaitNativeExportApprovalRescan(
      target,
      runtime,
      scene.instanceTargets,
      controller.signal,
    );
    await awaitNativeReady(target, scene.instanceTargets, controller.signal);
    args.assertStillViewed?.();
    const result = await consumeNativeSceneWithViewedSourceFence(
      () =>
        awaitNativeRasterWork(
          consume(runtime, scene, controller.signal),
          controller.signal,
        ),
      args.assertStillViewed,
    );
    reportNativeCompositionScene(runtime, false);
    return result;
  } catch (error) {
    reportNativeCompositionScene(runtimeForDiagnostic, true);
    if (controller.signal.reason instanceof NativeSceneExportError)
      throw controller.signal.reason;
    throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
    controller.abort();
    args.signal?.removeEventListener("abort", onAbort);
    frame.remove();
  }
}

export async function consumeNativeSceneWithViewedSourceFence<Result>(
  consume: () => Promise<Result>,
  assertStillViewed?: () => void,
): Promise<Result> {
  const result = await consume();
  assertStillViewed?.();
  return result;
}

export async function renderOneNativeFrame(
  runtime: NativePixelRuntime,
  scene: PreparedNativeScene,
  pixelRatio: number,
  signal: AbortSignal,
  crop?: NonNullable<SelectedNativeSceneArgs["crop"]>,
): Promise<NativePixelResult> {
  const render = (simulationSessionId?: string) => {
    const options = {
      frameIndex: 0,
      fps: 60,
      sourceContract: "declarative-only" as const,
      viewport: scene.viewport,
      pixelRatio,
      signal,
      timeoutMs: 30_000,
      ...(simulationSessionId && { simulationSessionId }),
    };
    if (!crop) return runtime.renderCompositionFramePixels(options);
    if (!runtime.renderCompositionVectorFrame)
      throw new NativeSceneExportError(
        "native-unavailable",
        "The trusted renderer cannot fence selected geometry during export.",
      );
    return runtime.renderCompositionVectorFrame(options, async (held) => {
      assertPreparedNativeFullSceneCrop(held.document, crop, pixelRatio);
      return held.pixels;
    });
  };
  const raw = sceneRequiresNativeStateSession(scene.html)
    ? await withNativeSimulationSession({
        runtime,
        fps: 60,
        frameCount: 1,
        startTimeSeconds: 0,
        signal,
        run: render,
      })
    : await render();
  const pixels = readNativeScenePixels(raw, scene.viewport, pixelRatio);
  return {
    ...pixels,
    colorSpace: "srgb",
    alpha: "straight",
    rgba: new Uint8Array(pixels.rgba),
  };
}

export async function encodeNativeScenePng(
  pixels: NativePixelResult,
  signal: AbortSignal,
): Promise<Blob> {
  try {
    return await encodeStraightRgbaPng(pixels, signal);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof NativePngEncodingError)
      throw new NativeSceneExportError(
        error.code === "encoding-timeout"
          ? "export-timeout"
          : "pixels-unreadable",
        error.message,
      );
    throw error;
  }
}

export async function renderSelectedNativeSceneBlob(
  args: SelectedNativeSceneArgs & {
    format: NativeRasterFormat;
  },
): Promise<Blob> {
  if (args.crop && !args.sourceViewport)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "Selected native raster export needs the mounted full-scene viewport.",
    );
  return withSelectedNativeScene(
    { ...args, deadlineMs: RASTER_EXPORT_TIMEOUT_MS },
    async (runtime, scene, signal) => {
      const fullPixels = await renderOneNativeFrame(
        runtime,
        scene,
        args.pixelRatio,
        signal,
        args.crop ?? undefined,
      );
      const pixels = args.crop
        ? cropNativeScenePixels(
            fullPixels,
            args.crop,
            scene.viewport,
            args.pixelRatio,
          )
        : fullPixels;
      let encoded: Blob | null;
      if (args.format === "png") {
        encoded = await encodeNativeScenePng(pixels, signal);
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = pixels.width;
        canvas.height = pixels.height;
        const context = canvas.getContext("2d");
        if (!context)
          throw new NativeSceneExportError(
            "pixels-unreadable",
            "The browser cannot encode native export pixels.",
          );
        context.putImageData(
          new ImageData(
            new Uint8ClampedArray(
              args.format === "jpg"
                ? flattenStraightRgbaOnWhite(new Uint8Array(pixels.rgba))
                : pixels.rgba,
            ),
            pixels.width,
            pixels.height,
          ),
          0,
          0,
        );
        encoded = await encodeNativeRasterCanvas(
          canvas,
          rasterMimeType(args.format),
          0.95,
          signal,
        );
      }
      let blob: Blob;
      try {
        blob = await validateEncodedRasterBlob(encoded, args.format);
      } catch (error) {
        if (
          error instanceof NativeRasterEncodingError &&
          error.code === "raster-format-unsupported"
        )
          throw new NativeSceneExportError("format-unavailable", error.message);
        throw new NativeSceneExportError(
          "pixels-unreadable",
          `The browser could not encode the requested image format: ${String(error)}`,
        );
      }
      if (signal.aborted)
        throw new NativeSceneExportError(
          "pixels-unreadable",
          "The native export was canceled before image encoding finished.",
        );
      localQaSinkEnabledByBlob.set(blob, scene.localQaSinkEnabled);
      return blob;
    },
  );
}

async function captureNativeScenePoster(
  runtime: NativePixelRuntime,
  scene: PreparedNativeScene,
  pixelRatio: number,
  signal: AbortSignal,
): Promise<Blob> {
  const pixels = await renderOneNativeFrame(runtime, scene, pixelRatio, signal);
  const encoded = await encodeNativeScenePng(pixels, signal);
  const poster = await validateEncodedRasterBlob(encoded, "png");
  if (signal.aborted) throw signal.reason;
  return poster;
}

async function selectedPackageHtml(
  html: string,
  crop: SelectedNativeSceneArgs["crop"],
): Promise<string> {
  if (!crop) return html;
  try {
    return await extractNativeSelectedSource({ html, crop });
  } catch (error) {
    if (error instanceof NativeSelectedSourceError)
      throw new NativeSceneExportError("scene-unreadable", error.message);
    throw error;
  }
}

export async function renderSelectedNativeStandaloneHtml(
  args: SelectedNativeSceneArgs,
): Promise<Blob> {
  return withSelectedNativeScene(
    { ...args, deadlineMs: RASTER_EXPORT_TIMEOUT_MS },
    async (runtime, scene, signal) => {
      const html = await selectedPackageHtml(scene.html, args.crop);
      const poster = await captureNativeScenePoster(
        runtime,
        scene,
        args.pixelRatio,
        signal,
      );
      const blob = await buildNativeStandaloneHtml({
        html,
        poster,
        viewport: scene.viewport,
        pixelRatio: args.pixelRatio,
        signal,
      });
      localQaSinkEnabledByBlob.set(blob, scene.localQaSinkEnabled);
      return blob;
    },
  );
}

export async function renderSelectedNativeCodePackage(
  args: SelectedNativeSceneArgs,
): Promise<Blob> {
  return withSelectedNativeScene(
    { ...args, deadlineMs: RASTER_EXPORT_TIMEOUT_MS },
    async (runtime, scene, signal) => {
      const html = await selectedPackageHtml(scene.html, args.crop);
      const poster = await captureNativeScenePoster(
        runtime,
        scene,
        args.pixelRatio,
        signal,
      );
      const blob = await buildNativeCodePackage({
        html,
        poster,
        viewport: scene.viewport,
        pixelRatio: args.pixelRatio,
        signal,
      });
      localQaSinkEnabledByBlob.set(blob, scene.localQaSinkEnabled);
      return blob;
    },
  );
}

async function renderHybridSvgInScene(
  runtime: NativePixelRuntime,
  scene: PreparedNativeScene,
  pixelRatio: number,
  signal: AbortSignal,
): Promise<string> {
  const renderFrame = runtime.renderCompositionVectorFrame;
  if (!renderFrame)
    throw new NativeSceneExportError(
      "native-unavailable",
      "The native runtime cannot hold a synchronized vector frame.",
    );
  const render = (simulationSessionId?: string) =>
    renderFrame(
      {
        frameIndex: 0,
        fps: 60,
        sourceContract: "declarative-only",
        viewport: scene.viewport,
        pixelRatio,
        signal,
        timeoutMs: 30_000,
        ...(simulationSessionId && { simulationSessionId }),
      },
      async (frame) => {
        const output = await buildNativeHybridSvgFromFrame(frame);
        return output.svg;
      },
    );
  return sceneRequiresNativeStateSession(scene.html)
    ? withNativeSimulationSession({
        runtime,
        fps: 60,
        frameCount: 1,
        startTimeSeconds: 0,
        signal,
        run: render,
      })
    : render();
}

export async function renderSelectedNativeHybridSvg(
  args: SelectedNativeSceneArgs,
): Promise<Blob> {
  return withSelectedNativeScene(
    { ...args, deadlineMs: RASTER_EXPORT_TIMEOUT_MS },
    async (runtime, scene, signal) => {
      const svg = await renderHybridSvgInScene(
        runtime,
        scene,
        args.pixelRatio,
        signal,
      );
      if (signal.aborted) throw signal.reason;
      const blob = new Blob([svg], { type: "image/svg+xml" });
      localQaSinkEnabledByBlob.set(blob, scene.localQaSinkEnabled);
      return blob;
    },
  );
}

export async function renderSelectedNativeHybridPdf(
  args: SelectedNativeSceneArgs,
): Promise<Blob> {
  return withSelectedNativeScene(
    { ...args, deadlineMs: RASTER_EXPORT_TIMEOUT_MS },
    async (runtime, scene, signal) => {
      const svg = await renderHybridSvgInScene(
        runtime,
        scene,
        args.pixelRatio,
        signal,
      );
      const blob = await renderNativeHybridPdf({
        svg,
        width: scene.viewport.width,
        height: scene.viewport.height,
        signal,
      });
      localQaSinkEnabledByBlob.set(blob, scene.localQaSinkEnabled);
      return blob;
    },
  );
}

export async function renderSelectedNativeSceneMp4Blob(
  args: Omit<SelectedNativeSceneArgs, "pixelRatio"> & {
    settings: NativeVideoSettings;
    onProgress?: (completed: number, total: number) => void;
  },
): Promise<Blob> {
  const frameCount = nativeVideoFrameCount(args.settings);
  if (args.crop && !args.sourceViewport)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "Selected native video export needs the mounted full-scene viewport.",
    );
  return withSelectedNativeScene(
    { ...args, pixelRatio: args.settings.pixelRatio },
    async (runtime, scene, signal) => {
      const outputSize = expectedNativeScenePixels(
        args.viewport,
        args.settings.pixelRatio,
      );
      const size = nativeVideoCodedDimensions(
        outputSize.width,
        outputSize.height,
      );
      if (
        size.width > MAX_SIDE ||
        size.height > MAX_SIDE ||
        size.width * size.height > MAX_PIXELS
      )
        throw new NativeSceneExportError(
          "frame-too-large",
          "The even native video dimensions exceed the GPU frame limit.",
        );
      const { createNativeSceneMp4Writer } =
        await import("@/pages/design-editor/native-scene-mp4-writer");
      const writer = await createNativeSceneMp4Writer({
        width: size.width,
        height: size.height,
        fps: args.settings.fps,
        frameCount,
        signal,
        quality: args.settings.quality,
        matte: args.settings.matte,
        onProgress: args.onProgress,
      });
      try {
        const capture = (simulationSessionId?: string) =>
          captureNativeSceneFrames({
            runtime,
            viewport: scene.viewport,
            pixelRatio: args.settings.pixelRatio,
            fps: args.settings.fps,
            frameCount,
            startTimeSeconds: args.settings.startTimeSeconds,
            signal,
            simulationSessionId,
            crop: args.crop,
            appendFrame: (frame) =>
              writer.appendFrame(padNativeVideoFrame(frame, size)),
          });
        if (sceneRequiresNativeStateSession(scene.html))
          await withNativeSimulationSession({
            runtime,
            fps: args.settings.fps,
            frameCount,
            startTimeSeconds: args.settings.startTimeSeconds,
            signal,
            run: capture,
          });
        else await capture();
        const blob = await writer.finalize();
        localQaSinkEnabledByBlob.set(blob, scene.localQaSinkEnabled);
        return blob;
      } catch (error) {
        try {
          await writer.cancel();
        } catch (cleanupError) {
          throw new NativeSceneExportCleanupError([error, cleanupError]);
        }
        throw error;
      }
    },
  );
}
