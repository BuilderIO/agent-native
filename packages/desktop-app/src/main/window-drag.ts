import type { BrowserWindow, MouseInputEvent, WebContents } from "electron";

export const WINDOW_DRAG_REGION_TOP = 20;
export const WINDOW_DRAG_REGION_HEIGHT = 16;
export const WINDOW_DRAG_THRESHOLD = 4;

export interface WindowDragScreenPoint {
  x: number;
  y: number;
}

export interface WindowDragMouseEvent {
  preventDefault: () => void;
}

export type WindowDragMouseInput = Pick<
  MouseInputEvent,
  "type" | "button" | "globalX" | "globalY"
>;

interface WindowDragTarget {
  getContentBounds: () => { y: number };
  getPosition: () => number[];
  isDestroyed: () => boolean;
  setPosition: (x: number, y: number, animate?: boolean) => void;
}

interface WindowDragOptions {
  getCursorScreenPoint: () => WindowDragScreenPoint;
  regionTop?: number;
  regionHeight?: number;
  threshold?: number;
}

interface PendingWindowDrag {
  phase: "pending" | "dragging";
  startCursor: WindowDragScreenPoint;
  startWindowPosition: [number, number];
}

function pointFromMouseInput(
  input: WindowDragMouseInput,
  getCursorScreenPoint: () => WindowDragScreenPoint,
): WindowDragScreenPoint {
  if (typeof input.globalX === "number" && typeof input.globalY === "number") {
    return { x: input.globalX, y: input.globalY };
  }
  return getCursorScreenPoint();
}

export function createWindowDragController(
  window: WindowDragTarget,
  {
    getCursorScreenPoint,
    regionTop = WINDOW_DRAG_REGION_TOP,
    regionHeight = WINDOW_DRAG_REGION_HEIGHT,
    threshold = WINDOW_DRAG_THRESHOLD,
  }: WindowDragOptions,
) {
  let pendingDrag: PendingWindowDrag | null = null;

  const cancel = () => {
    pendingDrag = null;
  };

  const handleBeforeMouseEvent = (
    event: WindowDragMouseEvent,
    input: WindowDragMouseInput,
  ) => {
    if (window.isDestroyed()) {
      cancel();
      return;
    }

    if (input.type === "mouseDown") {
      if (pendingDrag || input.button !== "left") return;

      const cursor = pointFromMouseInput(input, getCursorScreenPoint);
      const contentTop = window.getContentBounds().y;
      const regionTopEdge = contentTop + regionTop;
      if (
        cursor.y < regionTopEdge ||
        cursor.y >= regionTopEdge + regionHeight
      ) {
        return;
      }

      const [windowX, windowY] = window.getPosition();
      if (!Number.isFinite(windowX) || !Number.isFinite(windowY)) return;

      pendingDrag = {
        phase: "pending",
        startCursor: cursor,
        startWindowPosition: [windowX, windowY],
      };
      return;
    }

    if (input.type === "mouseMove") {
      if (!pendingDrag) return;

      const cursor = pointFromMouseInput(input, getCursorScreenPoint);
      const deltaX = cursor.x - pendingDrag.startCursor.x;
      const deltaY = cursor.y - pendingDrag.startCursor.y;
      if (
        pendingDrag.phase === "pending" &&
        Math.hypot(deltaX, deltaY) < threshold
      ) {
        return;
      }

      pendingDrag.phase = "dragging";
      event.preventDefault();
      window.setPosition(
        pendingDrag.startWindowPosition[0] + Math.round(deltaX),
        pendingDrag.startWindowPosition[1] + Math.round(deltaY),
        false,
      );
      return;
    }

    if (input.type === "mouseUp" && pendingDrag) {
      if (pendingDrag.phase === "dragging") event.preventDefault();
      cancel();
    }
  };

  return { cancel, handleBeforeMouseEvent };
}

type BeforeMouseEventListener = (
  event: WindowDragMouseEvent,
  input: WindowDragMouseInput,
) => void;

interface AttachedWindowDragListeners {
  beforeMouseEvent: BeforeMouseEventListener;
  destroyed: () => void;
}

/**
 * Attach the gesture to both the shell and native guest webviews. A webview
 * owns its own WebContents, so listening only on the BrowserWindow misses the
 * top edge while an app guest is covering it.
 */
export function installWindowDragController(
  window: BrowserWindow,
  options: WindowDragOptions,
): () => void {
  const controller = createWindowDragController(window, options);
  const listeners = new Map<WebContents, AttachedWindowDragListeners>();

  const attach = (contents: WebContents) => {
    if (contents.isDestroyed() || listeners.has(contents)) return;
    const listener: BeforeMouseEventListener = (event, input) => {
      controller.handleBeforeMouseEvent(event, input);
    };
    const onDestroyed = () => {
      contents.removeListener("before-mouse-event", listener);
      contents.removeListener("destroyed", onDestroyed);
      listeners.delete(contents);
    };
    contents.on("before-mouse-event", listener);
    contents.once("destroyed", onDestroyed);
    listeners.set(contents, {
      beforeMouseEvent: listener,
      destroyed: onDestroyed,
    });
  };

  const onDidAttachWebview = (_event: unknown, contents: WebContents) => {
    attach(contents);
  };
  const onWindowBlur = () => controller.cancel();

  attach(window.webContents);
  window.webContents.on("did-attach-webview", onDidAttachWebview);
  window.on("blur", onWindowBlur);

  return () => {
    controller.cancel();
    window.webContents.removeListener("did-attach-webview", onDidAttachWebview);
    window.removeListener("blur", onWindowBlur);
    for (const [contents, attached] of listeners) {
      contents.removeListener("before-mouse-event", attached.beforeMouseEvent);
      contents.removeListener("destroyed", attached.destroyed);
    }
    listeners.clear();
  };
}
