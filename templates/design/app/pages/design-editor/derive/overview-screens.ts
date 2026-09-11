import { isBoardFile } from "@shared/board-file";

import { normalizedDesignFileType } from "../canvas-primitive-insert";
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
  url?: string;
  previewUrl?: string;
  bridgeUrl?: string;
  previewToken?: string;
  breakpointWidths?: number[];
  activeBreakpointWidth?: number;
}

export interface DeriveOverviewScreensArgs {
  designDataJson: Record<string, unknown>;
  files: DesignFile[];
  activeBreakpointWidthState: number | undefined;
  breakpointFramesHidden: boolean;
  /**
   * Heights pinned in this session but not yet round-tripped through
   * `designs.data`. Without them the content-fit pass regrows a screen the
   * user just sized.
   */
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
  // §6.4 — breakpoint set stored in designs.data.breakpointSet as a
  // BreakpointSet { id, breakpoints: BreakpointDefinition[] }.
  // Each BreakpointDefinition has { id, label, widthPx, prefix }.
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

  // Exclude the board file — it is rendered by its own DesignCanvas instance
  // in MultiScreenCanvas and must not appear as a screen frame.  Support files
  // such as CSS are editable files, not visual screens.
  return files
    .filter(
      (file) =>
        normalizedDesignFileType(file.fileType) === "html" &&
        !isBoardFile(file.filename),
    )
    .map((file) => {
      const metadata = getDesignDataRecord(metadataByFileId, file.id);
      const stringValue = (key: string) =>
        typeof metadata[key] === "string"
          ? (metadata[key] as string)
          : undefined;
      const numberValue = (key: string) =>
        typeof metadata[key] === "number" && Number.isFinite(metadata[key])
          ? (metadata[key] as number)
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
        // Without this the pin never reaches the canvas and the content-fit
        // pass grows a deliberately-sized screen straight back.
        heightPinned:
          metadata.heightPinned === true || locallyPinnedHeightIds.has(file.id),
        url: stringValue("url"),
        previewUrl: stringValue("previewUrl"),
        bridgeUrl: stringValue("bridgeUrl"),
        previewToken: stringValue("previewToken"),
        // Breakpoint preview widths (§6.4). When non-empty, MultiScreenCanvas
        // renders one iframe per width to the right of the primary frame.
        breakpointWidths: bpWidths,
        // Active breakpoint width tracked in component state; shared across all
        // screens (a design has one active breakpoint set at a time in v1).
        activeBreakpointWidth: bpWidths?.includes(
          activeBreakpointWidthState ?? -1,
        )
          ? activeBreakpointWidthState
          : undefined,
      };
    });
}
