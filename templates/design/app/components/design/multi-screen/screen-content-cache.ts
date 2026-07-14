import type { ReactNode } from "react";

import { DEVICE_FRAME_VIEWPORTS, type DeviceFrameType } from "../types";
import type {
  FrameGeometry,
  MultiScreenCanvasProps,
  ResolvedScreenMetadata,
  ScreenContentCacheEntry,
  ScreenFile,
  ScreenMetadata,
  ScreenPreviewState,
  ScreenSourceType,
} from "./types";

export interface ResolvedMetadataCacheEntry {
  screen: ScreenFile;
  keyedMetadata?: ScreenMetadata;
  getterMetadata?: ScreenMetadata;
  previewDeviceFrame: DeviceFrameType;
  result: ResolvedScreenMetadata;
}

export function sameResolvedMetadata(
  a: ResolvedScreenMetadata,
  b: ResolvedScreenMetadata,
): boolean {
  return (
    a.source === b.source &&
    a.previewState === b.previewState &&
    a.title === b.title &&
    a.width === b.width &&
    a.height === b.height &&
    a.previewUrl === b.previewUrl
  );
}

function sameScreenMetadataInput(
  a: ScreenMetadata | undefined,
  b: ScreenMetadata | undefined,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.source === b.source &&
    a.sourceType === b.sourceType &&
    a.lod === b.lod &&
    a.previewState === b.previewState &&
    a.status === b.status &&
    a.title === b.title &&
    a.width === b.width &&
    a.height === b.height &&
    a.url === b.url &&
    a.previewUrl === b.previewUrl &&
    a.bridgeUrl === b.bridgeUrl &&
    a.previewToken === b.previewToken
  );
}

export function pruneResolvedMetadataCache(
  cache: Map<string, ResolvedMetadataCacheEntry>,
  liveScreenIds: ReadonlySet<string>,
) {
  for (const id of cache.keys()) {
    if (!liveScreenIds.has(id)) cache.delete(id);
  }
}

/** Keep cached React content nodes for screens that still exist, even while an
 * overview iframe is LRU-evicted. The node is cheap compared with its mounted
 * browsing context and lets a revisit reuse the already-built DesignCanvas
 * element. Deleted screens are still pruned so create/delete churn cannot grow
 * this cache without bound. */
export function pruneScreenContentCache(
  cache: Map<string, ScreenContentCacheEntry>,
  existingScreenIds: ReadonlySet<string>,
) {
  for (const id of cache.keys()) {
    if (!existingScreenIds.has(id)) cache.delete(id);
  }
}

export function __clearResolvedMetadataCacheForTests(
  cache: Map<string, ResolvedMetadataCacheEntry>,
) {
  cache.clear();
}

export function resolveScreenMetadataCached(
  cache: Map<string, ResolvedMetadataCacheEntry>,
  screen: ScreenFile,
  keyedMetadata: ScreenMetadata | undefined,
  getterMetadata: ScreenMetadata | undefined,
  previewDeviceFrame: DeviceFrameType,
): ResolvedScreenMetadata {
  const cached = cache.get(screen.id);
  if (
    cached &&
    cached.screen === screen &&
    cached.previewDeviceFrame === previewDeviceFrame &&
    sameScreenMetadataInput(cached.keyedMetadata, keyedMetadata) &&
    sameScreenMetadataInput(cached.getterMetadata, getterMetadata)
  ) {
    return cached.result;
  }
  const result = resolveScreenMetadata(
    screen,
    keyedMetadata,
    getterMetadata,
    previewDeviceFrame,
  );
  cache.set(screen.id, {
    screen,
    keyedMetadata,
    getterMetadata,
    previewDeviceFrame,
    result,
  });
  return result;
}

export function getCachedScreenContentNode(
  cache: Map<string, ScreenContentCacheEntry>, // i18n-ignore -- type signature, not visible copy
  screen: ScreenFile,
  metadata: ResolvedScreenMetadata,
  geometry: FrameGeometry,
  renderScreenContent: NonNullable<
    MultiScreenCanvasProps["renderScreenContent"]
  >,
): ReactNode {
  const width = Math.max(1, Math.round(geometry.width));
  const height = Math.max(1, Math.round(geometry.height));
  const prior = cache.get(screen.id);
  if (
    prior &&
    prior.screen === screen &&
    prior.renderScreenContent === renderScreenContent &&
    sameResolvedMetadata(prior.metadata, metadata) &&
    prior.width === width &&
    prior.height === height
  ) {
    return prior.contentNode;
  }
  const contentNode = renderScreenContent(screen, metadata, geometry);
  cache.set(screen.id, {
    screen,
    metadata,
    width,
    height,
    renderScreenContent,
    contentNode,
  });
  return contentNode;
}

export function resolveScreenMetadata(
  screen: ScreenFile,
  keyedMetadata?: ScreenMetadata,
  getterMetadata?: ScreenMetadata,
  previewDeviceFrame: DeviceFrameType = "none",
): ResolvedScreenMetadata {
  const safeScreen: ScreenFile =
    typeof screen.content === "string" ? screen : { ...screen, content: "" };
  const metadata = { ...safeScreen, ...keyedMetadata, ...getterMetadata };
  const previewUrl =
    metadata.url ??
    metadata.previewUrl ??
    safeScreen.previewUrl ??
    getPreviewUrl(safeScreen.content);
  const deviceViewport =
    previewDeviceFrame === "none"
      ? undefined
      : DEVICE_FRAME_VIEWPORTS[previewDeviceFrame];
  const width =
    deviceViewport?.width ??
    (metadata.width && metadata.width > 0 ? metadata.width : 1280);
  const height =
    deviceViewport?.height ??
    (metadata.height && metadata.height > 0 ? metadata.height : 2560);
  return {
    source:
      normalizeSource(metadata.sourceType ?? metadata.source) ??
      deriveSource(safeScreen, previewUrl),
    previewState:
      normalizePreviewState(
        metadata.lod ?? metadata.previewState ?? metadata.status,
      ) ?? derivePreviewState(safeScreen, previewUrl),
    title: metadata.title,
    width,
    height,
    previewUrl,
  };
}

function normalizeSource(value?: string): ScreenSourceType | undefined {
  const normalized = value?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "local" || normalized === "localhost") return "localhost";
  if (normalized === "fusion" || normalized === "remote-fusion") {
    return "fusion";
  }
  if (normalized === "inline" || normalized === "code") return "inline";
  return undefined;
}

function normalizePreviewState(value?: string): ScreenPreviewState | undefined {
  const normalized = value?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "live") return "live";
  if (normalized === "snapshot" || normalized === "cached") return "snapshot";
  if (normalized === "preview" || normalized === "draft") return "preview";
  return undefined;
}

function deriveSource(
  screen: ScreenFile,
  previewUrl?: string,
): ScreenSourceType {
  const haystack =
    `${screen.filename} ${screen.content.slice(0, 4000)}`.toLowerCase();
  const url = getUrl(previewUrl ?? screen.content);
  if (
    url?.hostname === "localhost" ||
    url?.hostname === "127.0.0.1" ||
    url?.hostname.endsWith(".local") ||
    haystack.includes("localhost") ||
    haystack.includes("127.0.0.1")
  ) {
    return "localhost";
  }
  if (haystack.includes("fusion") || url?.hostname.includes("fusion")) {
    return "fusion";
  }
  return "inline";
}

function derivePreviewState(
  screen: ScreenFile,
  previewUrl?: string,
): ScreenPreviewState {
  const haystack =
    `${screen.filename} ${screen.content.slice(0, 4000)}`.toLowerCase();
  if (
    haystack.includes("snapshot") ||
    haystack.includes("screenshot") ||
    haystack.includes("cached") ||
    haystack.includes("data:image/")
  ) {
    return "snapshot";
  }
  if (previewUrl || deriveSource(screen, previewUrl) !== "inline") {
    return "live";
  }
  return "preview";
}

export function getPreviewUrl(content: string) {
  return getUrl(
    typeof content === "string" ? content.trim() : undefined,
  )?.toString();
}

function getUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
