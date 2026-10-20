import {
  NativeEffectApprovalStateError,
  parseNativeEffectApprovalState,
} from "../../../../shared/native-effect-trust";
import {
  NATIVE_EMBEDDED_ASSETS_ATTR,
  NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE,
  NativeEmbeddedAssetRegistryError,
  parseNativeEmbeddedAssetRegistryText,
} from "../../../../shared/native-embedded-assets";

export type NativeCompositionClockCode =
  | "composition-aborted"
  | "composition-timeout"
  | "composition-invalid-frame"
  | "composition-source-contract"
  | "composition-busy"
  | "composition-scripted-source"
  | "composition-canvas-source"
  | "composition-animation-unavailable"
  | "composition-animation-unseekable"
  | "composition-media-cross-origin"
  | "composition-media-unseekable"
  | "composition-media-undecoded"
  | "composition-fonts-unavailable"
  | "composition-fonts-pending"
  | "composition-render-unsettled"
  | "composition-restore-failed";

export class NativeCompositionClockError extends Error {
  constructor(
    readonly code: NativeCompositionClockCode,
    message: string,
    readonly causes: readonly unknown[] = [],
  ) {
    super(message);
    this.name = "NativeCompositionClockError";
  }
}

export interface NativeCompositionFrameOptions {
  document: Document;
  authoredRoot: Element;
  runtimeOwnedNodes?: ReadonlySet<Node>;
  startTimeSeconds?: number;
  frameIndex: number;
  fps: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  quiesceTimeoutMs?: number;
  // A trusted caller must supply a stable authored subtree: no out-of-root
  // script, late animation/font insertion, animated image, or JS pixel mutation.
  sourceContract: "declarative-only";
  onSourceClockChange?: () => void;
}

export interface NativeCompositionFrame {
  frameIndex: number;
  fps: number;
  startTimeSeconds: number;
  timeSeconds: number;
  signal: AbortSignal;
}

interface AnimationSnapshot {
  animation: Animation;
  time: number | null;
  state: AnimationPlayState;
  rate: number;
}

interface VideoSnapshot {
  video: HTMLVideoElement;
  time: number;
  paused: boolean;
  rate: number;
}

const MAX_SOURCE_ELEMENTS = 10_000;
const MAX_SOURCE_VIDEOS = 16;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_QUIESCE_TIMEOUT_MS = 1_000;
const MAX_TIME_SECONDS = 3_600;
const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;
const activeDocuments = new WeakSet<Document>();
const failedDocuments = new WeakMap<Document, NativeCompositionClockError>();

function failure(
  code: NativeCompositionClockCode,
  message: string,
  causes: readonly unknown[] = [],
): NativeCompositionClockError {
  return new NativeCompositionClockError(code, message, causes);
}

function inertRecordFailure(
  message: string,
  boundary:
    | "embedded-attributes"
    | "embedded-registry"
    | "approval-record"
    | "font-license-record",
  cause: unknown,
): NativeCompositionClockError {
  let category: string;
  if (cause instanceof NativeEmbeddedAssetRegistryError) {
    switch (cause.code) {
      case "registry-malformed":
      case "registry-limit":
      case "registry-duplicate":
      case "registry-path":
      case "registry-mime":
        category = cause.code;
        break;
      default:
        category = "unknown-registry-error";
    }
  } else if (cause instanceof NativeEffectApprovalStateError)
    category = "approval-schema";
  else if (cause instanceof SyntaxError) category = "invalid-json";
  else if (cause instanceof ReferenceError) category = "reference-error";
  else if (cause instanceof RangeError) category = "range-error";
  else if (cause instanceof TypeError) category = "type-error";
  else if (cause instanceof Error) category = "unexpected-error";
  else category = "unknown-error";
  // Exception messages can contain the authored JSON or private asset paths.
  return failure(
    "composition-source-contract",
    `${message} (${boundary}:${category})`,
    [cause],
  );
}

function runtimeOwned(node: Node, owned: ReadonlySet<Node>): boolean {
  for (let current: Node | null = node; current; current = current.parentNode)
    if (owned.has(current)) return true;
  return false;
}

function sourceElements(root: Element, owned: ReadonlySet<Node>): Element[] {
  const elements = [root, ...root.querySelectorAll("*")];
  if (elements.length > MAX_SOURCE_ELEMENTS)
    throw failure(
      "composition-source-contract",
      "The authored source exceeds the bounded composition scan.",
    );
  return elements.filter((element) => !runtimeOwned(element, owned));
}

function assertDeclarativeSource(
  root: Element,
  owned: ReadonlySet<Node>,
): void {
  for (const element of sourceElements(root, owned)) {
    if (element instanceof HTMLCanvasElement)
      throw failure(
        "composition-canvas-source",
        "An authored canvas needs an explicit deterministic source contract.",
      );
    if (
      [...element.attributes].some((attribute) => /^on/i.test(attribute.name))
    )
      throw failure(
        "composition-scripted-source",
        "An authored event handler can change pixels outside the composition clock.",
      );
    if (element instanceof HTMLScriptElement) {
      if (element.type === "application/x-agent-native-effects") continue;
      if (
        element.type === NATIVE_EMBEDDED_ASSETS_SCRIPT_TYPE &&
        element.hasAttribute(NATIVE_EMBEDDED_ASSETS_ATTR)
      ) {
        let boundary: "embedded-attributes" | "embedded-registry" =
          "embedded-attributes";
        try {
          const attributes = [...element.attributes]
            .map((attribute) => attribute.name)
            .sort();
          if (attributes.join(",") !== `${NATIVE_EMBEDDED_ASSETS_ATTR},type`)
            throw new TypeError("Invalid embedded asset script attributes");
          boundary = "embedded-registry";
          parseNativeEmbeddedAssetRegistryText(element.textContent ?? "");
        } catch (error) {
          throw inertRecordFailure(
            "The inert embedded asset registry is unreadable.",
            boundary,
            error,
          );
        }
        continue;
      }
      if (element.type === "application/x-agent-native-effect-approvals") {
        try {
          const value: unknown = JSON.parse(element.textContent ?? "");
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            Object.keys(value).length !== 2 ||
            !("schemaVersion" in value) ||
            !("hashes" in value)
          )
            throw new TypeError("Invalid approval script shape");
          parseNativeEffectApprovalState(value as Record<string, unknown>);
        } catch (error) {
          throw inertRecordFailure(
            "The inert native effect approval record is unreadable.",
            "approval-record",
            error,
          );
        }
        continue;
      }
      if (
        element.type === "text/plain" &&
        element.hasAttribute("data-agent-native-export-font-licenses")
      ) {
        try {
          const attributes = [...element.attributes]
            .map((attribute) => attribute.name)
            .sort();
          if (
            attributes.join(",") !==
              "data-agent-native-export-font-licenses,type" ||
            (element.textContent?.length ?? 0) > 128_000
          )
            throw new TypeError("Invalid font license script shape");
          const licenses: unknown = JSON.parse(element.textContent ?? "");
          if (!Array.isArray(licenses) || licenses.length > 64)
            throw new TypeError("Invalid font license list");
          let totalLicenseBytes = 0;
          for (const license of licenses) {
            if (
              !license ||
              typeof license !== "object" ||
              Array.isArray(license) ||
              Object.keys(license).sort().join(",") !== "path,text" ||
              typeof license.path !== "string" ||
              !license.path.startsWith("/") ||
              license.path.length > 1024 ||
              typeof license.text !== "string"
            )
              throw new TypeError("Invalid font license record");
            const bytes = new TextEncoder().encode(license.text).byteLength;
            if (bytes > 32_000)
              throw new TypeError("Font license is too large");
            totalLicenseBytes += bytes;
          }
          if (totalLicenseBytes > 64_000)
            throw new TypeError("Font licenses are too large");
        } catch (error) {
          throw inertRecordFailure(
            "The inert export font-license record is unreadable.",
            "font-license-record",
            error,
          );
        }
        continue;
      }
      throw failure(
        "composition-scripted-source",
        "An authored script can change pixels outside the composition clock.",
      );
    }
  }
}

function frameTime(
  frameIndex: number,
  fps: number,
  startTimeSeconds: number,
): number {
  if (
    !Number.isSafeInteger(frameIndex) ||
    frameIndex < 0 ||
    !Number.isSafeInteger(fps) ||
    fps < 1 ||
    fps > 240 ||
    !Number.isFinite(startTimeSeconds) ||
    startTimeSeconds < 0 ||
    startTimeSeconds + frameIndex / fps > MAX_TIME_SECONDS
  )
    throw failure(
      "composition-invalid-frame",
      "Frame index or rate is outside the bounded composition clock.",
    );
  return startTimeSeconds + frameIndex / fps;
}

function createDeadline(external: AbortSignal | undefined, timeoutMs: number) {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  )
    throw failure(
      "composition-invalid-frame",
      "Composition timeout must be finite and bounded.",
    );
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      failure("composition-aborted", "Composition was cancelled."),
    );
  if (external?.aborted) abort();
  else external?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        failure("composition-timeout", "Composition source sync timed out."),
      ),
    timeoutMs,
  );
  const check = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  const awaitBounded = <T>(pending: PromiseLike<T>): Promise<T> => {
    check();
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(pending)
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", onAbort));
    });
  };
  return {
    signal: controller.signal,
    check,
    awaitBounded,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    },
  };
}

function animationTarget(animation: Animation): Element | null {
  const target = (animation.effect as KeyframeEffect | null)?.target;
  return target instanceof Element ? target : null;
}

function relevantAnimations(
  doc: Document,
  root: Element,
  owned: ReadonlySet<Node>,
): Animation[] {
  if (typeof doc.getAnimations !== "function")
    throw failure(
      "composition-animation-unavailable",
      "This document cannot enumerate authored animations.",
    );
  return doc.getAnimations().filter((animation) => {
    const target = animationTarget(animation);
    if (!target)
      throw failure(
        "composition-animation-unseekable",
        "An animation has no readable authored target.",
      );
    return (
      !runtimeOwned(target, owned) &&
      (root.contains(target) || target.contains(root)) &&
      animation.playState !== "idle"
    );
  });
}

function animationSeekTime(
  animation: Animation,
  timeSeconds: number,
  oldTime: number | null,
): number {
  if (
    "transitionProperty" in animation ||
    animation.timeline !== animationTarget(animation)?.ownerDocument.timeline
  )
    throw failure(
      "composition-animation-unseekable",
      "A source transition or non-document timeline has no stable local frame zero.",
    );
  const rate = animation.playbackRate;
  if (!Number.isFinite(rate) || typeof oldTime !== "number")
    throw failure(
      "composition-animation-unseekable",
      "An authored animation has no finite playback position.",
    );
  if (animation.playState === "paused" || rate === 0) return oldTime;
  const end = animation.effect?.getComputedTiming().endTime;
  const origin = rate < 0 ? end : 0;
  if (typeof origin !== "number" || !Number.isFinite(origin))
    throw failure(
      "composition-animation-unseekable",
      "A reverse animation needs a finite effect end time.",
    );
  // Effect timing itself applies CSS delay, direction, and iteration count.
  return origin + timeSeconds * 1000 * rate;
}

function videoSeekTime(video: HTMLVideoElement, timeSeconds: number): number {
  const rate = video.playbackRate;
  if (!Number.isFinite(rate) || rate === 0)
    throw failure(
      "composition-media-unseekable",
      "Video playback rate must be finite and nonzero.",
    );
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0)
    throw failure(
      "composition-media-unseekable",
      "Live or unknown-duration video cannot be placed on a finite clock.",
    );
  const position =
    rate < 0 ? duration + timeSeconds * rate : timeSeconds * rate;
  if (video.loop) return ((position % duration) + duration) % duration;
  return Math.max(0, Math.min(duration, position));
}

function assertLocalVideo(video: HTMLVideoElement, doc: Document): void {
  if (video.srcObject)
    throw failure(
      "composition-media-unseekable",
      "A live media stream has no deterministic seek position.",
    );
  const source = video.currentSrc || video.src;
  if (!source)
    throw failure(
      "composition-media-unseekable",
      "A video has no resolved source.",
    );
  let url: URL;
  try {
    url = new URL(source, doc.baseURI);
  } catch {
    throw failure(
      "composition-media-unseekable",
      "A video source URL is unreadable.",
    );
  }
  if (
    (url.protocol !== "http:" &&
      url.protocol !== "https:" &&
      url.protocol !== "blob:") ||
    url.origin !== doc.location.origin
  )
    throw failure(
      "composition-media-cross-origin",
      "A cross-origin or tainted video source cannot be synchronized.",
    );
}

function waitForMediaEvent(
  video: HTMLVideoElement,
  success: string,
  awaitBounded: <T>(pending: PromiseLike<T>) => Promise<T>,
  signal: AbortSignal,
  trigger?: () => void,
): Promise<void> {
  return awaitBounded(
    new Promise<void>((resolve, reject) => {
      const done = () => {
        video.removeEventListener(success, onSuccess);
        video.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
      };
      const onSuccess = () => {
        done();
        resolve();
      };
      const onError = () => {
        done();
        reject(
          failure(
            "composition-media-undecoded",
            "A video source failed to decode.",
          ),
        );
      };
      const onAbort = () => {
        done();
        reject(signal.reason);
      };
      video.addEventListener(success, onSuccess, { once: true });
      video.addEventListener("error", onError, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        trigger?.();
      } catch (error) {
        done();
        reject(error);
      }
    }),
  );
}

async function seekVideo(
  video: HTMLVideoElement,
  timeSeconds: number,
  authoredPaused: boolean,
  doc: Document,
  awaitBounded: <T>(pending: PromiseLike<T>) => Promise<T>,
  signal: AbortSignal,
): Promise<void> {
  assertLocalVideo(video, doc);
  if (video.readyState < HAVE_METADATA)
    await waitForMediaEvent(video, "loadedmetadata", awaitBounded, signal);
  const desired = authoredPaused
    ? video.currentTime
    : videoSeekTime(video, timeSeconds);
  if (video.seekable.length === 0)
    throw failure(
      "composition-media-unseekable",
      "The video has no seekable range.",
    );
  if (
    !Array.from({ length: video.seekable.length }, (_, index) => index).some(
      (index) =>
        desired >= video.seekable.start(index) &&
        desired <= video.seekable.end(index),
    )
  )
    throw failure(
      "composition-media-unseekable",
      "The requested video frame is outside the seekable ranges.",
    );
  if (Math.abs(video.currentTime - desired) > 0.000_001 || video.seeking) {
    await waitForMediaEvent(video, "seeked", awaitBounded, signal, () => {
      video.currentTime = desired;
    });
  }
  if (
    video.seeking ||
    video.readyState < HAVE_CURRENT_DATA ||
    Math.abs(video.currentTime - desired) > 0.001
  )
    throw failure(
      "composition-media-undecoded",
      "The video did not decode the requested frame.",
    );
}

async function restoreAnimations(
  snapshots: AnimationSnapshot[],
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const { animation, time, state, rate } of snapshots.reverse()) {
    try {
      animation.pause();
      animation.playbackRate = rate;
      animation.currentTime = time;
      if (state === "running") animation.play();
      else if (state === "finished") animation.finish();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function restoreVideos(snapshots: VideoSnapshot[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const { video, time, paused, rate } of snapshots.reverse()) {
    const deadline = createDeadline(undefined, 2_000);
    try {
      video.pause();
      video.playbackRate = rate;
      if (Math.abs(video.currentTime - time) > 0.000_001 || video.seeking)
        await waitForMediaEvent(
          video,
          "seeked",
          deadline.awaitBounded,
          deadline.signal,
          () => {
            video.currentTime = time;
          },
        );
      if (
        video.seeking ||
        video.readyState < HAVE_CURRENT_DATA ||
        Math.abs(video.currentTime - time) > 0.001
      )
        throw failure(
          "composition-restore-failed",
          "The previous video frame was not decoded during restoration.",
        );
    } catch (error) {
      errors.push(error);
    }
    if (!paused)
      try {
        await deadline.awaitBounded(video.play());
      } catch (error) {
        errors.push(error);
      }
    deadline.dispose();
  }
  return errors;
}

function quiesceRender(
  pending: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    pending.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

/**
 * Synchronizes declarative source pixels before one native render. It does not
 * capture, transport, or export pixels. The caller owns the authored subtree
 * guarantee and render must settle cooperatively when its signal aborts.
 */
export async function withNativeCompositionFrame<T>(
  options: NativeCompositionFrameOptions,
  render: (frame: NativeCompositionFrame) => Promise<T> | T,
): Promise<{
  frameIndex: number;
  fps: number;
  startTimeSeconds: number;
  timeSeconds: number;
  value: T;
}> {
  const { document: doc, authoredRoot: root, frameIndex, fps } = options;
  const startTimeSeconds = options.startTimeSeconds ?? 0;
  const timeSeconds = frameTime(frameIndex, fps, startTimeSeconds);
  const owned = options.runtimeOwnedNodes ?? new Set<Node>();
  if (
    options.sourceContract !== "declarative-only" ||
    !root.isConnected ||
    root.ownerDocument !== doc ||
    runtimeOwned(root, owned)
  )
    throw failure(
      "composition-source-contract",
      "A connected authored source owned by this document is required.",
    );
  const previousFailure = failedDocuments.get(doc);
  if (previousFailure) throw previousFailure;
  if (activeDocuments.has(doc))
    throw failure(
      "composition-busy",
      "Another frame still owns this document's source clock.",
    );
  const deadline = createDeadline(
    options.signal,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const quiesceTimeoutMs =
    options.quiesceTimeoutMs ?? DEFAULT_QUIESCE_TIMEOUT_MS;
  if (
    !Number.isFinite(quiesceTimeoutMs) ||
    quiesceTimeoutMs < 1 ||
    quiesceTimeoutMs > MAX_TIMEOUT_MS
  ) {
    deadline.dispose();
    throw failure(
      "composition-invalid-frame",
      "Render quiescence timeout must be finite and bounded.",
    );
  }
  activeDocuments.add(doc);
  const animations: AnimationSnapshot[] = [];
  const videos: VideoSnapshot[] = [];
  let failed = false;
  let primaryError: unknown;
  let value!: T;
  let renderPromise: Promise<T> | null = null;
  let renderSettled = true;
  let sourceClockTouched = false;
  const noteSourceClockMutation = (): void => {
    if (sourceClockTouched) return;
    sourceClockTouched = true;
    options.onSourceClockChange?.();
  };
  const restore = async (): Promise<unknown[]> => {
    const errors = [
      ...(await restoreVideos(videos)),
      ...(await restoreAnimations(animations)),
    ];
    if (sourceClockTouched)
      try {
        options.onSourceClockChange?.();
      } catch (error) {
        errors.push(error);
      }
    return errors;
  };
  try {
    deadline.check();
    assertDeclarativeSource(root, owned);
    for (const animation of relevantAnimations(doc, root, owned)) {
      deadline.check();
      const oldTime = animation.currentTime;
      if (typeof oldTime !== "number")
        throw failure(
          "composition-animation-unseekable",
          "An authored animation has no numeric local time.",
        );
      const seekTime = animationSeekTime(animation, timeSeconds, oldTime);
      animations.push({
        animation,
        time: oldTime,
        state: animation.playState,
        rate: animation.playbackRate,
      });
      noteSourceClockMutation();
      animation.pause();
      animation.currentTime = seekTime;
      await deadline.awaitBounded(animation.ready);
    }
    const sourceVideos = [
      ...(root instanceof HTMLVideoElement ? [root] : []),
      ...root.querySelectorAll("video"),
    ];
    if (sourceVideos.length > MAX_SOURCE_VIDEOS)
      throw failure(
        "composition-media-unseekable",
        "The source has more videos than the bounded composition clock supports.",
      );
    for (const video of sourceVideos) {
      if (runtimeOwned(video, owned)) continue;
      deadline.check();
      if (video.seeking)
        throw failure(
          "composition-media-unseekable",
          "A video is already seeking outside the composition clock.",
        );
      const snapshot = {
        video,
        time: video.currentTime,
        paused: video.paused,
        rate: video.playbackRate,
      };
      videos.push(snapshot);
      noteSourceClockMutation();
      video.pause();
      await seekVideo(
        video,
        timeSeconds,
        snapshot.paused,
        doc,
        deadline.awaitBounded,
        deadline.signal,
      );
    }
    if (!doc.fonts)
      throw failure(
        "composition-fonts-unavailable",
        "The document cannot report font readiness.",
      );
    await deadline.awaitBounded(doc.fonts.ready);
    if (doc.fonts.status !== "loaded")
      throw failure(
        "composition-fonts-pending",
        "The document's authored fonts are not ready.",
      );
    root.getBoundingClientRect();
    deadline.check();
    renderSettled = false;
    renderPromise = Promise.resolve().then(() =>
      render({
        frameIndex,
        fps,
        startTimeSeconds,
        timeSeconds,
        signal: deadline.signal,
      }),
    );
    void renderPromise.then(
      () => {
        renderSettled = true;
      },
      () => {
        renderSettled = true;
      },
    );
    value = await deadline.awaitBounded(renderPromise);
  } catch (error) {
    failed = true;
    primaryError = error;
  } finally {
    deadline.dispose();
    if (renderPromise && !renderSettled) {
      const settled = await quiesceRender(renderPromise, quiesceTimeoutMs);
      if (!settled && !renderSettled) {
        // A late render may still touch source pixels. Hold the document lock
        // and restore only after its promise settles; never race a new frame.
        void renderPromise
          .then(
            () => restore(),
            () => restore(),
          )
          .then((errors) => {
            if (errors.length)
              failedDocuments.set(
                doc,
                failure(
                  "composition-restore-failed",
                  "Deferred source restoration failed.",
                  errors,
                ),
              );
            activeDocuments.delete(doc);
          })
          .catch((error) => {
            failedDocuments.set(
              doc,
              failure(
                "composition-restore-failed",
                "Deferred source restoration threw unexpectedly.",
                [error],
              ),
            );
            activeDocuments.delete(doc);
          });
        throw failure(
          "composition-render-unsettled",
          "The render did not stop after cancellation; source ownership remains locked until it settles.",
          [primaryError],
        );
      }
    }
    const restorationErrors = await restore();
    activeDocuments.delete(doc);
    if (restorationErrors.length) {
      const restoreError = failure(
        "composition-restore-failed",
        "One or more authored sources could not be restored.",
        failed ? [primaryError, ...restorationErrors] : restorationErrors,
      );
      failedDocuments.set(doc, restoreError);
      throw restoreError;
    }
  }
  if (failed) throw primaryError;
  return { frameIndex, fps, startTimeSeconds, timeSeconds, value };
}
