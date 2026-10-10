import { hashEffectDefinition } from "@shared/native-effect-trust";
import { parseEffectsFromHtml } from "@shared/native-effects";
import type { NativePresentationFaultGrant } from "@shared/native-presentation-fault-gate";
import type {
  NativeShaderValidationCaseResult,
  NativeShaderValidationState,
} from "@shared/native-shader-validation";
import {
  nativeMountedOutputSummarySchema,
  nativeLinearGoldenSummarySchema,
  nativeShaderMountedMeasurementSchema,
} from "@shared/native-shader-validation";

import { postNativeApprovalState } from "@/components/design/design-canvas/native-approval-bridge";
import {
  readNativeShaderRuntimeStatus,
  type NativeShaderRuntimeStatus,
} from "@/components/design/design-canvas/native-status-bridge";
import { readNativeViewedSourceLease } from "@/components/design/design-canvas/native-viewed-source-lease";
import { findNativeDraftFrame } from "@/components/design/inspector/native-shader-draft-client";

import { readPreparedScene } from "./native-scene-export-client";
import {
  readMountedSceneProfile,
  unavailableMountedSceneProfile,
} from "./native-shader-validation-profile";

type ValidationCase = NativeShaderValidationState["cases"][number];

type MountedFrameOptions = {
  frameIndex: number;
  fps: 60;
  startTimeSeconds: 0;
  sourceContract: "declarative-only";
  viewport: { width: number; height: number };
  pixelRatio: number;
  signal: AbortSignal;
  timeoutMs: number;
  simulationSessionId?: string;
};

type MountedFrameRuntime = {
  scan?: () => Promise<void>;
  renderAt?: (time: number) => Promise<unknown>;
  dispose?: () => void;
  measureMountedScene?: (options: {
    instanceId: string;
    executionHash: string;
    request: NonNullable<ValidationCase["mountedMeasurement"]>;
    signal: AbortSignal;
  }) => Promise<unknown>;
  beginSimulationExportSession?: (options: {
    fps: 60;
    totalFrames: number;
    startTimeSeconds: 0;
    signal: AbortSignal;
    timeoutMs: number;
  }) => Promise<{ sessionId: string }>;
  endSimulationExportSession?: (
    sessionId: string,
    options: { timeoutMs: number },
  ) => Promise<void>;
  renderCompositionFramePixels?: (
    options: MountedFrameOptions,
  ) => Promise<unknown>;
  renderCompositionFrameValidated?: (
    options: MountedFrameOptions,
    target: {
      instanceId: string;
      nodeId: string;
      definitionId: string;
      definitionVersion: number;
      executionHash: string;
      expectedLinearSamples?: NonNullable<
        ValidationCase["expectedLinearSamples"]
      >;
    },
  ) => Promise<unknown>;
  runReviewedPresentationFault?: (
    grant: NativePresentationFaultGrant,
  ) => Promise<{
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
  }>;
  renderCompositionFrameGolden?: (
    options: MountedFrameOptions,
    target: {
      instanceId: string;
      nodeId: string;
      expectedLinearSamples: NonNullable<
        ValidationCase["expectedLinearSamples"]
      >;
    },
  ) => Promise<unknown>;
};

export class NativeShaderValidationClientError extends Error {
  constructor(
    readonly code:
      | "frame-unavailable"
      | "runtime-unavailable"
      | "request-aborted",
  ) {
    super(code);
    this.name = "NativeShaderValidationClientError";
  }
}

export class NativeShaderValidationCleanupError extends Error {
  constructor(
    readonly renderError: unknown,
    readonly cleanupError: unknown,
  ) {
    super("simulation-session-cleanup-failed");
    this.name = "NativeShaderValidationCleanupError";
  }
}

function validationErrorDetail(error: unknown): {
  code: string;
  message: string;
} {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") break;
    const result = "result" in current ? current.result : null;
    const failures =
      result && typeof result === "object" && "failures" in result
        ? result.failures
        : null;
    if (Array.isArray(failures) && failures.length > 0) {
      const primary: unknown = failures[0];
      if (primary && typeof primary === "object") {
        const code = "code" in primary ? primary.code : null;
        const message = "message" in primary ? primary.message : null;
        if (
          typeof code === "string" &&
          /^[a-z][a-z0-9-]{0,79}$/.test(code) &&
          typeof message === "string" &&
          message.trim()
        )
          return { code, message: message.slice(0, 300) };
      }
      return {
        code: "mounted-render-failed",
        message: "mounted-viewport-unreadable",
      };
    }
    if (
      "causes" in current &&
      Array.isArray(current.causes) &&
      current.causes.length > 0
    ) {
      current = current.causes[0];
      continue;
    }
    if ("cause" in current && current.cause) {
      current = current.cause;
      continue;
    }
    break;
  }
  const rawCode =
    current && typeof current === "object" && "code" in current
      ? current.code
      : null;
  const rawMessage =
    current && typeof current === "object" && "message" in current
      ? current.message
      : null;
  const code =
    typeof rawCode === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(rawCode)
      ? rawCode
      : typeof rawMessage === "string" &&
          /^[a-z][a-z0-9-]{0,79}$/.test(rawMessage)
        ? rawMessage
        : "mounted-render-failed";
  const message =
    typeof rawMessage === "string" && rawMessage.trim() ? rawMessage : code;
  return { code, message: message.slice(0, 300) };
}

function mountedViewportError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function boundedViewportWork<T>(
  work: Promise<T>,
  signal: AbortSignal,
  code: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new NativeShaderValidationClientError("request-aborted"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(mountedViewportError(code));
    }, 10_000);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    work.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function mountedValidationViewport(
  sourceFrame: HTMLIFrameElement,
  viewport: { width: number; height: number },
  item: ValidationCase,
  preparedScene: Pick<
    ReturnType<typeof readPreparedScene>,
    "html" | "approvedDefinitionHashes"
  >,
  signal: AbortSignal,
): Promise<HTMLIFrameElement> {
  const sourceSrcdoc = sourceFrame.srcdoc || sourceFrame.getAttribute("srcdoc");
  if (
    !sourceSrcdoc ||
    !preparedScene.approvedDefinitionHashes.includes(item.executionHash)
  )
    throw mountedViewportError("mounted-viewport-source-unavailable");
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    `position:fixed;left:0;top:0;width:${viewport.width}px;height:${viewport.height}px;` +
    "opacity:0;pointer-events:none;z-index:-1;border:0;";
  const loaded = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      frame.removeEventListener("load", onLoad);
      frame.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timer);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(mountedViewportError("mounted-viewport-load-failed"));
    };
    const onAbort = () => {
      cleanup();
      reject(new NativeShaderValidationClientError("request-aborted"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(mountedViewportError("mounted-viewport-load-timeout"));
    }, 10_000);
    frame.addEventListener("load", onLoad);
    frame.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  frame.srcdoc = preparedScene.html;
  document.body.append(frame);
  try {
    await loaded;
    if (signal.aborted)
      throw new NativeShaderValidationClientError("request-aborted");
    if (
      !sourceFrame.isConnected ||
      (sourceFrame.srcdoc || sourceFrame.getAttribute("srcdoc")) !==
        sourceSrcdoc
    )
      throw mountedViewportError("mounted-viewport-source-stale");
    const target = frame.contentWindow as
      | (Window & { __anNativeShaders?: MountedFrameRuntime })
      | null;
    if (
      !target ||
      Math.abs(target.innerWidth - viewport.width) > 1 ||
      Math.abs(target.innerHeight - viewport.height) > 1
    )
      throw mountedViewportError("mounted-viewport-mismatch");
    if (!target.__anNativeShaders?.scan)
      throw mountedViewportError("mounted-viewport-runtime-unavailable");
    postNativeApprovalState(target, window.location.origin, {
      status: "ready",
      hashes: preparedScene.approvedDefinitionHashes,
    });
    // The same-window status reply is ordered after the approval message.
    // A direct scan here can run before the child receives those approvals.
    await statusFor(frame, item, signal);
    await boundedViewportWork(
      target.__anNativeShaders.scan(),
      signal,
      "mounted-viewport-scan-timeout",
    );
    const approvalStatus = await statusFor(frame, item, signal);
    if (
      approvalStatus.status === "error" ||
      approvalStatus.status === "last-good"
    )
      throw mountedViewportError(
        approvalStatus.code ?? "mounted-viewport-unready",
      );
    if (signal.aborted)
      throw new NativeShaderValidationClientError("request-aborted");
    return frame;
  } catch (error) {
    try {
      (
        frame.contentWindow as
          | (Window & { __anNativeShaders?: MountedFrameRuntime })
          | null
      )?.__anNativeShaders?.dispose?.();
    } finally {
      frame.remove();
    }
    throw error;
  }
}

function findValidationFrame(fileId: string): HTMLIFrameElement {
  try {
    return findNativeDraftFrame(fileId);
  } catch {
    return findNativeDraftFrame(fileId, true);
  }
}

function unavailable(
  item: ValidationCase,
  code: string,
  message: string,
): NativeShaderValidationCaseResult {
  return {
    caseId: item.caseId,
    definitionId: item.definitionId,
    definitionVersion: item.definitionVersion,
    executionHash: item.executionHash,
    backend: "unavailable",
    status: "unavailable",
    code: code.slice(0, 80),
    message: message.slice(0, 300),
    sceneProfile: unavailableMountedSceneProfile(
      code === "frame-source-stale"
        ? "source-stale"
        : code === "runtime-unavailable"
          ? "runtime-unavailable"
          : code === "status-unreadable"
            ? "status-unreadable"
            : "frame-unavailable",
    ),
    sourceCaptures: 0,
    frames: 0,
    estimatedResourceBytes: 0,
  };
}

async function statusFor(
  frame: HTMLIFrameElement,
  item: ValidationCase,
  signal: AbortSignal,
): Promise<NativeShaderRuntimeStatus> {
  const target = frame.contentWindow;
  if (!target) throw new NativeShaderValidationClientError("frame-unavailable");
  const requestId = `validate_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      window.clearTimeout(timer);
    };
    const finish = (result: NativeShaderRuntimeStatus | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onAbort = () =>
      finish(new NativeShaderValidationClientError("request-aborted"));
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target || event.origin !== window.location.origin)
        return;
      const status = readNativeShaderRuntimeStatus(event.data);
      if (
        status?.requestId === requestId &&
        status.instanceId === item.instanceId &&
        status.nodeId === item.nodeId
      )
        finish(status);
    };
    const timer = window.setTimeout(
      () =>
        finish(new NativeShaderValidationClientError("runtime-unavailable")),
      2_000,
    );
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    target.postMessage(
      {
        type: "native-shader-status-request",
        requestId,
        instanceId: item.instanceId,
        nodeId: item.nodeId,
      },
      window.location.origin,
    );
  });
}

async function verifyFrameSource(
  frame: HTMLIFrameElement,
  item: ValidationCase,
): Promise<{ matches: boolean; stateful: boolean }> {
  const root = frame.contentDocument?.documentElement;
  if (!root) throw new NativeShaderValidationClientError("frame-unavailable");
  const parsed = parseEffectsFromHtml(root.outerHTML);
  if (parsed.errors.length || !parsed.document)
    return { matches: false, stateful: false };
  const instance = parsed.document.instances.find(
    (candidate) => candidate.id === item.instanceId,
  );
  if (
    !instance ||
    !instance.enabled ||
    instance.nodeId !== item.nodeId ||
    instance.definitionId !== item.definitionId ||
    instance.definitionVersion !== item.definitionVersion
  )
    return { matches: false, stateful: false };
  const definition = parsed.document.definitions.find(
    (candidate) =>
      candidate.id === item.definitionId &&
      candidate.version === item.definitionVersion,
  );
  const definitions = new Map(
    parsed.document.definitions.map((candidate) => [
      `${candidate.id}:${candidate.version}`,
      candidate,
    ]),
  );
  return {
    matches:
      !!definition &&
      (await hashEffectDefinition(definition)) === item.executionHash,
    stateful: parsed.document.instances.some((candidate) => {
      if (!candidate.enabled) return false;
      const mounted = definitions.get(
        `${candidate.definitionId}:${candidate.definitionVersion}`,
      );
      return !!(mounted?.simulation || mounted?.feedback);
    }),
  };
}

function readMountedPixels(
  value: unknown,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  if (
    !value ||
    typeof value !== "object" ||
    !("width" in value) ||
    !("height" in value) ||
    !("colorSpace" in value) ||
    !("alpha" in value) ||
    !("rgba" in value) ||
    value.width !== width ||
    value.height !== height ||
    value.colorSpace !== "srgb" ||
    value.alpha !== "straight" ||
    !ArrayBuffer.isView(value.rgba) ||
    Object.prototype.toString.call(value.rgba) !== "[object Uint8Array]" ||
    value.rgba.byteLength !== width * height * 4
  )
    throw new Error("mounted-frame-pixels-unreadable");
  return value.rgba as Uint8Array<ArrayBuffer>;
}

async function renderMountedFrame(
  runtime: MountedFrameRuntime,
  item: ValidationCase,
  stateful: boolean,
  signal: AbortSignal,
): Promise<{
  linearGolden?: NonNullable<NativeShaderValidationCaseResult["linearGolden"]>;
  mountOutput: NonNullable<NativeShaderValidationCaseResult["mountOutput"]>;
  pixelSha256: string;
  pixelWidth: number;
  pixelHeight: number;
  nonTransparentPixels: number;
  partialAlphaPixels: number;
}> {
  const frame = item.mountedFrame;
  const samples = item.expectedLinearSamples;
  if (
    !frame ||
    !runtime.renderCompositionFramePixels ||
    !runtime.renderCompositionFrameValidated
  )
    throw new NativeShaderValidationClientError("runtime-unavailable");
  const frameIndex = Math.round(item.timeSeconds * 60);
  const expectedWidth = Math.ceil(frame.viewport.width * frame.pixelRatio);
  const expectedHeight = Math.ceil(frame.viewport.height * frame.pixelRatio);
  const options = (
    index: number,
    simulationSessionId?: string,
  ): MountedFrameOptions => ({
    frameIndex: index,
    fps: 60,
    startTimeSeconds: 0,
    sourceContract: "declarative-only",
    viewport: frame.viewport,
    pixelRatio: frame.pixelRatio,
    signal,
    timeoutMs: 30_000,
    ...(simulationSessionId ? { simulationSessionId } : {}),
  });
  const renderFinal = async (simulationSessionId?: string): Promise<unknown> =>
    runtime.renderCompositionFrameValidated!(
      options(frameIndex, simulationSessionId),
      {
        instanceId: item.instanceId,
        nodeId: item.nodeId,
        definitionId: item.definitionId,
        definitionVersion: item.definitionVersion,
        executionHash: item.executionHash,
        ...(samples ? { expectedLinearSamples: samples } : {}),
      },
    );
  let held: unknown;
  if (stateful) {
    if (
      !runtime.beginSimulationExportSession ||
      !runtime.endSimulationExportSession
    )
      throw new NativeShaderValidationClientError("runtime-unavailable");
    const { sessionId } = await runtime.beginSimulationExportSession({
      fps: 60,
      totalFrames: frameIndex + 1,
      startTimeSeconds: 0,
      signal,
      timeoutMs: 30_000,
    });
    let primaryError: unknown;
    try {
      for (let index = 0; index < frameIndex; index++) {
        const preceding = await runtime.renderCompositionFramePixels(
          options(index, sessionId),
        );
        readMountedPixels(preceding, expectedWidth, expectedHeight);
      }
      held = await renderFinal(sessionId);
    } catch (error) {
      primaryError = error;
    }
    try {
      await runtime.endSimulationExportSession(sessionId, {
        timeoutMs: 30_000,
      });
    } catch (cleanupError) {
      if (primaryError)
        throw new NativeShaderValidationCleanupError(
          primaryError,
          cleanupError,
        );
      throw cleanupError;
    }
    if (primaryError) throw primaryError;
  } else {
    held = await renderFinal();
  }
  if (signal.aborted)
    throw new NativeShaderValidationClientError("request-aborted");
  const pixels =
    held && typeof held === "object" && "pixels" in held
      ? held.pixels
      : undefined;
  const rgba = readMountedPixels(pixels, expectedWidth, expectedHeight);
  let nonTransparentPixels = 0;
  let partialAlphaPixels = 0;
  for (let index = 3; index < rgba.length; index += 4) {
    const alpha = rgba[index];
    if (alpha > 0) nonTransparentPixels += 1;
    if (alpha > 0 && alpha < 255) partialAlphaPixels += 1;
  }
  const linearGolden = samples
    ? nativeLinearGoldenSummarySchema.parse(
        held && typeof held === "object" && "linearGolden" in held
          ? held.linearGolden
          : undefined,
      )
    : undefined;
  if (samples && linearGolden?.sampleCount !== samples.length)
    throw new Error("mounted-golden-samples-incomplete");
  const mountOutput = nativeMountedOutputSummarySchema.parse(
    held && typeof held === "object" && "mountOutput" in held
      ? held.mountOutput
      : undefined,
  );
  if (
    mountOutput.instanceId !== item.instanceId ||
    mountOutput.nodeId !== item.nodeId ||
    mountOutput.definitionId !== item.definitionId ||
    mountOutput.definitionVersion !== item.definitionVersion ||
    mountOutput.executionHash !== item.executionHash ||
    mountOutput.width > expectedWidth ||
    mountOutput.height > expectedHeight
  )
    throw new Error("mounted-output-identity-mismatch");
  const digest = await crypto.subtle.digest("SHA-256", rgba);
  if (signal.aborted)
    throw new NativeShaderValidationClientError("request-aborted");
  return {
    ...(linearGolden ? { linearGolden } : {}),
    mountOutput,
    pixelSha256: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    pixelWidth: expectedWidth,
    pixelHeight: expectedHeight,
    nonTransparentPixels,
    partialAlphaPixels,
  };
}

export async function validateNativePresentationFaultInEditor(args: {
  designId: string;
  fileId: string;
  ownerTabId: string;
  requestId: string;
  item: ValidationCase;
  grant: NativePresentationFaultGrant;
  expectedVersionHash: string;
  signal: AbortSignal;
}): Promise<NativeShaderValidationCaseResult> {
  const { item, grant, signal } = args;
  if (
    !item.presentationFault ||
    item.presentationFault !== grant.kind ||
    grant.caseId !== item.caseId ||
    grant.instanceId !== item.instanceId ||
    grant.nodeId !== item.nodeId ||
    grant.definitionId !== item.definitionId ||
    grant.definitionVersion !== item.definitionVersion ||
    grant.executionHash !== item.executionHash ||
    grant.designId !== args.designId ||
    grant.fileId !== args.fileId ||
    grant.ownerTabId !== args.ownerTabId ||
    grant.requestId !== args.requestId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      grant.grantId,
    ) ||
    grant.sourceVersionHash !== args.expectedVersionHash ||
    Date.now() < grant.issuedAt ||
    Date.now() >= grant.expiresAt
  )
    throw mountedViewportError("presentation-fault-grant-mismatch");
  const frame = findValidationFrame(args.fileId);
  const document = frame.contentDocument;
  if (
    !document ||
    !frame.isConnected ||
    readNativeViewedSourceLease(frame, document) !== args.expectedVersionHash
  )
    throw mountedViewportError("presentation-fault-viewed-source-stale");
  const verified = await verifyFrameSource(frame, item);
  if (!verified.matches || verified.stateful)
    throw mountedViewportError("presentation-fault-target-stale");
  const before = await statusFor(frame, item, signal);
  if (
    before.backend !== "webgpu" ||
    before.status !== "ready" ||
    before.frames < 1
  )
    throw mountedViewportError("presentation-fault-prior-output-missing");
  const runtime = (
    frame.contentWindow as
      | (Window & {
          __anNativeShaders?: MountedFrameRuntime;
        })
      | null
  )?.__anNativeShaders;
  if (!runtime?.runReviewedPresentationFault)
    throw mountedViewportError("presentation-fault-runtime-unavailable");
  const result = await runtime.runReviewedPresentationFault(grant);
  if (signal.aborted)
    throw new NativeShaderValidationClientError("request-aborted");
  if (
    !frame.isConnected ||
    frame.contentDocument !== document ||
    readNativeViewedSourceLease(frame, document) !== args.expectedVersionHash ||
    !(await verifyFrameSource(frame, item)).matches
  )
    throw mountedViewportError("presentation-fault-viewed-source-stale");
  const after = await statusFor(frame, item, signal);
  const code = "gpu-validation";
  if (
    result.kind !== item.presentationFault ||
    result.grantId !== grant.grantId ||
    result.simulated !== true ||
    result.submitted !== true ||
    result.scopeDrained !== true ||
    result.status !== "last-good" ||
    result.code !== code ||
    after.status !== "last-good" ||
    after.code !== code ||
    result.preparedFrameCount !== 1 ||
    result.beforePreparedFrameCount !== before.frames ||
    result.priorFrameCount !== result.beforePreparedFrameCount + 1 ||
    result.afterFrameCount !== result.priorFrameCount ||
    after.frames !== result.afterFrameCount ||
    after.backend !== "webgpu" ||
    result.pixelSource !== "last-published-gpu-presentation" ||
    !["bgra8unorm", "rgba8unorm"].includes(result.pixelFormat) ||
    result.beforePixelSha256 !== result.afterPixelSha256 ||
    !/^[a-f0-9]{64}$/.test(result.beforePixelSha256) ||
    result.pixelWidth < 1 ||
    result.pixelHeight < 1 ||
    result.pixelWidth * result.pixelHeight > 1_048_576 || // i18n-ignore: numeric comparison, not JSX copy.
    result.nonTransparentPixels < 1 ||
    result.nonTransparentPixels > result.pixelWidth * result.pixelHeight
  )
    throw mountedViewportError("presentation-fault-proof-incomplete");
  return {
    caseId: item.caseId,
    definitionId: item.definitionId,
    definitionVersion: item.definitionVersion,
    executionHash: item.executionHash,
    backend: "webgpu",
    status: "last-good",
    code,
    message: `Reviewed local QA ${item.presentationFault}; last-published GPU presentation pixels were preserved. Browser compositor pixels were not read losslessly.`,
    frames: after.frames,
    sourceCaptures: after.sourceCaptures,
    estimatedResourceBytes: after.estimatedResourceBytes,
    presentationFault: {
      kind: result.kind,
      simulated: true,
      submitted: true,
      scopeDrained: true,
      grantId: grant.grantId,
      beforePreparedFrameCount: result.beforePreparedFrameCount,
      preparedFrameCount: result.preparedFrameCount,
      priorFrameCount: result.priorFrameCount,
      afterFrameCount: result.afterFrameCount,
      pixelSource: result.pixelSource,
      pixelFormat: result.pixelFormat,
      beforePixelSha256: result.beforePixelSha256,
      afterPixelSha256: result.afterPixelSha256,
      pixelWidth: result.pixelWidth,
      pixelHeight: result.pixelHeight,
      nonTransparentPixels: result.nonTransparentPixels,
    },
  };
}

export async function validateNativeShaderCaseInEditor(args: {
  fileId: string;
  item: ValidationCase;
  preparedScene?: Pick<
    ReturnType<typeof readPreparedScene>,
    "html" | "approvedDefinitionHashes"
  >;
  signal: AbortSignal;
}): Promise<NativeShaderValidationCaseResult> {
  const { fileId, item, signal, preparedScene } = args;
  if (signal.aborted)
    throw new NativeShaderValidationClientError("request-aborted");
  let frame: HTMLIFrameElement;
  let stateful = false;
  try {
    frame = findValidationFrame(fileId);
    const source = await verifyFrameSource(frame, item);
    if (!source.matches)
      return unavailable(
        item,
        "frame-source-stale",
        "The mounted shader source does not match this validation case.",
      );
    stateful = source.stateful;
  } catch (error) {
    if (signal.aborted)
      throw new NativeShaderValidationClientError("request-aborted");
    return unavailable(
      item,
      "frame-unavailable",
      error instanceof Error ? error.message : "validation-preview-unreadable",
    );
  }
  let dedicatedFrame: HTMLIFrameElement | undefined;
  try {
    if (item.mountedFrame) {
      try {
        if (!preparedScene)
          throw mountedViewportError("mounted-viewport-source-unavailable");
        const liveStatus = await statusFor(frame, item, signal);
        if (
          liveStatus.status !== "ready" ||
          liveStatus.backend !== "webgpu" ||
          liveStatus.frames < 1
        )
          return unavailable(
            item,
            "mounted-source-unready",
            "The selected native source is not ready for a dedicated validation frame.",
          );
        dedicatedFrame = await mountedValidationViewport(
          frame,
          item.mountedFrame.viewport,
          item,
          preparedScene,
          signal,
        );
        const source = await verifyFrameSource(dedicatedFrame, item);
        if (!source.matches)
          return unavailable(
            item,
            "frame-source-stale",
            "The dedicated shader viewport does not match this validation case.",
          );
        frame = dedicatedFrame;
        stateful = source.stateful;
      } catch (error) {
        if (signal.aborted)
          throw new NativeShaderValidationClientError("request-aborted");
        const detail = validationErrorDetail(error);
        return unavailable(item, detail.code, detail.message);
      }
    }
    if (stateful && !item.mountedFrame)
      return unavailable(
        item,
        "stateful-frame-required",
        "A persistent native effect needs a bounded held frame for validation.",
      );
    const runtime = (
      frame.contentWindow as
        | (Window & {
            __anNativeShaders?: {
              renderAt?: (time: number) => Promise<unknown>;
            } & MountedFrameRuntime;
          })
        | null
    )?.__anNativeShaders;
    if (
      !runtime ||
      (item.mountedFrame
        ? !runtime.renderCompositionFramePixels ||
          !runtime.renderCompositionFrameValidated
        : item.mountedMeasurement
          ? !runtime.measureMountedScene
          : !runtime.renderAt)
    )
      return unavailable(
        item,
        "runtime-unavailable",
        "The selected preview has no native WebGPU runtime.",
      );
    let renderFailed = false;
    let renderCode: string | undefined;
    let renderMessage: string | undefined;
    let cleanupCode: string | undefined;
    let cleanupMessage: string | undefined;
    let mountedFrame:
      | Awaited<ReturnType<typeof renderMountedFrame>>
      | undefined;
    let mountedMeasurement: NativeShaderValidationCaseResult["mountedMeasurement"];
    try {
      if (item.mountedFrame) {
        mountedFrame = await renderMountedFrame(
          runtime,
          item,
          stateful,
          signal,
        );
        if (mountedFrame.linearGolden && !mountedFrame.linearGolden.passed) {
          renderFailed = true;
          renderCode = "linear-golden-failed";
        }
      } else if (item.mountedMeasurement) {
        const raw = await runtime.measureMountedScene!({
          instanceId: item.instanceId,
          executionHash: item.executionHash,
          request: item.mountedMeasurement,
          signal,
        });
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw mountedViewportError("benchmark-result-unreadable");
        const source = await verifyFrameSource(frame, item);
        if (!source.matches) throw mountedViewportError("frame-source-stale");
        const gpuBoundary = raw as {
          gpuTargetInstanceId?: unknown;
          gpuScope?: unknown;
          gpuAfterFrameIndex?: unknown;
          gpuThroughFrameIndex?: unknown;
          gpuWindow?: unknown;
        };
        if (
          gpuBoundary.gpuTargetInstanceId !== item.instanceId ||
          gpuBoundary.gpuScope !==
            "target-mount-command-encoder-not-full-scene" ||
          typeof gpuBoundary.gpuAfterFrameIndex !== "number" ||
          !Number.isSafeInteger(gpuBoundary.gpuAfterFrameIndex) ||
          gpuBoundary.gpuAfterFrameIndex < -1 ||
          typeof gpuBoundary.gpuThroughFrameIndex !== "number" ||
          !Number.isSafeInteger(gpuBoundary.gpuThroughFrameIndex) ||
          gpuBoundary.gpuThroughFrameIndex < gpuBoundary.gpuAfterFrameIndex ||
          !gpuBoundary.gpuWindow ||
          typeof gpuBoundary.gpuWindow !== "object" ||
          Array.isArray(gpuBoundary.gpuWindow)
        )
          throw mountedViewportError("benchmark-result-unreadable");
        const profileAtEnd = readMountedSceneProfile(runtime, {
          instanceId: item.instanceId,
          afterFrameIndex: gpuBoundary.gpuAfterFrameIndex,
          throughFrameIndex: gpuBoundary.gpuThroughFrameIndex,
        });
        if (profileAtEnd.state !== "available")
          throw mountedViewportError("profile-unavailable");
        const measured = nativeShaderMountedMeasurementSchema.safeParse({
          ...raw,
          profileAtEnd,
        });
        if (!measured.success)
          throw mountedViewportError("benchmark-result-unreadable");
        mountedMeasurement = measured.data;
      } else {
        const result = await runtime.renderAt!(item.timeSeconds);
        if (
          !result ||
          typeof result !== "object" ||
          !Number.isInteger((result as { rendered?: unknown }).rendered) ||
          (result as { rendered: number }).rendered <= 0 ||
          !Array.isArray((result as { failures?: unknown }).failures) ||
          (result as { failures: unknown[] }).failures.length > 0
        )
          renderFailed = true;
      }
    } catch (error) {
      renderFailed = true;
      if (item.mountedFrame || item.mountedMeasurement) {
        const primary = validationErrorDetail(
          error instanceof NativeShaderValidationCleanupError
            ? error.renderError
            : error,
        );
        renderCode = primary.code;
        renderMessage = primary.message;
        if (error instanceof NativeShaderValidationCleanupError) {
          const cleanup = validationErrorDetail(error.cleanupError);
          cleanupCode = cleanup.code;
          cleanupMessage = cleanup.message;
        }
      }
    }
    if (signal.aborted)
      throw new NativeShaderValidationClientError("request-aborted");
    let status: NativeShaderRuntimeStatus;
    try {
      status = await statusFor(frame, item, signal);
    } catch (error) {
      if (signal.aborted)
        throw new NativeShaderValidationClientError("request-aborted");
      return unavailable(
        item,
        "status-unreadable",
        error instanceof Error ? error.message : "validation-result-unreadable",
      );
    }
    const ready =
      !renderFailed &&
      status.status === "ready" &&
      status.backend === "webgpu" &&
      status.frames > 0;
    return {
      caseId: item.caseId,
      definitionId: item.definitionId,
      definitionVersion: item.definitionVersion,
      executionHash: item.executionHash,
      backend: status.backend,
      status: ready
        ? "ready"
        : status.status === "ready"
          ? "error"
          : status.status,
      ...(!ready
        ? {
            code: renderCode ?? status.code ?? "render-failed",
            message:
              renderMessage ??
              status.message ??
              "Strict WebGPU render did not complete.",
            ...(cleanupCode ? { cleanupCode, cleanupMessage } : {}),
          }
        : {}),
      ...(status.renderWallMs !== undefined
        ? { renderWallMs: status.renderWallMs }
        : {}),
      sourceCaptures: status.sourceCaptures,
      frames: status.frames,
      estimatedResourceBytes: status.estimatedResourceBytes,
      sceneProfile:
        mountedMeasurement?.profileAtEnd ??
        readMountedSceneProfile(runtime, { instanceId: item.instanceId }),
      ...(mountedFrame ?? {}),
      ...(mountedMeasurement ? { mountedMeasurement } : {}),
    };
  } finally {
    if (dedicatedFrame) {
      try {
        (
          dedicatedFrame.contentWindow as
            | (Window & { __anNativeShaders?: MountedFrameRuntime })
            | null
        )?.__anNativeShaders?.dispose?.();
      } finally {
        dedicatedFrame.remove();
      }
    }
  }
}
