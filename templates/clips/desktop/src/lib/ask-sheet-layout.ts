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
