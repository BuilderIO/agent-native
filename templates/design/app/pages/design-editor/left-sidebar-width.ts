import type { DesignLeftPanel } from "@/pages/design-editor/types";

export const DEFAULT_LEFT_SIDEBAR_WIDTH = 240;
const LEFT_SIDEBAR_WIDTH_STEP = 8;
const LEFT_SIDEBAR_MIN_WIDTH = 232;
const LEFT_SIDEBAR_MAX_WIDTH = 416;
const AGENT_PANEL_MIN_WIDTH = 320;
const CODE_PANEL_MIN_WIDTH = 520;
const CODE_PANEL_MAX_WIDTH = 1100;
// The code panel renders no narrower than this, even though it can be dragged
// down to CODE_PANEL_MIN_WIDTH.
const CODE_PANEL_RENDER_MIN_WIDTH = 640;

function leftSidebarWidthLimits(activeLeftPanel: DesignLeftPanel | null): {
  min: number;
  max: number;
} {
  if (activeLeftPanel === "code") {
    return { min: CODE_PANEL_MIN_WIDTH, max: CODE_PANEL_MAX_WIDTH };
  }
  return {
    min:
      activeLeftPanel === "agent"
        ? AGENT_PANEL_MIN_WIDTH
        : LEFT_SIDEBAR_MIN_WIDTH,
    max: LEFT_SIDEBAR_MAX_WIDTH,
  };
}

/** Width the left panel renders at for the stored width. */
export function resolveLeftSidebarWidth(
  storedWidth: number,
  activeLeftPanel: DesignLeftPanel | null,
): number {
  if (activeLeftPanel === "code") {
    return Math.max(storedWidth, CODE_PANEL_RENDER_MIN_WIDTH);
  }
  const { min, max } = leftSidebarWidthLimits(activeLeftPanel);
  return Math.max(Math.min(storedWidth, max), min);
}

/** Width a drag lands on: snapped to the step, then held inside the limits. */
export function snapLeftSidebarDragWidth(
  width: number,
  activeLeftPanel: DesignLeftPanel | null,
): number {
  const { min, max } = leftSidebarWidthLimits(activeLeftPanel);
  const snapped =
    Math.round(width / LEFT_SIDEBAR_WIDTH_STEP) * LEFT_SIDEBAR_WIDTH_STEP;
  return Math.min(max, Math.max(min, snapped));
}
