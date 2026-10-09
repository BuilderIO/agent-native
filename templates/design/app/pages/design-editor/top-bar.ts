import type { AnnotateLabStatus } from "./tool-state";
import type { EditorMode } from "./types";

export const TOP_BAR_HEIGHT_PX = 48;
const MINIMAL_UI_BAR_GAP_PX = 12;

export function minimalUiBarTopPaddingPx(widgetEmbed: boolean): number {
  return widgetEmbed
    ? TOP_BAR_HEIGHT_PX + MINIMAL_UI_BAR_GAP_PX
    : MINIMAL_UI_BAR_GAP_PX;
}

/**
 * Modes the top bar's switch offers; `EDITOR_TOP_BAR_MODES` fixes their order.
 * Annotate is there only while its lab is on.
 */
export function getTopBarModes({
  showsModes,
  annotateLab,
}: {
  showsModes: boolean;
  annotateLab: AnnotateLabStatus;
}): EditorMode[] {
  if (!showsModes) return [];
  return annotateLab === "on"
    ? ["interact", "edit", "annotate"]
    : ["interact", "edit"];
}

/**
 * Which shells render the docked top bar. Every control the bar carries (mode
 * switch, zoom, presence, Share, Review changes) must render somewhere in the
 * shells that do not: the inspector's own action row, the minimal-UI floating
 * bar, or, for the mode switch, the bottom toolbar.
 */
export function isTopBarVisible({
  embedded,
  isVisualEditSurface,
  minimalUi,
  uiHidden,
  widgetEmbed = false,
}: {
  embedded: boolean;
  isVisualEditSurface: boolean;
  minimalUi: boolean;
  uiHidden: boolean;
  widgetEmbed?: boolean;
}): boolean {
  if (uiHidden || isVisualEditSurface) return false;
  if (widgetEmbed) return true;
  return !embedded && !minimalUi;
}
