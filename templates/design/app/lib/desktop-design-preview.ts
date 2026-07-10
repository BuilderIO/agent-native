import { getFrameOrigin } from "@agent-native/core/client";
import { useEffect, useRef, useState, type RefObject } from "react";

const REQUEST_TYPE = "agentNative.designPreview.request";
const STATE_TYPE = "agentNative.designPreview.state";
const HEARTBEAT_MS = 750;

type PreviewState = {
  state?: string;
  screenId?: string;
  generation?: number;
  reason?: string;
  url?: string;
  version?: number;
  width?: number;
  height?: number;
  devicePixelRatio?: number;
  mimeType?: string;
  bytes?: unknown;
};

type PreviewRequest = {
  action: "update" | "destroy" | "snapshot-ready";
  appId: "design";
  workspaceId: string;
  connectionId: string;
  screenId: string;
  generation: number;
  [key: string]: unknown;
};

interface DesktopPreviewBridge {
  request(request: PreviewRequest): void;
  onState(callback: (state: PreviewState) => void): () => void;
}

let lastGeneration = 0;

function nextGeneration(): number {
  lastGeneration = Math.max(lastGeneration + 1, Math.floor(Date.now() * 1_000));
  return lastGeneration;
}

function getDirectBridge(): DesktopPreviewBridge | null {
  const desktop = (
    window as typeof window & {
      agentNativeDesktop?: { designPreview?: DesktopPreviewBridge };
    }
  ).agentNativeDesktop;
  return desktop?.designPreview ?? null;
}

function postRequest(request: PreviewRequest): void {
  const direct = getDirectBridge();
  if (direct) {
    direct.request(request);
    return;
  }
  const frameOrigin = getFrameOrigin();
  if (!frameOrigin || window.parent === window) return;
  window.parent.postMessage({ type: REQUEST_TYPE, data: request }, frameOrigin);
}

function connectionIdForUrl(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function resolveDesktopDesignPreviewConnectionId(
  connectionId: string | undefined,
  url: string,
): string | null {
  const explicit = connectionId?.trim();
  // Legacy URL screens predate connection metadata. Origin is a conservative
  // compatibility fallback; current localhost/Fusion screens must pass their
  // stable connection id so same-origin projects remain session-isolated.
  return explicit || connectionIdForUrl(url);
}

function isIframeObscured(iframe: HTMLIFrameElement, rect: DOMRect): boolean {
  const inset = 1;
  const points = [
    [rect.left + inset, rect.top + inset],
    [rect.right - inset, rect.top + inset],
    [rect.left + inset, rect.bottom - inset],
    [rect.right - inset, rect.bottom - inset],
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
  ];
  return points.some(([x, y]) => {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
      return true;
    }
    return document.elementFromPoint(x, y) !== iframe;
  });
}

export interface DesktopDesignNativePreviewOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  url: string | null;
  workspaceId?: string;
  connectionId?: string;
  screenId?: string;
  enabled: boolean;
  active?: boolean;
  mode: "interact" | "edit" | "draw" | "comment";
  presentation: "focused" | "overview";
  scale: number;
  rotationDegrees?: number;
}

export interface DesktopDesignNativePreviewSnapshot {
  url: string;
  version: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  acknowledge(): void;
}

export function resolveDesktopDesignSnapshotLayer(options: {
  hasSnapshot: boolean;
  interactMode: boolean;
  editMode: boolean;
  hasLiveEditorBridge: boolean;
}): "none" | "handoff" | "page" {
  if (!options.hasSnapshot || options.interactMode) return "none";
  if (options.editMode) {
    return options.hasLiveEditorBridge ? "handoff" : "none";
  }
  return "page";
}

function normalizeSnapshotBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return Uint8Array.from(value as number[]);
  }
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  return null;
}

/**
 * Reports a focused URL-backed Interact surface to the desktop app. Browsers
 * without the desktop bridge continue using the iframe unchanged. Electron's
 * main process remains authoritative for eligibility, sender, URL, bounds,
 * session, and generation validation.
 */
export function useDesktopDesignNativePreview(
  options: DesktopDesignNativePreviewOptions,
): DesktopDesignNativePreviewSnapshot | null {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [snapshot, setSnapshot] =
    useState<DesktopDesignNativePreviewSnapshot | null>(null);
  const snapshotUrlRef = useRef<string | null>(null);
  const snapshotVersionRef = useRef(0);
  const reportRef = useRef<(() => void) | null>(null);

  const clearSnapshot = () => {
    if (snapshotUrlRef.current) URL.revokeObjectURL(snapshotUrlRef.current);
    snapshotUrlRef.current = null;
    snapshotVersionRef.current = 0;
    setSnapshot(null);
  };

  useEffect(() => {
    const initial = optionsRef.current;
    if (initial.active === false) return;
    const connectionId = initial.url
      ? resolveDesktopDesignPreviewConnectionId(
          initial.connectionId,
          initial.url,
        )
      : null;
    if (!initial.workspaceId || !initial.screenId || !connectionId) return;

    const base = {
      appId: "design" as const,
      workspaceId: initial.workspaceId,
      connectionId,
      screenId: initial.screenId,
    };
    let frame = 0;
    let disposed = false;

    const report = () => {
      if (disposed) return;
      const current = optionsRef.current;
      const iframe = current.iframeRef.current;
      const currentConnectionId = current.url
        ? resolveDesktopDesignPreviewConnectionId(
            current.connectionId,
            current.url,
          )
        : null;
      if (
        !iframe ||
        !current.url ||
        !current.workspaceId ||
        !current.screenId ||
        current.workspaceId !== base.workspaceId ||
        current.screenId !== base.screenId ||
        currentConnectionId !== base.connectionId
      ) {
        postRequest({
          action: "destroy",
          ...base,
          generation: nextGeneration(),
        });
        return;
      }

      const rect = iframe.getBoundingClientRect();
      const visible =
        current.enabled &&
        document.visibilityState === "visible" &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight;
      const borderRadius = Number.parseFloat(
        window.getComputedStyle(iframe).borderTopLeftRadius,
      );
      postRequest({
        action: "update",
        ...base,
        generation: nextGeneration(),
        url: current.url,
        previewBounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        clipBounds: {
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        },
        mode: current.mode,
        presentation: current.presentation,
        scale: current.scale,
        rotationDegrees: current.rotationDegrees ?? 0,
        borderRadius: Number.isFinite(borderRadius) ? borderRadius : 0,
        devicePixelRatio: window.devicePixelRatio || 1,
        obscured: visible ? isIframeObscured(iframe, rect) : false,
        visible,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    reportRef.current = schedule;

    const iframe = initial.iframeRef.current;
    const observer = new ResizeObserver(schedule);
    if (iframe) observer.observe(iframe);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const heartbeat = window.setInterval(report, HEARTBEAT_MS);
    schedule();

    return () => {
      disposed = true;
      reportRef.current = null;
      cancelAnimationFrame(frame);
      window.clearInterval(heartbeat);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      postRequest({
        action: "destroy",
        ...base,
        generation: nextGeneration(),
      });
    };
  }, [
    options.active,
    options.connectionId,
    options.screenId,
    options.url,
    options.workspaceId,
  ]);

  useEffect(() => {
    reportRef.current?.();
  }, [
    options.enabled,
    options.mode,
    options.presentation,
    options.rotationDegrees,
    options.scale,
  ]);

  useEffect(() => {
    clearSnapshot();
  }, [options.screenId, options.url]);

  useEffect(() => {
    if (options.enabled && options.mode === "interact") clearSnapshot();
  }, [options.enabled, options.mode]);

  useEffect(
    () => () => {
      if (snapshotUrlRef.current) URL.revokeObjectURL(snapshotUrlRef.current);
      snapshotUrlRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const direct = getDirectBridge();
    const handleState = (state: PreviewState) => {
      if (
        state.state === "snapshot" &&
        state.screenId === optionsRef.current.screenId &&
        state.mimeType === "image/png" &&
        typeof state.version === "number" &&
        typeof state.width === "number" &&
        typeof state.height === "number" &&
        typeof state.devicePixelRatio === "number"
      ) {
        if (state.version <= snapshotVersionRef.current) return;
        const bytes = normalizeSnapshotBytes(state.bytes);
        if (
          !bytes ||
          bytes.byteLength === 0 ||
          bytes.byteLength > 8 * 1024 * 1024
        ) {
          clearSnapshot();
          return;
        }
        const blobBytes = new Uint8Array(bytes.byteLength);
        blobBytes.set(bytes);
        const blobUrl = URL.createObjectURL(
          new Blob([blobBytes.buffer], { type: "image/png" }),
        );
        if (snapshotUrlRef.current) URL.revokeObjectURL(snapshotUrlRef.current);
        snapshotUrlRef.current = blobUrl;
        snapshotVersionRef.current = state.version;
        const current = optionsRef.current;
        const connectionId = current.url
          ? resolveDesktopDesignPreviewConnectionId(
              current.connectionId,
              current.url,
            )
          : null;
        setSnapshot({
          url: blobUrl,
          version: state.version,
          width: state.width,
          height: state.height,
          devicePixelRatio: state.devicePixelRatio,
          acknowledge: () => {
            if (!connectionId || !current.workspaceId || !current.screenId) {
              return;
            }
            postRequest({
              action: "snapshot-ready",
              appId: "design",
              workspaceId: current.workspaceId,
              connectionId,
              screenId: current.screenId,
              generation: nextGeneration(),
              version: state.version!,
            });
          },
        });
        return;
      }
      if (
        state.state !== "blocked-navigation" ||
        state.screenId !== optionsRef.current.screenId
      ) {
        return;
      }
      window.dispatchEvent(
        new CustomEvent("agent-native:design-preview-navigation-blocked", {
          detail: state,
        }),
      );
    };
    if (direct) return direct.onState(handleState);
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      const frameOrigin = getFrameOrigin();
      if (
        !frameOrigin ||
        event.source !== window.parent ||
        event.origin !== frameOrigin ||
        event.data?.type !== STATE_TYPE ||
        !event.data.data
      ) {
        return;
      }
      handleState(event.data.data as PreviewState);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return snapshot;
}
