import { getBreakpointIframeId } from "../multi-screen/iframe-targeting";

export class NativeShaderPreferencesFrameError extends Error {
  constructor(
    readonly code:
      | "screen-unavailable"
      | "frame-unavailable"
      | "frame-ambiguous"
      | "frame-hidden",
  ) {
    super(code);
    this.name = "NativeShaderPreferencesFrameError";
  }
}

export function findVisibleNativeShaderPreferencesFrame({
  root,
  screenId,
  boardFileId,
  breakpointWidthPx,
}: {
  root: HTMLElement | null;
  screenId: string | null;
  boardFileId?: string | null;
  breakpointWidthPx?: number;
}): HTMLIFrameElement {
  if (!root || !screenId)
    throw new NativeShaderPreferencesFrameError("screen-unavailable");
  const board = screenId === boardFileId;
  const frameId =
    breakpointWidthPx === undefined
      ? screenId
      : getBreakpointIframeId(screenId, breakpointWidthPx);
  const frames = Array.from(
    root.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    ),
  ).filter((frame) =>
    board
      ? frame.closest("[data-board-surface-layer]") !== null
      : frame.dataset.screenIframeId === frameId &&
        frame.closest("[data-board-surface-layer]") === null,
  );
  if (frames.length === 0)
    throw new NativeShaderPreferencesFrameError("frame-unavailable");
  if (frames.length !== 1)
    throw new NativeShaderPreferencesFrameError("frame-ambiguous");
  const frame = frames[0];
  const outerWindow = frame.ownerDocument.defaultView;
  const style = outerWindow?.getComputedStyle(frame);
  const rect = frame.getBoundingClientRect();
  let ancestor: HTMLElement | null = frame.parentElement;
  while (ancestor && ancestor !== root.parentElement) {
    const ancestorStyle = outerWindow?.getComputedStyle(ancestor);
    if (
      !ancestorStyle ||
      ancestorStyle.display === "none" ||
      !Number.isFinite(Number(ancestorStyle.opacity)) ||
      Number(ancestorStyle.opacity) <= 0
    )
      throw new NativeShaderPreferencesFrameError("frame-hidden");
    if (ancestor === root) break;
    ancestor = ancestor.parentElement;
  }
  if (
    !frame.isConnected ||
    !frame.contentWindow ||
    !style ||
    style.display === "none" ||
    style.visibility !== "visible" ||
    !Number.isFinite(Number(style.opacity)) ||
    Number(style.opacity) <= 0 ||
    frame.clientWidth <= 0 ||
    frame.clientHeight <= 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !outerWindow ||
    Math.min(rect.right, outerWindow.innerWidth) <= Math.max(rect.left, 0) ||
    Math.min(rect.bottom, outerWindow.innerHeight) <= Math.max(rect.top, 0)
  )
    throw new NativeShaderPreferencesFrameError("frame-hidden");
  return frame;
}
