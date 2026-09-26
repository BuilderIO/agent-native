import { isOverviewScreenFile } from "@shared/design-files";
import { MAX_SANE_FRAME_DIMENSION_PX } from "@shared/responsive-frame-layout";

import { resolveScreenHeightMode } from "@/components/design/multi-screen/screen-height";

import { getDesignDataRecord } from "../design-data-geometry-utils";
import type { DesignFile } from "../types";

export interface OverviewScreen {
  id: string;
  filename: string;
  content: string;
  updatedAt: string;
  sourceType?: string;
  source?: string;
  sourceFile?: string;
  connectionId?: string;
  lod?: string;
  previewState?: string;
  status?: string;
  title?: string;
  layoutGroupId?: string;
  width?: number;
  height?: number;
  heightPinned: boolean;
  heightMode?: "auto" | "fixed" | "hug";
  url?: string;
  previewUrl?: string;
  bridgeUrl?: string;
  previewToken?: string;
  breakpointWidths?: number[];
  breakpointHeights?: Record<string, number>;
  activeBreakpointWidth?: number;
}

export interface DeriveOverviewScreensArgs {
  designDataJson: Record<string, unknown>;
  files: DesignFile[];
  activeBreakpointWidthState: number | undefined;
  breakpointFramesHidden: boolean;
  locallyPinnedHeightIds: ReadonlySet<string>;
}

export function deriveOverviewScreens({
  designDataJson,
  files,
  activeBreakpointWidthState,
  breakpointFramesHidden,
  locallyPinnedHeightIds,
}: DeriveOverviewScreensArgs): OverviewScreen[] {
  const metadataByFileId = getDesignDataRecord(
    designDataJson,
    "screenMetadata",
  );
  const breakpointSet = (() => {
    try {
      const raw = (designDataJson as Record<string, unknown>)?.breakpointSet;
      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        Array.isArray((raw as Record<string, unknown>).breakpoints)
      ) {
        return raw as {
          id: string;
          breakpoints: Array<{
            id: string;
            widthPx: number;
            label?: string;
            prefix?: string;
          }>;
        };
      }
      // coercion-ok: an unreadable breakpointSet means "none configured", which the undefined return already expresses to the caller.
    } catch {
      // ignore
    }
    return undefined;
  })();
  const bpWidths =
    !breakpointFramesHidden &&
    breakpointSet &&
    breakpointSet.breakpoints.length > 0
      ? breakpointSet.breakpoints.map((bp) => bp.widthPx)
      : undefined;

  const overviewFiles = files.filter(isOverviewScreenFile);
  return overviewFiles.map((file) => {
    const metadata = getDesignDataRecord(metadataByFileId, file.id);
    const stringValue = (key: string) =>
      typeof metadata[key] === "string" ? (metadata[key] as string) : undefined;
    const numberValue = (key: string) =>
      typeof metadata[key] === "number" && Number.isFinite(metadata[key])
        ? (metadata[key] as number)
        : undefined;
    const rawBreakpointHeights = metadata.breakpointHeights;
    const heightMode = resolveScreenHeightMode(
      metadata.heightMode,
      metadata.heightPinned === true,
      metadata.sourceType,
    );
    const breakpointHeights =
      rawBreakpointHeights &&
      typeof rawBreakpointHeights === "object" &&
      !Array.isArray(rawBreakpointHeights)
        ? Object.fromEntries(
            Object.entries(rawBreakpointHeights).filter(
              ([width, height]) =>
                Number.isSafeInteger(Number(width)) &&
                Number(width) > 0 &&
                String(Number(width)) === width &&
                typeof height === "number" &&
                Number.isFinite(height) &&
                height > 0 &&
                height <= MAX_SANE_FRAME_DIMENSION_PX,
            ),
          )
        : undefined;
    return {
      id: file.id,
      filename: file.filename,
      content: file.content,
      updatedAt: file.updatedAt,
      sourceType: stringValue("sourceType"),
      source: stringValue("source"),
      sourceFile: stringValue("sourceFile"),
      connectionId: stringValue("connectionId"),
      lod: stringValue("lod"),
      previewState: stringValue("previewState"),
      status: stringValue("status"),
      title: stringValue("title"),
      layoutGroupId: stringValue("variantSetId"),
      width: numberValue("width"),
      height: numberValue("height"),
      breakpointHeights,
      heightPinned:
        heightMode === "fixed" || locallyPinnedHeightIds.has(file.id),
      heightMode,
      url: stringValue("url"),
      previewUrl: stringValue("previewUrl"),
      bridgeUrl: stringValue("bridgeUrl"),
      previewToken: stringValue("previewToken"),
      breakpointWidths: bpWidths,
      activeBreakpointWidth: bpWidths?.includes(
        activeBreakpointWidthState ?? -1,
      )
        ? activeBreakpointWidthState
        : undefined,
    };
  });
}

function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  return (
    aKeys.length === Object.keys(bRecord).length &&
    aKeys.every((key) => aRecord[key] === bRecord[key])
  );
}

export function reuseUnchangedOverviewScreens<T extends { id: string }>(
  previous: readonly T[],
  next: T[],
): T[] {
  const previousById = new Map(previous.map((screen) => [screen.id, screen]));
  let changed = previous.length !== next.length;
  const reused = next.map((screen, index) => {
    const prior = previousById.get(screen.id);
    const priorRecord = prior as Record<string, unknown> | undefined;
    const nextRecord = screen as Record<string, unknown>;
    const nextKeys = Object.keys(nextRecord);
    if (
      prior &&
      nextKeys.length === Object.keys(priorRecord!).length &&
      nextKeys.every((key) =>
        sameFieldValue(priorRecord![key], nextRecord[key]),
      )
    ) {
      if (previous[index] !== prior) changed = true;
      return prior;
    }
    changed = true;
    return screen;
  });
  return changed ? reused : (previous as T[]);
}
