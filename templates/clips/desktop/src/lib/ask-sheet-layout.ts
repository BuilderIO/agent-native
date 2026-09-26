
export const ASK_SHEET_DEFAULT = 0.45;
export const ASK_SHEET_MIN = 0.2;
export const ASK_SHEET_MAX = 0.7;
export const TRANSCRIPT_MIN_PX = 104;

export const ASK_SHEET_DISMISS_AT = ASK_SHEET_MIN + 0.02;

export const SHEET_DRAG_SLOP_PX = 5;

export const ASK_PIN_SLACK_PX = 28;

export function isSheetGripTap(deltaY: number): boolean {
  return Math.abs(deltaY) <= SHEET_DRAG_SLOP_PX;
}

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
