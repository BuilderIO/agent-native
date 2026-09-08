/**
 * How the expanded meeting panel is divided between the live transcript and
 * the answer sheet.
 *
 * The sheet shares the column rather than covering it: the transcript follows
 * its newest line, so anything laid over the bottom hides exactly the part of
 * the session the user is still watching. A ratio alone is not enough either —
 * one that leaves room on a tall window starves the feed on a short one — so
 * the transcript also keeps a floor in pixels.
 */

export const ASK_SHEET_DEFAULT = 0.45;
export const ASK_SHEET_MIN = 0.2;
export const ASK_SHEET_MAX = 0.7;
export const TRANSCRIPT_MIN_PX = 104;

/** Below this the drag is a dismissal, not a resize. */
export const ASK_SHEET_DISMISS_AT = ASK_SHEET_MIN + 0.02;

/** Travel past which a grip gesture is a resize rather than a tap. Matches the
 *  capsule's own `DIRECT_CLICK_MAX_TRAVEL_PX`. */
export const SHEET_DRAG_SLOP_PX = 5;

/** How far off the bottom of a scroller still counts as following its live
 *  edge. Matches the transcript's `PIN_SLACK_PX`. */
export const ASK_PIN_SLACK_PX = 28;

/**
 * Whether a grip gesture is a tap — the gesture that dismisses the sheet —
 * rather than a resize.
 *
 * Measured as travel, because travel is the only thing still true when the
 * decision has to be made. `click` fires after `pointerup`, so a guard that
 * reads whether a drag is in progress always sees "no" and lets every resize,
 * including one that grew the sheet, close it on release.
 */
export function isSheetGripTap(deltaY: number): boolean {
  return Math.abs(deltaY) <= SHEET_DRAG_SLOP_PX;
}

/**
 * Whether a scroller is at its live edge, so incoming content should follow it.
 *
 * A stream that scrolls to the bottom on every delta makes reading anything
 * above it impossible for as long as the answer is arriving.
 */
export function isPinnedToBottom(metrics: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <=
    ASK_PIN_SLACK_PX
  );
}

export function clampAskSheetHeight(
  fraction: number,
  panelHeight: number,
): number {
  const roomForTranscript =
    panelHeight > 0
      ? (panelHeight - TRANSCRIPT_MIN_PX) / panelHeight
      : ASK_SHEET_MAX;
  const max = Math.max(
    ASK_SHEET_MIN,
    Math.min(ASK_SHEET_MAX, roomForTranscript),
  );
  return Math.min(max, Math.max(ASK_SHEET_MIN, fraction));
}
