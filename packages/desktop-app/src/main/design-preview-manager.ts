import {
  session,
  webContents,
  WebContentsView,
  type BrowserWindow,
  type WebContents,
} from "electron";

import {
  acceptDesktopDesignPreviewGeneration,
  deriveDesktopDesignPreviewPartition,
  DESKTOP_DESIGN_PREVIEW_STALE_MS,
  getDesktopDesignPreviewNavigationDecision,
  parseDesktopDesignPreviewHostBounds,
  parseDesktopDesignPreviewRequest,
  parseDesktopDesignPreviewUrl,
  type DesktopDesignPreviewRequest,
  type DesktopDesignPreviewState,
  type DesktopDesignPreviewUpdate,
} from "../../shared/design-preview-protocol";
import {
  resolveDesktopDesignPreviewPlacement,
  type DesktopDesignPreviewRect,
} from "../../shared/design-preview-placement";
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
  loadedUrl: string | null;
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

function configurePreviewSession(partition: string): Electron.Session {
  const previewSession = session.fromPartition(partition);
  if (configuredPreviewSessions.has(previewSession)) return previewSession;
  configuredPreviewSessions.add(previewSession);

  // Phase A is intentionally fail-closed. Authentication through ordinary
  // first-party cookies/storage works without granting device capabilities.
  previewSession.setPermissionCheckHandler(() => false);
  previewSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
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
  private destroyed = false;
  private visible = false;

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
      this.destroyManaged("owner-changed");
      this.lastGeneration = undefined;
    }
    this.owner = {
      appId: "design",
      webContentsId: contents.id,
      hostBounds,
    };
  }

  clearOwner(webContentsId?: number): void {
    if (
      webContentsId !== undefined &&
      this.owner?.webContentsId !== webContentsId
    ) {
      return;
    }
    this.owner = null;
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

    if (request.action === "destroy") {
      if (!this.managed || sameRequestIdentity(this.managed.request, request)) {
        this.destroyManaged("requested");
      }
      this.sendState({
        state: "destroyed",
        screenId: request.screenId,
        generation: request.generation,
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
      this.hide(
        placement.kind === "dom" ? placement.reason : "preview-hidden",
      );
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
      return;
    }

    const parsedUrl = parseDesktopDesignPreviewUrl(request.url);
    const partition = deriveDesktopDesignPreviewPartition(request);
    if (!parsedUrl || !partition) {
      this.hide("unsupported-url");
      this.sendState({
        state: "fallback",
        screenId: request.screenId,
        generation: request.generation,
        reason: "unsupported-url",
      });
      return;
    }

    const managed = this.ensureManagedView(request, partition);
    managed.request = request;
    managed.view.setBounds(placement.bounds);
    this.bumpStaleTimer(request);

    const normalizedUrl = parsedUrl.toString();
    if (managed.loadedUrl !== normalizedUrl) {
      managed.loadedUrl = null;
      this.setVisible(false);
      this.sendState({
        state: "loading",
        screenId: request.screenId,
        generation: request.generation,
      });
      void managed.view.webContents.loadURL(normalizedUrl).catch(() => {
        if (this.managed !== managed) return;
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
      loadedUrl: null,
    };
    this.managed = managed;

    view.webContents.setWindowOpenHandler(({ url }) => {
      this.reportBlockedNavigation(managed, url, "window-open");
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      const decision = getDesktopDesignPreviewNavigationDecision(
        managed.request.url,
        url,
      );
      if (decision.action === "allow") return;
      event.preventDefault();
      this.reportBlockedNavigation(managed, url, decision.reason);
    });
    view.webContents.on("will-redirect", (event, url) => {
      const decision = getDesktopDesignPreviewNavigationDecision(
        managed.request.url,
        url,
      );
      if (decision.action === "allow") return;
      event.preventDefault();
      this.reportBlockedNavigation(managed, url, decision.reason);
    });
    view.webContents.on("did-start-navigation", () => {
      if (this.managed === managed) this.setVisible(false);
    });
    view.webContents.on("did-finish-load", () => {
      if (this.managed !== managed || view.webContents.isDestroyed()) return;
      const loadedUrl = parseDesktopDesignPreviewUrl(view.webContents.getURL());
      if (!loadedUrl) {
        this.hide("unsupported-loaded-url");
        return;
      }
      managed.loadedUrl = loadedUrl.toString();
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
    const managed = this.managed;
    this.managed = null;
    this.visible = false;
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
