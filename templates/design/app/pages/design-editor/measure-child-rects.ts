/**
 * Container-relative geometry for a node's direct children, read from whichever
 * preview iframe actually holds the node — the board and each screen have their
 * own document, so a single global iframe lookup finds the wrong one.
 */
export function measureChildRects(
  nodeId: string,
): Record<string, { x: number; y: number; width: number; height: number }> {
  if (typeof document === "undefined") return {};
  const selector = `[data-agent-native-node-id="${CSS.escape(nodeId)}"]`;
  const iframes = Array.from(
    document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe],iframe[data-screen-iframe-id]",
    ),
  );
  for (const iframe of iframes) {
    let container: HTMLElement | null = null;
    try {
      container =
        iframe.contentDocument?.querySelector<HTMLElement>(selector) ?? null;
    } catch {
      // Cross-origin preview surfaces are not measurable; try the next one.
      continue;
    }
    if (!container) continue;
    const origin = container.getBoundingClientRect();
    // Absolute offsets resolve against the padding box, but a client rect is
    // the border box, so a bordered container shifts every child it pins.
    const borders =
      container.ownerDocument.defaultView?.getComputedStyle(container);
    const originLeft = origin.left + edgeWidth(borders?.borderLeftWidth);
    const originTop = origin.top + edgeWidth(borders?.borderTopWidth);
    const rects: Record<
      string,
      { x: number; y: number; width: number; height: number }
    > = {};
    for (const child of Array.from(container.children)) {
      const childId = child.getAttribute("data-agent-native-node-id");
      if (!childId) continue;
      const rect = child.getBoundingClientRect();
      rects[childId] = {
        x: rect.left - originLeft,
        y: rect.top - originTop,
        width: rect.width,
        height: rect.height,
      };
    }
    return rects;
  }
  return {};
}

function edgeWidth(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  // A missing or non-length border computes to no edge; both mean zero inset.
  return Number.isFinite(parsed) ? parsed : 0;
}
