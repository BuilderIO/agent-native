import { resolveNativeClipRadii } from "../../../../shared/native-clip-geometry";
import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
import { readNativeAuthoredPaint } from "./native-authored-paint";
import {
  planNativeChainedEffectExtent,
  planNativeFillPresentationExtent,
  type NativeEffectExtentPlan,
} from "./native-effect-extent";
import {
  planNativeOutputGeometry,
  supportsNativeOutput2D,
} from "./native-effect-output-geometry";
import { filterNativeExportSelection } from "./native-export-selection";
import { beginNativeRegionExport } from "./native-region-export";
import {
  createNativeSceneProvider,
  cloneNativeTextFlow,
  NativeSourceError,
  nativeTargetOverflowInsets,
  nativeTextFlowUsesDocumentFont,
  paintNativeTextFlow,
  solidBackgroundAlpha,
  type NativeSceneProvider,
  type NativeSourceRecord,
} from "./native-source-provider";
import { NativeWorkerHost, NativeWorkerHostError } from "./native-worker-host";
import type {
  NativeWorkerEffectTarget,
  NativeWorkerScene,
  NativeWorkerSourceRecord,
} from "./native-worker-protocol";
import { NativeWorkerSourceSnapshot } from "./native-worker-source-snapshot";

export type NativeWorkerSceneEntry = {
  instance: EffectInstance;
  definition: EffectDefinition;
  definitionHash: string;
  target: HTMLElement | SVGSVGElement;
};

type TargetState = {
  entry: NativeWorkerSceneEntry;
  marker: HTMLCanvasElement;
  provider: NativeSceneProvider;
  captureScope: number;
};

type Publication = {
  generation: number;
  sourceEpoch: number;
  authoredEpoch: number;
  rootWidth: number;
  rootHeight: number;
  targetEpochs: Map<string, { source: number; authored: number }>;
  rootRecords: readonly NativeSourceRecord[];
  payloads: Map<string, { payload: string; definitionHash: string }>;
};

const OMIT_SCENE_CHILD =
  "[data-agent-native-edit-overlay],[data-agent-native-editor-chrome],[data-agent-native-editor-chrome-host]";

function scenePaintRoot(node: Element, body: HTMLElement): Element | null {
  let child = node;
  while (child.parentElement && child.parentElement !== body)
    child = child.parentElement;
  return child.parentElement === body ? child : null;
}

export function nativeWorkerOutputRecords(
  records: readonly NativeWorkerSourceRecord[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
): NativeWorkerSourceRecord[] {
  return records.map((record) => {
    const size = record.nativeInstanceId
      ? sizes.get(record.nativeInstanceId)
      : undefined;
    return size
      ? { ...record, width: size.width, height: size.height }
      : record;
  });
}

function nativeWorkerTargetGeometry(
  target: HTMLElement | SVGSVGElement,
  pixelRatio: number,
  cssWidth: number,
  cssHeight: number,
): { width: number; height: number; rect: NativeWorkerEffectTarget["rect"] } {
  const rect = target.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(cssWidth * pixelRatio));
  const height = Math.max(1, Math.ceil(cssHeight * pixelRatio));
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    width > 8192 ||
    height > 8192
  )
    throw new NativeSourceError(
      "worker-target-geometry-invalid",
      "A native effect target has unavailable or oversized geometry.",
    );
  return {
    width,
    height,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

export class NativeWorkerSceneHost {
  readonly canvas: HTMLCanvasElement;
  readonly worker: NativeWorkerHost;
  private readonly provider: NativeSceneProvider;
  private readonly targets = new Map<string, TargetState>();
  private readonly textMasks = new Map<
    string,
    { signature: string; canvas: HTMLCanvasElement }
  >();
  private readonly assetRevisions = new Map<string, number>();
  private readonly pendingAssetRevisions = new Map<
    number,
    Map<string, number>
  >();
  private readonly suppressed = new Set<Element>();
  private readonly markedTargets = new Set<Element>();
  private readonly staged = new Map<number, Publication>();
  private readonly scenes = new Map<number, NativeWorkerScene>();
  private readonly publicationWaiters = new Set<{
    instanceId: string;
    payload: string;
    definitionHash: string;
    minimumGeneration: number;
    expectedTimeSeconds: number | null;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly committedFrameTimes: number[] = [];
  private entries: NativeWorkerSceneEntry[] = [];
  private generation = 0;
  private nextCaptureScope = 0;
  private capturingExport = false;
  private preparingExport = false;
  private holdingLastFrame = false;
  private visible = true;
  private dirty = false;
  private updating = false;
  private disposed = false;
  private committed: Publication | null = null;
  private committedSceneSnapshot: NativeWorkerScene | null = null;
  private lastScene: NativeWorkerScene | null = null;
  private cameraInFlightGeneration: number | null = null;
  private cameraUpdatePending = false;
  private cameraPublishTimer: ReturnType<typeof setTimeout> | null = null;
  private clock: () => { playing: boolean; timeSeconds: number; speed: number };

  constructor(
    workerSource: string,
    sceneId: string,
    clock: () => { playing: boolean; timeSeconds: number; speed: number },
    private readonly onCommitted: (
      publication: Publication,
      message: {
        timeSeconds: number;
        committedInstances: readonly {
          instanceId: string;
          definitionHash: string;
          payload: string;
          localTime: number;
        }[];
      },
    ) => void,
    private readonly onFailure: (error: Error) => void,
    private readonly layout: (target: HTMLElement | SVGSVGElement) => {
      width: number;
      height: number;
      offsetLeft: number;
      offsetTop: number;
      transform: string;
      transformOrigin: string;
      translate: string;
      rotate: string;
      scale: string;
    },
    private readonly sceneGeometry: () => {
      viewport: { x: number; y: number; width: number; height: number };
      pixelRatio: number;
    },
  ) {
    const body = document.body;
    if (!body)
      throw new NativeSourceError(
        "worker-scene-unavailable",
        "The native worker scene has no document body.",
      );
    this.clock = clock;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("data-an-native-scene-presentation", "");
    this.canvas.setAttribute("data-an-native-presentation", "");
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.cssText =
      "position:fixed;left:0;top:0;pointer-events:none;visibility:hidden;z-index:0;max-width:none;max-height:none;";
    body.prepend(this.canvas);
    const provider = createNativeSceneProvider(
      document.documentElement,
      "layer",
      () => this.requestUpdate(),
    );
    if (!provider) {
      this.canvas.remove();
      throw new NativeSourceError(
        "worker-scene-source-unavailable",
        "The native worker cannot capture the authored scene.",
      );
    }
    this.provider = provider;
    try {
      this.worker = new NativeWorkerHost(
        workerSource,
        sceneId,
        this.canvas,
        (message) => this.publish(message),
        (error) => {
          this.clearCameraSubmission();
          this.assetRevisions.clear();
          this.pendingAssetRevisions.clear();
          this.staged.clear();
          this.scenes.clear();
          for (const waiter of this.publicationWaiters) {
            clearTimeout(waiter.timer);
            waiter.reject(error);
          }
          this.publicationWaiters.clear();
          this.onFailure(error);
        },
        (message) => {
          const revisions = this.pendingAssetRevisions.get(message.generation);
          if (!revisions) return;
          this.assetRevisions.clear();
          for (const [id, revision] of revisions)
            this.assetRevisions.set(id, revision);
          for (const generation of this.pendingAssetRevisions.keys())
            if (generation <= message.generation)
              this.pendingAssetRevisions.delete(generation);
        },
      );
    } catch (error) {
      this.provider.dispose();
      this.canvas.remove();
      throw error;
    }
    window.addEventListener("scroll", this.requestUpdate, true);
    window.addEventListener("resize", this.requestUpdate);
  }

  private createTarget(entry: NativeWorkerSceneEntry): TargetState {
    const marker = document.createElement("canvas");
    marker.dataset.anNativeCanvas = entry.instance.id;
    marker.setAttribute("data-an-native-presentation", "");
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText =
      "position:absolute;pointer-events:none;display:block;max-width:none;max-height:none;";
    if (entry.instance.placement === "backdrop") {
      marker.setAttribute("data-an-native-backdrop-presentation", "");
      marker.setAttribute(
        "data-an-native-backdrop-receiver-node-id",
        entry.instance.nodeId,
      );
    }
    entry.target.after(marker);
    const provider = createNativeSceneProvider(
      entry.target,
      entry.instance.placement,
      () => this.requestUpdate(),
      entry.instance.placement === "backdrop" ? marker : undefined,
    );
    if (!provider) {
      marker.remove();
      throw new NativeSourceError(
        "worker-target-source-unavailable",
        `Native effect ${entry.instance.id} has no source provider.`,
      );
    }
    return { entry, marker, provider, captureScope: ++this.nextCaptureScope };
  }

  setEntries(entries: readonly NativeWorkerSceneEntry[]): void {
    if (this.disposed) return;
    const wanted = new Set(entries.map((entry) => entry.instance.id));
    for (const [id, state] of this.targets) {
      if (
        wanted.has(id) &&
        entries.some(
          (entry) =>
            entry.instance.id === id &&
            entry.target === state.entry.target &&
            entry.instance.placement === state.entry.instance.placement,
        )
      )
        continue;
      state.provider.dispose();
      state.marker.remove();
      this.targets.delete(id);
    }
    this.entries = [...entries];
    for (const target of this.markedTargets) {
      target.removeAttribute("data-an-native-fill-instance");
      target.removeAttribute("data-an-native-layer-instance");
    }
    this.markedTargets.clear();
    for (const entry of entries) {
      const existing = this.targets.get(entry.instance.id);
      if (existing) existing.entry = entry;
      else this.targets.set(entry.instance.id, this.createTarget(entry));
    }
    const topFill = new Map<Element, string>();
    const topLayer = new Map<Element, string>();
    for (const entry of entries) {
      if (entry.instance.placement === "fill")
        topFill.set(entry.target, entry.instance.id);
      if (entry.instance.placement === "layer")
        topLayer.set(entry.target, entry.instance.id);
    }
    for (const entry of entries) {
      const state = this.targets.get(entry.instance.id)!;
      this.markedTargets.add(entry.target);
      if (topFill.get(entry.target) === entry.instance.id)
        entry.target.setAttribute(
          "data-an-native-fill-instance",
          entry.instance.id,
        );
      if (topLayer.get(entry.target) === entry.instance.id)
        entry.target.setAttribute(
          "data-an-native-layer-instance",
          entry.instance.id,
        );
      state.marker.style.visibility =
        topLayer.get(entry.target) === entry.instance.id ||
        (topFill.get(entry.target) === entry.instance.id &&
          !topLayer.has(entry.target)) ||
        entry.instance.placement === "backdrop"
          ? "visible"
          : "hidden";
    }
    this.requestUpdate();
  }

  setEntriesAndWait(
    entries: readonly NativeWorkerSceneEntry[],
    instanceId: string,
    timeoutMs = 15_000,
  ): Promise<void> {
    const entry = entries.find(
      (candidate) => candidate.instance.id === instanceId,
    );
    if (!entry)
      throw new NativeWorkerHostError(
        "worker-instance-missing",
        "The native worker instance is unavailable.",
      );
    const payload = JSON.stringify(entry.instance);
    const requestedClock = this.clock();
    const promise = new Promise<void>((resolve, reject) => {
      const waiter = {
        instanceId,
        payload,
        definitionHash: entry.definitionHash,
        minimumGeneration: this.generation + 1,
        expectedTimeSeconds: requestedClock.playing
          ? null
          : requestedClock.timeSeconds,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.publicationWaiters.delete(waiter);
          reject(
            new NativeWorkerHostError(
              "worker-publish-timeout",
              "The native worker instance was not published in time.",
            ),
          );
        }, timeoutMs),
      };
      this.publicationWaiters.add(waiter);
    });
    this.setEntries(entries);
    return promise;
  }

  requestUpdate = (): void => {
    if (this.disposed || this.holdingLastFrame) return;
    this.dirty = true;
    if (this.updating || this.capturingExport || !this.visible) return;
    queueMicrotask(() => void this.updateLoop());
  };

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible && this.cameraPublishTimer !== null) {
      clearTimeout(this.cameraPublishTimer);
      this.cameraPublishTimer = null;
    } else if (visible && this.cameraInFlightGeneration !== null) {
      this.armCameraPublishTimeout(this.cameraInFlightGeneration);
    }
    this.worker.setVisible(visible);
    if (visible && this.dirty && !this.updating && !this.capturingExport)
      queueMicrotask(() => void this.updateLoop());
  }

  private snapshotClock(
    viewport: { x: number; y: number; width: number; height: number },
    exportCapture: boolean,
  ): NativeWorkerScene["clock"] {
    const clock = this.clock();
    if (
      exportCapture ||
      !clock.playing ||
      !this.entries.length ||
      ![viewport.x, viewport.y, viewport.width, viewport.height].every(
        Number.isFinite,
      ) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    )
      return clock;
    let readableMarkers = 0;
    for (const entry of this.entries) {
      const marker = this.targets.get(entry.instance.id)?.marker;
      if (!marker || !marker.isConnected) return clock;
      if (marker.style.visibility === "hidden") continue;
      let rect: DOMRect;
      try {
        rect = marker.getBoundingClientRect();
      } catch {
        return clock;
      }
      if (
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0
      )
        return clock;
      readableMarkers += 1;
      if (
        rect.x < viewport.x + viewport.width &&
        rect.x + rect.width > viewport.x &&
        rect.y < viewport.y + viewport.height &&
        rect.y + rect.height > viewport.y
      )
        return clock;
    }
    return readableMarkers ? { ...clock, playing: false } : clock;
  }

  retainsPreviewViewport(
    viewport: { x: number; y: number; width: number; height: number },
    pixelRatio: number,
  ): boolean {
    const committed = this.currentCameraSource(pixelRatio);
    if (
      this.dirty ||
      this.updating ||
      !committed ||
      this.lastScene?.generation !== committed.scene.generation
    )
      return false;
    const retained = committed.scene.viewport;
    if (
      ![viewport.x, viewport.y, viewport.width, viewport.height].every(
        Number.isFinite,
      ) ||
      viewport.width <= 0 ||
      viewport.height <= 0 ||
      viewport.x < retained.x - 0.001 ||
      viewport.y < retained.y - 0.001 ||
      viewport.x + viewport.width > retained.x + retained.width + 0.001 ||
      viewport.y + viewport.height > retained.y + retained.height + 0.001
    )
      return false;
    if (
      this.snapshotClock(viewport, false).playing !==
      committed.scene.clock.playing
    )
      return false;
    return true;
  }

  private currentCameraSource(
    pixelRatio: number,
  ): ReturnType<NativeWorkerSceneHost["committedScene"]> {
    const committed = this.committedScene();
    if (
      !this.visible ||
      this.disposed ||
      this.capturingExport ||
      this.preparingExport ||
      !committed ||
      this.provider.sourceEpoch?.() !== committed.publication.sourceEpoch ||
      this.provider.authoredSourceEpoch?.() !==
        committed.publication.authoredEpoch ||
      innerWidth !== committed.publication.rootWidth ||
      innerHeight !== committed.publication.rootHeight ||
      !Number.isFinite(pixelRatio) ||
      pixelRatio <= 0 ||
      Math.abs(pixelRatio - committed.scene.pixelRatio) > 0.000001 ||
      this.entries.length !== committed.publication.payloads.size
    )
      return null;
    for (const entry of this.entries) {
      const expected = committed.publication.payloads.get(entry.instance.id);
      const epoch = committed.publication.targetEpochs.get(entry.instance.id);
      const state = this.targets.get(entry.instance.id);
      const target = committed.scene.targets.find(
        (candidate) => candidate.instanceId === entry.instance.id,
      );
      if (
        !expected ||
        expected.payload !== JSON.stringify(entry.instance) ||
        expected.definitionHash !== entry.definitionHash ||
        !epoch ||
        !state ||
        state.entry.target !== entry.target ||
        state.provider.sourceEpoch?.() !== epoch.source ||
        state.provider.authoredSourceEpoch?.() !== epoch.authored ||
        !target
      )
        return null;
      const rect = entry.target.getBoundingClientRect();
      if (
        Math.abs(rect.x - target.rect.x) > 0.001 ||
        Math.abs(rect.y - target.rect.y) > 0.001 ||
        Math.abs(rect.width - target.rect.width) > 0.001 ||
        Math.abs(rect.height - target.rect.height) > 0.001
      )
        return null;
    }
    return committed;
  }

  private reprojectSnapshot(): Awaited<
    ReturnType<NativeWorkerSceneHost["captureSnapshot"]>
  > | null {
    const { viewport, pixelRatio } = this.sceneGeometry();
    const committed = this.currentCameraSource(pixelRatio);
    if (!committed) return null;
    const width = Math.ceil(viewport.width * pixelRatio);
    const height = Math.ceil(viewport.height * pixelRatio);
    if (
      ![viewport.x, viewport.y, viewport.width, viewport.height].every(
        Number.isFinite,
      ) ||
      viewport.width <= 0 ||
      viewport.height <= 0 ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192
    )
      return null;
    const generation = ++this.generation;
    return {
      scene: {
        ...committed.scene,
        generation,
        viewport,
        width,
        height,
        clock: this.snapshotClock(viewport, false),
      },
      assets: [],
      revisions: new Map(this.assetRevisions),
      publication: { ...committed.publication, generation },
    };
  }

  private clearCameraSubmission(): void {
    if (this.cameraPublishTimer !== null) clearTimeout(this.cameraPublishTimer);
    this.cameraPublishTimer = null;
    this.cameraInFlightGeneration = null;
    this.cameraUpdatePending = false;
  }

  private armCameraPublishTimeout(generation: number): void {
    if (!this.visible) return;
    if (this.cameraPublishTimer !== null) clearTimeout(this.cameraPublishTimer);
    this.cameraPublishTimer = setTimeout(() => {
      if (this.cameraInFlightGeneration !== generation) return;
      this.clearCameraSubmission();
      this.onFailure(
        new NativeWorkerHostError(
          "worker-publish-timeout",
          "The native worker camera scene did not publish in time.",
        ),
      );
    }, 10_000);
  }

  private async updateLoop(): Promise<void> {
    if (this.disposed || this.updating) return;
    this.updating = true;
    try {
      while (
        this.dirty &&
        !this.disposed &&
        !this.capturingExport &&
        this.visible
      ) {
        this.dirty = false;
        try {
          await this.sendSnapshot();
        } catch (error) {
          this.assetRevisions.clear();
          this.onFailure(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    } finally {
      this.updating = false;
    }
  }

  private async captureSnapshot(options?: {
    pixelRatio: number;
    cropRect: { x: number; y: number; width: number; height: number };
    selectedRoots?: readonly Element[];
    signal?: AbortSignal;
  }): Promise<{
    scene: NativeWorkerScene;
    assets: ReturnType<NativeWorkerSourceSnapshot["finish"]>["assets"];
    revisions: Map<string, number>;
    publication: Publication;
  }> {
    if (!this.entries.length || this.disposed)
      throw new NativeSourceError(
        "worker-scene-unavailable",
        "The native worker scene is unavailable.",
      );
    const generation = ++this.generation;
    const rootWidth = innerWidth;
    const rootHeight = innerHeight;
    const body = document.body;
    if (
      [...body.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim(),
      ) ||
      [...body.children].some(
        (child) =>
          !(child instanceof HTMLElement || child instanceof SVGSVGElement),
      )
    )
      throw new NativeSourceError(
        "scene-direct-content-unsupported",
        "The native worker scene has direct body content it cannot present.",
      );
    if (scrollX !== 0 || scrollY !== 0)
      throw new NativeSourceError(
        "scene-scroll-unsupported",
        "The native worker scene requires a stable viewport origin.",
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
          "The native worker scene has an unsupported root background.",
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
        "The native worker scene cannot project a transformed or translucent body.",
      );
    const { viewport: previewViewport, pixelRatio: requestedPixelRatio } =
      this.sceneGeometry();
    const viewport = options?.cropRect ?? previewViewport;
    const pixelRatio = options?.pixelRatio ?? requestedPixelRatio;
    const width = Math.ceil(viewport.width * pixelRatio);
    const height = Math.ceil(viewport.height * pixelRatio);
    if (
      !Number.isFinite(pixelRatio) ||
      pixelRatio <= 0 ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192 ||
      width * height > 8192 * 8192
    )
      throw new NativeSourceError(
        "worker-viewport-budget-exceeded",
        "The requested native worker viewport exceeds its full-resolution budget.",
      );
    if (!options) {
      this.canvas.style.left = `${viewport.x}px`;
      this.canvas.style.top = `${viewport.y}px`;
      this.canvas.style.width = `${viewport.width}px`;
      this.canvas.style.height = `${viewport.height}px`;
    }
    this.provider.setDensity(pixelRatio);
    const snapshot = new NativeWorkerSourceSnapshot(
      this.worker.sceneId,
      generation,
      options ? new Map() : this.assetRevisions,
    );
    try {
      const targetSnapshots: NativeWorkerEffectTarget[] = [];
      const nativeOutputSizes = new Map<
        string,
        { width: number; height: number }
      >();
      const extents = new Map<string, NativeEffectExtentPlan>();
      const previousByTarget = new Map<Element, string>();
      for (const entry of this.entries) {
        const state = this.targets.get(entry.instance.id);
        if (!state || state.entry.target !== entry.target)
          throw new NativeSourceError(
            "worker-target-stale",
            "A native worker target changed during scene capture.",
          );
        const layout = this.layout(entry.target);
        const visible = entry.target.getBoundingClientRect();
        const displayScale = Math.max(
          visible.width / layout.width,
          visible.height / layout.height,
        );
        const targetPixelRatio = pixelRatio * displayScale;
        const geometry = nativeWorkerTargetGeometry(
          entry.target,
          targetPixelRatio,
          layout.width,
          layout.height,
        );
        const previousId = previousByTarget.get(entry.target);
        const previous = previousId ? extents.get(previousId) : undefined;
        const planned = planNativeChainedEffectExtent({
          extent: entry.definition.extent,
          captureInsets: previous
            ? undefined
            : nativeTargetOverflowInsets(
                entry.target,
                entry.instance.placement === "layer",
              ),
          placement: entry.instance.placement,
          clip: entry.instance.clip,
          cssWidth: layout.width,
          cssHeight: layout.height,
          pixelRatio: targetPixelRatio,
          maxDimension: 8192,
          maxPixels: 8192 * 8192,
          previous,
        });
        if (!planned.ok)
          throw new NativeSourceError(planned.code, planned.detail);
        const outputExtent = planned.plan;
        extents.set(entry.instance.id, outputExtent);
        if (
          entry.instance.placement === "fill" ||
          entry.instance.placement === "layer"
        )
          previousByTarget.set(entry.target, entry.instance.id);
        if (!options) {
          state.marker.width = outputExtent.width;
          state.marker.height = outputExtent.height;
        }
        const style = getComputedStyle(entry.target);
        if (outputExtent.expanded && !supportsNativeOutput2D(style))
          throw new NativeSourceError(
            "effect-output-transform-unsupported",
            "Expanded output cannot project a 3D or perspective transform.",
          );
        const positioned = planNativeOutputGeometry({
          offsetLeft: layout.offsetLeft,
          offsetTop: layout.offsetTop,
          width: layout.width,
          height: layout.height,
          extent: outputExtent,
          transformOrigin: layout.transformOrigin,
        });
        if (outputExtent.expanded && !positioned)
          throw new NativeSourceError(
            "effect-output-transform-unsupported",
            "Expanded output has an unsupported transform origin.",
          );
        if (!options) {
          state.marker.style.left = `${positioned?.left ?? layout.offsetLeft - outputExtent.left / targetPixelRatio}px`;
          state.marker.style.top = `${positioned?.top ?? layout.offsetTop - outputExtent.top / targetPixelRatio}px`;
          state.marker.style.width = `${positioned?.width ?? layout.width + (outputExtent.left + outputExtent.right) / targetPixelRatio}px`;
          state.marker.style.height = `${positioned?.height ?? layout.height + (outputExtent.top + outputExtent.bottom) / targetPixelRatio}px`;
          state.marker.style.transform = layout.transform;
          state.marker.style.transformOrigin =
            positioned?.transformOrigin ?? layout.transformOrigin;
          state.marker.style.translate = layout.translate;
          state.marker.style.rotate = layout.rotate;
          state.marker.style.scale = layout.scale;
        }
        state.provider.setDensity(targetPixelRatio);
        const targetSourceEpoch = state.provider.sourceEpoch?.();
        const targetAuthoredEpoch = state.provider.authoredSourceEpoch?.();
        if (
          !Number.isSafeInteger(targetSourceEpoch) ||
          !Number.isSafeInteger(targetAuthoredEpoch)
        )
          throw new NativeSourceError(
            "worker-target-epoch-unavailable",
            "The native effect target revision is unreadable.",
          );
        const rawSourceRecords =
          entry.instance.placement === "fill"
            ? []
            : await state.provider.readScene(undefined, "mount-source");
        if (
          state.provider.needsContinuousFrames() ||
          (entry.instance.placement !== "fill" &&
            (await state.provider.replaySafety(
              rawSourceRecords,
              "committed-native",
            )) === "dynamic")
        )
          throw new NativeSourceError(
            "worker-continuous-source-unsupported",
            "This native effect has a continuously changing authored source.",
          );
        const sourceRecords = await snapshot.records(
          `${options ? `export:${generation}:` : ""}target:${entry.instance.id}:provider:${state.captureScope}:epoch:${targetSourceEpoch}`,
          rawSourceRecords,
        );
        const receiver = await state.provider.readReceiverCoverage();
        const needsGeometry = entry.definition.passes.some((pass) =>
          pass.reads.includes("receiverGeometry"),
        );
        const needsInterior = entry.definition.passes.some((pass) =>
          pass.reads.includes("receiverInterior"),
        );
        const coverage = await snapshot.receiver(
          `${options ? `export:${generation}:` : ""}${entry.instance.id}:provider:${state.captureScope}:epoch:${targetSourceEpoch}`,
          receiver,
          needsGeometry,
          needsInterior && entry.target instanceof SVGSVGElement,
        );
        let cornerRadii: NativeWorkerEffectTarget["cornerRadii"];
        if (
          entry.instance.clip === "bounds" &&
          entry.target instanceof HTMLElement
        ) {
          const radius = resolveNativeClipRadii({
            width: outputExtent.sourceWidth,
            height: outputExtent.sourceHeight,
            cssPixelScale: targetPixelRatio,
            topLeft: style.borderTopLeftRadius,
            topRight: style.borderTopRightRadius,
            bottomRight: style.borderBottomRightRadius,
            bottomLeft: style.borderBottomLeftRadius,
          });
          if (!radius.ok)
            throw new NativeSourceError(
              radius.reason === "unreadable"
                ? "radius-unreadable"
                : "radius-unsupported",
              radius.detail,
            );
          cornerRadii = [
            radius.radii.topLeft.x,
            radius.radii.topLeft.y,
            radius.radii.topRight.x,
            radius.radii.topRight.y,
            radius.radii.bottomRight.x,
            radius.radii.bottomRight.y,
            radius.radii.bottomLeft.x,
            radius.radii.bottomLeft.y,
          ];
        }
        const fillPhases =
          entry.instance.placement === "fill"
            ? await this.fillPhases(
                snapshot,
                entry,
                state.provider,
                `${options ? `export:${generation}:` : ""}target:${entry.instance.id}:provider:${state.captureScope}:epoch:${targetSourceEpoch}`,
              )
            : undefined;
        const textMaskAssetId =
          entry.instance.clip === "text"
            ? await this.textMask(
                snapshot,
                entry,
                geometry.width,
                geometry.height,
                layout.width,
                targetSourceEpoch!,
                generation,
                !!options,
              )
            : undefined;
        let presentationExtent = outputExtent;
        if (fillPhases) {
          const presentation = planNativeFillPresentationExtent({
            fill: outputExtent,
            foreground: [
              ...fillPhases.foregroundRecords,
              ...fillPhases.outerShadowRecords,
              ...fillPhases.outlineRecords,
            ],
            maxDimension: 4096,
            maxPixels: 8_388_608,
          });
          if (!presentation.ok)
            throw new NativeSourceError(presentation.code, presentation.detail);
          const extent = presentation.plan;
          presentationExtent = extent;
          const placement = planNativeOutputGeometry({
            offsetLeft: layout.offsetLeft,
            offsetTop: layout.offsetTop,
            width: layout.width,
            height: layout.height,
            extent,
            transformOrigin: layout.transformOrigin,
          });
          if (extent.expanded && (!supportsNativeOutput2D(style) || !placement))
            throw new NativeSourceError(
              "effect-output-transform-unsupported",
              "Expanded Fill output cannot project its presentation geometry.",
            );
          if (!options) {
            state.marker.width = extent.width;
            state.marker.height = extent.height;
            state.marker.style.left = `${placement?.left ?? layout.offsetLeft - extent.left / targetPixelRatio}px`;
            state.marker.style.top = `${placement?.top ?? layout.offsetTop - extent.top / targetPixelRatio}px`;
            state.marker.style.width = `${placement?.width ?? layout.width + (extent.left + extent.right) / targetPixelRatio}px`;
            state.marker.style.height = `${placement?.height ?? layout.height + (extent.top + extent.bottom) / targetPixelRatio}px`;
            state.marker.style.transformOrigin =
              placement?.transformOrigin ?? layout.transformOrigin;
          }
        }
        nativeOutputSizes.set(entry.instance.id, {
          width: presentationExtent.width,
          height: presentationExtent.height,
        });
        if (state.provider.authoredSourceEpoch?.() !== targetAuthoredEpoch)
          throw new NativeSourceError(
            "worker-target-epoch-stale",
            "The native effect target changed during capture.",
          );
        targetSnapshots.push({
          instanceId: entry.instance.id,
          definitionHash: entry.definitionHash,
          ...geometry,
          width: outputExtent.width,
          height: outputExtent.height,
          outputExtent,
          pixelRatio: targetPixelRatio,
          sourceRecords,
          ...coverage,
          ...(cornerRadii ? { cornerRadii } : {}),
          ...(textMaskAssetId ? { textMaskAssetId } : {}),
          ...(fillPhases ? { fillPhases } : {}),
        });
      }
      for (const entry of this.entries) {
        if (entry.instance.placement !== "backdrop") continue;
        const owners = this.entries.filter(
          (candidate, index) =>
            (candidate.instance.placement === "layer" ||
              (candidate.instance.placement === "fill" &&
                this.entries.every(
                  (other, otherIndex) =>
                    otherIndex <= index ||
                    other.instance.placement !== "fill" ||
                    other.target !== candidate.target,
                ))) &&
            candidate.target !== entry.target &&
            candidate.target.contains(entry.target),
        );
        if (
          owners.filter((candidate) => candidate.instance.placement === "layer")
            .length > 1
        )
          throw new NativeSourceError(
            "source-group-local-chain-unsupported",
            "A nested Backdrop has multiple enclosing native Layers.",
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
            "A nested Backdrop has ambiguous native owners.",
          );
        const child = targetSnapshots.find(
          (target) => target.instanceId === entry.instance.id,
        );
        if (!child)
          throw new NativeSourceError(
            "worker-target-stale",
            "A Backdrop target changed during scene capture.",
          );
        if (nearest) child.groupLocalOwnerId = nearest.instance.id;
        if (!nearest || nearest.instance.placement !== "fill") continue;
        if (!(nearest.target instanceof HTMLElement))
          throw new NativeSourceError(
            "source-inline-svg",
            "An SVG Fill cannot contain a nested HTML Backdrop.",
          );
        const parent = targetSnapshots.find(
          (target) => target.instanceId === nearest.instance.id,
        );
        const childState = this.targets.get(entry.instance.id);
        if (
          !parent?.outputExtent ||
          !parent.fillPhases ||
          !child ||
          !childState
        )
          throw new NativeSourceError(
            "fill-prefix-unavailable",
            "The nested Fill prefix is unavailable.",
          );
        const presentation = planNativeFillPresentationExtent({
          fill: parent.outputExtent,
          foreground: [
            ...parent.fillPhases.foregroundRecords,
            ...parent.fillPhases.outerShadowRecords,
            ...parent.fillPhases.outlineRecords,
          ],
          maxDimension: 4096,
          maxPixels: 8_388_608,
        });
        if (!presentation.ok)
          throw new NativeSourceError(presentation.code, presentation.detail);
        const extent = presentation.plan;
        const authoredSourceEpoch = childState.provider.authoredSourceEpoch?.();
        if (!Number.isSafeInteger(authoredSourceEpoch))
          throw new NativeSourceError(
            "fill-prefix-stale",
            "The nested Fill source revision is unavailable.",
          );
        const records = await childState.provider.readScene(
          undefined,
          "mount-source",
          {
            ancestor: nearest.target,
            instanceId: nearest.instance.id,
            width: extent.width,
            height: extent.height,
            localBox: {
              x: -extent.left / extent.pixelRatio,
              y: -extent.top / extent.pixelRatio,
              width: extent.width / extent.pixelRatio,
              height: extent.height / extent.pixelRatio,
            },
            revision: generation,
            authoredSourceEpoch: authoredSourceEpoch!,
            unpublished:
              nearest.target.getAttribute("data-an-native-fill-instance") ===
              null,
          },
        );
        if (
          childState.provider.authoredSourceEpoch?.() !== authoredSourceEpoch ||
          records.filter(
            (record) =>
              record.sourceRole === "ancestor-fill-prefix" &&
              record.nativeInstanceId === nearest.instance.id,
          ).length !== 1 ||
          records.some(
            (record) =>
              record.sourceRole === "ancestor-fill-prefix" &&
              record.nativeInstanceId !== nearest.instance.id,
          )
        )
          throw new NativeSourceError(
            "fill-prefix-stale",
            "The nested Fill prefix changed during capture.",
          );
        child.fillLocalSourceRecords = await snapshot.records(
          `${options ? `export:${generation}:` : ""}fill-local:${entry.instance.id}:provider:${childState.captureScope}`,
          records,
        );
      }
      if (options)
        for (const target of targetSnapshots) {
          target.sourceRecords = nativeWorkerOutputRecords(
            target.sourceRecords,
            nativeOutputSizes,
          );
          if (target.fillLocalSourceRecords)
            target.fillLocalSourceRecords = nativeWorkerOutputRecords(
              target.fillLocalSourceRecords,
              nativeOutputSizes,
            );
          if (target.fillPhases)
            for (const key of Object.keys(target.fillPhases) as Array<
              keyof NonNullable<NativeWorkerEffectTarget["fillPhases"]>
            >)
              target.fillPhases[key] = nativeWorkerOutputRecords(
                target.fillPhases[key],
                nativeOutputSizes,
              );
        }
      const rawRootRecords = await this.provider.readScene(
        undefined,
        "scene-presentation",
      );
      if (
        this.provider.needsContinuousFrames() ||
        (await this.provider.replaySafety(
          rawRootRecords,
          "committed-native",
        )) === "dynamic"
      )
        throw new NativeSourceError(
          "worker-continuous-source-unsupported",
          "The authored scene has a continuously changing source.",
        );
      const sourceEpoch = this.provider.sourceEpoch?.();
      const authoredEpoch = this.provider.authoredSourceEpoch?.();
      if (
        !Number.isSafeInteger(sourceEpoch) ||
        !Number.isSafeInteger(authoredEpoch)
      )
        throw new NativeSourceError(
          "worker-source-epoch-unavailable",
          "The native worker source revision is unreadable.",
        );
      const finalRootRecords = options?.selectedRoots
        ? filterNativeExportSelection(
            rawRootRecords,
            options.selectedRoots,
            (instanceId) => {
              const target = this.targets.get(instanceId)?.entry.target;
              if (!target)
                throw new NativeSourceError(
                  "composition-selection-stale",
                  "A selected native effect target is unavailable.",
                );
              return target;
            },
          )
        : rawRootRecords;
      const allRootRecords = await snapshot.records(
        options
          ? `export:${generation}:root:epoch:${sourceEpoch}`
          : `root:epoch:${sourceEpoch}`,
        rawRootRecords,
      );
      const normalizedRootRecords = options
        ? nativeWorkerOutputRecords(allRootRecords, nativeOutputSizes)
        : allRootRecords;
      const selected = options?.selectedRoots
        ? new Set(finalRootRecords)
        : null;
      const records = selected
        ? normalizedRootRecords.filter((_, index) =>
            selected.has(rawRootRecords[index]!),
          )
        : normalizedRootRecords;
      const { assets, requiredAssets, revisions } = snapshot.finish();
      const scene: NativeWorkerScene = {
        sceneId: this.worker.sceneId,
        generation,
        sourceEpoch: sourceEpoch!,
        authoredEpoch: authoredEpoch!,
        viewport,
        width,
        height,
        pixelRatio,
        colorSpace: "srgb",
        clock: this.snapshotClock(viewport, !!options),
        requiredAssets,
        definitions: this.entries.map((entry) => entry.definition),
        instances: this.entries.map((entry) => entry.instance),
        targets: targetSnapshots,
        records,
        ...(selected ? { backdropRecords: normalizedRootRecords } : {}),
      };
      if (
        this.disposed ||
        this.provider.sourceEpoch?.() !== sourceEpoch ||
        this.provider.authoredSourceEpoch?.() !== authoredEpoch
      ) {
        for (const asset of assets)
          if (asset.kind === "bitmap") asset.bitmap.close();
        throw new NativeSourceError(
          "worker-source-epoch-stale",
          "The native worker source changed during scene capture.",
        );
      }
      const publication: Publication = {
        generation,
        sourceEpoch: sourceEpoch!,
        authoredEpoch: authoredEpoch!,
        rootWidth,
        rootHeight,
        targetEpochs: new Map(
          this.entries.map((entry) => {
            const provider = this.targets.get(entry.instance.id)?.provider;
            const source = provider?.sourceEpoch?.();
            const authored = provider?.authoredSourceEpoch?.();
            if (
              !Number.isSafeInteger(source) ||
              !Number.isSafeInteger(authored)
            )
              throw new NativeSourceError(
                "worker-target-epoch-unavailable",
                "The native effect target revision is unreadable.",
              );
            return [
              entry.instance.id,
              { source: source!, authored: authored! },
            ];
          }),
        ),
        rootRecords: rawRootRecords,
        payloads: new Map(
          this.entries.map((entry) => [
            entry.instance.id,
            {
              payload: JSON.stringify(entry.instance),
              definitionHash: entry.definitionHash,
            },
          ]),
        ),
      };
      if (options?.signal?.aborted) throw options.signal.reason;
      return { scene, assets, revisions, publication };
    } catch (error) {
      snapshot.dispose();
      throw error;
    }
  }

  private async sendSnapshot(): Promise<void> {
    if (this.cameraInFlightGeneration !== null) {
      const { pixelRatio } = this.sceneGeometry();
      if (this.currentCameraSource(pixelRatio)) {
        this.cameraUpdatePending = true;
        return;
      }
      this.clearCameraSubmission();
    }
    const cameraSnapshot = this.reprojectSnapshot();
    const { scene, assets, revisions, publication } =
      cameraSnapshot ?? (await this.captureSnapshot());
    const generation = scene.generation;
    if (cameraSnapshot) {
      this.cameraInFlightGeneration = generation;
      this.armCameraPublishTimeout(generation);
    }
    this.staged.set(generation, publication);
    this.lastScene = scene;
    this.scenes.set(generation, scene);
    this.pendingAssetRevisions.set(generation, revisions);
    for (const pendingGeneration of this.staged.keys())
      if (pendingGeneration < generation) this.staged.delete(pendingGeneration);
    for (const pendingGeneration of this.scenes.keys())
      if (pendingGeneration < generation) this.scenes.delete(pendingGeneration);
    try {
      await this.worker.sendScene(
        scene,
        assets,
        cameraSnapshot ? { retainActiveCommitsWhileStaged: true } : undefined,
      );
    } catch (error) {
      if (this.cameraInFlightGeneration === generation)
        this.clearCameraSubmission();
      this.pendingAssetRevisions.delete(generation);
      this.scenes.delete(generation);
      this.staged.delete(generation);
      for (const asset of assets)
        if (asset.kind === "bitmap") asset.bitmap.close();
      throw error;
    }
  }

  private async fillPhases(
    snapshot: NativeWorkerSourceSnapshot,
    entry: NativeWorkerSceneEntry,
    provider: NativeSceneProvider,
    scopePrefix: string,
  ): Promise<NonNullable<NativeWorkerEffectTarget["fillPhases"]>> {
    const authored = readNativeAuthoredPaint(entry.target);
    const paint = {
      color: authored.backgroundColor,
      image: authored.backgroundImage,
      borderTopColor: authored.borderTopColor,
      borderRightColor: authored.borderRightColor,
      borderBottomColor: authored.borderBottomColor,
      borderLeftColor: authored.borderLeftColor,
      borderImageSource: authored.borderImageSource,
    };
    const read = async (
      name: string,
      records: Promise<NativeSourceRecord[]>,
    ): Promise<NativeWorkerSourceRecord[]> =>
      snapshot.records(`${scopePrefix}:${name}`, await records);
    return {
      backgroundRecords: await read(
        "background",
        provider.readFillBoxPhase(paint, "background"),
      ),
      borderRecords: await read(
        "border",
        provider.readFillBoxPhase(paint, "border"),
      ),
      outerCoverageRecords: await read(
        "outer-coverage",
        provider.readFillBoxPhase(paint, "coverage"),
      ),
      innerCoverageRecords: await read(
        "inner-coverage",
        provider.readFillBoxPhase(paint, "inner-coverage"),
      ),
      glyphRecords: provider.hasFillGlyph()
        ? await read("glyph", provider.readFillGlyph())
        : [],
      insetShadowRecords: await read(
        "inset-shadow",
        provider.readFillOwnPaintPhase("inset-shadow"),
      ),
      outerShadowRecords: await read(
        "outer-shadow",
        provider.readFillOwnPaintPhase("outer-shadow"),
      ),
      outlineRecords: await read(
        "outline",
        provider.readFillOwnPaintPhase("outline"),
      ),
      foregroundRecords: await read(
        "foreground",
        provider.readFillForeground(),
      ),
    };
  }

  private async textMask(
    snapshot: NativeWorkerSourceSnapshot,
    entry: NativeWorkerSceneEntry,
    width: number,
    height: number,
    cssWidth: number,
    sourceEpoch: number,
    generation: number,
    isExport: boolean,
  ): Promise<string> {
    if (!(entry.target instanceof HTMLElement))
      throw new NativeSourceError(
        "source-inline-svg",
        "An SVG Fill uses vector coverage rather than a text mask.",
      );
    const clone = cloneNativeTextFlow(entry.target);
    const computed = getComputedStyle(entry.target);
    const documentFont = nativeTextFlowUsesDocumentFont(entry.target);
    const signature = [
      width,
      height,
      clone.innerHTML,
      computed.font,
      computed.letterSpacing,
      computed.lineHeight,
      computed.textAlign,
      computed.whiteSpace,
      computed.textTransform,
      computed.padding,
      document.fonts?.status,
      documentFont,
    ].join("|");
    let cached = this.textMasks.get(entry.instance.id);
    if (!cached || cached.signature !== signature || isExport) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      if (documentFont) await paintNativeTextFlow(entry.target, canvas, true);
      else {
        const dpr = width / Math.max(1, cssWidth);
        const serialized = new XMLSerializer().serializeToString(clone);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${cssWidth}px;height:${height / dpr}px;transform:scale(${dpr});transform-origin:0 0">${serialized}</div></foreignObject></svg>`;
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
      cached = { signature, canvas };
      if (!isExport) this.textMasks.set(entry.instance.id, cached);
    }
    const assetId = `${isExport ? `export:${generation}:` : ""}text-mask:${entry.instance.id}:epoch:${sourceEpoch}:size:${width}x${height}`;
    return snapshot.bitmap(assetId, 1, cached.canvas, width, height);
  }

  private publish(message: {
    generation: number;
    sourceEpoch: number;
    timeSeconds: number;
    presentedAtMs: number;
    committedInstances?: readonly {
      instanceId: string;
      definitionHash: string;
      payload: string;
      localTime: number;
    }[];
  }): void {
    if (Number.isFinite(message.presentedAtMs)) {
      this.committedFrameTimes.push(message.presentedAtMs);
      if (this.committedFrameTimes.length > 1800)
        this.committedFrameTimes.splice(
          0,
          this.committedFrameTimes.length - 1800,
        );
    }
    if (this.committed?.generation === message.generation) return;
    if (!message.committedInstances) {
      this.onFailure(
        new NativeWorkerHostError(
          "worker-commit-provenance-missing",
          "The first worker scene frame omitted its effect provenance.",
        ),
      );
      return;
    }
    const publication = this.staged.get(message.generation);
    if (
      !publication ||
      publication.sourceEpoch !== message.sourceEpoch ||
      this.provider.sourceEpoch?.() !== publication.sourceEpoch ||
      this.provider.authoredSourceEpoch?.() !== publication.authoredEpoch ||
      publication.payloads.size !== message.committedInstances.length ||
      message.committedInstances.some((instance) => {
        const expected = publication.payloads.get(instance.instanceId);
        return (
          !expected ||
          expected.payload !== instance.payload ||
          expected.definitionHash !== instance.definitionHash
        );
      })
    ) {
      if (this.cameraInFlightGeneration === message.generation)
        this.clearCameraSubmission();
      this.requestUpdate();
      return;
    }
    const body = document.body;
    const paintedChildren = new Set<Element>();
    for (const record of publication.rootRecords) {
      const root = scenePaintRoot(record.node, body);
      if (root && root !== this.canvas && !root.matches(OMIT_SCENE_CHILD))
        paintedChildren.add(root);
    }
    const authoredOpacities = new Map<Element, string>();
    for (const child of paintedChildren) {
      const opacity =
        child.getAttribute("data-an-native-authored-opacity") ??
        getComputedStyle(child).opacity;
      const value = Number(opacity);
      if (
        !opacity.trim() ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1
      ) {
        this.onFailure(
          new NativeSourceError(
            "worker-scene-opacity-unreadable",
            "The native worker scene has unreadable authored opacity.",
          ),
        );
        return;
      }
      authoredOpacities.set(child, opacity);
    }
    for (const old of this.suppressed) {
      if (paintedChildren.has(old)) continue;
      old.removeAttribute("data-an-native-scene-suppressed");
      old.removeAttribute("data-an-native-authored-opacity");
      this.suppressed.delete(old);
    }
    for (const child of paintedChildren) {
      if (!child.hasAttribute("data-an-native-authored-opacity")) {
        child.setAttribute(
          "data-an-native-authored-opacity",
          authoredOpacities.get(child)!,
        );
      }
      child.setAttribute("data-an-native-scene-suppressed", "");
      this.suppressed.add(child);
    }
    const presentedScene = this.scenes.get(publication.generation);
    if (presentedScene) {
      this.canvas.style.left = `${presentedScene.viewport.x}px`;
      this.canvas.style.top = `${presentedScene.viewport.y}px`;
      this.canvas.style.width = `${presentedScene.viewport.width}px`;
      this.canvas.style.height = `${presentedScene.viewport.height}px`;
    }
    this.canvas.style.visibility = "visible";
    document.documentElement.setAttribute("data-an-native-scene-managed", "");
    this.committed = publication;
    this.committedSceneSnapshot =
      this.scenes.get(publication.generation) ?? null;
    const drainCamera =
      this.cameraInFlightGeneration === publication.generation &&
      this.cameraUpdatePending;
    if (this.cameraInFlightGeneration === publication.generation)
      this.clearCameraSubmission();
    for (const entry of this.entries) {
      entry.target.setAttribute("data-an-native-status", "ready");
      entry.target.setAttribute("data-an-native-backend", "webgpu-worker");
      entry.target.removeAttribute("data-an-native-error");
      entry.target.removeAttribute("data-an-native-error-message");
    }
    for (const generation of this.staged.keys())
      if (generation <= publication.generation) this.staged.delete(generation);
    for (const generation of this.scenes.keys())
      if (generation < publication.generation) this.scenes.delete(generation);
    this.onCommitted(publication, {
      timeSeconds: message.timeSeconds,
      committedInstances: message.committedInstances,
    });
    if (drainCamera) this.requestUpdate();
    for (const waiter of this.publicationWaiters) {
      const expected = publication.payloads.get(waiter.instanceId);
      const committedScene = this.committedSceneSnapshot;
      if (
        publication.generation < waiter.minimumGeneration ||
        expected?.payload !== waiter.payload ||
        expected.definitionHash !== waiter.definitionHash ||
        (waiter.expectedTimeSeconds !== null &&
          (committedScene?.clock.timeSeconds !== waiter.expectedTimeSeconds ||
            message.timeSeconds !== waiter.expectedTimeSeconds))
      )
        continue;
      clearTimeout(waiter.timer);
      this.publicationWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  committedScene(): {
    scene: NativeWorkerScene;
    publication: Publication;
  } | null {
    if (!this.committed || !this.committedSceneSnapshot) return null;
    return { scene: this.committedSceneSnapshot, publication: this.committed };
  }

  workerCadenceTimes(): readonly number[] {
    return [...this.committedFrameTimes];
  }

  holdLastFrame(): void {
    if (this.disposed || this.holdingLastFrame) return;
    this.holdingLastFrame = true;
    this.clearCameraSubmission();
    window.removeEventListener("scroll", this.requestUpdate, true);
    window.removeEventListener("resize", this.requestUpdate);
    this.worker.dispose();
    this.provider.dispose();
    for (const state of this.targets.values()) {
      state.provider.dispose();
      state.marker.remove();
    }
  }

  async captureExportScene(options: {
    pixelRatio: number;
    cropRect: { x: number; y: number; width: number; height: number };
    timeSeconds: number;
    selectedRoots?: readonly Element[];
    selectedNodeIds?: readonly string[];
    regionExport: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<
    Extract<
      import("./native-worker-protocol").NativeWorkerFromGpu,
      { type: "exported" }
    > & { previewGeneration: number | null }
  > {
    if (this.preparingExport || this.capturingExport)
      throw new NativeWorkerHostError(
        "composition-busy",
        "A native worker still is already being captured.",
      );
    this.preparingExport = true;
    const deadline = performance.now() + options.timeoutMs;
    const hiddenExport = !this.visible;
    const hiddenAuthoredEpoch = hiddenExport
      ? this.provider.authoredSourceEpoch?.()
      : null;
    const hiddenPayloads = hiddenExport
      ? this.entries.map((entry) => ({
          id: entry.instance.id,
          payload: JSON.stringify(entry.instance),
          definitionHash: entry.definitionHash,
        }))
      : [];
    let assets: ReturnType<NativeWorkerSourceSnapshot["finish"]>["assets"] = [];
    try {
      let committed: ReturnType<NativeWorkerSceneHost["committedScene"]> = null;
      let requestedRevision = "";
      while (!hiddenExport || this.updating) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (this.disposed)
          throw new NativeWorkerHostError(
            "worker-scene-unavailable",
            "The native worker scene is unavailable.",
          );
        const sourceEpoch = this.provider.sourceEpoch?.();
        const authoredEpoch = this.provider.authoredSourceEpoch?.();
        const candidate = this.committedScene();
        if (
          candidate &&
          !this.dirty &&
          !this.updating &&
          this.lastScene?.generation === candidate.scene.generation &&
          sourceEpoch === candidate.scene.sourceEpoch &&
          authoredEpoch === candidate.scene.authoredEpoch
        ) {
          committed = candidate;
          break;
        }
        const revision = `${sourceEpoch}:${authoredEpoch}`;
        if (
          !this.dirty &&
          !this.updating &&
          this.lastScene?.sourceEpoch !== sourceEpoch &&
          requestedRevision !== revision
        ) {
          requestedRevision = revision;
          this.requestUpdate();
        }
        if (performance.now() >= deadline)
          throw new NativeSourceError(
            "composition-timeout",
            "The current native worker preview did not settle before still capture.",
          );
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      this.capturingExport = true;
      this.preparingExport = false;
      if (options.signal?.aborted) throw options.signal.reason;
      const restoreRegionScope = options.regionExport
        ? beginNativeRegionExport(document.documentElement)
        : undefined;
      let captured: Awaited<
        ReturnType<NativeWorkerSceneHost["captureSnapshot"]>
      >;
      try {
        captured = await this.captureSnapshot(options);
      } finally {
        restoreRegionScope?.();
      }
      assets = captured.assets;
      const { scene } = captured;
      const hiddenSourceStillCurrent = (): boolean =>
        scene.authoredEpoch === hiddenAuthoredEpoch &&
        this.provider.sourceEpoch?.() === scene.sourceEpoch &&
        this.provider.authoredSourceEpoch?.() === hiddenAuthoredEpoch &&
        scene.instances.length === hiddenPayloads.length &&
        scene.targets.length === hiddenPayloads.length &&
        !hiddenPayloads.some((expected, index) => {
          const entry = this.entries[index];
          const target = scene.targets[index];
          const instance = scene.instances[index];
          const provider = this.targets.get(expected.id)?.provider;
          const capturedEpoch = captured.publication.targetEpochs.get(
            expected.id,
          );
          return (
            !entry ||
            !target ||
            !instance ||
            instance.id !== expected.id ||
            target.instanceId !== expected.id ||
            JSON.stringify(instance) !== expected.payload ||
            JSON.stringify(entry.instance) !== expected.payload ||
            target.definitionHash !== expected.definitionHash ||
            entry.definitionHash !== expected.definitionHash ||
            !capturedEpoch ||
            provider?.sourceEpoch?.() !== capturedEpoch.source ||
            provider.authoredSourceEpoch?.() !== capturedEpoch.authored
          );
        });
      if (hiddenExport) {
        if (!hiddenSourceStillCurrent())
          throw new NativeSourceError(
            "composition-preview-stale",
            "The hidden native worker source changed during still capture.",
          );
      } else {
        const committedHashes = new Map(
          committed!.scene.targets.map((target) => [
            target.instanceId,
            target.definitionHash,
          ]),
        );
        if (
          scene.authoredEpoch !== committed!.scene.authoredEpoch ||
          JSON.stringify(scene.instances) !==
            JSON.stringify(committed!.scene.instances) ||
          scene.targets.length !== committed!.scene.targets.length ||
          scene.targets.some(
            (target) =>
              committedHashes.get(target.instanceId) !== target.definitionHash,
          )
        )
          throw new NativeSourceError(
            "composition-preview-stale",
            "The worker preview has not committed the current authored scene.",
          );
      }
      if (options.signal?.aborted) throw options.signal.reason;
      const exported = await this.worker.exportScene(scene, assets, {
        cropRect: options.cropRect,
        pixelRatio: options.pixelRatio,
        timeSeconds: options.timeSeconds,
        selectedNodeIds: options.selectedNodeIds,
        selectionFiltered: !!options.selectedRoots,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      if (hiddenExport && !hiddenSourceStillCurrent())
        throw new NativeSourceError(
          "composition-preview-stale",
          "The hidden native worker source changed during still capture.",
        );
      if (
        this.provider.sourceEpoch?.() !== scene.sourceEpoch ||
        this.provider.authoredSourceEpoch?.() !== scene.authoredEpoch
      )
        throw new NativeSourceError(
          "composition-source-changed",
          "The authored scene changed during native still capture.",
        );
      return {
        ...exported,
        previewGeneration: hiddenExport ? null : committed!.scene.generation,
      };
    } finally {
      for (const asset of assets)
        if (asset.kind === "bitmap") asset.bitmap.close();
      this.preparingExport = false;
      this.capturingExport = false;
      this.requestUpdate();
    }
  }

  dispose(options?: { preservePresentationState?: boolean }): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearCameraSubmission();
    for (const waiter of this.publicationWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new NativeWorkerHostError(
          "worker-disposed",
          "The native worker scene was disposed.",
        ),
      );
    }
    this.publicationWaiters.clear();
    window.removeEventListener("scroll", this.requestUpdate, true);
    window.removeEventListener("resize", this.requestUpdate);
    this.worker.dispose();
    this.provider.dispose();
    for (const state of this.targets.values()) {
      state.provider.dispose();
      state.marker.remove();
      if (!options?.preservePresentationState) {
        state.entry.target.removeAttribute("data-an-native-fill-instance");
        state.entry.target.removeAttribute("data-an-native-layer-instance");
        state.entry.target.removeAttribute("data-an-native-backend");
      }
    }
    this.targets.clear();
    if (!options?.preservePresentationState)
      for (const child of this.suppressed) {
        child.removeAttribute("data-an-native-scene-suppressed");
        child.removeAttribute("data-an-native-authored-opacity");
      }
    this.suppressed.clear();
    if (!options?.preservePresentationState)
      document.documentElement.removeAttribute("data-an-native-scene-managed");
    this.canvas.remove();
  }
}
