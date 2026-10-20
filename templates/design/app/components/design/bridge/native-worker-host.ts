import {
  acquireNativeWorkerLease,
  isNativeWorkerBrokerError,
  type NativeWorkerLease,
} from "./native-worker-broker";
import type {
  NativeWorkerAsset,
  NativeWorkerFromGpu,
  NativeWorkerScene,
  NativeWorkerToGpu,
} from "./native-worker-protocol";
import { NATIVE_WORKER_PROTOCOL_VERSION } from "./native-worker-protocol";

export class NativeWorkerHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeWorkerHostError";
  }
}

type ExportRequest = Extract<NativeWorkerToGpu, { type: "export" }>;
type ExportedFrame = Extract<NativeWorkerFromGpu, { type: "exported" }>;

type PendingExport = {
  generation: number;
  sourceEpoch: number;
  resolve: (frame: ExportedFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};

export class NativeWorkerHost {
  private readonly lease: NativeWorkerLease;
  private readonly pendingExports = new Map<string, PendingExport>();
  private nextRequest = 0;
  private activeScene: NativeWorkerScene | null = null;
  private stagedScene: NativeWorkerScene | null = null;
  private retainActiveCommitsWhileStaged = false;
  private visible = true;
  private disposed = false;
  private ready = false;
  private readonly initTimer: ReturnType<typeof setTimeout>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  readonly readyPromise: Promise<void>;
  private readonly onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) this.dispose();
  };

  constructor(
    workerSource: string,
    readonly sceneId: string,
    canvas: HTMLCanvasElement,
    private readonly onCommitted: (
      message: Extract<NativeWorkerFromGpu, { type: "committed" }>,
    ) => void,
    private readonly onFailure: (error: NativeWorkerHostError) => void,
    private readonly onStaged?: (
      message: Extract<NativeWorkerFromGpu, { type: "scene-staged" }>,
    ) => void,
  ) {
    if (!workerSource.trim())
      throw new NativeWorkerHostError(
        "worker-source-empty",
        "The native GPU worker bundle is empty.",
      );
    if (!canvas.transferControlToOffscreen)
      throw new NativeWorkerHostError(
        "worker-unavailable",
        "The native GPU worker requires OffscreenCanvas support.",
      );
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.readyPromise.catch(() => {});
    try {
      this.lease = acquireNativeWorkerLease(workerSource, sceneId, {
        message: (message) => {
          try {
            this.receive(message);
          } catch (error) {
            this.onFailure(
              new NativeWorkerHostError(
                "worker-message-failed",
                `The native GPU worker response could not be handled: ${String(error)}`,
              ),
            );
          }
        },
        failure: (code, message) => {
          this.fail(new NativeWorkerHostError(code, message));
        },
      });
    } catch (error) {
      if (isNativeWorkerBrokerError(error))
        throw new NativeWorkerHostError(error.code, error.message);
      throw new NativeWorkerHostError(
        "worker-start-failed",
        `The native GPU worker could not start: ${String(error)}`,
      );
    }
    this.initTimer = setTimeout(() => {
      this.fail(
        new NativeWorkerHostError(
          "worker-init-timeout",
          "The native GPU worker did not become ready in time.",
        ),
      );
    }, 10_000);
    try {
      const offscreen = canvas.transferControlToOffscreen();
      this.post(
        {
          type: "init",
          protocol: NATIVE_WORKER_PROTOCOL_VERSION,
          sceneId,
          canvas: offscreen,
        },
        [offscreen],
      );
      window.addEventListener("pagehide", this.onPageHide);
    } catch (error) {
      this.dispose();
      if (error instanceof NativeWorkerHostError) throw error;
      throw new NativeWorkerHostError(
        "worker-transfer-failed",
        `The native canvas could not transfer to its GPU worker: ${String(error)}`,
      );
    }
  }

  private post(
    message: NativeWorkerToGpu,
    transfer: Transferable[] = [],
  ): void {
    if (this.disposed)
      throw new NativeWorkerHostError(
        "worker-disposed",
        "The native GPU worker has been disposed.",
      );
    try {
      this.lease.post(message, transfer);
    } catch (error) {
      if (isNativeWorkerBrokerError(error))
        throw new NativeWorkerHostError(error.code, error.message);
      throw error;
    }
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (this.ready)
      this.post({ type: "visibility", sceneId: this.sceneId, visible });
  }

  private receive(message: NativeWorkerFromGpu): void {
    if (this.disposed || message.sceneId !== this.sceneId) return;
    if (message.type === "ready") {
      if (message.protocol !== NATIVE_WORKER_PROTOCOL_VERSION) {
        this.fail(
          new NativeWorkerHostError(
            "worker-protocol-mismatch",
            "The native GPU worker uses a different protocol version.",
          ),
        );
        return;
      }
      if (!this.ready) {
        clearTimeout(this.initTimer);
        if (!this.visible)
          try {
            this.post({
              type: "visibility",
              sceneId: this.sceneId,
              visible: false,
            });
          } catch (error) {
            this.fail(
              new NativeWorkerHostError(
                "worker-visibility-failed",
                `The native GPU worker visibility could not be set: ${String(error)}`,
              ),
            );
            return;
          }
        this.ready = true;
        this.resolveReady();
      }
      return;
    }
    if (message.type === "error") {
      const error = new NativeWorkerHostError(message.code, message.message);
      if (!this.ready) {
        this.fail(error);
        return;
      }
      if (message.requestId) {
        const request = this.pendingExports.get(message.requestId);
        if (request) {
          this.finishExport(message.requestId);
          request.reject(error);
        }
      } else {
        if (message.generation === this.stagedScene?.generation) {
          this.stagedScene = null;
          this.retainActiveCommitsWhileStaged = false;
        }
        this.onFailure(error);
      }
      return;
    }
    if (message.type === "scene-staged") {
      if (message.generation === this.stagedScene?.generation)
        this.onStaged?.(message);
      return;
    }
    if (message.type === "exported") {
      const request = this.pendingExports.get(message.requestId);
      if (!request) return;
      this.finishExport(message.requestId);
      if (
        message.generation !== request.generation ||
        message.sourceEpoch !== request.sourceEpoch
      ) {
        request.reject(
          new NativeWorkerHostError(
            "worker-export-stale",
            "The native GPU worker returned a different still scene.",
          ),
        );
      } else request.resolve(message);
      return;
    }
    const stagedCommit =
      message.generation === this.stagedScene?.generation &&
      message.sourceEpoch === this.stagedScene.sourceEpoch;
    const activeCommit =
      (this.stagedScene === null || this.retainActiveCommitsWhileStaged) &&
      message.generation === this.activeScene?.generation &&
      message.sourceEpoch === this.activeScene.sourceEpoch;
    if (!stagedCommit && !activeCommit) return;
    if (message.type === "committed") {
      if (stagedCommit) {
        this.activeScene = this.stagedScene;
        this.stagedScene = null;
        this.retainActiveCommitsWhileStaged = false;
      }
      this.onCommitted(message);
      return;
    }
  }

  private finishExport(requestId: string): void {
    const request = this.pendingExports.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    if (request.abort && request.signal)
      request.signal.removeEventListener("abort", request.abort);
    this.pendingExports.delete(requestId);
  }

  private fail(error: NativeWorkerHostError): void {
    if (this.disposed) return;
    if (!this.ready) this.rejectReady(error);
    try {
      this.onFailure(error);
    } finally {
      this.dispose();
    }
  }

  async sendScene(
    scene: NativeWorkerScene,
    assets: NativeWorkerAsset[],
    options?: { retainActiveCommitsWhileStaged?: boolean },
  ): Promise<void> {
    await this.readyPromise;
    if (scene.sceneId !== this.sceneId)
      throw new NativeWorkerHostError(
        "worker-scene-mismatch",
        "The native GPU scene belongs to a different worker.",
      );
    if (
      scene.generation <=
      Math.max(
        this.activeScene?.generation ?? 0,
        this.stagedScene?.generation ?? 0,
      )
    )
      throw new NativeWorkerHostError(
        "worker-scene-stale",
        "The native GPU scene generation must increase.",
      );
    for (const asset of assets)
      if (
        asset.sceneId !== scene.sceneId ||
        asset.generation !== scene.generation
      )
        throw new NativeWorkerHostError(
          "worker-asset-mismatch",
          "A native source asset does not belong to its scene generation.",
        );
    const active = this.activeScene;
    const retainActiveCommits =
      options?.retainActiveCommitsWhileStaged === true;
    if (
      retainActiveCommits &&
      (!active ||
        assets.length !== 0 ||
        scene.sourceEpoch !== active.sourceEpoch ||
        scene.authoredEpoch !== active.authoredEpoch ||
        scene.pixelRatio !== active.pixelRatio ||
        scene.colorSpace !== active.colorSpace ||
        scene.frameRateTarget !== active.frameRateTarget ||
        scene.requiredAssets !== active.requiredAssets ||
        scene.definitions !== active.definitions ||
        scene.instances !== active.instances ||
        scene.targets !== active.targets ||
        scene.records !== active.records ||
        scene.backdropRecords !== active.backdropRecords)
    )
      throw new NativeWorkerHostError(
        "worker-camera-incompatible",
        "The pending camera scene does not retain the active native content.",
      );
    for (const [requestId, request] of this.pendingExports) {
      this.finishExport(requestId);
      request.reject(
        new NativeWorkerHostError(
          "composition-source-changed",
          "The native scene changed during still capture.",
        ),
      );
    }
    try {
      for (const asset of assets)
        this.post(
          { type: "asset", ...asset },
          asset.kind === "bitmap" ? [asset.bitmap] : [asset.data],
        );
      this.post({ type: "scene", scene });
      this.stagedScene = scene;
      this.retainActiveCommitsWhileStaged = retainActiveCommits;
    } catch (error) {
      this.stagedScene = null;
      this.retainActiveCommitsWhileStaged = false;
      if (error instanceof NativeWorkerHostError) throw error;
      throw new NativeWorkerHostError(
        "worker-scene-send-failed",
        `The native GPU scene could not be sent: ${String(error)}`,
      );
    }
  }

  async exportFrame(
    options: Omit<ExportRequest, "type" | "sceneId" | "requestId"> & {
      timeoutMs: number;
      signal?: AbortSignal;
    },
  ): Promise<ExportedFrame> {
    await this.readyPromise;
    const scene = this.activeScene;
    if (
      this.stagedScene ||
      !scene ||
      scene.generation !== options.generation ||
      scene.sourceEpoch !== options.sourceEpoch
    )
      throw new NativeWorkerHostError(
        "composition-preview-stale",
        "The native GPU scene changed before still capture.",
      );
    if (options.signal?.aborted)
      throw new NativeWorkerHostError(
        "composition-aborted",
        "The native still capture was cancelled.",
      );
    const requestId = `${this.sceneId}:${++this.nextRequest}`;
    return new Promise<ExportedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finishExport(requestId);
        this.cancelExport(requestId);
        reject(
          new NativeWorkerHostError(
            "composition-timeout",
            "The native GPU worker did not finish still capture in time.",
          ),
        );
      }, options.timeoutMs);
      const abort = () => {
        this.finishExport(requestId);
        this.cancelExport(requestId);
        reject(
          new NativeWorkerHostError(
            "composition-aborted",
            "The native still capture was cancelled.",
          ),
        );
      };
      this.pendingExports.set(requestId, {
        generation: options.generation,
        sourceEpoch: options.sourceEpoch,
        resolve,
        reject,
        timer,
        signal: options.signal,
        abort,
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        this.post({
          type: "export",
          sceneId: this.sceneId,
          requestId,
          generation: options.generation,
          sourceEpoch: options.sourceEpoch,
          timeSeconds: options.timeSeconds,
          selectedInstanceIds: options.selectedInstanceIds,
          cropRect: options.cropRect,
          pixelRatio: options.pixelRatio,
        });
      } catch (error) {
        this.finishExport(requestId);
        if (error instanceof NativeWorkerHostError) {
          reject(error);
          return;
        }
        reject(
          new NativeWorkerHostError(
            "worker-export-send-failed",
            `The native GPU still request could not be sent: ${String(error)}`,
          ),
        );
      }
    });
  }

  private cancelExport(requestId: string): void {
    if (this.disposed) return;
    try {
      this.post({ type: "cancel-export", sceneId: this.sceneId, requestId });
    } catch (error) {
      this.onFailure(
        error instanceof NativeWorkerHostError
          ? error
          : new NativeWorkerHostError(
              "worker-cancel-send-failed",
              `The native GPU still cancellation could not be sent: ${String(error)}`,
            ),
      );
    }
  }

  async exportScene(
    scene: NativeWorkerScene,
    assets: NativeWorkerAsset[],
    options: {
      cropRect: { x: number; y: number; width: number; height: number };
      pixelRatio: number;
      timeSeconds: number;
      selectedNodeIds?: readonly string[];
      selectionFiltered: boolean;
      timeoutMs: number;
      signal?: AbortSignal;
    },
  ): Promise<ExportedFrame> {
    await this.readyPromise;
    if (scene.sceneId !== this.sceneId)
      throw new NativeWorkerHostError(
        "worker-scene-mismatch",
        "The native GPU still scene belongs to a different worker.",
      );
    if (options.signal?.aborted)
      throw new NativeWorkerHostError(
        "composition-aborted",
        "The native still capture was cancelled.",
      );
    for (const asset of assets)
      if (
        asset.sceneId !== scene.sceneId ||
        asset.generation !== scene.generation
      )
        throw new NativeWorkerHostError(
          "worker-asset-mismatch",
          "A native still asset does not belong to its scene generation.",
        );
    const requestId = `${this.sceneId}:export:${++this.nextRequest}`;
    return new Promise<ExportedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finishExport(requestId);
        this.cancelExport(requestId);
        reject(
          new NativeWorkerHostError(
            "composition-timeout",
            "The native GPU worker did not finish still capture in time.",
          ),
        );
      }, options.timeoutMs);
      const abort = () => {
        this.finishExport(requestId);
        this.cancelExport(requestId);
        reject(
          new NativeWorkerHostError(
            "composition-aborted",
            "The native still capture was cancelled.",
          ),
        );
      };
      this.pendingExports.set(requestId, {
        generation: scene.generation,
        sourceEpoch: scene.sourceEpoch,
        resolve,
        reject,
        timer,
        signal: options.signal,
        abort,
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        for (const asset of assets)
          this.post(
            { type: "asset", ...asset },
            asset.kind === "bitmap" ? [asset.bitmap] : [asset.data],
          );
        this.post({
          type: "export-scene",
          sceneId: this.sceneId,
          requestId,
          scene,
          timeSeconds: options.timeSeconds,
          selectionFiltered: options.selectionFiltered,
          selectedNodeIds: options.selectedNodeIds,
          cropRect: options.cropRect,
          pixelRatio: options.pixelRatio,
        });
      } catch (error) {
        this.finishExport(requestId);
        if (error instanceof NativeWorkerHostError) {
          reject(error);
          return;
        }
        reject(
          new NativeWorkerHostError(
            "worker-export-send-failed",
            `The native GPU still scene could not be sent: ${String(error)}`,
          ),
        );
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    let sendFailure: NativeWorkerHostError | null = null;
    try {
      this.post({ type: "dispose", sceneId: this.sceneId });
    } catch (error) {
      if (
        !(error instanceof NativeWorkerHostError) ||
        error.code !== "worker-disposed"
      )
        sendFailure = new NativeWorkerHostError(
          "worker-dispose-send-failed",
          `The native GPU worker could not receive disposal: ${String(error)}`,
        );
    } finally {
      this.disposed = true;
      this.retainActiveCommitsWhileStaged = false;
      window.removeEventListener("pagehide", this.onPageHide);
      clearTimeout(this.initTimer);
      if (!this.ready)
        this.rejectReady(
          new NativeWorkerHostError(
            "worker-disposed",
            "The native GPU worker was disposed before it became ready.",
          ),
        );
      for (const [requestId, request] of this.pendingExports) {
        this.finishExport(requestId);
        request.reject(
          new NativeWorkerHostError(
            "worker-disposed",
            "The native GPU worker was disposed during still capture.",
          ),
        );
      }
      this.lease.release();
    }
    if (sendFailure) console.error(sendFailure);
  }
}
