import { createHash } from "node:crypto";

import type {
  DesktopDesignPreviewMode,
  DesktopDesignPreviewRect,
} from "./design-preview-placement";

export const DESKTOP_DESIGN_PREVIEW_APP_ID = "design";
export const DESKTOP_DESIGN_PREVIEW_STALE_MS = 1_800;
export const DESKTOP_DESIGN_PREVIEW_HEARTBEAT_MS = 750;

const MAX_ID_LENGTH = 256;
const MAX_URL_LENGTH = 8_192;
const MAX_GENERATION = Number.MAX_SAFE_INTEGER;
const MAX_DIMENSION = 16_384;
const MAX_COORDINATE = 32_768;

export interface DesktopDesignPreviewScope {
  appId: string;
  workspaceId: string;
  connectionId: string;
}

export interface DesktopDesignPreviewUpdate {
  action: "update";
  appId: string;
  workspaceId: string;
  connectionId: string;
  screenId: string;
  generation: number;
  url: string;
  previewBounds: DesktopDesignPreviewRect;
  clipBounds: DesktopDesignPreviewRect;
  mode: DesktopDesignPreviewMode;
  presentation: "focused" | "overview";
  scale: number;
  rotationDegrees: number;
  borderRadius: number;
  devicePixelRatio: number;
  obscured: boolean;
  visible: boolean;
}

export interface DesktopDesignPreviewDestroy {
  action: "destroy";
  appId: string;
  workspaceId: string;
  connectionId: string;
  screenId: string;
  generation: number;
}

export interface DesktopDesignPreviewSnapshotReady {
  action: "snapshot-ready";
  appId: string;
  workspaceId: string;
  connectionId: string;
  screenId: string;
  generation: number;
  version: number;
}

export type DesktopDesignPreviewRequest =
  | DesktopDesignPreviewUpdate
  | DesktopDesignPreviewDestroy
  | DesktopDesignPreviewSnapshotReady;

export type DesktopDesignPreviewState =
  | {
      state: "active" | "loading" | "hidden" | "destroyed";
      screenId: string;
      generation: number;
    }
  | {
      state: "fallback" | "blocked-navigation" | "failed";
      screenId: string;
      generation: number;
      reason: string;
      url?: string;
    }
  | {
      state: "snapshot";
      screenId: string;
      generation: number;
      version: number;
      width: number;
      height: number;
      devicePixelRatio: number;
      mimeType: "image/png";
      bytes: Uint8Array;
    };

export type DesktopDesignPreviewNavigationDecision =
  | { action: "allow"; url: string }
  | { action: "block"; reason: string; url?: string };

export const DESKTOP_DESIGN_PREVIEW_MOTION_CSS = `
html, body, *, *::before, *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function parseGeneration(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), MAX_GENERATION)
    : null;
}

function parseRect(value: unknown): DesktopDesignPreviewRect | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number"
  ) {
    return null;
  }
  const { x, y, width, height } = value;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    Math.abs(x) > MAX_COORDINATE ||
    Math.abs(y) > MAX_COORDINATE ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return null;
  }
  return { x, y, width, height };
}

export function parseDesktopDesignPreviewHostBounds(
  value: unknown,
): DesktopDesignPreviewRect | null {
  return parseRect(value);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

export function parseDesktopDesignPreviewUrl(rawUrl: unknown): URL | null {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length === 0 ||
    rawUrl.length > MAX_URL_LENGTH
  ) {
    return null;
  }
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

export function deriveDesktopDesignPreviewPartition(
  scope: DesktopDesignPreviewScope,
): string | null {
  if (
    scope.appId !== DESKTOP_DESIGN_PREVIEW_APP_ID ||
    !isBoundedId(scope.workspaceId) ||
    !isBoundedId(scope.connectionId)
  ) {
    return null;
  }
  const digest = createHash("sha256")
    .update(`${scope.appId}\0${scope.workspaceId}\0${scope.connectionId}`)
    .digest("hex");
  return `persist:design-preview:${digest}`;
}

export function acceptDesktopDesignPreviewGeneration(
  previous: number | undefined,
  next: number,
): boolean {
  return (
    Number.isSafeInteger(next) &&
    next >= 0 &&
    (previous === undefined || next > previous)
  );
}

export function shouldTearDownDesktopDesignPreviewForOwnerNavigation(
  isInPlace: boolean,
  isMainFrame: boolean,
): boolean {
  return isMainFrame && !isInPlace;
}

export function getDesktopDesignPreviewNavigationDecision(
  currentUrl: string,
  requestedUrl: string,
): DesktopDesignPreviewNavigationDecision {
  const current = parseDesktopDesignPreviewUrl(currentUrl);
  const requested = parseDesktopDesignPreviewUrl(requestedUrl);
  if (!requested) {
    return { action: "block", reason: "unsupported-url" };
  }
  if (!current || requested.origin !== current.origin) {
    return {
      action: "block",
      reason: "cross-origin-navigation",
      url: requested.toString(),
    };
  }
  return { action: "allow", url: requested.toString() };
}

export function getDesktopDesignPreviewMotionCss(): string {
  return DESKTOP_DESIGN_PREVIEW_MOTION_CSS;
}

export function parseDesktopDesignPreviewRequest(
  value: unknown,
): DesktopDesignPreviewRequest | null {
  if (!isRecord(value)) return null;
  if (
    value.appId !== DESKTOP_DESIGN_PREVIEW_APP_ID ||
    !isBoundedId(value.workspaceId) ||
    !isBoundedId(value.connectionId) ||
    !isBoundedId(value.screenId)
  ) {
    return null;
  }
  const generation = parseGeneration(value.generation);
  if (generation === null) return null;

  const common = {
    appId: DESKTOP_DESIGN_PREVIEW_APP_ID,
    workspaceId: value.workspaceId,
    connectionId: value.connectionId,
    screenId: value.screenId,
    generation,
  };
  if (value.action === "destroy") {
    return { action: "destroy", ...common };
  }
  if (value.action === "snapshot-ready") {
    if (!Number.isSafeInteger(value.version) || Number(value.version) <= 0) {
      return null;
    }
    return {
      action: "snapshot-ready",
      ...common,
      version: Number(value.version),
    };
  }
  if (value.action !== "update") return null;

  const previewBounds = parseRect(value.previewBounds);
  const clipBounds = parseRect(value.clipBounds);
  if (
    typeof value.scale !== "number" ||
    typeof value.rotationDegrees !== "number" ||
    typeof value.borderRadius !== "number"
  ) {
    return null;
  }
  if (typeof value.devicePixelRatio !== "number") return null;
  const { scale, rotationDegrees, borderRadius, devicePixelRatio } = value;
  if (
    !previewBounds ||
    !clipBounds ||
    typeof value.url !== "string" ||
    !parseDesktopDesignPreviewUrl(value.url) ||
    (value.mode !== "interact" &&
      value.mode !== "edit" &&
      value.mode !== "draw" &&
      value.mode !== "comment") ||
    (value.presentation !== "focused" && value.presentation !== "overview") ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 4 ||
    !Number.isFinite(rotationDegrees) ||
    Math.abs(rotationDegrees) > 360_000 ||
    !Number.isFinite(borderRadius) ||
    borderRadius < 0 ||
    borderRadius > MAX_DIMENSION ||
    !Number.isFinite(devicePixelRatio) ||
    devicePixelRatio < 0.5 ||
    devicePixelRatio > 4 ||
    typeof value.obscured !== "boolean" ||
    typeof value.visible !== "boolean"
  ) {
    return null;
  }

  return {
    action: "update",
    ...common,
    url: value.url,
    previewBounds,
    clipBounds,
    mode: value.mode,
    presentation: value.presentation,
    scale,
    rotationDegrees,
    borderRadius,
    devicePixelRatio,
    obscured: value.obscured,
    visible: value.visible,
  };
}
