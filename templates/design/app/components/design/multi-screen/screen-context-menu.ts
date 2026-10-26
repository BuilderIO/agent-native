/**
 * The screen a right-click on empty screen background belongs to. The bridge
 * reports that click with the screen root (`<body>`/`<html>`) as its target;
 * the board is a canvas, not a screen, so its empty area never names one.
 */
export function screenIdForBackgroundContextMenu(
  data: unknown,
  screenIds: ReadonlySet<string>,
  boardFileId: string | undefined,
): string | null {
  if (!data || typeof data !== "object") return null;
  const message = data as {
    type?: unknown;
    screenId?: unknown;
    payload?: { tagName?: unknown } | null;
  };
  if (message.type !== "element-contextmenu") return null;
  const screenId = message.screenId;
  if (typeof screenId !== "string" || screenId === boardFileId) return null;
  if (!screenIds.has(screenId)) return null;
  const tagName = message.payload?.tagName;
  if (typeof tagName !== "string") return null;
  const tag = tagName.toUpperCase();
  return tag === "BODY" || tag === "HTML" ? screenId : null;
}
