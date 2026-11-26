import { AGENT_SIDEBAR_MIN_WIDTH } from "@agent-native/core/client/agent-sidebar-state";

// The Agent panel shares this column and holds its own 320px floor; a
// narrower column would clip the chat.
export const DEFAULT_LEFT_SIDEBAR_WIDTH = AGENT_SIDEBAR_MIN_WIDTH;
const LEFT_SIDEBAR_WIDTH_STEP = 8;
export const LEFT_SIDEBAR_MIN_WIDTH = AGENT_SIDEBAR_MIN_WIDTH;
export const LEFT_SIDEBAR_MAX_WIDTH = 416;

/** Width the left panel renders at for the stored width. */
export function resolveLeftSidebarWidth(storedWidth: number): number {
  return Math.max(
    Math.min(storedWidth, LEFT_SIDEBAR_MAX_WIDTH),
    LEFT_SIDEBAR_MIN_WIDTH,
  );
}

/** Width a drag lands on: snapped to the step, then held inside the limits. */
export function snapLeftSidebarDragWidth(width: number): number {
  const snapped =
    Math.round(width / LEFT_SIDEBAR_WIDTH_STEP) * LEFT_SIDEBAR_WIDTH_STEP;
  return Math.min(
    LEFT_SIDEBAR_MAX_WIDTH,
    Math.max(LEFT_SIDEBAR_MIN_WIDTH, snapped),
  );
}
