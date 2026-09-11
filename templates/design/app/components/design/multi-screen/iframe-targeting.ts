export function getPrimaryIframeId(screenId: string): string {
  return screenId;
}

export function getBreakpointIframeId(
  screenId: string,
  widthPx: number,
): string {
  return `${screenId}::bp-${widthPx}`;
}

export function isBreakpointSelectionTarget(screen: {
  breakpointWidths?: number[];
  activeBreakpointWidth?: number;
}): boolean {
  return (
    screen.activeBreakpointWidth !== undefined &&
    (screen.breakpointWidths ?? []).includes(screen.activeBreakpointWidth)
  );
}

/**
 * Whether the screen's own frame-level SelectionBox (corner/rotate handles +
 * outline sized to the whole screen) should be suppressed because a MORE
 * specific target already owns the selection chrome — either one of the
 * screen's breakpoint sub-frames (existing BP-DEEP v2 case), or a specific
 * element inside the screen (Layers-panel row, in-canvas click resolving to
 * a node). The editor-chrome bridge inside the iframe already renders a
 * correctly-fitted outline + resize handles for that element; drawing the
 * frame-sized box on top of it is wrong, not just redundant — it always
 * spans the whole screen regardless of what's actually selected.
 */
export function shouldSuppressFrameSelectionBox(
  screen: {
    id: string;
    breakpointWidths?: number[];
    activeBreakpointWidth?: number;
  },
  selectedElementScreenId: string | null | undefined,
): boolean {
  return (
    isBreakpointSelectionTarget(screen) || selectedElementScreenId === screen.id
  );
}

export function getActiveScreenIframeId(screen: {
  id: string;
  activeBreakpointWidth?: number;
  breakpointWidths?: number[];
}): string {
  const activeWidth = screen.activeBreakpointWidth;
  if (
    activeWidth !== undefined &&
    screen.breakpointWidths?.includes(activeWidth)
  ) {
    return getBreakpointIframeId(screen.id, activeWidth);
  }
  return getPrimaryIframeId(screen.id);
}

/** Resolve an ordinary screen iframe or the dedicated board surface iframe. */
export function findCanvasIframeForScreen(
  root: HTMLElement | null,
  iframeId: string,
  boardFileId?: string,
): HTMLIFrameElement | null {
  if (!root) return null;
  if (boardFileId && iframeId === boardFileId) {
    return root.querySelector<HTMLIFrameElement>(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    );
  }
  return root.querySelector<HTMLIFrameElement>(
    `[data-screen-iframe-id="${CSS.escape(iframeId)}"]`,
  );
}
