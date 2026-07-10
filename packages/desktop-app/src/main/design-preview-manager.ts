import {
  session,
  webContents,
  WebContentsView,
  type BrowserWindow,
  type WebContents,
} from "electron";

import {
  resolveDesktopDesignPreviewPlacement,
  type DesktopDesignPreviewRect,
} from "../../shared/design-preview-placement";
import {
  acceptDesktopDesignPreviewGeneration,
  deriveDesktopDesignPreviewPartition,
  DESKTOP_DESIGN_PREVIEW_STALE_MS,
  getDesktopDesignPreviewMotionCss,
  getDesktopDesignPreviewNavigationDecision,
  parseDesktopDesignPreviewHostBounds,
  parseDesktopDesignPreviewRequest,
  parseDesktopDesignPreviewUrl,
  shouldTearDownDesktopDesignPreviewForOwnerNavigation,
  type DesktopDesignPreviewRequest,
  type DesktopDesignPreviewState,
  type DesktopDesignPreviewUpdate,
} from "../../shared/design-preview-protocol";
import { IPC } from "../../shared/ipc-channels";

interface RegisteredDesignPreviewOwner {
  appId: "design";
  webContentsId: number;
  hostBounds: DesktopDesignPreviewRect;
}

interface ManagedDesignPreview {
  view: WebContentsView;
  partition: string;
  request: DesktopDesignPreviewUpdate;
  requestedUrl: string | null;
  loading: boolean;
  lastNativeRequest: DesktopDesignPreviewUpdate;
  snapshot: ManagedDesignPreviewSnapshot | null;
}

interface ManagedDesignPreviewSnapshot {
  key: string;
  version: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  bytes: Uint8Array;
}

export interface DesktopDesignPreviewManagerSnapshot {
  ownerWebContentsId?: number;
  generation?: number;
  screenId?: string;
  partition?: string;
  visible: boolean;
  destroyed: boolean;
}

const configuredPreviewSessions = new WeakSet<Electron.Session>();
const SNAPSHOT_RETAIN_MS = 30_000;
const MAX_SNAPSHOT_DIMENSION = 4_096;
const MAX_SNAPSHOT_PIXELS = 16_777_216;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_READY_TIMEOUT_MS = 2_000;

function configurePreviewSession(partition: string): Electron.Session {
  const previewSession = session.fromPartition(partition);
  if (configuredPreviewSessions.has(previewSession)) return previewSession;
  configuredPreviewSessions.add(previewSession);

  // Phase A is intentionally fail-closed. Authentication through ordinary
  // first-party cookies/storage works without granting device capabilities.
  previewSession.setPermissionCheckHandler(() => false);
  previewSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  return previewSession;
}

function sameRequestIdentity(
  left: DesktopDesignPreviewRequest,
  right: DesktopDesignPreviewRequest,
): boolean {
  return (
    left.appId === right.appId &&
    left.workspaceId === right.workspaceId &&
    left.connectionId === right.connectionId &&
    left.screenId === right.screenId
  );
}

export class DesktopDesignPreviewManager {
  private owner: RegisteredDesignPreviewOwner | null = null;
  private managed: ManagedDesignPreview | null = null;
  private lastGeneration: number | undefined;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private ownerCleanup: (() => void) | null = null;
  private destroyed = false;
  private visible = false;
  private nativeDesired = false;
  private retainedTimer: ReturnType<typeof setTimeout> | null = null;
  private captureInFlight = false;
  private captureQueued: DesktopDesignPreviewUpdate | null = null;
  private captureVersion = 0;
  private captureNavigationBlocked = false;
  private snapshotReadyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly window: BrowserWindow) {}

  registerOwner(
    webContentsId: number | undefined,
    appId: string,
    hostBoundsValue: unknown,
  ): void {
    if (this.destroyed) return;
    const hostBounds = parseDesktopDesignPreviewHostBounds(hostBoundsValue);
    const contents =
      typeof webContentsId === "number"
        ? webContents.fromId(webContentsId)
        : undefined;
    if (
      appId !== "design" ||
      !contents ||
      contents.isDestroyed() ||
      contents.getType() !== "webview" ||
      !hostBounds
    ) {
      this.owner = null;
      this.hide("owner-inactive");
      return;
    }

    if (this.owner?.webContentsId !== contents.id) {
      this.ownerCleanup?.();
      this.ownerCleanup = null;
      this.destroyManaged("owner-changed");
      this.lastGeneration = undefined;
      const hideForOwnerNavigation = (
        _event: Electron.Event,
        _url: string,
        isInPlace: boolean,
        isMainFrame: boolean,
      ) => {
        if (
          !shouldTearDownDesktopDesignPreviewForOwnerNavigation(
            isInPlace,
            isMainFrame,
          )
        ) {
          return;
        }
        this.destroyManaged("owner-navigation");
        this.lastGeneration = undefined;
      };
      const clearDestroyedOwner = () => this.clearOwner(contents.id);
      contents.on("did-start-navigation", hideForOwnerNavigation);
      contents.on("destroyed", clearDestroyedOwner);
      this.ownerCleanup = () => {
        if (contents.isDestroyed()) return;
        contents.removeListener("did-start-navigation", hideForOwnerNavigation);
        contents.removeListener("destroyed", clearDestroyedOwner);
      };
    }
    const hostBoundsChanged =
      this.owner !== null &&
      (this.owner.hostBounds.x !== hostBounds.x ||
        this.owner.hostBounds.y !== hostBounds.y ||
        this.owner.hostBounds.width !== hostBounds.width ||
        this.owner.hostBounds.height !== hostBounds.height);
    this.owner = {
      appId: "design",
      webContentsId: contents.id,
      hostBounds,
    };
    if (hostBoundsChanged) this.destroyManaged("host-bounds-changed");
  }

  clearOwner(webContentsId?: number): void {
    if (
      webContentsId !== undefined &&
      this.owner?.webContentsId !== webContentsId
    ) {
      return;
    }
    this.owner = null;
    this.ownerCleanup?.();
    this.ownerCleanup = null;
    this.destroyManaged("owner-inactive");
    this.lastGeneration = undefined;
  }

  handleRequest(sender: WebContents, value: unknown): void {
    if (
      this.destroyed ||
      !this.owner ||
      sender.id !== this.owner.webContentsId ||
      sender.isDestroyed()
    ) {
      return;
    }
    const request = parseDesktopDesignPreviewRequest(value);
    if (!request) {
      this.sendState({
        state: "failed",
        screenId: "unknown",
        generation: 0,
        reason: "invalid-request",
      });
      this.hide("invalid-request");
      return;
    }
    if (
      !acceptDesktopDesignPreviewGeneration(
        this.lastGeneration,
        request.generation,
      )
    ) {
      return;
    }
    this.lastGeneration = request.generation;
    this.clearRetainedTimer();

    if (request.action === "snapshot-ready") {
      if (
        this.managed &&
        sameRequestIdentity(this.managed.request, request) &&
        this.managed.snapshot?.version === request.version
      ) {
        this.clearSnapshotReadyTimer();
        this.setVisible(false);
      }
      return;
    }

    if (request.action === "destroy") {
      if (this.managed && sameRequestIdentity(this.managed.request, request)) {
        this.hide("requested-retain");
        this.scheduleRetainedTeardown(this.managed);
      }
      this.sendState({
        state: this.managed ? "hidden" : "destroyed",
        screenId: request.screenId,
        generation: request.generation,
      });
      return;
    }

    const parsedUrl = parseDesktopDesignPreviewUrl(request.url);
    const partition = deriveDesktopDesignPreviewPartition(request);
    if (!parsedUrl || !partition) {
      this.destroyManaged("unsupported-url");
      this.sendState({
        state: "fallback",
        screenId: request.screenId,
        generation: request.generation,
        reason: "unsupported-url",
      });
      return;
    }

    const placement = resolveDesktopDesignPreviewPlacement({
      hostBounds: this.owner.hostBounds,
      previewBounds: request.previewBounds,
      clipBounds: request.clipBounds,
      mode: request.mode,
      presentation: request.presentation,
      scale: request.scale,
      rotationDegrees: request.rotationDegrees,
      borderRadius: request.borderRadius,
      obscured: request.obscured,
      visible: request.visible,
    });
    if (placement.kind !== "native") {
      const matchesExisting =
        this.managed &&
        this.managed.partition === partition &&
        this.managed.request.screenId === request.screenId &&
        parseDesktopDesignPreviewUrl(
          this.managed.lastNativeRequest.url,
        )?.toString() === parsedUrl.toString();
      if (placement.kind === "hidden" && matchesExisting && this.managed) {
        const retained = this.managed;
        retained.request = request;
        this.hide("preview-hidden");
        this.scheduleRetainedTeardown(retained);
        return;
      }
      const canCaptureExisting =
        placement.kind === "dom" && Boolean(matchesExisting);
      if (canCaptureExisting) {
        this.clearStaleTimer();
        this.nativeDesired = false;
      } else {
        this.destroyManaged("snapshot-source-unavailable");
      }
      this.sendState(
        placement.kind === "dom"
          ? {
              state: "fallback",
              screenId: request.screenId,
              generation: request.generation,
              reason: placement.reason,
            }
          : {
              state: "hidden",
              screenId: request.screenId,
              generation: request.generation,
            },
      );
      if (canCaptureExisting && this.managed) {
        this.managed.request = request;
        this.queueSnapshotCapture(request);
      }
      return;
    }

    const managed = this.ensureManagedView(request, partition);
    managed.request = request;
    managed.lastNativeRequest = request;
    managed.snapshot = null;
    this.nativeDesired = true;
    managed.view.setBounds(placement.bounds);
    this.bumpStaleTimer(request);

    const normalizedUrl = parsedUrl.toString();
    if (managed.requestedUrl !== normalizedUrl) {
      managed.requestedUrl = normalizedUrl;
      managed.loading = true;
      this.setVisible(false);
      this.sendState({
        state: "loading",
        screenId: request.screenId,
        generation: request.generation,
      });
      void managed.view.webContents.loadURL(normalizedUrl).catch(() => {
        if (this.managed !== managed) return;
        managed.loading = false;
        this.hide("load-failed");
        this.sendState({
          state: "failed",
          screenId: request.screenId,
          generation: request.generation,
          reason: "load-failed",
        });
      });
      return;
    }

    if (managed.loading) {
      this.setVisible(false);
      this.sendState({
        state: "loading",
        screenId: request.screenId,
        generation: request.generation,
      });
      return;
    }

    this.window.contentView.addChildView(managed.view);
    this.setVisible(true);
    this.sendState({
      state: "active",
      screenId: request.screenId,
      generation: request.generation,
    });
  }

  hide(reason = "hidden"): void {
    this.clearStaleTimer();
    this.nativeDesired = false;
    this.setVisible(false);
    const request = this.managed?.request;
    if (request) {
      this.sendState({
        state: "hidden",
        screenId: request.screenId,
        generation: request.generation,
      });
    }
    if (process.env.AGENT_NATIVE_DESIGN_PREVIEW_DEBUG === "1") {
      console.info(`[design-preview] hidden: ${reason}`);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.owner = null;
    this.ownerCleanup?.();
    this.ownerCleanup = null;
    this.destroyManaged("manager-destroyed");
    this.lastGeneration = undefined;
  }

  snapshot(): DesktopDesignPreviewManagerSnapshot {
    return {
      ownerWebContentsId: this.owner?.webContentsId,
      generation: this.managed?.request.generation,
      screenId: this.managed?.request.screenId,
      partition: this.managed?.partition,
      visible: this.visible,
      destroyed: this.destroyed,
    };
  }

  private ensureManagedView(
    request: DesktopDesignPreviewUpdate,
    partition: string,
  ): ManagedDesignPreview {
    const existing = this.managed;
    if (
      existing &&
      existing.partition === partition &&
      existing.request.screenId === request.screenId
    ) {
      return existing;
    }
    this.destroyManaged("preview-changed");
    configurePreviewSession(partition);

    const view = new WebContentsView({
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    view.setVisible(false);
    this.window.contentView.addChildView(view);

    const managed: ManagedDesignPreview = {
      view,
      partition,
      request,
      requestedUrl: null,
      loading: false,
      lastNativeRequest: request,
      snapshot: null,
    };
    this.managed = managed;

    view.webContents.setWindowOpenHandler(({ url }) => {
      this.reportBlockedNavigation(managed, url, "window-open");
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      if (this.captureNavigationBlocked) {
        event.preventDefault();
        this.reportBlockedNavigation(managed, url, "snapshot-capture");
        return;
      }
      const decision = getDesktopDesignPreviewNavigationDecision(
        managed.request.url,
        url,
      );
      if (decision.action === "allow") return;
      event.preventDefault();
      this.reportBlockedNavigation(managed, url, decision.reason);
    });
    view.webContents.on("will-redirect", (event, url) => {
      if (this.captureNavigationBlocked) {
        event.preventDefault();
        this.reportBlockedNavigation(managed, url, "snapshot-capture");
        return;
      }
      const decision = getDesktopDesignPreviewNavigationDecision(
        managed.request.url,
        url,
      );
      if (decision.action === "allow") return;
      event.preventDefault();
      this.reportBlockedNavigation(managed, url, decision.reason);
    });
    view.webContents.on("did-start-navigation", () => {
      if (this.managed !== managed) return;
      managed.loading = true;
      managed.snapshot = null;
      this.setVisible(false);
    });
    view.webContents.on("did-finish-load", () => {
      if (this.managed !== managed || view.webContents.isDestroyed()) {
        return;
      }
      managed.loading = false;
      if (!this.nativeDesired || !this.staleTimer) return;
      const loadedUrl = parseDesktopDesignPreviewUrl(view.webContents.getURL());
      if (
        !loadedUrl ||
        getDesktopDesignPreviewNavigationDecision(
          managed.request.url,
          loadedUrl.toString(),
        ).action !== "allow"
      ) {
        this.hide("unsupported-loaded-url");
        return;
      }
      this.window.contentView.addChildView(view);
      this.setVisible(true);
      this.sendState({
        state: "active",
        screenId: managed.request.screenId,
        generation: managed.request.generation,
      });
    });
    view.webContents.on("render-process-gone", () => {
      if (this.managed !== managed) return;
      this.setVisible(false);
      this.sendState({
        state: "failed",
        screenId: managed.request.screenId,
        generation: managed.request.generation,
        reason: "render-process-gone",
      });
    });
    return managed;
  }

  private queueSnapshotCapture(request: DesktopDesignPreviewUpdate): void {
    this.captureQueued = request;
    if (this.captureInFlight) return;
    this.captureInFlight = true;
    void this.drainSnapshotCaptures().finally(() => {
      this.captureInFlight = false;
      if (this.captureQueued) this.queueSnapshotCapture(this.captureQueued);
    });
  }

  private async drainSnapshotCaptures(): Promise<void> {
    while (this.captureQueued) {
      const request = this.captureQueued;
      this.captureQueued = null;
      await this.captureSnapshot(request);
    }
  }

  private async captureSnapshot(
    requestedState: DesktopDesignPreviewUpdate,
  ): Promise<void> {
    const managed = this.managed;
    if (
      !managed ||
      managed.view.webContents.isDestroyed() ||
      managed.request.screenId !== requestedState.screenId ||
      this.nativeDesired
    ) {
      return;
    }
    if (managed.loading) {
      this.setVisible(false);
      return;
    }
    const nativeRequest = managed.lastNativeRequest;
    const logicalWidth = nativeRequest.previewBounds.width;
    const logicalHeight = nativeRequest.previewBounds.height;
    const projectedPixels =
      logicalWidth *
      logicalHeight *
      nativeRequest.devicePixelRatio *
      nativeRequest.devicePixelRatio;
    if (
      logicalWidth > MAX_SNAPSHOT_DIMENSION ||
      logicalHeight > MAX_SNAPSHOT_DIMENSION ||
      projectedPixels > MAX_SNAPSHOT_PIXELS
    ) {
      this.setVisible(false);
      this.sendState({
        state: "failed",
        screenId: requestedState.screenId,
        generation: requestedState.generation,
        reason: "snapshot-too-large",
      });
      return;
    }

    const snapshotKey = [
      managed.requestedUrl,
      Math.round(logicalWidth),
      Math.round(logicalHeight),
      nativeRequest.devicePixelRatio,
    ].join(":");
    if (managed.snapshot?.key === snapshotKey) {
      this.sendSnapshot(managed, managed.snapshot);
      return;
    }

    const contents = managed.view.webContents;
    let cssKey: string | undefined;
    const animationKey = `__agentNativeCaptureAnimations${requestedState.generation}`;
    try {
      this.captureNavigationBlocked = true;
      cssKey = await contents.insertCSS(getDesktopDesignPreviewMotionCss());
      await contents.executeJavaScript(
        `(() => {
          const key = ${JSON.stringify(animationKey)};
          const running = document.getAnimations().filter((animation) => animation.playState === "running");
          for (const animation of running) animation.pause();
          Object.defineProperty(window, key, { value: running, configurable: true });
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`,
        false,
      );
      const image = await contents.capturePage();
      const size = image.getSize();
      if (
        size.width <= 0 ||
        size.height <= 0 ||
        size.width > MAX_SNAPSHOT_DIMENSION ||
        size.height > MAX_SNAPSHOT_DIMENSION ||
        size.width * size.height > MAX_SNAPSHOT_PIXELS
      ) {
        throw new Error("snapshot-too-large");
      }
      const png = image.toPNG();
      if (png.byteLength === 0 || png.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("snapshot-too-large");
      }
      if (
        this.managed !== managed ||
        this.nativeDesired ||
        managed.view.webContents.isDestroyed()
      ) {
        return;
      }
      const snapshot: ManagedDesignPreviewSnapshot = {
        key: snapshotKey,
        version: ++this.captureVersion,
        width: size.width,
        height: size.height,
        devicePixelRatio: logicalWidth > 0 ? size.width / logicalWidth : 1,
        bytes: Uint8Array.from(png),
      };
      managed.snapshot = snapshot;
      this.sendSnapshot(managed, snapshot);
    } catch (error) {
      if (this.managed !== managed) return;
      this.setVisible(false);
      this.sendState({
        state: "failed",
        screenId: managed.request.screenId,
        generation: managed.request.generation,
        reason:
          error instanceof Error && error.message === "snapshot-too-large"
            ? "snapshot-too-large"
            : "snapshot-capture-failed",
      });
    } finally {
      this.captureNavigationBlocked = false;
      if (!contents.isDestroyed()) {
        await contents
          .executeJavaScript(
            `(() => {
              const key = ${JSON.stringify(animationKey)};
              const animations = window[key];
              if (Array.isArray(animations)) {
                for (const animation of animations) {
                  if (animation?.playState === "paused") animation.play();
                }
              }
              try { delete window[key]; } catch {}
            })()`,
            false,
          )
          .catch(() => {});
        if (cssKey) await contents.removeInsertedCSS(cssKey).catch(() => {});
      }
    }
  }

  private sendSnapshot(
    managed: ManagedDesignPreview,
    snapshot: ManagedDesignPreviewSnapshot,
  ): void {
    this.clearSnapshotReadyTimer();
    this.sendState({
      state: "snapshot",
      screenId: managed.request.screenId,
      generation: managed.request.generation,
      version: snapshot.version,
      width: snapshot.width,
      height: snapshot.height,
      devicePixelRatio: snapshot.devicePixelRatio,
      mimeType: "image/png",
      bytes: snapshot.bytes,
    });
    this.snapshotReadyTimer = setTimeout(() => {
      if (
        this.managed === managed &&
        managed.snapshot?.version === snapshot.version &&
        !this.nativeDesired
      ) {
        this.setVisible(false);
      }
    }, SNAPSHOT_READY_TIMEOUT_MS);
    this.snapshotReadyTimer.unref?.();
  }

  private reportBlockedNavigation(
    managed: ManagedDesignPreview,
    url: string,
    reason: string,
  ): void {
    if (this.managed !== managed) return;
    this.sendState({
      state: "blocked-navigation",
      screenId: managed.request.screenId,
      generation: managed.request.generation,
      reason,
      url: parseDesktopDesignPreviewUrl(url)?.toString(),
    });
  }

  private bumpStaleTimer(request: DesktopDesignPreviewUpdate): void {
    this.clearStaleTimer();
    this.staleTimer = setTimeout(() => {
      if (this.managed?.request.generation !== request.generation) return;
      this.hide("stale-layout");
    }, DESKTOP_DESIGN_PREVIEW_STALE_MS);
    this.staleTimer.unref?.();
  }

  private scheduleRetainedTeardown(managed: ManagedDesignPreview): void {
    this.clearRetainedTimer();
    this.retainedTimer = setTimeout(() => {
      if (this.managed === managed) this.destroyManaged("retention-expired");
    }, SNAPSHOT_RETAIN_MS);
    this.retainedTimer.unref?.();
  }

  private clearRetainedTimer(): void {
    if (!this.retainedTimer) return;
    clearTimeout(this.retainedTimer);
    this.retainedTimer = null;
  }

  private clearSnapshotReadyTimer(): void {
    if (!this.snapshotReadyTimer) return;
    clearTimeout(this.snapshotReadyTimer);
    this.snapshotReadyTimer = null;
  }

  private clearStaleTimer(): void {
    if (!this.staleTimer) return;
    clearTimeout(this.staleTimer);
    this.staleTimer = null;
  }

  private setVisible(visible: boolean): void {
    const managed = this.managed;
    if (!managed || managed.view.webContents.isDestroyed()) {
      this.visible = false;
      return;
    }
    managed.view.setVisible(visible);
    this.visible = visible;
  }

  private sendState(state: DesktopDesignPreviewState): void {
    const ownerId = this.owner?.webContentsId;
    if (!ownerId) return;
    const target = webContents.fromId(ownerId);
    if (!target || target.isDestroyed()) return;
    target.send(IPC.DESIGN_PREVIEW_STATE, state);
  }

  private destroyManaged(reason: string): void {
    this.clearStaleTimer();
    this.clearRetainedTimer();
    this.clearSnapshotReadyTimer();
    this.captureQueued = null;
    const managed = this.managed;
    this.managed = null;
    this.visible = false;
    this.nativeDesired = false;
    if (!managed) return;
    try {
      managed.view.setVisible(false);
      this.window.contentView.removeChildView(managed.view);
    } catch {}
    try {
      if (!managed.view.webContents.isDestroyed()) {
        managed.view.webContents.close();
      }
    } catch {}
    if (process.env.AGENT_NATIVE_DESIGN_PREVIEW_DEBUG === "1") {
      console.info(`[design-preview] destroyed: ${reason}`);
    }
  }
}
