export type IframeScrollOffset = { left: number; top: number };

/** Returns null when the frame is detached or cross-origin, so callers can't mistake it for an unscrolled frame. */
export function readIframeScrollOffset(
  iframe: HTMLIFrameElement | null | undefined,
): IframeScrollOffset | null {
  try {
    const win = iframe?.contentWindow;
    if (!win) return null;
    return { left: win.scrollX || 0, top: win.scrollY || 0 };
  } catch {
    return null;
  }
}
