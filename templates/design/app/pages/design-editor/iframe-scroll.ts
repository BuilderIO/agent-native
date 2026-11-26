export type IframeScrollOffset = { left: number; top: number };

export function readIframeScrollOffset(
  iframe: HTMLIFrameElement | null | undefined,
): IframeScrollOffset | null {
  try {
    const win = iframe?.contentWindow;
    if (!win) return null;
    return { left: win.scrollX || 0, top: win.scrollY || 0 };
  } catch {
    // coercion-ok: a cross-origin frame throws SecurityError; null tells callers the offset is unknown
    return null;
  }
}
