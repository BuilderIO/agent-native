import { hashEffectDefinition } from "@shared/native-effect-trust";
import {
  validateEffectDocument,
  type EffectDocument,
} from "@shared/native-effects";

import { nativeShaderRuntimeBridgeScript } from "../../../.generated/bridge/native-shader-runtime.generated";
import {
  cropNativeThumbnailRgba,
  NATIVE_THUMBNAIL_HEIGHT,
  NATIVE_THUMBNAIL_WIDTH,
  NativeThumbnailError,
  nativeValidationFixtureBox,
  nativeValidationFrameIndex,
  prepareNativeThumbnailBatch,
  type NativeThumbnailItem,
  type NativeThumbnailResult,
  type NativeValidationFixture,
  type NativeValidationItem,
  type NativeValidationResult,
  type PreparedNativeThumbnail,
} from "./native-thumbnail-plan";

type NativeThumbnailPixels = {
  width: number;
  height: number;
  colorSpace: "srgb";
  alpha: "straight";
  rgba: Uint8Array;
};

type NativeThumbnailRuntime = {
  scan(): Promise<void>;
  beginSimulationExportSession(options: {
    fps: number;
    totalFrames: number;
    startTimeSeconds: 0;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<{ sessionId: string }>;
  renderCompositionFramePixels(options: {
    frameIndex: number;
    fps: 60;
    sourceContract: "declarative-only";
    viewport: { width: number; height: number };
    pixelRatio: 1;
    simulationSessionId?: string;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<NativeThumbnailPixels>;
  renderCompositionFrameGolden(
    options: {
      frameIndex: number;
      fps: 60;
      sourceContract: "declarative-only";
      viewport: { width: number; height: number };
      pixelRatio: 1;
      simulationSessionId?: string;
      signal: AbortSignal;
      timeoutMs: number;
    },
    target: {
      instanceId: string;
      nodeId: string;
      expectedLinearSamples: NonNullable<
        NativeValidationItem["expectedLinearSamples"]
      >;
    },
  ): Promise<{
    pixels: NativeThumbnailPixels;
    linearGolden: NonNullable<
      Extract<NativeValidationResult, { status: "ready" }>["linearGolden"]
    >;
  }>;
  endSimulationExportSession(
    sessionId: string,
    options: { timeoutMs: number },
  ): Promise<void>;
  requestStatusSnapshot(): void;
  dispose(): void;
};

type NativeThumbnailFrameWindow = Window & {
  __anNativeShaders?: NativeThumbnailRuntime;
};

type JobBase = {
  controller: AbortController;
  reject: (error: unknown) => void;
  removeAbort: () => void;
};

type ThumbnailJob = JobBase & {
  kind: "thumbnail";
  options: {
    items: readonly NativeThumbnailItem[];
    approvedExecutionHashes: readonly string[];
    signal?: AbortSignal;
  };
  resolve: (results: NativeThumbnailResult[]) => void;
};

type ValidationJob = JobBase & {
  kind: "validation";
  options: {
    items: readonly NativeValidationItem[];
    approvedExecutionHashes: readonly string[];
    signal?: AbortSignal;
  };
  resolve: (results: NativeValidationResult[]) => void;
};

type Job = ThumbnailJob | ValidationJob;

class NativeThumbnailCleanupError extends NativeThumbnailError {
  constructor(readonly causes: readonly unknown[]) {
    super(
      "thumbnail-cleanup-failed",
      causes
        .map((cause) => {
          const code =
            typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            typeof cause.code === "string"
              ? `${cause.code}: `
              : "";
          const message =
            typeof cause === "object" &&
            cause !== null &&
            "message" in cause &&
            typeof cause.message === "string"
              ? cause.message
              : typeof cause === "string"
                ? cause
                : "unreadable-failure";
          return `${code}${message}`.slice(0, 140);
        })
        .join("; "),
    );
  }
}

const SHEET_WIDTH = NATIVE_THUMBNAIL_WIDTH * 2;
const SHEET_HEIGHT = NATIVE_THUMBNAIL_HEIGHT * 2;
const MAX_CACHE_ENTRIES = 64;
const FRAME_TIMEOUT_MS = 10_000;
const RENDER_TIMEOUT_MS = 15_000;
const THUMBNAIL_DEADLINE_MS = 45_000;
const VALIDATION_DEADLINE_MS = 40_000;
const NEUTRAL_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100">` +
  `<rect width="160" height="100" fill="lightgray"/>` +
  `<rect x="10" y="11" width="81" height="78" rx="12" fill="steelblue"/>` +
  `<circle cx="120" cy="38" r="29" fill="coral"/>` +
  `<path d="M0 82L160 18" stroke="white" stroke-width="8"/>` +
  `</svg>`;
const NEUTRAL_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(NEUTRAL_SVG)}`;

function aborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw (
      signal.reason ??
      new NativeThumbnailError(
        "thumbnail-aborted",
        "Thumbnail work was canceled.",
      )
    );
}

function nextTurn(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function deadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  code: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new NativeThumbnailError(code, "Thumbnail work timed out."));
    }, timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error) => {
        finish();
        reject(error);
      },
    );
  });
}

function thumbnailDocument(): string {
  const script = nativeShaderRuntimeBridgeScript.replace(
    /<\/script/gi,
    "<\\/script",
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${SHEET_WIDTH}px;height:${SHEET_HEIGHT}px;overflow:hidden;background:transparent}</style></head><body><script data-agent-native-native-shader-runtime>${script}</script></body></html>`;
}

function thumbnailRuntime(frame: HTMLIFrameElement): NativeThumbnailRuntime {
  const runtime = (frame.contentWindow as NativeThumbnailFrameWindow | null)
    ?.__anNativeShaders;
  if (!runtime)
    throw new NativeThumbnailError(
      "thumbnail-runtime-unavailable",
      "The shared WebGPU thumbnail runtime did not start.",
    );
  return runtime;
}

function createSourceImage(document: Document): HTMLImageElement {
  const image = document.createElement("img");
  image.src = NEUTRAL_IMAGE;
  image.alt = "";
  image.style.cssText =
    "display:block;width:160px;height:100px;object-fit:cover;";
  return image;
}

function validationSourceImage(
  document: Document,
  fixture: NativeValidationFixture,
): HTMLImageElement {
  const image = createSourceImage(document);
  if (fixture.alpha !== "opaque")
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      NEUTRAL_SVG.replace('fill="lightgray"', 'fill="none"')
        .replace(
          'fill="steelblue"',
          `fill="steelblue" fill-opacity="${fixture.alpha === "zero" ? 0 : 0.6}"`,
        )
        .replace(
          'fill="coral"',
          `fill="coral" fill-opacity="${fixture.alpha === "zero" ? 0 : 0.6}"`,
        )
        .replace(
          'stroke="white"',
          `stroke="white" stroke-opacity="${fixture.alpha === "zero" ? 0 : 1}"`,
        ),
    )}`;
  return image;
}

function validationTextColor(fixture: NativeValidationFixture): string {
  const alpha =
    fixture.alpha === "zero" ? 0 : fixture.alpha === "transparent" ? 0.6 : 1;
  // guard:allow-raw-color — pinned GPU source fixture paint must remain independent of editor theme tokens.
  return `rgba(35,69,107,${alpha})`;
}

function appendThumbnailScene(
  document: Document,
  prepared: readonly PreparedNativeThumbnail[],
  fixture?: NativeValidationFixture,
): {
  root: HTMLDivElement;
  manifest: HTMLScriptElement;
  targets: HTMLElement[];
  images: HTMLImageElement[];
  intrinsicImages: {
    entry: PreparedNativeThumbnail;
    image: HTMLImageElement;
  }[];
  inputUrls: string[];
  effectDocument: EffectDocument;
} {
  const root = document.createElement("div");
  root.style.cssText = `position:relative;width:${SHEET_WIDTH}px;height:${SHEET_HEIGHT}px;overflow:hidden;`;
  const targets: HTMLElement[] = [];
  const images: HTMLImageElement[] = [];
  const intrinsicImages: {
    entry: PreparedNativeThumbnail;
    image: HTMLImageElement;
  }[] = [];
  for (const [slot, entry] of prepared.entries()) {
    const card = document.createElement("div");
    card.style.cssText =
      `position:absolute;left:${(slot % 2) * NATIVE_THUMBNAIL_WIDTH}px;` +
      `top:${Math.floor(slot / 2) * NATIVE_THUMBNAIL_HEIGHT}px;` +
      `width:${NATIVE_THUMBNAIL_WIDTH}px;height:${NATIVE_THUMBNAIL_HEIGHT}px;overflow:hidden;`;
    const box = fixture ? nativeValidationFixtureBox(fixture) : null;
    let target: HTMLElement;
    if (entry.instance.placement === "layer") {
      if (fixture?.sourceKind === "editable-text") {
        const text = document.createElement("div");
        text.textContent = "Native\nType";
        text.contentEditable = "true";
        text.style.cssText =
          `white-space:pre-line;font:700 22px/1.15 sans-serif;` +
          `color:${validationTextColor(fixture)};`;
        target = text;
        card.append(text);
      } else {
        const image = fixture
          ? validationSourceImage(document, fixture)
          : createSourceImage(document);
        target = image;
        images.push(image);
        if (entry.instance.sourceSizing?.inputSpace === "intrinsic-image") {
          image.style.objectFit = "fill";
          intrinsicImages.push({ entry, image });
        }
        card.append(image);
      }
    } else {
      if (entry.instance.placement === "backdrop") {
        if (fixture?.sourceKind === "editable-text") {
          const text = document.createElement("div");
          text.textContent = "Native\nType";
          text.style.cssText =
            `white-space:pre-line;font:700 22px/1.15 sans-serif;` +
            `color:${validationTextColor(fixture)};`;
          card.append(text);
        } else {
          const image = fixture
            ? validationSourceImage(document, fixture)
            : createSourceImage(document);
          images.push(image);
          card.append(image);
        }
      }
      target = document.createElement("div");
      target.style.cssText =
        "position:absolute;inset:0;width:160px;height:100px;overflow:hidden;";
      if (fixture?.sourceKind === "editable-text") {
        target.textContent = "Native\nType";
        target.contentEditable = "true";
        target.style.cssText +=
          `white-space:pre-line;font:700 22px/1.15 sans-serif;` +
          `color:${validationTextColor(fixture)};`;
        if (entry.instance.placement === "fill") entry.instance.clip = "text";
      }
      card.append(target);
    }
    if (box) {
      target.style.position = "absolute";
      target.style.left = `${box.left}px`;
      target.style.top = `${box.top}px`;
      target.style.width = `${box.width}px`;
      target.style.height = `${box.height}px`;
      if (fixture?.rounded) {
        target.style.borderRadius = "12px";
        target.style.overflow = "clip";
      }
      if (fixture?.alpha === "zero" && entry.instance.placement === "fill")
        target.style.opacity = "0";
    }
    target.setAttribute("data-agent-native-node-id", entry.instance.nodeId);
    targets.push(target);
    root.append(card);
  }
  const definitions = new Map<string, PreparedNativeThumbnail>();
  for (const entry of prepared)
    definitions.set(
      `${entry.item.definition.id}:${entry.item.definition.version}`,
      entry,
    );
  const manifest = document.createElement("script");
  manifest.type = "application/x-agent-native-effects";
  const effectDocument: EffectDocument = {
    schemaVersion: 2,
    definitions: [...definitions.values()].map(
      (entry) => entry.item.definition,
    ),
    instances: prepared.map((entry) => entry.instance),
  };
  manifest.textContent = JSON.stringify(effectDocument);
  return {
    root,
    manifest,
    targets,
    images,
    intrinsicImages,
    inputUrls: [],
    effectDocument,
  };
}

type ThumbnailScene = ReturnType<typeof appendThumbnailScene>;

async function prepareIntrinsicSceneImages(
  scene: ThumbnailScene,
  document: Document,
  signal: AbortSignal,
): Promise<void> {
  for (const { entry, image } of scene.intrinsicImages) {
    aborted(signal);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (
      !image.complete ||
      width !== NATIVE_THUMBNAIL_WIDTH ||
      height !== NATIVE_THUMBNAIL_HEIGHT
    )
      throw new NativeThumbnailError(
        "thumbnail-intrinsic-dimensions",
        "The neutral image did not decode at its expected intrinsic size.",
      );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext("2d");
      if (!context)
        throw new NativeThumbnailError(
          "thumbnail-intrinsic-raster-unavailable",
          "The neutral image cannot be rasterized for intrinsic sampling.",
        );
      context.drawImage(image, 0, 0, width, height);
      const blob = await deadline(
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((value) => {
            if (value) resolve(value);
            else
              reject(
                new NativeThumbnailError(
                  "thumbnail-intrinsic-raster-unavailable",
                  "The neutral image raster returned no PNG.",
                ),
              );
          }, "image/png");
        }),
        signal,
        FRAME_TIMEOUT_MS,
        "thumbnail-intrinsic-raster-timeout",
      );
      aborted(signal);
      const url = URL.createObjectURL(blob);
      scene.inputUrls.push(url);
      if (new URL(url).origin !== window.location.origin)
        throw new NativeThumbnailError(
          "thumbnail-intrinsic-origin",
          "The neutral image raster has no same-origin URL.",
        );
      image.src = url;
      await deadline(
        image.decode(),
        signal,
        FRAME_TIMEOUT_MS,
        "thumbnail-intrinsic-image-timeout",
      );
      if (
        !image.complete ||
        image.naturalWidth !== width ||
        image.naturalHeight !== height
      )
        throw new NativeThumbnailError(
          "thumbnail-intrinsic-dimensions",
          "The neutral raster changed its intrinsic dimensions.",
        );
      const sizing = entry.instance.sourceSizing;
      if (!sizing)
        throw new NativeThumbnailError(
          "thumbnail-intrinsic-contract",
          "The intrinsic image has no source-sizing contract.",
        );
      sizing.aspectRatio = width / height;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  if (scene.intrinsicImages.length) {
    const validation = validateEffectDocument(scene.effectDocument);
    if (!validation.valid)
      throw new NativeThumbnailError(
        "thumbnail-intrinsic-contract",
        validation.errors.slice(0, 3).join("; "),
      );
    scene.manifest.textContent = JSON.stringify(scene.effectDocument);
  }
}

function releaseIntrinsicSceneImages(scene: ThumbnailScene): void {
  const failures: unknown[] = [];
  for (const url of scene.inputUrls)
    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      failures.push(error);
    }
  scene.inputUrls.length = 0;
  if (failures.length) throw new NativeThumbnailCleanupError(failures);
}

function blobFromRgba(rgba: Uint8ClampedArray): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = NATIVE_THUMBNAIL_WIDTH;
  canvas.height = NATIVE_THUMBNAIL_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context)
    throw new NativeThumbnailError(
      "thumbnail-encoder-unavailable",
      "A 2D canvas is required to encode the GPU thumbnail.",
    );
  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  context.putImageData(
    new ImageData(pixels, NATIVE_THUMBNAIL_WIDTH, NATIVE_THUMBNAIL_HEIGHT),
    0,
    0,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (blob) resolve(blob);
      else
        reject(
          new NativeThumbnailError(
            "thumbnail-encode-failed",
            "The GPU thumbnail could not be encoded.",
          ),
        );
    }, "image/png"),
  );
}

type ValidationStatus = {
  instanceId: string;
  nodeId: string;
  status: "ready" | "error" | "last-good" | "unavailable";
  backend: "webgpu" | "unavailable";
  code?: string;
  message?: string;
  frames: number;
  sourceCaptures: number;
  estimatedResourceBytes: number;
  renderWallMs?: number;
};

function validationStatus(
  frameWindow: Window,
  runtime: NativeThumbnailRuntime,
  instance: PreparedNativeThumbnail["instance"],
): ValidationStatus {
  let observed: ValidationStatus | undefined;
  const onStatus = (event: Event) => {
    const detail = (event as CustomEvent<ValidationStatus>).detail;
    if (
      detail?.instanceId === instance.id &&
      detail.nodeId === instance.nodeId &&
      ["ready", "error", "last-good", "unavailable"].includes(detail.status) &&
      ["webgpu", "unavailable"].includes(detail.backend) &&
      Number.isSafeInteger(detail.frames) &&
      Number.isSafeInteger(detail.sourceCaptures) &&
      Number.isSafeInteger(detail.estimatedResourceBytes)
    )
      observed = detail;
  };
  frameWindow.addEventListener("native-shader-status", onStatus);
  try {
    runtime.requestStatusSnapshot();
  } finally {
    frameWindow.removeEventListener("native-shader-status", onStatus);
  }
  if (!observed)
    throw new NativeThumbnailError(
      "validation-status-unreadable",
      "The clean WebGPU fixture had no typed runtime status.",
    );
  return observed;
}

export class NativeThumbnailService {
  private frame: HTMLIFrameElement | null = null;
  private active: Job | null = null;
  private queued: Job | null = null;
  private disposed = false;
  private cache = new Map<string, string>();

  renderBatch(
    options: ThumbnailJob["options"],
  ): Promise<NativeThumbnailResult[]> {
    if (this.disposed)
      return Promise.reject(
        new NativeThumbnailError(
          "thumbnail-service-disposed",
          "The thumbnail renderer has been disposed.",
        ),
      );
    if (options.signal?.aborted)
      return Promise.reject(
        options.signal.reason ??
          new NativeThumbnailError(
            "thumbnail-aborted",
            "Thumbnail work was canceled.",
          ),
      );
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let job!: ThumbnailJob;
      const abortThumbnail = (reason: unknown) => {
        controller.abort(reason);
        if (this.queued === job) {
          this.queued = null;
          job.removeAbort();
          reject(reason);
        }
      };
      const onAbort = () =>
        abortThumbnail(
          options.signal?.reason ??
            new NativeThumbnailError(
              "thumbnail-aborted",
              "Thumbnail work was canceled.",
            ),
        );
      job = {
        kind: "thumbnail",
        options,
        controller,
        resolve,
        reject,
        removeAbort: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
        },
      };
      timer = setTimeout(
        () =>
          abortThumbnail(
            new NativeThumbnailError(
              "thumbnail-deadline",
              "The GPU thumbnail deadline expired.",
            ),
          ),
        THUMBNAIL_DEADLINE_MS,
      );
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (this.active) {
        if (this.queued) {
          this.queued.removeAbort();
          this.queued.reject(
            new NativeThumbnailError(
              "thumbnail-superseded",
              "A newer visible thumbnail batch replaced this request.",
            ),
          );
        }
        this.queued = job;
        this.active.controller.abort(
          new NativeThumbnailError(
            "thumbnail-superseded",
            "A newer visible thumbnail batch replaced this request.",
          ),
        );
      } else this.start(job);
    });
  }

  renderValidationBatch(
    options: ValidationJob["options"],
  ): Promise<NativeValidationResult[]> {
    if (this.disposed)
      return Promise.reject(
        new NativeThumbnailError(
          "thumbnail-service-disposed",
          "The shared GPU renderer has been disposed.",
        ),
      );
    if (options.signal?.aborted)
      return Promise.reject(
        options.signal.reason ??
          new NativeThumbnailError(
            "thumbnail-aborted",
            "GPU validation was canceled.",
          ),
      );
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let job!: ValidationJob;
      const abortValidation = (reason: unknown) => {
        controller.abort(reason);
        if (this.queued === job) {
          this.queued = null;
          job.removeAbort();
          reject(reason);
        }
      };
      const onAbort = () =>
        abortValidation(
          options.signal?.reason ??
            new NativeThumbnailError(
              "thumbnail-aborted",
              "Queued GPU validation was canceled.",
            ),
        );
      job = {
        kind: "validation",
        options,
        controller,
        resolve,
        reject,
        removeAbort: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
        },
      };
      timer = setTimeout(
        () =>
          abortValidation(
            new NativeThumbnailError(
              "validation-deadline",
              "The clean GPU validation deadline expired.",
            ),
          ),
        VALIDATION_DEADLINE_MS,
      );
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (this.active) {
        if (this.queued) {
          this.queued.removeAbort();
          this.queued.reject(
            new NativeThumbnailError(
              "thumbnail-superseded",
              "A newer GPU batch replaced this request.",
            ),
          );
        }
        this.queued = job;
        this.active.controller.abort(
          new NativeThumbnailError(
            "thumbnail-superseded",
            "A newer GPU batch replaced this request.",
          ),
        );
      } else this.start(job);
    });
  }

  private start(job: Job): void {
    this.active = job;
    void (async () => {
      if (job.kind === "thumbnail") job.resolve(await this.perform(job));
      else job.resolve(await this.performValidation(job));
    })()
      .catch(job.reject)
      .finally(() => {
        job.removeAbort();
        if (this.active === job) this.active = null;
        const next = this.queued;
        this.queued = null;
        if (next && !this.disposed) this.start(next);
      });
  }

  private async ensureFrame(signal: AbortSignal): Promise<HTMLIFrameElement> {
    if (this.frame?.isConnected) return this.frame;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      `position:fixed;left:0;top:0;width:${SHEET_WIDTH}px;height:${SHEET_HEIGHT}px;` +
      "opacity:0;pointer-events:none;z-index:-1;border:0;";
    const loaded = new Promise<void>((resolve, reject) => {
      frame.addEventListener("load", () => resolve(), { once: true });
      frame.addEventListener(
        "error",
        () =>
          reject(
            new NativeThumbnailError(
              "thumbnail-frame-unavailable",
              "The shared renderer frame failed to load.",
            ),
          ),
        { once: true },
      );
    });
    frame.srcdoc = thumbnailDocument();
    document.body.append(frame);
    try {
      await deadline(
        loaded,
        signal,
        FRAME_TIMEOUT_MS,
        "thumbnail-frame-timeout",
      );
      thumbnailRuntime(frame);
      this.frame = frame;
      return frame;
    } catch (error) {
      let cleanupFailed = false;
      let cleanupFailure: unknown;
      try {
        (
          frame.contentWindow as NativeThumbnailFrameWindow | null
        )?.__anNativeShaders?.dispose();
      } catch (failure) {
        cleanupFailed = true;
        cleanupFailure = failure;
      } finally {
        frame.remove();
      }
      if (cleanupFailed)
        throw new NativeThumbnailCleanupError([error, cleanupFailure]);
      throw error;
    }
  }

  private async awaitReady(
    targets: readonly HTMLElement[],
    signal: AbortSignal,
  ): Promise<void> {
    const until = performance.now() + FRAME_TIMEOUT_MS;
    while (performance.now() < until) {
      aborted(signal);
      const statuses = targets.map((target) => ({
        status: target.getAttribute("data-an-native-status"),
        code: target.getAttribute("data-an-native-error"),
        message: target.getAttribute("data-an-native-error-message"),
      }));
      if (statuses.every((entry) => entry.status === "ready")) return;
      const failure = statuses.find(
        (entry) =>
          entry.status === "error" &&
          entry.code !== "approvals-pending" &&
          entry.code !== "approvals-unreadable" &&
          entry.code !== "definition-untrusted",
      );
      if (failure)
        throw new NativeThumbnailError(
          failure.code ?? "thumbnail-render-failed",
          failure.message ?? failure.code ?? "Thumbnail rendering failed.",
        );
      await nextTurn(signal, 50);
    }
    throw new NativeThumbnailError(
      "thumbnail-render-timeout",
      "The shared renderer did not produce all requested thumbnails.",
    );
  }

  private remember(key: string, url: string): void {
    const previous = this.cache.get(key);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    this.cache.delete(key);
    this.cache.set(key, url);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      URL.revokeObjectURL(this.cache.get(oldest)!);
      this.cache.delete(oldest);
    }
  }

  private async performValidation(
    job: ValidationJob,
  ): Promise<NativeValidationResult[]> {
    const signal = job.controller.signal;
    aborted(signal);
    const { prepared, results } = await prepareNativeThumbnailBatch(
      job.options,
    );
    const output = new Map<string, NativeValidationResult>();
    for (const result of results) {
      if (result.status === "ready")
        throw new NativeThumbnailError(
          "validation-result-invalid",
          "A prepared GPU case appeared in the rejected-case list.",
        );
      const item = job.options.items.find(
        (candidate) => candidate.id === result.id,
      );
      if (!item)
        throw new NativeThumbnailError(
          "validation-result-missing",
          "A rejected validation case has no matching request.",
        );
      output.set(item.id, {
        id: item.id,
        status: result.status,
        backend: "unavailable",
        executionHash: await hashEffectDefinition(item.definition),
        code: result.code,
        message: result.message.slice(0, 300),
      });
    }
    const frame = prepared.length ? await this.ensureFrame(signal) : null;
    const frameDocument = frame?.contentDocument;
    const frameWindow = frame?.contentWindow;
    if (prepared.length && (!frameDocument || !frameWindow))
      throw new NativeThumbnailError(
        "thumbnail-frame-unavailable",
        "The shared WebGPU renderer frame became unavailable.",
      );
    for (const entry of prepared) {
      aborted(signal);
      const item = job.options.items.find(
        (candidate) => candidate.id === entry.item.id,
      );
      if (!item || !frameDocument || !frameWindow || !frame)
        throw new NativeThumbnailError(
          "validation-result-missing",
          "A prepared GPU case has no fixture or renderer.",
        );
      const executionHash = entry.executionHash;
      if (
        (entry.instance.placement !== "fill" &&
          item.fixture.sourceKind === "generated") ||
        (entry.instance.placement === "fill" &&
          item.fixture.sourceKind === "owned-image") ||
        (entry.instance.sourceSizing?.inputSpace === "intrinsic-image" &&
          item.fixture.sourceKind !== "owned-image")
      ) {
        output.set(item.id, {
          id: item.id,
          status: "error",
          backend: "unavailable",
          executionHash,
          code: "validation-fixture-unsupported",
          message: "validation-fixture-unsupported",
        });
        continue;
      }
      nativeValidationFixtureBox(item.fixture);
      const frameIndex = nativeValidationFrameIndex(item.timeSeconds);
      const runtime = thumbnailRuntime(frame);
      const validationEntry: PreparedNativeThumbnail = {
        ...entry,
        instance: {
          ...entry.instance,
          timing: { speed: 1, paused: false, time: 0 },
        },
      };
      const scene = appendThumbnailScene(
        frameDocument,
        [validationEntry],
        item.fixture,
      );
      let failed = false;
      let failure: unknown;
      let failedStatus: ValidationStatus | undefined;
      let sessionId: string | undefined;
      try {
        await deadline(
          Promise.all(scene.images.map((image) => image.decode())),
          signal,
          FRAME_TIMEOUT_MS,
          "validation-image-timeout",
        );
        await prepareIntrinsicSceneImages(scene, frameDocument, signal);
        aborted(signal);
        frameDocument.body.append(scene.root, scene.manifest);
        frameWindow.postMessage(
          {
            type: "native-shader-approvals",
            status: "ready",
            hashes: job.options.approvedExecutionHashes,
          },
          window.location.origin,
        );
        await deadline(
          runtime.scan(),
          signal,
          FRAME_TIMEOUT_MS,
          "validation-scan-timeout",
        );
        await this.awaitReady(scene.targets, signal);
        if (entry.item.definition.simulation || entry.item.definition.feedback)
          sessionId = (
            await runtime.beginSimulationExportSession({
              fps: 60,
              totalFrames: frameIndex + 1,
              startTimeSeconds: 0,
              signal,
              timeoutMs: RENDER_TIMEOUT_MS,
            })
          ).sessionId;
        let pixels: NativeThumbnailPixels | undefined;
        let linearGolden:
          | Extract<NativeValidationResult, { status: "ready" }>["linearGolden"]
          | undefined;
        // Persistent trails must see every export frame, even when only the final sample is retained.
        for (
          let index = sessionId ? 0 : frameIndex;
          index <= frameIndex;
          index += 1
        ) {
          aborted(signal);
          const frameOptions = {
            frameIndex: index,
            fps: 60 as const,
            sourceContract: "declarative-only" as const,
            viewport: { width: SHEET_WIDTH, height: SHEET_HEIGHT },
            pixelRatio: 1 as const,
            ...(sessionId ? { simulationSessionId: sessionId } : {}),
            signal,
            timeoutMs: RENDER_TIMEOUT_MS,
          };
          if (index === frameIndex && item.expectedLinearSamples) {
            const golden = await runtime.renderCompositionFrameGolden(
              frameOptions,
              {
                instanceId: entry.instance.id,
                nodeId: entry.instance.nodeId,
                expectedLinearSamples: item.expectedLinearSamples,
              },
            );
            pixels = golden.pixels;
            linearGolden = golden.linearGolden;
          } else
            pixels = await runtime.renderCompositionFramePixels(frameOptions);
        }
        if (!pixels)
          throw new NativeThumbnailError(
            "validation-pixels-missing",
            "The validation clock produced no frame.",
          );
        aborted(signal);
        if (pixels.colorSpace !== "srgb" || pixels.alpha !== "straight")
          throw new NativeThumbnailError(
            "validation-pixels-invalid",
            "The WebGPU result has an unsupported pixel contract.",
          );
        const status = validationStatus(frameWindow, runtime, entry.instance);
        if (
          status.status !== "ready" ||
          status.backend !== "webgpu" ||
          status.frames < 1
        )
          throw new NativeThumbnailError(
            status.code ?? "validation-render-failed",
            status.message ??
              "The effect was not ready after strict rendering.",
          );
        output.set(item.id, {
          id: item.id,
          status: "ready",
          backend: "webgpu",
          executionHash,
          width: NATIVE_THUMBNAIL_WIDTH,
          height: NATIVE_THUMBNAIL_HEIGHT,
          colorSpace: "srgb",
          alpha: "straight",
          rgba: new Uint8Array(cropNativeThumbnailRgba(pixels, 0)),
          frames: status.frames,
          sourceCaptures: status.sourceCaptures,
          estimatedResourceBytes: status.estimatedResourceBytes,
          ...(status.renderWallMs === undefined
            ? {}
            : { renderWallMs: status.renderWallMs }),
          ...(linearGolden ? { linearGolden } : {}),
        });
      } catch (error) {
        failed = true;
        failure = error;
        try {
          failedStatus = validationStatus(frameWindow, runtime, entry.instance);
        } catch (statusError) {
          if (
            error instanceof NativeThumbnailError &&
            error.code === "validation-status-unreadable"
          )
            failure = statusError;
        }
      } finally {
        if (sessionId)
          try {
            await deadline(
              runtime.endSimulationExportSession(sessionId, {
                timeoutMs: RENDER_TIMEOUT_MS,
              }),
              new AbortController().signal,
              RENDER_TIMEOUT_MS,
              "validation-session-cleanup-timeout",
            );
          } catch (error) {
            if (failed)
              failure = new NativeThumbnailCleanupError([failure, error]);
            else {
              failed = true;
              failure = error;
            }
          }
        scene.root.remove();
        scene.manifest.remove();
        try {
          await deadline(
            runtime.scan(),
            new AbortController().signal,
            FRAME_TIMEOUT_MS,
            "validation-cleanup-timeout",
          );
        } catch (error) {
          this.disposeFrame();
          if (failed)
            failure = new NativeThumbnailCleanupError([failure, error]);
          else {
            failed = true;
            failure = error;
          }
        }
        try {
          releaseIntrinsicSceneImages(scene);
        } catch (error) {
          if (failed)
            failure = new NativeThumbnailCleanupError([failure, error]);
          else {
            failed = true;
            failure = error;
          }
        }
      }
      if (failed) {
        if (signal.aborted) throw failure;
        if (failure instanceof NativeThumbnailCleanupError) throw failure;
        const code =
          typeof failure === "object" &&
          failure !== null &&
          "code" in failure &&
          typeof failure.code === "string"
            ? failure.code
            : "validation-render-failed";
        output.set(item.id, {
          id: item.id,
          status:
            failedStatus?.status && failedStatus.status !== "ready"
              ? failedStatus.status
              : "error",
          backend: failedStatus?.backend ?? "unavailable",
          executionHash,
          code: (failedStatus?.code ?? code).slice(0, 80),
          message: (
            failedStatus?.message ??
            (failure instanceof Error ? failure.message : String(failure))
          ).slice(0, 300),
          ...(failedStatus
            ? {
                frames: failedStatus.frames,
                sourceCaptures: failedStatus.sourceCaptures,
                estimatedResourceBytes: failedStatus.estimatedResourceBytes,
                ...(failedStatus.renderWallMs === undefined
                  ? {}
                  : { renderWallMs: failedStatus.renderWallMs }),
              }
            : {}),
        });
      }
    }
    aborted(signal);
    return job.options.items.map((item) => {
      const result = output.get(item.id);
      if (!result)
        throw new NativeThumbnailError(
          "validation-result-missing",
          "A requested GPU case has no result.",
        );
      return result;
    });
  }

  private async perform(job: ThumbnailJob): Promise<NativeThumbnailResult[]> {
    const signal = job.controller.signal;
    aborted(signal);
    const { prepared, results } = await deadline(
      prepareNativeThumbnailBatch(job.options),
      signal,
      THUMBNAIL_DEADLINE_MS,
      "thumbnail-prepare-timeout",
    );
    const output = new Map(results.map((result) => [result.id, result]));
    const misses: PreparedNativeThumbnail[] = [];
    for (const entry of prepared) {
      const url = this.cache.get(entry.cacheKey);
      if (url) {
        this.cache.delete(entry.cacheKey);
        this.cache.set(entry.cacheKey, url);
        output.set(entry.item.id, {
          id: entry.item.id,
          status: "ready",
          objectUrl: url,
          executionHash: entry.executionHash,
        });
      } else misses.push(entry);
    }
    if (misses.length) {
      const frame = await this.ensureFrame(signal);
      const frameDocument = frame.contentDocument;
      const frameWindow = frame.contentWindow;
      if (!frameDocument || !frameWindow)
        throw new NativeThumbnailError(
          "thumbnail-frame-unavailable",
          "The shared renderer frame became unavailable.",
        );
      const runtime = thumbnailRuntime(frame);
      const scene = appendThumbnailScene(frameDocument, misses);
      const newUrls: string[] = [];
      let scanCompleted = false;
      let failed = false;
      let failure: unknown;
      try {
        await deadline(
          Promise.all(scene.images.map((image) => image.decode())),
          signal,
          FRAME_TIMEOUT_MS,
          "thumbnail-image-timeout",
        );
        await prepareIntrinsicSceneImages(scene, frameDocument, signal);
        aborted(signal);
        frameDocument.body.append(scene.root, scene.manifest);
        frameWindow.postMessage(
          {
            type: "native-shader-approvals",
            status: "ready",
            hashes: job.options.approvedExecutionHashes,
          },
          window.location.origin,
        );
        try {
          await deadline(
            runtime.scan(),
            signal,
            FRAME_TIMEOUT_MS,
            "thumbnail-scan-timeout",
          );
          scanCompleted = true;
        } catch (error) {
          job.controller.abort(error);
          throw error;
        }
        await this.awaitReady(scene.targets, signal);
        const hasStatefulEffect = misses.some(
          (entry) =>
            !!entry.item.definition.simulation ||
            !!entry.item.definition.feedback,
        );
        let sessionId: string | undefined;
        let primaryFailed = false;
        let primaryFailure: unknown;
        let pixels: NativeThumbnailPixels | undefined;
        try {
          if (hasStatefulEffect)
            sessionId = (
              await deadline(
                runtime.beginSimulationExportSession({
                  fps: 60,
                  totalFrames: 1,
                  startTimeSeconds: 0,
                  signal,
                  timeoutMs: RENDER_TIMEOUT_MS,
                }),
                signal,
                RENDER_TIMEOUT_MS,
                "thumbnail-simulation-timeout",
              )
            ).sessionId;
          pixels = await deadline(
            runtime.renderCompositionFramePixels({
              frameIndex: 0,
              fps: 60,
              sourceContract: "declarative-only",
              viewport: { width: SHEET_WIDTH, height: SHEET_HEIGHT },
              pixelRatio: 1,
              ...(sessionId ? { simulationSessionId: sessionId } : {}),
              signal,
              timeoutMs: RENDER_TIMEOUT_MS,
            }),
            signal,
            RENDER_TIMEOUT_MS,
            "thumbnail-render-timeout",
          );
        } catch (error) {
          primaryFailed = true;
          primaryFailure = error;
        } finally {
          if (sessionId)
            try {
              await deadline(
                runtime.endSimulationExportSession(sessionId, {
                  timeoutMs: RENDER_TIMEOUT_MS,
                }),
                new AbortController().signal,
                RENDER_TIMEOUT_MS,
                "thumbnail-simulation-cleanup-timeout",
              );
            } catch (cleanupError) {
              if (primaryFailed)
                throw new NativeThumbnailCleanupError([
                  primaryFailure,
                  cleanupError,
                ]);
              throw cleanupError;
            }
        }
        if (primaryFailed) throw primaryFailure;
        if (
          !pixels ||
          pixels.colorSpace !== "srgb" ||
          pixels.alpha !== "straight"
        )
          throw new NativeThumbnailError(
            "thumbnail-pixels-invalid",
            "The renderer returned an unsupported thumbnail pixel contract.",
          );
        for (const [slot, entry] of misses.entries()) {
          aborted(signal);
          const rgba = cropNativeThumbnailRgba(pixels, slot);
          const blob = await deadline(
            blobFromRgba(rgba),
            signal,
            RENDER_TIMEOUT_MS,
            "thumbnail-encode-timeout",
          );
          aborted(signal);
          const url = URL.createObjectURL(blob);
          newUrls.push(url);
          output.set(entry.item.id, {
            id: entry.item.id,
            status: "ready",
            objectUrl: url,
            executionHash: entry.executionHash,
          });
        }
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        scene.root.remove();
        scene.manifest.remove();
        let cleanupFailed = false;
        let cleanupFailure: unknown;
        try {
          if (scanCompleted && !failed)
            await deadline(
              runtime.scan(),
              new AbortController().signal,
              FRAME_TIMEOUT_MS,
              "thumbnail-cleanup-timeout",
            );
          else this.disposeFrame();
        } catch (error) {
          cleanupFailed = true;
          cleanupFailure = error;
          if (this.frame === frame)
            try {
              this.disposeFrame();
            } catch (disposeError) {
              cleanupFailure = new NativeThumbnailCleanupError([
                error,
                disposeError,
              ]);
            }
        }
        try {
          releaseIntrinsicSceneImages(scene);
        } catch (error) {
          if (cleanupFailed)
            cleanupFailure = new NativeThumbnailCleanupError([
              cleanupFailure,
              error,
            ]);
          else {
            cleanupFailed = true;
            cleanupFailure = error;
          }
        }
        if (failed || cleanupFailed)
          for (const url of newUrls) URL.revokeObjectURL(url);
        if (failed && cleanupFailed)
          throw new NativeThumbnailCleanupError([failure, cleanupFailure]);
        if (cleanupFailed) throw cleanupFailure;
      }
      if (failed) throw failure;
      aborted(signal);
      for (const [index, entry] of misses.entries())
        this.remember(entry.cacheKey, newUrls[index]);
    }
    aborted(signal);
    return job.options.items.map((item) => {
      const result = output.get(item.id);
      if (!result)
        throw new NativeThumbnailError(
          "thumbnail-result-missing",
          "A requested GPU thumbnail has no result.",
        );
      return result;
    });
  }

  private disposeFrame(): void {
    if (!this.frame) return;
    const frame = this.frame;
    this.frame = null;
    try {
      (
        frame.contentWindow as NativeThumbnailFrameWindow | null
      )?.__anNativeShaders?.dispose();
    } finally {
      frame.remove();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.controller.abort(
      new NativeThumbnailError(
        "thumbnail-service-disposed",
        "The thumbnail renderer has been disposed.",
      ),
    );
    if (this.queued) {
      this.queued.removeAbort();
      this.queued.reject(
        new NativeThumbnailError(
          "thumbnail-service-disposed",
          "The thumbnail renderer has been disposed.",
        ),
      );
      this.queued = null;
    }
    const until = performance.now() + RENDER_TIMEOUT_MS;
    while (this.active && performance.now() < until)
      await nextTurn(new AbortController().signal, 20);
    let failed = false;
    let failure: unknown;
    if (this.active) {
      failed = true;
      failure = new NativeThumbnailError(
        "thumbnail-cleanup-timeout",
        "The GPU thumbnail operation did not settle before disposal.",
      );
    }
    try {
      this.disposeFrame();
    } catch (error) {
      if (failed) failure = new NativeThumbnailCleanupError([failure, error]);
      else {
        failed = true;
        failure = error;
      }
    }
    for (const url of this.cache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        if (failed) failure = new NativeThumbnailCleanupError([failure, error]);
        else {
          failed = true;
          failure = error;
        }
      }
    }
    this.cache.clear();
    if (failed) throw failure;
  }
}
