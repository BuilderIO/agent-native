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
